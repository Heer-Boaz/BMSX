import type { Runtime } from '../../../machine/runtime/runtime';
import {
	VDP_BLITTER_OPCODE_BATCH_BLIT,
	VDP_BLITTER_OPCODE_BLIT,
	VDP_BLITTER_OPCODE_CLEAR,
	VDP_BLITTER_OPCODE_DRAW_LINE,
	VDP_BLITTER_OPCODE_FILL_RECT,
	type VdpBlitterCommandBuffer,
} from '../../../machine/devices/vdp/blitter';
import {
	VDP_RD_SURFACE_COUNT,
	VDP_RD_SURFACE_PRIMARY,
	VDP_RD_SURFACE_SECONDARY,
	VDP_RD_SURFACE_SYSTEM,
} from '../../../machine/devices/vdp/contracts';
import { type color_arr, FRAMEBUFFER_RENDER_TEXTURE_KEY, SYSTEM_SLOT_TEXTURE_KEY, VDP_PRIMARY_SLOT_TEXTURE_KEY, VDP_SECONDARY_SLOT_TEXTURE_KEY } from '../../../rompack/format';
import type { GameView } from '../../gameview';
import type { WebGLBackend } from './backend';
import {
	VDP_FRAMEBUFFER_EXECUTION_TARGET_ACTIVE,
	type PassEncoder,
	type RenderPassInstanceHandle,
	type VdpFrameBufferExecutionPassState,
} from '../backend';
import { FRAME_UNIFORM_BINDING, updateAndBindFrameUniforms } from '../frame_uniforms';
import { TEXTURE_UNIT_SLOT_SYSTEM, TEXTURE_UNIT_SLOT_PRIMARY, TEXTURE_UNIT_SLOT_SECONDARY } from './constants';
import {
	bindWebGLInstancedFloatAttributes,
	bindWebGLSlotIdAttribute,
	bindWebGLUnitQuadCornerAttribute,
	type WebGLInstancedFloatAttribute,
} from './instanced_buffers';
import vertexShaderCode from '../../2d/shaders/2d.vert.glsl';
import fragmentShaderCode from '../../2d/shaders/2d.frag.glsl';

const INSTANCE_WORDS = 16;
const INSTANCE_STRIDE_BYTES = INSTANCE_WORDS * 4;
const INITIAL_BATCH_CAPACITY = 256;
const VDP_2D_SLOT_PRIMARY = 0;
const VDP_2D_SLOT_SECONDARY = 1;
const VDP_2D_SLOT_SYSTEM = 2;
const VDP_2D_DRAW_SOLID = 4;
const VDP_2D_SLOT_BY_SURFACE = new Uint8Array(VDP_RD_SURFACE_COUNT);
VDP_2D_SLOT_BY_SURFACE[VDP_RD_SURFACE_PRIMARY] = VDP_2D_SLOT_PRIMARY;
VDP_2D_SLOT_BY_SURFACE[VDP_RD_SURFACE_SECONDARY] = VDP_2D_SLOT_SECONDARY;
VDP_2D_SLOT_BY_SURFACE[VDP_RD_SURFACE_SYSTEM] = VDP_2D_SLOT_SYSTEM;
const SOLID_TEXCOORD_0 = 0;
const SOLID_TEXCOORD_1 = 1;
const IMPLICIT_CLEAR_COLOR: color_arr = [0, 0, 0, 1];
const clearColorScratch: color_arr = [0, 0, 0, 0];
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

type WebGLVdp2DBlitRuntime = {
	backend: WebGLBackend;
	pipeline: RenderPassInstanceHandle;
	vao: WebGLVertexArrayObject;
	cornerBuffer: WebGLBuffer;
	instanceFloatBuffer: WebGLBuffer;
	instanceSlotBuffer: WebGLBuffer;
	floatData: Float32Array;
	slotData: Uint8Array;
	commandOrder: Uint32Array;
	capacity: number;
	scale: WebGLUniformLocation;
	texture0: WebGLUniformLocation;
	texture1: WebGLUniformLocation;
	texture2: WebGLUniformLocation;
	parallaxRig: WebGLUniformLocation;
	parallaxRig2: WebGLUniformLocation;
	parallaxFlipWindow: WebGLUniformLocation;
};

function getProgramUniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
	const location = gl.getUniformLocation(program, name);
	if (location === null) {
		throw new Error(`[VDP2DBlitWebGL] Missing uniform ${name}.`);
	}
	return location;
}

function createWebGLRuntime(backend: WebGLBackend): WebGLVdp2DBlitRuntime {
	const gl = backend.gl as WebGL2RenderingContext;
	const pipeline = backend.createRenderPassInstance({
		label: 'VDP2DBlit',
		vsCode: vertexShaderCode,
		fsCode: fragmentShaderCode,
	});
	const program = pipeline.backendData as WebGLProgram;
	const passStub: PassEncoder = { fbo: null, desc: { label: 'vdp_2d_blit_setup' } };
	backend.setGraphicsPipeline(passStub, pipeline);
	backend.setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
	const vao = backend.createVertexArray() as WebGLVertexArrayObject;
	const cornerBuffer = backend.createVertexBuffer(new Float32Array([
		0, 0,
		0, 1,
		1, 0,
		1, 0,
		0, 1,
		1, 1,
	]), 'static') as WebGLBuffer;
	const instanceFloatData = new Float32Array(INITIAL_BATCH_CAPACITY * INSTANCE_WORDS);
	const instanceFloatBuffer = backend.createVertexBuffer(instanceFloatData, 'dynamic') as WebGLBuffer;
	const instanceSlotBuffer = backend.createVertexBuffer(new Uint8Array(INITIAL_BATCH_CAPACITY), 'dynamic') as WebGLBuffer;
	backend.bindVertexArray(vao);
	bindWebGLUnitQuadCornerAttribute(backend, program, cornerBuffer);
	backend.bindArrayBuffer(instanceFloatBuffer);
	bindWebGLInstancedFloatAttributes(backend, program, INSTANCE_STRIDE_BYTES, INSTANCE_FLOAT_ATTRIBUTES);
	bindWebGLSlotIdAttribute(backend, program, instanceSlotBuffer);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(null);
	return {
		backend,
		pipeline,
		vao,
		cornerBuffer,
		instanceFloatBuffer,
		instanceSlotBuffer,
		floatData: instanceFloatData,
		slotData: new Uint8Array(INITIAL_BATCH_CAPACITY),
		commandOrder: new Uint32Array(INITIAL_BATCH_CAPACITY),
		capacity: INITIAL_BATCH_CAPACITY,
		scale: getProgramUniform(gl, program, 'u_scale'),
		texture0: getProgramUniform(gl, program, 'u_texture0'),
		texture1: getProgramUniform(gl, program, 'u_texture1'),
		texture2: getProgramUniform(gl, program, 'u_texture2'),
		parallaxRig: getProgramUniform(gl, program, 'u_parallax_rig'),
		parallaxRig2: getProgramUniform(gl, program, 'u_parallax_rig2'),
		parallaxFlipWindow: getProgramUniform(gl, program, 'u_parallax_flip_window'),
	};
}

function growCommandOrder(state: WebGLVdp2DBlitRuntime, count: number): void {
	if (count <= state.commandOrder.length) {
		return;
	}
	let capacity = state.commandOrder.length;
	while (capacity < count) {
		capacity *= 2;
	}
	state.commandOrder = new Uint32Array(capacity);
}

function commandComesBefore(commands: VdpBlitterCommandBuffer, left: number, right: number): boolean {
	const leftLayer = commands.layer[left];
	const rightLayer = commands.layer[right];
	if (leftLayer !== rightLayer) {
		return leftLayer < rightLayer;
	}
	const leftPriority = commands.priority[left];
	const rightPriority = commands.priority[right];
	if (leftPriority !== rightPriority) {
		return leftPriority < rightPriority;
	}
	return commands.seq[left] < commands.seq[right];
}

