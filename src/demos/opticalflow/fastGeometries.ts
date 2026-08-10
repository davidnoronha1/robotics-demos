/** Shared FAST geometry: the radius and the 16-pixel ring (Bresenham's circle
 * of radius 3). Exported separately so the detector and the magnified FAST
 * inset in the UI agree on exactly which pixels the test looks at. */

export const RADIUS = 3;

/** Clockwise, starting at (0, -3). Index 8 is the opposite of index 0. */
export const RING: ReadonlyArray<readonly [number, number]> = [
  [0, -3],
  [1, -3],
  [2, -2],
  [3, -1],
  [3, 0],
  [3, 1],
  [2, 2],
  [1, 3],
  [0, 3],
  [-1, 3],
  [-2, 2],
  [-3, 1],
  [-3, 0],
  [-3, -1],
  [-2, -2],
  [-1, -3],
];
