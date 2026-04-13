import type { RenderPassLibrary } from '../backend/renderpasslib';
import type {
	HostOverlayPipelineState,
	PassEncoder,
	RenderPassDesc,
	RenderPassStateRegistry,
	RenderSubmission,
} from '../backend/pipeline_interfaces';
import { FRAME_UNIFORM_BINDING, updateAndBindFrameUniforms } from '../backend/frame_uniforms';
import { WebGLBackend } from '../backend/webgl/webgl_backend';
import {
	TEXTURE_UNIT_ATLAS_ENGINE,
	TEXTURE_UNIT_ATLAS_PRIMARY,
	TEXTURE_UNIT_ATLAS_SECONDARY,
} from '../backend/webgl/webgl.constants';
import { $ } from '../../core/engine_core';
import { Runtime } from '../../emulator/runtime';
import { TAB_SPACES } from '../shared/bitmap_font';
import type { GlyphRenderSubmission, color } from '../shared/render_types';
import {
	ATLAS_PRIMARY_SLOT_ID,
	ATLAS_SECONDARY_SLOT_ID,
	ENGINE_ATLAS_INDEX,
	ENGINE_ATLAS_TEXTURE_KEY,
} from '../../rompack/rompack';
import { consumeOverlayFrame, hasPendingOverlayFrame } from './editor_overlay_queue';
import vertexShaderCode from '../2d/shaders/2d.vert.glsl';
import fragmentShaderCode from '../2d/shaders/2d.frag.glsl';

type HostOverlayImageSource = {
	mode: 'atlas' | 'single';
	texture: WebGLTexture | null;
	atlasId: number;
	u0: number;
	v0: number;
	u1: number;
	v1: number;
	width: number;
	height: number;
};

type BoundTextureState =
	| { mode: 'atlas'; texture: null; }
	| { mode: 'single'; texture: WebGLTexture; }
	| { mode: 'none'; texture: null; };

type HostOverlayRuntime = {
	gl: WebGL2RenderingContext;
	program: WebGLProgram;
	vao: WebGLVertexArrayObject;
	cornerBuffer: WebGLBuffer;
	instanceFloatBuffer: WebGLBuffer;
	instanceAtlasBuffer: WebGLBuffer;
	floatData: Float32Array;
	atlasData: Uint8Array;
	capacity: number;
	whiteTexture: WebGLTexture;
	uScale: WebGLUniformLocation;
	uTexture0: WebGLUniformLocation;
	uTexture1: WebGLUniformLocation;
	uTexture2: WebGLUniformLocation;
	uParallaxRig: WebGLUniformLocation;
	uParallaxRig2: WebGLUniformLocation;
	uParallaxFlipWindow: WebGLUniformLocation;
};

const INSTANCE_FLOATS = 16;
const INSTANCE_STRIDE_BYTES = INSTANCE_FLOATS * 4;
const INITIAL_BATCH_CAPACITY = 256;
const SOLID_TEXCOORD_0 = 0;
const SOLID_TEXCOORD_1 = 1;
const HOST_OVERLAY_DRAW_PASS: PassEncoder = { fbo: null, desc: { label: 'host_overlay' } as RenderPassDesc };

let runtime: HostOverlayRuntime | null = null;

function bindFloatAttribute(backend: WebGLBackend, location: number, size: number, offset: number): void {
	backend.enableVertexAttrib(location);
	backend.vertexAttribPointer(location, size, backend.gl.FLOAT, false, INSTANCE_STRIDE_BYTES, offset);
	backend.vertexAttribDivisor(location, 1);
}

