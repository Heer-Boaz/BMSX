import type { VdpBlitterCommand, VdpHostOutput } from '../../../machine/devices/vdp/vdp';
import {
	VDP_BLITTER_IMPLICIT_CLEAR,
	VDP_BLITTER_OPCODE_BLIT,
	VDP_BLITTER_OPCODE_CLEAR,
	VDP_BLITTER_OPCODE_COPY_RECT,
	VDP_BLITTER_OPCODE_DRAW_LINE,
	VDP_BLITTER_OPCODE_FILL_RECT,
	VDP_BLITTER_OPCODE_GLYPH_RUN,
	VDP_BLITTER_WHITE,
} from '../../../machine/devices/vdp/blitter';
import type { PassEncoder, RenderPassInstanceHandle, TextureParams } from '../../backend/interfaces';
import { FRAME_UNIFORM_BINDING, updateAndBindFrameUniforms } from '../../backend/frame_uniforms';
import { WebGLBackend } from '../../backend/webgl/backend';
import {
	TEXTURE_UNIT_TEXTPAGE_ENGINE,
	TEXTURE_UNIT_TEXTPAGE_PRIMARY,
	TEXTURE_UNIT_TEXTPAGE_SECONDARY,
} from '../../backend/webgl/constants';
import {
	bindWebGLInstancedQuadVertexArray,
	createWebGLInstancedQuadRuntime,
	ensureWebGLInstanceBufferCapacity,
	flushWebGLInstanceBatch,
	type WebGLInstancedFloatAttribute,
	type WebGLSpriteQuadUniforms,
} from '../../backend/webgl/instanced_buffers';
import fragmentShaderCode from '../shaders/vdp_2d.frag.glsl';
import vertexShaderCode from '../shaders/vdp_2d.vert.glsl';
import { vdpRenderFrameBufferTexture } from '../framebuffer';
import {
	getVdpRenderSurfaceTexture,
	resolveVdpRenderSurface,
	resolveVdpSurfaceSlotBinding,
} from '../surfaces';
import { registerVdpBlitterExecutorFactory } from './index';

type DrawMode = 'slot' | 'solid';

type WebGLVdpBlitterRuntime = {
	gl: WebGL2RenderingContext;
	pipeline: RenderPassInstanceHandle;
	vao: WebGLVertexArrayObject;
	cornerBuffer: WebGLBuffer;
	instanceFloatBuffer: WebGLBuffer;
	instanceTextpageBuffer: WebGLBuffer;
	floatData: Float32Array;
	textpageData: Uint8Array;
	capacity: number;
	whiteTexture: WebGLTexture;
	priorityDepthTexture: WebGLTexture | null;
	priorityDepthWidth: number;
	priorityDepthHeight: number;
	copySnapshotTexture: WebGLTexture | null;
	copySnapshotWidth: number;
	copySnapshotHeight: number;
	drawTargetHeight: number;
	uniforms: WebGLSpriteQuadUniforms;
	rankedIndices: number[];
	priorityDepthBySeq: Map<number, number>;
};

const INSTANCE_FLOATS = 15;
const INSTANCE_STRIDE_BYTES = INSTANCE_FLOATS * 4;
const INITIAL_BATCH_CAPACITY = 256;
const SOLID_TEXCOORD_0 = 0;
const SOLID_TEXCOORD_1 = 1;
const DEFAULT_TEXTURE_PARAMS: TextureParams = {};
const INSTANCE_FLOAT_ATTRIBUTES: readonly WebGLInstancedFloatAttribute[] = [
	['i_origin', 2, 0],
	['i_axis_x', 2, 2 * 4],
	['i_axis_y', 2, 4 * 4],
	['i_uv0', 2, 6 * 4],
	['i_uv1', 2, 8 * 4],
	['i_priority', 1, 10 * 4],
	['i_color', 4, 11 * 4],
];

