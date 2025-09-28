/// <reference types="@webgpu/types" />
import { color_arr, type vec2 } from '../../rompack/rompack';
import type { TextureSource } from 'bmsx/core/platform';
import { WebGLBackend } from './webgl/webgl_backend';
import { WebGPUBackend } from './webgpu/webgpu_backend';

// Minimal, unified render interfaces for both backends

export type TextureFormat = 'rgba8unorm' | 'bgra8unorm' | 'rgb8unorm' | 'depth24plus' | 'depth32float' | string | number;
export type TextureHandle = WebGLTexture | GPUTexture;
export type BufferHandle = WebGLBuffer | GPUBuffer | unknown;
// ---- Unified "FBO" a.k.a. render target ------------------------------------

export type RenderTargetHandle =
	| WebGLFramebuffer               // persistent GL object
	| {
		size: vec2;
		colors: GPUTexture[];                // textures you own
		depth?: GPUTexture;
		colorViews: GPUTextureView[];        // pre-created views for speed
		depthView?: GPUTextureView;
		sampleCount?: number;
		format?: GPUTextureFormat;           // optional bookkeeping
	};

// keep your existing alias names for other handles:

export interface TextureParams {
	size?: vec2;
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
	| 'frame_shared'
	| 'frame_resolve'
	| 'axis_gizmo';

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
	depthTest?: boolean;   // pipeline uses depth testing (may be read-only)
	depthWrite?: boolean;  // pipeline writes depth (separate from writesDepth graph hint)
	stateOnly?: boolean;
	present?: boolean;
	shouldExecute?(): boolean;
	/**
	 * Optional one-time initializer to create permanent GPU resources for this pass
	 * (e.g., buffers, VAOs, default textures). Called once at registration time.
	 */
	bootstrap?: (backend: GPUBackend) => void;
	exec: (backend: AnyBackend, fbo: unknown, state: S | undefined) => void;
	prepare?: (backend: GPUBackend, state: S | undefined) => void;
}

// Minimal shader build description for backend pipeline creation
export interface GraphicsPipelineBuildDesc {
	label?: string;
	vsCode?: string;
	fsCode?: string;
	bindingLayout?: GraphicsPipelineBindingLayout;
	// Hints for backend pipeline creation
	usesDepth?: boolean; // when true, pipeline includes depth-stencil state matching render pass
	depthTest?: boolean; // enable depth testing in pipeline
	depthWrite?: boolean; // enable depth writes in pipeline
}

export interface RenderPassInstanceHandle { id: number; label?: string; backendData?: unknown }

export interface PassEncoder { fbo: unknown; desc: RenderPassDesc; }

export type AnyBackend = WebGLBackend | WebGPUBackend | GPUBackend;

export interface GPUBackend {
	// Discriminator for runtime backend flavor
	type: 'webgl2' | 'webgpu' | 'headless';

	// Optional WebGL-like texture binding helpers (implemented by WebGL backend).
	// These allow higher-level code (GameView / render graph) to perform texture
	// binds without casting to a concrete backend type.
	setActiveTexture?(unit: number): void;
	bindTexture2D?(tex: TextureHandle | null): void;
	bindTextureCube?(tex: TextureHandle | null): void;

