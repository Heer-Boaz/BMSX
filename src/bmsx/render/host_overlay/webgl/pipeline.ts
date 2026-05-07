import type { RenderPassLibrary } from '../../backend/pass/library';
import type {
	Host2DPipelineState,
	HostOverlayPipelineState,
	PassEncoder,
	RenderPassDesc,
	RenderPassStateRegistry,
} from '../../backend/backend';
import { FRAME_UNIFORM_BINDING, updateAndBindFrameUniforms } from '../../backend/frame_uniforms';
import { DEFAULT_TEXTURE_PARAMS } from '../../backend/texture_params';
import { WebGLBackend } from '../../backend/webgl/backend';
import {
	bindWebGLInstancedQuadVertexArray,
	createWebGLInstancedQuadRuntime,
	ensureWebGLInstanceBufferCapacity,
	flushWebGLInstanceBatch,
	type WebGLInstancedFloatAttribute,
	type WebGLSpriteQuadUniforms,
} from '../../backend/webgl/instanced_buffers';
import { consoleCore } from '../../../core/console';
import { bootstrapAxisGizmo_WebGL, renderAxisGizmo_WebGL, shouldRenderAxisGizmo } from '../../3d/axis_gizmo_pipeline';
import type {
	GlyphRenderSubmission,
	HostImageRenderSubmission,
	PolyRenderSubmission,
	RectRenderSubmission,
	color,
} from '../../shared/submissions';
import { RectRenderKind } from '../../shared/submissions';
import {
	HOST_SYSTEM_ATLAS_HEIGHT,
	HOST_SYSTEM_ATLAS_WIDTH,
	hostSystemAtlasImage,
	hostSystemAtlasPixels,
} from '../../../rompack/host_system_atlas';
import { forEachGlyphRunGlyph } from '../../shared/glyph_runs';
import { hasPendingOverlayFrame } from '../overlay_queue';
import { buildHostMenuState, buildHostOverlayState } from '../pipeline';
import { hostOverlayMenu } from '../../../core/host_overlay_menu';
import type { Host2DKind, Host2DRef, Host2DSubmission } from '../../shared/queues';
import vertexShaderCode from '../../2d/shaders/2d.vert.glsl';
import fragmentShaderCode from '../shaders/host_overlay.frag.glsl';

type HostOverlayImageSource = {
	u0: number;
	v0: number;
	u1: number;
	v1: number;
	width: number;
	height: number;
};

type BoundTextureState = WebGLTexture | null;
export type Host2DBoundTextureState = BoundTextureState;

export type HostOverlayRuntime = {
	gl: WebGL2RenderingContext;
	program: WebGLProgram;
	vao: WebGLVertexArrayObject;
	cornerBuffer: WebGLBuffer;
	instanceFloatBuffer: WebGLBuffer;
	instanceTextpageBuffer: WebGLBuffer;
	floatData: Float32Array;
	textpageData: Uint8Array;
	capacity: number;
	whiteTexture: WebGLTexture;
	hostAtlasTexture: WebGLTexture;
	imageCache: Map<string, HostOverlayImageSource>;
	uniforms: WebGLSpriteQuadUniforms;
};

const INSTANCE_FLOATS = 14;
const INSTANCE_STRIDE_BYTES = INSTANCE_FLOATS * 4;
const INITIAL_BATCH_CAPACITY = 256;
const SOLID_TEXCOORD_0 = 0;
const SOLID_TEXCOORD_1 = 1;
const HOST_OVERLAY_TEXTURE_UNIT = 0;
const HOST_OVERLAY_TEXTPAGE_ID = 0;
const HOST_OVERLAY_DRAW_PASS: PassEncoder = { fbo: null, desc: { label: 'host_overlay' } as RenderPassDesc };
const AXIS_GIZMO_LABEL_CAPACITY = 6;
const axisLabelImgIds = new Array<string>(AXIS_GIZMO_LABEL_CAPACITY);
const axisLabelX = new Float32Array(AXIS_GIZMO_LABEL_CAPACITY);
const axisLabelY = new Float32Array(AXIS_GIZMO_LABEL_CAPACITY);
const axisLabelZ = new Float32Array(AXIS_GIZMO_LABEL_CAPACITY);
const axisLabelScale = new Float32Array(AXIS_GIZMO_LABEL_CAPACITY);
const axisLabelColors = new Array<color>(AXIS_GIZMO_LABEL_CAPACITY);
const INSTANCE_FLOAT_ATTRIBUTES: readonly WebGLInstancedFloatAttribute[] = [
	['i_origin', 2, 0],
	['i_axis_x', 2, 2 * 4],
	['i_axis_y', 2, 4 * 4],
	['i_uv0', 2, 6 * 4],
	['i_uv1', 2, 8 * 4],
	['i_color', 4, 10 * 4],
];