function createRuntime(backend: WebGLBackend): WebGLVdpBlitterRuntime {
	const gl = backend.gl as WebGL2RenderingContext;
	const pipeline = backend.createRenderPassInstance({
		label: 'VDPBlitter2D',
		vsCode: vertexShaderCode,
		fsCode: fragmentShaderCode,
	});
	const vao = backend.createVertexArray() as WebGLVertexArrayObject;
	const passStub: PassEncoder = { fbo: null, desc: { label: 'blitter_setup' } };
	backend.setGraphicsPipeline(passStub, pipeline);
	backend.setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
	const program = pipeline.backendData as WebGLProgram;
	const quad = createWebGLInstancedQuadRuntime(backend, gl, program, INITIAL_BATCH_CAPACITY, INSTANCE_FLOATS);
	const whiteTexture = backend.createSolidTexture2D(1, 1, [1, 1, 1, 1]) as WebGLTexture;
	bindWebGLInstancedQuadVertexArray(backend, vao, program, quad, INSTANCE_STRIDE_BYTES, INSTANCE_FLOAT_ATTRIBUTES);
	return {
		gl,
		pipeline,
		vao,
		...quad,
		whiteTexture,
		priorityDepthTexture: null,
		priorityDepthWidth: 0,
		priorityDepthHeight: 0,
		copySnapshotTexture: null,
		copySnapshotWidth: 0,
		copySnapshotHeight: 0,
		drawTargetHeight: 0,
		uniforms: quad.uniforms,
		rankedIndices: [],
		priorityDepthBySeq: new Map(),
	};
}

function preparePriorityDepthTexture(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, width: number, height: number): WebGLTexture {
	const texture = state.priorityDepthTexture;
	if (texture !== null && state.priorityDepthWidth === width && state.priorityDepthHeight === height) {
		return texture;
	}
	if (texture !== null) {
		backend.destroyTexture(texture);
	}
	const nextTexture = backend.createDepthTexture({ width, height }) as WebGLTexture;
	state.priorityDepthTexture = nextTexture;
	state.priorityDepthWidth = width;
	state.priorityDepthHeight = height;
	return nextTexture;
}

function prepareCopySnapshotTexture(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, width: number, height: number): WebGLTexture {
	let texture = state.copySnapshotTexture;
	if (texture === null) {
		texture = backend.createColorTexture({ width, height }) as WebGLTexture;
		state.copySnapshotTexture = texture;
	} else if (state.copySnapshotWidth !== width || state.copySnapshotHeight !== height) {
		backend.resizeTexture(texture, width, height, DEFAULT_TEXTURE_PARAMS);
	}
	state.copySnapshotWidth = width;
	state.copySnapshotHeight = height;
	return texture;
}

function commandCompare(commands: VdpBlitterCommand, left: number, right: number): number {
	if (commands.layer[left] !== commands.layer[right]) {
		return commands.layer[left] - commands.layer[right];
	}
	if (commands.priority[left] !== commands.priority[right]) {
		return commands.priority[left] - commands.priority[right];
	}
	return commands.seq[left] - commands.seq[right];
}

function bindPassState(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, pass: PassEncoder, output: VdpHostOutput): void {
	const gl = backend.gl as WebGL2RenderingContext;
	const frameBufferWidth = output.frameBufferWidth;
	const frameBufferHeight = output.frameBufferHeight;
	backend.setGraphicsPipeline(pass, state.pipeline);
	backend.setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
	updateAndBindFrameUniforms(backend, {
		offscreen: { x: frameBufferWidth, y: frameBufferHeight },
		logical: { x: frameBufferWidth, y: frameBufferHeight },
		time: 0,
		delta: 0,
	});
	gl.uniform1f(state.uniforms.scale, 1);
	state.drawTargetHeight = frameBufferHeight;
	backend.setViewport({ x: 0, y: 0, w: frameBufferWidth, h: frameBufferHeight });
	backend.setCullEnabled(false);
	backend.setDepthTestEnabled(true);
	backend.setDepthMask(true);
	backend.setDepthFunc(gl.LEQUAL);
	backend.setBlendEnabled(true);
	backend.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	backend.bindVertexArray(state.vao);
}

function bindVdpTexture(backend: WebGLBackend, unit: number, texture: WebGLTexture): void {
	backend.setActiveTexture(unit);
	backend.bindTexture2D(texture);
}

