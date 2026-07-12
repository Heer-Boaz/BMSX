import {
	GX_GPU_STATUS_DISPLAY_DISABLE,
	type GxGpu,
} from '../../../machine/devices/gx/gpu';
import type { GxGpuDeviceOutput } from '../../../machine/devices/gx/device_output';
import {
	GX_GPU_COMMAND_CAPACITY,
	GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
	GX_GPU_COMMAND_DRAW_LINE,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_POLYLINE,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GX_GPU_VRAM_BYTE_COUNT,
	GX_GPU_VRAM_HEIGHT,
	GX_GPU_VRAM_WIDTH,
	gxGpuTransferHeight,
	gxGpuTransferWidth,
	type GxGpuCommandBufferView,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuSigned11,
} from '../../../machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_DISPLAY_MODE_RGB24_BIT,
	gxGpuDisplayStartX,
	gxGpuDisplayStartY,
} from '../../../machine/devices/gx/gpu_display';
import {
	GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP,
	GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP,
	GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
	GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES,
	GX_GPU_VERTEX_COORD_PERIOD,
	gxGpuCommandDrawsTexture,
	gxGpuCommandGouraud,
	gxGpuCommandQuadPolygon,
	gxGpuCommandRawTextureEnabled,
	gxGpuCommandRectangleHeight,
	gxGpuCommandRectangleWidth,
	gxGpuCommandSemiTransparencyEnabled,
	gxGpuCommandTextureEnabled,
	gxGpuDitheredPolygon,
	gxGpuDrawingOffsetY,
	gxGpuDrawModeDitherEnabled,
	gxGpuDrawModeTextureMode,
	gxGpuDrawModeTexturePageBaseX,
	gxGpuDrawModeTexturePageBaseY,
	gxGpuDrawModeTextureRectangleXFlip,
	gxGpuDrawModeTextureRectangleYFlip,
	gxGpuDrawModeTransparencyMode,
	gxGpuFillHeight,
	gxGpuFillWidth,
	gxGpuFillX,
	gxGpuMaskBitCheckBeforeDraw,
	gxGpuMaskBitSetWhileDrawing,
	gxGpuSegmentExceedsPrimitiveSize,
	gxGpuTextureClutBaseX,
	gxGpuTextureClutBaseY,
	gxGpuTextureU,
	gxGpuTextureV,
	gxGpuTextureWindowAndX,
	gxGpuTextureWindowAndY,
	gxGpuTextureWindowOrX,
	gxGpuTextureWindowOrY,
	gxGpuTransferEmittedPixelCount,
	gxGpuTransferPixelWord,
	gxGpuTransferX,
	gxGpuTransferY,
	gxGpuTriangleExceedsPrimitiveSize,
	gxGpuTriangleRasterShift,
	gxGpuTriangleAttributePlane,
	gxGpuTriangleAttributePlaneInterpolants,
	gxGpuTriangleAttributePlaneInterpolantValue,
	gxGpuVramLogicalAreaOverlapsBounds,
	gxGpuVertexY,
	gxGpuVramCopyChunkHeight,
	gxGpuVramCopyNeedsChunking,
	gxGpuVramWrappedHeight,
	gxGpuVramWrappedWidth,
} from '../gx_gpu_render_rules';
import type { RenderPassLibrary } from '../pass/library';
import type { RenderGraphPassContext, RenderPassStateRegistry } from '../backend';
import { RGBA8_LINEAR_TEXTURE_PARAMS } from '../texture_params';
import type { WebGLBackend } from './backend';
import { glSetTexture2DParams } from './gl_resources';
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
import readbackFragmentShader from './shaders/gx_gpu_readback.frag.glsl';

const GX_GPU_SCANOUT_TEXTURE_UNIT = 0;
const GX_GPU_TEXTURE_SAMPLE_UNIT = 1;
const GX_GPU_TEXTURE_TRANSFER_UNIT = 2;
const GX_GPU_POLYGON_VERTICES_PER_COMMAND = 6;
const GX_GPU_SOLID_VERTEX_FLOATS = 6;
const GX_GPU_SOLID_TRIANGLE_FLOATS = 3 * GX_GPU_SOLID_VERTEX_FLOATS;
const GX_GPU_SOLID_VERTICES_PER_COMMAND = 24;
const GX_GPU_SOLID_FLOAT_CAPACITY = GX_GPU_COMMAND_CAPACITY * GX_GPU_SOLID_VERTICES_PER_COMMAND * GX_GPU_SOLID_VERTEX_FLOATS;
const GX_GPU_FIXED_SOLID_VERTEX_FLOATS = 17;
const GX_GPU_FIXED_SOLID_TRIANGLE_FLOATS = 3 * GX_GPU_FIXED_SOLID_VERTEX_FLOATS;
const GX_GPU_LINE_VERTEX_FLOATS = 12;
const GX_GPU_LINE_VERTICES_PER_SEGMENT = 6;
const GX_GPU_LINE_SEGMENT_FLOATS = GX_GPU_LINE_VERTICES_PER_SEGMENT * GX_GPU_LINE_VERTEX_FLOATS;
const GX_GPU_LINE_SEGMENT_CAPACITY = 1024;
const GX_GPU_LINE_FLOAT_CAPACITY = GX_GPU_LINE_SEGMENT_CAPACITY * GX_GPU_LINE_SEGMENT_FLOATS;
const GX_GPU_TEXTURED_UV_COMPONENTS = 2;
const GX_GPU_COLOR_COMPONENTS = 3;
const GX_GPU_TEXTURED_VERTEX_FLOATS = 18;
const GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS = 27;
const GX_GPU_FIXED_TEXTURED_TRIANGLE_FLOATS = 3 * GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS;
const GX_GPU_TEXTURED_FLOAT_CAPACITY = GX_GPU_COMMAND_CAPACITY * GX_GPU_POLYGON_VERTICES_PER_COMMAND * GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS;
const GX_GPU_TEXTURE_PAGE_COORD_SIZE = 256;
const GX_GPU_TEXTURE_PAGE_4BIT_WIDTH_WORDS = 64;
const GX_GPU_TEXTURE_PAGE_8BIT_WIDTH_WORDS = 128;
const GX_GPU_CLUT_4BIT_WORDS = 16;
const GX_GPU_CLUT_8BIT_WORDS = 256;
const GX_GPU_TRANSFER_VERTEX_FLOATS = 4;
const GX_GPU_TRANSFER_VERTICES_PER_SEGMENT = 6;
const GX_GPU_TRANSFER_SEGMENTS_PER_ROW = 3;
const GX_GPU_TRANSFER_FLOAT_CAPACITY = GX_GPU_VRAM_HEIGHT * GX_GPU_TRANSFER_SEGMENTS_PER_ROW * GX_GPU_TRANSFER_VERTICES_PER_SEGMENT * GX_GPU_TRANSFER_VERTEX_FLOATS;
const GX_GPU_SCANOUT_VERTEX_FLOATS = 2;
const GX_GPU_RAW_VRAM_BYTES_PER_PIXEL = 4;
const GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES = GX_GPU_VRAM_WIDTH * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
const GX_GPU_RAW_VRAM_READBACK_BYTES = GX_GPU_VRAM_WIDTH * GX_GPU_VRAM_HEIGHT * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
const GX_GPU_READBACK_PACK_WIDTH = 512;
const GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD = 0;
const GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD = (GX_GPU_VRAM_WIDTH - 1) | ((GX_GPU_VRAM_HEIGHT - 1) << 10);
const GX_GPU_FIXED_COLOR_PLANE_SHADER_DEFINE = '#define GX_GPU_FIXED_COLOR_PLANE 1\n';

