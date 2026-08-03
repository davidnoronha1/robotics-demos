/** Keeps a stream of wrapped angles (degrees, from atan2) continuous by
 * tracking cumulative revolutions — without this, a plotted yaw/roll curve
 * snaps vertically every time the raw angle crosses the ±180° seam. */
export class AngleUnwrap {
  private last: number | null = null;
  private cumulative = 0;

  next(rawDeg: number): number {
    if (this.last === null) {
      this.cumulative = rawDeg;
    } else {
      const delta = rawDeg - this.last;
      const wrapped = ((delta + 180) % 360 + 360) % 360 - 180;
      this.cumulative += wrapped;
    }
    this.last = rawDeg;
    return this.cumulative;
  }
}
