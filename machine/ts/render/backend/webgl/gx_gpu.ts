import {
	GX_GPU_COMMAND_CAPACITY,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GX_GPU_VRAM_HEIGHT,
	GX_GPU_VRAM_WIDTH,
	gxGpuCommandGouraud,
	gxGpuCommandRawTextureEnabled,
	gxGpuCommandQuadPolygon,
	gxGpuCommandRectangleHeight,
	gxGpuCommandRectangleWidth,
	gxGpuCommandTextureEnabled,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuDrawModeTextureMode,
	gxGpuDrawModeTexturePageBaseX,
	gxGpuDrawModeTexturePageBaseY,
	gxGpuDrawingOffsetX,
	gxGpuDrawingOffsetY,
	gxGpuTextureClutBaseX,
	gxGpuTextureClutBaseY,
	gxGpuTextureU,
	gxGpuTextureV,
	gxGpuTextureWindowAndX,
	gxGpuTextureWindowAndY,
	gxGpuTextureWindowOrX,
	gxGpuTextureWindowOrY,
	gxGpuTransferHeight,
	gxGpuTransferPixelWord,
	gxGpuTransferWidth,
	gxGpuTransferX,
	gxGpuTransferY,
	gxGpuVertexX,
	gxGpuVertexY,
	type GxGpuCommandBufferView,
} from '../../../machine/devices/gx/gpu_command_buffer';
import type { RenderPassLibrary } from '../pass/library';
import type { RenderGraphPassContext, RenderPassStateRegistry } from '../backend';
import type { WebGLBackend } from './backend';
import solidVertexShader from './shaders/gx_gpu_fill.vert.glsl';
import solidFragmentShader from './shaders/gx_gpu_fill.frag.glsl';
import texturedVertexShader from './shaders/gx_gpu_textured.vert.glsl';
import texturedFragmentShader from './shaders/gx_gpu_textured.frag.glsl';
import scanoutVertexShader from './shaders/gx_gpu_scanout.vert.glsl';
import scanoutFragmentShader from './shaders/gx_gpu_scanout.frag.glsl';

const GX_GPU_DISPLAY_WIDTH = 320;
const GX_GPU_DISPLAY_HEIGHT = 240;
const GX_GPU_SCANOUT_TEXTURE_UNIT = 0;
const GX_GPU_TEXTURE_SAMPLE_UNIT = 1;
const GX_GPU_SOLID_VERTEX_FLOATS = 6;
const GX_GPU_SOLID_VERTICES_PER_COMMAND = 6;
const GX_GPU_SOLID_FLOAT_CAPACITY = GX_GPU_COMMAND_CAPACITY * GX_GPU_SOLID_VERTICES_PER_COMMAND * GX_GPU_SOLID_VERTEX_FLOATS;
const GX_GPU_TEXTURED_VERTEX_FLOATS = 7;
const GX_GPU_TEXTURED_VERTICES_PER_COMMAND = 6;
const GX_GPU_TEXTURED_FLOAT_CAPACITY = GX_GPU_TEXTURED_VERTICES_PER_COMMAND * GX_GPU_TEXTURED_VERTEX_FLOATS;
const GX_GPU_SCANOUT_VERTEX_FLOATS = 4;
const GX_GPU_RAW_VRAM_BYTES_PER_PIXEL = 4;
const GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES = GX_GPU_VRAM_WIDTH * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
const GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD = 0;
const GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD = (GX_GPU_VRAM_WIDTH - 1) | ((GX_GPU_VRAM_HEIGHT - 1) << 10);

