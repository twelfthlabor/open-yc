import { describe, expect, it } from 'vitest';
import { LAND_DOTS, latLonToXYZ } from './land';

const DEG = Math.PI / 180;

/** Angle in degrees from a point to the nearest land dot. */
function nearestDotDeg(lat: number, lon: number): number {
  const [x, y, z] = latLonToXYZ(lat, lon);
  let best = -1;
  for (let i = 0; i < LAND_DOTS.length; i += 3) {
    best = Math.max(best, x * LAND_DOTS[i] + y * LAND_DOTS[i + 1] + z * LAND_DOTS[i + 2]);
  }
  return Math.acos(Math.min(1, best)) / DEG;
}

describe('latLonToXYZ', () => {
  it('returns unit vectors', () => {
    for (const [lat, lon] of [
      [45.1, 15.2],
      [-33.9, 151.2],
      [0, 0],
      [90, 0],
      [-90, 180],
    ]) {
      const [x, y, z] = latLonToXYZ(lat, lon);
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 10);
    }
  });

  it('puts the north pole on +y', () => {
    const [x, y, z] = latLonToXYZ(90, 0);
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(1, 10);
    expect(z).toBeCloseTo(0, 10);
  });
});

describe('LAND_DOTS', () => {
  it('holds xyz triples on the unit sphere', () => {
    expect(LAND_DOTS.length % 3).toBe(0);
    for (let i = 0; i < LAND_DOTS.length; i += 3) {
      expect(Math.hypot(LAND_DOTS[i], LAND_DOTS[i + 1], LAND_DOTS[i + 2])).toBeCloseTo(1, 5);
    }
  });

  it('has a plausible number of land points at the grid spacing', () => {
    const count = LAND_DOTS.length / 3;
    expect(count).toBeGreaterThan(1200);
    expect(count).toBeLessThan(3000);
  });

  it.each([
    ['Zagreb, Croatia', 45.8, 15.98],
    ['the Sahara', 23, 10],
    ['central Canada', 56, -106],
    ['India', 20.6, 79],
    ['Australia', -25.3, 133.8],
  ])('has a land dot near %s', (_, lat, lon) => {
    expect(nearestDotDeg(lat, lon)).toBeLessThan(3);
  });

  it.each([
    ['mid Pacific', 0, -150],
    ['southern Indian Ocean', -40, 80],
    ['North Atlantic', 40, -40],
  ])('has no land dot near the %s', (_, lat, lon) => {
    expect(nearestDotDeg(lat, lon)).toBeGreaterThan(5);
  });
});