let runtime: HostOverlayRuntime | null = null;
let axisLabelCount = 0;

function createRuntime(backend: WebGLBackend, program: WebGLProgram): HostOverlayRuntime {
	const gl = backend.gl as WebGL2RenderingContext;
	const vao = backend.createVertexArray() as WebGLVertexArrayObject;
	const quad = createWebGLInstancedQuadRuntime(backend, gl, program, INITIAL_BATCH_CAPACITY, INSTANCE_FLOATS);
	const whiteTexture = backend.createSolidTexture2D(1, 1, 0xffffffff) as WebGLTexture;
	const hostAtlasTexture = backend.createTexture(hostSystemAtlasPixels(), HOST_SYSTEM_ATLAS_WIDTH, HOST_SYSTEM_ATLAS_HEIGHT, DEFAULT_TEXTURE_PARAMS) as WebGLTexture;
	bindWebGLInstancedQuadVertexArray(backend, vao, program, quad, INSTANCE_STRIDE_BYTES, INSTANCE_FLOAT_ATTRIBUTES);
	return {
		gl,
		program,
		vao,
		...quad,
		whiteTexture,
		hostAtlasTexture,
		imageCache: new Map<string, HostOverlayImageSource>(),
	};
}

export function destroyHostOverlayRuntime_WebGL(runtimeToDestroy: HostOverlayRuntime): void {
	const gl = runtimeToDestroy.gl;
	gl.deleteBuffer(runtimeToDestroy.cornerBuffer);
	gl.deleteBuffer(runtimeToDestroy.instanceFloatBuffer);
	gl.deleteBuffer(runtimeToDestroy.instanceTextpageBuffer);
	gl.deleteVertexArray(runtimeToDestroy.vao);
	gl.deleteTexture(runtimeToDestroy.whiteTexture);
	gl.deleteTexture(runtimeToDestroy.hostAtlasTexture);
}

function bootstrapRuntime(backend: WebGLBackend): HostOverlayRuntime {
	const gl = backend.gl as WebGL2RenderingContext;
	const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
	if (runtime !== null) {
		destroyHostOverlayRuntime_WebGL(runtime);
	}
	runtime = createRuntime(backend, program);
	return runtime;
}

export function createHostOverlayRuntime_WebGL(backend: WebGLBackend): HostOverlayRuntime {
	const gl = backend.gl as WebGL2RenderingContext;
	const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
	return createRuntime(backend, program);
}

function writeQuad(state: HostOverlayRuntime, index: number, originX: number, originY: number, axisXX: number, axisXY: number, axisYX: number, axisYY: number, u0: number, v0: number, u1: number, v1: number, _z: number, colorValue: color): void {
	const base = index * INSTANCE_FLOATS;
	const data = state.floatData;
	data[base + 0] = originX;
	data[base + 1] = originY;
	data[base + 2] = axisXX;
	data[base + 3] = axisXY;
	data[base + 4] = axisYX;
	data[base + 5] = axisYY;
	data[base + 6] = u0;
	data[base + 7] = v0;
	data[base + 8] = u1;
	data[base + 9] = v1;
	data[base + 10] = ((colorValue >>> 16) & 0xff) / 255;
	data[base + 11] = ((colorValue >>> 8) & 0xff) / 255;
	data[base + 12] = (colorValue & 0xff) / 255;
	data[base + 13] = ((colorValue >>> 24) & 0xff) / 255;
	state.textpageData[index] = HOST_OVERLAY_TEXTPAGE_ID;
}

