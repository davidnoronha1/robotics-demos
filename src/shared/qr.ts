import qrcode from "qrcode-generator";

/** "Scan to try on your phone" affordance, shared by the demos. Rendered
 * locally on canvas — no external image service, so it works offline and
 * doesn't leak the visited URL to a third party. */
export function buildQrAffordance(opts: { url: string; text: string }): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "demo-qr";

  const qr = qrcode(0, "M");
  qr.addData(opts.url);
  qr.make();

  const cellSize = 4;
  const margin = 2;
  const size = (qr.getModuleCount() + margin * 2) * cellSize;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = "#000";
    for (let row = 0; row < qr.getModuleCount(); row++) {
      for (let col = 0; col < qr.getModuleCount(); col++) {
        if (qr.isDark(row, col)) {
          ctx.fillRect((col + margin) * cellSize, (row + margin) * cellSize, cellSize, cellSize);
        }
      }
    }
  }

  const text = document.createElement("span");
  text.textContent = opts.text;

  wrap.append(canvas, text);
  return wrap;
}