function bindTexturesForMode(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, mode: DrawMode): void {
	if (mode === 'solid') {
		bindVdpTexture(backend, TEXTURE_UNIT_TEXTPAGE_PRIMARY, state.whiteTexture);
		return;
	}
	bindVdpTexture(backend, TEXTURE_UNIT_TEXTPAGE_PRIMARY, getVdpRenderSurfaceTexture(1)!);
	bindVdpTexture(backend, TEXTURE_UNIT_TEXTPAGE_SECONDARY, getVdpRenderSurfaceTexture(2)!);
	bindVdpTexture(backend, TEXTURE_UNIT_TEXTPAGE_ENGINE, getVdpRenderSurfaceTexture(0)!);
}

function flushPendingBatch(backend: WebGLBackend, pass: PassEncoder, state: WebGLVdpBlitterRuntime, count: number): number {
	if (count !== 0) {
		flushWebGLInstanceBatch(backend, pass, state, count, INSTANCE_FLOATS);
	}
	return 0;
}

function writeQuad(state: WebGLVdpBlitterRuntime, index: number, originX: number, originY: number, axisXX: number, axisXY: number, axisYX: number, axisYY: number, u0: number, v0: number, u1: number, v1: number, priorityDepth: number, colorWord: number, textpageId: number): void {
	const base = index * INSTANCE_FLOATS;
	const data = state.floatData;
	data[base + 0] = originX;
	data[base + 1] = state.drawTargetHeight - originY;
	data[base + 2] = axisXX;
	data[base + 3] = -axisXY;
	data[base + 4] = axisYX;
	data[base + 5] = -axisYY;
	data[base + 6] = u0;
	data[base + 7] = v0;
	data[base + 8] = u1;
	data[base + 9] = v1;
	data[base + 10] = priorityDepth;
	data[base + 11] = ((colorWord >>> 16) & 0xff) / 255;
	data[base + 12] = ((colorWord >>> 8) & 0xff) / 255;
	data[base + 13] = (colorWord & 0xff) / 255;
	data[base + 14] = ((colorWord >>> 24) & 0xff) / 255;
	state.textpageData[index] = textpageId;
}

function appendFillCommand(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, commands: VdpBlitterCommand, commandIndex: number, batchIndex: number, priorityDepth: number): number {
	let left = Math.round(commands.x0[commandIndex]);
	let top = Math.round(commands.y0[commandIndex]);
	let right = Math.round(commands.x1[commandIndex]);
	let bottom = Math.round(commands.y1[commandIndex]);
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
	ensureWebGLInstanceBufferCapacity(backend, state, batchIndex + 1, INSTANCE_FLOATS);
	writeQuad(state, batchIndex, left, top, right - left, 0, 0, bottom - top, SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, priorityDepth, commands.colorWord[commandIndex], 0);
	return 1;
}

function appendLineCommand(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, commands: VdpBlitterCommand, commandIndex: number, batchIndex: number, priorityDepth: number): number {
	const dx = commands.x1[commandIndex] - commands.x0[commandIndex];
	const dy = commands.y1[commandIndex] - commands.y0[commandIndex];
	const thickness = commands.thickness[commandIndex];
	const length = Math.hypot(dx, dy);
	ensureWebGLInstanceBufferCapacity(backend, state, batchIndex + 1, INSTANCE_FLOATS);
	if (length === 0) {
		const half = thickness * 0.5;
		writeQuad(state, batchIndex, commands.x0[commandIndex] - half, commands.y0[commandIndex] - half, thickness, 0, 0, thickness, SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, priorityDepth, commands.colorWord[commandIndex], 0);
		return 1;
	}
	const tangentX = dx / length;
	const tangentY = dy / length;
	const normalX = -tangentY;
	const normalY = tangentX;
	const half = thickness * 0.5;
	writeQuad(state, batchIndex, commands.x0[commandIndex] - tangentX * half - normalX * half, commands.y0[commandIndex] - tangentY * half - normalY * half, dx + tangentX * thickness, dy + tangentY * thickness, normalX * thickness, normalY * thickness, SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, priorityDepth, commands.colorWord[commandIndex], 0);
	return 1;
}