const gxGpuSolidVertices = new Float32Array(GX_GPU_SOLID_FLOAT_CAPACITY);
const gxGpuLineVertices = new Float32Array(GX_GPU_LINE_FLOAT_CAPACITY);
const gxGpuTexturedVertices = new Float32Array(GX_GPU_TEXTURED_FLOAT_CAPACITY);
const gxGpuTexturedUvPlane = new Float64Array(GX_GPU_TEXTURED_UV_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
const gxGpuColorPlane = new Float64Array(GX_GPU_COLOR_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
const gxGpuTransferVertices = new Float32Array(GX_GPU_TRANSFER_FLOAT_CAPACITY);
const gxGpuRawVramUploadRow = new Uint8Array(GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES);
const gxGpuRawVramReadback = new Uint8Array(GX_GPU_RAW_VRAM_READBACK_BYTES);
const gxGpuVramSnapshotScratch = new Uint8Array(GX_GPU_VRAM_BYTE_COUNT);
const gxGpuScanoutVertices = new Float32Array([-1, -1, 3, -1, -1, 3]);
type GxGpuVramCopyRect = {
	left: number;
	top: number;
	right: number;
	bottom: number;
};

type GxGpuRectangle = {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	width: number;
	height: number;
};

type GxGpuLineBatchState = {
	topLeftWord: number;
	bottomRightWord: number;
	maskBitModeWord: number;
	ditherEnabled: boolean;
	interlacedRenderWord: number;
	blendEnabled: boolean;
	blendMode: number;
	readsVram: boolean;
};

type GxGpuVramSource = Pick<GxGpuDeviceOutput, 'commandBuffer' | 'readbackPort' | 'vramSnapshotBytes' | 'vramSnapshotSerial'>;

const gxGpuVramCopyRectScratch: GxGpuVramCopyRect = {
	left: 0,
	top: 0,
	right: 0,
	bottom: 0,
};
const gxGpuSolidBatchRect: GxGpuVramCopyRect = {
	left: 0,
	top: 0,
	right: 0,
	bottom: 0,
};
const gxGpuSolidCommandRect: GxGpuVramCopyRect = {
	left: 0,
	top: 0,
	right: 0,
	bottom: 0,
};
const gxGpuTexturedCommandRect: GxGpuVramCopyRect = {
	left: 0,
	top: 0,
	right: 0,
	bottom: 0,
};
const gxGpuTexturedBatchRect: GxGpuVramCopyRect = {
	left: 0,
	top: 0,
	right: 0,
	bottom: 0,
};
const gxGpuLineBatchRect: GxGpuVramCopyRect = {
	left: 0,
	top: 0,
	right: 0,
	bottom: 0,
};
const gxGpuLineCommandRect: GxGpuVramCopyRect = {
	left: 0,
	top: 0,
	right: 0,
	bottom: 0,
};
const gxGpuSampleDirtyRect: GxGpuVramCopyRect = {
	left: 0,
	top: 0,
	right: 0,
	bottom: 0,
};

const gxGpuRectangleScratch: GxGpuRectangle = {
	x0: 0,
	y0: 0,
	x1: 0,
	y1: 0,
	width: 0,
	height: 0,
};

const gxGpuLineBatchState: GxGpuLineBatchState = {
	topLeftWord: 0,
	bottomRightWord: 0,
	maskBitModeWord: 0,
	ditherEnabled: false,
	interlacedRenderWord: 0,
	blendEnabled: false,
	blendMode: 0,
	readsVram: false,
};

type GxGpuState = {
	backend: WebGLBackend;
	gl: WebGL2RenderingContext;
	solidProgram: WebGLProgram;
	fixedSolidProgram: WebGLProgram;
	lineProgram: WebGLProgram;
	texturedProgram: WebGLProgram;
	fixedTexturedProgram: WebGLProgram;
	transferProgram: WebGLProgram;
	scanoutProgram: WebGLProgram;
	readbackProgram: WebGLProgram;
	vramTexture: WebGLTexture;
	vramSampleTexture: WebGLTexture;
	vramTransferTexture: WebGLTexture;
	vramFramebuffer: WebGLFramebuffer;
	readbackTexture: WebGLTexture;
	readbackFramebuffer: WebGLFramebuffer;
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
	solidDitherEnableUniform: WebGLUniformLocation;
	solidInterlacedRenderWordUniform: WebGLUniformLocation;
	fixedSolidPositionAttrib: number;
	fixedSolidColorPlane0Attrib: number;
	fixedSolidColorPlane1Attrib: number;
	fixedSolidColorPlane2Attrib: number;
	fixedSolidColorPlane3Attrib: number;
	fixedSolidVramUniform: WebGLUniformLocation;
	fixedSolidBlendEnableUniform: WebGLUniformLocation;
	fixedSolidBlendModeUniform: WebGLUniformLocation;
	fixedSolidCheckMaskBitUniform: WebGLUniformLocation;
	fixedSolidSetMaskBitUniform: WebGLUniformLocation;
	fixedSolidDitherEnableUniform: WebGLUniformLocation;
	fixedSolidInterlacedRenderWordUniform: WebGLUniformLocation;
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
	lineDitherEnableUniform: WebGLUniformLocation;
	lineInterlacedRenderWordUniform: WebGLUniformLocation;
	texturedPositionAttrib: number;
	texturedColorAttrib: number;
	texturedTexcoordAttrib: number;
	texturedUvPlaneEnableAttrib: number;
	texturedUvPlane01Attrib: number;
	texturedUvPlane23Attrib: number;
	texturedUvPlane4Attrib: number;
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
	texturedDitherEnableUniform: WebGLUniformLocation;
	texturedInterlacedRenderWordUniform: WebGLUniformLocation;
	fixedTexturedPositionAttrib: number;
	fixedTexturedUvPlane01Attrib: number;
	fixedTexturedUvPlane23Attrib: number;
	fixedTexturedUvPlane4Attrib: number;
	fixedTexturedColorPlane0Attrib: number;
	fixedTexturedColorPlane1Attrib: number;
	fixedTexturedColorPlane2Attrib: number;
	fixedTexturedColorPlane3Attrib: number;
	fixedTexturedVramUniform: WebGLUniformLocation;
	fixedTexturedTexPageBaseUniform: WebGLUniformLocation;
	fixedTexturedClutBaseUniform: WebGLUniformLocation;
	fixedTexturedTextureWindowAndUniform: WebGLUniformLocation;
	fixedTexturedTextureWindowOrUniform: WebGLUniformLocation;
	fixedTexturedTextureModeUniform: WebGLUniformLocation;
	fixedTexturedRawTextureUniform: WebGLUniformLocation;
	fixedTexturedBlendEnableUniform: WebGLUniformLocation;
	fixedTexturedBlendModeUniform: WebGLUniformLocation;
	fixedTexturedCheckMaskBitUniform: WebGLUniformLocation;
	fixedTexturedSetMaskBitUniform: WebGLUniformLocation;
	fixedTexturedDitherEnableUniform: WebGLUniformLocation;
	fixedTexturedInterlacedRenderWordUniform: WebGLUniformLocation;
	transferPositionAttrib: number;
	transferTexcoordAttrib: number;
	transferSourceUniform: WebGLUniformLocation;
	transferVramUniform: WebGLUniformLocation;
	transferCheckMaskBitUniform: WebGLUniformLocation;
	transferSetMaskBitUniform: WebGLUniformLocation;
	scanoutPositionAttrib: number;
	scanoutVramUniform: WebGLUniformLocation;
	scanoutDisplayUniform: WebGLUniformLocation;
	readbackPositionAttrib: number;
	readbackVramUniform: WebGLUniformLocation;
	readbackParamsUniform: WebGLUniformLocation;
	scanoutUniformDisplayModeWord: number;
	scanoutUniformDisplayStartWord: number;
	scanoutUniformHeight: number;
	processedCommandCount: number;
	processedCommandSerial: number;
	vramClearSerial: number;
	vramSnapshotSerial: number;
};

let gxGpuState: GxGpuState;

function initializeGxGpuTexture(backend: WebGLBackend, texture: WebGLTexture, textureUnit: number): void {
	const gl = backend.gl;
	backend.setActiveTexture(textureUnit);
	backend.bindTexture2D(texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	glSetTexture2DParams(gl, RGBA8_LINEAR_TEXTURE_PARAMS);
}

function bootstrapGxGpuPass(backend: WebGLBackend): void {
	const gl = backend.gl;
	const solidProgram = backend.buildProgram(solidVertexShader, solidFragmentShader, 'gx_gpu_fill');
	const fixedSolidProgram = backend.buildProgram(solidVertexShader, solidFragmentShader, 'gx_gpu_fixed_fill', GX_GPU_FIXED_COLOR_PLANE_SHADER_DEFINE);
	const lineProgram = backend.buildProgram(lineVertexShader, lineFragmentShader, 'gx_gpu_line');
	const texturedProgram = backend.buildProgram(texturedVertexShader, texturedFragmentShader, 'gx_gpu_textured');
	const fixedTexturedProgram = backend.buildProgram(texturedVertexShader, texturedFragmentShader, 'gx_gpu_fixed_textured', GX_GPU_FIXED_COLOR_PLANE_SHADER_DEFINE);
	const transferProgram = backend.buildProgram(transferVertexShader, transferFragmentShader, 'gx_gpu_transfer');
	const scanoutProgram = backend.buildProgram(scanoutVertexShader, scanoutFragmentShader, 'gx_gpu_scanout');
	const readbackProgram = backend.buildProgram(scanoutVertexShader, readbackFragmentShader, 'gx_gpu_readback');
	const vramTexture = gl.createTexture() as WebGLTexture;
	initializeGxGpuTexture(backend, vramTexture, GX_GPU_SCANOUT_TEXTURE_UNIT);

	const vramSampleTexture = gl.createTexture() as WebGLTexture;
	initializeGxGpuTexture(backend, vramSampleTexture, GX_GPU_TEXTURE_SAMPLE_UNIT);

	const vramTransferTexture = gl.createTexture() as WebGLTexture;
	initializeGxGpuTexture(backend, vramTransferTexture, GX_GPU_TEXTURE_TRANSFER_UNIT);
	const vramFramebuffer = gl.createFramebuffer() as WebGLFramebuffer;
	gl.bindFramebuffer(gl.FRAMEBUFFER, vramFramebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, vramTexture, 0);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);
	gxGpuSampleDirtyRect.left = 0;
	gxGpuSampleDirtyRect.top = 0;
	gxGpuSampleDirtyRect.right = GX_GPU_VRAM_WIDTH;
	gxGpuSampleDirtyRect.bottom = GX_GPU_VRAM_HEIGHT;
	const readbackTexture = gl.createTexture() as WebGLTexture;
	backend.setActiveTexture(GX_GPU_SCANOUT_TEXTURE_UNIT);
	backend.bindTexture2D(readbackTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GX_GPU_READBACK_PACK_WIDTH, GX_GPU_VRAM_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	glSetTexture2DParams(gl, RGBA8_LINEAR_TEXTURE_PARAMS);
	const readbackFramebuffer = gl.createFramebuffer() as WebGLFramebuffer;
	gl.bindFramebuffer(gl.FRAMEBUFFER, readbackFramebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, readbackTexture, 0);

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
	gl.bufferData(gl.ARRAY_BUFFER, gxGpuScanoutVertices, gl.STATIC_DRAW);

	gxGpuState = {
		backend,
		gl,
		solidProgram,
		fixedSolidProgram,
		lineProgram,
		texturedProgram,
		fixedTexturedProgram,
		transferProgram,
		scanoutProgram,
		readbackProgram,
		vramTexture,
		vramSampleTexture,
		vramTransferTexture,
		vramFramebuffer,
		readbackTexture,
		readbackFramebuffer,
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
		solidDitherEnableUniform: gl.getUniformLocation(solidProgram, 'u_ditherEnable') as WebGLUniformLocation,
		solidInterlacedRenderWordUniform: gl.getUniformLocation(solidProgram, 'u_interlacedRenderWord') as WebGLUniformLocation,
		fixedSolidPositionAttrib: gl.getAttribLocation(fixedSolidProgram, 'a_position'),
		fixedSolidColorPlane0Attrib: gl.getAttribLocation(fixedSolidProgram, 'a_colorPlane0'),
		fixedSolidColorPlane1Attrib: gl.getAttribLocation(fixedSolidProgram, 'a_colorPlane1'),
		fixedSolidColorPlane2Attrib: gl.getAttribLocation(fixedSolidProgram, 'a_colorPlane2'),
		fixedSolidColorPlane3Attrib: gl.getAttribLocation(fixedSolidProgram, 'a_colorPlane3'),
		fixedSolidVramUniform: gl.getUniformLocation(fixedSolidProgram, 'u_vram') as WebGLUniformLocation,
		fixedSolidBlendEnableUniform: gl.getUniformLocation(fixedSolidProgram, 'u_blendEnable') as WebGLUniformLocation,
		fixedSolidBlendModeUniform: gl.getUniformLocation(fixedSolidProgram, 'u_blendMode') as WebGLUniformLocation,
		fixedSolidCheckMaskBitUniform: gl.getUniformLocation(fixedSolidProgram, 'u_checkMaskBit') as WebGLUniformLocation,
		fixedSolidSetMaskBitUniform: gl.getUniformLocation(fixedSolidProgram, 'u_setMaskBit') as WebGLUniformLocation,
		fixedSolidDitherEnableUniform: gl.getUniformLocation(fixedSolidProgram, 'u_ditherEnable') as WebGLUniformLocation,
		fixedSolidInterlacedRenderWordUniform: gl.getUniformLocation(fixedSolidProgram, 'u_interlacedRenderWord') as WebGLUniformLocation,
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
		lineDitherEnableUniform: gl.getUniformLocation(lineProgram, 'u_ditherEnable') as WebGLUniformLocation,
		lineInterlacedRenderWordUniform: gl.getUniformLocation(lineProgram, 'u_interlacedRenderWord') as WebGLUniformLocation,
		texturedPositionAttrib: gl.getAttribLocation(texturedProgram, 'a_position'),
		texturedColorAttrib: gl.getAttribLocation(texturedProgram, 'a_color'),
		texturedTexcoordAttrib: gl.getAttribLocation(texturedProgram, 'a_texcoord'),
		texturedUvPlaneEnableAttrib: gl.getAttribLocation(texturedProgram, 'a_uvPlaneEnable'),
		texturedUvPlane01Attrib: gl.getAttribLocation(texturedProgram, 'a_uvPlane01'),
		texturedUvPlane23Attrib: gl.getAttribLocation(texturedProgram, 'a_uvPlane23'),
		texturedUvPlane4Attrib: gl.getAttribLocation(texturedProgram, 'a_uvPlane4'),
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
		texturedDitherEnableUniform: gl.getUniformLocation(texturedProgram, 'u_ditherEnable') as WebGLUniformLocation,
		texturedInterlacedRenderWordUniform: gl.getUniformLocation(texturedProgram, 'u_interlacedRenderWord') as WebGLUniformLocation,
		fixedTexturedPositionAttrib: gl.getAttribLocation(fixedTexturedProgram, 'a_position'),
		fixedTexturedUvPlane01Attrib: gl.getAttribLocation(fixedTexturedProgram, 'a_uvPlane01'),
		fixedTexturedUvPlane23Attrib: gl.getAttribLocation(fixedTexturedProgram, 'a_uvPlane23'),
		fixedTexturedUvPlane4Attrib: gl.getAttribLocation(fixedTexturedProgram, 'a_uvPlane4'),
		fixedTexturedColorPlane0Attrib: gl.getAttribLocation(fixedTexturedProgram, 'a_colorPlane0'),
		fixedTexturedColorPlane1Attrib: gl.getAttribLocation(fixedTexturedProgram, 'a_colorPlane1'),
		fixedTexturedColorPlane2Attrib: gl.getAttribLocation(fixedTexturedProgram, 'a_colorPlane2'),
		fixedTexturedColorPlane3Attrib: gl.getAttribLocation(fixedTexturedProgram, 'a_colorPlane3'),
		fixedTexturedVramUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_vram') as WebGLUniformLocation,
		fixedTexturedTexPageBaseUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_texPageBase') as WebGLUniformLocation,
		fixedTexturedClutBaseUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_clutBase') as WebGLUniformLocation,
		fixedTexturedTextureWindowAndUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_textureWindowAnd') as WebGLUniformLocation,
		fixedTexturedTextureWindowOrUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_textureWindowOr') as WebGLUniformLocation,
		fixedTexturedTextureModeUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_textureMode') as WebGLUniformLocation,
		fixedTexturedRawTextureUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_rawTexture') as WebGLUniformLocation,
		fixedTexturedBlendEnableUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_blendEnable') as WebGLUniformLocation,
		fixedTexturedBlendModeUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_blendMode') as WebGLUniformLocation,
		fixedTexturedCheckMaskBitUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_checkMaskBit') as WebGLUniformLocation,
		fixedTexturedSetMaskBitUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_setMaskBit') as WebGLUniformLocation,
		fixedTexturedDitherEnableUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_ditherEnable') as WebGLUniformLocation,
		fixedTexturedInterlacedRenderWordUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_interlacedRenderWord') as WebGLUniformLocation,
		transferPositionAttrib: gl.getAttribLocation(transferProgram, 'a_position'),
		transferTexcoordAttrib: gl.getAttribLocation(transferProgram, 'a_texcoord'),
		transferSourceUniform: gl.getUniformLocation(transferProgram, 'u_source') as WebGLUniformLocation,
		transferVramUniform: gl.getUniformLocation(transferProgram, 'u_vram') as WebGLUniformLocation,
		transferCheckMaskBitUniform: gl.getUniformLocation(transferProgram, 'u_checkMaskBit') as WebGLUniformLocation,
		transferSetMaskBitUniform: gl.getUniformLocation(transferProgram, 'u_setMaskBit') as WebGLUniformLocation,
		scanoutPositionAttrib: gl.getAttribLocation(scanoutProgram, 'a_position'),
		scanoutVramUniform: gl.getUniformLocation(scanoutProgram, 'u_vram') as WebGLUniformLocation,
		scanoutDisplayUniform: gl.getUniformLocation(scanoutProgram, 'u_display') as WebGLUniformLocation,
		readbackPositionAttrib: gl.getAttribLocation(readbackProgram, 'a_position'),
		readbackVramUniform: gl.getUniformLocation(readbackProgram, 'u_vram') as WebGLUniformLocation,
		readbackParamsUniform: gl.getUniformLocation(readbackProgram, 'u_readback') as WebGLUniformLocation,
		scanoutUniformDisplayModeWord: 0xffffffff,
		scanoutUniformDisplayStartWord: 0xffffffff,
		scanoutUniformHeight: 0,
		processedCommandCount: 0,
		processedCommandSerial: 0,
		vramClearSerial: 0,
		vramSnapshotSerial: 0,
	};
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function clearGxGpuVram(): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuState.vramFramebuffer);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	gl.disable(gl.SCISSOR_TEST);
	gl.clearColor(0, 0, 0, 1);
	gl.clear(gl.COLOR_BUFFER_BIT);
	gxGpuSampleDirtyRect.left = 0;
	gxGpuSampleDirtyRect.top = 0;
	gxGpuSampleDirtyRect.right = GX_GPU_VRAM_WIDTH;
	gxGpuSampleDirtyRect.bottom = GX_GPU_VRAM_HEIGHT;
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

function appendSolidPrimitiveTriangle(
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
	if (gxGpuTriangleExceedsPrimitiveSize(x0, y0, x1, y1, x2, y2)) {
		return vertexFloatCount;
	}
	const xShift = gxGpuTriangleRasterShift(x0, x1, x2);
	const yShift = gxGpuTriangleRasterShift(y0, y1, y2);
	return appendSolidTriangle(vertexFloatCount, x0 + xShift, y0 + yShift, color0, x1 + xShift, y1 + yShift, color1, x2 + xShift, y2 + yShift, color2);
}

function appendFixedSolidPrimitiveTriangle(
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
	if (gxGpuTriangleExceedsPrimitiveSize(x0, y0, x1, y1, x2, y2)) {
		return vertexFloatCount;
	}
	const determinant = ((x1 - x0) * (y2 - y1)) - ((x2 - x1) * (y1 - y0));
	if (determinant === 0) {
		return vertexFloatCount;
	}
	const xShift = gxGpuTriangleRasterShift(x0, x1, x2);
	const yShift = gxGpuTriangleRasterShift(y0, y1, y2);
	x0 += xShift;
	y0 += yShift;
	x1 += xShift;
	y1 += yShift;
	x2 += xShift;
	y2 += yShift;
	gxGpuColorPlane[0] = color0 & 0xff;
	gxGpuColorPlane[1] = (color0 >>> 8) & 0xff;
	gxGpuColorPlane[2] = (color0 >>> 16) & 0xff;
	gxGpuColorPlane[3] = color1 & 0xff;
	gxGpuColorPlane[4] = (color1 >>> 8) & 0xff;
	gxGpuColorPlane[5] = (color1 >>> 16) & 0xff;
	gxGpuColorPlane[6] = color2 & 0xff;
	gxGpuColorPlane[7] = (color2 >>> 8) & 0xff;
	gxGpuColorPlane[8] = (color2 >>> 16) & 0xff;
	gxGpuTriangleAttributePlane(gxGpuColorPlane, 0, GX_GPU_COLOR_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
	gxGpuSolidVertices[vertexFloatCount] = x0;
	gxGpuSolidVertices[vertexFloatCount + 1] = y0;
	gxGpuSolidVertices[vertexFloatCount + GX_GPU_FIXED_SOLID_VERTEX_FLOATS] = x1;
	gxGpuSolidVertices[vertexFloatCount + GX_GPU_FIXED_SOLID_VERTEX_FLOATS + 1] = y1;
	gxGpuSolidVertices[vertexFloatCount + GX_GPU_FIXED_SOLID_VERTEX_FLOATS * 2] = x2;
	gxGpuSolidVertices[vertexFloatCount + GX_GPU_FIXED_SOLID_VERTEX_FLOATS * 2 + 1] = y2;
	gxGpuTriangleAttributePlaneInterpolants(gxGpuSolidVertices, vertexFloatCount + 2, GX_GPU_FIXED_SOLID_VERTEX_FLOATS, gxGpuColorPlane, GX_GPU_COLOR_COMPONENTS, x0, y0, x1, y1, x2, y2);
	return vertexFloatCount + GX_GPU_FIXED_SOLID_TRIANGLE_FLOATS;
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
	const sizeWord = commandBuffer.words[wordStart + 2];
	const width = gxGpuFillWidth(sizeWord);
	const height = gxGpuFillHeight(sizeWord);
	if (width === 0 || height === 0) {
		return vertexFloatCount;
	}
	let y = gxGpuTransferY(xyWord);
	let remainingHeight = height;
	let offset = vertexFloatCount;
	while (remainingHeight !== 0) {
		const rowHeight = gxGpuVramWrappedHeight(y, remainingHeight);
		let x = gxGpuFillX(xyWord);
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(x, remainingWidth);
			offset = appendSolidQuad(offset, x, y, colorWord, x, y + rowHeight, colorWord, x + runWidth, y, colorWord, x + runWidth, y + rowHeight, colorWord);
			x = (x + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			remainingWidth -= runWidth;
		}
		y = (y + rowHeight) & (GX_GPU_VRAM_HEIGHT - 1);
		remainingHeight -= rowHeight;
	}
	return offset;
}

function appendSolidPolygon(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	if (gxGpuCommandDrawsTexture(opcode, drawModeWord)) {
		return vertexFloatCount;
	}
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const words = commandBuffer.words;
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuSigned11(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const gouraud = gxGpuCommandGouraud(opcode);
	if (gxGpuCommandTextureEnabled(opcode)) {
		if (gouraud) {
			const color0 = words[wordStart];
			const xy0 = words[wordStart + 1];
			const color1 = words[wordStart + 3];
			const xy1 = words[wordStart + 4];
			const color2 = words[wordStart + 6];
			const xy2 = words[wordStart + 7];
			let offset = appendFixedSolidPrimitiveTriangle(
				vertexFloatCount,
				dx + gxGpuSigned11(xy0),
				dy + gxGpuVertexY(xy0),
				color0,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color1,
				dx + gxGpuSigned11(xy2),
				dy + gxGpuVertexY(xy2),
				color2,
			);
			if (gxGpuCommandQuadPolygon(opcode)) {
				const color3 = words[wordStart + 9];
				const xy3 = words[wordStart + 10];
				offset = appendFixedSolidPrimitiveTriangle(
					offset,
					dx + gxGpuSigned11(xy2),
					dy + gxGpuVertexY(xy2),
					color2,
					dx + gxGpuSigned11(xy1),
					dy + gxGpuVertexY(xy1),
					color1,
					dx + gxGpuSigned11(xy3),
					dy + gxGpuVertexY(xy3),
					color3,
				);
			}
			return offset;
		}

		const color = words[wordStart];
		const xy0 = words[wordStart + 1];
		const xy1 = words[wordStart + 3];
		const xy2 = words[wordStart + 5];
		let offset = appendSolidPrimitiveTriangle(
			vertexFloatCount,
			dx + gxGpuSigned11(xy0),
			dy + gxGpuVertexY(xy0),
			color,
			dx + gxGpuSigned11(xy1),
			dy + gxGpuVertexY(xy1),
			color,
			dx + gxGpuSigned11(xy2),
			dy + gxGpuVertexY(xy2),
			color,
		);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const xy3 = words[wordStart + 7];
			offset = appendSolidPrimitiveTriangle(
				offset,
				dx + gxGpuSigned11(xy2),
				dy + gxGpuVertexY(xy2),
				color,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color,
				dx + gxGpuSigned11(xy3),
				dy + gxGpuVertexY(xy3),
				color,
			);
		}
		return offset;
	}

	if (gouraud) {
		const color0 = words[wordStart];
		const xy0 = words[wordStart + 1];
		const color1 = words[wordStart + 2];
		const xy1 = words[wordStart + 3];
		const color2 = words[wordStart + 4];
		const xy2 = words[wordStart + 5];
		let offset = appendFixedSolidPrimitiveTriangle(
			vertexFloatCount,
			dx + gxGpuSigned11(xy0),
			dy + gxGpuVertexY(xy0),
			color0,
			dx + gxGpuSigned11(xy1),
			dy + gxGpuVertexY(xy1),
			color1,
			dx + gxGpuSigned11(xy2),
			dy + gxGpuVertexY(xy2),
			color2,
		);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const color3 = words[wordStart + 6];
			const xy3 = words[wordStart + 7];
			offset = appendFixedSolidPrimitiveTriangle(
				offset,
				dx + gxGpuSigned11(xy2),
				dy + gxGpuVertexY(xy2),
				color2,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color1,
				dx + gxGpuSigned11(xy3),
				dy + gxGpuVertexY(xy3),
				color3,
			);
		}
		return offset;
	}

	const color = words[wordStart];
	const xy0 = words[wordStart + 1];
	const xy1 = words[wordStart + 2];
	const xy2 = words[wordStart + 3];
	let offset = appendSolidPrimitiveTriangle(
		vertexFloatCount,
		dx + gxGpuSigned11(xy0),
		dy + gxGpuVertexY(xy0),
		color,
		dx + gxGpuSigned11(xy1),
		dy + gxGpuVertexY(xy1),
		color,
		dx + gxGpuSigned11(xy2),
		dy + gxGpuVertexY(xy2),
		color,
	);
	if (gxGpuCommandQuadPolygon(opcode)) {
		const xy3 = words[wordStart + 4];
		offset = appendSolidPrimitiveTriangle(
			offset,
			dx + gxGpuSigned11(xy2),
			dy + gxGpuVertexY(xy2),
			color,
			dx + gxGpuSigned11(xy1),
			dy + gxGpuVertexY(xy1),
			color,
			dx + gxGpuSigned11(xy3),
			dy + gxGpuVertexY(xy3),
			color,
		);
	}
	return offset;
}

function readGxGpuRectangle(commandBuffer: GxGpuCommandBufferView, commandIndex: number, opcode: number): GxGpuRectangle {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + commandBuffer.commandWordCount[commandIndex] - 1];
	const width = gxGpuCommandRectangleWidth(opcode, sizeWord);
	const height = gxGpuCommandRectangleHeight(opcode, sizeWord);
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const x0 = gxGpuSigned11(gxGpuSigned11(drawingOffsetWord) + gxGpuSigned11(xyWord));
	const y0 = gxGpuSigned11(gxGpuDrawingOffsetY(drawingOffsetWord) + gxGpuVertexY(xyWord));
	const rect = gxGpuRectangleScratch;
	rect.x0 = x0;
	rect.y0 = y0;
	rect.x1 = x0 + width;
	rect.y1 = y0 + height;
	rect.width = width;
	rect.height = height;
	return rect;
}

function appendSolidRectangle(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	if (gxGpuCommandDrawsTexture(opcode, commandBuffer.commandDrawModeWord[commandIndex])) {
		return vertexFloatCount;
	}
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = commandBuffer.words[wordStart];
	const rect = readGxGpuRectangle(commandBuffer, commandIndex, opcode);
	if (rect.width === 0 || rect.height === 0) {
		return vertexFloatCount;
	}
	return appendSolidQuad(vertexFloatCount, rect.x0, rect.y0, colorWord, rect.x0, rect.y1, colorWord, rect.x1, rect.y0, colorWord, rect.x1, rect.y1, colorWord);
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
	if (gxGpuSegmentExceedsPrimitiveSize(x0, y0, x1, y1)) {
		return vertexFloatCount;
	}
	const absDx = x0 < x1 ? x1 - x0 : x0 - x1;
	const absDy = y0 < y1 ? y1 - y0 : y0 - y1;
	const steps = absDx >= absDy ? absDx : absDy;
	if (x0 >= x1 && steps > 0) {
		const swapX = x0;
		const swapY = y0;
		const swapColor = color0;
		x0 = x1;
		y0 = y1;
		color0 = color1;
		x1 = swapX;
		y1 = swapY;
		color1 = swapColor;
	}
	const xShift = (x0 < x1 ? x0 : x1) < -(GX_GPU_VERTEX_COORD_PERIOD >> 1) ? GX_GPU_VERTEX_COORD_PERIOD : 0;
	const yShift = (y0 < y1 ? y0 : y1) < -(GX_GPU_VERTEX_COORD_PERIOD >> 1) ? GX_GPU_VERTEX_COORD_PERIOD : 0;
	x0 += xShift;
	y0 += yShift;
	x1 += xShift;
	y1 += yShift;
	let offset = vertexFloatCount;
	if (absDx >= absDy) {
		offset = writeLineVertex(offset, x0, y0 - 1, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(offset, x0, y0 + 2, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(offset, x1 + 1, y1 - 1, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(offset, x0, y0 + 2, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(offset, x1 + 1, y1 - 1, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(offset, x1 + 1, y1 + 2, x0, y0, x1, y1, color0, color1);
		return offset;
	}
	if (y0 < y1) {
		offset = writeLineVertex(offset, x0 - 1, y0, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(offset, x1 - 1, y1 + 1, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(offset, x0 + 2, y0, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(offset, x1 - 1, y1 + 1, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(offset, x0 + 2, y0, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(offset, x1 + 2, y1 + 1, x0, y0, x1, y1, color0, color1);
		return offset;
	}
	offset = writeLineVertex(offset, x1 - 1, y1, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(offset, x0 - 1, y0 + 1, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(offset, x1 + 2, y1, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(offset, x0 - 1, y0 + 1, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(offset, x1 + 2, y1, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(offset, x0 + 2, y0 + 1, x0, y0, x1, y1, color0, color1);
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
	gxGpuTexturedVertices[offset + 7] = 0;
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

function appendTexturedPrimitiveTriangle(
	vertexFloatCount: number,
	fixedColor: boolean,
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
	if (gxGpuTriangleExceedsPrimitiveSize(x0, y0, x1, y1, x2, y2)) {
		return vertexFloatCount;
	}
	const determinant = ((x1 - x0) * (y2 - y1)) - ((x2 - x1) * (y1 - y0));
	if (determinant === 0) {
		return vertexFloatCount;
	}
	const xShift = gxGpuTriangleRasterShift(x0, x1, x2);
	const yShift = gxGpuTriangleRasterShift(y0, y1, y2);
	x0 += xShift;
	y0 += yShift;
	x1 += xShift;
	y1 += yShift;
	x2 += xShift;
	y2 += yShift;
	gxGpuTexturedUvPlane[0] = u0;
	gxGpuTexturedUvPlane[1] = v0;
	gxGpuTexturedUvPlane[2] = u1;
	gxGpuTexturedUvPlane[3] = v1;
	gxGpuTexturedUvPlane[4] = u2;
	gxGpuTexturedUvPlane[5] = v2;
	gxGpuTriangleAttributePlane(gxGpuTexturedUvPlane, 0, GX_GPU_TEXTURED_UV_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
	if (fixedColor) {
		gxGpuColorPlane[0] = color0 & 0xff;
		gxGpuColorPlane[1] = (color0 >>> 8) & 0xff;
		gxGpuColorPlane[2] = (color0 >>> 16) & 0xff;
		gxGpuColorPlane[3] = color1 & 0xff;
		gxGpuColorPlane[4] = (color1 >>> 8) & 0xff;
		gxGpuColorPlane[5] = (color1 >>> 16) & 0xff;
		gxGpuColorPlane[6] = color2 & 0xff;
		gxGpuColorPlane[7] = (color2 >>> 8) & 0xff;
		gxGpuColorPlane[8] = (color2 >>> 16) & 0xff;
		gxGpuTriangleAttributePlane(gxGpuColorPlane, 0, GX_GPU_COLOR_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
		gxGpuTexturedVertices[vertexFloatCount] = x0;
		gxGpuTexturedVertices[vertexFloatCount + 1] = y0;
		gxGpuTexturedVertices[vertexFloatCount + GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS] = x1;
		gxGpuTexturedVertices[vertexFloatCount + GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS + 1] = y1;
		gxGpuTexturedVertices[vertexFloatCount + GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS * 2] = x2;
		gxGpuTexturedVertices[vertexFloatCount + GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS * 2 + 1] = y2;
		gxGpuTriangleAttributePlaneInterpolants(gxGpuTexturedVertices, vertexFloatCount + 2, GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS, gxGpuTexturedUvPlane, GX_GPU_TEXTURED_UV_COMPONENTS, x0, y0, x1, y1, x2, y2);
		gxGpuTriangleAttributePlaneInterpolants(gxGpuTexturedVertices, vertexFloatCount + 12, GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS, gxGpuColorPlane, GX_GPU_COLOR_COMPONENTS, x0, y0, x1, y1, x2, y2);
		return vertexFloatCount + GX_GPU_FIXED_TEXTURED_TRIANGLE_FLOATS;
	}
	const offset = appendTexturedTriangle(vertexFloatCount, x0, y0, color0, u0, v0, x1, y1, color1, u1, v1, x2, y2, color2, u2, v2);
	for (let vertexOffset = vertexFloatCount; vertexOffset < offset; vertexOffset += GX_GPU_TEXTURED_VERTEX_FLOATS) {
		gxGpuTexturedVertices[vertexOffset + 7] = 1;
	}
	gxGpuTriangleAttributePlaneInterpolants(gxGpuTexturedVertices, vertexFloatCount + 8, GX_GPU_TEXTURED_VERTEX_FLOATS, gxGpuTexturedUvPlane, GX_GPU_TEXTURED_UV_COMPONENTS, x0, y0, x1, y1, x2, y2);
	return offset;
}

function appendTexturedPolygon(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const fixedColor = gxGpuCommandGouraud(opcode) && !gxGpuCommandRawTextureEnabled(opcode);
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuSigned11(drawingOffsetWord);
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
		let offset = appendTexturedPrimitiveTriangle(
			vertexFloatCount,
			fixedColor,
			dx + gxGpuSigned11(xy0),
			dy + gxGpuVertexY(xy0),
			color0,
			gxGpuTextureU(texture0),
			gxGpuTextureV(texture0),
			dx + gxGpuSigned11(xy1),
			dy + gxGpuVertexY(xy1),
			color1,
			gxGpuTextureU(texture1),
			gxGpuTextureV(texture1),
			dx + gxGpuSigned11(xy2),
			dy + gxGpuVertexY(xy2),
			color2,
			gxGpuTextureU(texture2),
			gxGpuTextureV(texture2),
		);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const color3 = commandBuffer.words[wordStart + 9];
			const xy3 = commandBuffer.words[wordStart + 10];
			const texture3 = commandBuffer.words[wordStart + 11];
			offset = appendTexturedPrimitiveTriangle(
				offset,
				fixedColor,
				dx + gxGpuSigned11(xy2),
				dy + gxGpuVertexY(xy2),
				color2,
				gxGpuTextureU(texture2),
				gxGpuTextureV(texture2),
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color1,
				gxGpuTextureU(texture1),
				gxGpuTextureV(texture1),
				dx + gxGpuSigned11(xy3),
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
	let offset = appendTexturedPrimitiveTriangle(
		vertexFloatCount,
		fixedColor,
		dx + gxGpuSigned11(xy0),
		dy + gxGpuVertexY(xy0),
		color,
		gxGpuTextureU(texture0),
		gxGpuTextureV(texture0),
		dx + gxGpuSigned11(xy1),
		dy + gxGpuVertexY(xy1),
		color,
		gxGpuTextureU(texture1),
		gxGpuTextureV(texture1),
		dx + gxGpuSigned11(xy2),
		dy + gxGpuVertexY(xy2),
		color,
		gxGpuTextureU(texture2),
		gxGpuTextureV(texture2),
	);
	if (gxGpuCommandQuadPolygon(opcode)) {
		const xy3 = commandBuffer.words[wordStart + 7];
		const texture3 = commandBuffer.words[wordStart + 8];
		offset = appendTexturedPrimitiveTriangle(
			offset,
			fixedColor,
			dx + gxGpuSigned11(xy2),
			dy + gxGpuVertexY(xy2),
			color,
			gxGpuTextureU(texture2),
			gxGpuTextureV(texture2),
			dx + gxGpuSigned11(xy1),
			dy + gxGpuVertexY(xy1),
			color,
			gxGpuTextureU(texture1),
			gxGpuTextureV(texture1),
			dx + gxGpuSigned11(xy3),
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
	const textureWord = commandBuffer.words[wordStart + 2];
	const rect = readGxGpuRectangle(commandBuffer, commandIndex, opcode);
	if (rect.width === 0 || rect.height === 0) {
		return vertexFloatCount;
	}
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const xFlip = gxGpuDrawModeTextureRectangleXFlip(drawModeWord);
	const yFlip = gxGpuDrawModeTextureRectangleYFlip(drawModeWord);
	const u0 = gxGpuTextureU(textureWord);
	const v0 = gxGpuTextureV(textureWord);
	const u1 = u0 + (xFlip ? -rect.width : rect.width);
	const v1 = v0 + (yFlip ? -rect.height : rect.height);
	let offset = vertexFloatCount;
	offset = appendTexturedTriangle(offset, rect.x0, rect.y0, colorWord, u0, v0, rect.x1, rect.y0, colorWord, u1, v0, rect.x0, rect.y1, colorWord, u0, v1);
	offset = appendTexturedTriangle(offset, rect.x0, rect.y1, colorWord, u0, v1, rect.x1, rect.y0, colorWord, u1, v0, rect.x1, rect.y1, colorWord, u1, v1);
	return offset;
}


function writeUvVertex(vertices: Float32Array, offset: number, vertexFloatStride: number, x: number, y: number, u: number, v: number): number {
	vertices[offset] = x;
	vertices[offset + 1] = y;
	vertices[offset + 2] = u;
	vertices[offset + 3] = v;
	return offset + vertexFloatStride;
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
	offset = writeUvVertex(gxGpuTransferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x0, y0, u0, v0);
	offset = writeUvVertex(gxGpuTransferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x1, y1, u1, v1);
	offset = writeUvVertex(gxGpuTransferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x2, y2, u2, v2);
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

function writeVramSnapshotUploadRow(snapshotBytes: Uint8Array, logicalY: number): void {
	let rowByteOffset = 0;
	let snapshotByteOffset = logicalY * GX_GPU_VRAM_WIDTH * 2;
	for (let column = 0; column < GX_GPU_VRAM_WIDTH; column += 1) {
		gxGpuRawVramUploadRow[rowByteOffset] = snapshotBytes[snapshotByteOffset];
		gxGpuRawVramUploadRow[rowByteOffset + 1] = snapshotBytes[snapshotByteOffset + 1];
		gxGpuRawVramUploadRow[rowByteOffset + 2] = 0;
		gxGpuRawVramUploadRow[rowByteOffset + 3] = 0xff;
		rowByteOffset += GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
		snapshotByteOffset += 2;
	}
}

function uploadGxGpuVramSnapshot(snapshotBytes: Uint8Array): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	backend.setActiveTexture(GX_GPU_SCANOUT_TEXTURE_UNIT);
	backend.bindTexture2D(gxGpuState.vramTexture);
	for (let logicalY = 0; logicalY < GX_GPU_VRAM_HEIGHT; logicalY += 1) {
		writeVramSnapshotUploadRow(snapshotBytes, logicalY);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, (GX_GPU_VRAM_HEIGHT - 1) - logicalY, GX_GPU_VRAM_WIDTH, 1, gl.RGBA, gl.UNSIGNED_BYTE, gxGpuRawVramUploadRow, 0);
	}
	gxGpuSampleDirtyRect.left = 0;
	gxGpuSampleDirtyRect.top = 0;
	gxGpuSampleDirtyRect.right = GX_GPU_VRAM_WIDTH;
	gxGpuSampleDirtyRect.bottom = GX_GPU_VRAM_HEIGHT;
}

function writeCpuToVramUploadRow(commandBuffer: GxGpuCommandBufferView, payloadWordStart: number, rowPixelStart: number, width: number): void {
	let rowByteOffset = 0;
	for (let column = 0; column < width; column += 1) {
		const pixelIndex = rowPixelStart + column;
		const payloadWord = commandBuffer.words[payloadWordStart + (pixelIndex >>> 1)];
		rowByteOffset = writeRawVramUploadPixel(rowByteOffset, gxGpuTransferPixelWord(payloadWord, pixelIndex));
	}
}

function uploadCpuToVram(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + 2];
	const x = gxGpuTransferX(xyWord);
	const y = gxGpuTransferY(xyWord);
	const width = gxGpuTransferWidth(sizeWord);
	const height = gxGpuTransferHeight(sizeWord);
	const uploadedPixels = gxGpuTransferEmittedPixelCount(width, height, commandBuffer.commandWordCount[commandIndex]);
	const fullRows = (uploadedPixels - (uploadedPixels % width)) / width;
	const lastRowWidth = uploadedPixels % width;
	const uploadHeight = fullRows + (lastRowWidth !== 0 ? 1 : 0);
	const payloadWordStart = wordStart + 3;
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	let transferVertexFloatCount = 0;

	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	backend.setActiveTexture(maskBitModeWord === 0 ? GX_GPU_SCANOUT_TEXTURE_UNIT : GX_GPU_TEXTURE_TRANSFER_UNIT);
	backend.bindTexture2D(maskBitModeWord === 0 ? gxGpuState.vramTexture : gxGpuState.vramTransferTexture);
	for (let row = 0; row < uploadHeight; row += 1) {
		const rowWidth = row === fullRows ? lastRowWidth : width;
		writeCpuToVramUploadRow(commandBuffer, payloadWordStart, row * width, rowWidth);
		const targetY = (y + row) & (GX_GPU_VRAM_HEIGHT - 1);
		const storageY = (GX_GPU_VRAM_HEIGHT - 1) - targetY;
		const firstWidth = gxGpuVramWrappedWidth(x, rowWidth);
		gl.texSubImage2D(gl.TEXTURE_2D, 0, x, storageY, firstWidth, 1, gl.RGBA, gl.UNSIGNED_BYTE, gxGpuRawVramUploadRow, 0);
		if (maskBitModeWord !== 0) {
			transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, x, targetY, firstWidth, 1, x, targetY);
		}
		if (firstWidth !== rowWidth) {
			gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, storageY, rowWidth - firstWidth, 1, gl.RGBA, gl.UNSIGNED_BYTE, gxGpuRawVramUploadRow, firstWidth * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL);
			if (maskBitModeWord !== 0) {
				transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, 0, targetY, rowWidth - firstWidth, 1, 0, targetY);
			}
		}
	}
	if (maskBitModeWord !== 0) {
		if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
			syncGxGpuSampleTextureLogicalArea(x, y, width, uploadHeight);
		}
		renderTransferCommands(transferVertexFloatCount, gxGpuState.vramTransferTexture, GX_GPU_TEXTURE_TRANSFER_UNIT, maskBitModeWord);
	}
	if (fullRows !== 0) {
		markGxGpuSampleTextureDirtyLogicalArea(x, y, width, fullRows);
	}
	if (lastRowWidth !== 0) {
		markGxGpuSampleTextureDirtyLogicalArea(x, y + fullRows, lastRowWidth, 1);
	}
}

function copyVramToVramArea(
	sourceX: number,
	sourceY: number,
	targetX: number,
	targetY: number,
	width: number,
	height: number,
	maskBitModeWord: number,
): void {
	let transferVertexFloatCount = 0;
	let runSourceY = sourceY & (GX_GPU_VRAM_HEIGHT - 1);
	let runTargetY = targetY & (GX_GPU_VRAM_HEIGHT - 1);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const sourceRunHeight = gxGpuVramWrappedHeight(runSourceY, remainingHeight);
		const targetRunHeight = gxGpuVramWrappedHeight(runTargetY, remainingHeight);
		const runHeight = sourceRunHeight < targetRunHeight ? sourceRunHeight : targetRunHeight;
		let runSourceX = sourceX;
		let runTargetX = targetX;
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const sourceRunWidth = gxGpuVramWrappedWidth(runSourceX, remainingWidth);
			const targetRunWidth = gxGpuVramWrappedWidth(runTargetX, remainingWidth);
			const runWidth = sourceRunWidth < targetRunWidth ? sourceRunWidth : targetRunWidth;
			transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, runTargetX, runTargetY, runWidth, runHeight, runSourceX, runSourceY);
			runSourceX = (runSourceX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			runTargetX = (runTargetX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			remainingWidth -= runWidth;
		}
		runSourceY = (runSourceY + runHeight) & (GX_GPU_VRAM_HEIGHT - 1);
		runTargetY = (runTargetY + runHeight) & (GX_GPU_VRAM_HEIGHT - 1);
		remainingHeight -= runHeight;
	}
	syncGxGpuSampleTextureLogicalArea(sourceX, sourceY, width, height);
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
		syncGxGpuSampleTextureLogicalArea(targetX, targetY, width, height);
	}
	renderTransferCommands(transferVertexFloatCount, gxGpuState.vramSampleTexture, GX_GPU_TEXTURE_SAMPLE_UNIT, maskBitModeWord);
	markGxGpuSampleTextureDirtyLogicalArea(targetX, targetY, width, height);
}

function copyVramToVram(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
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
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	if (gxGpuVramCopyNeedsChunking(sourceX, sourceY, targetX, targetY, width, height)) {
		const chunkHeight = gxGpuVramCopyChunkHeight(sourceY, targetY, height);
		for (let chunkTargetY = targetY; chunkTargetY < targetY + height; chunkTargetY += chunkHeight) {
			const chunkSourceY = sourceY + (chunkTargetY - targetY);
			const remainingHeight = targetY + height - chunkTargetY;
			const currentChunkHeight = chunkHeight < remainingHeight ? chunkHeight : remainingHeight;
			copyVramToVramArea(sourceX, chunkSourceY, targetX, chunkTargetY, width, currentChunkHeight, maskBitModeWord);
		}
		return;
	}
	copyVramToVramArea(sourceX, sourceY, targetX, targetY, width, height, maskBitModeWord);
}

function applyGxGpuDrawingAreaScissor(topLeftWord: number, bottomRightWord: number): void {
	const gl = gxGpuState.gl;
	const left = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const top = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord);
	const right = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const bottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord);
	gl.enable(gl.SCISSOR_TEST);
	gl.scissor(left, GX_GPU_VRAM_HEIGHT - bottom, right - left, bottom - top);
}

function resetGxGpuVramCopyRect(rect: GxGpuVramCopyRect): void {
	rect.left = GX_GPU_VRAM_WIDTH;
	rect.top = GX_GPU_VRAM_HEIGHT;
	rect.right = 0;
	rect.bottom = 0;
}

function includeGxGpuVramCopyVertex(rect: GxGpuVramCopyRect, x: number, y: number): void {
	if (x < rect.left) {
		rect.left = x;
	}
	if (y < rect.top) {
		rect.top = y;
	}
	const right = x + 1;
	const bottom = y + 1;
	if (right > rect.right) {
		rect.right = right;
	}
	if (bottom > rect.bottom) {
		rect.bottom = bottom;
	}
}

function includeGxGpuVramCopyRect(target: GxGpuVramCopyRect, source: GxGpuVramCopyRect): void {
	if (source.left < target.left) {
		target.left = source.left;
	}
	if (source.top < target.top) {
		target.top = source.top;
	}
	if (source.right > target.right) {
		target.right = source.right;
	}
	if (source.bottom > target.bottom) {
		target.bottom = source.bottom;
	}
}

function gxGpuVramCopyRectsOverlap(a: GxGpuVramCopyRect, b: GxGpuVramCopyRect): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function markGxGpuSampleTextureDirtyArea(left: number, top: number, right: number, bottom: number): void {
	if (right <= left || bottom <= top) {
		return;
	}
	if (left < gxGpuSampleDirtyRect.left) {
		gxGpuSampleDirtyRect.left = left;
	}
	if (top < gxGpuSampleDirtyRect.top) {
		gxGpuSampleDirtyRect.top = top;
	}
	if (right > gxGpuSampleDirtyRect.right) {
		gxGpuSampleDirtyRect.right = right;
	}
	if (bottom > gxGpuSampleDirtyRect.bottom) {
		gxGpuSampleDirtyRect.bottom = bottom;
	}
}

function markGxGpuSampleTextureDirtyLogicalArea(x: number, y: number, width: number, height: number): void {
	let rowY = y & (GX_GPU_VRAM_HEIGHT - 1);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight);
		let columnX = x & (GX_GPU_VRAM_WIDTH - 1);
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			markGxGpuSampleTextureDirtyArea(columnX, rowY, columnX + runWidth, rowY + runHeight);
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			remainingWidth -= runWidth;
		}
		rowY = (rowY + runHeight) & (GX_GPU_VRAM_HEIGHT - 1);
		remainingHeight -= runHeight;
	}
}

function copyGxGpuVramAreaToSampleTexture(left: number, top: number, right: number, bottom: number): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	if (right <= left || bottom <= top) {
		return;
	}
	const storageY = GX_GPU_VRAM_HEIGHT - bottom;
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuState.vramFramebuffer);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(gxGpuState.vramSampleTexture);
	gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, left, storageY, left, storageY, right - left, bottom - top);
}

function syncGxGpuSampleTextureArea(left: number, top: number, right: number, bottom: number): boolean {
	if (left >= gxGpuSampleDirtyRect.right
		|| gxGpuSampleDirtyRect.left >= right
		|| top >= gxGpuSampleDirtyRect.bottom
		|| gxGpuSampleDirtyRect.top >= bottom) {
		return false;
	}
	copyGxGpuVramAreaToSampleTexture(gxGpuSampleDirtyRect.left, gxGpuSampleDirtyRect.top, gxGpuSampleDirtyRect.right, gxGpuSampleDirtyRect.bottom);
	resetGxGpuVramCopyRect(gxGpuSampleDirtyRect);
	return true;
}

function syncGxGpuSampleTextureLogicalArea(x: number, y: number, width: number, height: number): void {
	let rowY = y & (GX_GPU_VRAM_HEIGHT - 1);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight);
		let columnX = x & (GX_GPU_VRAM_WIDTH - 1);
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			if (syncGxGpuSampleTextureArea(columnX, rowY, columnX + runWidth, rowY + runHeight)) {
				return;
			}
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			remainingWidth -= runWidth;
		}
		rowY = (rowY + runHeight) & (GX_GPU_VRAM_HEIGHT - 1);
		remainingHeight -= runHeight;
	}
}

function setGxGpuVertexBoundsRect(
	rect: GxGpuVramCopyRect,
	vertices: Float32Array,
	vertexFloatStart: number,
	vertexFloatEnd: number,
	vertexFloatStride: number,
	topLeftWord: number,
	bottomRightWord: number,
): void {
	resetGxGpuVramCopyRect(rect);
	for (let offset = vertexFloatStart; offset < vertexFloatEnd; offset += vertexFloatStride) {
		includeGxGpuVramCopyVertex(rect, vertices[offset], vertices[offset + 1]);
	}
	const drawingLeft = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const drawingTop = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord);
	const drawingRight = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const drawingBottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord);
	const left = rect.left > drawingLeft ? rect.left : drawingLeft;
	const top = rect.top > drawingTop ? rect.top : drawingTop;
	const right = rect.right < drawingRight ? rect.right : drawingRight;
	const bottom = rect.bottom < drawingBottom ? rect.bottom : drawingBottom;
	rect.left = left;
	rect.top = top;
	rect.right = right;
	rect.bottom = bottom;
}

function syncGxGpuTexturedSourceTexture(
	commandBuffer: GxGpuCommandBufferView,
	commandIndex: number,
	vertexFloatStart: number,
	vertexFloatEnd: number,
	commandRect: GxGpuVramCopyRect,
	batchRect: GxGpuVramCopyRect,
	fixedColor: boolean,
): number {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const textureWord = commandBuffer.words[wordStart + 2];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const textureMode = gxGpuDrawModeTextureMode(drawModeWord);
	const pageX = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	const pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord);
	const rect = gxGpuVramCopyRectScratch;
	const vertices = gxGpuTexturedVertices;
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
	resetGxGpuVramCopyRect(rect);
	for (let offset = vertexFloatStart; offset < vertexFloatEnd; offset += vertexFloatStride) {
		if (fixedColor) {
			const u = gxGpuTriangleAttributePlaneInterpolantValue(vertices, offset + 2, GX_GPU_TEXTURED_UV_COMPONENTS) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
			const v = gxGpuTriangleAttributePlaneInterpolantValue(vertices, offset + 3, GX_GPU_TEXTURED_UV_COMPONENTS) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
			includeGxGpuVramCopyVertex(rect, u, v);
		} else {
			includeGxGpuVramCopyVertex(rect, vertices[offset + 5], vertices[offset + 6]);
		}
	}
	const completeTexturePage = commandBuffer.commandTextureWindowWord[commandIndex] !== 0
		|| rect.left < 0
		|| rect.top < 0
		|| rect.right > GX_GPU_TEXTURE_PAGE_COORD_SIZE
		|| rect.bottom > GX_GPU_TEXTURE_PAGE_COORD_SIZE;
	let sourceX: number;
	let sourceY: number;
	let sourceWidth: number;
	let sourceHeight: number;
	if (textureMode === 0) {
		if (completeTexturePage) {
			sourceX = pageX;
			sourceY = pageY;
			sourceWidth = GX_GPU_TEXTURE_PAGE_4BIT_WIDTH_WORDS;
			sourceHeight = GX_GPU_TEXTURE_PAGE_COORD_SIZE;
		} else {
			const wordLeft = rect.left >>> 2;
			const wordRight = (rect.right + 3) >>> 2;
			sourceX = pageX + wordLeft;
			sourceY = pageY + rect.top;
			sourceWidth = wordRight - wordLeft;
			sourceHeight = rect.bottom - rect.top;
		}
	} else if (textureMode === 1) {
		if (completeTexturePage) {
			sourceX = pageX;
			sourceY = pageY;
			sourceWidth = GX_GPU_TEXTURE_PAGE_8BIT_WIDTH_WORDS;
			sourceHeight = GX_GPU_TEXTURE_PAGE_COORD_SIZE;
		} else {
			const wordLeft = rect.left >>> 1;
			const wordRight = (rect.right + 1) >>> 1;
			sourceX = pageX + wordLeft;
			sourceY = pageY + rect.top;
			sourceWidth = wordRight - wordLeft;
			sourceHeight = rect.bottom - rect.top;
		}
	} else if (completeTexturePage) {
		sourceX = pageX;
		sourceY = pageY;
		sourceWidth = GX_GPU_TEXTURE_PAGE_COORD_SIZE;
		sourceHeight = GX_GPU_TEXTURE_PAGE_COORD_SIZE;
	} else {
		sourceX = pageX + rect.left;
		sourceY = pageY + rect.top;
		sourceWidth = rect.right - rect.left;
		sourceHeight = rect.bottom - rect.top;
	}
	let overlaps = 0;
	if (gxGpuVramLogicalAreaOverlapsBounds(sourceX, sourceY, sourceWidth, sourceHeight, commandRect.left, commandRect.top, commandRect.right, commandRect.bottom)) overlaps |= GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP;
	if (gxGpuVramLogicalAreaOverlapsBounds(sourceX, sourceY, sourceWidth, sourceHeight, batchRect.left, batchRect.top, batchRect.right, batchRect.bottom)) overlaps |= GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP;
	syncGxGpuSampleTextureLogicalArea(sourceX, sourceY, sourceWidth, sourceHeight);
	if (textureMode < 2) {
		const clutX = gxGpuTextureClutBaseX(textureWord);
		const clutY = gxGpuTextureClutBaseY(textureWord);
		const clutWidth = textureMode === 0 ? GX_GPU_CLUT_4BIT_WORDS : GX_GPU_CLUT_8BIT_WORDS;
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1, commandRect.left, commandRect.top, commandRect.right, commandRect.bottom)) overlaps |= GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP;
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1, batchRect.left, batchRect.top, batchRect.right, batchRect.bottom)) overlaps |= GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP;
		syncGxGpuSampleTextureLogicalArea(clutX, clutY, clutWidth, 1);
	}
	return overlaps;
}

