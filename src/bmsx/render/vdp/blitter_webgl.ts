import { $ } from '../../core/engine';
import { Runtime } from '../../machine/runtime/runtime';
import type {
	VdpBlitterBlitCommand as BlitterBlitCommand,
	VdpBlitterClearCommand as BlitterClearCommand,
	VdpBlitterCommand as VdpWebGLBlitterCommand,
	VdpBlitterCopyRectCommand as BlitterCopyRectCommand,
	VdpBlitterDrawLineCommand as BlitterDrawLineCommand,
	VdpBlitterExecutor,
	VdpBlitterFillRectCommand as BlitterFillRectCommand,
	VdpBlitterGlyphRunCommand as BlitterGlyphRunCommand,
	VdpBlitterHost as VdpWebGLBlitterHost,
	VdpBlitterTileRunCommand as BlitterTileRunCommand,
	VdpFrameBufferColor as FrameBufferColor,
} from '../../machine/devices/vdp/vdp';
import type { PassEncoder, RenderPassInstanceHandle } from '../backend/interfaces';
import { FRAME_UNIFORM_BINDING, updateAndBindFrameUniforms } from '../backend/frame_uniforms';
import { WebGLBackend } from '../backend/webgl/backend';
import {
	TEXTURE_UNIT_ATLAS_ENGINE,
	TEXTURE_UNIT_ATLAS_PRIMARY,
	TEXTURE_UNIT_ATLAS_SECONDARY,
} from '../backend/webgl/constants';
import { spriteParallaxRig } from '../2d/sprite_parallax_rig';
import fragmentShaderCode from './shaders/vdp_2d.frag.glsl';
import vertexShaderCode from './shaders/vdp_2d.vert.glsl';

type DrawMode = 'atlas' | 'solid';

type WebGLVdpBlitterRuntime = {
	gl: WebGL2RenderingContext;
	pipeline: RenderPassInstanceHandle;
	vao: WebGLVertexArrayObject;
	cornerBuffer: WebGLBuffer;
	instanceFloatBuffer: WebGLBuffer;
	instanceAtlasBuffer: WebGLBuffer;
	floatData: Float32Array;
	atlasData: Uint8Array;
	capacity: number;
	whiteTexture: WebGLTexture;
	priorityDepthTexture: WebGLTexture | null;
	priorityDepthWidth: number;
	priorityDepthHeight: number;
	copySnapshotTexture: WebGLTexture | null;
	copySnapshotWidth: number;
	copySnapshotHeight: number;
	uScale: WebGLUniformLocation;
	drawTargetHeight: number;
	uTexture0: WebGLUniformLocation;
	uTexture1: WebGLUniformLocation;
	uTexture2: WebGLUniformLocation;
	uParallaxRig: WebGLUniformLocation;
	uParallaxRig2: WebGLUniformLocation;
	uParallaxFlipWindow: WebGLUniformLocation;
	sortedCommands: VdpWebGLBlitterCommand[];
	rankedCommands: VdpWebGLBlitterCommand[];
	priorityDepthBySeq: Map<number, number>;
};

const INSTANCE_FLOATS = 17;
const INSTANCE_STRIDE_BYTES = INSTANCE_FLOATS * 4;
const INITIAL_BATCH_CAPACITY = 256;
const SOLID_TEXCOORD_0 = 0;
const SOLID_TEXCOORD_1 = 1;
const WHITE_COLOR: FrameBufferColor = { r: 255, g: 255, b: 255, a: 255 };

let runtime: WebGLVdpBlitterRuntime | null = null;