function appendBlitCommand(output: VdpHostOutput, backend: WebGLBackend, state: WebGLVdpBlitterRuntime, commands: VdpBlitterCommand, commandIndex: number, batchIndex: number, priorityDepth: number): number {
	const surfaceId = commands.sourceSurfaceId[commandIndex];
	const surface = resolveVdpRenderSurface(output, surfaceId);
	let u0 = commands.sourceSrcX[commandIndex] / surface.width;
	let v0 = commands.sourceSrcY[commandIndex] / surface.height;
	let u1 = (commands.sourceSrcX[commandIndex] + commands.sourceWidth[commandIndex]) / surface.width;
	let v1 = (commands.sourceSrcY[commandIndex] + commands.sourceHeight[commandIndex]) / surface.height;
	if (commands.flipH[commandIndex] !== 0) {
		const swap = u0;
		u0 = u1;
		u1 = swap;
	}
	if (commands.flipV[commandIndex] !== 0) {
		const swap = v0;
		v0 = v1;
		v1 = swap;
	}
	ensureWebGLInstanceBufferCapacity(backend, state, batchIndex + 1, INSTANCE_FLOATS);
	writeQuad(state, batchIndex, commands.dstX[commandIndex], commands.dstY[commandIndex], commands.sourceWidth[commandIndex] * commands.scaleX[commandIndex], 0, 0, commands.sourceHeight[commandIndex] * commands.scaleY[commandIndex], u0, v0, u1, v1, priorityDepth, commands.colorWord[commandIndex], resolveVdpSurfaceSlotBinding(surfaceId));
	return 1;
}

function appendGlyphBackground(backend: WebGLBackend, state: WebGLVdpBlitterRuntime, commands: VdpBlitterCommand, commandIndex: number, firstGlyph: number, glyphEnd: number, glyphCount: number, batchIndex: number, priorityDepth: number): number {
	if (commands.hasBackgroundColor[commandIndex] === 0) {
		return 0;
	}
	ensureWebGLInstanceBufferCapacity(backend, state, batchIndex + glyphCount, INSTANCE_FLOATS);
	let written = 0;
	for (let glyphIndex = firstGlyph; glyphIndex < glyphEnd; glyphIndex += 1) {
		writeQuad(state, batchIndex + written, commands.glyphDstX[glyphIndex], commands.glyphDstY[glyphIndex], commands.glyphAdvance[glyphIndex], 0, 0, commands.lineHeight[commandIndex], SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, priorityDepth, commands.backgroundColorWord[commandIndex], 0);
		written += 1;
	}
	return written;
}

function appendGlyphs(output: VdpHostOutput, backend: WebGLBackend, state: WebGLVdpBlitterRuntime, commands: VdpBlitterCommand, commandIndex: number, firstGlyph: number, glyphEnd: number, glyphCount: number, batchIndex: number, priorityDepth: number): number {
	ensureWebGLInstanceBufferCapacity(backend, state, batchIndex + glyphCount, INSTANCE_FLOATS);
	let written = 0;
	for (let glyphIndex = firstGlyph; glyphIndex < glyphEnd; glyphIndex += 1) {
		const surfaceId = commands.glyphSurfaceId[glyphIndex];
		const surface = resolveVdpRenderSurface(output, surfaceId);
		const u0 = commands.glyphSrcX[glyphIndex] / surface.width;
		const v0 = commands.glyphSrcY[glyphIndex] / surface.height;
		const u1 = (commands.glyphSrcX[glyphIndex] + commands.glyphWidth[glyphIndex]) / surface.width;
		const v1 = (commands.glyphSrcY[glyphIndex] + commands.glyphHeight[glyphIndex]) / surface.height;
		writeQuad(state, batchIndex + written, commands.glyphDstX[glyphIndex], commands.glyphDstY[glyphIndex], commands.glyphWidth[glyphIndex], 0, 0, commands.glyphHeight[glyphIndex], u0, v0, u1, v1, priorityDepth, commands.colorWord[commandIndex], resolveVdpSurfaceSlotBinding(surfaceId));
		written += 1;
	}
	return written;
}

