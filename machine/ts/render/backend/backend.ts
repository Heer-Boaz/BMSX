import { type color_arr, type TextureSource, type vec2 } from '../../rompack/format';
import type { GxGpu } from '../../machine/devices/gx/gpu';
import type { GxGpuCommandBufferView } from '../../machine/devices/gx/gpu_command_buffer';
import type { Host2DSubmission } from '../shared/submissions';
import type { GameView } from '../gameview';
import type { DeviceQuantizeMode } from '../post/device_quantize/mode';
import type { TextureParams } from './texture_params';
import type { RenderPassLibrary } from './pass/library';

/*
 * TS/C++ parity boundary:
 * - Shared runtime contract in this file: TextureHandle, BackendCaps,
 *   ColorAttachmentSpec, DepthAttachmentSpec, RenderPassDesc, PassEncoder,
 *   GPUBackend texture methods, render-pass methods, draw methods except TS
 *   drawIndexed indexType, GX VRAM snapshot capture, frame lifecycle, getCaps(),
 *   and stats.
 * - Shared render semantics above this boundary are GX GPU command buffers.
 *   Concrete WebGL/GLES pass code owns GPU API binding such as shader
 *   programs, VAO/buffer state, vertexAttribPointer calls, uniform block
 *   binding, texture units, and draw-call issue.
 * - TS-only public symbols here are browser/WebGL render-graph plumbing:
 *   TextureFormat, BufferHandle, BackendContext, RenderTargetHandle,
 *   PresentationMode, GraphicsPipelineBindingLayout, RenderGraphSlot,
 *   RenderGraphPassContext, RenderPassGraphDef, RenderPassDef,
 *   GraphicsPipelineBuildDesc, RenderPassInstanceHandle,
 *   RenderPassStateRegistry, RenderPassStateId, pipeline-state types, and
 *   RenderContext.
 *   C++ owns the equivalent native pass scheduling in render/backend/pass files.
 * - TS-only GPUBackend methods here are browser/backend-resource controls:
 *   createImageBitmapFromSource(), createCubemapFromSources(),
 *   createSolidCubemap(), createCubemapEmpty(), uploadCubemapFace(),
 *   createColorTexture(), createDepthTexture(), createRenderTarget(),
 *   createRenderPassInstance(),
 *   destroyRenderPassInstance(), setGraphicsPipeline(), setPassState(),
 *   getPassState(), createVertexBuffer(), updateVertexBuffer(),
 *   bindArrayBuffer(), createVertexArray(), bindVertexArray(),
 *   deleteVertexArray(), drawInstanced(), drawIndexedInstanced(),
 *   createUniformBuffer(), updateUniformBuffer(), bindUniformBufferBase(), and
 *   accountUpload(). TS drawIndexed also carries WebGL indexType because WebGL
 *   drawElements needs the index-buffer scalar format at the backend boundary.
 *   C++ exposes these responsibilities on concrete native backends and pass
 *   owners instead of the common interface. There is intentionally no
 *   GPUBackend vertex-layout API; attribute packing and pointer setup belong to
 *   concrete pass code.
 * - C++-only public symbols in backend.h are C++/libretro backend storage
 *   and ownership: BackendType, FrameStats, SoftwareTexture, DitherParams,
 *   SoftwareBackend, readyForTextureUpload(), and native render-target
 *   activation for the C++ render graph.
 * - TS synchronous texture readback is concrete-backend owned; headless keeps
 *   readTextureRegion for capture workflows, while WebGPU cannot expose that
 *   synchronous contract.
 */

export type TextureFormat = 'rgba8unorm' | 'bgra8unorm' | 'rgb8unorm' | 'depth24plus' | 'depth32float' | string | number;
export type HeadlessTextureHandle = { id: number; kind: string };
export type HeadlessBufferHandle = { id: number; kind: string };
export type TextureHandle = WebGLTexture | GPUTexture | HeadlessTextureHandle;
export type BufferHandle = WebGLBuffer | HeadlessBufferHandle | null;
export type BackendContext = WebGL2RenderingContext | GPUCanvasContext | null;
export type SizedArrayBufferView = ArrayBufferView & { readonly BYTES_PER_ELEMENT?: number; readonly length?: number };
// ---- Unified "FBO" a.k.a. render target ------------------------------------

export type HeadlessRenderTargetHandle = {
	size: vec2;
	colors: TextureHandle[];
	depth?: TextureHandle;
};
export type WebGPURenderTargetHandle = {
	color?: TextureHandle;
	depth?: TextureHandle;
};

export type RenderTargetHandle = WebGLFramebuffer | HeadlessRenderTargetHandle | WebGPURenderTargetHandle;

// keep your existing alias names for other handles:

