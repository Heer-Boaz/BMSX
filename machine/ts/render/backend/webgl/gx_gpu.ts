import {
	GX_GPU_COMMAND_CAPACITY,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	gxGpuCommandGouraud,
	gxGpuCommandQuadPolygon,
	gxGpuCommandRectangleHeight,
	gxGpuCommandRectangleWidth,
	gxGpuCommandTextureEnabled,
	gxGpuDrawingOffsetX,
	gxGpuDrawingOffsetY,
	gxGpuVertexX,
	gxGpuVertexY,
	type GxGpuCommandBufferView,
} from '../../../machine/devices/gx/gpu_command_buffer';
import type { RenderPassLibrary } from '../pass/library';
import type { RenderGraphPassContext, RenderPassStateRegistry } from '../backend';
import type { WebGLBackend } from './backend';
import solidVertexShader from './shaders/gx_gpu_fill.vert.glsl';
import solidFragmentShader from './shaders/gx_gpu_fill.frag.glsl';
import scanoutVertexShader from './shaders/gx_gpu_scanout.vert.glsl';
import scanoutFragmentShader from './shaders/gx_gpu_scanout.frag.glsl';

const GX_GPU_VRAM_WIDTH = 1024;
const GX_GPU_VRAM_HEIGHT = 512;
const GX_GPU_DISPLAY_WIDTH = 320;
const GX_GPU_DISPLAY_HEIGHT = 240;
const GX_GPU_SCANOUT_TEXTURE_UNIT = 0;
const GX_GPU_SOLID_VERTEX_FLOATS = 6;
const GX_GPU_SOLID_VERTICES_PER_COMMAND = 6;
const GX_GPU_SOLID_FLOAT_CAPACITY = GX_GPU_COMMAND_CAPACITY * GX_GPU_SOLID_VERTICES_PER_COMMAND * GX_GPU_SOLID_VERTEX_FLOATS;
const GX_GPU_SCANOUT_VERTEX_FLOATS = 4;

const gxGpuSolidVertices = new Float32Array(GX_GPU_SOLID_FLOAT_CAPACITY);
const gxGpuScanoutVertices = new Float32Array([
	-1.0, 1.0, 0.0, 1.0,
	-1.0, -1.0, 0.0, 1.0 - GX_GPU_DISPLAY_HEIGHT / GX_GPU_VRAM_HEIGHT,
	1.0, 1.0, GX_GPU_DISPLAY_WIDTH / GX_GPU_VRAM_WIDTH, 1.0,
	1.0, 1.0, GX_GPU_DISPLAY_WIDTH / GX_GPU_VRAM_WIDTH, 1.0,
	-1.0, -1.0, 0.0, 1.0 - GX_GPU_DISPLAY_HEIGHT / GX_GPU_VRAM_HEIGHT,
	1.0, -1.0, GX_GPU_DISPLAY_WIDTH / GX_GPU_VRAM_WIDTH, 1.0 - GX_GPU_DISPLAY_HEIGHT / GX_GPU_VRAM_HEIGHT,
]);

type GxGpuWebGLState = {
	solidProgram: WebGLProgram;
	scanoutProgram: WebGLProgram;
	vramTexture: WebGLTexture;
	vramFramebuffer: WebGLFramebuffer;
	solidVertexBuffer: WebGLBuffer;
	scanoutVertexBuffer: WebGLBuffer;
	solidPositionAttrib: number;
	solidColorAttrib: number;
	scanoutPositionAttrib: number;
	scanoutTexcoordAttrib: number;
	scanoutVramUniform: WebGLUniformLocation;
	processedCommandCount: number;
	processedCommandSerial: number;
};

let gxGpuWebGLState: GxGpuWebGLState;