function appendTiles(output: VdpHostOutput, backend: WebGLBackend, state: WebGLVdpBlitterRuntime, commands: VdpBlitterCommand, commandIndex: number, batchIndex: number, priorityDepth: number): number {
	const firstTile = commands.tileRunFirstEntry[commandIndex];
	const tileEnd = firstTile + commands.tileRunEntryCount[commandIndex];
	ensureWebGLInstanceBufferCapacity(backend, state, batchIndex + commands.tileRunEntryCount[commandIndex], INSTANCE_FLOATS);
	let written = 0;
	for (let tileIndex = firstTile; tileIndex < tileEnd; tileIndex += 1) {
		const surfaceId = commands.tileSurfaceId[tileIndex];
		const surface = resolveVdpRenderSurface(output, surfaceId);
		const u0 = commands.tileSrcX[tileIndex] / surface.width;
		const v0 = commands.tileSrcY[tileIndex] / surface.height;
		const u1 = (commands.tileSrcX[tileIndex] + commands.tileWidth[tileIndex]) / surface.width;
		const v1 = (commands.tileSrcY[tileIndex] + commands.tileHeight[tileIndex]) / surface.height;
		writeQuad(state, batchIndex + written, commands.tileDstX[tileIndex], commands.tileDstY[tileIndex], commands.tileWidth[tileIndex], 0, 0, commands.tileHeight[tileIndex], u0, v0, u1, v1, priorityDepth, VDP_BLITTER_WHITE, resolveVdpSurfaceSlotBinding(surfaceId));
		written += 1;
	}
	return written;
}

function buildPriorityDepthBySequence(state: WebGLVdpBlitterRuntime, commands: VdpBlitterCommand): ReadonlyMap<number, number> {
	const ranked = state.rankedIndices;
	ranked.length = 0;
	for (let index = 0; index < commands.length; index += 1) {
		if (commands.opcode[index] !== VDP_BLITTER_OPCODE_CLEAR) {
			ranked.push(index);
		}
	}
	ranked.sort((left, right) => commandCompare(commands, left, right));
	const priorityDepthBySeq = state.priorityDepthBySeq;
	priorityDepthBySeq.clear();
	const rankCount = ranked.length;
	for (let rank = 0; rank < rankCount; rank += 1) {
		priorityDepthBySeq.set(commands.seq[ranked[rank]], (rankCount - rank) / (rankCount + 1));
	}
	return priorityDepthBySeq;
}

function getPriorityDepth(priorityDepthBySeq: ReadonlyMap<number, number>, seq: number): number {
	const priorityDepth = priorityDepthBySeq.get(seq);
	if (priorityDepth === undefined) {
		throw new Error(`[VDPBlitter2D] Missing priority depth for command sequence ${seq}.`);
	}
	return priorityDepth;
}

function clearFrameBuffer(backend: WebGLBackend, priorityDepthTexture: WebGLTexture, colorWord: number): void {
	const frameBufferTexture = vdpRenderFrameBufferTexture();
	const pass = backend.beginRenderPass({
		color: {
			tex: frameBufferTexture,
			clear: [
				((colorWord >>> 16) & 0xff) / 255,
				((colorWord >>> 8) & 0xff) / 255,
				(colorWord & 0xff) / 255,
				((colorWord >>> 24) & 0xff) / 255,
			],
		},
		depth: { tex: priorityDepthTexture, clearDepth: 1 },
	});
	backend.endRenderPass(pass);
}

