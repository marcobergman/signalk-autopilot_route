/*
 * Copyright 2016 Scott Bender <scott@scottbender.net>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const path = require('path')
const fs = require('fs')
const geolib = require('geolib')
const csv = require('fast-csv');
const {intersectSphericalCircles} = require('./vector3');

const subscribrPeriod = 30

module.exports = function (app) {
  var plugin = {}
  var alarm_sent = false
  var prev_anchorState = false
  let onStop = []
  var positionInterval
  var positionAlarmSent = false
  var configuration
  var delayStartTime
  var lastTrueHeading
  var previousPoint
  var nextPoint
  var saveOptionsTimer
  var track = []
  var incompleteAnchorTimer
  var sentIncompleteAnchorAlarm
  var statePath
  var state

  plugin.start = function (props) {
    configuration = props
    try {
      startWatchingPosistion();

      if (app.registerActionHandler) {
        app.registerActionHandler(
          'vessels.self',
          `navigation.anchor.rodeLength`,
          putRodeLength
        )
      }

      app.handleMessage(plugin.id, {
        updates: [
          {
            meta: [
              {
                path: 'navigation.anchor.bearingTrue',
                value: { units: 'rad' }
              },
              {
                path: 'navigation.anchor.distanceFromBow',
                value: { units: 'm' }
              }
            ]
          }
        ]
      })
	  
    } catch (e) {
      plugin.started = false
      app.error('error: ' + e)
      console.error(e.stack)
      return e
    }
  }


  

  function putRodeLength(context, path, value) {
    app.handleMessage(plugin.id, {
      updates: [
        {
          values: [
            {
              path: 'navigation.anchor.rodeLength',
              value: value
            }
          ]
        }
      ]
    })

    let res = setManualAnchor(null, value)

    if (res.code != 200) {
      return { state: 'FAILURE', message: res.message }
    } else {
      return { state: 'SUCCESS' }
    }
  }


  plugin.stop = function () {
  }

  function stopWatchingPosition() {
    onStop.forEach((f) => f())
    onStop = []
    track = []
    if (positionInterval) {
      clearInterval(positionInterval)
      positionInterval = null
    }
  }

  function startWatchingPosistion() {
    if (onStop.length > 0) return

    track = []
    app.subscriptionmanager.subscribe(
      {
        context: 'vessels.self',
        subscribe: [
          {
            path: 'navigation.position',
            period: subscribrPeriod
          },
          {
            path: 'navigation.course.nextPoint',
            period: subscribrPeriod
          },
          {
            path: 'navigation.course.previousPoint',
            period: subscribrPeriod
          }
        ]
      },
      onStop,
      (err) => {
        app.error(err)
        app.setProviderError(err)
      },
      (delta) => {
        let position, trueHeading

        if (delta.updates) {
          delta.updates.forEach((update) => {
            if (update.values) {
              update.values.forEach((vp) => {
                if (vp.path === 'navigation.position') {
                  position = vp.value
                  if (typeof position !== 'undefined' && typeof previousPoint !== 'undefined' && typeof nextPoint !== 'undefined' && previousPoint && nextPoint) {
                      intersections = intersectSphericalCircles (previousPoint.position, nextPoint.position, position, 100)
                      let guidePoint
                      minDistance = 10000
                      intersections.forEach(i => {
                         d = geolib.getDistance (nextPoint.position, i, 1)
                         if (d < minDistance) {
                             minDistance = d;
                             guidePoint = i;
                         }
			 //app.debug("intersection", i, d)
		      })
                      if (guidePoint) {
                          bearing = geolib.getRhumbLineBearing (position, guidePoint)
                          app.debug("guidePoint", guidePoint, "bearing", bearing);
                      } else console.log("Traala");
                  }
                } else if (vp.path === 'navigation.course.nextPoint') {
                  nextPoint = vp.value
                } else if (vp.path === 'navigation.course.previousPoint') {
                  previousPoint = vp.value
                }
              })
            }
          })
        }

        if (position) {
        }

        if (typeof trueHeading !== 'undefined' || position) {
          if (typeof trueHeading !== 'undefined') {
            lastTrueHeading = trueHeading
          }
        }
      }
    )
  }

  plugin.registerWithRouter = function (router) {
    router.post('/dropAnchor', (req, res) => {
      var vesselPosition = app.getSelfPath('navigation.position')
      if (vesselPosition && vesselPosition.value)
        vesselPosition = vesselPosition.value

      if (typeof vesselPosition == 'undefined') {
        app.debug('no position available')
        res.status(403)
        res.json({
          statusCode: 403,
          state: 'FAILED',
          message: 'no position available'
        })
      } else {
        let position = computeBowLocation(
          vesselPosition,
          app.getSelfPath('navigation.headingTrue.value')
        )

        app.debug(
          'set anchor position to: ' +
            position.latitude +
            ' ' +
            position.longitude
        )
        var radius = req.body['radius']
        if (typeof radius == 'undefined') {
          radius = null
        }

      }
    })

    router.get('/getTrack', (req, res) => {
      res.json(track)
    })

    router.get('/getEP', (req, res) => {
	  vesselPosition = app.getSelfPath('navigation.position.value')
	  res.json({"latitude": vesselPosition.latitude - 0.001, "longitude": vesselPosition.longitude - 0.001})
    })

    router.get('/getHeel', (req, res) => {
	  res.json({"heel": 9})
    })

    router.get('/getDrift', (req, res) => {
	  res.json({"drift": 5})
    })

    router.get('/getCurrent', (req, res) => {
    })

    router.get('/getDrift', (req, res) => {
      res.json(2.0)
    })

  }


	
  plugin.id = 'deadreckoner'
  plugin.name = 'Autopilot Route Follower'
  plugin.description =
    "Plugin that generates APB messages that point to the active leg in a route in a smart way, and sends these messages to pypilot."

  plugin.schema = {
    title: 'Autopilot Route Follower',
    type: 'object',
    required: ['radius', 'active'],
    properties: {
      radius: {
        type: 'number',
        title:
          'Guide radius (m)',
        default: 100
      },
      maxErrorAngle: {
        type: 'number',
        title: 'Maximum error angle to divert from the leg heading (degrees)',
        default: 15
      },
      pypilotIpAddress: {
        title: 'pypilotIpAddress',
        type: 'string',
        default: '10.10.10.3'
      }
    }
  }

  return plugin
}

function calc_distance(lat1, lon1, lat2, lon2) {
  return geolib.getDistance(
    { latitude: lat1, longitude: lon1 },
    { latitude: lat2, longitude: lon2 },
    0.1
  )
}

function calc_position_from(app, position, heading, distance) {
  return geolib.computeDestinationPoint(position, distance, radsToDeg(heading))
}

function radsToDeg(radians) {
  return (radians * 180) / Math.PI
}

function degsToRad(degrees) {
  return degrees * (Math.PI / 180.0)
}