const gxGpuSolidVertices = new Float32Array(GX_GPU_SOLID_FLOAT_CAPACITY);
const gxGpuTexturedVertices = new Float32Array(GX_GPU_TEXTURED_FLOAT_CAPACITY);
const gxGpuRawVramUploadRow = new Uint8Array(GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES);
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
	texturedProgram: WebGLProgram;
	scanoutProgram: WebGLProgram;
	vramTexture: WebGLTexture;
	vramSampleTexture: WebGLTexture;
	vramFramebuffer: WebGLFramebuffer;
	solidVertexBuffer: WebGLBuffer;
	texturedVertexBuffer: WebGLBuffer;
	scanoutVertexBuffer: WebGLBuffer;
	solidPositionAttrib: number;
	solidColorAttrib: number;
	texturedPositionAttrib: number;
	texturedColorAttrib: number;
	texturedTexcoordAttrib: number;
	texturedVramUniform: WebGLUniformLocation;
	texturedTexPageBaseUniform: WebGLUniformLocation;
	texturedClutBaseUniform: WebGLUniformLocation;
	texturedTextureWindowAndUniform: WebGLUniformLocation;
	texturedTextureWindowOrUniform: WebGLUniformLocation;
	texturedTextureModeUniform: WebGLUniformLocation;
	texturedRawTextureUniform: WebGLUniformLocation;
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
	const texturedProgram = backend.buildProgram(texturedVertexShader, texturedFragmentShader, 'gx_gpu_textured');
	const scanoutProgram = backend.buildProgram(scanoutVertexShader, scanoutFragmentShader, 'gx_gpu_scanout');
	const vramTexture = gl.createTexture() as WebGLTexture;
	backend.setActiveTexture(GX_GPU_SCANOUT_TEXTURE_UNIT);
	backend.bindTexture2D(vramTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

	const vramSampleTexture = gl.createTexture() as WebGLTexture;
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(vramSampleTexture);
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

	const texturedVertexBuffer = gl.createBuffer() as WebGLBuffer;
	backend.bindArrayBuffer(texturedVertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, gxGpuTexturedVertices.byteLength, gl.DYNAMIC_DRAW);

	const scanoutVertexBuffer = gl.createBuffer() as WebGLBuffer;
	backend.bindArrayBuffer(scanoutVertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, gxGpuScanoutVertices, gl.STATIC_DRAW);

	gxGpuWebGLState = {
		solidProgram,
		texturedProgram,
		scanoutProgram,
		vramTexture,
		vramSampleTexture,
		vramFramebuffer,
		solidVertexBuffer,
		texturedVertexBuffer,
		scanoutVertexBuffer,
		solidPositionAttrib: gl.getAttribLocation(solidProgram, 'a_position'),
		solidColorAttrib: gl.getAttribLocation(solidProgram, 'a_color'),
		texturedPositionAttrib: gl.getAttribLocation(texturedProgram, 'a_position'),
		texturedColorAttrib: gl.getAttribLocation(texturedProgram, 'a_color'),
		texturedTexcoordAttrib: gl.getAttribLocation(texturedProgram, 'a_texcoord'),
		texturedVramUniform: gl.getUniformLocation(texturedProgram, 'u_vram') as WebGLUniformLocation,
		texturedTexPageBaseUniform: gl.getUniformLocation(texturedProgram, 'u_texPageBase') as WebGLUniformLocation,
		texturedClutBaseUniform: gl.getUniformLocation(texturedProgram, 'u_clutBase') as WebGLUniformLocation,
		texturedTextureWindowAndUniform: gl.getUniformLocation(texturedProgram, 'u_textureWindowAnd') as WebGLUniformLocation,
		texturedTextureWindowOrUniform: gl.getUniformLocation(texturedProgram, 'u_textureWindowOr') as WebGLUniformLocation,
		texturedTextureModeUniform: gl.getUniformLocation(texturedProgram, 'u_textureMode') as WebGLUniformLocation,
		texturedRawTextureUniform: gl.getUniformLocation(texturedProgram, 'u_rawTexture') as WebGLUniformLocation,
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
	gl.disable(gl.SCISSOR_TEST);
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

function writeTexturedVertex(offset: number, x: number, y: number, colorWord: number, u: number, v: number): number {
	gxGpuTexturedVertices[offset] = x;
	gxGpuTexturedVertices[offset + 1] = y;
	gxGpuTexturedVertices[offset + 2] = (colorWord & 0xff) / 255;
	gxGpuTexturedVertices[offset + 3] = ((colorWord >>> 8) & 0xff) / 255;
	gxGpuTexturedVertices[offset + 4] = ((colorWord >>> 16) & 0xff) / 255;
	gxGpuTexturedVertices[offset + 5] = u;
	gxGpuTexturedVertices[offset + 6] = v;
	return offset + GX_GPU_TEXTURED_VERTEX_FLOATS;
}

function appendTexturedTriangle(
	vertexFloatCount: number,
	x0: number,
	y0: number,
	color0: number,
	u0: number,
	v0: number,
	x1: number,
	y1: number,
	color1: number,
	u1: number,
	v1: number,
	x2: number,
	y2: number,
	color2: number,
	u2: number,
	v2: number,
): number {
	let offset = vertexFloatCount;
	offset = writeTexturedVertex(offset, x0, y0, color0, u0, v0);
	offset = writeTexturedVertex(offset, x1, y1, color1, u1, v1);
	offset = writeTexturedVertex(offset, x2, y2, color2, u2, v2);
	return offset;
}

function appendTexturedPolygon(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	if (gxGpuCommandGouraud(opcode)) {
		const color0 = commandBuffer.words[wordStart];
		const xy0 = commandBuffer.words[wordStart + 1];
		const texture0 = commandBuffer.words[wordStart + 2];
		const color1 = commandBuffer.words[wordStart + 3];
		const xy1 = commandBuffer.words[wordStart + 4];
		const texture1 = commandBuffer.words[wordStart + 5];
		const color2 = commandBuffer.words[wordStart + 6];
		const xy2 = commandBuffer.words[wordStart + 7];
		const texture2 = commandBuffer.words[wordStart + 8];
		let offset = appendTexturedTriangle(
			vertexFloatCount,
			dx + gxGpuVertexX(xy0),
			dy + gxGpuVertexY(xy0),
			color0,
			gxGpuTextureU(texture0),
			gxGpuTextureV(texture0),
			dx + gxGpuVertexX(xy1),
			dy + gxGpuVertexY(xy1),
			color1,
			gxGpuTextureU(texture1),
			gxGpuTextureV(texture1),
			dx + gxGpuVertexX(xy2),
			dy + gxGpuVertexY(xy2),
			color2,
			gxGpuTextureU(texture2),
			gxGpuTextureV(texture2),
		);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const color3 = commandBuffer.words[wordStart + 9];
			const xy3 = commandBuffer.words[wordStart + 10];
			const texture3 = commandBuffer.words[wordStart + 11];
			offset = appendTexturedTriangle(
				offset,
				dx + gxGpuVertexX(xy2),
				dy + gxGpuVertexY(xy2),
				color2,
				gxGpuTextureU(texture2),
				gxGpuTextureV(texture2),
				dx + gxGpuVertexX(xy1),
				dy + gxGpuVertexY(xy1),
				color1,
				gxGpuTextureU(texture1),
				gxGpuTextureV(texture1),
				dx + gxGpuVertexX(xy3),
				dy + gxGpuVertexY(xy3),
				color3,
				gxGpuTextureU(texture3),
				gxGpuTextureV(texture3),
			);
		}
		return offset;
	}

	const color = commandBuffer.words[wordStart];
	const xy0 = commandBuffer.words[wordStart + 1];
	const texture0 = commandBuffer.words[wordStart + 2];
	const xy1 = commandBuffer.words[wordStart + 3];
	const texture1 = commandBuffer.words[wordStart + 4];
	const xy2 = commandBuffer.words[wordStart + 5];
	const texture2 = commandBuffer.words[wordStart + 6];
	let offset = appendTexturedTriangle(
		vertexFloatCount,
		dx + gxGpuVertexX(xy0),
		dy + gxGpuVertexY(xy0),
		color,
		gxGpuTextureU(texture0),
		gxGpuTextureV(texture0),
		dx + gxGpuVertexX(xy1),
		dy + gxGpuVertexY(xy1),
		color,
		gxGpuTextureU(texture1),
		gxGpuTextureV(texture1),
		dx + gxGpuVertexX(xy2),
		dy + gxGpuVertexY(xy2),
		color,
		gxGpuTextureU(texture2),
		gxGpuTextureV(texture2),
	);
	if (gxGpuCommandQuadPolygon(opcode)) {
		const xy3 = commandBuffer.words[wordStart + 7];
		const texture3 = commandBuffer.words[wordStart + 8];
		offset = appendTexturedTriangle(
			offset,
			dx + gxGpuVertexX(xy2),
			dy + gxGpuVertexY(xy2),
			color,
			gxGpuTextureU(texture2),
			gxGpuTextureV(texture2),
			dx + gxGpuVertexX(xy1),
			dy + gxGpuVertexY(xy1),
			color,
			gxGpuTextureU(texture1),
			gxGpuTextureV(texture1),
			dx + gxGpuVertexX(xy3),
			dy + gxGpuVertexY(xy3),
			color,
			gxGpuTextureU(texture3),
			gxGpuTextureV(texture3),
		);
	}
	return offset;
}

function appendTexturedRectangle(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = commandBuffer.words[wordStart];
	const xyWord = commandBuffer.words[wordStart + 1];
	const textureWord = commandBuffer.words[wordStart + 2];
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
	const u0 = gxGpuTextureU(textureWord);
	const v0 = gxGpuTextureV(textureWord);
	const u1 = u0 + width;
	const v1 = v0 + height;
	let offset = vertexFloatCount;
	offset = appendTexturedTriangle(offset, x0, y0, colorWord, u0, v0, x1, y0, colorWord, u1, v0, x0, y1, colorWord, u0, v1);
	offset = appendTexturedTriangle(offset, x0, y1, colorWord, u0, v1, x1, y0, colorWord, u1, v0, x1, y1, colorWord, u1, v1);
	return offset;
}

function writeRawVramUploadPixel(rowByteOffset: number, pixelWord: number): number {
	gxGpuRawVramUploadRow[rowByteOffset] = pixelWord & 0xff;
	gxGpuRawVramUploadRow[rowByteOffset + 1] = (pixelWord >>> 8) & 0xff;
	gxGpuRawVramUploadRow[rowByteOffset + 2] = 0;
	gxGpuRawVramUploadRow[rowByteOffset + 3] = 0xff;
	return rowByteOffset + GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
}

function writeCpuToVramUploadRow(commandBuffer: GxGpuCommandBufferView, payloadWordStart: number, rowPixelStart: number, width: number): void {
	let rowByteOffset = 0;
	for (let column = 0; column < width; column += 1) {
		const pixelIndex = rowPixelStart + column;
		const payloadWord = commandBuffer.words[payloadWordStart + (pixelIndex >>> 1)];
		rowByteOffset = writeRawVramUploadPixel(rowByteOffset, gxGpuTransferPixelWord(payloadWord, pixelIndex));
	}
}

function uploadCpuToVram(backend: WebGLBackend, gl: WebGL2RenderingContext, commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + 2];
	const x = gxGpuTransferX(xyWord);
	const y = gxGpuTransferY(xyWord);
	const width = gxGpuTransferWidth(sizeWord);
	const height = gxGpuTransferHeight(sizeWord);
	const payloadWordStart = wordStart + 3;

	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	backend.setActiveTexture(GX_GPU_SCANOUT_TEXTURE_UNIT);
	backend.bindTexture2D(gxGpuWebGLState.vramTexture);
	for (let row = 0; row < height; row += 1) {
		writeCpuToVramUploadRow(commandBuffer, payloadWordStart, row * width, width);
		const targetY = (y + row) & (GX_GPU_VRAM_HEIGHT - 1);
		const storageY = (GX_GPU_VRAM_HEIGHT - 1) - targetY;
		const firstWidth = width <= GX_GPU_VRAM_WIDTH - x ? width : GX_GPU_VRAM_WIDTH - x;
		gl.texSubImage2D(gl.TEXTURE_2D, 0, x, storageY, firstWidth, 1, gl.RGBA, gl.UNSIGNED_BYTE, gxGpuRawVramUploadRow, 0);
		if (firstWidth !== width) {
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, storageY, width - firstWidth, 1, gl.RGBA, gl.UNSIGNED_BYTE, gxGpuRawVramUploadRow, firstWidth * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL);
		}
	}
}

