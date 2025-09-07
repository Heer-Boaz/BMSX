// Global ambient typings for engine/runtime interop across browser and Node-like contexts
declare global {
  // Alias commonly used in the codebase; map to the standard globalThis
  var global: typeof globalThis;

  // Note: Node's `Buffer` is provided by `@types/node` when present. Avoid declaring a duplicate alias here.

  // Vendor-prefixed fullscreen APIs (optional at runtime)
  interface Document {
    webkitFullscreenEnabled?: boolean;
    webkitFullScreenEnabled?: boolean;
    mozFullScreenEnabled?: boolean;
    webkitExitFullscreen?: () => Promise<void> | void;
    mozExitFullScreen?: () => Promise<void> | void;
  }

  interface HTMLElement {
    mozRequestFullScreen?: () => Promise<void> | void;
    webkitRequestFullScreen?: () => Promise<void> | void; // Note: This is a vendor-prefixed version of the standard requestFullscreen method.
    webkitRequestFullscreen?: () => Promise<void> | void; // Note: This is a slightly different vendor-prefixed version (i.e. "screen" vs "Screen").
  }

  interface Window {
    isFullScreen?: boolean;
  }
}

export { };
