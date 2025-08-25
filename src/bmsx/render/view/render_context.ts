import { GPUBackend } from '../backend/interfaces';

// Minimal structural typing contract pipelines/backends rely on.
// Kept intentionally small to avoid coupling to full RenderView implementation.
export type RenderContext = {
    glctx: WebGL2RenderingContext;
    offscreenCanvasSize: { x: number; y: number };
    getBackend(): GPUBackend;
    activeTexUnit: number | null;
    bind2DTex(tex: WebGLTexture | null): void;
    bindCubemapTex(tex: WebGLTexture | null): void;
};