function ensureRuntime(backend: WebGLBackend): WebGLVdpBlitterRuntime {
	const gl = backend.gl as WebGL2RenderingContext;
	if (runtime !== null && runtime.gl === gl) {
		return runtime;
	}
	const pipeline = backend.createRenderPassInstance({
		label: 'VDPBlitter2D',
		vsCode: vertexShaderCode,
		fsCode: fragmentShaderCode,
	});
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
	const passStub: PassEncoder = { fbo: null, desc: { label: 'blitter_setup' } };
	backend.setGraphicsPipeline(passStub, pipeline);
	backend.setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
	const program = pipeline.backendData as WebGLProgram;
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
	bindFloatAttribute(backend, gl.getAttribLocation(program, 'i_priority'), 1, 12 * 4);
	bindFloatAttribute(backend, gl.getAttribLocation(program, 'i_color'), 4, 13 * 4);
	backend.bindArrayBuffer(instanceAtlasBuffer);
	const atlasLocation = gl.getAttribLocation(program, 'i_atlas_id');
	backend.enableVertexAttrib(atlasLocation);
	backend.vertexAttribIPointer(atlasLocation, 1, gl.UNSIGNED_BYTE, 1, 0);
	backend.vertexAttribDivisor(atlasLocation, 1);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(null);
	runtime = {
		gl,
		pipeline,
		vao,
		cornerBuffer,
		instanceFloatBuffer,
		instanceAtlasBuffer,
		floatData: new Float32Array(INITIAL_BATCH_CAPACITY * INSTANCE_FLOATS),
		atlasData: new Uint8Array(INITIAL_BATCH_CAPACITY),
		capacity: INITIAL_BATCH_CAPACITY,
		whiteTexture,
		priorityDepthTexture: null,
		priorityDepthWidth: 0,
		priorityDepthHeight: 0,
		copySnapshotTexture: null,
		copySnapshotWidth: 0,
		copySnapshotHeight: 0,
		uScale,
		drawTargetHeight: 0,
		uTexture0,
		uTexture1,
		uTexture2,
		uParallaxRig,
		uParallaxRig2,
		uParallaxFlipWindow,
		sortedCommands: [],
		rankedCommands: [],
		priorityDepthBySeq: new Map(),
	};
	return runtime;
}

function bindFloatAttribute(backend: WebGLBackend, location: number, size: number, offset: number): void {
	backend.enableVertexAttrib(location);
	backend.vertexAttribPointer(location, size, backend.gl.FLOAT, false, INSTANCE_STRIDE_BYTES, offset);
	backend.vertexAttribDivisor(location, 1);
}

