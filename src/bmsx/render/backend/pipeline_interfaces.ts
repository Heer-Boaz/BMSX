/// <reference types="@webgpu/types" />
import { color_arr, Size } from '../../rompack/rompack';

// Minimal, unified render interfaces for both backends

export type TextureFormat = 'rgba8unorm' | 'bgra8unorm' | 'rgb8unorm' | 'depth24plus' | 'depth32float' | string | number;
export type TextureHandle = WebGLTexture | GPUTexture;
export type BufferHandle = WebGLBuffer | GPUBuffer | unknown;

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
    | 'frame_shared'
    | 'frame_resolve';

export interface BackendCaps { maxColorAttachments: number; }

// Optional shader resource layout description (for WebGPU or future WebGL wrappers)
export interface GraphicsPipelineBindingLayout {
    uniforms?: string[];
    textures?: { name: string }[];
    samplers?: { name: string }[];
    buffers?: { name: string; size: number; usage: 'uniform' | 'storage' }[];
}

// Attachments for a render pass instance (runtime execution)
export interface ColorAttachmentSpec {
    tex: TextureHandle;
    clear?: color_arr;
    discardAfter?: boolean;
}

export interface DepthAttachmentSpec {
    tex: TextureHandle;
    clearDepth?: number;
    discardAfter?: boolean;
}
export interface RenderPassDesc {
    label?: string;
    color?: ColorAttachmentSpec;
    colors?: ColorAttachmentSpec[];
    depth?: DepthAttachmentSpec;
}

// Definition of a logical pass (registration-time)
export interface RenderPassDef<S = unknown> {
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
    /**
     * Optional one-time initializer to create permanent GPU resources for this pass
     * (e.g., buffers, VAOs, default textures). Called once at registration time.
     */
    bootstrap?: (backend: GPUBackend) => void;
    exec: (backend: GPUBackend, fbo: unknown, state: S | undefined) => void;
    prepare?: (backend: GPUBackend, state: S | undefined) => void;
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
    createSolidTexture2D(width: number, height: number, rgba: color_arr, desc?: TextureParams): TextureHandle;
    createCubemapFromImages(faces: readonly [ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap, ImageBitmap], desc: TextureParams): TextureHandle;
    createSolidCubemap(size: number, rgba: color_arr, desc: TextureParams): TextureHandle;
    createCubemapEmpty(size: number, desc: TextureParams): TextureHandle;
    uploadCubemapFace(cubemap: TextureHandle, face: number, img: ImageBitmap): void;
    destroyTexture(handle: TextureHandle): void;
    createColorTexture(desc: { width: number; height: number; format?: TextureFormat }): TextureHandle;
    createDepthTexture(desc: { width: number; height: number; format?: TextureFormat }): TextureHandle;
    createFBO(color?: TextureHandle | null, depth?: TextureHandle | null): unknown;
    bindFBO(fbo: unknown): void;
    clear(opts: {
        color?: color_arr;
    }): void;
    beginRenderPass(desc: RenderPassDesc): PassEncoder;
    endRenderPass(pass: PassEncoder): void;
    getCaps(): BackendCaps;
    transitionTexture?(tex: TextureHandle, fromLayout: string | undefined, toLayout: string): void;
    createRenderPassInstance?(desc: GraphicsPipelineBuildDesc): RenderPassInstanceHandle;
    destroyRenderPassInstance?(p: RenderPassInstanceHandle): void;
    setGraphicsPipeline?(pass: PassEncoder, pipeline: RenderPassInstanceHandle): void;
    draw?(pass: PassEncoder, first: number, count: number): void;
    drawIndexed?(pass: PassEncoder, indexCount: number, firstIndex?: number, indexType?: number): void;
    setPassState?<S = unknown>(label: RenderPassId, state: S): void;
    executePass?(label: RenderPassId, fbo: unknown): void;
    getPassState?<S = unknown>(label: RenderPassId): S | undefined;

    // Optional buffer/VAO helpers (WebGL-backed today; WebGPU mapping later)
    createVertexBuffer?(data: ArrayBufferView, usage: 'static' | 'dynamic'): BufferHandle;
    updateVertexBuffer?(buf: BufferHandle, data: ArrayBufferView, dstOffset?: number): void;
    bindArrayBuffer?(buf: BufferHandle | null): void;
    createVertexArray?(): unknown;
    bindVertexArray?(vao: unknown | null): void;
    deleteVertexArray?(vao: unknown | null): void;