function bootstrapGxGpuPass(backend: WebGLBackend): void {
	const gl = backend.gl;
	const solidProgram = backend.buildProgram(solidVertexShader, solidFragmentShader, 'gx_gpu_fill');
	const scanoutProgram = backend.buildProgram(scanoutVertexShader, scanoutFragmentShader, 'gx_gpu_scanout');
	const vramTexture = gl.createTexture() as WebGLTexture;
	backend.setActiveTexture(GX_GPU_SCANOUT_TEXTURE_UNIT);
	backend.bindTexture2D(vramTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	const vramFramebuffer = gl.createFramebuffer() as WebGLFramebuffer;
	gl.bindFramebuffer(gl.FRAMEBUFFER, vramFramebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, vramTexture, 0);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);

	const solidVertexBuffer = gl.createBuffer() as WebGLBuffer;
	backend.bindArrayBuffer(solidVertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, gxGpuSolidVertices.byteLength, gl.DYNAMIC_DRAW);

	const scanoutVertexBuffer = gl.createBuffer() as WebGLBuffer;
	backend.bindArrayBuffer(scanoutVertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, gxGpuScanoutVertices, gl.STATIC_DRAW);

	gxGpuWebGLState = {
		solidProgram,
		scanoutProgram,
		vramTexture,
		vramFramebuffer,
		solidVertexBuffer,
		scanoutVertexBuffer,
		solidPositionAttrib: gl.getAttribLocation(solidProgram, 'a_position'),
		solidColorAttrib: gl.getAttribLocation(solidProgram, 'a_color'),
		scanoutPositionAttrib: gl.getAttribLocation(scanoutProgram, 'a_position'),
		scanoutTexcoordAttrib: gl.getAttribLocation(scanoutProgram, 'a_texcoord'),
		scanoutVramUniform: gl.getUniformLocation(scanoutProgram, 'u_vram') as WebGLUniformLocation,
		processedCommandCount: 0,
		processedCommandSerial: 0,
	};
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function clearGxGpuVram(backend: WebGLBackend, gl: WebGL2RenderingContext): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuWebGLState.vramFramebuffer);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);
}

function writeSolidVertex(offset: number, x: number, y: number, r: number, g: number, b: number): number {
	gxGpuSolidVertices[offset] = x;
	gxGpuSolidVertices[offset + 1] = y;
	gxGpuSolidVertices[offset + 2] = r;
	gxGpuSolidVertices[offset + 3] = g;
	gxGpuSolidVertices[offset + 4] = b;
	gxGpuSolidVertices[offset + 5] = 1.0;
	return offset + GX_GPU_SOLID_VERTEX_FLOATS;
}

function writeSolidColorVertex(offset: number, x: number, y: number, colorWord: number): number {
	return writeSolidVertex(
		offset,
		x,
		y,
		(colorWord & 0xff) / 255,
		((colorWord >>> 8) & 0xff) / 255,
		((colorWord >>> 16) & 0xff) / 255,
	);
}

function appendSolidTriangle(
	vertexFloatCount: number,
	x0: number,
	y0: number,
	color0: number,
	x1: number,
	y1: number,
	color1: number,
	x2: number,
	y2: number,
	color2: number,
): number {
	let offset = vertexFloatCount;
	offset = writeSolidColorVertex(offset, x0, y0, color0);
	offset = writeSolidColorVertex(offset, x1, y1, color1);
	offset = writeSolidColorVertex(offset, x2, y2, color2);
	return offset;
}

function appendSolidQuad(
	vertexFloatCount: number,
	x0: number,
	y0: number,
	color0: number,
	x1: number,
	y1: number,
	color1: number,
	x2: number,
	y2: number,
	color2: number,
	x3: number,
	y3: number,
	color3: number,
): number {
	let offset = vertexFloatCount;
	offset = appendSolidTriangle(offset, x0, y0, color0, x1, y1, color1, x2, y2, color2);
	offset = appendSolidTriangle(offset, x2, y2, color2, x1, y1, color1, x3, y3, color3);
	return offset;
}

function appendFillRectangle(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = commandBuffer.words[wordStart];
	const xyWord = commandBuffer.words[wordStart + 1];
	const whWord = commandBuffer.words[wordStart + 2];
	const width = ((whWord & 0x3ff) + 0x0f) & ~0x0f;
	const height = (whWord >>> 16) & 0x1ff;
	if (width === 0 || height === 0) {
		return vertexFloatCount;
	}
	const x0 = xyWord & 0x3f0;
	const y0 = (xyWord >>> 16) & 0x1ff;
	const x1 = x0 + width;
	const y1 = y0 + height;
	return appendSolidQuad(vertexFloatCount, x0, y0, colorWord, x0, y1, colorWord, x1, y0, colorWord, x1, y1, colorWord);
}

