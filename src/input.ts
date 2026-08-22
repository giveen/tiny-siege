import { v, type Vec } from "./util";

/**
 * Maps DOM pointer/keyboard events on the canvas to world coordinates.
 * The canvas internal resolution equals the world size, so the mapping is a
 * simple scale through the element's bounding rect.
 */
export class Input {
  world: Vec = v(0, 0);
  down = false;
  rightDown = false;
  private _pressed = false;
  private _rightPressed = false;
  keys = new Set<string>();

  private canvas: HTMLCanvasElement;
  private onDown: (e: PointerEvent) => void;
  private onMove: (e: PointerEvent) => void;
  private onUp: (e: PointerEvent) => void;
  private onKey: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onCtx: (e: Event) => void;
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
        this.down = true;
        this._pressed = true;
      }
    };
    this.onMove = (e) => setWorld(e.clientX, e.clientY);
    this.onUp = (e) => {
      if (e.button === 2) this.rightDown = false;
      else this.down = false;
    };
    this.onKey = (e) => {
      // Avoid the page scrolling / browser shortcuts while playing.
      if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code))
        e.preventDefault();
      this.keys.add(e.code);
    };
    this.onKeyUp = (e) => this.keys.delete(e.code);
    this.onCtx = (e) => e.preventDefault();
    this.onBlur = () => {
      this.keys.clear();
      this.down = false;
      this.rightDown = false;
    };

    canvas.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("keyup", this.onKeyUp);
    canvas.addEventListener("contextmenu", this.onCtx);
    window.addEventListener("blur", this.onBlur);
  }

  /** Returns true once per left press, then clears. */
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
    window.removeEventListener("blur", this.onBlur);
  }
}