function applyGxGpuDrawingAreaScissor(gl: WebGL2RenderingContext, topLeftWord: number, bottomRightWord: number): void {
	const left = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const top = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord);
	const right = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const bottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord);
	gl.enable(gl.SCISSOR_TEST);
	gl.scissor(left, GX_GPU_VRAM_HEIGHT - bottom, right - left, bottom - top);
}

function copyGxGpuVramToSampleTexture(backend: WebGLBackend, gl: WebGL2RenderingContext): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuWebGLState.vramFramebuffer);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(gxGpuWebGLState.vramSampleTexture);
	gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
}

function writeTexturedUniforms(gl: WebGL2RenderingContext, commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const textureWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2];
	const textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	gl.uniform1i(gxGpuWebGLState.texturedVramUniform, GX_GPU_TEXTURE_SAMPLE_UNIT);
	gl.uniform2f(gxGpuWebGLState.texturedTexPageBaseUniform, gxGpuDrawModeTexturePageBaseX(drawModeWord), gxGpuDrawModeTexturePageBaseY(drawModeWord));
	gl.uniform2f(gxGpuWebGLState.texturedClutBaseUniform, gxGpuTextureClutBaseX(textureWord), gxGpuTextureClutBaseY(textureWord));
	gl.uniform2f(gxGpuWebGLState.texturedTextureWindowAndUniform, gxGpuTextureWindowAndX(textureWindowWord), gxGpuTextureWindowAndY(textureWindowWord));
	gl.uniform2f(gxGpuWebGLState.texturedTextureWindowOrUniform, gxGpuTextureWindowOrX(textureWindowWord), gxGpuTextureWindowOrY(textureWindowWord));
	gl.uniform1f(gxGpuWebGLState.texturedTextureModeUniform, gxGpuDrawModeTextureMode(drawModeWord));
	gl.uniform1f(gxGpuWebGLState.texturedRawTextureUniform, gxGpuCommandRawTextureEnabled(opcode) ? 1 : 0);
}