function buildCommandOrder(state: WebGLVdp2DBlitRuntime, commands: VdpBlitterCommandBuffer, start: number, end: number): number {
	const count = end - start;
	growCommandOrder(state, count);
	const order = state.commandOrder;
	let orderCount = 0;
	for (let commandIndex = start; commandIndex < end; commandIndex += 1) {
		let insertAt = orderCount;
		while (insertAt > 0 && commandComesBefore(commands, commandIndex, order[insertAt - 1])) {
			order[insertAt] = order[insertAt - 1];
			insertAt -= 1;
		}
		order[insertAt] = commandIndex;
		orderCount += 1;
	}
	return orderCount;
}

function writeQuad(state: WebGLVdp2DBlitRuntime, index: number, originX: number, originY: number, axisXX: number, axisXY: number, axisYX: number, axisYY: number, u0: number, v0: number, u1: number, v1: number, z: number, fx: number, color: number, slotId: number): void {
	const base = index * INSTANCE_WORDS;
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
	data[base + 11] = fx;
	data[base + 12] = ((color >>> 16) & 0xff) / 255;
	data[base + 13] = ((color >>> 8) & 0xff) / 255;
	data[base + 14] = (color & 0xff) / 255;
	data[base + 15] = ((color >>> 24) & 0xff) / 255;
	state.slotData[index] = slotId;
}


function growBatchBuffers(backend: WebGLBackend, state: WebGLVdp2DBlitRuntime, count: number): void {
	if (count <= state.capacity) {
		return;
	}
	let capacity = state.capacity;
	while (capacity < count) {
		capacity *= 2;
	}
	const oldFloatData = state.floatData;
	const oldSlotData = state.slotData;
	state.floatData = new Float32Array(capacity * INSTANCE_WORDS);
	state.floatData.set(oldFloatData.subarray(0, state.capacity * INSTANCE_WORDS));
	state.slotData = new Uint8Array(capacity);
	state.slotData.set(oldSlotData.subarray(0, state.capacity));
	state.capacity = capacity;
	backend.bindArrayBuffer(state.instanceFloatBuffer);
	backend.updateVertexBuffer(state.instanceFloatBuffer, state.floatData, 0);
	backend.bindArrayBuffer(state.instanceSlotBuffer);
	backend.updateVertexBuffer(state.instanceSlotBuffer, state.slotData, 0);
	backend.bindArrayBuffer(null);
}

function flushBatch(backend: WebGLBackend, pass: PassEncoder, state: WebGLVdp2DBlitRuntime, count: number): number {
	if (count !== 0) {
		backend.bindArrayBuffer(state.instanceFloatBuffer);
		backend.updateVertexBuffer(state.instanceFloatBuffer, state.floatData, 0, 0, count * INSTANCE_WORDS);
		backend.bindArrayBuffer(state.instanceSlotBuffer);
		backend.updateVertexBuffer(state.instanceSlotBuffer, state.slotData, 0, 0, count);
		backend.drawInstanced(pass, 6, count, 0, 0);
	}
	return 0;
}

function appendFillRect(state: WebGLVdp2DBlitRuntime, commands: VdpBlitterCommandBuffer, commandIndex: number, outIndex: number): number {
	let x0 = commands.x0[commandIndex];
	let y0 = commands.y0[commandIndex];
	let x1 = commands.x1[commandIndex];
	let y1 = commands.y1[commandIndex];
	if (x1 < x0) {
		const swap = x0;
		x0 = x1;
		x1 = swap;
	}
	if (y1 < y0) {
		const swap = y0;
		y0 = y1;
		y1 = swap;
	}
	if (x0 === x1 || y0 === y1) {
		return 0;
	}
	writeQuad(state, outIndex, x0, y0, x1 - x0, 0, 0, y1 - y0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, commands.priority[commandIndex], 0, commands.color[commandIndex], VDP_2D_DRAW_SOLID);
	return 1;
}

