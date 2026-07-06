import {
	GX_GPU_COMMAND_CAPACITY,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	type GxGpuCommandBufferView,
} from '../../../machine/devices/gx/gpu_command_buffer';
import type { RenderPassLibrary } from '../pass/library';
import type { RenderGraphPassContext, RenderPassStateRegistry } from '../backend';
import type { WebGLBackend } from './backend';
import fillVertexShader from './shaders/gx_gpu_fill.vert.glsl';
import fillFragmentShader from './shaders/gx_gpu_fill.frag.glsl';
import scanoutVertexShader from './shaders/gx_gpu_scanout.vert.glsl';
import scanoutFragmentShader from './shaders/gx_gpu_scanout.frag.glsl';

const GX_GPU_VRAM_WIDTH = 1024;
const GX_GPU_VRAM_HEIGHT = 512;
const GX_GPU_DISPLAY_WIDTH = 320;
const GX_GPU_DISPLAY_HEIGHT = 240;
const GX_GPU_SCANOUT_TEXTURE_UNIT = 0;
const GX_GPU_FILL_VERTEX_FLOATS = 6;
const GX_GPU_FILL_VERTICES_PER_RECT = 6;
const GX_GPU_FILL_FLOAT_CAPACITY = GX_GPU_COMMAND_CAPACITY * GX_GPU_FILL_VERTICES_PER_RECT * GX_GPU_FILL_VERTEX_FLOATS;
const GX_GPU_SCANOUT_VERTEX_FLOATS = 4;

const gxGpuFillVertices = new Float32Array(GX_GPU_FILL_FLOAT_CAPACITY);
const gxGpuScanoutVertices = new Float32Array([
	-1.0, 1.0, 0.0, 1.0,
	-1.0, -1.0, 0.0, 1.0 - GX_GPU_DISPLAY_HEIGHT / GX_GPU_VRAM_HEIGHT,
	1.0, 1.0, GX_GPU_DISPLAY_WIDTH / GX_GPU_VRAM_WIDTH, 1.0,
	1.0, 1.0, GX_GPU_DISPLAY_WIDTH / GX_GPU_VRAM_WIDTH, 1.0,
	-1.0, -1.0, 0.0, 1.0 - GX_GPU_DISPLAY_HEIGHT / GX_GPU_VRAM_HEIGHT,
	1.0, -1.0, GX_GPU_DISPLAY_WIDTH / GX_GPU_VRAM_WIDTH, 1.0 - GX_GPU_DISPLAY_HEIGHT / GX_GPU_VRAM_HEIGHT,
]);

type GxGpuWebGLState = {
	fillProgram: WebGLProgram;
	scanoutProgram: WebGLProgram;
	vramTexture: WebGLTexture;
	vramFramebuffer: WebGLFramebuffer;
	fillVertexBuffer: WebGLBuffer;
	scanoutVertexBuffer: WebGLBuffer;
	fillPositionAttrib: number;
	fillColorAttrib: number;
	scanoutPositionAttrib: number;
	scanoutTexcoordAttrib: number;
	scanoutVramUniform: WebGLUniformLocation;
	processedCommandCount: number;
	processedCommandSerial: number;
};

let gxGpuWebGLState: GxGpuWebGLState;

function bootstrapGxGpuPass(backend: WebGLBackend): void {
	const gl = backend.gl;
	const fillProgram = backend.buildProgram(fillVertexShader, fillFragmentShader, 'gx_gpu_fill');
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

	const fillVertexBuffer = gl.createBuffer() as WebGLBuffer;
	backend.bindArrayBuffer(fillVertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, gxGpuFillVertices.byteLength, gl.DYNAMIC_DRAW);

	const scanoutVertexBuffer = gl.createBuffer() as WebGLBuffer;
	backend.bindArrayBuffer(scanoutVertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, gxGpuScanoutVertices, gl.STATIC_DRAW);

	gxGpuWebGLState = {
		fillProgram,
		scanoutProgram,
		vramTexture,
		vramFramebuffer,
		fillVertexBuffer,
		scanoutVertexBuffer,
		fillPositionAttrib: gl.getAttribLocation(fillProgram, 'a_position'),
		fillColorAttrib: gl.getAttribLocation(fillProgram, 'a_color'),
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

function writeFillVertex(offset: number, x: number, y: number, r: number, g: number, b: number): number {
	gxGpuFillVertices[offset] = x;
	gxGpuFillVertices[offset + 1] = y;
	gxGpuFillVertices[offset + 2] = r;
	gxGpuFillVertices[offset + 3] = g;
	gxGpuFillVertices[offset + 4] = b;
	gxGpuFillVertices[offset + 5] = 1.0;
	return offset + GX_GPU_FILL_VERTEX_FLOATS;
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
	const r = (colorWord & 0xff) / 255;
	const g = ((colorWord >>> 8) & 0xff) / 255;
	const b = ((colorWord >>> 16) & 0xff) / 255;
	let offset = vertexFloatCount;
	offset = writeFillVertex(offset, x0, y0, r, g, b);
	offset = writeFillVertex(offset, x0, y1, r, g, b);
	offset = writeFillVertex(offset, x1, y0, r, g, b);
	offset = writeFillVertex(offset, x1, y0, r, g, b);
	offset = writeFillVertex(offset, x0, y1, r, g, b);
	offset = writeFillVertex(offset, x1, y1, r, g, b);
	return offset;
}

function uploadNewFillCommands(backend: WebGLBackend, gl: WebGL2RenderingContext, commandBuffer: GxGpuCommandBufferView): number {
	let commandIndex = gxGpuWebGLState.processedCommandCount;
	let vertexFloatCount = 0;
	for (; commandIndex < commandBuffer.commandCount; commandIndex += 1) {
		if (commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_FILL_RECTANGLE) {
			vertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
		}
	}
	gxGpuWebGLState.processedCommandCount = commandBuffer.commandCount;
	if (vertexFloatCount !== 0) {
		backend.bindArrayBuffer(gxGpuWebGLState.fillVertexBuffer);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, gxGpuFillVertices, 0, vertexFloatCount);
	}
	return vertexFloatCount / GX_GPU_FILL_VERTEX_FLOATS;
}

function renderNewFillCommands(backend: WebGLBackend, gl: WebGL2RenderingContext, vertexCount: number): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuWebGLState.vramFramebuffer);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setCullEnabled(false);
	backend.setBlendEnabled(false);
	backend.useProgram(gxGpuWebGLState.fillProgram);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuWebGLState.fillVertexBuffer);
	gl.enableVertexAttribArray(gxGpuWebGLState.fillPositionAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.fillPositionAttrib, 2, gl.FLOAT, false, GX_GPU_FILL_VERTEX_FLOATS * 4, 0);
	gl.enableVertexAttribArray(gxGpuWebGLState.fillColorAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.fillColorAttrib, 4, gl.FLOAT, false, GX_GPU_FILL_VERTEX_FLOATS * 4, 2 * 4);
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
	const vertexCount = uploadNewFillCommands(backend, gl, state.commandBuffer);
	if (vertexCount !== 0) {
		renderNewFillCommands(backend, gl, vertexCount);
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