function writePrimitiveUniforms(
	vramUniform: WebGLUniformLocation,
	blendEnableUniform: WebGLUniformLocation,
	blendModeUniform: WebGLUniformLocation,
	checkMaskBitUniform: WebGLUniformLocation,
	setMaskBitUniform: WebGLUniformLocation,
	ditherEnableUniform: WebGLUniformLocation,
	interlacedRenderWordUniform: WebGLUniformLocation,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
	ditherEnabled: boolean,
	interlacedRenderWord: number,
): void {
	const gl = gxGpuState.gl;
	gl.uniform1i(vramUniform, GX_GPU_TEXTURE_SAMPLE_UNIT);
	gl.uniform1f(blendEnableUniform, blendEnabled ? 1 : 0);
	gl.uniform1f(blendModeUniform, blendMode);
	gl.uniform1f(checkMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	gl.uniform1f(setMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
	gl.uniform1f(ditherEnableUniform, ditherEnabled ? 1 : 0);
	gl.uniform1f(interlacedRenderWordUniform, interlacedRenderWord);
}

function writeTexturedUniforms(commandBuffer: GxGpuCommandBufferView, commandIndex: number, fixedColor: boolean): void {
	const gl = gxGpuState.gl;
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const textureWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2];
	const textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	gl.uniform1i(fixedColor ? gxGpuState.fixedTexturedVramUniform : gxGpuState.texturedVramUniform, GX_GPU_TEXTURE_SAMPLE_UNIT);
	gl.uniform2f(fixedColor ? gxGpuState.fixedTexturedTexPageBaseUniform : gxGpuState.texturedTexPageBaseUniform, gxGpuDrawModeTexturePageBaseX(drawModeWord), gxGpuDrawModeTexturePageBaseY(drawModeWord));
	gl.uniform2f(fixedColor ? gxGpuState.fixedTexturedClutBaseUniform : gxGpuState.texturedClutBaseUniform, gxGpuTextureClutBaseX(textureWord), gxGpuTextureClutBaseY(textureWord));
	gl.uniform2f(fixedColor ? gxGpuState.fixedTexturedTextureWindowAndUniform : gxGpuState.texturedTextureWindowAndUniform, gxGpuTextureWindowAndX(textureWindowWord), gxGpuTextureWindowAndY(textureWindowWord));
	gl.uniform2f(fixedColor ? gxGpuState.fixedTexturedTextureWindowOrUniform : gxGpuState.texturedTextureWindowOrUniform, gxGpuTextureWindowOrX(textureWindowWord), gxGpuTextureWindowOrY(textureWindowWord));
	gl.uniform1f(fixedColor ? gxGpuState.fixedTexturedTextureModeUniform : gxGpuState.texturedTextureModeUniform, gxGpuDrawModeTextureMode(drawModeWord));
	gl.uniform1f(fixedColor ? gxGpuState.fixedTexturedRawTextureUniform : gxGpuState.texturedRawTextureUniform, gxGpuCommandRawTextureEnabled(opcode) ? 1 : 0);
	gl.uniform1f(fixedColor ? gxGpuState.fixedTexturedBlendEnableUniform : gxGpuState.texturedBlendEnableUniform, gxGpuCommandSemiTransparencyEnabled(opcode) ? 1 : 0);
	gl.uniform1f(fixedColor ? gxGpuState.fixedTexturedBlendModeUniform : gxGpuState.texturedBlendModeUniform, gxGpuDrawModeTransparencyMode(drawModeWord));
	gl.uniform1f(fixedColor ? gxGpuState.fixedTexturedCheckMaskBitUniform : gxGpuState.texturedCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	gl.uniform1f(fixedColor ? gxGpuState.fixedTexturedSetMaskBitUniform : gxGpuState.texturedSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
	gl.uniform1f(fixedColor ? gxGpuState.fixedTexturedDitherEnableUniform : gxGpuState.texturedDitherEnableUniform, commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode) ? 1 : 0);
	gl.uniform1f(fixedColor ? gxGpuState.fixedTexturedInterlacedRenderWordUniform : gxGpuState.texturedInterlacedRenderWordUniform, commandBuffer.commandInterlacedRenderWord[commandIndex]);
}

function writeTransferUniforms(sourceTextureUnit: number, maskBitModeWord: number): void {
	const gl = gxGpuState.gl;
	gl.uniform1i(gxGpuState.transferSourceUniform, sourceTextureUnit);
	gl.uniform1i(gxGpuState.transferVramUniform, GX_GPU_TEXTURE_SAMPLE_UNIT);
	gl.uniform1f(gxGpuState.transferCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	gl.uniform1f(gxGpuState.transferSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
}

function flushSolidCommands(
	vertexFloatCount: number,
	fixedColor: boolean,
	topLeftWord: number,
	bottomRightWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
	ditherEnabled: boolean,
	interlacedRenderWord: number,
	readsVram: boolean,
	batchRect: GxGpuVramCopyRect,
): number {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	if (vertexFloatCount !== 0) {
		if (readsVram) {
			syncGxGpuSampleTextureArea(batchRect.left, batchRect.top, batchRect.right, batchRect.bottom);
		}
		const vertices = gxGpuSolidVertices;
		const vertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
		backend.bindArrayBuffer(gxGpuState.solidVertexBuffer);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices, 0, vertexFloatCount);
		renderNewSolidCommands(fixedColor, 0, vertexFloatCount / vertexFloatStride, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord);
	}
	return 0;
}

function finishSolidBatch(
	vertexFloatCount: number,
	fixedColor: boolean,
	topLeftWord: number,
	bottomRightWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
	ditherEnabled: boolean,
	interlacedRenderWord: number,
	readsVram: boolean,
): number {
	flushSolidCommands(vertexFloatCount, fixedColor, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord, readsVram, gxGpuSolidBatchRect);
	resetGxGpuVramCopyRect(gxGpuSolidBatchRect);
	return 0;
}

function appendSolidCommandVertices(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	switch (commandBuffer.commandKind[commandIndex]) {
		case GX_GPU_COMMAND_DRAW_POLYGON:
			return appendSolidPolygon(commandBuffer, commandIndex, vertexFloatCount);
		case GX_GPU_COMMAND_DRAW_RECTANGLE:
			return appendSolidRectangle(commandBuffer, commandIndex, vertexFloatCount);
		default:
			return appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
	}
}

function beginGxGpuVramRenderTarget(): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuState.vramFramebuffer);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setCullEnabled(false);
	backend.setBlendEnabled(false);
}

function renderNewLineCommands(
	vertexFloatCount: number,
	topLeftWord: number,
	bottomRightWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
	ditherEnabled: boolean,
	interlacedRenderWord: number,
): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, gxGpuLineVertices, 0, vertexFloatCount, GX_GPU_LINE_VERTEX_FLOATS, topLeftWord, bottomRightWord);
	backend.bindArrayBuffer(gxGpuState.lineVertexBuffer);
	gl.bufferSubData(gl.ARRAY_BUFFER, 0, gxGpuLineVertices, 0, vertexFloatCount);
	beginGxGpuVramRenderTarget();
	applyGxGpuDrawingAreaScissor(topLeftWord, bottomRightWord);
	backend.useProgram(gxGpuState.lineProgram);
	writePrimitiveUniforms(
		gxGpuState.lineVramUniform,
		gxGpuState.lineBlendEnableUniform,
		gxGpuState.lineBlendModeUniform,
		gxGpuState.lineCheckMaskBitUniform,
		gxGpuState.lineSetMaskBitUniform,
		gxGpuState.lineDitherEnableUniform,
		gxGpuState.lineInterlacedRenderWordUniform,
		blendEnabled,
		blendMode,
		maskBitModeWord,
		ditherEnabled,
		interlacedRenderWord,
	);
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(gxGpuState.vramSampleTexture);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuState.lineVertexBuffer);
	const lineVertexStrideBytes = GX_GPU_LINE_VERTEX_FLOATS * 4;
	gl.enableVertexAttribArray(gxGpuState.linePositionAttrib);
	gl.vertexAttribPointer(gxGpuState.linePositionAttrib, 2, gl.FLOAT, false, lineVertexStrideBytes, 0);
	gl.enableVertexAttribArray(gxGpuState.lineStartAttrib);
	gl.vertexAttribPointer(gxGpuState.lineStartAttrib, 2, gl.FLOAT, false, lineVertexStrideBytes, 2 * 4);
	gl.enableVertexAttribArray(gxGpuState.lineEndAttrib);
	gl.vertexAttribPointer(gxGpuState.lineEndAttrib, 2, gl.FLOAT, false, lineVertexStrideBytes, 4 * 4);
	gl.enableVertexAttribArray(gxGpuState.lineColor0Attrib);
	gl.vertexAttribPointer(gxGpuState.lineColor0Attrib, 3, gl.FLOAT, false, lineVertexStrideBytes, 6 * 4);
	gl.enableVertexAttribArray(gxGpuState.lineColor1Attrib);
	gl.vertexAttribPointer(gxGpuState.lineColor1Attrib, 3, gl.FLOAT, false, lineVertexStrideBytes, 9 * 4);
	gl.drawArrays(gl.TRIANGLES, 0, vertexFloatCount / GX_GPU_LINE_VERTEX_FLOATS);
	markGxGpuSampleTextureDirtyArea(gxGpuVramCopyRectScratch.left, gxGpuVramCopyRectScratch.top, gxGpuVramCopyRectScratch.right, gxGpuVramCopyRectScratch.bottom);
	gl.disable(gl.SCISSOR_TEST);
}