// High-level render pass identifiers
export type RenderPassId =
	| 'gx_gpu'
	| 'host_overlay'
	| 'host_menu'
	| 'device_quantize'
	| 'presentation_history_a'
	| 'presentation_history_b'
	| 'present'
	| 'crt'
	| 'frame_resolve';

export interface BackendCaps {
	maxColorAttachments: number;
	maxTextureSize: number;
	supportsInstancing: boolean;
	supportsDepthTexture: boolean;
	supportsCorePresentation: boolean;
}
export type PresentationMode = 'partial' | 'completed';

// Shader resource binding description. This is not a vertex layout contract;
// concrete WebGL/GLES pass code binds vertex attributes directly.
export interface GraphicsPipelineBindingLayout {
	uniforms?: string[];
	textures?: { name: string }[];
	samplers?: { name: string }[];
	buffers?: { name: string; size: number; usage: 'uniform' | 'storage' }[];
}

export type RenderGraphSlot = 'frame_color' | 'frame_depth' | 'frame_history_a' | 'frame_history_b' | 'device_color';

export interface RenderGraphPassContext {
	view: RenderContext;
	frameIndex: number;
	time: number;
	delta: number;
	getTex(slot: RenderGraphSlot): TextureHandle;
	deviceColorEnabled: boolean;
}

export interface RenderPassGraphDef<S = unknown> {
	reads?: RenderGraphSlot[];
	writes?: RenderGraphSlot[];
	presentInput?: 'auto' | RenderGraphSlot;
	skip?: boolean;
	buildState?: (ctx: RenderGraphPassContext) => S;
	writeState?: (ctx: RenderGraphPassContext, state: S) => void;
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
	vsCode?: string;
	fsCode?: string;
	sharedPipelineWith?: RenderPassStateId;
	bindingLayout?: GraphicsPipelineBindingLayout;
	graph?: RenderPassGraphDef<S>;
	name: string;
	writesDepth?: boolean;
	depthTest?: boolean;   // pipeline uses depth testing (may be read-only)
	depthWrite?: boolean;  // pipeline writes depth (separate from writesDepth graph hint)
	stateOnly?: boolean;
	present?: boolean;
	initialState?: S;
	shouldExecute?(view: GameView): boolean;
	/**
	 * Optional one-time initializer to create permanent GPU resources for this pass
	 * (e.g., buffers, VAOs, default textures). Called once at registration time.
	 */
	bootstrap?: (backend: GPUBackend) => void;
	exec: (backend: GPUBackend, fbo: unknown, state: S, pipelineHandle: RenderPassInstanceHandle | null) => void;
	prepare?: (backend: GPUBackend, state: S) => void;
}

// Minimal shader build description for backend pipeline creation. Vertex stream
// layout is owned by each concrete pass, not by this shared backend interface.
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

export interface GPUBackend {
	// Discriminator for runtime backend flavor
	type: 'webgpu' | 'webgl2' | 'headless';
	context: BackendContext;

	createImageBitmapFromSource?(src: TextureSource): Promise<ImageBitmap>;
	createTexture(data: Uint8Array, width: number, height: number, desc: TextureParams): TextureHandle;
	updateTexture(handle: TextureHandle, data: Uint8Array, width: number, height: number, desc: TextureParams): void;
	resizeTexture(handle: TextureHandle, width: number, height: number, desc: TextureParams): TextureHandle;
	updateTextureRegion(handle: TextureHandle, data: Uint8Array, width: number, height: number, x: number, y: number, desc: TextureParams, sourceOffset?: number): void;
	createSolidTexture2D(width: number, height: number, color: number, desc: TextureParams): TextureHandle;
	createCubemapFromSources(faces: readonly [TextureSource, TextureSource, TextureSource, TextureSource, TextureSource, TextureSource], desc: TextureParams): TextureHandle;
	createSolidCubemap(size: number, color: number, desc: TextureParams): TextureHandle;
	createCubemapEmpty(size: number, desc: TextureParams): TextureHandle;
	uploadCubemapFace(cubemap: TextureHandle, face: number, src: TextureSource): void;
	destroyTexture(handle: TextureHandle): void;
	createColorTexture(desc: { width: number; height: number; format?: TextureFormat; initialClearColor?: color_arr }): TextureHandle;
	createDepthTexture(desc: { width: number; height: number; format?: TextureFormat }): TextureHandle;
	createRenderTarget(color?: TextureHandle, depth?: TextureHandle): RenderTargetHandle;
	clear(color: color_arr | undefined, depth: number | undefined): void;
	beginRenderPass(desc: RenderPassDesc): PassEncoder;
	endRenderPass(pass: PassEncoder): void;
	getCaps(): BackendCaps;
	registerBuiltinPasses(registry: RenderPassLibrary): void;
	createRenderPassInstance?(desc: GraphicsPipelineBuildDesc): RenderPassInstanceHandle;
	destroyRenderPassInstance?(p: RenderPassInstanceHandle): void;
	setGraphicsPipeline?(pass: PassEncoder, pipeline: RenderPassInstanceHandle): void;
	bindRenderPassPipeline?(pass: PassEncoder, pipeline: RenderPassInstanceHandle, bindingLayout?: GraphicsPipelineBindingLayout): void;
	draw(pass: PassEncoder, first: number, count: number): void;
	drawIndexed(pass: PassEncoder, indexCount: number, firstIndex: number, indexType?: number): void;
	setPassState<S = unknown>(label: RenderPassId, state: S): void;
	getPassState<S = unknown>(label: RenderPassId): S;

