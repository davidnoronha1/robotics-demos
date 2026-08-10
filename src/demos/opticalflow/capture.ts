/** Inner grayscale capture: draws a <video> into a fixed-size offscreen
 * canvas using a *cover* crop (so portrait phone feeds, wide clips, etc. all
 * fill the same 4:3 buffer without letterboxing), reads the pixels back, and
 * converts to a reusable Uint8Array grayscale buffer. The un-rendered gray
 * buffer is what every detector/tracker consumes. */

export class GrayscaleCapture {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** RGBA of the last cover-cropped frame (same layout as `gray`, ×4) — kept
   * around for consumers that want color, e.g. the hover loupe. */
  color: Uint8ClampedArray = new Uint8ClampedArray(0);

  constructor(
    private readonly w: number,
    private readonly h: number,
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2D context unavailable");
    this.ctx = ctx;
  }

  /** Cover-crop `video` into `out` (a reused length-w·h buffer).
   * Returns false if the video has no decodable frame yet. */
  grab(video: HTMLVideoElement, out: Uint8Array, mirrored: boolean): boolean {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw === 0 || vh === 0 || video.readyState < 2) return false;

    const { w, h, ctx } = this;
    const scale = Math.max(w / vw, h / vh);
    const sw = w / scale;
    const sh = h / scale;
    const sx = (vw - sw) / 2;
    const sy = (vh - sh) / 2;

    ctx.save();
    ctx.clearRect(0, 0, w, h);
    if (mirrored) {
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
    ctx.restore();

    const data = ctx.getImageData(0, 0, w, h).data;
    this.color = data;
    for (let i = 0, j = 0; i < data.length; i += 4, j++) {
      out[j] = (data[i]! * 77 + data[i + 1]! * 150 + data[i + 2]! * 29) >> 8;
    }
    return true;
  }
}