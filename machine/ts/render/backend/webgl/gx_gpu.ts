import {
	GX_GPU_STATUS_DISPLAY_DISABLE,
} from '../../../machine/devices/gx/gpu';
import {
	GX_GPU_COMMAND_CAPACITY,
	GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
	GX_GPU_COMMAND_DRAW_LINE,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_POLYLINE,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GX_GPU_VRAM_HEIGHT,
	GX_GPU_VRAM_WIDTH,
	gxGpuCommandGouraud,
	gxGpuCommandRawTextureEnabled,
	gxGpuCommandSemiTransparencyEnabled,
	gxGpuCommandQuadPolygon,
	gxGpuCommandRectangleHeight,
	gxGpuCommandRectangleWidth,
	gxGpuCommandTextureEnabled,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuDrawModeTextureMode,
	gxGpuDrawModeTransparencyMode,
	gxGpuDrawModeTexturePageBaseX,
	gxGpuDrawModeTexturePageBaseY,
	gxGpuDrawModeTextureRectangleXFlip,
	gxGpuDrawModeTextureRectangleYFlip,
	gxGpuDrawingOffsetX,
	gxGpuDrawingOffsetY,
	gxGpuMaskBitCheckBeforeDraw,
	gxGpuMaskBitSetWhileDrawing,
	gxGpuTextureClutBaseX,
	gxGpuTextureClutBaseY,
	gxGpuTextureRectangleEdge0,
	gxGpuTextureRectangleEdge1,
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
import lineVertexShader from './shaders/gx_gpu_line.vert.glsl';
import lineFragmentShader from './shaders/gx_gpu_line.frag.glsl';
import texturedVertexShader from './shaders/gx_gpu_textured.vert.glsl';
import texturedFragmentShader from './shaders/gx_gpu_textured.frag.glsl';
import transferVertexShader from './shaders/gx_gpu_transfer.vert.glsl';
import transferFragmentShader from './shaders/gx_gpu_transfer.frag.glsl';
import scanoutVertexShader from './shaders/gx_gpu_scanout.vert.glsl';
import scanoutFragmentShader from './shaders/gx_gpu_scanout.frag.glsl';

const GX_GPU_SCANOUT_TEXTURE_UNIT = 0;
const GX_GPU_TEXTURE_SAMPLE_UNIT = 1;
const GX_GPU_TEXTURE_TRANSFER_UNIT = 2;
const GX_GPU_SOLID_VERTEX_FLOATS = 6;
const GX_GPU_SOLID_VERTICES_PER_COMMAND = 6;
const GX_GPU_SOLID_FLOAT_CAPACITY = GX_GPU_COMMAND_CAPACITY * GX_GPU_SOLID_VERTICES_PER_COMMAND * GX_GPU_SOLID_VERTEX_FLOATS;
const GX_GPU_LINE_VERTEX_FLOATS = 12;
const GX_GPU_LINE_VERTICES_PER_SEGMENT = 6;
const GX_GPU_LINE_SEGMENT_FLOATS = GX_GPU_LINE_VERTICES_PER_SEGMENT * GX_GPU_LINE_VERTEX_FLOATS;
const GX_GPU_LINE_SEGMENT_CAPACITY = 1024;
const GX_GPU_LINE_FLOAT_CAPACITY = GX_GPU_LINE_SEGMENT_CAPACITY * GX_GPU_LINE_SEGMENT_FLOATS;
const GX_GPU_TEXTURED_VERTEX_FLOATS = 7;
const GX_GPU_TEXTURED_VERTICES_PER_COMMAND = 6;
const GX_GPU_TEXTURED_FLOAT_CAPACITY = GX_GPU_TEXTURED_VERTICES_PER_COMMAND * GX_GPU_TEXTURED_VERTEX_FLOATS;
const GX_GPU_TRANSFER_VERTEX_FLOATS = 4;
const GX_GPU_TRANSFER_VERTICES_PER_SEGMENT = 6;
const GX_GPU_TRANSFER_SEGMENTS_PER_ROW = 3;
const GX_GPU_TRANSFER_FLOAT_CAPACITY = GX_GPU_VRAM_HEIGHT * GX_GPU_TRANSFER_SEGMENTS_PER_ROW * GX_GPU_TRANSFER_VERTICES_PER_SEGMENT * GX_GPU_TRANSFER_VERTEX_FLOATS;
const GX_GPU_SCANOUT_VERTEX_FLOATS = 4;
const GX_GPU_RAW_VRAM_BYTES_PER_PIXEL = 4;
const GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES = GX_GPU_VRAM_WIDTH * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
const GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD = 0;
const GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD = (GX_GPU_VRAM_WIDTH - 1) | ((GX_GPU_VRAM_HEIGHT - 1) << 10);

const gxGpuSolidVertices = new Float32Array(GX_GPU_SOLID_FLOAT_CAPACITY);
const gxGpuLineVertices = new Float32Array(GX_GPU_LINE_FLOAT_CAPACITY);
const gxGpuTexturedVertices = new Float32Array(GX_GPU_TEXTURED_FLOAT_CAPACITY);
const gxGpuTransferVertices = new Float32Array(GX_GPU_TRANSFER_FLOAT_CAPACITY);
const gxGpuRawVramUploadRow = new Uint8Array(GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES);
const gxGpuScanoutVertices = new Float32Array(6 * GX_GPU_SCANOUT_VERTEX_FLOATS);

type GxGpuWebGLState = {
	solidProgram: WebGLProgram;
	lineProgram: WebGLProgram;
	texturedProgram: WebGLProgram;
	transferProgram: WebGLProgram;
	scanoutProgram: WebGLProgram;
	vramTexture: WebGLTexture;
	vramSampleTexture: WebGLTexture;
	vramTransferTexture: WebGLTexture;
	vramFramebuffer: WebGLFramebuffer;
	solidVertexBuffer: WebGLBuffer;
	lineVertexBuffer: WebGLBuffer;
	texturedVertexBuffer: WebGLBuffer;
	transferVertexBuffer: WebGLBuffer;
	scanoutVertexBuffer: WebGLBuffer;
	solidPositionAttrib: number;
	solidColorAttrib: number;
	solidVramUniform: WebGLUniformLocation;
	solidBlendEnableUniform: WebGLUniformLocation;
	solidBlendModeUniform: WebGLUniformLocation;
	solidCheckMaskBitUniform: WebGLUniformLocation;
	solidSetMaskBitUniform: WebGLUniformLocation;
	linePositionAttrib: number;
	lineStartAttrib: number;
	lineEndAttrib: number;
	lineColor0Attrib: number;
	lineColor1Attrib: number;
	lineVramUniform: WebGLUniformLocation;
	lineBlendEnableUniform: WebGLUniformLocation;
	lineBlendModeUniform: WebGLUniformLocation;
	lineCheckMaskBitUniform: WebGLUniformLocation;
	lineSetMaskBitUniform: WebGLUniformLocation;
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
	texturedBlendEnableUniform: WebGLUniformLocation;
	texturedBlendModeUniform: WebGLUniformLocation;
	texturedCheckMaskBitUniform: WebGLUniformLocation;
	texturedSetMaskBitUniform: WebGLUniformLocation;
	transferPositionAttrib: number;
	transferTexcoordAttrib: number;
	transferSourceUniform: WebGLUniformLocation;
	transferVramUniform: WebGLUniformLocation;
	transferCheckMaskBitUniform: WebGLUniformLocation;
	transferSetMaskBitUniform: WebGLUniformLocation;
	scanoutPositionAttrib: number;
	scanoutTexcoordAttrib: number;
	scanoutVramUniform: WebGLUniformLocation;
	scanoutDisplayModeUniform: WebGLUniformLocation;
	scanoutDisplayStartWordUniform: WebGLUniformLocation;
	scanoutHorizontalDisplayRangeUniform: WebGLUniformLocation;
	scanoutVerticalDisplayRangeUniform: WebGLUniformLocation;
	scanoutUniformDisplayModeWord: number;
	scanoutUniformDisplayStartWord: number;
	scanoutUniformHorizontalDisplayRangeWord: number;
	scanoutUniformVerticalDisplayRangeWord: number;
	processedCommandCount: number;
	processedCommandSerial: number;
};

let gxGpuWebGLState: GxGpuWebGLState;

function bootstrapGxGpuPass(backend: WebGLBackend): void {
	const gl = backend.gl;
	const solidProgram = backend.buildProgram(solidVertexShader, solidFragmentShader, 'gx_gpu_fill');
	const lineProgram = backend.buildProgram(lineVertexShader, lineFragmentShader, 'gx_gpu_line');
	const texturedProgram = backend.buildProgram(texturedVertexShader, texturedFragmentShader, 'gx_gpu_textured');
	const transferProgram = backend.buildProgram(transferVertexShader, transferFragmentShader, 'gx_gpu_transfer');
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

	const vramTransferTexture = gl.createTexture() as WebGLTexture;
	backend.setActiveTexture(GX_GPU_TEXTURE_TRANSFER_UNIT);
	backend.bindTexture2D(vramTransferTexture);
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

	const lineVertexBuffer = gl.createBuffer() as WebGLBuffer;
	backend.bindArrayBuffer(lineVertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, gxGpuLineVertices.byteLength, gl.DYNAMIC_DRAW);

	const texturedVertexBuffer = gl.createBuffer() as WebGLBuffer;
	backend.bindArrayBuffer(texturedVertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, gxGpuTexturedVertices.byteLength, gl.DYNAMIC_DRAW);

	const transferVertexBuffer = gl.createBuffer() as WebGLBuffer;
	backend.bindArrayBuffer(transferVertexBuffer);
	gl.bufferData(gl.ARRAY_BUFFER, gxGpuTransferVertices.byteLength, gl.DYNAMIC_DRAW);

	const scanoutVertexBuffer = gl.createBuffer() as WebGLBuffer;
	backend.bindArrayBuffer(scanoutVertexBuffer);
	updateGxGpuScanoutVertices();
	gl.bufferData(gl.ARRAY_BUFFER, gxGpuScanoutVertices, gl.STATIC_DRAW);

	gxGpuWebGLState = {
		solidProgram,
		lineProgram,
		texturedProgram,
		transferProgram,
		scanoutProgram,
		vramTexture,
		vramSampleTexture,
		vramTransferTexture,
		vramFramebuffer,
		solidVertexBuffer,
		lineVertexBuffer,
		texturedVertexBuffer,
		transferVertexBuffer,
		scanoutVertexBuffer,
		solidPositionAttrib: gl.getAttribLocation(solidProgram, 'a_position'),
		solidColorAttrib: gl.getAttribLocation(solidProgram, 'a_color'),
		solidVramUniform: gl.getUniformLocation(solidProgram, 'u_vram') as WebGLUniformLocation,
		solidBlendEnableUniform: gl.getUniformLocation(solidProgram, 'u_blendEnable') as WebGLUniformLocation,
		solidBlendModeUniform: gl.getUniformLocation(solidProgram, 'u_blendMode') as WebGLUniformLocation,
		solidCheckMaskBitUniform: gl.getUniformLocation(solidProgram, 'u_checkMaskBit') as WebGLUniformLocation,
		solidSetMaskBitUniform: gl.getUniformLocation(solidProgram, 'u_setMaskBit') as WebGLUniformLocation,
		linePositionAttrib: gl.getAttribLocation(lineProgram, 'a_position'),
		lineStartAttrib: gl.getAttribLocation(lineProgram, 'a_lineStart'),
		lineEndAttrib: gl.getAttribLocation(lineProgram, 'a_lineEnd'),
		lineColor0Attrib: gl.getAttribLocation(lineProgram, 'a_color0'),
		lineColor1Attrib: gl.getAttribLocation(lineProgram, 'a_color1'),
		lineVramUniform: gl.getUniformLocation(lineProgram, 'u_vram') as WebGLUniformLocation,
		lineBlendEnableUniform: gl.getUniformLocation(lineProgram, 'u_blendEnable') as WebGLUniformLocation,
		lineBlendModeUniform: gl.getUniformLocation(lineProgram, 'u_blendMode') as WebGLUniformLocation,
		lineCheckMaskBitUniform: gl.getUniformLocation(lineProgram, 'u_checkMaskBit') as WebGLUniformLocation,
		lineSetMaskBitUniform: gl.getUniformLocation(lineProgram, 'u_setMaskBit') as WebGLUniformLocation,
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
		texturedBlendEnableUniform: gl.getUniformLocation(texturedProgram, 'u_blendEnable') as WebGLUniformLocation,
		texturedBlendModeUniform: gl.getUniformLocation(texturedProgram, 'u_blendMode') as WebGLUniformLocation,
		texturedCheckMaskBitUniform: gl.getUniformLocation(texturedProgram, 'u_checkMaskBit') as WebGLUniformLocation,
		texturedSetMaskBitUniform: gl.getUniformLocation(texturedProgram, 'u_setMaskBit') as WebGLUniformLocation,
		transferPositionAttrib: gl.getAttribLocation(transferProgram, 'a_position'),
		transferTexcoordAttrib: gl.getAttribLocation(transferProgram, 'a_texcoord'),
		transferSourceUniform: gl.getUniformLocation(transferProgram, 'u_source') as WebGLUniformLocation,
		transferVramUniform: gl.getUniformLocation(transferProgram, 'u_vram') as WebGLUniformLocation,
		transferCheckMaskBitUniform: gl.getUniformLocation(transferProgram, 'u_checkMaskBit') as WebGLUniformLocation,
		transferSetMaskBitUniform: gl.getUniformLocation(transferProgram, 'u_setMaskBit') as WebGLUniformLocation,
		scanoutPositionAttrib: gl.getAttribLocation(scanoutProgram, 'a_position'),
		scanoutTexcoordAttrib: gl.getAttribLocation(scanoutProgram, 'a_texcoord'),
		scanoutVramUniform: gl.getUniformLocation(scanoutProgram, 'u_vram') as WebGLUniformLocation,
		scanoutDisplayModeUniform: gl.getUniformLocation(scanoutProgram, 'u_displayModeWord') as WebGLUniformLocation,
		scanoutDisplayStartWordUniform: gl.getUniformLocation(scanoutProgram, 'u_displayStartWord') as WebGLUniformLocation,
		scanoutHorizontalDisplayRangeUniform: gl.getUniformLocation(scanoutProgram, 'u_horizontalDisplayRangeWord') as WebGLUniformLocation,
		scanoutVerticalDisplayRangeUniform: gl.getUniformLocation(scanoutProgram, 'u_verticalDisplayRangeWord') as WebGLUniformLocation,
		scanoutUniformDisplayModeWord: 0xffffffff,
		scanoutUniformDisplayStartWord: 0xffffffff,
		scanoutUniformHorizontalDisplayRangeWord: 0xffffffff,
		scanoutUniformVerticalDisplayRangeWord: 0xffffffff,
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

function writeLineVertex(
	offset: number,
	x: number,
	y: number,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	color0: number,
	color1: number,
): number {
	gxGpuLineVertices[offset] = x;
	gxGpuLineVertices[offset + 1] = y;
	gxGpuLineVertices[offset + 2] = x0;
	gxGpuLineVertices[offset + 3] = y0;
	gxGpuLineVertices[offset + 4] = x1;
	gxGpuLineVertices[offset + 5] = y1;
	gxGpuLineVertices[offset + 6] = (color0 & 0xff) / 255;
	gxGpuLineVertices[offset + 7] = ((color0 >>> 8) & 0xff) / 255;
	gxGpuLineVertices[offset + 8] = ((color0 >>> 16) & 0xff) / 255;
	gxGpuLineVertices[offset + 9] = (color1 & 0xff) / 255;
	gxGpuLineVertices[offset + 10] = ((color1 >>> 8) & 0xff) / 255;
	gxGpuLineVertices[offset + 11] = ((color1 >>> 16) & 0xff) / 255;
	return offset + GX_GPU_LINE_VERTEX_FLOATS;
}

function appendLineSegment(vertexFloatCount: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number): number {
	const left = x0 < x1 ? x0 : x1;
	const right = x0 > x1 ? x0 : x1;
	const top = y0 < y1 ? y0 : y1;
	const bottom = y0 > y1 ? y0 : y1;
	const width = right - left + 1;
	const height = bottom - top + 1;
	if (width > GX_GPU_VRAM_WIDTH || height > GX_GPU_VRAM_HEIGHT) {
		return vertexFloatCount;
	}
	const x2 = right + 1;
	const y2 = bottom + 1;
	let offset = vertexFloatCount;
	offset = writeLineVertex(offset, left, top, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(offset, left, y2, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(offset, x2, top, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(offset, x2, top, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(offset, left, y2, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(offset, x2, y2, x0, y0, x1, y1, color0, color1);
	return offset;
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
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const xFlip = gxGpuDrawModeTextureRectangleXFlip(drawModeWord);
	const yFlip = gxGpuDrawModeTextureRectangleYFlip(drawModeWord);
	const u0 = gxGpuTextureRectangleEdge0(gxGpuTextureU(textureWord), xFlip);
	const v0 = gxGpuTextureRectangleEdge0(gxGpuTextureV(textureWord), yFlip);
	const u1 = gxGpuTextureRectangleEdge1(u0, width, xFlip);
	const v1 = gxGpuTextureRectangleEdge1(v0, height, yFlip);
	let offset = vertexFloatCount;
	offset = appendTexturedTriangle(offset, x0, y0, colorWord, u0, v0, x1, y0, colorWord, u1, v0, x0, y1, colorWord, u0, v1);
	offset = appendTexturedTriangle(offset, x0, y1, colorWord, u0, v1, x1, y0, colorWord, u1, v0, x1, y1, colorWord, u1, v1);
	return offset;
}


function writeTransferVertex(offset: number, x: number, y: number, u: number, v: number): number {
	gxGpuTransferVertices[offset] = x;
	gxGpuTransferVertices[offset + 1] = y;
	gxGpuTransferVertices[offset + 2] = u;
	gxGpuTransferVertices[offset + 3] = v;
	return offset + GX_GPU_TRANSFER_VERTEX_FLOATS;
}

function appendTransferTriangle(
	vertexFloatCount: number,
	x0: number,
	y0: number,
	u0: number,
	v0: number,
	x1: number,
	y1: number,
	u1: number,
	v1: number,
	x2: number,
	y2: number,
	u2: number,
	v2: number,
): number {
	let offset = vertexFloatCount;
	offset = writeTransferVertex(offset, x0, y0, u0, v0);
	offset = writeTransferVertex(offset, x1, y1, u1, v1);
	offset = writeTransferVertex(offset, x2, y2, u2, v2);
	return offset;
}

function appendTransferQuad(vertexFloatCount: number, x: number, y: number, width: number, height: number, u: number, v: number): number {
	const x1 = x + width;
	const y1 = y + height;
	const u1 = u + width;
	const v1 = v + height;
	let offset = vertexFloatCount;
	offset = appendTransferTriangle(offset, x, y, u, v, x1, y, u1, v, x, y1, u, v1);
	offset = appendTransferTriangle(offset, x, y1, u, v1, x1, y, u1, v, x1, y1, u1, v1);
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
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	let transferVertexFloatCount = 0;

	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	backend.setActiveTexture(maskBitModeWord === 0 ? GX_GPU_SCANOUT_TEXTURE_UNIT : GX_GPU_TEXTURE_TRANSFER_UNIT);
	backend.bindTexture2D(maskBitModeWord === 0 ? gxGpuWebGLState.vramTexture : gxGpuWebGLState.vramTransferTexture);
	for (let row = 0; row < height; row += 1) {
		writeCpuToVramUploadRow(commandBuffer, payloadWordStart, row * width, width);
		const targetY = (y + row) & (GX_GPU_VRAM_HEIGHT - 1);
		const storageY = (GX_GPU_VRAM_HEIGHT - 1) - targetY;
		const firstWidth = width <= GX_GPU_VRAM_WIDTH - x ? width : GX_GPU_VRAM_WIDTH - x;
		gl.texSubImage2D(gl.TEXTURE_2D, 0, x, storageY, firstWidth, 1, gl.RGBA, gl.UNSIGNED_BYTE, gxGpuRawVramUploadRow, 0);
		if (maskBitModeWord !== 0) {
			transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, x, targetY, firstWidth, 1, x, targetY);
		}
		if (firstWidth !== width) {
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, storageY, width - firstWidth, 1, gl.RGBA, gl.UNSIGNED_BYTE, gxGpuRawVramUploadRow, firstWidth * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL);
			if (maskBitModeWord !== 0) {
				transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, 0, targetY, width - firstWidth, 1, 0, targetY);
			}
		}
	}
	if (maskBitModeWord !== 0) {
		if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
			copyGxGpuVramToSampleTexture(backend, gl);
		}
		renderTransferCommands(backend, gl, transferVertexFloatCount, gxGpuWebGLState.vramTransferTexture, GX_GPU_TEXTURE_TRANSFER_UNIT, maskBitModeWord);
	}
}

function copyVramToVram(backend: WebGLBackend, gl: WebGL2RenderingContext, commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const sourceWord = commandBuffer.words[wordStart + 1];
	const targetWord = commandBuffer.words[wordStart + 2];
	const sizeWord = commandBuffer.words[wordStart + 3];
	const sourceX = gxGpuTransferX(sourceWord);
	const sourceY = gxGpuTransferY(sourceWord);
	const targetX = gxGpuTransferX(targetWord);
	const targetY = gxGpuTransferY(targetWord);
	const width = gxGpuTransferWidth(sizeWord);
	const height = gxGpuTransferHeight(sizeWord);
	let transferVertexFloatCount = 0;
	for (let row = 0; row < height; row += 1) {
		const rowSourceY = (sourceY + row) & (GX_GPU_VRAM_HEIGHT - 1);
		const rowTargetY = (targetY + row) & (GX_GPU_VRAM_HEIGHT - 1);
		let rowSourceX = sourceX;
		let rowTargetX = targetX;
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const sourceRunWidth = GX_GPU_VRAM_WIDTH - rowSourceX;
			const targetRunWidth = GX_GPU_VRAM_WIDTH - rowTargetX;
			let runWidth = remainingWidth;
			if (sourceRunWidth < runWidth) {
				runWidth = sourceRunWidth;
			}
			if (targetRunWidth < runWidth) {
				runWidth = targetRunWidth;
			}
			transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, rowTargetX, rowTargetY, runWidth, 1, rowSourceX, rowSourceY);
			rowSourceX = (rowSourceX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			rowTargetX = (rowTargetX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			remainingWidth -= runWidth;
		}
	}
	copyGxGpuVramToSampleTexture(backend, gl);
	renderTransferCommands(backend, gl, transferVertexFloatCount, gxGpuWebGLState.vramSampleTexture, GX_GPU_TEXTURE_SAMPLE_UNIT, commandBuffer.commandMaskBitModeWord[commandIndex]);
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

function writeSolidUniforms(gl: WebGL2RenderingContext, blendEnabled: boolean, blendMode: number, maskBitModeWord: number): void {
	gl.uniform1i(gxGpuWebGLState.solidVramUniform, GX_GPU_TEXTURE_SAMPLE_UNIT);
	gl.uniform1f(gxGpuWebGLState.solidBlendEnableUniform, blendEnabled ? 1 : 0);
	gl.uniform1f(gxGpuWebGLState.solidBlendModeUniform, blendMode);
	gl.uniform1f(gxGpuWebGLState.solidCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	gl.uniform1f(gxGpuWebGLState.solidSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
}

function writeLineUniforms(gl: WebGL2RenderingContext, blendEnabled: boolean, blendMode: number, maskBitModeWord: number): void {
	gl.uniform1i(gxGpuWebGLState.lineVramUniform, GX_GPU_TEXTURE_SAMPLE_UNIT);
	gl.uniform1f(gxGpuWebGLState.lineBlendEnableUniform, blendEnabled ? 1 : 0);
	gl.uniform1f(gxGpuWebGLState.lineBlendModeUniform, blendMode);
	gl.uniform1f(gxGpuWebGLState.lineCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	gl.uniform1f(gxGpuWebGLState.lineSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
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
	gl.uniform1f(gxGpuWebGLState.texturedBlendEnableUniform, gxGpuCommandSemiTransparencyEnabled(opcode) ? 1 : 0);
	gl.uniform1f(gxGpuWebGLState.texturedBlendModeUniform, gxGpuDrawModeTransparencyMode(drawModeWord));
	gl.uniform1f(gxGpuWebGLState.texturedCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(commandBuffer.commandMaskBitModeWord[commandIndex]) ? 1 : 0);
	gl.uniform1f(gxGpuWebGLState.texturedSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(commandBuffer.commandMaskBitModeWord[commandIndex]) ? 1 : 0);
}

function writeTransferUniforms(gl: WebGL2RenderingContext, sourceTextureUnit: number, maskBitModeWord: number): void {
	gl.uniform1i(gxGpuWebGLState.transferSourceUniform, sourceTextureUnit);
	gl.uniform1i(gxGpuWebGLState.transferVramUniform, GX_GPU_TEXTURE_SAMPLE_UNIT);
	gl.uniform1f(gxGpuWebGLState.transferCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	gl.uniform1f(gxGpuWebGLState.transferSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
}

function flushSolidCommands(
	backend: WebGLBackend,
	gl: WebGL2RenderingContext,
	vertexFloatCount: number,
	topLeftWord: number,
	bottomRightWord: number,
	maskBitModeWord: number,
): number {
	if (vertexFloatCount !== 0) {
		backend.bindArrayBuffer(gxGpuWebGLState.solidVertexBuffer);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, gxGpuSolidVertices, 0, vertexFloatCount);
		renderNewSolidCommands(backend, gl, vertexFloatCount / GX_GPU_SOLID_VERTEX_FLOATS, topLeftWord, bottomRightWord, false, 0, maskBitModeWord);
	}
	return 0;
}

function renderNewLineCommands(
	backend: WebGLBackend,
	gl: WebGL2RenderingContext,
	vertexFloatCount: number,
	topLeftWord: number,
	bottomRightWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
): void {
	backend.bindArrayBuffer(gxGpuWebGLState.lineVertexBuffer);
	gl.bufferSubData(gl.ARRAY_BUFFER, 0, gxGpuLineVertices, 0, vertexFloatCount);
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuWebGLState.vramFramebuffer);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setCullEnabled(false);
	backend.setBlendEnabled(false);
	applyGxGpuDrawingAreaScissor(gl, topLeftWord, bottomRightWord);
	backend.useProgram(gxGpuWebGLState.lineProgram);
	writeLineUniforms(gl, blendEnabled, blendMode, maskBitModeWord);
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(gxGpuWebGLState.vramSampleTexture);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuWebGLState.lineVertexBuffer);
	gl.enableVertexAttribArray(gxGpuWebGLState.linePositionAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.linePositionAttrib, 2, gl.FLOAT, false, GX_GPU_LINE_VERTEX_FLOATS * 4, 0);
	gl.enableVertexAttribArray(gxGpuWebGLState.lineStartAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.lineStartAttrib, 2, gl.FLOAT, false, GX_GPU_LINE_VERTEX_FLOATS * 4, 2 * 4);
	gl.enableVertexAttribArray(gxGpuWebGLState.lineEndAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.lineEndAttrib, 2, gl.FLOAT, false, GX_GPU_LINE_VERTEX_FLOATS * 4, 4 * 4);
	gl.enableVertexAttribArray(gxGpuWebGLState.lineColor0Attrib);
	gl.vertexAttribPointer(gxGpuWebGLState.lineColor0Attrib, 3, gl.FLOAT, false, GX_GPU_LINE_VERTEX_FLOATS * 4, 6 * 4);
	gl.enableVertexAttribArray(gxGpuWebGLState.lineColor1Attrib);
	gl.vertexAttribPointer(gxGpuWebGLState.lineColor1Attrib, 3, gl.FLOAT, false, GX_GPU_LINE_VERTEX_FLOATS * 4, 9 * 4);
	gl.drawArrays(gl.TRIANGLES, 0, vertexFloatCount / GX_GPU_LINE_VERTEX_FLOATS);
	gl.disable(gl.SCISSOR_TEST);
}

function flushLineCommands(
	backend: WebGLBackend,
	gl: WebGL2RenderingContext,
	vertexFloatCount: number,
	topLeftWord: number,
	bottomRightWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
): number {
	if (vertexFloatCount !== 0) {
		renderNewLineCommands(backend, gl, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord);
	}
	return 0;
}

function renderLineSegmentCommand(
	backend: WebGLBackend,
	gl: WebGL2RenderingContext,
	topLeftWord: number,
	bottomRightWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
	x0: number,
	y0: number,
	color0: number,
	x1: number,
	y1: number,
	color1: number,
): void {
	const vertexFloatCount = appendLineSegment(0, x0, y0, color0, x1, y1, color1);
	if (vertexFloatCount !== 0) {
		copyGxGpuVramToSampleTexture(backend, gl);
		renderNewLineCommands(backend, gl, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord);
	}
}

function appendBatchedLineSegment(
	backend: WebGLBackend,
	gl: WebGL2RenderingContext,
	vertexFloatCount: number,
	topLeftWord: number,
	bottomRightWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
	x0: number,
	y0: number,
	color0: number,
	x1: number,
	y1: number,
	color1: number,
): number {
	let offset = vertexFloatCount;
	if (offset + GX_GPU_LINE_SEGMENT_FLOATS > GX_GPU_LINE_FLOAT_CAPACITY) {
		offset = flushLineCommands(backend, gl, offset, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord);
	}
	return appendLineSegment(offset, x0, y0, color0, x1, y1, color1);
}

function emitLineSegment(
	backend: WebGLBackend,
	gl: WebGL2RenderingContext,
	vertexFloatCount: number,
	topLeftWord: number,
	bottomRightWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
	readsVram: boolean,
	x0: number,
	y0: number,
	color0: number,
	x1: number,
	y1: number,
	color1: number,
): number {
	if (readsVram) {
		renderLineSegmentCommand(backend, gl, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, x0, y0, color0, x1, y1, color1);
		return vertexFloatCount;
	}
	return appendBatchedLineSegment(backend, gl, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, x0, y0, color0, x1, y1, color1);
}

function renderLineCommand(
	backend: WebGLBackend,
	gl: WebGL2RenderingContext,
	commandBuffer: GxGpuCommandBufferView,
	commandIndex: number,
	topLeftWord: number,
	bottomRightWord: number,
): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const wordEnd = wordStart + commandBuffer.commandWordCount[commandIndex];
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuDrawingOffsetX(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const blendMode = gxGpuDrawModeTransparencyMode(commandBuffer.commandDrawModeWord[commandIndex]);
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	let vertexFloatCount = 0;

	if (commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_LINE) {
		const color0 = commandBuffer.words[wordStart];
		const xy0 = commandBuffer.words[wordStart + 1];
		if (gxGpuCommandGouraud(opcode)) {
			const color1 = commandBuffer.words[wordStart + 2];
			const xy1 = commandBuffer.words[wordStart + 3];
			vertexFloatCount = emitLineSegment(backend, gl, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, readsVram, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1);
		} else {
			const xy1 = commandBuffer.words[wordStart + 2];
			vertexFloatCount = emitLineSegment(backend, gl, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, readsVram, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color0);
		}
		flushLineCommands(backend, gl, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord);
		return;
	}

	if (gxGpuCommandGouraud(opcode)) {
		let color0 = commandBuffer.words[wordStart];
		let xy0 = commandBuffer.words[wordStart + 1];
		for (let wordIndex = wordStart + 2; wordIndex + 1 < wordEnd; wordIndex += 2) {
			const color1 = commandBuffer.words[wordIndex];
			const xy1 = commandBuffer.words[wordIndex + 1];
			vertexFloatCount = emitLineSegment(backend, gl, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, readsVram, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color1);
			color0 = color1;
			xy0 = xy1;
		}
	} else {
		const color = commandBuffer.words[wordStart];
		let xy0 = commandBuffer.words[wordStart + 1];
		for (let wordIndex = wordStart + 2; wordIndex < wordEnd; wordIndex += 1) {
			const xy1 = commandBuffer.words[wordIndex];
			vertexFloatCount = emitLineSegment(backend, gl, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, readsVram, dx + gxGpuVertexX(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuVertexX(xy1), dy + gxGpuVertexY(xy1), color);
			xy0 = xy1;
		}
	}
	flushLineCommands(backend, gl, vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord);
}

function renderSolidCommand(
	backend: WebGLBackend,
	gl: WebGL2RenderingContext,
	commandBuffer: GxGpuCommandBufferView,
	commandIndex: number,
	topLeftWord: number,
	bottomRightWord: number,
): void {
	let vertexFloatCount = 0;
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
	if (vertexFloatCount === 0) {
		return;
	}
	copyGxGpuVramToSampleTexture(backend, gl);
	backend.bindArrayBuffer(gxGpuWebGLState.solidVertexBuffer);
	gl.bufferSubData(gl.ARRAY_BUFFER, 0, gxGpuSolidVertices, 0, vertexFloatCount);
	const blendEnabled = commandBuffer.commandKind[commandIndex] !== GX_GPU_COMMAND_FILL_RECTANGLE && gxGpuCommandSemiTransparencyEnabled(commandBuffer.commandOpcode[commandIndex]);
	const maskBitModeWord = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_FILL_RECTANGLE ? 0 : commandBuffer.commandMaskBitModeWord[commandIndex];
	renderNewSolidCommands(
		backend,
		gl,
		vertexFloatCount / GX_GPU_SOLID_VERTEX_FLOATS,
		topLeftWord,
		bottomRightWord,
		blendEnabled,
		gxGpuDrawModeTransparencyMode(commandBuffer.commandDrawModeWord[commandIndex]),
		maskBitModeWord,
	);
}

function executeNewGxGpuCommands(backend: WebGLBackend, gl: WebGL2RenderingContext, commandBuffer: GxGpuCommandBufferView): void {
	let commandIndex = gxGpuWebGLState.processedCommandCount;
	let vertexFloatCount = 0;
	let solidBatchTopLeftWord = GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD;
	let solidBatchBottomRightWord = GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD;
	let solidBatchMaskBitModeWord = 0;
	for (; commandIndex < commandBuffer.commandCount; commandIndex += 1) {
		switch (commandBuffer.commandKind[commandIndex]) {
			case GX_GPU_COMMAND_DRAW_POLYGON: {
				const opcode = commandBuffer.commandOpcode[commandIndex];
				const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
				const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
				const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
				const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
				const batchMaskChange = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) !== gxGpuMaskBitSetWhileDrawing(solidBatchMaskBitModeWord);
				if (vertexFloatCount !== 0 && (topLeftWord !== solidBatchTopLeftWord || bottomRightWord !== solidBatchBottomRightWord || batchMaskChange || readsVram || gxGpuCommandTextureEnabled(opcode))) {
					vertexFloatCount = flushSolidCommands(backend, gl, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
				}
				solidBatchTopLeftWord = topLeftWord;
				solidBatchBottomRightWord = bottomRightWord;
				solidBatchMaskBitModeWord = maskBitModeWord;
				if (gxGpuCommandTextureEnabled(opcode)) {
					renderTexturedCommand(backend, gl, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
				} else if (readsVram) {
					renderSolidCommand(backend, gl, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
				} else {
					vertexFloatCount = appendSolidPolygon(commandBuffer, commandIndex, vertexFloatCount);
				}
				break;
			}
			case GX_GPU_COMMAND_DRAW_RECTANGLE: {
				const opcode = commandBuffer.commandOpcode[commandIndex];
				const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
				const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
				const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
				const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
				const batchMaskChange = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) !== gxGpuMaskBitSetWhileDrawing(solidBatchMaskBitModeWord);
				if (vertexFloatCount !== 0 && (topLeftWord !== solidBatchTopLeftWord || bottomRightWord !== solidBatchBottomRightWord || batchMaskChange || readsVram || gxGpuCommandTextureEnabled(opcode))) {
					vertexFloatCount = flushSolidCommands(backend, gl, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
				}
				solidBatchTopLeftWord = topLeftWord;
				solidBatchBottomRightWord = bottomRightWord;
				solidBatchMaskBitModeWord = maskBitModeWord;
				if (gxGpuCommandTextureEnabled(opcode)) {
					renderTexturedCommand(backend, gl, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
				} else if (readsVram) {
					renderSolidCommand(backend, gl, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
				} else {
					vertexFloatCount = appendSolidRectangle(commandBuffer, commandIndex, vertexFloatCount);
				}
				break;
			}
			case GX_GPU_COMMAND_FILL_RECTANGLE: {
				const topLeftWord = GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD;
				const bottomRightWord = GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD;
				const batchMaskChange = gxGpuMaskBitSetWhileDrawing(solidBatchMaskBitModeWord);
				if (vertexFloatCount !== 0 && (solidBatchTopLeftWord !== topLeftWord || solidBatchBottomRightWord !== bottomRightWord || batchMaskChange)) {
					vertexFloatCount = flushSolidCommands(backend, gl, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
				}
				solidBatchTopLeftWord = topLeftWord;
				solidBatchBottomRightWord = bottomRightWord;
				solidBatchMaskBitModeWord = 0;
				vertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
				break;
			}
			case GX_GPU_COMMAND_DRAW_LINE:
			case GX_GPU_COMMAND_DRAW_POLYLINE: {
				vertexFloatCount = flushSolidCommands(backend, gl, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
				const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
				const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
				renderLineCommand(backend, gl, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
				break;
			}
			case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
				vertexFloatCount = flushSolidCommands(backend, gl, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
				copyVramToVram(backend, gl, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
				vertexFloatCount = flushSolidCommands(backend, gl, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
				uploadCpuToVram(backend, gl, commandBuffer, commandIndex);
				break;
		}
	}
	gxGpuWebGLState.processedCommandCount = commandBuffer.commandCount;
	flushSolidCommands(backend, gl, vertexFloatCount, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchMaskBitModeWord);
}

function renderNewSolidCommands(
	backend: WebGLBackend,
	gl: WebGL2RenderingContext,
	vertexCount: number,
	topLeftWord: number,
	bottomRightWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuWebGLState.vramFramebuffer);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setCullEnabled(false);
	backend.setBlendEnabled(false);
	applyGxGpuDrawingAreaScissor(gl, topLeftWord, bottomRightWord);
	backend.useProgram(gxGpuWebGLState.solidProgram);
	writeSolidUniforms(gl, blendEnabled, blendMode, maskBitModeWord);
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(gxGpuWebGLState.vramSampleTexture);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuWebGLState.solidVertexBuffer);
	gl.enableVertexAttribArray(gxGpuWebGLState.solidPositionAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.solidPositionAttrib, 2, gl.FLOAT, false, GX_GPU_SOLID_VERTEX_FLOATS * 4, 0);
	gl.enableVertexAttribArray(gxGpuWebGLState.solidColorAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.solidColorAttrib, 4, gl.FLOAT, false, GX_GPU_SOLID_VERTEX_FLOATS * 4, 2 * 4);
	gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
	gl.disable(gl.SCISSOR_TEST);
}

function renderTransferCommands(
	backend: WebGLBackend,
	gl: WebGL2RenderingContext,
	vertexFloatCount: number,
	sourceTexture: WebGLTexture,
	sourceTextureUnit: number,
	maskBitModeWord: number,
): void {
	backend.bindArrayBuffer(gxGpuWebGLState.transferVertexBuffer);
	gl.bufferSubData(gl.ARRAY_BUFFER, 0, gxGpuTransferVertices, 0, vertexFloatCount);
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuWebGLState.vramFramebuffer);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	gl.disable(gl.SCISSOR_TEST);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setCullEnabled(false);
	backend.setBlendEnabled(false);
	backend.useProgram(gxGpuWebGLState.transferProgram);
	writeTransferUniforms(gl, sourceTextureUnit, maskBitModeWord);
	backend.setActiveTexture(sourceTextureUnit);
	backend.bindTexture2D(sourceTexture);
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(gxGpuWebGLState.vramSampleTexture);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuWebGLState.transferVertexBuffer);
	gl.enableVertexAttribArray(gxGpuWebGLState.transferPositionAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.transferPositionAttrib, 2, gl.FLOAT, false, GX_GPU_TRANSFER_VERTEX_FLOATS * 4, 0);
	gl.enableVertexAttribArray(gxGpuWebGLState.transferTexcoordAttrib);
	gl.vertexAttribPointer(gxGpuWebGLState.transferTexcoordAttrib, 2, gl.FLOAT, false, GX_GPU_TRANSFER_VERTEX_FLOATS * 4, 2 * 4);
	gl.drawArrays(gl.TRIANGLES, 0, vertexFloatCount / GX_GPU_TRANSFER_VERTEX_FLOATS);
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

function writeScanoutVertex(offset: number, x: number, y: number, u: number, v: number): number {
	gxGpuScanoutVertices[offset] = x;
	gxGpuScanoutVertices[offset + 1] = y;
	gxGpuScanoutVertices[offset + 2] = u;
	gxGpuScanoutVertices[offset + 3] = v;
	return offset + GX_GPU_SCANOUT_VERTEX_FLOATS;
}

function updateGxGpuScanoutVertices(): void {
	let offset = 0;
	offset = writeScanoutVertex(offset, -1.0, 1.0, 0.0, 0.0);
	offset = writeScanoutVertex(offset, -1.0, -1.0, 0.0, 1.0);
	offset = writeScanoutVertex(offset, 1.0, 1.0, 1.0, 0.0);
	offset = writeScanoutVertex(offset, 1.0, 1.0, 1.0, 0.0);
	offset = writeScanoutVertex(offset, -1.0, -1.0, 0.0, 1.0);
	writeScanoutVertex(offset, 1.0, -1.0, 1.0, 1.0);
}

function scanoutGxGpuVram(backend: WebGLBackend, gl: WebGL2RenderingContext, fbo: WebGLFramebuffer, state: RenderPassStateRegistry['gx_gpu']): void {
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	backend.setViewportRect(0, 0, state.width, state.height);
	gl.disable(gl.SCISSOR_TEST);
	if ((state.statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) !== 0) {
		gl.clearColor(0, 0, 0, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);
		return;
	}
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setCullEnabled(false);
	backend.setBlendEnabled(false);
	backend.useProgram(gxGpuWebGLState.scanoutProgram);
	gl.uniform1i(gxGpuWebGLState.scanoutVramUniform, GX_GPU_SCANOUT_TEXTURE_UNIT);
	if (gxGpuWebGLState.scanoutUniformDisplayModeWord !== state.displayModeWord) {
		gl.uniform1f(gxGpuWebGLState.scanoutDisplayModeUniform, state.displayModeWord);
		gxGpuWebGLState.scanoutUniformDisplayModeWord = state.displayModeWord;
	}
	if (gxGpuWebGLState.scanoutUniformDisplayStartWord !== state.displayStartWord) {
		gl.uniform1f(gxGpuWebGLState.scanoutDisplayStartWordUniform, state.displayStartWord);
		gxGpuWebGLState.scanoutUniformDisplayStartWord = state.displayStartWord;
	}
	if (gxGpuWebGLState.scanoutUniformHorizontalDisplayRangeWord !== state.horizontalDisplayRangeWord) {
		gl.uniform1f(gxGpuWebGLState.scanoutHorizontalDisplayRangeUniform, state.horizontalDisplayRangeWord);
		gxGpuWebGLState.scanoutUniformHorizontalDisplayRangeWord = state.horizontalDisplayRangeWord;
	}
	if (gxGpuWebGLState.scanoutUniformVerticalDisplayRangeWord !== state.verticalDisplayRangeWord) {
		gl.uniform1f(gxGpuWebGLState.scanoutVerticalDisplayRangeUniform, state.verticalDisplayRangeWord);
		gxGpuWebGLState.scanoutUniformVerticalDisplayRangeWord = state.verticalDisplayRangeWord;
	}
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
	state.statusWord = ctx.view.gxGpuStatusWord;
	state.displayModeWord = ctx.view.gxGpuDisplayModeWord;
	state.displayStartWord = ctx.view.gxGpuDisplayStartWord;
	state.horizontalDisplayRangeWord = ctx.view.gxGpuHorizontalDisplayRangeWord;
	state.verticalDisplayRangeWord = ctx.view.gxGpuVerticalDisplayRangeWord;
}

export function registerGxGpuPass(registry: RenderPassLibrary): void {
	const gxGpuState: RenderPassStateRegistry['gx_gpu'] = {
		width: 0,
		height: 0,
		commandBuffer: registry.view.gxGpuCommandBuffer,
		statusWord: registry.view.gxGpuStatusWord,
		displayModeWord: registry.view.gxGpuDisplayModeWord,
		displayStartWord: registry.view.gxGpuDisplayStartWord,
		horizontalDisplayRangeWord: registry.view.gxGpuHorizontalDisplayRangeWord,
		verticalDisplayRangeWord: registry.view.gxGpuVerticalDisplayRangeWord,
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