function copyFrameBufferRect(output: VdpHostOutput, backend: WebGLBackend, state: WebGLVdpBlitterRuntime, priorityDepthTexture: WebGLTexture, priorityDepthBySeq: ReadonlyMap<number, number>, commands: VdpBlitterCommand, commandIndex: number): void {
	const frameBufferTexture = vdpRenderFrameBufferTexture() as WebGLTexture;
	const copySnapshotTexture = prepareCopySnapshotTexture(backend, state, output.frameBufferWidth, output.frameBufferHeight);
	backend.copyTextureRegion(frameBufferTexture, copySnapshotTexture, commands.srcX[commandIndex], commands.srcY[commandIndex], commands.srcX[commandIndex], commands.srcY[commandIndex], commands.width[commandIndex], commands.height[commandIndex]);
	const pass = backend.beginRenderPass({
		color: { tex: frameBufferTexture },
		depth: { tex: priorityDepthTexture },
	});
	bindPassState(backend, state, pass, output);
	bindVdpTexture(backend, TEXTURE_UNIT_TEXTPAGE_PRIMARY, copySnapshotTexture);
	backend.setDepthFunc(backend.gl.ALWAYS);
	backend.setBlendEnabled(false);
	writeQuad(state, 0, commands.dstX[commandIndex], commands.dstY[commandIndex], commands.width[commandIndex], 0, 0, commands.height[commandIndex], commands.srcX[commandIndex] / output.frameBufferWidth, commands.srcY[commandIndex] / output.frameBufferHeight, (commands.srcX[commandIndex] + commands.width[commandIndex]) / output.frameBufferWidth, (commands.srcY[commandIndex] + commands.height[commandIndex]) / output.frameBufferHeight, getPriorityDepth(priorityDepthBySeq, commands.seq[commandIndex]), VDP_BLITTER_WHITE, 0);
	flushWebGLInstanceBatch(backend, pass, state, 1, INSTANCE_FLOATS);
	backend.bindVertexArray(null);
	backend.endRenderPass(pass);
	backend.setBlendEnabled(false);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(true);
}

function drawCommand(output: VdpHostOutput, backend: WebGLBackend, state: WebGLVdpBlitterRuntime, pass: PassEncoder, commands: VdpBlitterCommand, commandIndex: number, priorityDepthBySeq: ReadonlyMap<number, number>, boundMode: { mode: DrawMode | null; batchCount: number }): void {
	const opcode = commands.opcode[commandIndex];
	if (opcode === VDP_BLITTER_OPCODE_COPY_RECT || opcode === VDP_BLITTER_OPCODE_CLEAR) {
		return;
	}
	const nextMode = opcode === VDP_BLITTER_OPCODE_FILL_RECT || opcode === VDP_BLITTER_OPCODE_DRAW_LINE ? 'solid' : 'slot';
	if (boundMode.mode !== nextMode) {
		boundMode.batchCount = flushPendingBatch(backend, pass, state, boundMode.batchCount);
		bindTexturesForMode(backend, state, nextMode);
		boundMode.mode = nextMode;
	}
	const priorityDepth = getPriorityDepth(priorityDepthBySeq, commands.seq[commandIndex]);
	if (opcode === VDP_BLITTER_OPCODE_BLIT) {
		boundMode.batchCount += appendBlitCommand(output, backend, state, commands, commandIndex, boundMode.batchCount, priorityDepth);
		return;
	}
	if (opcode === VDP_BLITTER_OPCODE_FILL_RECT) {
		boundMode.batchCount += appendFillCommand(backend, state, commands, commandIndex, boundMode.batchCount, priorityDepth);
		return;
	}
	if (opcode === VDP_BLITTER_OPCODE_DRAW_LINE) {
		boundMode.batchCount += appendLineCommand(backend, state, commands, commandIndex, boundMode.batchCount, priorityDepth);
		return;
	}
	if (opcode === VDP_BLITTER_OPCODE_GLYPH_RUN) {
		const firstGlyph = commands.glyphRunFirstEntry[commandIndex];
		const glyphCount = commands.glyphRunEntryCount[commandIndex];
		const glyphEnd = firstGlyph + glyphCount;
		if (commands.hasBackgroundColor[commandIndex] !== 0) {
			if (boundMode.mode !== 'solid') {
				boundMode.batchCount = flushPendingBatch(backend, pass, state, boundMode.batchCount);
				bindTexturesForMode(backend, state, 'solid');
				boundMode.mode = 'solid';
			}
			boundMode.batchCount += appendGlyphBackground(backend, state, commands, commandIndex, firstGlyph, glyphEnd, glyphCount, boundMode.batchCount, priorityDepth);
		}
		if (boundMode.mode !== 'slot') {
			boundMode.batchCount = flushPendingBatch(backend, pass, state, boundMode.batchCount);
			bindTexturesForMode(backend, state, 'slot');
			boundMode.mode = 'slot';
		}
		boundMode.batchCount += appendGlyphs(output, backend, state, commands, commandIndex, firstGlyph, glyphEnd, glyphCount, boundMode.batchCount, priorityDepth);
		return;
	}
	boundMode.batchCount += appendTiles(output, backend, state, commands, commandIndex, boundMode.batchCount, priorityDepth);
}