function flushSolidCommands(
	backend: WebGLBackend,
	gl: WebGL2RenderingContext,
	vertexFloatCount: number,
	topLeftWord: number,
	bottomRightWord: number,
): number {
	if (vertexFloatCount !== 0) {
		backend.bindArrayBuffer(gxGpuWebGLState.solidVertexBuffer);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, gxGpuSolidVertices, 0, vertexFloatCount);
		renderNewSolidCommands(backend, gl, vertexFloatCount / GX_GPU_SOLID_VERTEX_FLOATS, topLeftWord, bottomRightWord);
	}
	return 0;
}

function executeNewGxGpuCommands(backend: WebGLBackend, gl: WebGL2RenderingContext, commandBuffer: GxGpuCommandBufferView): void {
	let commandIndex = gxGpuWebGLState.processedCommandCount;
	let vertexFloatCount = 0;
	let solidBatchTopLeftWord = GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD;
	let solidBatchBottomRightWord = GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD;
	for (; commandIndex < commandBuffer.commandCount; commandIndex += 1) {
		switch (commandBuffer.commandKind[commandIndex]) {
			case GX_GPU_COMMAND_DRAW_POLYGON: {
				const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
				const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
				if (vertexFloatCount !== 0 && (topLeftWord !== solidBatchTopLeftWord || bottomRightWord !== solidBatchBottomRightWord || gxGpuCommandTextureEnabled(commandBuffer.commandOpcode[commandIndex]))) {
					vertexFloatCount = flushSolidCommands(backend, gl, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord);
				}
				solidBatchTopLeftWord = topLeftWord;
				solidBatchBottomRightWord = bottomRightWord;
				if (gxGpuCommandTextureEnabled(commandBuffer.commandOpcode[commandIndex])) {
					renderTexturedCommand(backend, gl, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
				} else {
					vertexFloatCount = appendSolidPolygon(commandBuffer, commandIndex, vertexFloatCount);
				}
				break;
			}
			case GX_GPU_COMMAND_DRAW_RECTANGLE: {
				const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
				const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
				if (vertexFloatCount !== 0 && (topLeftWord !== solidBatchTopLeftWord || bottomRightWord !== solidBatchBottomRightWord || gxGpuCommandTextureEnabled(commandBuffer.commandOpcode[commandIndex]))) {
					vertexFloatCount = flushSolidCommands(backend, gl, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord);
				}
				solidBatchTopLeftWord = topLeftWord;
				solidBatchBottomRightWord = bottomRightWord;
				if (gxGpuCommandTextureEnabled(commandBuffer.commandOpcode[commandIndex])) {
					renderTexturedCommand(backend, gl, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
				} else {
					vertexFloatCount = appendSolidRectangle(commandBuffer, commandIndex, vertexFloatCount);
				}
				break;
			}
			case GX_GPU_COMMAND_FILL_RECTANGLE:
				if (vertexFloatCount !== 0 && (solidBatchTopLeftWord !== GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD || solidBatchBottomRightWord !== GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD)) {
					vertexFloatCount = flushSolidCommands(backend, gl, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord);
				}
				solidBatchTopLeftWord = GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD;
				solidBatchBottomRightWord = GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD;
				vertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
				break;
			case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
				vertexFloatCount = flushSolidCommands(backend, gl, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord);
				uploadCpuToVram(backend, gl, commandBuffer, commandIndex);
				break;
		}
	}
	gxGpuWebGLState.processedCommandCount = commandBuffer.commandCount;
	flushSolidCommands(backend, gl, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord);
}

function renderNewSolidCommands(
	backend: WebGLBackend,
	gl: WebGL2RenderingContext,
	vertexCount: number,
	topLeftWord: number,
	bottomRightWord: number,
): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuWebGLState.vramFramebuffer);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setCullEnabled(false);
	backend.setBlendEnabled(false);
	applyGxGpuDrawingAreaScissor(gl, topLeftWord, bottomRightWord);
	backend.useProgram(gxGpuWebGLState.solidProgram);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuWebGLState.solidVertexBuffer);
	gl.enableVertexAttribArray(gxGpuWebGLState.solidPositionAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.solidPositionAttrib, 2, gl.FLOAT, false, GX_GPU_SOLID_VERTEX_FLOATS * 4, 0);
	gl.enableVertexAttribArray(gxGpuWebGLState.solidColorAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.solidColorAttrib, 4, gl.FLOAT, false, GX_GPU_SOLID_VERTEX_FLOATS * 4, 2 * 4);
	gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
	gl.disable(gl.SCISSOR_TEST);
}