function appendSolidPolygon(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	if (gxGpuCommandTextureEnabled(opcode)) {
		return vertexFloatCount;
	}
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const gouraud = gxGpuCommandGouraud(opcode);
	if (gouraud) {
		const color0 = commandBuffer.words[wordStart];
		const xy0 = commandBuffer.words[wordStart + 1];
		const color1 = commandBuffer.words[wordStart + 2];
		const xy1 = commandBuffer.words[wordStart + 3];
		const color2 = commandBuffer.words[wordStart + 4];
		const xy2 = commandBuffer.words[wordStart + 5];
		let offset = appendSolidTriangle(
			vertexFloatCount,
			dx + gxGpuVertexX(xy0),
			dy + gxGpuVertexY(xy0),
			color0,
			dx + gxGpuVertexX(xy1),
			dy + gxGpuVertexY(xy1),
			color1,
			dx + gxGpuVertexX(xy2),
			dy + gxGpuVertexY(xy2),
			color2,
		);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const color3 = commandBuffer.words[wordStart + 6];
			const xy3 = commandBuffer.words[wordStart + 7];
			offset = appendSolidTriangle(
				offset,
				dx + gxGpuVertexX(xy2),
				dy + gxGpuVertexY(xy2),
				color2,
				dx + gxGpuVertexX(xy1),
				dy + gxGpuVertexY(xy1),
				color1,
				dx + gxGpuVertexX(xy3),
				dy + gxGpuVertexY(xy3),
				color3,
			);
		}
		return offset;
	}

	const color = commandBuffer.words[wordStart];
	const xy0 = commandBuffer.words[wordStart + 1];
	const xy1 = commandBuffer.words[wordStart + 2];
	const xy2 = commandBuffer.words[wordStart + 3];
	let offset = appendSolidTriangle(
		vertexFloatCount,
		dx + gxGpuVertexX(xy0),
		dy + gxGpuVertexY(xy0),
		color,
		dx + gxGpuVertexX(xy1),
		dy + gxGpuVertexY(xy1),
		color,
		dx + gxGpuVertexX(xy2),
		dy + gxGpuVertexY(xy2),
		color,
	);
	if (gxGpuCommandQuadPolygon(opcode)) {
		const xy3 = commandBuffer.words[wordStart + 4];
		offset = appendSolidTriangle(
			offset,
			dx + gxGpuVertexX(xy2),
			dy + gxGpuVertexY(xy2),
			color,
			dx + gxGpuVertexX(xy1),
			dy + gxGpuVertexY(xy1),
			color,
			dx + gxGpuVertexX(xy3),
			dy + gxGpuVertexY(xy3),
			color,
		);
	}
	return offset;
}

function appendSolidRectangle(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	if (gxGpuCommandTextureEnabled(opcode)) {
		return vertexFloatCount;
	}
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = commandBuffer.words[wordStart];
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + commandBuffer.commandWordCount[commandIndex] - 1];
	const width = gxGpuCommandRectangleWidth(opcode, sizeWord);
	const height = gxGpuCommandRectangleHeight(opcode, sizeWord);
	if (width === 0 || height === 0) {
		return vertexFloatCount;
	}
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const x0 = gxGpuDrawingOffsetX(drawingOffsetWord) + gxGpuVertexX(xyWord);
	const y0 = gxGpuDrawingOffsetY(drawingOffsetWord) + gxGpuVertexY(xyWord);
	const x1 = x0 + width;
	const y1 = y0 + height;
	return appendSolidQuad(vertexFloatCount, x0, y0, colorWord, x0, y1, colorWord, x1, y0, colorWord, x1, y1, colorWord);
}

function uploadNewSolidCommands(backend: WebGLBackend, gl: WebGL2RenderingContext, commandBuffer: GxGpuCommandBufferView): number {
	let commandIndex = gxGpuWebGLState.processedCommandCount;
	let vertexFloatCount = 0;
	for (; commandIndex < commandBuffer.commandCount; commandIndex += 1) {
		switch (commandBuffer.commandKind[commandIndex]) {
			case GX_GPU_COMMAND_DRAW_POLYGON:
				vertexFloatCount = appendSolidPolygon(commandBuffer, commandIndex, vertexFloatCount);
				break;
			case GX_GPU_COMMAND_DRAW_RECTANGLE:
				vertexFloatCount = appendSolidRectangle(commandBuffer, commandIndex, vertexFloatCount);
				break;
			case GX_GPU_COMMAND_FILL_RECTANGLE:
				vertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
				break;
		}
	}
	gxGpuWebGLState.processedCommandCount = commandBuffer.commandCount;
	if (vertexFloatCount !== 0) {
		backend.bindArrayBuffer(gxGpuWebGLState.solidVertexBuffer);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, gxGpuSolidVertices, 0, vertexFloatCount);
	}
	return vertexFloatCount / GX_GPU_SOLID_VERTEX_FLOATS;
}

