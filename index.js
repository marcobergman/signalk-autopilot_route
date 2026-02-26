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

const apiRoutePrefix = ""

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

function latlon2Dict (latlon) {
    // convert [lon, lat] to {"latitude": lat, "longitude": lon}
    return {"latitude": latlon[1], "longitude": latlon[0]}
}

function getRoutePositionBearing(currentPosition, guideRadius, maxErrorAngle, routePoints) {
     //
     //  {
     //    guidePoint: 
     //    guidePointBearing: 
     //    segmentHeading:
     //    headingToSteer:
     //  } 
     //
    var closestDistance = null;
    var result = {};
    for (var r = 0; r < routePoints.length - 1; r++) {
        previousPoint = latlon2Dict(routePoints[r]);
        nextPoint = latlon2Dict(routePoints[r+1]);
        console.log ("Leg", r, "previousPoint", previousPoint, "nextPoint", nextPoint)
        intersections = intersectSphericalCircles (previousPoint, nextPoint, currentPosition, guideRadius)
        console.log("intersections", intersections);
        var guidePoint = null;
        segmentHeading = geolib.getRhumbLineBearing (previousPoint, nextPoint);
        intersections.forEach(i => {
            // First, determine whether the intersection is between the two points, and not on the extension:
            distanceToPreviousPoint = geolib.getDistance (i, previousPoint);
            distanceToNextPoint = geolib.getDistance (i, nextPoint);
            distanceBetweenPoints = geolib.getDistance (previousPoint, nextPoint);
            onSegment = distanceToPreviousPoint + distanceToNextPoint -distanceBetweenPoints < 2; 
            // Make an exception for the last leg: we do want to continue on that line
            if (r == routePoints.length - 2) {onSegment = true; console.log("make exception")};
            console.log ("distanceToPreviousPoint", distanceToPreviousPoint, "distanceToNextPoint", distanceToNextPoint, "distanceBetweenPoints", distanceBetweenPoints, "onSegment", onSegment);
            // pick the intersection that is in the general direction of the active route segment
            intersectionBearing = geolib.getRhumbLineBearing (currentPosition, i);
            difference = n(n(intersectionBearing) - n(segmentHeading))
            console.log ("intersectionBearing", intersectionBearing, "segmentHeading", segmentHeading, "difference", difference);
            if (-90 < difference && difference < +90 && onSegment) {
                console.log("guidePoint", r, "guidePointBearing", intersectionBearing);
                result.guidePoint = i;
                result.guidePointBearing = intersectionBearing;
                result.segmentHeading = segmentHeading;
            }
        });

        // Just in case there are no intersections at all, determine the closest waypoint - and the next one to that.
        previousPointDistance = geolib.getDistance(currentPosition, previousPoint);
        if (closestDistance === null || previousPointDistance < closestDistance) {
            closestDistance = previousPointDistance;
            closestRoutePoint = previousPoint;
            closestRoutePointNext = nextPoint;
            closestSegmentHeading = segmentHeading;
            console.log("closestDistance", closestDistance);
        }

    }
    if (result.guidePoint) {
        console.log("guidepoint found");
    } else {
        console.log("guidepoint not found");
        // Substitute next point of closest segment for guidepoint
        result.guidePoint = closestRoutePointNext;
        result.guidePointBearing = geolib.getRhumbLineBearing (currentPosition, closestRoutePointNext)
        result.segmentHeading = closestSegmentHeading;
    }

    // Clamp to maxErorAngle
    difference = n(n(result.guidePointBearing) - n(result.segmentHeading))
    if (difference < -maxErrorAngle) difference = -maxErrorAngle;
    if (difference > maxErrorAngle) difference = maxErrorAngle;
    result.headingToSteer = (result.segmentHeading + difference + 360) % 360;

    return result;
}


module.exports = function (app) {
  var plugin = {}
  var alarm_sent = false
  let onStop = []
  var positionInterval
  var positionAlarmSent = false
  var configuration
  var delayStartTime
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
  var results = {}

async function getActiveRouteGeoJson(app, routeUuid) {
  try {
    const routeData = await app.resourcesApi.getResource('routes', routeUuid);

    app.debug(`Fetched Route: ${routeData.name}`);
    app.debug(`Route data: ${routeData.feature.geometry.coordinates}`);
    
    // The GeoJSON is typically stored in routeData.feature
    routePoints = routeData.feature.geometry.coordinates;
    return routeData.feature.geometry.coordinates; 

  } catch (error) {
    app.error('Error fetching route data:', error.message);
    return null;
  }
}



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
                  if (typeof currentPosition !== 'undefined' && typeof previousPoint !== 'undefined' && typeof nextPoint !== 'undefined' && xte !== 'undefined' && previousPoint && nextPoint) {
		      guideRadius = configuration["guideRadius"];
		      maxErrorAngle = configuration["maxErrorAngle"]
                      result = getRoutePositionBearing(currentPosition, guideRadius, maxErrorAngle, routePoints);
                      app.debug(result);
                      var apbXte 
                      if (configuration["xteZero"]) apbXte = 0; else apbXte = xte;
		      const data = `ECAPB,A,A,${apbXte.toFixed(3)},R,N,V,V,${result.segmentHeading.toFixed(1)},T,,${result.guidePointBearing.toFixed(1)},T,${result.headingToSteer.toFixed(1)},T`;
		      const fullSentence = createNmeaSentence(data);
		      app.emit(configuration["eventName"], fullSentence);
		      headingPoint = geolib.computeDestinationPoint(currentPosition, guideRadius, result.headingToSteer);
                  }
                  } else if (vp.path === 'navigation.course.nextPoint') {
                    nextPoint = vp.value
                  } else if (vp.path === 'navigation.course.previousPoint') {
                    previousPoint = vp.value
                  } else if (vp.path === 'navigation.course.calcValues.crossTrackError') {
                    xte = vp.value / 1852; // meters to nautical miles
                  } else if (vp.path === 'navigation.course.activeRoute') {
                    if (vp.value) {
                        v = String(vp.value.href);
                        activeRoute = String(v.split('/').slice(-1));
                        getActiveRouteGeoJson (app, activeRoute);
		        app.debug("activeRoute", activeRoute);
                    } else {
	                activeRoute = null;
                        routePoints = null;
                    }
                  } else if (String(vp.path.split('.').slice(-1)) === activeRoute) {
		    routePoints = vp.value.feature.geometry.coordinates;
                    app.debug ("geometry", routePoints);
                  }
              })
            }
          })
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
      res.json({
		"routePoints": routePoints,
		"currentPosition": currentPosition, 
		"guideRadius": configuration["guideRadius"],
		"maxErrorAngle": configuration["maxErrorAngle"],
		"guidePointBearing": result.guidePointBearing,
		"currentGuidePoint": result.guidePoint,
		"segmentHeading": result.segmentHeading,
		"headingToSteer": result.headingToSteer,
		"headingPoint": headingPoint,
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
