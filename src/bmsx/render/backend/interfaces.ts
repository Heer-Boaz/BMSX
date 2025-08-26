// Backend interfaces extracted from legacy gpu_backend.ts for split architecture.
import { TextureHandle, TextureParams } from '../gpu_types';

export type PipelineId =
    | 'Skybox'
    | 'MeshBatch'
    | 'Particles'
    | 'Sprites'
    | 'CRT'
    | 'Fog'
    | 'FrameShared';

export interface BackendCaps { maxColorAttachments: number; }
export interface PipelineBindingLayout {
    uniforms?: string[];
    textures?: { name: string }[];
    samplers?: { name: string }[];
    buffers?: { name: string; size: number; usage: 'uniform' | 'storage' }[];
}
export interface PipelineDesc {
    label?: PipelineId | string;
    vsCode?: string;
    fsCode?: string;
    bindingLayout?: PipelineBindingLayout;
}
export interface PipelineHandle { id: number; label?: string }
export interface RenderPassDesc {
    // Backward compatible single color attachment (will mirror first element of colors[] if provided).
    color?: { tex: TextureHandle; clear?: [number, number, number, number]; discardAfter?: boolean };
    // Multi-Render-Target attachments. WebGL backend will currently only bind the first due to API limits.
    colors?: { tex: TextureHandle; clear?: [number, number, number, number]; discardAfter?: boolean }[];
    depth?: { tex: TextureHandle; clearDepth?: number; discardAfter?: boolean };
    label?: string;
}
export interface PassEncoder { fbo: unknown; desc: RenderPassDesc; _pipelineId?: number }

export interface GPUBackend {
    createTextureFromImage(img: ImageBitmap, desc: TextureParams): TextureHandle;
    createCubemapFromImages(faces: readonly [ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap], desc: TextureParams): TextureHandle;
    createSolidCubemap(size: number, rgba: [number, number, number, number], desc: TextureParams): TextureHandle;
    createCubemapEmpty(size: number, desc: TextureParams): TextureHandle;
    uploadCubemapFace(cubemap: TextureHandle, face: number, img: ImageBitmap): void;
    destroyTexture(handle: TextureHandle): void;
    createColorTexture(desc: { width: number; height: number; format?: GLenum }): TextureHandle;
    createDepthTexture(desc: { width: number; height: number }): TextureHandle;
    createFBO(color?: TextureHandle | null, depth?: TextureHandle | null): unknown;
    bindFBO(fbo: unknown): void;
    clear(opts: { color?: [number, number, number, number]; depth?: number }): void;
    beginRenderPass(desc: RenderPassDesc): PassEncoder;
    endRenderPass(pass: PassEncoder): void;
    getCaps(): BackendCaps;
    transitionTexture?(tex: TextureHandle, fromLayout: string | undefined, toLayout: string): void;
    createPipeline?(desc: PipelineDesc): PipelineHandle;
    destroyPipeline?(p: PipelineHandle): void;
    setPipeline?(pass: PassEncoder, pipeline: PipelineHandle): void;
    draw?(pass: PassEncoder, first: number, count: number): void;
    drawIndexed?(pass: PassEncoder, indexCount: number, firstIndex?: number): void;
    setPipelineState?<S = unknown>(label: PipelineId, state: S): void;
    executePipeline?(label: PipelineId, fbo: unknown): void;
    getPipelineState?<S = unknown>(label: PipelineId): S | undefined;
    buildProgram?(vsSource: string, fsSource: string, label: string): WebGLProgram | null; // convenience for legacy modules
}

export interface PipelineStateRegistry {
    ['Skybox']: { view: Float32Array; proj: Float32Array; tex: WebGLTexture; width?: number; height?: number };
    ['MeshBatch']: { width: number; height: number; view: { camPos: { x: number; y: number; z: number }; viewProj: Float32Array }; fog?: any; lighting?: any };
    ['Particles']: { width: number; height: number; viewProj: Float32Array; camRight: Float32Array; camUp: Float32Array };
    ['Sprites']: { width: number; height: number };
    ['CRT']: { width: number; height: number };
    ['Fog']: { width: number; height: number; fog: any };
    FrameShared: { view: any; lighting: any };
}

export class WebGPUBackendStub implements GPUBackend {
    constructor(private device: unknown) { }
    private unimpl<T = never>(): T { throw new Error('WebGPUBackendStub not implemented'); }
    createTextureFromImage(): never { return this.unimpl(); }
    createCubemapFromImages(): never { return this.unimpl(); }
    createSolidCubemap(): never { return this.unimpl(); }
    createCubemapEmpty(): never { return this.unimpl(); }
    uploadCubemapFace(): never { return this.unimpl(); }
    destroyTexture(): void { }
    createColorTexture(): never { return this.unimpl(); }
    createDepthTexture(): never { return this.unimpl(); }
    createFBO(): never { return this.unimpl(); }
    bindFBO(): void { }
    clear(): void { }
    beginRenderPass(desc: RenderPassDesc): PassEncoder { return { fbo: null, desc }; }
    endRenderPass(): void { }
    getCaps(): BackendCaps { return { maxColorAttachments: 1 }; }
}