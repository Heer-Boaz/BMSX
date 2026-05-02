import type { RenderPassLibrary } from '../backend/pass/library';
import type {
	HostOverlayPipelineState,
	PassEncoder,
	RenderPassDesc,
	RenderPassStateRegistry,
	RenderSubmission,
} from '../backend/interfaces';
import { FRAME_UNIFORM_BINDING, updateAndBindFrameUniforms } from '../backend/frame_uniforms';
import { WebGLBackend } from '../backend/webgl/backend';
import {
	bindWebGLInstancedQuadVertexArray,
	createWebGLInstancedQuadRuntime,
	ensureWebGLInstanceBufferCapacity,
	flushWebGLInstanceBatch,
	type WebGLInstancedFloatAttribute,
	type WebGLSpriteQuadUniforms,
} from '../backend/webgl/instanced_buffers';
import { consoleCore } from '../../core/console';
import { bootstrapAxisGizmo_WebGL, renderAxisGizmo_WebGL, shouldRenderAxisGizmo } from '../3d/axis_gizmo_pipeline';
import { TAB_SPACES } from '../shared/bitmap_font';
import type { GlyphRenderSubmission, color } from '../shared/submissions';
import {
	HOST_SYSTEM_ATLAS_HEIGHT,
	HOST_SYSTEM_ATLAS_WIDTH,
	hostSystemAtlasImage,
	hostSystemAtlasPixels,
} from '../../rompack/host_system_atlas';
import type { BFont, FontGlyph } from '../shared/bitmap_font';
import { consumeOverlayFrame, hasPendingOverlayFrame } from './overlay_queue';
import vertexShaderCode from '../2d/shaders/2d.vert.glsl';
import fragmentShaderCode from './shaders/host_overlay.frag.glsl';

type HostOverlayImageSource = {
	u0: number;
	v0: number;
	u1: number;
	v1: number;
	width: number;
	height: number;
};

type BoundTextureState = WebGLTexture | null;