function createRuntime(backend: WebGLBackend, program: WebGLProgram): HostOverlayRuntime {
	const gl = backend.gl as WebGL2RenderingContext;
	const vao = backend.createVertexArray() as WebGLVertexArrayObject;
	const cornerBuffer = backend.createVertexBuffer(new Float32Array([
		0, 0,
		0, 1,
		1, 0,
		1, 0,
		0, 1,
		1, 1,
	]), 'static') as WebGLBuffer;
	const instanceFloatBuffer = backend.createVertexBuffer(new Float32Array(INITIAL_BATCH_CAPACITY * INSTANCE_FLOATS), 'dynamic') as WebGLBuffer;
	const instanceAtlasBuffer = backend.createVertexBuffer(new Uint8Array(INITIAL_BATCH_CAPACITY), 'dynamic') as WebGLBuffer;
	const whiteTexture = backend.createSolidTexture2D(1, 1, [1, 1, 1, 1]) as WebGLTexture;
	const uScale = gl.getUniformLocation(program, 'u_scale')!;
	const uTexture0 = gl.getUniformLocation(program, 'u_texture0')!;
	const uTexture1 = gl.getUniformLocation(program, 'u_texture1')!;
	const uTexture2 = gl.getUniformLocation(program, 'u_texture2')!;
	const uParallaxRig = gl.getUniformLocation(program, 'u_parallax_rig')!;
	const uParallaxRig2 = gl.getUniformLocation(program, 'u_parallax_rig2')!;
	const uParallaxFlipWindow = gl.getUniformLocation(program, 'u_parallax_flip_window')!;
	gl.uniform1f(uScale, 1);
	gl.uniform1i(uTexture0, TEXTURE_UNIT_ATLAS_PRIMARY);
	gl.uniform1i(uTexture1, TEXTURE_UNIT_ATLAS_SECONDARY);
	gl.uniform1i(uTexture2, TEXTURE_UNIT_ATLAS_ENGINE);
	backend.bindVertexArray(vao);
	backend.bindArrayBuffer(cornerBuffer);
	const aCorner = gl.getAttribLocation(program, 'a_corner');
	backend.enableVertexAttrib(aCorner);
	backend.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
	backend.bindArrayBuffer(instanceFloatBuffer);
	bindFloatAttribute(backend, gl.getAttribLocation(program, 'i_origin'), 2, 0);
	bindFloatAttribute(backend, gl.getAttribLocation(program, 'i_axis_x'), 2, 2 * 4);
	bindFloatAttribute(backend, gl.getAttribLocation(program, 'i_axis_y'), 2, 4 * 4);
	bindFloatAttribute(backend, gl.getAttribLocation(program, 'i_uv0'), 2, 6 * 4);
	bindFloatAttribute(backend, gl.getAttribLocation(program, 'i_uv1'), 2, 8 * 4);
	bindFloatAttribute(backend, gl.getAttribLocation(program, 'i_z'), 1, 10 * 4);
	bindFloatAttribute(backend, gl.getAttribLocation(program, 'i_fx'), 1, 11 * 4);
	bindFloatAttribute(backend, gl.getAttribLocation(program, 'i_color'), 4, 12 * 4);
	backend.bindArrayBuffer(instanceAtlasBuffer);
	const atlasLocation = gl.getAttribLocation(program, 'i_atlas_id');
	backend.enableVertexAttrib(atlasLocation);
	backend.vertexAttribIPointer(atlasLocation, 1, gl.UNSIGNED_BYTE, 1, 0);
	backend.vertexAttribDivisor(atlasLocation, 1);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(null);
	return {
		gl,
		program,
		vao,
		cornerBuffer,
		instanceFloatBuffer,
		instanceAtlasBuffer,
		floatData: new Float32Array(INITIAL_BATCH_CAPACITY * INSTANCE_FLOATS),
		atlasData: new Uint8Array(INITIAL_BATCH_CAPACITY),
		capacity: INITIAL_BATCH_CAPACITY,
		whiteTexture,
		uScale,
		uTexture0,
		uTexture1,
		uTexture2,
		uParallaxRig,
		uParallaxRig2,
		uParallaxFlipWindow,
	};
}

function destroyRuntime(runtimeToDestroy: HostOverlayRuntime): void {
	const gl = runtimeToDestroy.gl;
	gl.deleteBuffer(runtimeToDestroy.cornerBuffer);
	gl.deleteBuffer(runtimeToDestroy.instanceFloatBuffer);
	gl.deleteBuffer(runtimeToDestroy.instanceAtlasBuffer);
	gl.deleteVertexArray(runtimeToDestroy.vao);
	gl.deleteTexture(runtimeToDestroy.whiteTexture);
}