function appendLine(state: WebGLVdp2DBlitRuntime, commands: VdpBlitterCommandBuffer, commandIndex: number, outIndex: number): number {
	const x0 = commands.x0[commandIndex];
	const y0 = commands.y0[commandIndex];
	const x1 = commands.x1[commandIndex];
	const y1 = commands.y1[commandIndex];
	const dx = x1 - x0;
	const dy = y1 - y0;
	const length = Math.hypot(dx, dy);
	const thickness = commands.thickness[commandIndex];
	if (length === 0) {
		const half = thickness * 0.5;
		writeQuad(state, outIndex, x0 - half, y0 - half, thickness, 0, 0, thickness, SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, commands.priority[commandIndex], 0, commands.color[commandIndex], VDP_2D_DRAW_SOLID);
		return 1;
	}
	const tangentX = dx / length;
	const tangentY = dy / length;
	const normalX = -tangentY;
	const normalY = tangentX;
	const half = thickness * 0.5;
	writeQuad(state, outIndex, x0 - tangentX * half - normalX * half, y0 - tangentY * half - normalY * half, dx + tangentX * thickness, dy + tangentY * thickness, normalX * thickness, normalY * thickness, SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, commands.priority[commandIndex], 0, commands.color[commandIndex], VDP_2D_DRAW_SOLID);
	return 1;
}

function appendBlit(view: GameView, state: WebGLVdp2DBlitRuntime, commands: VdpBlitterCommandBuffer, commandIndex: number, outIndex: number): number {
	const surfaceId = commands.sourceSurfaceId[commandIndex];
	const surfaceWidth = view.vdpSlotTextures.readSurfaceTextureWidth(surfaceId);
	const surfaceHeight = view.vdpSlotTextures.readSurfaceTextureHeight(surfaceId);
	let u0 = commands.sourceSrcX[commandIndex] / surfaceWidth;
	let v0 = commands.sourceSrcY[commandIndex] / surfaceHeight;
	let u1 = (commands.sourceSrcX[commandIndex] + commands.sourceWidth[commandIndex]) / surfaceWidth;
	let v1 = (commands.sourceSrcY[commandIndex] + commands.sourceHeight[commandIndex]) / surfaceHeight;
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
	writeQuad(state, outIndex, commands.dstX[commandIndex], commands.dstY[commandIndex], commands.width[commandIndex], 0, 0, commands.height[commandIndex], u0, v0, u1, v1, commands.priority[commandIndex], commands.parallaxWeight[commandIndex], commands.color[commandIndex], VDP_2D_SLOT_BY_SURFACE[surfaceId]);
	return 1;
}

function appendBatchBlitItem(view: GameView, state: WebGLVdp2DBlitRuntime, commands: VdpBlitterCommandBuffer, commandIndex: number, itemIndex: number, outIndex: number): number {
	const surfaceId = commands.batchBlitSurfaceId[itemIndex];
	const surfaceWidth = view.vdpSlotTextures.readSurfaceTextureWidth(surfaceId);
	const surfaceHeight = view.vdpSlotTextures.readSurfaceTextureHeight(surfaceId);
	const srcX = commands.batchBlitSrcX[itemIndex];
	const srcY = commands.batchBlitSrcY[itemIndex];
	const width = commands.batchBlitWidth[itemIndex];
	const height = commands.batchBlitHeight[itemIndex];
	writeQuad(state, outIndex, commands.batchBlitDstX[itemIndex], commands.batchBlitDstY[itemIndex], width, 0, 0, height, srcX / surfaceWidth, srcY / surfaceHeight, (srcX + width) / surfaceWidth, (srcY + height) / surfaceHeight, commands.priority[commandIndex], commands.parallaxWeight[commandIndex], commands.color[commandIndex], VDP_2D_SLOT_BY_SURFACE[surfaceId]);
	return 1;
}

