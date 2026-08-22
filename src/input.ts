import { v, type Vec } from "./util";

/**
 * Maps DOM pointer/keyboard events on the canvas to world coordinates.
 * The canvas internal resolution equals the world size, so the mapping is a
 * simple scale through the element's bounding rect.
 *
 * Pointer gestures:
 *  - a left press that stays put becomes a CLICK on release (one-shot flag);
 *  - a left/middle press that moves more than a few px becomes a DRAG — the
 *    accumulated canvas-space delta is consumed per frame for map panning,
 *    and no click is fired;
 *  - the mouse wheel is accumulated and consumed per frame for zooming.
 */
export class Input {
  world: Vec = v(0, 0);
  down = false;
  rightDown = false;
  keys = new Set<string>();

  /** True while an active press is being dragged (map panning). */
  get dragging(): boolean {
    return this._dragging;
  }

  /** A press counts as a drag once it moves this far (canvas px). */
  private static readonly DRAG_THRESHOLD = 6;

  private _pressed = false;
  private _rightPressed = false;
  private _pending = false; // left press that may still become a click
  private _dragging = false;
  private _pressStart: Vec | null = null;
  private _panDx = 0;
  private _panDy = 0;
  private _wheel = 0;

  private canvas: HTMLCanvasElement;
  private onDown: (e: PointerEvent) => void;
  private onMove: (e: PointerEvent) => void;
  private onUp: (e: PointerEvent) => void;
  private onKey: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onCtx: (e: Event) => void;
  private onWheel: (e: WheelEvent) => void;
  private onBlur: () => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const setWorld = (cx: number, cy: number) => {
      const r = this.canvas.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      this.world.x = ((cx - r.left) / r.width) * this.canvas.width;
      this.world.y = ((cy - r.top) / r.height) * this.canvas.height;
    };

    this.onDown = (e) => {
      setWorld(e.clientX, e.clientY);
      if (e.button === 2) {
        this.rightDown = true;
        this._rightPressed = true;
      } else {
        this.down = e.button === 0;
        // Left and middle presses both arm the pan drag; only a left press
        // that never moves turns into a click.
        this._pressStart = v(this.world.x, this.world.y);
        this._dragging = false;
        this._pending = e.button === 0;
      }
    };
    this.onMove = (e) => {
      const prevX = this.world.x;
      const prevY = this.world.y;
      setWorld(e.clientX, e.clientY);
      const panning = this.down || (e.buttons & 4) !== 0;
      if (!panning || !this._pressStart) return;
      if (!this._dragging) {
        const dx = this.world.x - this._pressStart.x;
        const dy = this.world.y - this._pressStart.y;
        if (dx * dx + dy * dy > Input.DRAG_THRESHOLD ** 2) {
          this._dragging = true;
          this._pending = false; // it was a drag, not a click
        }
      }
      if (this._dragging) {
        this._panDx += this.world.x - prevX;
        this._panDy += this.world.y - prevY;
      }
    };
    this.onUp = (e) => {
      if (e.button === 2) {
        this.rightDown = false;
        return;
      }
      if (e.button === 1) {
        // Middle released: if the left press is still active, keep panning.
        if (this.down) this._pressStart = v(this.world.x, this.world.y);
        else {
          this._dragging = false;
          this._pressStart = null;
        }
        return;
      }
      // Left released: a press that never dragged becomes the click.
      this.down = false;
      if (this._pending && !this._dragging) this._pressed = true;
      this._pending = false;
      this._dragging = false;
      this._pressStart = null;
    };
    this.onKey = (e) => {
      // Avoid the page scrolling / browser shortcuts while playing.
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code))
        e.preventDefault();
      this.keys.add(e.code);
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onCtx = (e) => e.preventDefault();
    this.onWheel = (e) => {
      e.preventDefault();
      this._wheel += e.deltaY;
    };
    this.onBlur = () => {
      this.keys.clear();
      this.down = false;
      this.rightDown = false;
      this._pending = false;
      this._dragging = false;
      this._pressStart = null;
    };

    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    canvas.addEventListener("contextmenu", this.onCtx);
    canvas.addEventListener("wheel", this.onWheel, { passive: false });
    window.addEventListener("blur", this.onBlur);
  }

  /** Returns true once per left press released without dragging, then clears. */
  consumeClick(): boolean {
    const p = this._pressed;
    this._pressed = false;
    return p;
  }

  consumeRightClick(): boolean {
    const p = this._rightPressed;
    this._rightPressed = false;
    return p;
  }

  /** Accumulated pan delta in canvas px since the last frame; zero at rest. */
  consumePan(): { x: number; y: number } {
    const p = { x: this._panDx, y: this._panDy };
    this._panDx = 0;
    this._panDy = 0;
    return p;
  }

  /** Accumulated wheel delta since the last frame; zero at rest. */
  consumeWheel(): number {
    const w = this._wheel;
    this._wheel = 0;
    return w;
  }

  key(code: string): boolean {
    return this.keys.has(code);
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("keyup", this.onKeyUp);
    this.canvas.removeEventListener("contextmenu", this.onCtx);
    this.canvas.removeEventListener("wheel", this.onWheel);
    window.removeEventListener("blur", this.onBlur);
  }
}