function resolveImageSource(cache: Map<string, HostOverlayImageSource>, imgid: string): HostOverlayImageSource {
	const cached = cache.get(imgid);
	if (cached) {
		return cached;
	}
	const hostImage = hostSystemAtlasImage(imgid);
	const source: HostOverlayImageSource = {
		u0: hostImage.u / HOST_SYSTEM_ATLAS_WIDTH,
		v0: hostImage.v / HOST_SYSTEM_ATLAS_HEIGHT,
		u1: (hostImage.u + hostImage.w) / HOST_SYSTEM_ATLAS_WIDTH,
		v1: (hostImage.v + hostImage.h) / HOST_SYSTEM_ATLAS_HEIGHT,
		width: hostImage.width,
		height: hostImage.height,
	};
	cache.set(imgid, source);
	return source;
}

function bindHostTexture(texture: WebGLTexture, boundTextures: BoundTextureState): BoundTextureState {
	if (boundTextures === texture) {
		return boundTextures;
	}
	consoleCore.view.activeTexUnit = HOST_OVERLAY_TEXTURE_UNIT;
	consoleCore.view.bind2DTex(texture);
	return texture;
}

function captureAxisGizmoImage(imgid: string, x: number, y: number, z: number, scale: number, colorValue: color): void {
	if (axisLabelCount >= AXIS_GIZMO_LABEL_CAPACITY) {
		throw new Error('[AxisGizmo] Host label scratch capacity exhausted.');
	}
	const index = axisLabelCount;
	axisLabelImgIds[index] = imgid;
	axisLabelX[index] = x;
	axisLabelY[index] = y;
	axisLabelZ[index] = z;
	axisLabelScale[index] = scale;
	axisLabelColors[index] = colorValue;
	axisLabelCount += 1;
}

function drawHostImage(backend: WebGLBackend, state: HostOverlayRuntime, cache: Map<string, HostOverlayImageSource>, imgid: string, x: number, y: number, z: number, scaleX: number, scaleY: number, flipH: boolean, flipV: boolean, colorValue: color, boundTextures: BoundTextureState): BoundTextureState {
	const source = resolveImageSource(cache, imgid);
	const nextBoundTextures = bindHostTexture(state.hostAtlasTexture, boundTextures);
	let { u0, v0, u1, v1 } = source;
	if (flipH) {
		const swap = u0;
		u0 = u1;
		u1 = swap;
	}
	if (flipV) {
		const swap = v0;
		v0 = v1;
		v1 = swap;
	}
	const width = source.width * scaleX;
	const height = source.height * scaleY;
	if (width === 0 || height === 0) {
		return nextBoundTextures;
	}
	writeQuad(
		state,
		0,
		x,
		y,
		width,
		0,
		0,
		height,
		u0,
		v0,
		u1,
		v1,
		z,
		colorValue,
	);
	flushWebGLInstanceBatch(backend, HOST_OVERLAY_DRAW_PASS, state, 1, INSTANCE_FLOATS);
	return nextBoundTextures;
}

function pushFillRect(state: HostOverlayRuntime, index: number, leftValue: number, topValue: number, rightValue: number, bottomValue: number, z: number, colorValue: color): number {
	let left = leftValue;
	let top = topValue;
	let right = rightValue;
	let bottom = bottomValue;
	if (right < left) {
		const swap = left;
		left = right;
		right = swap;
	}
	if (bottom < top) {
		const swap = top;
		top = bottom;
		bottom = swap;
	}
	const width = right - left;
	const height = bottom - top;
	if (width === 0 || height === 0) {
		return 0;
	}
	writeQuad(state, index, left, top, width, 0, 0, height, SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, z, colorValue);
	return 1;
}

