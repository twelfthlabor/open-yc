// Generates land-dots.json: latitude and longitude of the land points the trip globe draws as dots.
// Source: Natural Earth 110m land (world-atlas). Sampled with spherical geometry so the antimeridian is handled.
// Run after changing the grid or the source data: npm run build:land
import { geoBounds, geoContains } from 'd3-geo';
import type { FeatureCollection, Polygon } from 'geojson';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { feature } = require('topojson-client') as typeof import('topojson-client');
const topology = require('world-atlas/land-110m.json') as Parameters<typeof feature>[0];

const STEP = 2.2;
const DEG = Math.PI / 180;

const LAND = feature(topology, topology.objects.land) as FeatureCollection;
const POLYGONS = LAND.features.flatMap((f) => {
  const polygons = f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : [];
  return polygons.map((coordinates) => {
    const shape: Polygon = { type: 'Polygon', coordinates };
    return { shape, bounds: geoBounds(shape) };
  });
});

// geoBounds returns west > east for a box that crosses the antimeridian.
function inBounds([[west, south], [east, north]]: [[number, number], [number, number]], lon: number, lat: number): boolean {
  if (lat < south || lat > north) return false;
  return west <= east ? lon >= west && lon <= east : lon >= west || lon <= east;
}

function isLand(lat: number, lon: number): boolean {
  return POLYGONS.some((p) => inBounds(p.bounds, lon, lat) && geoContains(p.shape, [lon, lat]));
}

const round1 = (v: number) => Math.round(v * 10) / 10;

// Rows shrink toward the poles so the dots stay evenly spaced.
const points: [number, number][] = [];
for (let lat = -78; lat <= 84; lat += STEP) {
  const n = Math.max(1, Math.round((360 * Math.cos(lat * DEG)) / STEP));
  for (let i = 0; i < n; i++) {
    const lon = -180 + ((i + 0.5) * 360) / n;
    if (isLand(lat, lon)) points.push([round1(lat), round1(lon)]);
  }
}

writeFileSync(new URL('../src/globe/land-dots.json', import.meta.url), JSON.stringify(points) + '\n');
console.log(`wrote ${points.length} land dots (step ${STEP} degrees)`);