	// Optional buffer/VAO helpers
	createVertexBuffer?(data: ArrayBufferView, usage: 'static' | 'dynamic'): BufferHandle;
	updateVertexBuffer?(buf: BufferHandle, data: ArrayBufferView, dstOffset?: number, sourceOffset?: number, elementCount?: number): void;
	bindArrayBuffer?(buf: BufferHandle): void;
	createVertexArray?(): unknown;
	bindVertexArray?(vao: unknown): void;
	deleteVertexArray?(vao: unknown): void;

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
	getFrameStats(): { draws: number; drawIndexed: number; drawsInstanced: number; drawIndexedInstanced: number; bytesUploaded: number };
	captureGxGpuVramSnapshot(gxGpu: GxGpu): void | Promise<void>;
	// Optional: fine-grained upload accounting for HUD
	accountUpload(kind: 'vertex' | 'index' | 'uniform' | 'texture', bytes: number): void;
}

export interface RenderPassStateRegistry {
	['gx_gpu']: GxGpuPipelineState;
	['host_overlay']: HostOverlayPipelineState;
	['host_menu']: HostMenuPipelineState;
	['device_quantize']: DeviceQuantizePipelineState;
	['presentation_history_a']: PresentPipelineState;
	['presentation_history_b']: PresentPipelineState;
	['present']: PresentPipelineState;
	['crt']: CRTPipelineState;
	['frame_resolve']: never;
	['headless_present']: never;
}
export type RenderPassStateId = keyof RenderPassStateRegistry;

export type GxGpuPipelineState = {
	width: number;
	height: number;
	commandBuffer: GxGpuCommandBufferView;
	statusWord: number;
	displayModeWord: number;
	displayStartWord: number;
	horizontalDisplayRangeWord: number;
	verticalDisplayRangeWord: number;
	vramSnapshotBytes: Uint8Array;
	vramSnapshotSerial: number;
	targetColorTex?: TextureHandle;
};

export type Host2DPipelineState = {
	width: number;
	height: number;
	overlayWidth: number;
	overlayHeight: number;
	time: number;
	delta: number;
};

export type HostOverlayPipelineState = Host2DPipelineState & {
	commands: Host2DSubmission[];
};

export type HostMenuPipelineState = Host2DPipelineState;

export interface RenderContext {
	viewportSize: { x: number; y: number };
	backendType: 'webgpu' | 'webgl2' | 'headless';
	offscreenCanvasSize: { x: number; y: number; };
	backend: GPUBackend;
	presentationMode: PresentationMode;
	commitPresentationFrame: boolean;
	presentationHistorySourceIndex: 0 | 1;
	presentationHistoryDestinationIndex: 0 | 1;
	gxGpuCommandBuffer: GxGpuCommandBufferView;
	gxGpuStatusWord: number;
	gxGpuDisplayModeWord: number;
	gxGpuDisplayStartWord: number;
	gxGpuHorizontalDisplayRangeWord: number;
	gxGpuVerticalDisplayRangeWord: number;
	gxGpuVramSnapshotBytes: Uint8Array;
	gxGpuVramSnapshotSerial: number;
}

export type RenderingViewportType = 'viewport' | 'offscreen';

export interface DeviceQuantizePipelineState {
	width: number;
	height: number;
	baseWidth: number;
	baseHeight: number;
	colorTex: TextureHandle;
	deviceQuantizeMode: DeviceQuantizeMode;
}

export type PresentPipelineState = {
	width: number;
	height: number;
	srcWidth: number;
	srcHeight: number;
	colorTex: TextureHandle;
	targetColorTex?: TextureHandle;
};

export interface CRTPipelineOptions {
	applyNoise: boolean;
	noiseIntensity: number;
	applyColorBleed: boolean;
	colorBleed: [number, number, number];
	applyScanlines: boolean;
	applyBlur: boolean;
	applyGlow: boolean;
	applyFringing: boolean;
	applyAperture: boolean;
	blurIntensity: number;
	glowColor: [number, number, number];
}

export interface CRTPipelineState {
	width: number;
	height: number;
	baseWidth: number;
	baseHeight: number;
	srcWidth: number;
	srcHeight: number;
	time: number;
	colorTex: TextureHandle;
	options: CRTPipelineOptions;
}
