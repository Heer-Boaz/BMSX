/// <reference types="@webgpu/types" />
import { type color_arr, type TextureSource, type vec2 } from '../../rompack/rompack';
import { GlyphRenderSubmission, ImgRenderSubmission, MeshRenderSubmission, ParticleRenderSubmission, PolyRenderSubmission, RectRenderSubmission } from '../shared/render_types';
import { LightingFrameState } from '../lighting/lightingsystem';
import type { WebGLBackend } from './webgl/webgl_backend';
import type { WebGPUBackend } from './webgpu/webgpu_backend';

// Minimal, unified render interfaces for both backends

export type TextureFormat = 'rgba8unorm' | 'bgra8unorm' | 'rgb8unorm' | 'depth24plus' | 'depth32float' | string | number;
export type TextureHandle = WebGLTexture | GPUTexture;
export type BufferHandle = WebGLBuffer | GPUBuffer | null;
export type BackendContext =  WebGL2RenderingContext | GPUCanvasContext | null;
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
	| 'device_quantize'
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

export type RenderGraphSlot = 'frame_color' | 'frame_depth' | 'device_color';

export interface RenderGraphPassContext {
	view: RenderContext;
	getTex(slot: RenderGraphSlot): TextureHandle;
}

export interface RenderPassGraphDef<S = unknown> {
	reads?: RenderGraphSlot[];
	writes?: RenderGraphSlot[];
	presentInput?: 'auto' | RenderGraphSlot;
	skip?: boolean;
	buildState?: (ctx: RenderGraphPassContext) => S;
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
	bindingLayout?: GraphicsPipelineBindingLayout;
	graph?: RenderPassGraphDef<S>;
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
	exec: (backend: AnyBackend, fbo: unknown, state: S) => void;
	prepare?: (backend: GPUBackend, state: S) => void;
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
	context: BackendContext;

	// Optional WebGL-like texture binding helpers (implemented by WebGL backend).
	// These allow higher-level code (GameView / render graph) to perform texture
	// binds without casting to a concrete backend type.
	setActiveTexture?(unit: number): void;
	bindTexture2D?(tex: TextureHandle): void;
	bindTextureCube?(tex: TextureHandle): void;
	createImageBitmapFromSource?(src: TextureSource): Promise<ImageBitmap>;
	createTexture(src: TextureSource | Promise<TextureSource>, desc: TextureParams): TextureHandle;
	updateTexture(handle: TextureHandle, src: TextureSource): void;
	resizeTexture(handle: TextureHandle, width: number, height: number, desc: TextureParams): TextureHandle;
	updateTextureRegion(handle: TextureHandle, src: TextureSource, x: number, y: number): void;
	readTextureRegion(handle: TextureHandle, x: number, y: number, width: number, height: number): Uint8Array;
	createSolidTexture2D(width: number, height: number, rgba: color_arr, desc?: TextureParams): TextureHandle;
	createCubemapFromSources(faces: readonly [TextureSource, TextureSource, TextureSource, TextureSource, TextureSource, TextureSource], desc: TextureParams): TextureHandle;
	createSolidCubemap(size: number, rgba: color_arr, desc: TextureParams): TextureHandle;
	createCubemapEmpty(size: number, desc: TextureParams): TextureHandle;
	uploadCubemapFace(cubemap: TextureHandle, face: number, src: TextureSource): void;
	destroyTexture(handle: TextureHandle): void;
	createColorTexture(desc: { width: number; height: number; format?: TextureFormat }): TextureHandle;
	createDepthTexture(desc: { width: number; height: number; format?: TextureFormat }): TextureHandle;
	createRenderTarget(color?: TextureHandle, depth?: TextureHandle): RenderTargetHandle;
	clear(opts: { color?: color_arr; depth?: number }): void;
	beginRenderPass(desc: RenderPassDesc): PassEncoder;
	endRenderPass(pass: PassEncoder): void;
	getCaps(): BackendCaps;
	transitionTexture?(tex: TextureHandle, fromLayout: string, toLayout: string): void;
	createRenderPassInstance?(desc: GraphicsPipelineBuildDesc): RenderPassInstanceHandle;
	destroyRenderPassInstance?(p: RenderPassInstanceHandle): void;
	setGraphicsPipeline?(pass: PassEncoder, pipeline: RenderPassInstanceHandle): void;
	draw(pass: PassEncoder, first: number, count: number): void;
	drawIndexed(pass: PassEncoder, indexCount: number, firstIndex?: number, indexType?: number): void;
	setPassState<S = unknown>(label: RenderPassId, state: S): void;
	getPassState<S = unknown>(label: RenderPassId): S;

	// Optional buffer/VAO helpers (WebGL-backed today; WebGPU mapping later)
	createVertexBuffer?(data: ArrayBufferView, usage: 'static' | 'dynamic'): BufferHandle;
	updateVertexBuffer?(buf: BufferHandle, data: ArrayBufferView, dstOffset?: number): void;
	bindArrayBuffer?(buf: BufferHandle): void;
	createVertexArray?(): unknown;
	bindVertexArray?(vao: unknown): void;
	deleteVertexArray?(vao: unknown): void;

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
	getFrameStats(): { draws: number; drawIndexed: number; drawsInstanced: number; drawIndexedInstanced: number; bytesUploaded: number };
	// Optional: fine-grained upload accounting for HUD
	accountUpload(kind: 'vertex' | 'index' | 'uniform' | 'texture', bytes: number): void;
}

