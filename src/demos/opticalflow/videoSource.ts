/** A frame source: either the user's webcam or the bundled fallback clip.
 * Both provide a <video> element (the live preview the overlay sits on top
 * of) and can be stopped. The pipeline only ever talks to this interface, so
 * the demo works the same — and the rendering/controller code doesn't care
 * where pixels come from. */
export interface VideoSource {
  readonly kind: "camera" | "clip";
  readonly el: HTMLVideoElement;
  /** Start capture; resolves to false when the source can't be started
   * (permission denied, no camera, blocked autoplay). */
  start(): Promise<boolean>;
  stop(): void;
}

function makeVideo(): HTMLVideoElement {
  const el = document.createElement("video");
  el.className = "of-video";
  el.playsInline = true;
  el.autoplay = true;
  el.muted = true;
  el.loop = true;
  el.controls = true;
  el.setAttribute("muted", "");
  return el;
}

/** The user's camera (rear on phones via facingMode: "environment"). */
export class CameraSource implements VideoSource {
  readonly kind = "camera" as const;
  readonly el: HTMLVideoElement = makeVideo();
  private stream: MediaStream | null = null;

  static supported(): boolean {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  }

  async start(): Promise<boolean> {
    if (!CameraSource.supported()) return false;
    try {
      const stream = await navigator.mediaDevices!.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 640 },
          height: { ideal: 480 },
        },
        audio: false,
      });
      this.stream = stream;
      this.el.srcObject = stream;
      await this.el.play();
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.el.srcObject = null;
  }
}

/** The bundled demo clip — the graceful desktop fallback, and the default so
 * the demo demos itself without asking for a camera. */
export class ClipSource implements VideoSource {
  readonly kind = "clip" as const;
  readonly el: HTMLVideoElement = makeVideo();

  constructor(private readonly url: string) {}

  async start(): Promise<boolean> {
    this.el.src = this.url;
    try {
      await this.el.play();
      return true;
    } catch {
      return false;
    }
  }

  stop(): void {
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
  }
}