function flushLineCommands(vertexFloatCount: number): number {
	if (vertexFloatCount !== 0) {
		if (gxGpuLineBatchState.readsVram) {
			syncGxGpuSampleTextureArea(gxGpuLineBatchRect.left, gxGpuLineBatchRect.top, gxGpuLineBatchRect.right, gxGpuLineBatchRect.bottom);
		}
		renderNewLineCommands(vertexFloatCount, gxGpuLineBatchState.topLeftWord, gxGpuLineBatchState.bottomRightWord, gxGpuLineBatchState.blendEnabled, gxGpuLineBatchState.blendMode, gxGpuLineBatchState.maskBitModeWord, gxGpuLineBatchState.ditherEnabled, gxGpuLineBatchState.interlacedRenderWord);
	}
	resetGxGpuVramCopyRect(gxGpuLineBatchRect);
	return 0;
}

function appendBatchedLineSegment(
	vertexFloatCount: number,
	x0: number,
	y0: number,
	color0: number,
	x1: number,
	y1: number,
	color1: number,
): number {
	let offset = vertexFloatCount;
	if (offset + GX_GPU_LINE_SEGMENT_FLOATS > GX_GPU_LINE_FLOAT_CAPACITY) {
		offset = flushLineCommands(offset);
	}
	const commandVertexStart = offset;
	offset = appendLineSegment(offset, x0, y0, color0, x1, y1, color1);
	if (gxGpuLineBatchState.readsVram && offset !== commandVertexStart) {
		setGxGpuVertexBoundsRect(
			gxGpuLineCommandRect,
			gxGpuLineVertices,
			commandVertexStart,
			offset,
			GX_GPU_LINE_VERTEX_FLOATS,
			gxGpuLineBatchState.topLeftWord,
			gxGpuLineBatchState.bottomRightWord,
		);
		if (commandVertexStart !== 0 && gxGpuVramCopyRectsOverlap(gxGpuLineBatchRect, gxGpuLineCommandRect)) {
			offset = flushLineCommands(commandVertexStart);
			offset = appendLineSegment(offset, x0, y0, color0, x1, y1, color1);
			setGxGpuVertexBoundsRect(
				gxGpuLineCommandRect,
				gxGpuLineVertices,
				0,
				offset,
				GX_GPU_LINE_VERTEX_FLOATS,
				gxGpuLineBatchState.topLeftWord,
				gxGpuLineBatchState.bottomRightWord,
			);
		}
		includeGxGpuVramCopyRect(gxGpuLineBatchRect, gxGpuLineCommandRect);
	}
	return offset;
}