function drawRectCommand(backend: WebGLBackend, state: HostOverlayRuntime, command: RectRenderSubmission, boundTextures: BoundTextureState): BoundTextureState {
	const nextBoundTextures = bindHostTexture(state.whiteTexture, boundTextures);
	if (command.kind === RectRenderKind.Fill) {
		const written = pushFillRect(state, 0, command.area.left, command.area.top, command.area.right, command.area.bottom, command.area.z, command.color);
		if (written !== 0) {
			flushWebGLInstanceBatch(backend, HOST_OVERLAY_DRAW_PASS, state, written, INSTANCE_FLOATS);
		}
		return nextBoundTextures;
	}
	let count = 0;
	count += pushFillRect(state, count, command.area.left, command.area.top, command.area.right, command.area.top + 1, command.area.z, command.color);
	count += pushFillRect(state, count, command.area.left, command.area.bottom - 1, command.area.right, command.area.bottom, command.area.z, command.color);
	count += pushFillRect(state, count, command.area.left, command.area.top, command.area.left + 1, command.area.bottom, command.area.z, command.color);
	count += pushFillRect(state, count, command.area.right - 1, command.area.top, command.area.right, command.area.bottom, command.area.z, command.color);
	if (count !== 0) {
		flushWebGLInstanceBatch(backend, HOST_OVERLAY_DRAW_PASS, state, count, INSTANCE_FLOATS);
	}
	return nextBoundTextures;
}

function pushLine(state: HostOverlayRuntime, index: number, x0: number, y0: number, x1: number, y1: number, z: number, colorValue: color, thickness: number): number {
	const dx = x1 - x0;
	const dy = y1 - y0;
	if (dx === 0 && dy === 0) {
		return pushFillRect(state, index, x0, y0, x0 + thickness, y0 + thickness, z, colorValue);
	}
	const length = Math.sqrt(dx * dx + dy * dy);
	const half = thickness * 0.5;
	const normalX = -dy / length;
	const normalY = dx / length;
	writeQuad(
		state,
		index,
		x0 - normalX * half,
		y0 - normalY * half,
		dx,
		dy,
		normalX * thickness,
		normalY * thickness,
		SOLID_TEXCOORD_0,
		SOLID_TEXCOORD_0,
		SOLID_TEXCOORD_1,
		SOLID_TEXCOORD_1,
		z,
		colorValue,
	);
	return 1;
}

function drawPolyCommand(backend: WebGLBackend, state: HostOverlayRuntime, command: PolyRenderSubmission, boundTextures: BoundTextureState): BoundTextureState {
	const nextBoundTextures = bindHostTexture(state.whiteTexture, boundTextures);
	let count = 0;
	const points = command.points;
	for (let index = 0; index + 3 < points.length; index += 2) {
		ensureWebGLInstanceBufferCapacity(backend, state, count + 1, INSTANCE_FLOATS);
		count += pushLine(state, count, points[index], points[index + 1], points[index + 2], points[index + 3], command.z, command.color, command.thickness);
	}
	if (count !== 0) {
		flushWebGLInstanceBatch(backend, HOST_OVERLAY_DRAW_PASS, state, count, INSTANCE_FLOATS);
	}
	return nextBoundTextures;
}

function drawGlyphRunBackgrounds(backend: WebGLBackend, state: HostOverlayRuntime, command: GlyphRenderSubmission, boundTextures: BoundTextureState): BoundTextureState {
	if (!command.has_background_color) {
		return boundTextures;
	}
	const font = command.font;
	const lineHeight = font.lineHeight;
	const nextBoundTextures = bindHostTexture(state.whiteTexture, boundTextures);
	let count = 0;
	forEachGlyphRunGlyph(command, (glyph, x, y) => {
		ensureWebGLInstanceBufferCapacity(backend, state, count + 1, INSTANCE_FLOATS);
		count += pushFillRect(state, count, x, y, x + glyph.advance, y + lineHeight, command.z, command.background_color);
	});
	if (count !== 0) {
		flushWebGLInstanceBatch(backend, HOST_OVERLAY_DRAW_PASS, state, count, INSTANCE_FLOATS);
	}
	return nextBoundTextures;
}