function ensureCapacity(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, count: number): void {
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

function ensurePriorityDepthTexture(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, width: number, height: number): WebGLTexture {
	if (state.priorityDepthTexture !== null && state.priorityDepthWidth === width && state.priorityDepthHeight === height) {
		return state.priorityDepthTexture;
	}
	if (state.priorityDepthTexture !== null) {
		backend.destroyTexture(state.priorityDepthTexture);
	}
	state.priorityDepthTexture = backend.createDepthTexture({ width, height }) as WebGLTexture;
	state.priorityDepthWidth = width;
	state.priorityDepthHeight = height;
	return state.priorityDepthTexture;
}

function ensureCopySnapshotTexture(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, width: number, height: number): WebGLTexture {
	if (state.copySnapshotTexture !== null && state.copySnapshotWidth === width && state.copySnapshotHeight === height) {
		return state.copySnapshotTexture;
	}
	if (state.copySnapshotTexture !== null) {
		backend.destroyTexture(state.copySnapshotTexture);
	}
	state.copySnapshotTexture = backend.createColorTexture({ width, height }) as WebGLTexture;
	state.copySnapshotWidth = width;
	state.copySnapshotHeight = height;
	return state.copySnapshotTexture;
}

function compareByPriority(a: VdpWebGLBlitterCommand, b: VdpWebGLBlitterCommand): number {
	if (a.opcode === 'clear' || b.opcode === 'clear') {
		throw new Error('[VDPBlitter2D] Clear commands must not enter ranked draw batches.');
	}
	if (a.layer !== b.layer) {
		return a.layer - b.layer;
	}
	if (a.z !== b.z) {
		return a.z - b.z;
	}
	return a.seq - b.seq;
}

function bindPassState(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, pass: PassEncoder, host: VdpWebGLBlitterHost): void {
	const gl = backend.gl as WebGL2RenderingContext;
	backend.setGraphicsPipeline(pass, state.pipeline);
	backend.setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
	updateAndBindFrameUniforms(backend, {
		offscreen: { x: host.width, y: host.height },
		logical: { x: host.width, y: host.height },
		time: Runtime.instance.frameLoop.currentTimeMs / 1000,
		delta: $.deltatime_seconds,
	});
	gl.uniform1f(state.uScale, 1);
	state.drawTargetHeight = host.height;
	gl.uniform4f(state.uParallaxRig, spriteParallaxRig.vy, spriteParallaxRig.scale, spriteParallaxRig.impact, spriteParallaxRig.impact_t);
	gl.uniform4f(state.uParallaxRig2, spriteParallaxRig.bias_px, spriteParallaxRig.parallax_strength, spriteParallaxRig.scale_strength, spriteParallaxRig.flip_strength);
	gl.uniform1f(state.uParallaxFlipWindow, spriteParallaxRig.flip_window);
	backend.setViewport({ x: 0, y: 0, w: host.width, h: host.height });
	backend.setCullEnabled(false);
	backend.setDepthTestEnabled(true);
	backend.setDepthMask(true);
	backend.setDepthFunc(gl.LEQUAL);
	backend.setBlendEnabled(true);
	backend.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	backend.bindVertexArray(state.vao);
}

function bindTexturesForMode(host: VdpWebGLBlitterHost, state: WebGLVdpBlitterRuntime, mode: DrawMode): void {
	if (mode === 'solid') {
		$.view.activeTexUnit = TEXTURE_UNIT_ATLAS_PRIMARY;
		$.view.bind2DTex(state.whiteTexture);
		return;
	}
	const primary = $.texmanager.getTextureByUri(host.getSurface(1).textureKey)!;
	const secondary = $.texmanager.getTextureByUri(host.getSurface(2).textureKey)!;
	const engine = $.texmanager.getTextureByUri(host.getSurface(0).textureKey)!;
	$.view.activeTexUnit = TEXTURE_UNIT_ATLAS_PRIMARY;
	$.view.bind2DTex(primary);
	$.view.activeTexUnit = TEXTURE_UNIT_ATLAS_SECONDARY;
	$.view.bind2DTex(secondary);
	$.view.activeTexUnit = TEXTURE_UNIT_ATLAS_ENGINE;
	$.view.bind2DTex(engine);
}

function flushBatch(backend: WebGLBackend, pass: PassEncoder, state: WebGLVdpBlitterRuntime, count: number): void {
	backend.bindArrayBuffer(state.instanceFloatBuffer);
	backend.updateVertexBuffer(state.instanceFloatBuffer, state.floatData.subarray(0, count * INSTANCE_FLOATS), 0);
	backend.bindArrayBuffer(state.instanceAtlasBuffer);
	backend.updateVertexBuffer(state.instanceAtlasBuffer, state.atlasData.subarray(0, count), 0);
	backend.drawInstanced(pass, 6, count, 0, 0);
}

function flushPendingBatch(backend: WebGLBackend, pass: PassEncoder, state: WebGLVdpBlitterRuntime, count: number): number {
	if (count !== 0) {
		flushBatch(backend, pass, state, count);
	}
	return 0;
}

function writeQuad(state: WebGLVdpBlitterRuntime, index: number, originX: number, originY: number, axisXX: number, axisXY: number, axisYX: number, axisYY: number, u0: number, v0: number, u1: number, v1: number, z: number, fx: number, priorityDepth: number, color: FrameBufferColor, atlasId: number): void {
	const base = index * INSTANCE_FLOATS;
	const data = state.floatData;
	const drawOriginY = state.drawTargetHeight - originY;
	const drawAxisXY = -axisXY;
	const drawAxisYY = -axisYY;
	data[base + 0] = originX;
	data[base + 1] = drawOriginY;
	data[base + 2] = axisXX;
	data[base + 3] = drawAxisXY;
	data[base + 4] = axisYX;
	data[base + 5] = drawAxisYY;
	data[base + 6] = u0;
	data[base + 7] = v0;
	data[base + 8] = u1;
	data[base + 9] = v1;
	data[base + 10] = z;
	data[base + 11] = fx;
	data[base + 12] = priorityDepth;
	data[base + 13] = color.r / 255;
	data[base + 14] = color.g / 255;
	data[base + 15] = color.b / 255;
	data[base + 16] = color.a / 255;
	state.atlasData[index] = atlasId;
}

function writeAxisAlignedQuad(state: WebGLVdpBlitterRuntime, index: number, x: number, y: number, width: number, height: number, u0: number, v0: number, u1: number, v1: number, z: number, fx: number, priorityDepth: number, color: FrameBufferColor, atlasId: number): void {
	writeQuad(state, index, x, y, width, 0, 0, height, u0, v0, u1, v1, z, fx, priorityDepth, color, atlasId);
}

function appendFillCommand(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, index: number, command: BlitterFillRectCommand, priorityDepth: number): number {
	let left = Math.round(command.x0);
	let top = Math.round(command.y0);
	let right = Math.round(command.x1);
	let bottom = Math.round(command.y1);
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
	if (left === right || top === bottom) {
		return 0;
	}
	ensureCapacity(backend, state, index + 1);
	writeAxisAlignedQuad(state, index, left, top, right - left, bottom - top, SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, command.z, 0, priorityDepth, command.color, 0);
	return 1;
}

function appendLineCommand(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, index: number, command: BlitterDrawLineCommand, priorityDepth: number): number {
	const thickness = Math.max(1, Math.round(command.thickness));
	const dx = command.x1 - command.x0;
	const dy = command.y1 - command.y0;
	const length = Math.hypot(dx, dy);
	if (length === 0) {
		const half = thickness * 0.5;
		ensureCapacity(backend, state, index + 1);
		writeAxisAlignedQuad(state, index, command.x0 - half, command.y0 - half, thickness, thickness, SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, command.z, 0, priorityDepth, command.color, 0);
		return 1;
	}
	const tangentX = dx / length;
	const tangentY = dy / length;
	const normalX = -tangentY;
	const normalY = tangentX;
	const half = thickness * 0.5;
	const originX = command.x0 - tangentX * half - normalX * half;
	const originY = command.y0 - tangentY * half - normalY * half;
	ensureCapacity(backend, state, index + 1);
	writeQuad(state, index, originX, originY, dx + tangentX * thickness, dy + tangentY * thickness, normalX * thickness, normalY * thickness, SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, command.z, 0, priorityDepth, command.color, 0);
	return 1;
}

function appendBlitCommand(host: VdpWebGLBlitterHost, backend: WebGLBackend, state: WebGLVdpBlitterRuntime, index: number, command: BlitterBlitCommand, priorityDepth: number): number {
	const surface = host.getSurface(command.source.surfaceId);
	const dstWidth = Math.max(1, Math.round(command.source.width * command.scaleX));
	const dstHeight = Math.max(1, Math.round(command.source.height * command.scaleY));
	let u0 = command.source.srcX / surface.width;
	let v0 = command.source.srcY / surface.height;
	let u1 = (command.source.srcX + command.source.width) / surface.width;
	let v1 = (command.source.srcY + command.source.height) / surface.height;
	if (command.flipH) {
		const swap = u0;
		u0 = u1;
		u1 = swap;
	}
	if (command.flipV) {
		const swap = v0;
		v0 = v1;
		v1 = swap;
	}
	ensureCapacity(backend, state, index + 1);
	writeAxisAlignedQuad(
		state,
		index,
		Math.round(command.dstX),
		Math.round(command.dstY),
		dstWidth,
		dstHeight,
		u0,
		v0,
		u1,
			v1,
			command.z,
			command.parallaxWeight,
			priorityDepth,
			command.color,
			host.getShaderAtlasId(command.source.surfaceId),
		);
	return 1;
}

function appendGlyphRunBackground(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, index: number, command: BlitterGlyphRunCommand, priorityDepth: number): number {
	if (command.backgroundColor === null || command.glyphs.length === 0) {
		return 0;
	}
	ensureCapacity(backend, state, index + command.glyphs.length);
	for (let i = 0; i < command.glyphs.length; i += 1) {
		const glyph = command.glyphs[i];
		writeAxisAlignedQuad(
			state,
			index + i,
			glyph.dstX,
			glyph.dstY,
			glyph.advance,
			command.lineHeight,
			SOLID_TEXCOORD_0,
			SOLID_TEXCOORD_0,
			SOLID_TEXCOORD_1,
			SOLID_TEXCOORD_1,
			command.z,
			0,
			priorityDepth,
			command.backgroundColor,
			0,
		);
	}
	return command.glyphs.length;
}

function appendGlyphRunGlyphs(host: VdpWebGLBlitterHost, backend: WebGLBackend, state: WebGLVdpBlitterRuntime, index: number, command: BlitterGlyphRunCommand, priorityDepth: number): number {
	if (command.glyphs.length === 0) {
		return 0;
	}
	ensureCapacity(backend, state, index + command.glyphs.length);
	for (let i = 0; i < command.glyphs.length; i += 1) {
		const glyph = command.glyphs[i];
		const surface = host.getSurface(glyph.surfaceId);
		const u0 = glyph.srcX / surface.width;
		const v0 = glyph.srcY / surface.height;
		const u1 = (glyph.srcX + glyph.width) / surface.width;
		const v1 = (glyph.srcY + glyph.height) / surface.height;
		writeAxisAlignedQuad(state, index + i, glyph.dstX, glyph.dstY, glyph.width, glyph.height, u0, v0, u1, v1, command.z, 0, priorityDepth, command.color, host.getShaderAtlasId(glyph.surfaceId));
	}
	return command.glyphs.length;
}

function appendTileRunCommand(host: VdpWebGLBlitterHost, backend: WebGLBackend, state: WebGLVdpBlitterRuntime, index: number, command: BlitterTileRunCommand, priorityDepth: number): number {
	if (command.tiles.length === 0) {
		return 0;
	}
	ensureCapacity(backend, state, index + command.tiles.length);
	for (let i = 0; i < command.tiles.length; i += 1) {
		const tile = command.tiles[i];
		const surface = host.getSurface(tile.surfaceId);
		const u0 = tile.srcX / surface.width;
		const v0 = tile.srcY / surface.height;
		const u1 = (tile.srcX + tile.width) / surface.width;
		const v1 = (tile.srcY + tile.height) / surface.height;
		writeAxisAlignedQuad(state, index + i, tile.dstX, tile.dstY, tile.width, tile.height, u0, v0, u1, v1, command.z, 0, priorityDepth, WHITE_COLOR, host.getShaderAtlasId(tile.surfaceId));
	}
	return command.tiles.length;
}

function getPriorityDepth(priorityDepthBySeq: ReadonlyMap<number, number>, seq: number): number {
	const priorityDepth = priorityDepthBySeq.get(seq);
	if (priorityDepth === undefined) {
		throw new Error(`[VDPBlitter2D] Missing priority depth for command sequence ${seq}.`);
	}
	return priorityDepth;
}

function drawSortedSegment(host: VdpWebGLBlitterHost, backend: WebGLBackend, state: WebGLVdpBlitterRuntime, priorityDepthTexture: WebGLTexture, priorityDepthBySeq: ReadonlyMap<number, number>, commands: readonly VdpWebGLBlitterCommand[], start: number, end: number): void {
	if (start >= end) {
		return;
	}
	const sorted = state.sortedCommands;
	sorted.length = 0;
	for (let i = start; i < end; i += 1) {
		const command = commands[i];
		if (command.opcode === 'clear' || command.opcode === 'copy_rect') {
			continue;
		}
		sorted.push(command);
	}
	if (sorted.length === 0) {
		return;
	}
	sorted.sort(compareByPriority);
	const frameBufferTexture = $.texmanager.getTextureByUri(host.frameBufferTextureKey)!;
	const pass = backend.beginRenderPass({
		color: { tex: frameBufferTexture },
		depth: { tex: priorityDepthTexture },
	});
	bindPassState(backend, state, pass, host);
	let boundMode: DrawMode | null = null;
	let batchCount = 0;
	for (let i = 0; i < sorted.length; i += 1) {
		const command = sorted[i];
		if (command.opcode === 'clear' || command.opcode === 'copy_rect') {
			throw new Error('[VDPBlitter2D] Clear/copy commands must not be drawn inside sorted segments.');
		}
		if (command.opcode !== 'glyph_run') {
			const nextMode: DrawMode = command.opcode === 'fill_rect' || command.opcode === 'draw_line' ? 'solid' : 'atlas';
			if (boundMode !== nextMode) {
				batchCount = flushPendingBatch(backend, pass, state, batchCount);
				bindTexturesForMode(host, state, nextMode);
				boundMode = nextMode;
			}
		}
		const priorityDepth = getPriorityDepth(priorityDepthBySeq, command.seq);
		switch (command.opcode) {
			case 'blit':
				batchCount += appendBlitCommand(host, backend, state, batchCount, command, priorityDepth);
				break;
			case 'fill_rect':
				batchCount += appendFillCommand(backend, state, batchCount, command, priorityDepth);
				break;
			case 'draw_line':
				batchCount += appendLineCommand(backend, state, batchCount, command, priorityDepth);
				break;
			case 'glyph_run':
				if (command.backgroundColor !== null) {
					if (boundMode !== 'solid') {
						batchCount = flushPendingBatch(backend, pass, state, batchCount);
						bindTexturesForMode(host, state, 'solid');
						boundMode = 'solid';
					}
					batchCount += appendGlyphRunBackground(backend, state, batchCount, command, priorityDepth);
				}
				if (boundMode !== 'atlas') {
					batchCount = flushPendingBatch(backend, pass, state, batchCount);
					bindTexturesForMode(host, state, 'atlas');
					boundMode = 'atlas';
				}
				batchCount += appendGlyphRunGlyphs(host, backend, state, batchCount, command, priorityDepth);
				break;
			case 'tile_run':
				batchCount += appendTileRunCommand(host, backend, state, batchCount, command, priorityDepth);
				break;
		}
	}
	flushPendingBatch(backend, pass, state, batchCount);
	backend.bindVertexArray(null);
	backend.endRenderPass(pass);
	backend.setBlendEnabled(false);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(true);
}

function resetPriorityDepthSurface(host: VdpWebGLBlitterHost, backend: WebGLBackend, priorityDepthTexture: WebGLTexture): void {
	const frameBufferTexture = $.texmanager.getTextureByUri(host.frameBufferTextureKey)!;
	const pass = backend.beginRenderPass({
		color: { tex: frameBufferTexture },
		depth: { tex: priorityDepthTexture, clearDepth: 1 },
	});
	backend.endRenderPass(pass);
}

function clearFrameBuffer(host: VdpWebGLBlitterHost, backend: WebGLBackend, priorityDepthTexture: WebGLTexture, command: BlitterClearCommand): void {
	const frameBufferTexture = $.texmanager.getTextureByUri(host.frameBufferTextureKey)!;
	const pass = backend.beginRenderPass({
		color: {
			tex: frameBufferTexture,
			clear: [
				command.color.r / 255,
				command.color.g / 255,
				command.color.b / 255,
				command.color.a / 255,
			],
		},
		depth: { tex: priorityDepthTexture, clearDepth: 1 },
	});
	backend.endRenderPass(pass);
}

function copyFrameBufferRect(host: VdpWebGLBlitterHost, backend: WebGLBackend, state: WebGLVdpBlitterRuntime, priorityDepthTexture: WebGLTexture, priorityDepthBySeq: ReadonlyMap<number, number>, command: BlitterCopyRectCommand): void {
	const frameBufferTexture = $.texmanager.getTextureByUri(host.frameBufferTextureKey)! as WebGLTexture;
	const copySnapshotTexture = ensureCopySnapshotTexture(backend, state, host.width, host.height);
	backend.copyTexture(frameBufferTexture, copySnapshotTexture, host.width, host.height);
	const pass = backend.beginRenderPass({
		color: { tex: frameBufferTexture },
		depth: { tex: priorityDepthTexture },
	});
	bindPassState(backend, state, pass, host);
	$.view.activeTexUnit = TEXTURE_UNIT_ATLAS_PRIMARY;
	$.view.bind2DTex(copySnapshotTexture);
	backend.setDepthFunc(backend.gl.ALWAYS);
	backend.setBlendEnabled(false);
	writeAxisAlignedQuad(
		state,
		0,
		command.dstX,
		command.dstY,
		command.width,
		command.height,
		command.srcX / host.width,
		command.srcY / host.height,
		(command.srcX + command.width) / host.width,
		(command.srcY + command.height) / host.height,
		command.z,
		0,
		getPriorityDepth(priorityDepthBySeq, command.seq),
		WHITE_COLOR,
		0,
	);
	flushBatch(backend, pass, state, 1);
	backend.bindVertexArray(null);
	backend.endRenderPass(pass);
	backend.setBlendEnabled(false);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(true);
}

function buildPriorityDepthBySequence(state: WebGLVdpBlitterRuntime, commands: readonly VdpWebGLBlitterCommand[]): ReadonlyMap<number, number> {
	const ranked = state.rankedCommands;
	ranked.length = 0;
	for (let i = 0; i < commands.length; i += 1) {
		const command = commands[i];
		if (command.opcode !== 'clear') {
			ranked.push(command);
		}
	}
	ranked.sort(compareByPriority);
	const priorityDepthBySeq = state.priorityDepthBySeq;
	priorityDepthBySeq.clear();
	const rankCount = ranked.length;
	for (let rank = 0; rank < rankCount; rank += 1) {
		priorityDepthBySeq.set(ranked[rank].seq, (rankCount - rank) / (rankCount + 1));
	}
	return priorityDepthBySeq;
}

export class WebGLVdpBlitterExecutor implements VdpBlitterExecutor {
	public readonly backendType = 'webgl2' as const;

	public constructor(
		private readonly backend: WebGLBackend,
	) {
	}

	public execute(host: VdpWebGLBlitterHost, commands: readonly VdpWebGLBlitterCommand[]): void {
		if (commands.length === 0) {
			return;
		}
		const state = ensureRuntime(this.backend);
		const priorityDepthTexture = ensurePriorityDepthTexture(this.backend, state, host.width, host.height);
		const priorityDepthBySeq = buildPriorityDepthBySequence(state, commands);
		resetPriorityDepthSurface(host, this.backend, priorityDepthTexture);
		let segmentStart = 0;
		for (let i = 0; i < commands.length; i += 1) {
			const command = commands[i];
			if (command.opcode === 'clear') {
				drawSortedSegment(host, this.backend, state, priorityDepthTexture, priorityDepthBySeq, commands, segmentStart, i);
				clearFrameBuffer(host, this.backend, priorityDepthTexture, command);
				segmentStart = i + 1;
				continue;
			}
			if (command.opcode !== 'copy_rect') {
				continue;
			}
			drawSortedSegment(host, this.backend, state, priorityDepthTexture, priorityDepthBySeq, commands, segmentStart, i);
			copyFrameBufferRect(host, this.backend, state, priorityDepthTexture, priorityDepthBySeq, command);
			segmentStart = i + 1;
		}
		drawSortedSegment(host, this.backend, state, priorityDepthTexture, priorityDepthBySeq, commands, segmentStart, commands.length);
	}
}
