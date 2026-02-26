
const {intersectSphericalCircles} = require('./vector3');
const geolib = require('geolib')

function n(h) {
    // normalize heading to (-180, 180)
    h = h % 360;
    if (h>180)
        return h-360
    else
        return h
}

var routePoints = [
    [ -0.8489757240394843, 56.92115463139183 ],
    [ -0.8596336569935877, 56.922816600437045 ],
    [ -0.8628171954084498, 56.92617808429057 ],
    [ -0.8599104864209672, 56.929539265342214 ],
    [ -0.855135178798674, 56.932182678161325 ],
    [ -0.8542354831596911, 56.93252253193489 ]
]

var currentPosition 

// within range
currentPosition = {
        "latitude": 56.92117,
        "longitude": -0.84984
}

//within range, clamped
currentPosition = {
        "latitude": 56.92078,
        "longitude": -0.84995
}

// out of range, takes waypoint
currentPosition = {
        "latitude": 56.91996,
        "longitude": -0.84990
}

// within range, within first arrival circle
currentPosition = {
        "latitude": 56.92262,
        "longitude": -0.84970
}

var guideRadius = 100;

var maxErrorAngle = 25;


function latlon2Dict (latlon) {
    // convert [lon, lat] to {"latitude": lat, "longitude": lon}
    return {"latitude": latlon[1], "longitude": latlon[0]}
}

function getRoutePositionBearing(currentPosition, guideRadius, maxErrorAngle, routePoints) {
    var closestDistance = null;
    var result = {};
    for (var i = 0; i < routePoints.length - 1; i++) {
        previousPoint = latlon2Dict(routePoints[i]);
        nextPoint = latlon2Dict(routePoints[i+1]);
        console.log ("Leg", i, "previousPoint", previousPoint, "nextPoint", nextPoint)
        intersections = intersectSphericalCircles (previousPoint, nextPoint, currentPosition, guideRadius)
        console.log("intersections", intersections);
        var guidePoint = null;
        segmentHeading = geolib.getRhumbLineBearing (previousPoint, nextPoint);
        intersections.forEach(i => {
            // pick the intersection that is in the general direction of the active route segment
            intersectionBearing = geolib.getRhumbLineBearing (currentPosition, i);
            difference = n(n(intersectionBearing) - n(segmentHeading))
            if (-90 < difference && difference < +90) {
                console.log("guidePoint", i, "guidePointBearing", intersectionBearing);
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
        // Clamp here;

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

console.log("currentPosition", currentPosition);
console.log("guideRadius", guideRadius);
console.log("maxErrorAngle", maxErrorAngle);
console.log("routePoints", routePoints);
console.log ("getRoutePositionBearing", getRoutePositionBearing(currentPosition, guideRadius, maxErrorAngle, routePoints))