function ensureRuntime(backend: WebGLBackend): HostOverlayRuntime {
	const gl = backend.gl as WebGL2RenderingContext;
	const program = gl.getParameter(gl.CURRENT_PROGRAM) as WebGLProgram;
	if (!program) {
		throw new Error('[HostOverlay] No active WebGL program.');
	}
	if (runtime !== null && runtime.gl === gl && runtime.program === program) {
		return runtime;
	}
	if (runtime !== null) {
		destroyRuntime(runtime);
	}
	runtime = createRuntime(backend, program);
	return runtime;
}

function ensureCapacity(backend: WebGLBackend, state: HostOverlayRuntime, count: number): void {
	if (count <= state.capacity) {
		return;
	}
	let capacity = state.capacity;
	while (capacity < count) {
		capacity <<= 1;
	}
	state.capacity = capacity;
	state.floatData = new Float32Array(capacity * INSTANCE_FLOATS);
	state.atlasData = new Uint8Array(capacity);
	backend.bindArrayBuffer(state.instanceFloatBuffer);
	backend.updateVertexBuffer(state.instanceFloatBuffer, state.floatData, 0);
	backend.bindArrayBuffer(state.instanceAtlasBuffer);
	backend.updateVertexBuffer(state.instanceAtlasBuffer, state.atlasData, 0);
	backend.bindArrayBuffer(null);
}

function flushBatch(backend: WebGLBackend, state: HostOverlayRuntime, count: number): void {
	backend.bindArrayBuffer(state.instanceFloatBuffer);
	backend.updateVertexBuffer(state.instanceFloatBuffer, state.floatData.subarray(0, count * INSTANCE_FLOATS), 0);
	backend.bindArrayBuffer(state.instanceAtlasBuffer);
	backend.updateVertexBuffer(state.instanceAtlasBuffer, state.atlasData.subarray(0, count), 0);
	backend.drawInstanced(HOST_OVERLAY_DRAW_PASS, 6, count, 0, 0);
}

function writeQuad(state: HostOverlayRuntime, index: number, originX: number, originY: number, axisXX: number, axisXY: number, axisYX: number, axisYY: number, u0: number, v0: number, u1: number, v1: number, z: number, colorValue: color, atlasId: number): void {
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
	state.atlasData[index] = atlasId;
}

