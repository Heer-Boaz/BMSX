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
	TEXTURE_UNIT_TEXTPAGE_ENGINE,
	TEXTURE_UNIT_TEXTPAGE_PRIMARY,
	TEXTURE_UNIT_TEXTPAGE_SECONDARY,
} from '../backend/webgl/constants';
import {
	bindWebGLInstancedQuadVertexArray,
	createWebGLInstancedQuadRuntime,
	ensureWebGLInstanceBufferCapacity,
	flushWebGLInstanceBatch,
	type WebGLInstancedFloatAttribute,
	type WebGLSpriteQuadUniforms,
} from '../backend/webgl/instanced_buffers';
import { engineCore } from '../../core/engine';
import { Runtime } from '../../machine/runtime/runtime';
import { TAB_SPACES } from '../shared/bitmap_font';
import type { GlyphRenderSubmission, color } from '../shared/submissions';
import {
	TEXTPAGE_PRIMARY_SLOT_ID,
	TEXTPAGE_SECONDARY_SLOT_ID,
	BIOS_ATLAS_ID,
	BIOS_TEXTPAGE_TEXTURE_KEY,
} from '../../rompack/format';
import { VDP_SLOT_SYSTEM } from '../../machine/bus/io';
import type { BFont, FontGlyph } from '../shared/bitmap_font';
import { consumeOverlayFrame, hasPendingOverlayFrame } from './overlay_queue';
import vertexShaderCode from '../2d/shaders/2d.vert.glsl';
import fragmentShaderCode from '../2d/shaders/2d.frag.glsl';

type HostOverlayImageSource = {
	mode: 'slot' | 'single';
	texture: WebGLTexture | null;
	textpageId: number;
	u0: number;
	v0: number;
	u1: number;
	v1: number;
	width: number;
	height: number;
};

type BoundTextureState =
	| { mode: 'slot'; texture: null; }
	| { mode: 'single'; texture: WebGLTexture; }
	| { mode: 'none'; texture: null; };

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

const INSTANCE_FLOATS = 16;
const INSTANCE_STRIDE_BYTES = INSTANCE_FLOATS * 4;
const INITIAL_BATCH_CAPACITY = 256;
const SOLID_TEXCOORD_0 = 0;
const SOLID_TEXCOORD_1 = 1;
const HOST_OVERLAY_DRAW_PASS: PassEncoder = { fbo: null, desc: { label: 'host_overlay' } as RenderPassDesc };
const INSTANCE_FLOAT_ATTRIBUTES: readonly WebGLInstancedFloatAttribute[] = [
	['i_origin', 2, 0],
	['i_axis_x', 2, 2 * 4],
	['i_axis_y', 2, 4 * 4],
	['i_uv0', 2, 6 * 4],
	['i_uv1', 2, 8 * 4],
	['i_z', 1, 10 * 4],
	['i_fx', 1, 11 * 4],
	['i_color', 4, 12 * 4],
];

let runtime: HostOverlayRuntime | null = null;

function createRuntime(backend: WebGLBackend, program: WebGLProgram): HostOverlayRuntime {
	const gl = backend.gl as WebGL2RenderingContext;
	const vao = backend.createVertexArray() as WebGLVertexArrayObject;
	const quad = createWebGLInstancedQuadRuntime(backend, gl, program, INITIAL_BATCH_CAPACITY, INSTANCE_FLOATS);
	const whiteTexture = backend.createSolidTexture2D(1, 1, [1, 1, 1, 1]) as WebGLTexture;
	bindWebGLInstancedQuadVertexArray(backend, vao, program, quad, INSTANCE_STRIDE_BYTES, INSTANCE_FLOAT_ATTRIBUTES);
	return {
		gl,
		program,
		vao,
		...quad,
		whiteTexture,
	};
}