function appendLineCommandVertices(
	commandBuffer: GxGpuCommandBufferView,
	commandIndex: number,
	vertexFloatCount: number,
): number {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const wordEnd = wordStart + commandBuffer.commandWordCount[commandIndex];
	const words = commandBuffer.words;
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const dx = gxGpuSigned11(drawingOffsetWord);
	if (commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_LINE) {
		const color0 = words[wordStart];
		const xy0 = words[wordStart + 1];
		if (gxGpuCommandGouraud(opcode)) {
			const color1 = words[wordStart + 2];
			const xy1 = words[wordStart + 3];
			vertexFloatCount = appendBatchedLineSegment(
				vertexFloatCount,
				dx + gxGpuSigned11(xy0),
				dy + gxGpuVertexY(xy0),
				color0,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color1,
			);
		} else {
			const xy1 = words[wordStart + 2];
			vertexFloatCount = appendBatchedLineSegment(
				vertexFloatCount,
				dx + gxGpuSigned11(xy0),
				dy + gxGpuVertexY(xy0),
				color0,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color0,
			);
		}
		return vertexFloatCount;
	}

	if (gxGpuCommandGouraud(opcode)) {
		let color0 = words[wordStart];
		let xy0 = words[wordStart + 1];
		for (let wordIndex = wordStart + 2; wordIndex + 1 < wordEnd; wordIndex += 2) {
			const color1 = words[wordIndex];
			const xy1 = words[wordIndex + 1];
			vertexFloatCount = appendBatchedLineSegment(
				vertexFloatCount,
				dx + gxGpuSigned11(xy0),
				dy + gxGpuVertexY(xy0),
				color0,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color1,
			);
			color0 = color1;
			xy0 = xy1;
		}
	} else {
		const color = words[wordStart];
		let xy0 = words[wordStart + 1];
		for (let wordIndex = wordStart + 2; wordIndex < wordEnd; wordIndex += 1) {
			const xy1 = words[wordIndex];
			vertexFloatCount = appendBatchedLineSegment(
				vertexFloatCount,
				dx + gxGpuSigned11(xy0),
				dy + gxGpuVertexY(xy0),
				color,
				dx + gxGpuSigned11(xy1),
				dy + gxGpuVertexY(xy1),
				color,
			);
			xy0 = xy1;
		}
	}
	return vertexFloatCount;
}