export class WebGLVdpBlitterExecutor {
	private readonly runtime: WebGLVdpBlitterRuntime;

	public constructor(
		private readonly backend: WebGLBackend,
	) {
		this.runtime = createRuntime(backend);
	}

	public execute(output: VdpHostOutput, commands: VdpBlitterCommand): void {
		if (commands.length === 0) {
			return;
		}
		const state = this.runtime;
		const priorityDepthTexture = preparePriorityDepthTexture(this.backend, state, output.frameBufferWidth, output.frameBufferHeight);
		const priorityDepthBySeq = buildPriorityDepthBySequence(state, commands);
		clearFrameBuffer(this.backend, priorityDepthTexture, commands.opcode[0] === VDP_BLITTER_OPCODE_CLEAR ? commands.colorWord[0] : VDP_BLITTER_IMPLICIT_CLEAR);
		const frameBufferTexture = vdpRenderFrameBufferTexture();
		let pass = this.backend.beginRenderPass({
			color: { tex: frameBufferTexture },
			depth: { tex: priorityDepthTexture },
		});
		bindPassState(this.backend, state, pass, output);
		const boundMode = { mode: null as DrawMode | null, batchCount: 0 };
		for (let index = commands.opcode[0] === VDP_BLITTER_OPCODE_CLEAR ? 1 : 0; index < commands.length; index += 1) {
			if (commands.opcode[index] === VDP_BLITTER_OPCODE_CLEAR) {
				boundMode.batchCount = flushPendingBatch(this.backend, pass, state, boundMode.batchCount);
				this.backend.bindVertexArray(null);
				this.backend.endRenderPass(pass);
				clearFrameBuffer(this.backend, priorityDepthTexture, commands.colorWord[index]);
				boundMode.mode = null;
				boundMode.batchCount = 0;
				pass = this.backend.beginRenderPass({ color: { tex: frameBufferTexture }, depth: { tex: priorityDepthTexture } });
				bindPassState(this.backend, state, pass, output);
				continue;
			}
			if (commands.opcode[index] === VDP_BLITTER_OPCODE_COPY_RECT) {
				boundMode.batchCount = flushPendingBatch(this.backend, pass, state, boundMode.batchCount);
				copyFrameBufferRect(output, this.backend, state, priorityDepthTexture, priorityDepthBySeq, commands, index);
				continue;
			}
			drawCommand(output, this.backend, state, pass, commands, index, priorityDepthBySeq, boundMode);
		}
		flushPendingBatch(this.backend, pass, state, boundMode.batchCount);
		this.backend.bindVertexArray(null);
		this.backend.endRenderPass(pass);
		this.backend.setBlendEnabled(false);
		this.backend.setDepthTestEnabled(false);
		this.backend.setDepthMask(true);
	}
}

let registered = false;

export function registerWebGLVdpBlitterExecutorFactory(): void {
	if (registered) {
		return;
	}
	registered = true;
	let webglExecutorBackend: WebGLBackend | null = null;
	let webglExecutor: WebGLVdpBlitterExecutor | null = null;
	registerVdpBlitterExecutorFactory('webgl2', (backend) => {
		if (webglExecutor === null || webglExecutorBackend !== backend) {
			webglExecutorBackend = backend as WebGLBackend;
			webglExecutor = new WebGLVdpBlitterExecutor(webglExecutorBackend);
		}
		return webglExecutor;
	});
}