	createTexture(src: TextureSource, desc: TextureParams): TextureHandle;
	createSolidTexture2D(width: number, height: number, rgba: color_arr, desc?: TextureParams): TextureHandle;
	createCubemapFromSources(faces: readonly [TextureSource, TextureSource, TextureSource, TextureSource, TextureSource, TextureSource], desc: TextureParams): TextureHandle;
	createSolidCubemap(size: number, rgba: color_arr, desc: TextureParams): TextureHandle;
	createCubemapEmpty(size: number, desc: TextureParams): TextureHandle;
	uploadCubemapFace(cubemap: TextureHandle, face: number, src: TextureSource): void;
	destroyTexture(handle: TextureHandle): void;
	createColorTexture(desc: { width: number; height: number; format?: TextureFormat }): TextureHandle;
	createDepthTexture(desc: { width: number; height: number; format?: TextureFormat }): TextureHandle;
	createRenderTarget(color?: TextureHandle | null, depth?: TextureHandle | null): RenderTargetHandle;
	clear(opts: { color?: color_arr; depth?: number }): void;
	beginRenderPass(desc: RenderPassDesc): PassEncoder;
	endRenderPass(pass: PassEncoder): void;
	getCaps(): BackendCaps;
	transitionTexture?(tex: TextureHandle, fromLayout: string | undefined, toLayout: string): void;
	createRenderPassInstance?(desc: GraphicsPipelineBuildDesc): RenderPassInstanceHandle;
	destroyRenderPassInstance?(p: RenderPassInstanceHandle): void;
	setGraphicsPipeline?(pass: PassEncoder, pipeline: RenderPassInstanceHandle): void;
	draw(pass: PassEncoder, first: number, count: number): void;
	drawIndexed(pass: PassEncoder, indexCount: number, firstIndex?: number, indexType?: number): void;
	setPassState<S = unknown>(label: RenderPassId, state: S): void;
	getPassState<S = unknown>(label: RenderPassId): S | undefined;

	// Optional buffer/VAO helpers (WebGL-backed today; WebGPU mapping later)
	createVertexBuffer?(data: ArrayBufferView, usage: 'static' | 'dynamic'): BufferHandle;
	updateVertexBuffer?(buf: BufferHandle, data: ArrayBufferView, dstOffset?: number): void;
	bindArrayBuffer?(buf: BufferHandle | null): void;
	createVertexArray?(): unknown;
	bindVertexArray?(vao: unknown | null): void;
	deleteVertexArray?(vao: unknown | null): void;

	// Backend-agnostic attribute convenience wrappers (avoid GL enums in pipeline code)
	setAttribPointerFloat?(index: number, size: number, stride: number, offset: number): void;
	setAttribIPointerU8?(index: number, size: number, stride: number, offset: number): void;
	setAttribIPointerU16?(index: number, size: number, stride: number, offset: number): void;

	// Optional draw helpers
	drawInstanced?(pass: PassEncoder, vertexCount: number, instanceCount: number, firstVertex?: number, firstInstance?: number): void;
	drawIndexedInstanced?(pass: PassEncoder, indexCount: number, instanceCount: number, firstIndex?: number, baseVertex?: number, firstInstance?: number, indexType?: number): void;

	// Optional uniform buffer helpers (WebGL backed today)
	createUniformBuffer(byteSize: number, usage: 'static' | 'dynamic'): BufferHandle;
	updateUniformBuffer(buf: BufferHandle, data: ArrayBufferView, dstByteOffset?: number): void;
	bindUniformBufferBase(bindingIndex: number, buf: BufferHandle): void;

	// Optional per-frame hooks + stats
	beginFrame(): void;
	endFrame(): void;
	getFrameStats(): { draws: number; drawIndexed: number; drawsInstanced: number; drawIndexedInstanced: number; bytesUploaded: number } | undefined;
	// Optional: fine-grained upload accounting for HUD
	accountUpload(kind: 'vertex' | 'index' | 'uniform' | 'texture', bytes: number): void;
}

export interface RenderPassStateRegistry {
	['skybox']: unknown;
	['meshbatch']: unknown;
	['particles']: unknown;
	['sprites']: unknown;
	['crt']: unknown;
	['frame_shared']: unknown;
	['frame_resolve']: unknown;
	['axis_gizmo']: unknown;
	['debug_solid']: unknown;
}
export type RenderPassStateId = keyof RenderPassStateRegistry;

export interface RenderContext {
	viewportSize: { x: number; y: number };
	backendType: 'webgl2' | 'webgpu' | 'headless';
	offscreenCanvasSize: { x: number; y: number; };
	backend: GPUBackend;
	activeTexUnit: number | null;
	bind2DTex(tex: TextureHandle | null): void;
	bindCubemapTex(tex: TextureHandle | null): void;
	// Optional centralized renderer submission + queues (lightweight, backend-agnostic)
	renderer?: { queues?: { [k: string]: unknown }; submit?: unknown; swap?: () => void };
}
