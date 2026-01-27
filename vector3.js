class Vector3 {
    constructor(x, y, z) {
        this.x = x;
        this.y = y;
        this.z = z;
    }

    add(v) {
        return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
    }

    subtract(v) {
        return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
    }

    scale(s) {
        return new Vector3(this.x * s, this.y * s, this.z * s);
    }
    
    dot(v) {
        return this.x * v.x + this.y * v.y + this.z * v.z;
    }

    cross(v) {
        return new Vector3(
            this.y * v.z - this.z * v.y,
            this.z * v.x - this.x * v.z,
            this.x * v.y - this.y * v.x
        );
    }

    length() {
        return Math.sqrt(this.dot(this));
    }

    normalize() {
        const len = this.length();
        if (len > 0) {
            return new Vector3(this.x / len, this.y / len, this.z / len);
        }
        return new Vector3(0, 0, 0); // Handle zero vector case
    }
}

const R = 6378100; // Earth radius (m)

/**
 * Converts spherical coordinates (latitude, longitude) to Cartesian (x, y, z).
 * Assumes latitude and longitude are in degrees.
 */
function toCartesian(lat, lon) {
    const latRad = (lat * Math.PI) / 180;
    const lonRad = (lon * Math.PI) / 180;
    const x = R * Math.cos(latRad) * Math.cos(lonRad);
    const y = R * Math.cos(latRad) * Math.sin(lonRad);
    const z = R * Math.sin(latRad);
    return new Vector3(x, y, z);
}

/**
 * Converts Cartesian coordinates (x, y, z) to spherical (latitude, longitude).
 * Returns latitude and longitude in degrees.
 */
function toSpherical(v) {
    const latRad = Math.asin(v.z / R);
    const lonRad = Math.atan2(v.y, v.x);

    return {
        latitude: (latRad * 180) / Math.PI,
        longitude: (lonRad * 180) / Math.PI
	};
}


function intersectSphericalCircles(p1, p2, cb, diameter) {
	const alphaDeg = diameter /1852/60;
    const NA = toCartesian(p1.latitude, p1.longitude).cross(toCartesian(p2.latitude, p2.longitude)).normalize();
    const NB = toCartesian(cb.latitude, cb.longitude).normalize();
    const d = R * Math.cos(alphaDeg * Math.PI / 180);
    const L = NA.cross(NB);
    const L_len_sq = L.dot(L);
    if (L_len_sq < 1e-12) return []; // Parallel planes

    // Solve for X0 using Cramer's rule or matrix inversion
    // For simplicity, X0 = (d * (NA x L)) / (NB . (NA x L))
    const NAL = NA.cross(L);
    const X0 = NAL.scale(d / NB.dot(NAL));

    const distSq = X0.dot(X0);
    if (distSq > R * R) return []; // No intersection

    const t = Math.sqrt((R * R - distSq) / L_len_sq);
    return [
        toSpherical(X0.add(L.scale(t))),
        toSpherical(X0.subtract(L.scale(t)))
    ];
}

// const cb={latitude: 50.273608333333335, longitude: -19.828531666666667};
// const p1={latitude: 50.273695709415676, longitude: -19.829031655343794};
// const p2={latitude: 50.27400767810937, longitude: -19.830618388427936};
// const diameter = 100; // diameter (m)
// 
// const intersectionPoints=intersectSphericalCircles(p1, p2, cb, diameter)
// console.log("intersectionPoints", intersectionPoints)



module.exports = {
    intersectSphericalCircles: intersectSphericalCircles
}


