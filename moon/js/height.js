/* Measured terrain plus explicitly unresolved sub-grid relief. */
import { fbm } from './noise.js';
import { cratersAt, CRATER_DETAIL } from './craters.js';
import { massifH } from './massif.js';
import { elevationAt, hasElevation, measuredNearWeightAt } from './elevation.js';

export const MOON_RADIUS = 1737400;

// One site-centred tangent frame for terrain, feet and rocks. Moving a mesh
// must not move the lunar sphere or change the height of a fixed world point.
export function curveDrop(x, z) {
  return -(x * x + z * z) / (2 * MOON_RADIUS);
}

export function heightAt(x, z, detail = CRATER_DETAIL.NEAR) {
  let h = 0;

  const measured = hasElevation();
  h += measured ? elevationAt(x, z) : 3.8 * fbm(x / 430, z / 430, 4, 11);
  // Fine NAC already resolves these metre-to-decametre features; do not stamp
  // synthetic craters or broad waves on top of the measured landing-site relief.
  const unresolved = measured ? 1 - measuredNearWeightAt(x, z) : 1;
  h += unresolved * (1.4 * fbm(x / 68, z / 68, 3, 23)
    + 0.44 * fbm(x / 38, z / 38, 2, 131)
    + 0.20 * fbm(x / 15, z / 15, 2, 149));
  h += 0.06 * fbm(x / 4, z / 4, 2, 61);

  if (unresolved > 0) h += unresolved * cratersAt(x, z, detail, !measured);
  if (!measured) h += massifH(x, z);

  return h + curveDrop(x, z);
}