function appendCommand(view: GameView, backend: WebGLBackend, state: WebGLVdp2DBlitRuntime, commands: VdpBlitterCommandBuffer, commandIndex: number, batchCount: number): number {
	const opcode = commands.opcode[commandIndex];
	growBatchBuffers(backend, state, batchCount + 1);
	if (opcode === VDP_BLITTER_OPCODE_FILL_RECT) {
		return batchCount + appendFillRect(state, commands, commandIndex, batchCount);
	}
	if (opcode === VDP_BLITTER_OPCODE_DRAW_LINE) {
		return batchCount + appendLine(state, commands, commandIndex, batchCount);
	}
	if (opcode === VDP_BLITTER_OPCODE_BLIT) {
		return batchCount + appendBlit(view, state, commands, commandIndex, batchCount);
	}
	if (opcode === VDP_BLITTER_OPCODE_BATCH_BLIT) {
		const firstItem = commands.batchBlitFirstEntry[commandIndex];
		const itemEnd = firstItem + commands.batchBlitItemCount[commandIndex];
		if (commands.hasBackgroundColor[commandIndex] !== 0) {
			for (let itemIndex = firstItem; itemIndex < itemEnd; itemIndex += 1) {
				growBatchBuffers(backend, state, batchCount + 1);
				writeQuad(state, batchCount, commands.batchBlitDstX[itemIndex], commands.batchBlitDstY[itemIndex], commands.batchBlitAdvance[itemIndex], 0, 0, commands.lineHeight[commandIndex], SOLID_TEXCOORD_0, SOLID_TEXCOORD_0, SOLID_TEXCOORD_1, SOLID_TEXCOORD_1, commands.priority[commandIndex], commands.parallaxWeight[commandIndex], commands.backgroundColor[commandIndex], VDP_2D_DRAW_SOLID);
				batchCount += 1;
			}
		}
		for (let itemIndex = firstItem; itemIndex < itemEnd; itemIndex += 1) {
			growBatchBuffers(backend, state, batchCount + 1);
			batchCount += appendBatchBlitItem(view, state, commands, commandIndex, itemIndex, batchCount);
		}
	}
	return batchCount;
}

function appendSortedCommandSegment(view: GameView, backend: WebGLBackend, state: WebGLVdp2DBlitRuntime, commands: VdpBlitterCommandBuffer, start: number, end: number, batchCount: number): number {
	const orderCount = buildCommandOrder(state, commands, start, end);
	const order = state.commandOrder;
	for (let orderIndex = 0; orderIndex < orderCount; orderIndex += 1) {
		batchCount = appendCommand(view, backend, state, commands, order[orderIndex], batchCount);
	}
	return batchCount;
}