function writeAxisAlignedQuad(state: HostOverlayRuntime, index: number, x: number, y: number, width: number, height: number, u0: number, v0: number, u1: number, v1: number, z: number, colorValue: color, atlasId: number): void {
	writeQuad(state, index, x, y, width, 0, 0, height, u0, v0, u1, v1, z, colorValue, atlasId);
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

function resolveShaderAtlasId(atlasId: number): number {
	if (atlasId === ENGINE_ATLAS_INDEX) {
		return ENGINE_ATLAS_INDEX;
	}
	if (atlasId === $.view.primaryAtlasIdInSlot) {
		return 0;
	}
	if (atlasId === $.view.secondaryAtlasIdInSlot) {
		return 1;
	}
	throw new Error(`[HostOverlay] Atlas ${atlasId} is not mapped to an active slot.`);
}

function resolveImageSource(cache: Map<string, HostOverlayImageSource>, imgid: string): HostOverlayImageSource {
	const cached = cache.get(imgid);
	if (cached) {
		return cached;
	}
	const runtime = Runtime.instance;
	const handle = runtime.resolveAssetHandle(imgid);
	const meta = runtime.getImageMetaByHandle(handle);
	let source: HostOverlayImageSource;
	if (meta.atlassed) {
		const uv = getUvExtents(meta.texcoords!);
		source = {
			mode: 'atlas',
			texture: null,
			atlasId: resolveShaderAtlasId(meta.atlasid!),
			u0: uv.u0,
			v0: uv.v0,
			u1: uv.u1,
			v1: uv.v1,
			width: meta.width,
			height: meta.height,
		};
	} else {
		const texture = $.texmanager.getTextureByUri(imgid) as WebGLTexture;
		if (!texture) {
			throw new Error(`[HostOverlay] Texture '${imgid}' is not uploaded.`);
		}
		source = {
			mode: 'single',
			texture,
			atlasId: 0,
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
	$.view.activeTexUnit = TEXTURE_UNIT_ATLAS_PRIMARY;
	$.view.bind2DTex(texture0);
	$.view.activeTexUnit = TEXTURE_UNIT_ATLAS_SECONDARY;
	$.view.bind2DTex(texture1);
	$.view.activeTexUnit = TEXTURE_UNIT_ATLAS_ENGINE;
	$.view.bind2DTex(texture2);
}

function bindAtlasTextures(boundTextures: BoundTextureState): BoundTextureState {
	if (boundTextures.mode === 'atlas') {
		return boundTextures;
	}
	const primary = $.texmanager.getTextureByUri(ATLAS_PRIMARY_SLOT_ID) as WebGLTexture;
	const secondary = $.texmanager.getTextureByUri(ATLAS_SECONDARY_SLOT_ID) as WebGLTexture;
	const engine = $.texmanager.getTextureByUri(ENGINE_ATLAS_TEXTURE_KEY) as WebGLTexture;
	if (!primary || !secondary || !engine) {
		throw new Error('[HostOverlay] Atlas textures are not initialized.');
	}
	bindTextureTriple(primary, secondary, engine);
	return { mode: 'atlas', texture: null };
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
	if (source.mode === 'atlas') {
		return bindAtlasTextures(boundTextures);
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
			flushBatch(backend, state, written);
		}
		return nextBoundTextures;
	}
	let count = 0;
	count += pushFillRect(state, count, command.area.left, command.area.top, command.area.right, command.area.top + 1, command.area.z, command.color);
	count += pushFillRect(state, count, command.area.left, command.area.bottom - 1, command.area.right, command.area.bottom, command.area.z, command.color);
	count += pushFillRect(state, count, command.area.left, command.area.top, command.area.left + 1, command.area.bottom, command.area.z, command.color);
	count += pushFillRect(state, count, command.area.right - 1, command.area.top, command.area.right, command.area.bottom, command.area.z, command.color);
	if (count !== 0) {
		flushBatch(backend, state, count);
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
		source.atlasId,
	);
	flushBatch(backend, state, 1);
	return nextBoundTextures;
}

function drawGlyphRunBackgrounds(backend: WebGLBackend, state: HostOverlayRuntime, command: GlyphRenderSubmission, fontLineCount: number, glyphCount: number, lines: string[], boundTextures: BoundTextureState): BoundTextureState {
	if (command.background_color === undefined || glyphCount === 0) {
		return boundTextures;
	}
	const nextBoundTextures = bindSolidTexture(state, boundTextures);
	ensureCapacity(backend, state, glyphCount);
	let count = 0;
	let originY = Math.round(command.y);
	for (let lineIndex = 0; lineIndex < fontLineCount; lineIndex += 1) {
		const line = lines[lineIndex];
		let originX = Math.round(command.x);
		const start = Array.isArray(command.glyphs) ? 0 : command.glyph_start!;
		const end = Array.isArray(command.glyphs) ? line.length : command.glyph_end!;
		for (let index = start; index < line.length && index < end; index += 1) {
			const char = line.charAt(index);
			if (char === '\n') {
				originX = Math.round(command.x);
				originY += command.font!.lineHeight;
				continue;
			}
			if (char === '\t') {
				originX += command.font!.advance(' ') * TAB_SPACES;
				continue;
			}
			const glyph = command.font!.getGlyph(char);
			count += pushFillRect(state, count, originX, originY, originX + glyph.advance, originY + command.font!.lineHeight, command.z!, command.background_color);
			originX += glyph.advance;
		}
		originY += command.font!.lineHeight;
	}
	if (count !== 0) {
		flushBatch(backend, state, count);
	}
	return nextBoundTextures;
}

function drawGlyphRunGlyphs(backend: WebGLBackend, state: HostOverlayRuntime, cache: Map<string, HostOverlayImageSource>, command: GlyphRenderSubmission, fontLineCount: number, lines: string[], boundTextures: BoundTextureState): BoundTextureState {
	let currentBoundTextures = boundTextures;
	let batchSource: HostOverlayImageSource | null = null;
	let count = 0;
	const flushGlyphBatch = (): void => {
		if (count === 0) {
			return;
		}
		flushBatch(backend, state, count);
		count = 0;
	};
	let originY = Math.round(command.y);
	for (let lineIndex = 0; lineIndex < fontLineCount; lineIndex += 1) {
		const line = lines[lineIndex];
		let originX = Math.round(command.x);
		const start = Array.isArray(command.glyphs) ? 0 : command.glyph_start!;
		const end = Array.isArray(command.glyphs) ? line.length : command.glyph_end!;
		for (let index = start; index < line.length && index < end; index += 1) {
			const char = line.charAt(index);
			if (char === '\n') {
				originX = Math.round(command.x);
				originY += command.font!.lineHeight;
				continue;
			}
			if (char === '\t') {
				originX += command.font!.advance(' ') * TAB_SPACES;
				continue;
			}
			const glyph = command.font!.getGlyph(char);
			const source = resolveImageSource(cache, glyph.imgid);
			if (batchSource === null
				|| batchSource.mode !== source.mode
				|| batchSource.texture !== source.texture
				|| batchSource.atlasId !== source.atlasId) {
				flushGlyphBatch();
				currentBoundTextures = bindSourceTexture(source, currentBoundTextures);
				batchSource = source;
			}
			ensureCapacity(backend, state, count + 1);
			writeAxisAlignedQuad(
				state,
				count,
				originX,
				originY,
				glyph.width,
				glyph.height,
				source.u0,
				source.v0,
				source.u1,
				source.v1,
				command.z!,
				command.color!,
				source.atlasId,
			);
			count += 1;
			originX += glyph.advance;
		}
		originY += command.font!.lineHeight;
	}
	flushGlyphBatch();
	return currentBoundTextures;
}

function drawGlyphRunCommand(backend: WebGLBackend, state: HostOverlayRuntime, cache: Map<string, HostOverlayImageSource>, command: GlyphRenderSubmission, boundTextures: BoundTextureState): BoundTextureState {
	const lines = Array.isArray(command.glyphs) ? command.glyphs : [command.glyphs];
	let glyphCount = 0;
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const line = lines[lineIndex];
		const start = Array.isArray(command.glyphs) ? 0 : command.glyph_start!;
		const end = Array.isArray(command.glyphs) ? line.length : command.glyph_end!;
		for (let index = start; index < line.length && index < end; index += 1) {
			const char = line.charAt(index);
			if (char !== '\n' && char !== '\t') {
				glyphCount += 1;
			}
		}
	}
	let currentBoundTextures = drawGlyphRunBackgrounds(backend, state, command, lines.length, glyphCount, lines, boundTextures);
	currentBoundTextures = drawGlyphRunGlyphs(backend, state, cache, command, lines.length, lines, currentBoundTextures);
	return currentBoundTextures;
}

function bindPassState(backend: WebGLBackend, state: HostOverlayRuntime, passState: HostOverlayPipelineState): void {
	const gl = backend.gl as WebGL2RenderingContext;
	updateAndBindFrameUniforms(backend, {
		offscreen: { x: passState.width, y: passState.height },
		logical: { x: passState.overlayWidth, y: passState.overlayHeight },
		time: Runtime.instance.frameLoop.currentTimeMs / 1000,
		delta: $.deltatime_seconds,
	});
	backend.setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
	gl.uniform1f(state.uScale, 1);
	gl.uniform4f(state.uParallaxRig, 0, 1, 0, 0);
	gl.uniform4f(state.uParallaxRig2, 0, 0, 0, 0);
	gl.uniform1f(state.uParallaxFlipWindow, 0);
	backend.setViewport({ x: 0, y: 0, w: passState.width, h: passState.height });
	backend.setCullEnabled(false);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setBlendEnabled(true);
	backend.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	backend.bindVertexArray(state.vao);
}

function renderOverlay(backend: WebGLBackend, passState: HostOverlayPipelineState): void {
	const state = ensureRuntime(backend);
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
		shouldExecute: () => hasPendingOverlayFrame(),
		prepare: () => {
			const frame = consumeOverlayFrame()!;
			const state: HostOverlayPipelineState = {
				width: $.view.offscreenCanvasSize.x,
				height: $.view.offscreenCanvasSize.y,
				overlayWidth: frame.width,
				overlayHeight: frame.height,
				commands: frame.commands,
			};
			registry.setState('host_overlay', state);
		},
		exec: (backend: WebGLBackend, _fbo, state: RenderPassStateRegistry['host_overlay']) => {
			renderOverlay(backend, state);
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