function renderTexturedCommand(
	backend: WebGLBackend,
	gl: WebGL2RenderingContext,
	commandBuffer: GxGpuCommandBufferView,
	commandIndex: number,
	topLeftWord: number,
	bottomRightWord: number,
): void {
	let vertexFloatCount = 0;
	if (commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON) {
		vertexFloatCount = appendTexturedPolygon(commandBuffer, commandIndex, vertexFloatCount);
	} else {
		vertexFloatCount = appendTexturedRectangle(commandBuffer, commandIndex, vertexFloatCount);
	}
	if (vertexFloatCount === 0) {
		return;
	}
	copyGxGpuVramToSampleTexture(backend, gl);
	backend.bindArrayBuffer(gxGpuWebGLState.texturedVertexBuffer);
	gl.bufferSubData(gl.ARRAY_BUFFER, 0, gxGpuTexturedVertices, 0, vertexFloatCount);
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuWebGLState.vramFramebuffer);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setCullEnabled(false);
	backend.setBlendEnabled(false);
	applyGxGpuDrawingAreaScissor(gl, topLeftWord, bottomRightWord);
	backend.useProgram(gxGpuWebGLState.texturedProgram);
	writeTexturedUniforms(gl, commandBuffer, commandIndex);
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(gxGpuWebGLState.vramSampleTexture);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuWebGLState.texturedVertexBuffer);
	gl.enableVertexAttribArray(gxGpuWebGLState.texturedPositionAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.texturedPositionAttrib, 2, gl.FLOAT, false, GX_GPU_TEXTURED_VERTEX_FLOATS * 4, 0);
	gl.enableVertexAttribArray(gxGpuWebGLState.texturedColorAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.texturedColorAttrib, 3, gl.FLOAT, false, GX_GPU_TEXTURED_VERTEX_FLOATS * 4, 2 * 4);
	gl.enableVertexAttribArray(gxGpuWebGLState.texturedTexcoordAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.texturedTexcoordAttrib, 2, gl.FLOAT, false, GX_GPU_TEXTURED_VERTEX_FLOATS * 4, 5 * 4);
	gl.drawArrays(gl.TRIANGLES, 0, vertexFloatCount / GX_GPU_TEXTURED_VERTEX_FLOATS);
	gl.disable(gl.SCISSOR_TEST);
}

function scanoutGxGpuVram(backend: WebGLBackend, gl: WebGL2RenderingContext, fbo: WebGLFramebuffer, state: RenderPassStateRegistry['gx_gpu']): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	backend.setViewportRect(0, 0, state.width, state.height);
	gl.disable(gl.SCISSOR_TEST);
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
	executeNewGxGpuCommands(backend, gl, state.commandBuffer);
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