function bindVdp2DBlitState(runtime: Runtime, backend: WebGLBackend, pass: PassEncoder, state: WebGLVdp2DBlitRuntime): void {
	const view = runtime.view;
	const gl = backend.gl as WebGL2RenderingContext;
	backend.setGraphicsPipeline(pass, state.pipeline);
	backend.setUniformBlockBinding('FrameUniforms', FRAME_UNIFORM_BINDING);
	const frameBufferWidth = runtime.machine.vdp.frameBufferWidth;
	const frameBufferHeight = runtime.machine.vdp.frameBufferHeight;
	updateAndBindFrameUniforms(backend, frameBufferWidth, frameBufferHeight, frameBufferWidth, frameBufferHeight, runtime.frameLoop.currentTimeMs / 1000, runtime.frameLoop.frameDeltaMs / 1000);
	gl.uniform1f(state.scale, 1);
	gl.uniform1i(state.texture0, TEXTURE_UNIT_SLOT_PRIMARY);
	gl.uniform1i(state.texture1, TEXTURE_UNIT_SLOT_SECONDARY);
	gl.uniform1i(state.texture2, TEXTURE_UNIT_SLOT_SYSTEM);
	gl.uniform4f(state.parallaxRig, 0, 1, 0, 0);
	gl.uniform4f(state.parallaxRig2, 0, 1, 1, 0);
	gl.uniform1f(state.parallaxFlipWindow, 1);
	backend.setViewportRect(0, 0, frameBufferWidth, frameBufferHeight);
	backend.setAlphaBlended2DState(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
	view.activeTexUnit = TEXTURE_UNIT_SLOT_PRIMARY;
	view.bind2DTex(view.textures[VDP_PRIMARY_SLOT_TEXTURE_KEY]);
	view.activeTexUnit = TEXTURE_UNIT_SLOT_SECONDARY;
	view.bind2DTex(view.textures[VDP_SECONDARY_SLOT_TEXTURE_KEY]);
	view.activeTexUnit = TEXTURE_UNIT_SLOT_SYSTEM;
	view.bind2DTex(view.textures[SYSTEM_SLOT_TEXTURE_KEY]);
	backend.bindVertexArray(state.vao);
}

function executeVdp2DBlitCommandsWebGL(runtime: Runtime, backend: WebGLBackend, state: WebGLVdp2DBlitRuntime, commands: VdpBlitterCommandBuffer): void {
	const view = runtime.view;
	runtime.machine.vdp.drainSurfaceUploads(view.vdpSlotTextures);
	const renderTexture = view.textures[FRAMEBUFFER_RENDER_TEXTURE_KEY];
	const pass = backend.beginRenderPass({
		label: 'vdp_2d_blit',
		color: { tex: renderTexture },
	});
	bindVdp2DBlitState(runtime, backend, pass, state);
	let batchCount = 0;
	if (commands.opcode[0] !== VDP_BLITTER_OPCODE_CLEAR) {
		backend.clear(IMPLICIT_CLEAR_COLOR, undefined);
	}
	let segmentStart = 0;
	for (let commandIndex = 0; commandIndex < commands.length; commandIndex += 1) {
		const opcode = commands.opcode[commandIndex];
		if (opcode === VDP_BLITTER_OPCODE_CLEAR) {
			batchCount = appendSortedCommandSegment(view, backend, state, commands, segmentStart, commandIndex, batchCount);
			batchCount = flushBatch(backend, pass, state, batchCount);
			const color = commands.color[commandIndex];
			clearColorScratch[0] = ((color >>> 16) & 0xff) / 255;
			clearColorScratch[1] = ((color >>> 8) & 0xff) / 255;
			clearColorScratch[2] = (color & 0xff) / 255;
			clearColorScratch[3] = ((color >>> 24) & 0xff) / 255;
			backend.clear(clearColorScratch, undefined);
			segmentStart = commandIndex + 1;
			continue;
		}
	}
	batchCount = appendSortedCommandSegment(view, backend, state, commands, segmentStart, commands.length, batchCount);
	flushBatch(backend, pass, state, batchCount);
	backend.bindVertexArray(null);
	backend.setBlendEnabled(false);
	backend.setDepthMask(true);
	backend.endRenderPass(pass);
}

export type WebGLVdp2DBlitBootstrap = WebGLVdp2DBlitRuntime;

export function bootstrapVdp2DBlitWebGL(backend: WebGLBackend): WebGLVdp2DBlitBootstrap {
	return createWebGLRuntime(backend);
}

export function executeVdp2DBlitWebGL(backend: WebGLBackend, runtime: WebGLVdp2DBlitBootstrap, state: VdpFrameBufferExecutionPassState): void {
	executeVdp2DBlitCommandsWebGL(state.runtime, backend, runtime, state.commands);
	if (state.target === VDP_FRAMEBUFFER_EXECUTION_TARGET_ACTIVE) {
		state.runtime.machine.vdp.completeReadyFrameBufferTextureExecution();
	} else {
		state.runtime.machine.vdp.completeDisplayFrameBufferTextureReplay();
	}
}