export interface RenderPassStateRegistry {
	['skybox']: SkyboxPipelineState;
	['meshbatch']: MeshBatchPipelineState;
	['particles']: ParticlePipelineState;
	['sprites']: SpritesPipelineState;
	['device_quantize']: DeviceQuantizePipelineState;
	['crt']: CRTPipelineState;
	['frame_shared']: FrameSharedState;
	['frame_resolve']: never;
	['axis_gizmo']: never;
	['debug_solid']: never;
}
export type RenderPassStateId = keyof RenderPassStateRegistry;

export type RenderSubmission = ({ type: 'img'; } & ImgRenderSubmission) | ({ type: 'mesh'; } & MeshRenderSubmission) | ({ type: 'particle'; } & ParticleRenderSubmission) | ({ type: 'poly'; } & PolyRenderSubmission) | ({ type: 'rect'; } & RectRenderSubmission) | ({ type: 'glyphs'; } & GlyphRenderSubmission);
export type RenderSubmitQueue = Pick<Pick<RenderContext, 'renderer'>['renderer'], 'submit'>;

export interface RenderContext {
	viewportSize: { x: number; y: number };
	backendType: 'webgl2' | 'webgpu' | 'headless';
	offscreenCanvasSize: { x: number; y: number; };
	backend: GPUBackend;
	activeTexUnit: number;
	bind2DTex(tex: TextureHandle): void;
	bindCubemapTex(tex: TextureHandle): void;


	// Optional centralized renderer submission + queues (lightweight, backend-agnostic)
	renderer: {
		submit: {
			typed: (o: RenderSubmission) => void;
			particle: (o: ParticleRenderSubmission) => void;
			sprite: (o: ImgRenderSubmission) => void;
			mesh: (o: MeshRenderSubmission) => void;
			rect: (o: RectRenderSubmission) => void;
			poly: (o: PolyRenderSubmission) => void;
			glyphs: (o: GlyphRenderSubmission) => void;
		};
	};
}

export interface RenderPassToken {
	readonly id: string;
	enable(): void;
	disable(): void;
	set(enabled: boolean): void;
	isEnabled(): boolean;
}

export type FogUniforms = {
	fogD50: number;
	fogStart: number;
	fogColorLow: [number, number, number];
	fogColorHigh: [number, number, number];
	fogYMin: number;
	fogYMax: number;
};

export interface SkyboxPipelineState { width: number; height: number; view: Float32Array; proj: Float32Array; tex: TextureHandle; }

export interface MeshBatchPipelineState {
	width: number;
	height: number;
	camPos: Float32Array | { x: number; y: number; z: number; };
	viewProj: Float32Array;
	cameraFrustum: Float32Array;
	lighting?: LightingFrameState;
}

export interface ParticlePipelineState {
	width: number;
	height: number;
	viewProj: Float32Array;
	camRight: Float32Array;
	camUp: Float32Array;
	atlasPrimaryTex?: TextureHandle;
	atlasSecondaryTex?: TextureHandle;
	atlasEngineTex?: TextureHandle;
}

export type RenderingViewportType = 'viewport' | 'offscreen';

export interface SpritesPipelineState {
	width: number;
	height: number;
	baseWidth: number;
	baseHeight: number;
	atlasPrimaryTex?: TextureHandle;
	atlasSecondaryTex?: TextureHandle;
	atlasEngineTex?: TextureHandle;
	ambientEnabledDefault: boolean;
	ambientFactorDefault: number;
	ambientColor: [number, number, number];
	ambientIntensity: number;
	viewportTypeIde: RenderingViewportType;
}

export const enum CRTDitherType {
	None = 0,
	PSX = 1,
	RGB777Output = 2,
	MSX10 = 3,
}

export interface DeviceQuantizePipelineState {
	width: number;
	height: number;
	baseWidth: number;
	baseHeight: number;
	colorTex: TextureHandle;
	ditherType: CRTDitherType;
}

export interface CRTPipelineState {
	width: number;
	height: number;
	baseWidth: number;
	baseHeight: number;
	colorTex: TextureHandle;
	options: {
		enableNoise: boolean;
		noiseIntensity: number;
		enableColorBleed: boolean;
		colorBleed: [number, number, number];
		enableScanlines: boolean;
		enableBlur: boolean;
		enableGlow: boolean;
		enableFringing: boolean;
		enableAperture: boolean;
		blurIntensity: number;
		glowColor: [number, number, number];
	};
}
export interface FrameSharedState {
	view: {
		camPos: Float32Array | { x: number; y: number; z: number; };
		viewProj: Float32Array;
		skyboxView: Float32Array;
		proj: Float32Array;
	};
	lighting: LightingFrameState;
	fog: FogUniforms;
}export interface AtmosphereParams {
	fogD50: number;
	fogStart: number;
	fogColorLow: [number, number, number];
	fogColorHigh: [number, number, number];
	fogYMin: number;
	fogYMax: number;
	progressFactor: number;
	enableAutoAnimation: boolean;
}