function executeNewGxGpuCommands(commandBuffer: GxGpuCommandBufferView): void {
	let commandIndex = gxGpuState.processedCommandCount;
	const presentCommandCount = commandBuffer.presentCommandCount;
	const commandKindWords = commandBuffer.commandKind;
	const commandDrawingAreaTopLeftWords = commandBuffer.commandDrawingAreaTopLeftWord;
	const commandDrawingAreaBottomRightWords = commandBuffer.commandDrawingAreaBottomRightWord;
	const commandInterlacedRenderWords = commandBuffer.commandInterlacedRenderWord;
	let vertexFloatCount = 0;
	let solidBatchTopLeftWord = GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD;
	let solidBatchBottomRightWord = GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD;
	let solidBatchMaskBitModeWord = 0;
	let solidBatchDitherEnabled = false;
	let solidBatchInterlacedRenderWord = 0;
	let solidBatchBlendEnabled = false;
	let solidBatchBlendMode = 0;
	let solidBatchReadsVram = false;
	let solidBatchFixedColor = false;
	let texturedVertexFloatCount = 0;
	let texturedBatchCommandIndex = 0;
	let lineVertexFloatCount = 0;
	resetGxGpuVramCopyRect(gxGpuSolidBatchRect);
	resetGxGpuVramCopyRect(gxGpuTexturedBatchRect);
	resetGxGpuVramCopyRect(gxGpuLineBatchRect);
	for (; commandIndex < presentCommandCount; commandIndex += 1) {
		const commandKind = commandKindWords[commandIndex];
		const commandDrawsTexture = (commandKind === GX_GPU_COMMAND_DRAW_POLYGON || commandKind === GX_GPU_COMMAND_DRAW_RECTANGLE)
			&& gxGpuCommandDrawsTexture(commandBuffer.commandOpcode[commandIndex], commandBuffer.commandDrawModeWord[commandIndex]);
		if (texturedVertexFloatCount !== 0 && !commandDrawsTexture) {
			texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
		}
		if (lineVertexFloatCount !== 0 && commandKind !== GX_GPU_COMMAND_DRAW_LINE && commandKind !== GX_GPU_COMMAND_DRAW_POLYLINE) {
			lineVertexFloatCount = flushLineCommands(lineVertexFloatCount);
		}
		switch (commandKind) {
			case GX_GPU_COMMAND_DRAW_POLYGON:
			case GX_GPU_COMMAND_DRAW_RECTANGLE: {
				const opcode = commandBuffer.commandOpcode[commandIndex];
				const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
				const topLeftWord = commandDrawingAreaTopLeftWords[commandIndex];
				const bottomRightWord = commandDrawingAreaBottomRightWords[commandIndex];
				const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
				const drawsTexture = commandDrawsTexture;
				const ditherEnabled = commandKindWords[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode);
				const interlacedRenderWord = commandInterlacedRenderWords[commandIndex];
				const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
				const blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0;
				const readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
				const fixedColor = commandKind === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuCommandGouraud(opcode);
				const splitReadVramQuad = readsVram
					&& commandKindWords[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
					&& gxGpuCommandQuadPolygon(opcode);
				const batchMaskChange = maskBitModeWord !== solidBatchMaskBitModeWord;
				const batchStateChanged = topLeftWord !== solidBatchTopLeftWord
					|| bottomRightWord !== solidBatchBottomRightWord
					|| batchMaskChange
					|| solidBatchDitherEnabled !== ditherEnabled
					|| solidBatchInterlacedRenderWord !== interlacedRenderWord
					|| solidBatchBlendEnabled !== blendEnabled
					|| solidBatchBlendMode !== blendMode
					|| solidBatchReadsVram !== readsVram
					|| solidBatchFixedColor !== fixedColor;
				if (vertexFloatCount !== 0 && (batchStateChanged || drawsTexture || splitReadVramQuad)) {
					vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchFixedColor, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
				}
				solidBatchTopLeftWord = topLeftWord;
				solidBatchBottomRightWord = bottomRightWord;
				solidBatchMaskBitModeWord = maskBitModeWord;
				solidBatchDitherEnabled = ditherEnabled;
				solidBatchInterlacedRenderWord = interlacedRenderWord;
				solidBatchBlendEnabled = blendEnabled;
				solidBatchBlendMode = blendMode;
				solidBatchReadsVram = readsVram;
				solidBatchFixedColor = fixedColor;
				if (drawsTexture) {
					const texturedFixedColor = fixedColor && !gxGpuCommandRawTextureEnabled(opcode);
					const textureWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2];
					if (texturedVertexFloatCount !== 0) {
						const batchDrawModeWord = commandBuffer.commandDrawModeWord[texturedBatchCommandIndex];
						const batchOpcode = commandBuffer.commandOpcode[texturedBatchCommandIndex];
						const batchTextureWord = commandBuffer.words[commandBuffer.commandWordStart[texturedBatchCommandIndex] + 2];
						const batchDitherEnabled = commandKindWords[texturedBatchCommandIndex] === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(batchDrawModeWord, batchOpcode);
						const batchFixedColor = commandKindWords[texturedBatchCommandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
							&& gxGpuCommandGouraud(batchOpcode)
							&& !gxGpuCommandRawTextureEnabled(batchOpcode);
						const batchStateChanged = topLeftWord !== commandDrawingAreaTopLeftWords[texturedBatchCommandIndex]
							|| bottomRightWord !== commandDrawingAreaBottomRightWords[texturedBatchCommandIndex]
							|| drawModeWord !== batchDrawModeWord
							|| commandBuffer.commandTextureWindowWord[commandIndex] !== commandBuffer.commandTextureWindowWord[texturedBatchCommandIndex]
							|| maskBitModeWord !== commandBuffer.commandMaskBitModeWord[texturedBatchCommandIndex]
							|| interlacedRenderWord !== commandInterlacedRenderWords[texturedBatchCommandIndex]
							|| (textureWord >>> 16) !== (batchTextureWord >>> 16)
							|| gxGpuCommandRawTextureEnabled(opcode) !== gxGpuCommandRawTextureEnabled(batchOpcode)
							|| texturedFixedColor !== batchFixedColor
							|| gxGpuCommandSemiTransparencyEnabled(opcode) !== gxGpuCommandSemiTransparencyEnabled(batchOpcode)
							|| ditherEnabled !== batchDitherEnabled;
						if (batchStateChanged) texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
					}
					if (texturedVertexFloatCount === 0) texturedBatchCommandIndex = commandIndex;
					const texturedVertices = gxGpuTexturedVertices;
					const texturedVertexFloatStride = texturedFixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
					let texturedCommandVertexStart = texturedVertexFloatCount;
					texturedVertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, texturedVertexFloatCount);
					if (texturedVertexFloatCount !== texturedCommandVertexStart) {
						setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, texturedVertices, texturedCommandVertexStart, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord);
						let sourceOverlaps = syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, texturedCommandVertexStart, texturedVertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, texturedFixedColor);
						if ((sourceOverlaps & GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP) !== 0) {
							texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedCommandVertexStart, texturedBatchCommandIndex);
							texturedBatchCommandIndex = commandIndex;
							texturedCommandVertexStart = 0;
							texturedVertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, 0);
							setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, texturedVertices, 0, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord);
							sourceOverlaps = syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, 0, texturedVertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, texturedFixedColor);
						}
						if ((sourceOverlaps & GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP) !== 0) {
							if (texturedCommandVertexStart !== 0) texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedCommandVertexStart, texturedBatchCommandIndex);
							texturedVertexFloatCount = 0;
							resetGxGpuVramCopyRect(gxGpuTexturedBatchRect);
							renderTexturedCommand(commandBuffer, commandIndex, topLeftWord, bottomRightWord);
						} else {
							includeGxGpuVramCopyRect(gxGpuTexturedBatchRect, gxGpuTexturedCommandRect);
						}
					}
				} else {
					const solidVertices = gxGpuSolidVertices;
					const solidVertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
					const solidTriangleFloatCount = fixedColor ? GX_GPU_FIXED_SOLID_TRIANGLE_FLOATS : GX_GPU_SOLID_TRIANGLE_FLOATS;
					const commandVertexStart = vertexFloatCount;
					vertexFloatCount = appendSolidCommandVertices(commandBuffer, commandIndex, vertexFloatCount);
					if (splitReadVramQuad && vertexFloatCount === solidTriangleFloatCount * 2) {
						renderReadVramSolidQuad(fixedColor, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord);
						vertexFloatCount = 0;
					} else if (readsVram && vertexFloatCount !== commandVertexStart) {
						setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, solidVertices, commandVertexStart, vertexFloatCount, solidVertexFloatStride, topLeftWord, bottomRightWord);
						if (commandVertexStart !== 0 && gxGpuVramCopyRectsOverlap(gxGpuSolidBatchRect, gxGpuSolidCommandRect)) {
							vertexFloatCount = finishSolidBatch(commandVertexStart, solidBatchFixedColor, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
							vertexFloatCount = appendSolidCommandVertices(commandBuffer, commandIndex, vertexFloatCount);
							setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, solidVertices, 0, vertexFloatCount, solidVertexFloatStride, topLeftWord, bottomRightWord);
						}
						includeGxGpuVramCopyRect(gxGpuSolidBatchRect, gxGpuSolidCommandRect);
					}
				}
				break;
			}
			case GX_GPU_COMMAND_FILL_RECTANGLE: {
				const topLeftWord = GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD;
				const bottomRightWord = GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD;
				const interlacedRenderWord = commandInterlacedRenderWords[commandIndex];
				const batchMaskChange = gxGpuMaskBitSetWhileDrawing(solidBatchMaskBitModeWord);
				if (vertexFloatCount !== 0 && (solidBatchTopLeftWord !== topLeftWord || solidBatchBottomRightWord !== bottomRightWord || batchMaskChange || solidBatchDitherEnabled || solidBatchInterlacedRenderWord !== interlacedRenderWord || solidBatchBlendEnabled || solidBatchReadsVram || solidBatchFixedColor)) {
					vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchFixedColor, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
				}
				solidBatchTopLeftWord = topLeftWord;
				solidBatchBottomRightWord = bottomRightWord;
				solidBatchMaskBitModeWord = 0;
				solidBatchDitherEnabled = false;
				solidBatchInterlacedRenderWord = interlacedRenderWord;
				solidBatchBlendEnabled = false;
				solidBatchBlendMode = 0;
				solidBatchReadsVram = false;
				solidBatchFixedColor = false;
				vertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
				break;
			}
			case GX_GPU_COMMAND_DRAW_LINE:
			case GX_GPU_COMMAND_DRAW_POLYLINE: {
				vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchFixedColor, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
				const opcode = commandBuffer.commandOpcode[commandIndex];
				const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
				const topLeftWord = commandDrawingAreaTopLeftWords[commandIndex];
				const bottomRightWord = commandDrawingAreaBottomRightWords[commandIndex];
				const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
				const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
				const blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0;
				const ditherEnabled = gxGpuDrawModeDitherEnabled(drawModeWord);
				const interlacedRenderWord = commandInterlacedRenderWords[commandIndex];
				const readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
				if (lineVertexFloatCount !== 0 && (topLeftWord !== gxGpuLineBatchState.topLeftWord
					|| bottomRightWord !== gxGpuLineBatchState.bottomRightWord
					|| maskBitModeWord !== gxGpuLineBatchState.maskBitModeWord
					|| ditherEnabled !== gxGpuLineBatchState.ditherEnabled
					|| interlacedRenderWord !== gxGpuLineBatchState.interlacedRenderWord
					|| blendEnabled !== gxGpuLineBatchState.blendEnabled
					|| blendMode !== gxGpuLineBatchState.blendMode
					|| readsVram !== gxGpuLineBatchState.readsVram)) {
					lineVertexFloatCount = flushLineCommands(lineVertexFloatCount);
				}
				gxGpuLineBatchState.topLeftWord = topLeftWord;
				gxGpuLineBatchState.bottomRightWord = bottomRightWord;
				gxGpuLineBatchState.maskBitModeWord = maskBitModeWord;
				gxGpuLineBatchState.ditherEnabled = ditherEnabled;
				gxGpuLineBatchState.interlacedRenderWord = interlacedRenderWord;
				gxGpuLineBatchState.blendEnabled = blendEnabled;
				gxGpuLineBatchState.blendMode = blendMode;
				gxGpuLineBatchState.readsVram = readsVram;
				lineVertexFloatCount = appendLineCommandVertices(commandBuffer, commandIndex, lineVertexFloatCount);
				break;
			}
			case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
				vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchFixedColor, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
				copyVramToVram(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
				vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchFixedColor, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
				uploadCpuToVram(commandBuffer, commandIndex);
				break;
		}
	}
	gxGpuState.processedCommandCount = presentCommandCount;
	finishSolidBatch(vertexFloatCount, solidBatchFixedColor, solidBatchTopLeftWord, solidBatchBottomRightWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchInterlacedRenderWord, solidBatchReadsVram);
	flushTexturedCommands(commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
	flushLineCommands(lineVertexFloatCount);
}

