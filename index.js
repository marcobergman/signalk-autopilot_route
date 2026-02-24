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

const subscribrPeriod = 1000

function createNmeaSentence(payload) {
  let checksum = 0;
  for (let i = 0; i < payload.length; i++) {
    checksum ^= payload.charCodeAt(i);
  }

  const hex = checksum.toString(16).toUpperCase().padStart(2, '0');

  //return `$${payload}*${hex}\r\n`;
  return `$${payload}*${hex}`;
}


function n(h) {
  // normalize heading to (-180, 180)
  h = h % 360;
  if (h>180)
    return h-360
  else
    return h
}


module.exports = function (app) {
  var plugin = {}
  var alarm_sent = false
  let onStop = []
  var positionInterval
  var positionAlarmSent = false
  var configuration
  var delayStartTime
  var lastTrueHeading
  var currentPosition
  var previousPoint
  var xte
  var nextPoint
  var currentGuidePoint
  var headingPoint
  var guidePointBearing
  var segmentHeading
  var headingToSteer
  var guideRadius
  var saveOptionsTimer
  var track = []
  var statePath
  var state
  var activeRoute
  var routePoints

  plugin.start = function (props) {
    configuration = props
    try {
      app.debug ("starting");
      startWatchingPosition();

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
    calculateDistance  }

  function startWatchingPosition() {
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
          },
          {
            path: 'navigation.course.calcValues.crossTrackError',
            period: subscribrPeriod
          },
          {
            path: 'resources.routes.*',
            period: subscribrPeriod
          },
          {
            path: 'navigation.course.activeRoute', 
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
                  currentPosition = vp.value
                  if (!xte || xte == 'undefined') xte = 0;
                  // app.debug(`currentPosition ${currentPosition} previousPoint ${previousPoint} nextPoint ${nextPoint} xte ${xte}`);
                  if (typeof currentPosition !== 'undefined' && typeof previousPoint !== 'undefined' && typeof nextPoint !== 'undefined' && xte !== 'undefined' && previousPoint && nextPoint) {
		      guideRadius = configuration["guideRadius"];
                      intersections = intersectSphericalCircles (previousPoint.position, nextPoint.position, currentPosition, guideRadius)
                      let guidePoint
                      segmentHeading = geolib.getRhumbLineBearing (previousPoint.position, nextPoint.position);
                      intersections.forEach(i => {
			 // pick the intersection that is in the general direction of the active route segment
			 intersectionBearing = geolib.getRhumbLineBearing (currentPosition, i);
			 difference = n(intersectionBearing - segmentHeading)
                         if (-90 < difference  && difference < +90) {
                             guidePoint = i;
                         }
		      })
                      if (! guidePoint)
                         guidePoint = nextPoint.position;
                      currentGuidePoint = guidePoint;
                      guidePointBearing = geolib.getRhumbLineBearing (currentPosition, guidePoint);
                      difference = n(n(guidePointBearing) - n(segmentHeading))
		      distanceToPreviousPoint = geolib.getDistance(currentPosition, previousPoint.position)
		      if (distanceToPreviousPoint > guideRadius) {
		            // outside arrival circle (~= guideRadius), clamp to maxErorAngle
		            maxErrorAngle = configuration["maxErrorAngle"]
                            if (difference < -maxErrorAngle) difference = -maxErrorAngle;
                            if (difference > maxErrorAngle) difference = maxErrorAngle;
                            headingToSteer = (segmentHeading + difference + 360) % 360;
		      }
		      else {
		            // within arrival circle, simply follow guide point with no clamping
		            headingToSteer = guidePointBearing;
		      }
                      var apbXte 
                      if (configuration["xteZero"]) apbXte = 0; else apbXte = xte;
		      const data = `ECAPB,A,A,${apbXte.toFixed(3)},R,N,V,V,${segmentHeading.toFixed(1)},T,,${guidePointBearing.toFixed(1)},T,${headingToSteer.toFixed(1)},T`;
		      const fullSentence = createNmeaSentence(data);
		      app.emit(configuration["eventName"], fullSentence);
		      headingPoint = geolib.computeDestinationPoint(currentPosition, guideRadius, headingToSteer);
                }
                } else if (vp.path === 'navigation.course.nextPoint') {
                  nextPoint = vp.value
                } else if (vp.path === 'navigation.course.previousPoint') {
                  previousPoint = vp.value
                } else if (vp.path === 'navigation.course.calcValues.crossTrackError') {
                  xte = vp.value / 1852; // meters to nautical miles
                } else if (vp.path === 'navigation.course.activeRoute') {
                  v = String(vp.value.href);
                  activeRoute = String(v.split('/').slice(-1));
                  routePoints = null;
		  app.debug("activeRoute", activeRoute);    
                } else if (String(vp.path.split('.').slice(-1)) === activeRoute) {
		  routePoints = vp.value.feature.geometry.coordinates;
                  app.debug ("geometry", routePoints);
                } else { app.debug("else", vp.path, activeRoute.href, vp);
                }
              })
            }
          })
        }

        if (currentPosition) {
        }

        if (typeof trueHeading !== 'undefined' || currentPosition) {
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

        var radius = req.body['radius']
        if (typeof radius == 'undefined') {
          radius = null
        }

      }
    })

    router.get('/getTrack', (req, res) => {
      res.json(track)
    })

    router.get('/getData', (req, res) => {
      if(previousPoint && nextPoint)
      res.json({"previousPoint": previousPoint.position, 
                "nextPoint": nextPoint.position, 
		"currentPosition": currentPosition, 
		"currentGuidePoint": currentGuidePoint, 
		"guideRadius": configuration["guideRadius"],
		"maxErrorAngle": configuration["maxErrorAngle"],
		"guidePointBearing": guidePointBearing,
		"segmentHeading": segmentHeading,
		"headingToSteer": headingToSteer,
		"headingPoint": headingPoint,
		"routePoints": routePoints,
                "xte": xte
		})
    })

  }


	
  plugin.id = 'signalk-autopilot_route'
  plugin.name = 'Autopilot Route Follower'
  plugin.description =
    "Plugin that creates 'smooth' APB messages for Pyilot based on the Route Position Bearing algorithm"

  plugin.schema = {
    title: 'Autopilot Route Follower',
    type: 'object',
    required: ['guideRadius', 'active'],
    properties: {
      guideRadius: {
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
      eventName: {
        title: 'eventName',
        type: 'string',
        default: 'autopilot_route'
      },
      xteZero: {
        title: 'XTE Zero - Set XTE to zero in APB message.',
        type: 'boolean',
        default: true
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