    // Optional attribute helpers
    enableVertexAttrib?(index: number): void;
    disableVertexAttrib?(index: number): void;
    vertexAttribPointer?(index: number, size: number, type: number, normalized: boolean, stride: number, offset: number): void;
    vertexAttribDivisor?(index: number, divisor: number): void;
    vertexAttribIPointer?(index: number, size: number, type: number, stride: number, offset: number): void;
    vertexAttribI4ui?(index: number, x: number, y: number, z: number, w: number): void;
    bindElementArrayBuffer?(buf: BufferHandle | null): void;

    // Backend-agnostic attribute convenience wrappers (avoid GL enums in pipeline code)
    setAttribPointerFloat?(index: number, size: number, stride: number, offset: number): void;
    setAttribIPointerU8?(index: number, size: number, stride: number, offset: number): void;
    setAttribIPointerU16?(index: number, size: number, stride: number, offset: number): void;

    // Optional draw helpers
    drawInstanced?(pass: PassEncoder, vertexCount: number, instanceCount: number, firstVertex?: number, firstInstance?: number): void;
    drawIndexedInstanced?(pass: PassEncoder, indexCount: number, instanceCount: number, firstIndex?: number, baseVertex?: number, firstInstance?: number, indexType?: number): void;

    // Optional uniform buffer helpers (WebGL backed today)
    createUniformBuffer?(byteSize: number, usage: 'static' | 'dynamic'): BufferHandle;
    updateUniformBuffer?(buf: BufferHandle, data: ArrayBufferView, dstByteOffset?: number): void;
    bindUniformBufferBase?(bindingIndex: number, buf: BufferHandle): void;

    // Optional render state helpers
    setViewport?(vp: { x: number; y: number; w: number; h: number }): void;
    setCullEnabled?(enabled: boolean): void;
    setDepthMask?(write: boolean): void;
    setBlendEnabled?(enabled: boolean): void;
    setBlendFunc?(src: number, dst: number): void;

    // Optional texture binding for WebGPU
    bindTextureWithSampler?(texBinding: number, samplerBinding: number, texture: TextureHandle, samplerDesc?: { mag?: 'nearest' | 'linear'; min?: 'nearest' | 'linear'; wrapS?: 'clamp' | 'repeat'; wrapT?: 'clamp' | 'repeat' }): void;

    // Optional backend-native texture binding helpers (WebGL path caches state; WebGPU maps via bind groups)
    setActiveTexture?(unit: number): void;
    bindTexture2D?(tex: TextureHandle | null): void;
    bindTextureCube?(tex: TextureHandle | null): void;

    // Optional constant attribute helpers
    vertexAttrib2f?(index: number, x: number, y: number): void;
    vertexAttrib3f?(index: number, x: number, y: number, z: number): void;
    vertexAttrib4f?(index: number, x: number, y: number, z: number, w: number): void;

    // Optional uniform helpers (WebGL implemented; WebGPU may map to buffers)
    getAttribLocation?(name: string): number;
    setUniform1f?(name: string, v: number): void;
    setUniform1fv?(name: string, data: Float32Array): void;
    setUniform2fv?(name: string, data: Float32Array): void;
    setUniform1i?(name: string, v: number): void;
    setUniform3fv?(name: string, data: Float32Array): void;
    setUniformMatrix3fv?(name: string, data: Float32Array): void;
    setUniformMatrix4fv?(name: string, data: Float32Array): void;
    setUniform4f?(name: string, x: number, y: number, z: number, w: number): void;
    setUniformBlockBinding?(blockName: string, bindingIndex: number): void;

    // Optional per-frame hooks + stats
    beginFrame?(): void;
    endFrame?(): void;
    getFrameStats?(): { draws: number; drawIndexed: number; drawsInstanced: number; drawIndexedInstanced: number } | undefined;
}

export interface RenderPassStateRegistry {
    ['skybox']: unknown;
    ['meshbatch']: unknown;
    ['particles']: unknown;
    ['sprites']: unknown;
    ['crt']: unknown;
    ['fog']: unknown;
    ['frame_shared']: unknown;
    ['frame_resolve']: unknown;
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
    // Optional centralized renderer submission + queues (lightweight, backend-agnostic)
    renderer?: { queues?: { [k: string]: unknown }; submit?: unknown; swap?: () => void };
}