function renderNewSolidCommands(backend: WebGLBackend, gl: WebGL2RenderingContext, vertexCount: number): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuWebGLState.vramFramebuffer);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setCullEnabled(false);
	backend.setBlendEnabled(false);
	backend.useProgram(gxGpuWebGLState.solidProgram);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuWebGLState.solidVertexBuffer);
	gl.enableVertexAttribArray(gxGpuWebGLState.solidPositionAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.solidPositionAttrib, 2, gl.FLOAT, false, GX_GPU_SOLID_VERTEX_FLOATS * 4, 0);
	gl.enableVertexAttribArray(gxGpuWebGLState.solidColorAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.solidColorAttrib, 4, gl.FLOAT, false, GX_GPU_SOLID_VERTEX_FLOATS * 4, 2 * 4);
	gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
}

function scanoutGxGpuVram(backend: WebGLBackend, gl: WebGL2RenderingContext, fbo: WebGLFramebuffer, state: RenderPassStateRegistry['gx_gpu']): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	backend.setViewportRect(0, 0, state.width, state.height);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setCullEnabled(false);
	backend.setBlendEnabled(false);
	backend.useProgram(gxGpuWebGLState.scanoutProgram);
	gl.uniform1i(gxGpuWebGLState.scanoutVramUniform, GX_GPU_SCANOUT_TEXTURE_UNIT);
	backend.setActiveTexture(GX_GPU_SCANOUT_TEXTURE_UNIT);
	backend.bindTexture2D(gxGpuWebGLState.vramTexture);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuWebGLState.scanoutVertexBuffer);
	gl.enableVertexAttribArray(gxGpuWebGLState.scanoutPositionAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.scanoutPositionAttrib, 2, gl.FLOAT, false, GX_GPU_SCANOUT_VERTEX_FLOATS * 4, 0);
	gl.enableVertexAttribArray(gxGpuWebGLState.scanoutTexcoordAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.scanoutTexcoordAttrib, 2, gl.FLOAT, false, GX_GPU_SCANOUT_VERTEX_FLOATS * 4, 2 * 4);
	gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function renderGxGpuPass(backend: WebGLBackend, fbo: WebGLFramebuffer, state: RenderPassStateRegistry['gx_gpu']): void {
	const gl = backend.gl;
	if (gxGpuWebGLState.processedCommandSerial !== state.commandBuffer.serial) {
		clearGxGpuVram(backend, gl);
		gxGpuWebGLState.processedCommandCount = 0;
		gxGpuWebGLState.processedCommandSerial = state.commandBuffer.serial;
	}
	const vertexCount = uploadNewSolidCommands(backend, gl, state.commandBuffer);
	if (vertexCount !== 0) {
		renderNewSolidCommands(backend, gl, vertexCount);
	}
	scanoutGxGpuVram(backend, gl, fbo, state);
}

function writeGxGpuState(ctx: RenderGraphPassContext, state: RenderPassStateRegistry['gx_gpu']): void {
	state.width = ctx.view.offscreenCanvasSize.x;
	state.height = ctx.view.offscreenCanvasSize.y;
	state.commandBuffer = ctx.view.gxGpuCommandBuffer;
}

export function registerGxGpuPass(registry: RenderPassLibrary): void {
	const gxGpuState: RenderPassStateRegistry['gx_gpu'] = {
		width: 0,
		height: 0,
		commandBuffer: registry.view.gxGpuCommandBuffer,
	};
	registry.register({
		id: 'gx_gpu',
		name: 'GXGPU',
		initialState: gxGpuState,
		graph: {
			writes: ['frame_color'],
			writeState: writeGxGpuState,
		},
		bootstrap: (backend) => {
			bootstrapGxGpuPass(backend as WebGLBackend);
		},
		exec: (backend: WebGLBackend, fbo, state: RenderPassStateRegistry['gx_gpu']) => {
			renderGxGpuPass(backend, fbo as WebGLFramebuffer, state);
		},
	});
}