type HostOverlayRuntime = {
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

type GlyphRunCursor = {
	font: BFont;
	lines: string[];
	fullLines: boolean;
	start: number;
	end: number;
	baseX: number;
	originX: number;
	originY: number;
	lineIndex: number;
	charIndex: number;
	glyph: FontGlyph;
	x: number;
	y: number;
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
	const whiteTexture = backend.createSolidTexture2D(1, 1, [1, 1, 1, 1]) as WebGLTexture;
	const hostAtlasTexture = backend.createTexture({
		width: HOST_SYSTEM_ATLAS_WIDTH,
		height: HOST_SYSTEM_ATLAS_HEIGHT,
		data: hostSystemAtlasPixels(),
	}, {}) as WebGLTexture;
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

function destroyRuntime(runtimeToDestroy: HostOverlayRuntime): void {
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
		destroyRuntime(runtime);
	}
	runtime = createRuntime(backend, program);
	return runtime;
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
	data[base + 10] = colorValue.r;
	data[base + 11] = colorValue.g;
	data[base + 12] = colorValue.b;
	data[base + 13] = colorValue.a;
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

function bindHostAtlasTexture(runtimeState: HostOverlayRuntime, boundTextures: BoundTextureState): BoundTextureState {
	return bindHostTexture(runtimeState.hostAtlasTexture, boundTextures);
}

function bindSolidTexture(runtimeState: HostOverlayRuntime, boundTextures: BoundTextureState): BoundTextureState {
	return bindHostTexture(runtimeState.whiteTexture, boundTextures);
}

function bindImageTexture(runtimeState: HostOverlayRuntime, boundTextures: BoundTextureState): BoundTextureState {
	return bindHostAtlasTexture(runtimeState, boundTextures);
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
	const nextBoundTextures = bindImageTexture(state, boundTextures);
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

function drawRectCommand(backend: WebGLBackend, state: HostOverlayRuntime, command: Extract<RenderSubmission, { type: 'rect' }>, boundTextures: BoundTextureState): BoundTextureState {
	const nextBoundTextures = bindSolidTexture(state, boundTextures);
	if (command.kind === 'fill') {
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

function drawImageCommand(backend: WebGLBackend, state: HostOverlayRuntime, cache: Map<string, HostOverlayImageSource>, command: Extract<RenderSubmission, { type: 'img' }>, boundTextures: BoundTextureState): BoundTextureState {
	if (command.scale === undefined) {
		throw new Error('[HostOverlay] Image command missing scale.');
	}
	if (command.flip === undefined) {
		throw new Error('[HostOverlay] Image command missing flip.');
	}
	if (command.colorize === undefined) {
		throw new Error('[HostOverlay] Image command missing color.');
	}
	if (command.pos.z === undefined) {
		throw new Error('[HostOverlay] Image command missing z.');
	}
	if (command.imgid === undefined) {
		throw new Error('[HostOverlay] Image command missing id.');
	}
	return drawHostImage(
		backend,
		state,
		cache,
		command.imgid,
		command.pos.x,
		command.pos.y,
		command.pos.z,
		command.scale.x,
		command.scale.y,
		command.flip.flip_h,
		command.flip.flip_v,
		command.colorize,
		boundTextures,
	);
}

function createGlyphRunCursor(command: GlyphRenderSubmission, lines: string[]): GlyphRunCursor {
	const fullLines = Array.isArray(command.glyphs);
	const font = command.font!;
	return {
		font,
		lines,
		fullLines,
		start: fullLines ? 0 : command.glyph_start!,
		end: fullLines ? 0 : command.glyph_end!,
		baseX: command.x,
		originX: command.x,
		originY: command.y,
		lineIndex: 0,
		charIndex: 0,
		glyph: font.getGlyph(' '),
		x: 0,
		y: 0,
	};
}

function nextGlyphRunGlyph(cursor: GlyphRunCursor): boolean {
	while (cursor.lineIndex < cursor.lines.length) {
		const line = cursor.lines[cursor.lineIndex];
		const end = cursor.fullLines ? line.length : cursor.end;
		if (cursor.charIndex === 0) {
			cursor.charIndex = cursor.fullLines ? 0 : cursor.start;
		}
		while (cursor.charIndex < line.length && cursor.charIndex < end) {
			const char = line.charAt(cursor.charIndex);
			cursor.charIndex += 1;
			if (char === '\n') {
				cursor.originX = cursor.baseX;
				cursor.originY += cursor.font.lineHeight;
				continue;
			}
			if (char === '\t') {
				cursor.originX += cursor.font.advance(' ') * TAB_SPACES;
				continue;
			}
			cursor.glyph = cursor.font.getGlyph(char);
			cursor.x = cursor.originX;
			cursor.y = cursor.originY;
			cursor.originX += cursor.glyph.advance;
			return true;
		}
		cursor.lineIndex += 1;
		cursor.charIndex = 0;
		cursor.originX = cursor.baseX;
		cursor.originY += cursor.font.lineHeight;
	}
	return false;
}

function drawGlyphRunBackgrounds(backend: WebGLBackend, state: HostOverlayRuntime, command: GlyphRenderSubmission, lines: string[], boundTextures: BoundTextureState): BoundTextureState {
	if (command.background_color === undefined) {
		return boundTextures;
	}
	const font = command.font!;
	const lineHeight = font.lineHeight;
	const nextBoundTextures = bindSolidTexture(state, boundTextures);
	let count = 0;
	const cursor = createGlyphRunCursor(command, lines);
	while (nextGlyphRunGlyph(cursor)) {
		ensureWebGLInstanceBufferCapacity(backend, state, count + 1, INSTANCE_FLOATS);
		count += pushFillRect(state, count, cursor.x, cursor.y, cursor.x + cursor.glyph.advance, cursor.y + lineHeight, command.z!, command.background_color);
	}
	if (count !== 0) {
		flushWebGLInstanceBatch(backend, HOST_OVERLAY_DRAW_PASS, state, count, INSTANCE_FLOATS);
	}
	return nextBoundTextures;
}

function drawGlyphRunGlyphs(backend: WebGLBackend, state: HostOverlayRuntime, cache: Map<string, HostOverlayImageSource>, command: GlyphRenderSubmission, lines: string[], boundTextures: BoundTextureState): BoundTextureState {
	const currentBoundTextures = bindHostAtlasTexture(state, boundTextures);
	let count = 0;
	const cursor = createGlyphRunCursor(command, lines);
	while (nextGlyphRunGlyph(cursor)) {
		const glyph = cursor.glyph;
		const source = resolveImageSource(cache, glyph.imgid);
		ensureWebGLInstanceBufferCapacity(backend, state, count + 1, INSTANCE_FLOATS);
		writeQuad(
			state,
			count,
			cursor.x,
			cursor.y,
			glyph.width,
			0,
			0,
			glyph.height,
			source.u0,
			source.v0,
			source.u1,
			source.v1,
			command.z!,
			command.color!,
		);
		count += 1;
	}
	if (count !== 0) {
		flushWebGLInstanceBatch(backend, HOST_OVERLAY_DRAW_PASS, state, count, INSTANCE_FLOATS);
	}
	return currentBoundTextures;
}

function drawGlyphRunCommand(backend: WebGLBackend, state: HostOverlayRuntime, cache: Map<string, HostOverlayImageSource>, command: GlyphRenderSubmission, boundTextures: BoundTextureState): BoundTextureState {
	if (command.font === undefined) {
		throw new Error('[HostOverlay] Glyph command missing font.');
	}
	if (command.color === undefined) {
		throw new Error('[HostOverlay] Glyph command missing color.');
	}
	if (command.z === undefined) {
		throw new Error('[HostOverlay] Glyph command missing z.');
	}
	if (command.glyph_start === undefined) {
		throw new Error('[HostOverlay] Glyph command missing glyph_start.');
	}
	if (command.glyph_end === undefined) {
		throw new Error('[HostOverlay] Glyph command missing glyph_end.');
	}
	const lines = Array.isArray(command.glyphs) ? command.glyphs : [command.glyphs];
	let currentBoundTextures = drawGlyphRunBackgrounds(backend, state, command, lines, boundTextures);
	currentBoundTextures = drawGlyphRunGlyphs(backend, state, cache, command, lines, currentBoundTextures);
	return currentBoundTextures;
}

function bindPassState(backend: WebGLBackend, state: HostOverlayRuntime, passState: HostOverlayPipelineState): void {
	const gl = backend.gl as WebGL2RenderingContext;
	gl.useProgram(state.program);
	updateAndBindFrameUniforms(backend, {
		offscreen: { x: passState.width, y: passState.height },
		logical: { x: passState.overlayWidth, y: passState.overlayHeight },
		time: consoleCore.runtime.frameLoop.currentTimeMs / 1000,
		delta: consoleCore.deltatime_seconds,
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
	const gl = backend.gl as WebGL2RenderingContext;
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	bindPassState(backend, state, passState);
	const imageCache = state.imageCache;
	let boundTextures: BoundTextureState = null;
	for (let index = 0; index < passState.commands.length; index += 1) {
		const command = passState.commands[index];
		switch (command.type) {
			case 'rect':
				boundTextures = drawRectCommand(backend, state, command, boundTextures);
				break;
			case 'img':
				boundTextures = drawImageCommand(backend, state, imageCache, command, boundTextures);
				break;
			case 'glyphs':
				if (command.font === undefined) {
					throw new Error('[HostOverlay] Glyph submission missing font.');
				}
				boundTextures = drawGlyphRunCommand(backend, state, imageCache, command, boundTextures);
				break;
			case 'poly':
				throw new Error('[HostOverlay] Poly overlay rendering is not implemented.');
			case 'mesh':
				throw new Error('[HostOverlay] Mesh submissions are invalid in host overlay.');
			case 'particle':
				throw new Error('[HostOverlay] Particle submissions are invalid in host overlay.');
		}
	}
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
			const frame = hasPendingOverlayFrame() ? consumeOverlayFrame() : null;
			const state: HostOverlayPipelineState = {
				width: consoleCore.view.offscreenCanvasSize.x,
				height: consoleCore.view.offscreenCanvasSize.y,
				overlayWidth: frame?.width ?? consoleCore.view.viewportSize.x,
				overlayHeight: frame?.height ?? consoleCore.view.viewportSize.y,
				commands: frame?.commands ?? [],
			};
			registry.setState('host_overlay', state);
		},
		exec: (backend: WebGLBackend, _fbo, state: RenderPassStateRegistry['host_overlay']) => {
			renderHostPass(backend, runtime!, state);
		},
	});
}

export function registerHostOverlayPass_WebGPU(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_overlay',
		name: 'HostOverlay',
		stateOnly: true,
		shouldExecute: () => false,
		exec: () => { },
	});
}

export function registerHostOverlayPass_Headless(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_overlay',
		name: 'HeadlessHostOverlay',
		stateOnly: true,
		shouldExecute: () => {
			if (hasPendingOverlayFrame()) {
				consumeOverlayFrame();
			}
			return false;
		},
		exec: () => { },
	});
}