function renderNewSolidCommands(
	fixedColor: boolean,
	firstVertex: number,
	vertexCount: number,
	topLeftWord: number,
	bottomRightWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
	ditherEnabled: boolean,
	interlacedRenderWord: number,
): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	const vertices = gxGpuSolidVertices;
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
	const vertexFloatStart = firstVertex * vertexFloatStride;
	const vertexFloatEnd = vertexFloatStart + vertexCount * vertexFloatStride;
	setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, vertices, vertexFloatStart, vertexFloatEnd, vertexFloatStride, topLeftWord, bottomRightWord);
	beginGxGpuVramRenderTarget();
	applyGxGpuDrawingAreaScissor(topLeftWord, bottomRightWord);
	backend.useProgram(fixedColor ? gxGpuState.fixedSolidProgram : gxGpuState.solidProgram);
	writePrimitiveUniforms(
		fixedColor ? gxGpuState.fixedSolidVramUniform : gxGpuState.solidVramUniform,
		fixedColor ? gxGpuState.fixedSolidBlendEnableUniform : gxGpuState.solidBlendEnableUniform,
		fixedColor ? gxGpuState.fixedSolidBlendModeUniform : gxGpuState.solidBlendModeUniform,
		fixedColor ? gxGpuState.fixedSolidCheckMaskBitUniform : gxGpuState.solidCheckMaskBitUniform,
		fixedColor ? gxGpuState.fixedSolidSetMaskBitUniform : gxGpuState.solidSetMaskBitUniform,
		fixedColor ? gxGpuState.fixedSolidDitherEnableUniform : gxGpuState.solidDitherEnableUniform,
		fixedColor ? gxGpuState.fixedSolidInterlacedRenderWordUniform : gxGpuState.solidInterlacedRenderWordUniform,
		blendEnabled,
		blendMode,
		maskBitModeWord,
		ditherEnabled,
		interlacedRenderWord,
	);
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(gxGpuState.vramSampleTexture);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuState.solidVertexBuffer);
	if (fixedColor) {
		const vertexStrideBytes = GX_GPU_FIXED_SOLID_VERTEX_FLOATS * 4;
		gl.enableVertexAttribArray(gxGpuState.fixedSolidPositionAttrib);
		gl.vertexAttribPointer(gxGpuState.fixedSolidPositionAttrib, 2, gl.FLOAT, false, vertexStrideBytes, 0);
		gl.enableVertexAttribArray(gxGpuState.fixedSolidColorPlane0Attrib);
		gl.vertexAttribPointer(gxGpuState.fixedSolidColorPlane0Attrib, 4, gl.FLOAT, false, vertexStrideBytes, 2 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedSolidColorPlane1Attrib);
		gl.vertexAttribPointer(gxGpuState.fixedSolidColorPlane1Attrib, 4, gl.FLOAT, false, vertexStrideBytes, 6 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedSolidColorPlane2Attrib);
		gl.vertexAttribPointer(gxGpuState.fixedSolidColorPlane2Attrib, 4, gl.FLOAT, false, vertexStrideBytes, 10 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedSolidColorPlane3Attrib);
		gl.vertexAttribPointer(gxGpuState.fixedSolidColorPlane3Attrib, 3, gl.FLOAT, false, vertexStrideBytes, 14 * 4);
	} else {
		const vertexStrideBytes = GX_GPU_SOLID_VERTEX_FLOATS * 4;
		gl.enableVertexAttribArray(gxGpuState.solidPositionAttrib);
		gl.vertexAttribPointer(gxGpuState.solidPositionAttrib, 2, gl.FLOAT, false, vertexStrideBytes, 0);
		gl.enableVertexAttribArray(gxGpuState.solidColorAttrib);
		gl.vertexAttribPointer(gxGpuState.solidColorAttrib, 4, gl.FLOAT, false, vertexStrideBytes, 2 * 4);
	}
	gl.drawArrays(gl.TRIANGLES, firstVertex, vertexCount);
	markGxGpuSampleTextureDirtyArea(gxGpuVramCopyRectScratch.left, gxGpuVramCopyRectScratch.top, gxGpuVramCopyRectScratch.right, gxGpuVramCopyRectScratch.bottom);
	gl.disable(gl.SCISSOR_TEST);
}

function renderReadVramSolidQuad(fixedColor: boolean, topLeftWord: number, bottomRightWord: number, blendEnabled: boolean, blendMode: number, maskBitModeWord: number, ditherEnabled: boolean, interlacedRenderWord: number): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	const vertices = gxGpuSolidVertices;
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
	const triangleFloatCount = fixedColor ? GX_GPU_FIXED_SOLID_TRIANGLE_FLOATS : GX_GPU_SOLID_TRIANGLE_FLOATS;
	backend.bindArrayBuffer(gxGpuState.solidVertexBuffer);
	gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices, 0, triangleFloatCount * 2);
	setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, vertices, 0, triangleFloatCount, vertexFloatStride, topLeftWord, bottomRightWord);
	syncGxGpuSampleTextureArea(gxGpuSolidCommandRect.left, gxGpuSolidCommandRect.top, gxGpuSolidCommandRect.right, gxGpuSolidCommandRect.bottom);
	renderNewSolidCommands(fixedColor, 0, 3, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord);
	setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, vertices, triangleFloatCount, triangleFloatCount * 2, vertexFloatStride, topLeftWord, bottomRightWord);
	syncGxGpuSampleTextureArea(gxGpuSolidCommandRect.left, gxGpuSolidCommandRect.top, gxGpuSolidCommandRect.right, gxGpuSolidCommandRect.bottom);
	renderNewSolidCommands(fixedColor, 3, 3, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord);
}

function renderTransferCommands(
	vertexFloatCount: number,
	sourceTexture: WebGLTexture,
	sourceTextureUnit: number,
	maskBitModeWord: number,
): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	backend.bindArrayBuffer(gxGpuState.transferVertexBuffer);
	gl.bufferSubData(gl.ARRAY_BUFFER, 0, gxGpuTransferVertices, 0, vertexFloatCount);
	beginGxGpuVramRenderTarget();
	gl.disable(gl.SCISSOR_TEST);
	backend.useProgram(gxGpuState.transferProgram);
	writeTransferUniforms(sourceTextureUnit, maskBitModeWord);
	backend.setActiveTexture(sourceTextureUnit);
	backend.bindTexture2D(sourceTexture);
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(gxGpuState.vramSampleTexture);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuState.transferVertexBuffer);
	gl.enableVertexAttribArray(gxGpuState.transferPositionAttrib);
	gl.vertexAttribPointer(gxGpuState.transferPositionAttrib, 2, gl.FLOAT, false, GX_GPU_TRANSFER_VERTEX_FLOATS * 4, 0);
	gl.enableVertexAttribArray(gxGpuState.transferTexcoordAttrib);
	gl.vertexAttribPointer(gxGpuState.transferTexcoordAttrib, 2, gl.FLOAT, false, GX_GPU_TRANSFER_VERTEX_FLOATS * 4, 2 * 4);
	gl.drawArrays(gl.TRIANGLES, 0, vertexFloatCount / GX_GPU_TRANSFER_VERTEX_FLOATS);
}

function appendTexturedCommandVertices(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	return commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
		? appendTexturedPolygon(commandBuffer, commandIndex, vertexFloatCount)
		: appendTexturedRectangle(commandBuffer, commandIndex, vertexFloatCount);
}

