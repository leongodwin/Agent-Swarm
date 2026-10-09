import { useStore } from '../store';
import { isConfirmOpen } from '../ui/Confirm';
let canvas: HTMLCanvasElement | null = null;
export const setLookCanvas = (value: HTMLCanvasElement | null) => { canvas = value; };
function lockPointer(el: HTMLCanvasElement, options?: PointerLockOptions): Promise<void> | undefined {
  try { return el.requestPointerLock?.(options); } catch { return undefined; }
}
/** Kept independent of the renderer so the welcome screen does not preload Three.js. */
export function requestLook() {
  const state = useStore.getState();
  if (!canvas || state.overlay || !state.started || isConfirmOpen()) return;
  const element = canvas;
  lockPointer(element, { unadjustedMovement: true })?.catch?.((err: unknown) => {
    if (err instanceof DOMException && err.name === 'NotSupportedError') lockPointer(element)?.catch?.(() => {});
  });
}
