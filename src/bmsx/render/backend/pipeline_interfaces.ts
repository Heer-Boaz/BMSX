/// <reference types="@webgpu/types" />
import { Size } from '../../rompack/rompack';

// Minimal, unified render interfaces for both backends

export type TextureFormat = 'rgba8unorm' | 'bgra8unorm' | 'rgb8unorm' | 'depth24plus' | 'depth32float' | string | number;
export type TextureHandle = WebGLTexture | GPUTexture;

export interface TextureParams {
    size?: Size;
    wrapS?: number;
    wrapT?: number;
    minFilter?: number;
    magFilter?: number;
}

// High-level render pass identifiers
export type RenderPassId =
    | 'skybox'
    | 'meshbatch'
    | 'particles'
    | 'sprites'
    | 'crt'
    | 'fog'
    | 'frame_shared';

export interface BackendCaps { maxColorAttachments: number; }

// Optional shader resource layout description (for WebGPU or future WebGL wrappers)
export interface GraphicsPipelineBindingLayout {
    uniforms?: string[];
    textures?: { name: string }[];
    samplers?: { name: string }[];
    buffers?: { name: string; size: number; usage: 'uniform' | 'storage' }[];
}

// Attachments for a render pass instance (runtime execution)
export interface ColorAttachmentSpec { tex: TextureHandle; clear?: [number, number, number, number]; discardAfter?: boolean }
export interface DepthAttachmentSpec { tex: TextureHandle; clearDepth?: number; discardAfter?: boolean }
export interface RenderPassDesc { label?: string; color?: ColorAttachmentSpec; colors?: ColorAttachmentSpec[]; depth?: DepthAttachmentSpec }

// Definition of a logical pass (registration-time)
export interface RenderPassDef {
    id: RenderPassStateId;
    label?: string;
    vsCode?: string;
    fsCode?: string;
    bindingLayout?: GraphicsPipelineBindingLayout;
    name: string;
    writesDepth?: boolean;
    stateOnly?: boolean;
    present?: boolean;
    shouldExecute?(): boolean;
    exec: (backend: GPUBackend, fbo: unknown, state: unknown) => void;
    prepare?: (backend: GPUBackend, state: unknown) => void;
}

// Minimal shader build description for backend pipeline creation
export interface GraphicsPipelineBuildDesc {
    label?: string;
    vsCode?: string;
    fsCode?: string;
    bindingLayout?: GraphicsPipelineBindingLayout;
}

export interface RenderPassInstanceHandle { id: number; label?: string; backendData?: unknown }

export interface PassEncoder { fbo: unknown; desc: RenderPassDesc; }

export interface GPUBackend {
    createTextureFromImage(img: ImageBitmap, desc: TextureParams): TextureHandle;
    createCubemapFromImages(faces: readonly [ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap], desc: TextureParams): TextureHandle;
    createSolidCubemap(size: number, rgba: [number, number, number, number], desc: TextureParams): TextureHandle;
    createCubemapEmpty(size: number, desc: TextureParams): TextureHandle;
    uploadCubemapFace(cubemap: TextureHandle, face: number, img: ImageBitmap): void;
    destroyTexture(handle: TextureHandle): void;
    createColorTexture(desc: { width: number; height: number; format?: TextureFormat }): TextureHandle;
    createDepthTexture(desc: { width: number; height: number; format?: TextureFormat }): TextureHandle;
    createFBO(color?: TextureHandle | null, depth?: TextureHandle | null): unknown;
    bindFBO(fbo: unknown): void;
    clear(opts: { color?: [number, number, number, number]; depth?: number }): void;
    beginRenderPass(desc: RenderPassDesc): PassEncoder;
    endRenderPass(pass: PassEncoder): void;
    getCaps(): BackendCaps;
    transitionTexture?(tex: TextureHandle, fromLayout: string | undefined, toLayout: string): void;
    createRenderPassInstance?(desc: GraphicsPipelineBuildDesc): RenderPassInstanceHandle;
    destroyRenderPassInstance?(p: RenderPassInstanceHandle): void;
    setGraphicsPipeline?(pass: PassEncoder, pipeline: RenderPassInstanceHandle): void;
    draw?(pass: PassEncoder, first: number, count: number): void;
    drawIndexed?(pass: PassEncoder, indexCount: number, firstIndex?: number): void;
    setPassState?<S = unknown>(label: RenderPassId, state: S): void;
    executePass?(label: RenderPassId, fbo: unknown): void;
    getPassState?<S = unknown>(label: RenderPassId): S | undefined;
}

export interface RenderPassStateRegistry {
    ['skybox']: unknown;
    ['meshbatch']: unknown;
    ['particles']: unknown;
    ['sprites']: unknown;
    ['crt']: unknown;
    ['fog']: unknown;
    ['frame_shared']: unknown;
}
export type RenderPassStateId = keyof RenderPassStateRegistry;

export interface RenderContext {
    viewportSize: { x: number; y: number };
    backendType: 'webgl2' | 'webgpu';
    offscreenCanvasSize: { x: number; y: number; };
    getBackend(): GPUBackend;
    activeTexUnit: number | null;
    bind2DTex(tex: TextureHandle | null): void;
    bindCubemapTex(tex: TextureHandle | null): void;
}
