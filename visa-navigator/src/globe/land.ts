import landDotsJson from './land-dots.json';

const DEG = Math.PI / 180;

/** Unit vector for a latitude and longitude. Same coordinate system as the trip globe's country pins. */
export function latLonToXYZ(lat: number, lon: number): [number, number, number] {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return [-Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
}

/** Unit vectors of the land dots as a flat [x, y, z, ...] array. The points come from land-dots.json (see scripts/build-land.ts). */
export const LAND_DOTS = toXYZ(landDotsJson as [number, number][]);

function toXYZ(points: [number, number][]): Float32Array {
  const out = new Float32Array(points.length * 3);
  points.forEach(([lat, lon], i) => out.set(latLonToXYZ(lat, lon), i * 3));
  return out;
}