function destroyRuntime(runtimeToDestroy: HostOverlayRuntime): void {
	const gl = runtimeToDestroy.gl;
	gl.deleteBuffer(runtimeToDestroy.cornerBuffer);
	gl.deleteBuffer(runtimeToDestroy.instanceFloatBuffer);
	gl.deleteBuffer(runtimeToDestroy.instanceTextpageBuffer);
	gl.deleteVertexArray(runtimeToDestroy.vao);
	gl.deleteTexture(runtimeToDestroy.whiteTexture);
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

function writeQuad(state: HostOverlayRuntime, index: number, originX: number, originY: number, axisXX: number, axisXY: number, axisYX: number, axisYY: number, u0: number, v0: number, u1: number, v1: number, z: number, colorValue: color, textpageId: number): void {
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
	data[base + 10] = z;
	data[base + 11] = 0;
	data[base + 12] = colorValue.r;
	data[base + 13] = colorValue.g;
	data[base + 14] = colorValue.b;
	data[base + 15] = colorValue.a;
	state.textpageData[index] = textpageId;
}

function writeAxisAlignedQuad(state: HostOverlayRuntime, index: number, x: number, y: number, width: number, height: number, u0: number, v0: number, u1: number, v1: number, z: number, colorValue: color, textpageId: number): void {
	writeQuad(state, index, x, y, width, 0, 0, height, u0, v0, u1, v1, z, colorValue, textpageId);
}

function getUvExtents(coords: number[]): { u0: number; v0: number; u1: number; v1: number } {
	let minU = coords[0];
	let minV = coords[1];
	let maxU = coords[0];
	let maxV = coords[1];
	for (let index = 2; index < coords.length; index += 2) {
		const u = coords[index];
		const v = coords[index + 1];
		if (u < minU) minU = u;
		if (u > maxU) maxU = u;
		if (v < minV) minV = v;
		if (v > maxV) maxV = v;
	}
	return { u0: minU, v0: minV, u1: maxU, v1: maxV };
}

function resolveShaderTextpageId(textpageId: number): number {
	if (textpageId === BIOS_ATLAS_ID) {
		return VDP_SLOT_SYSTEM;
	}
	throw new Error(`[HostOverlay] Atlas ${textpageId} is not an engine overlay source.`);
}

function resolveImageSource(cache: Map<string, HostOverlayImageSource>, imgid: string): HostOverlayImageSource {
	const cached = cache.get(imgid);
	if (cached) {
		return cached;
	}
	const runtime = Runtime.instance;
	const meta = runtime.assets.getImageAsset(imgid, runtime.engineAssetSource).imgmeta;
	let source: HostOverlayImageSource;
	if (meta.atlasid !== undefined && meta.texcoords) {
		const uv = getUvExtents(meta.texcoords!);
		source = {
			mode: 'slot',
			texture: null,
			textpageId: resolveShaderTextpageId(meta.atlasid!),
			u0: uv.u0,
			v0: uv.v0,
			u1: uv.u1,
			v1: uv.v1,
			width: meta.width,
			height: meta.height,
		};
	} else {
		const texture = engineCore.texmanager.getTextureByUri(imgid) as WebGLTexture;
		if (!texture) {
			throw new Error(`[HostOverlay] Texture '${imgid}' is not uploaded.`);
		}
		source = {
			mode: 'single',
			texture,
			textpageId: 0,
			u0: 0,
			v0: 0,
			u1: 1,
			v1: 1,
			width: meta.width,
			height: meta.height,
		};
	}
	cache.set(imgid, source);
	return source;
}

function bindTextureTriple(texture0: WebGLTexture, texture1: WebGLTexture, texture2: WebGLTexture): void {
	engineCore.view.activeTexUnit = TEXTURE_UNIT_TEXTPAGE_PRIMARY;
	engineCore.view.bind2DTex(texture0);
	engineCore.view.activeTexUnit = TEXTURE_UNIT_TEXTPAGE_SECONDARY;
	engineCore.view.bind2DTex(texture1);
	engineCore.view.activeTexUnit = TEXTURE_UNIT_TEXTPAGE_ENGINE;
	engineCore.view.bind2DTex(texture2);
}

function bindSlotTextures(boundTextures: BoundTextureState): BoundTextureState {
	if (boundTextures.mode === 'slot') {
		return boundTextures;
	}
	const primary = engineCore.texmanager.getTextureByUri(TEXTPAGE_PRIMARY_SLOT_ID) as WebGLTexture;
	const secondary = engineCore.texmanager.getTextureByUri(TEXTPAGE_SECONDARY_SLOT_ID) as WebGLTexture;
	const engine = engineCore.texmanager.getTextureByUri(BIOS_TEXTPAGE_TEXTURE_KEY) as WebGLTexture;
	if (!primary || !secondary || !engine) {
		throw new Error('[HostOverlay] VDP slot textures are not initialized.');
	}
	bindTextureTriple(primary, secondary, engine);
	return { mode: 'slot', texture: null };
}

function bindSingleTexture(texture: WebGLTexture, boundTextures: BoundTextureState): BoundTextureState {
	if (boundTextures.mode === 'single' && boundTextures.texture === texture) {
		return boundTextures;
	}
	bindTextureTriple(texture, texture, texture);
	return { mode: 'single', texture };
}

function bindSolidTexture(runtimeState: HostOverlayRuntime, boundTextures: BoundTextureState): BoundTextureState {
	return bindSingleTexture(runtimeState.whiteTexture, boundTextures);
}

function bindSourceTexture(source: HostOverlayImageSource, boundTextures: BoundTextureState): BoundTextureState {
	if (source.mode === 'slot') {
		return bindSlotTextures(boundTextures);
	}
	return bindSingleTexture(source.texture!, boundTextures);
}

function applyFlip(source: HostOverlayImageSource, flipH: boolean, flipV: boolean): { u0: number; v0: number; u1: number; v1: number } {
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
	return { u0, v0, u1, v1 };
}

function pushFillRect(state: HostOverlayRuntime, index: number, leftValue: number, topValue: number, rightValue: number, bottomValue: number, z: number, colorValue: color): number {
	let left = Math.round(leftValue);
	let top = Math.round(topValue);
	let right = Math.round(rightValue);
	let bottom = Math.round(bottomValue);
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
	writeAxisAlignedQuad(state, index, left, top, width, height, SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, z, colorValue, 0);
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
	const source = resolveImageSource(cache, command.imgid);
	const nextBoundTextures = bindSourceTexture(source, boundTextures);
	const uv = applyFlip(source, command.flip!.flip_h, command.flip!.flip_v);
	const width = Math.max(1, Math.round(source.width * command.scale!.x));
	const height = Math.max(1, Math.round(source.height * command.scale!.y));
	writeAxisAlignedQuad(
		state,
		0,
		Math.round(command.pos.x),
		Math.round(command.pos.y),
		width,
		height,
		uv.u0,
		uv.v0,
		uv.u1,
		uv.v1,
		command.pos.z,
		command.colorize!,
		source.textpageId,
	);
	flushWebGLInstanceBatch(backend, HOST_OVERLAY_DRAW_PASS, state, 1, INSTANCE_FLOATS);
	return nextBoundTextures;
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
		baseX: Math.round(command.x),
		originX: Math.round(command.x),
		originY: Math.round(command.y),
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
	let currentBoundTextures = boundTextures;
	let batchSource: HostOverlayImageSource | null = null;
	let count = 0;
	const flushGlyphBatch = (): void => {
		if (count === 0) {
			return;
		}
		flushWebGLInstanceBatch(backend, HOST_OVERLAY_DRAW_PASS, state, count, INSTANCE_FLOATS);
		count = 0;
	};
	const cursor = createGlyphRunCursor(command, lines);
	while (nextGlyphRunGlyph(cursor)) {
		const glyph = cursor.glyph;
		const source = resolveImageSource(cache, glyph.imgid);
		if (batchSource === null
			|| batchSource.mode !== source.mode
			|| batchSource.texture !== source.texture
			|| batchSource.textpageId !== source.textpageId) {
			flushGlyphBatch();
			currentBoundTextures = bindSourceTexture(source, currentBoundTextures);
			batchSource = source;
		}
		ensureWebGLInstanceBufferCapacity(backend, state, count + 1, INSTANCE_FLOATS);
		writeAxisAlignedQuad(
			state,
			count,
			cursor.x,
			cursor.y,
			glyph.width,
			glyph.height,
			source.u0,
			source.v0,
			source.u1,
			source.v1,
			command.z!,
			command.color!,
			source.textpageId,
		);
		count += 1;
	}
	flushGlyphBatch();
	return currentBoundTextures;
}

function drawGlyphRunCommand(backend: WebGLBackend, state: HostOverlayRuntime, cache: Map<string, HostOverlayImageSource>, command: GlyphRenderSubmission, boundTextures: BoundTextureState): BoundTextureState {
	const lines = Array.isArray(command.glyphs) ? command.glyphs : [command.glyphs];
	let currentBoundTextures = drawGlyphRunBackgrounds(backend, state, command, lines, boundTextures);
	currentBoundTextures = drawGlyphRunGlyphs(backend, state, cache, command, lines, currentBoundTextures);
	return currentBoundTextures;
}

function bindPassState(backend: WebGLBackend, state: HostOverlayRuntime, passState: HostOverlayPipelineState): void {
	const gl = backend.gl as WebGL2RenderingContext;
	updateAndBindFrameUniforms(backend, {
		offscreen: { x: passState.width, y: passState.height },
		logical: { x: passState.overlayWidth, y: passState.overlayHeight },
		time: Runtime.instance.frameLoop.currentTimeMs / 1000,
		delta: engineCore.deltatime_seconds,
	});
	backend.setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
	gl.uniform1f(state.uniforms.scale, 1);
	gl.uniform4f(state.uniforms.parallaxRig, 0, 1, 0, 0);
	gl.uniform4f(state.uniforms.parallaxRig2, 0, 0, 0, 0);
	gl.uniform1f(state.uniforms.parallaxFlipWindow, 0);
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
	const imageCache = new Map<string, HostOverlayImageSource>();
	let boundTextures: BoundTextureState = { mode: 'none', texture: null };
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

export function registerHostOverlayPass_WebGL(registry: RenderPassLibrary): void {
	registry.register({
		id: 'host_overlay',
		name: 'HostOverlay',
		vsCode: vertexShaderCode,
		fsCode: fragmentShaderCode,
		present: true,
		bootstrap: (backend) => {
			bootstrapRuntime(backend as WebGLBackend);
		},
		shouldExecute: () => hasPendingOverlayFrame(),
		prepare: () => {
			const frame = consumeOverlayFrame()!;
			const state: HostOverlayPipelineState = {
				width: engineCore.view.offscreenCanvasSize.x,
				height: engineCore.view.offscreenCanvasSize.y,
				overlayWidth: frame.width,
				overlayHeight: frame.height,
				commands: frame.commands,
			};
			registry.setState('host_overlay', state);
		},
		exec: (backend: WebGLBackend, _fbo, state: RenderPassStateRegistry['host_overlay']) => {
			renderOverlay(backend, runtime!, state);
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