function drawGlyphRunGlyphs(backend: WebGLBackend, state: HostOverlayRuntime, cache: Map<string, HostOverlayImageSource>, command: GlyphRenderSubmission, boundTextures: BoundTextureState): BoundTextureState {
	const currentBoundTextures = bindHostTexture(state.hostAtlasTexture, boundTextures);
	let count = 0;
	forEachGlyphRunGlyph(command, (glyph, x, y) => {
		const source = resolveImageSource(cache, glyph.imgid);
		ensureWebGLInstanceBufferCapacity(backend, state, count + 1, INSTANCE_FLOATS);
		writeQuad(
			state,
			count,
			x,
			y,
			glyph.width,
			0,
			0,
			glyph.height,
			source.u0,
			source.v0,
			source.u1,
			source.v1,
			command.z,
			command.color,
		);
		count += 1;
	});
	if (count !== 0) {
		flushWebGLInstanceBatch(backend, HOST_OVERLAY_DRAW_PASS, state, count, INSTANCE_FLOATS);
	}
	return currentBoundTextures;
}

function drawGlyphRunCommand(backend: WebGLBackend, state: HostOverlayRuntime, cache: Map<string, HostOverlayImageSource>, command: GlyphRenderSubmission, boundTextures: BoundTextureState): BoundTextureState {
	let currentBoundTextures = drawGlyphRunBackgrounds(backend, state, command, boundTextures);
	currentBoundTextures = drawGlyphRunGlyphs(backend, state, cache, command, currentBoundTextures);
	return currentBoundTextures;
}

function bindPassState(backend: WebGLBackend, state: HostOverlayRuntime, passState: Host2DPipelineState): void {
	const gl = backend.gl as WebGL2RenderingContext;
	gl.useProgram(state.program);
	updateAndBindFrameUniforms(backend, {
		offscreen: { x: passState.width, y: passState.height },
		logical: { x: passState.overlayWidth, y: passState.overlayHeight },
		time: passState.time,
		delta: passState.delta,
	});
	backend.setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
	gl.uniform1f(state.uniforms.scale, 1);
	backend.setViewport({ x: 0, y: 0, w: passState.width, h: passState.height });
	backend.setCullEnabled(false);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setBlendEnabled(true);
	backend.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	backend.bindVertexArray(state.vao);
}

function renderOverlay(backend: WebGLBackend, state: HostOverlayRuntime, passState: HostOverlayPipelineState): void {
	let boundTextures = beginHost2DEntries_WebGL(backend, state, passState);
	for (let index = 0; index < passState.commands.length; index += 1) {
		boundTextures = drawHost2DSubmission_WebGL(backend, state, passState.commands[index], boundTextures);
	}
	endHost2DEntries_WebGL(backend);
}

export function drawHost2DSubmission_WebGL(backend: WebGLBackend, state: HostOverlayRuntime, command: Host2DSubmission, boundTextures: BoundTextureState): BoundTextureState {
	const imageCache = state.imageCache;
	switch (command.type) {
		case 'rect':
			return drawRectCommand(backend, state, command, boundTextures);
		case 'img':
			return drawHostImage(backend, state, imageCache, command.imgid, command.pos.x, command.pos.y, command.pos.z, command.scale.x, command.scale.y, command.flip.flip_h, command.flip.flip_v, command.colorize, boundTextures);
		case 'glyphs':
			return drawGlyphRunCommand(backend, state, imageCache, command, boundTextures);
		case 'poly':
			return drawPolyCommand(backend, state, command, boundTextures);
	}
}

export function drawHost2DCommand_WebGL(backend: WebGLBackend, state: HostOverlayRuntime, kind: Host2DKind, command: Host2DRef, boundTextures: BoundTextureState): BoundTextureState {
	const imageCache = state.imageCache;
	switch (kind) {
		case 'rect':
			return drawRectCommand(backend, state, command as RectRenderSubmission, boundTextures);
		case 'img': {
			const image = command as HostImageRenderSubmission;
			return drawHostImage(backend, state, imageCache, image.imgid, image.pos.x, image.pos.y, image.pos.z, image.scale.x, image.scale.y, image.flip.flip_h, image.flip.flip_v, image.colorize, boundTextures);
		}
		case 'glyphs':
			return drawGlyphRunCommand(backend, state, imageCache, command as GlyphRenderSubmission, boundTextures);
		case 'poly':
			return drawPolyCommand(backend, state, command as PolyRenderSubmission, boundTextures);
	}
}