function renderTexturedVertices(
	commandBuffer: GxGpuCommandBufferView,
	commandIndex: number,
	vertexFloatCount: number,
	topLeftWord: number,
	bottomRightWord: number,
	splitTriangles: boolean,
	syncSourceBetweenTriangles: boolean,
): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const fixedColor = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
		&& gxGpuCommandGouraud(opcode)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	const vertices = gxGpuTexturedVertices;
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
	const vertexBuffer = gxGpuState.texturedVertexBuffer;
	backend.bindArrayBuffer(vertexBuffer);
	gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices, 0, vertexFloatCount);
	beginGxGpuVramRenderTarget();
	applyGxGpuDrawingAreaScissor(topLeftWord, bottomRightWord);
	backend.useProgram(fixedColor ? gxGpuState.fixedTexturedProgram : gxGpuState.texturedProgram);
	writeTexturedUniforms(commandBuffer, commandIndex, fixedColor);
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(gxGpuState.vramSampleTexture);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(vertexBuffer);
	const vertexStrideBytes = vertexFloatStride * 4;
	if (fixedColor) {
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedPositionAttrib);
		gl.vertexAttribPointer(gxGpuState.fixedTexturedPositionAttrib, 2, gl.FLOAT, false, vertexStrideBytes, 0);
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedUvPlane01Attrib);
		gl.vertexAttribPointer(gxGpuState.fixedTexturedUvPlane01Attrib, 4, gl.FLOAT, false, vertexStrideBytes, 2 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedUvPlane23Attrib);
		gl.vertexAttribPointer(gxGpuState.fixedTexturedUvPlane23Attrib, 4, gl.FLOAT, false, vertexStrideBytes, 6 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedUvPlane4Attrib);
		gl.vertexAttribPointer(gxGpuState.fixedTexturedUvPlane4Attrib, 2, gl.FLOAT, false, vertexStrideBytes, 10 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedColorPlane0Attrib);
		gl.vertexAttribPointer(gxGpuState.fixedTexturedColorPlane0Attrib, 4, gl.FLOAT, false, vertexStrideBytes, 12 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedColorPlane1Attrib);
		gl.vertexAttribPointer(gxGpuState.fixedTexturedColorPlane1Attrib, 4, gl.FLOAT, false, vertexStrideBytes, 16 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedColorPlane2Attrib);
		gl.vertexAttribPointer(gxGpuState.fixedTexturedColorPlane2Attrib, 4, gl.FLOAT, false, vertexStrideBytes, 20 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedColorPlane3Attrib);
		gl.vertexAttribPointer(gxGpuState.fixedTexturedColorPlane3Attrib, 3, gl.FLOAT, false, vertexStrideBytes, 24 * 4);
	} else {
		gl.enableVertexAttribArray(gxGpuState.texturedPositionAttrib);
		gl.vertexAttribPointer(gxGpuState.texturedPositionAttrib, 2, gl.FLOAT, false, vertexStrideBytes, 0);
		gl.enableVertexAttribArray(gxGpuState.texturedColorAttrib);
		gl.vertexAttribPointer(gxGpuState.texturedColorAttrib, 3, gl.FLOAT, false, vertexStrideBytes, 2 * 4);
		gl.enableVertexAttribArray(gxGpuState.texturedTexcoordAttrib);
		gl.vertexAttribPointer(gxGpuState.texturedTexcoordAttrib, 2, gl.FLOAT, false, vertexStrideBytes, 5 * 4);
		gl.enableVertexAttribArray(gxGpuState.texturedUvPlaneEnableAttrib);
		gl.vertexAttribPointer(gxGpuState.texturedUvPlaneEnableAttrib, 1, gl.FLOAT, false, vertexStrideBytes, 7 * 4);
		gl.enableVertexAttribArray(gxGpuState.texturedUvPlane01Attrib);
		gl.vertexAttribPointer(gxGpuState.texturedUvPlane01Attrib, 4, gl.FLOAT, false, vertexStrideBytes, 8 * 4);
		gl.enableVertexAttribArray(gxGpuState.texturedUvPlane23Attrib);
		gl.vertexAttribPointer(gxGpuState.texturedUvPlane23Attrib, 4, gl.FLOAT, false, vertexStrideBytes, 12 * 4);
		gl.enableVertexAttribArray(gxGpuState.texturedUvPlane4Attrib);
		gl.vertexAttribPointer(gxGpuState.texturedUvPlane4Attrib, 2, gl.FLOAT, false, vertexStrideBytes, 16 * 4);
	}
	if (!splitTriangles) {
		gl.drawArrays(gl.TRIANGLES, 0, vertexFloatCount / vertexFloatStride);
		markGxGpuSampleTextureDirtyArea(gxGpuTexturedCommandRect.left, gxGpuTexturedCommandRect.top, gxGpuTexturedCommandRect.right, gxGpuTexturedCommandRect.bottom);
	} else {
		const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
		const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
		const triangleFloatCount = 3 * vertexFloatStride;
		for (let vertexFloatStart = 0; vertexFloatStart < vertexFloatCount; vertexFloatStart += triangleFloatCount) {
			if (vertexFloatStart !== 0 && syncSourceBetweenTriangles) syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, 0, vertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, fixedColor);
			const vertexFloatEnd = vertexFloatStart + triangleFloatCount;
			setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, vertices, vertexFloatStart, vertexFloatEnd, vertexFloatStride, topLeftWord, bottomRightWord);
			if (readsVram && vertexFloatStart !== 0) syncGxGpuSampleTextureArea(gxGpuVramCopyRectScratch.left, gxGpuVramCopyRectScratch.top, gxGpuVramCopyRectScratch.right, gxGpuVramCopyRectScratch.bottom);
			gl.drawArrays(gl.TRIANGLES, vertexFloatStart / vertexFloatStride, 3);
			markGxGpuSampleTextureDirtyArea(gxGpuVramCopyRectScratch.left, gxGpuVramCopyRectScratch.top, gxGpuVramCopyRectScratch.right, gxGpuVramCopyRectScratch.bottom);
		}
	}
	gl.disable(gl.SCISSOR_TEST);
}

function renderTexturedCommand(commandBuffer: GxGpuCommandBufferView, commandIndex: number, topLeftWord: number, bottomRightWord: number): void {
	const vertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, 0);
	if (vertexFloatCount === 0) return;
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const fixedColor = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
		&& gxGpuCommandGouraud(opcode)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	const vertices = gxGpuTexturedVertices;
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
	setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, vertices, 0, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord);
	syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, 0, vertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, fixedColor);
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	if (gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
		syncGxGpuSampleTextureArea(gxGpuTexturedCommandRect.left, gxGpuTexturedCommandRect.top, gxGpuTexturedCommandRect.right, gxGpuTexturedCommandRect.bottom);
	}
	renderTexturedVertices(commandBuffer, commandIndex, vertexFloatCount, topLeftWord, bottomRightWord, commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON, true);
}

function flushTexturedCommands(commandBuffer: GxGpuCommandBufferView, vertexFloatCount: number, batchCommandIndex: number): number {
	if (vertexFloatCount !== 0) {
		const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[batchCommandIndex];
		const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[batchCommandIndex];
		const opcode = commandBuffer.commandOpcode[batchCommandIndex];
		const fixedColor = commandBuffer.commandKind[batchCommandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
			&& gxGpuCommandGouraud(opcode)
			&& !gxGpuCommandRawTextureEnabled(opcode);
		const vertices = gxGpuTexturedVertices;
		const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
		setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, vertices, 0, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord);
		const maskBitModeWord = commandBuffer.commandMaskBitModeWord[batchCommandIndex];
		const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
		if (readsVram) syncGxGpuSampleTextureArea(gxGpuTexturedCommandRect.left, gxGpuTexturedCommandRect.top, gxGpuTexturedCommandRect.right, gxGpuTexturedCommandRect.bottom);
		renderTexturedVertices(commandBuffer, batchCommandIndex, vertexFloatCount, topLeftWord, bottomRightWord, readsVram, false);
	}
	resetGxGpuVramCopyRect(gxGpuTexturedBatchRect);
	return 0;
}

function scanoutGxGpuVram(fbo: WebGLFramebuffer, state: RenderPassStateRegistry['gx_gpu']): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
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
	backend.useProgram(gxGpuState.scanoutProgram);
	gl.uniform1i(gxGpuState.scanoutVramUniform, GX_GPU_SCANOUT_TEXTURE_UNIT);
	if (gxGpuState.scanoutUniformDisplayModeWord !== state.displayModeWord
		|| gxGpuState.scanoutUniformDisplayStartWord !== state.displayStartWord
		|| gxGpuState.scanoutUniformHeight !== state.height) {
		gl.uniform4f(
			gxGpuState.scanoutDisplayUniform,
			gxGpuDisplayStartX(state.displayStartWord),
			gxGpuDisplayStartY(state.displayStartWord),
			state.height,
			(state.displayModeWord & GX_GPU_DISPLAY_MODE_RGB24_BIT) !== 0 ? 1 : 0,
		);
		gxGpuState.scanoutUniformDisplayModeWord = state.displayModeWord;
		gxGpuState.scanoutUniformDisplayStartWord = state.displayStartWord;
		gxGpuState.scanoutUniformHeight = state.height;
	}
	backend.setActiveTexture(GX_GPU_SCANOUT_TEXTURE_UNIT);
	backend.bindTexture2D(gxGpuState.vramTexture);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuState.scanoutVertexBuffer);
	gl.enableVertexAttribArray(gxGpuState.scanoutPositionAttrib);
	gl.vertexAttribPointer(gxGpuState.scanoutPositionAttrib, 2, gl.FLOAT, false, GX_GPU_SCANOUT_VERTEX_FLOATS * 4, 0);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function executeGxGpuVramCommands(source: GxGpuVramSource): void {
	const commandBuffer = source.commandBuffer;
	const commandSerial = commandBuffer.serial;
	const vramClearSerial = commandBuffer.vramClearSerial;
	if (gxGpuState.vramSnapshotSerial !== source.vramSnapshotSerial) {
		uploadGxGpuVramSnapshot(source.vramSnapshotBytes);
		gxGpuState.processedCommandCount = 0;
		gxGpuState.processedCommandSerial = commandSerial;
		gxGpuState.vramClearSerial = vramClearSerial;
		gxGpuState.vramSnapshotSerial = source.vramSnapshotSerial;
	} else if (gxGpuState.vramClearSerial !== vramClearSerial) {
		clearGxGpuVram();
		gxGpuState.processedCommandCount = 0;
		gxGpuState.processedCommandSerial = commandSerial;
		gxGpuState.vramClearSerial = vramClearSerial;
	} else if (gxGpuState.processedCommandSerial !== commandSerial) {
		gxGpuState.processedCommandCount = 0;
		gxGpuState.processedCommandSerial = commandSerial;
	}
	executeNewGxGpuCommands(commandBuffer);
	completeGxGpuReadback(commandBuffer, source.readbackPort);
}

function completeGxGpuReadback(commandBuffer: GxGpuCommandBufferView, readback: GxGpuVramSource['readbackPort']): void {
	if (!readback.claimReadback(commandBuffer.presentCommandCount)) {
		return;
	}
	const readbackToken = readback.token;
	const pixelCount = readback.width * readback.height;
	const wordCount = (pixelCount + 1) >> 1;
	const packedWidth = wordCount < GX_GPU_READBACK_PACK_WIDTH ? wordCount : GX_GPU_READBACK_PACK_WIDTH;
	const packedHeight = ((wordCount - 1) / packedWidth | 0) + 1;
	const gl = gxGpuState.gl;
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuState.readbackFramebuffer);
	gxGpuState.backend.setViewportRect(0, 0, packedWidth, packedHeight);
	gl.disable(gl.SCISSOR_TEST);
	gxGpuState.backend.setDepthTestEnabled(false);
	gxGpuState.backend.setDepthMask(false);
	gxGpuState.backend.setCullEnabled(false);
	gxGpuState.backend.setBlendEnabled(false);
	gl.colorMask(true, true, true, true);
	gxGpuState.backend.useProgram(gxGpuState.readbackProgram);
	gl.uniform1i(gxGpuState.readbackVramUniform, GX_GPU_SCANOUT_TEXTURE_UNIT);
	gl.uniform4f(gxGpuState.readbackParamsUniform, readback.x, readback.y, readback.width, packedWidth);
	gxGpuState.backend.setActiveTexture(GX_GPU_SCANOUT_TEXTURE_UNIT);
	gxGpuState.backend.bindTexture2D(gxGpuState.vramTexture);
	gxGpuState.backend.bindVertexArray(null);
	gxGpuState.backend.bindArrayBuffer(gxGpuState.scanoutVertexBuffer);
	gl.enableVertexAttribArray(gxGpuState.readbackPositionAttrib);
	gl.vertexAttribPointer(gxGpuState.readbackPositionAttrib, 2, gl.FLOAT, false, GX_GPU_SCANOUT_VERTEX_FLOATS * 4, 0);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
	gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
	gl.readPixels(0, 0, packedWidth, packedHeight, gl.RGBA, gl.UNSIGNED_BYTE, readback.pixelBytes);
	readback.completeReadback(readbackToken);
}

export function captureRenderedVramSnapshot(gxGpu: GxGpu, output: GxGpuVramSource): void {
	executeGxGpuVramCommands(output);
	const gl = gxGpuState.gl;
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuState.vramFramebuffer);
	gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
	gl.readPixels(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, gxGpuRawVramReadback);
	let snapshotByteOffset = 0;
	for (let logicalY = 0; logicalY < GX_GPU_VRAM_HEIGHT; logicalY += 1) {
		let readbackByteOffset = ((GX_GPU_VRAM_HEIGHT - 1) - logicalY) * GX_GPU_VRAM_WIDTH * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
		for (let column = 0; column < GX_GPU_VRAM_WIDTH; column += 1) {
			gxGpuVramSnapshotScratch[snapshotByteOffset] = gxGpuRawVramReadback[readbackByteOffset];
			gxGpuVramSnapshotScratch[snapshotByteOffset + 1] = gxGpuRawVramReadback[readbackByteOffset + 1];
			snapshotByteOffset += 2;
			readbackByteOffset += GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
		}
	}
	gxGpuState.vramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(gxGpuVramSnapshotScratch);
}

function renderGxGpuPass(fbo: WebGLFramebuffer, state: RenderPassStateRegistry['gx_gpu']): void {
	executeGxGpuVramCommands(state);
	scanoutGxGpuVram(fbo, state);
}

function writeGxGpuState(ctx: RenderGraphPassContext, state: RenderPassStateRegistry['gx_gpu']): void {
	state.width = ctx.view.offscreenCanvasSize.x;
	state.height = ctx.view.offscreenCanvasSize.y;
	state.commandBuffer = ctx.view.gxGpuCommandBuffer;
	state.readbackPort = ctx.view.gxGpuReadbackPort;
	state.statusWord = ctx.view.gxGpuStatusWord;
	state.displayModeWord = ctx.view.gxGpuDisplayModeWord;
	state.displayStartWord = ctx.view.gxGpuDisplayStartWord;
	state.vramSnapshotBytes = ctx.view.gxGpuVramSnapshotBytes;
	state.vramSnapshotSerial = ctx.view.gxGpuVramSnapshotSerial;
}

export function registerGxGpuPass(registry: RenderPassLibrary): void {
	const gxGpuState: RenderPassStateRegistry['gx_gpu'] = {
		width: 0,
		height: 0,
		commandBuffer: registry.view.gxGpuCommandBuffer,
		readbackPort: registry.view.gxGpuReadbackPort,
		statusWord: registry.view.gxGpuStatusWord,
		displayModeWord: registry.view.gxGpuDisplayModeWord,
		displayStartWord: registry.view.gxGpuDisplayStartWord,
		vramSnapshotBytes: registry.view.gxGpuVramSnapshotBytes,
		vramSnapshotSerial: registry.view.gxGpuVramSnapshotSerial,
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
		exec: (_backend: WebGLBackend, fbo, state: RenderPassStateRegistry['gx_gpu']) => {
			renderGxGpuPass(fbo as WebGLFramebuffer, state);
		},
	});
}