export function beginHost2DEntries_WebGL(backend: WebGLBackend, state: HostOverlayRuntime, passState: Host2DPipelineState): BoundTextureState {
	const gl = backend.gl as WebGL2RenderingContext;
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	bindPassState(backend, state, passState);
	return null;
}

export function endHost2DEntries_WebGL(backend: WebGLBackend): void {
	backend.bindVertexArray(null);
	backend.setBlendEnabled(false);
	backend.setDepthMask(true);
}

function renderAxisGizmoLabels(backend: WebGLBackend, state: HostOverlayRuntime, passState: HostOverlayPipelineState): void {
	const gl = backend.gl as WebGL2RenderingContext;
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	bindPassState(backend, state, passState);
	const imageCache = state.imageCache;
	let boundTextures: BoundTextureState = null;
	for (let index = 0; index < axisLabelCount; index += 1) {
		boundTextures = drawHostImage(
			backend,
			state,
			imageCache,
			axisLabelImgIds[index],
			axisLabelX[index],
			axisLabelY[index],
			axisLabelZ[index],
			axisLabelScale[index],
			axisLabelScale[index],
			false,
			false,
			axisLabelColors[index],
			boundTextures,
		);
	}
	backend.bindVertexArray(null);
	backend.setBlendEnabled(false);
	backend.setDepthMask(true);
}

function renderHostPass(backend: WebGLBackend, state: HostOverlayRuntime, passState: HostOverlayPipelineState): void {
	if (passState.commands.length !== 0) {
		renderOverlay(backend, state, passState);
	}
	if (!shouldRenderAxisGizmo()) {
		return;
	}
	axisLabelCount = 0;
	renderAxisGizmo_WebGL(backend, captureAxisGizmoImage);
	if (axisLabelCount !== 0) {
		renderAxisGizmoLabels(backend, state, passState);
	}
}

export function registerHostOverlayPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_overlay',
		name: 'HostOverlay',
		vsCode: vertexShaderCode,
		fsCode: fragmentShaderCode,
		present: true,
		bootstrap: (backend) => {
			const webglBackend = backend as WebGLBackend;
			bootstrapRuntime(webglBackend);
			bootstrapAxisGizmo_WebGL(webglBackend);
		},
		shouldExecute: () => hasPendingOverlayFrame() || shouldRenderAxisGizmo(),
		prepare: () => {
			registry.setState('host_overlay', buildHostOverlayState());
		},
		exec: (backend: WebGLBackend, _fbo, state: RenderPassStateRegistry['host_overlay']) => {
			renderHostPass(backend, runtime!, state);
		},
	});
}

function renderHostMenuPass(backend: WebGLBackend, state: HostOverlayRuntime, passState: Host2DPipelineState): void {
	let boundTextures = beginHost2DEntries_WebGL(backend, state, passState);
	const count = hostOverlayMenu.queuedCommandCount();
	for (let index = 0; index < count; index += 1) {
		boundTextures = drawHost2DCommand_WebGL(backend, state, hostOverlayMenu.commandKind(index), hostOverlayMenu.commandRef(index), boundTextures);
	}
	endHost2DEntries_WebGL(backend);
}

export function registerHostMenuPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_menu',
		name: 'HostMenu',
		sharedPipelineWith: 'host_overlay',
		present: true,
		shouldExecute: () => hostOverlayMenu.queuedCommandCount() !== 0,
		prepare: () => {
			registry.setState('host_menu', buildHostMenuState());
		},
		exec: (backend: WebGLBackend, _fbo, state: RenderPassStateRegistry['host_menu']) => {
			renderHostMenuPass(backend, runtime!, state);
		},
	});
}
