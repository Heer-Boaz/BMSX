import type { GxGpu } from '../../../machine/devices/gx/gpu';
import type { GxGpuDeviceOutput } from '../../../machine/devices/gx/device_output';
import {
	GX_GPU_CLUT_4BIT_WORDS,
	GX_GPU_CLUT_8BIT_WORDS,
} from '../../../machine/devices/gx/gp0';
import {
	GX_GPU_COMMAND_CAPACITY,
	GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
	GX_GPU_COMMAND_DRAW_LINE,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_POLYLINE,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GX_GPU_SKIPPED_LINE_NONE,
	GX_GPU_TRANSFER_MAX_HEIGHT,
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
	GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA,
	GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB,
	GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGBA,
	GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB,
	GX_GPU_PCRTC_SCANOUT_DRAW_NONE,
	GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA,
	GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA,
	GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB,
	GX_GPU_PCRTC_SAMPLE_LINEAR_GX16,
	GX_GPU_PCRTC_SAMPLE_PATH_COUNT,
	GX_GPU_PCRTC_STORAGE_GX16,
	type GxGpuPcrtcCircuit,
	type GxGpuPcrtcScanout,
} from '../../../machine/devices/gx/gpu_pcrtc';
import {
	GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP,
	GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP,
	GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK,
	GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS,
	GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES,
	GX_GPU_VERTEX_COORD_PERIOD,
	GxGpuRasterKind,
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
	gxGpuTransferX,
	gxGpuTransferY,
	gxGpuTriangleExceedsPrimitiveSize,
	gxGpuTriangleRasterShift,
	gxGpuTriangleAttributePlane,
	gxGpuVramLogicalAreaOverlapsBounds,
	gxGpuVertexY,
	gxGpuVramCopyChunkHeight,
	gxGpuVramCopyNeedsChunking,
	gxGpuVramWrappedHeight,
	gxGpuVramWrappedWidth,
} from '../gx_gpu_render_rules';
import {
	GX_GPU_VRAM_BYTE_COUNT,
	GX_GPU_VRAM_HEIGHT,
	GX_GPU_VRAM_WIDTH,
	GX_GPU_VRAM_Y_ADDRESS_PERIOD,
	gxGpuVramYAddress,
	gxGpuVramYAddressMask,
} from '../../../machine/devices/gx/vram_address';
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
const GX_GPU_SCANOUT_FIELDS_TEXTURE_UNIT = 3;
const GX_GPU_POLYGON_VERTICES_PER_COMMAND = 6;
const GX_GPU_SOLID_VERTEX_FLOATS = 6;
const GX_GPU_SOLID_TRIANGLE_FLOATS = 3 * GX_GPU_SOLID_VERTEX_FLOATS;
const GX_GPU_SOLID_VERTICES_PER_COMMAND = 24;
const GX_GPU_SOLID_FLOAT_CAPACITY = GX_GPU_COMMAND_CAPACITY * GX_GPU_SOLID_VERTICES_PER_COMMAND * GX_GPU_SOLID_VERTEX_FLOATS;
const GX_GPU_FIXED_SOLID_VERTEX_FLOATS = 11;
const GX_GPU_FIXED_SOLID_TRIANGLE_FLOATS = 3 * GX_GPU_FIXED_SOLID_VERTEX_FLOATS;
const GX_GPU_LINE_VERTEX_FLOATS = 12;
const GX_GPU_LINE_VERTICES_PER_SEGMENT = 6;
const GX_GPU_LINE_SEGMENT_FLOATS = GX_GPU_LINE_VERTICES_PER_SEGMENT * GX_GPU_LINE_VERTEX_FLOATS;
const GX_GPU_LINE_SEGMENT_CAPACITY = 1024;
const GX_GPU_LINE_FLOAT_CAPACITY = GX_GPU_LINE_SEGMENT_CAPACITY * GX_GPU_LINE_SEGMENT_FLOATS;
const GX_GPU_TEXTURED_UV_COMPONENTS = 2;
const GX_GPU_COLOR_COMPONENTS = 3;
const GX_GPU_TEXTURED_VERTEX_FLOATS = 11;
const GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS = 17;
const GX_GPU_TEXTURED_FLOAT_CAPACITY = GX_GPU_COMMAND_CAPACITY * GX_GPU_POLYGON_VERTICES_PER_COMMAND * GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS;
const GX_GPU_TEXTURE_PAGE_COORD_SIZE = 256;
const GX_GPU_TEXTURE_PAGE_4BIT_WIDTH_WORDS = 64;
const GX_GPU_TEXTURE_PAGE_8BIT_WIDTH_WORDS = 128;
const GX_GPU_TRANSFER_VERTEX_FLOATS = 4;
const GX_GPU_TRANSFER_VERTICES_PER_SEGMENT = 6;
const GX_GPU_TRANSFER_SEGMENTS_PER_ROW = 3;
const GX_GPU_TRANSFER_FLOAT_CAPACITY = GX_GPU_TRANSFER_MAX_HEIGHT * GX_GPU_TRANSFER_SEGMENTS_PER_ROW * GX_GPU_TRANSFER_VERTICES_PER_SEGMENT * GX_GPU_TRANSFER_VERTEX_FLOATS;
const GX_GPU_SCANOUT_VERTEX_FLOATS = 2;
const GX_GPU_SCANOUT_DOUBLE_ALPHA_PROGRAM_BASE = GX_GPU_PCRTC_SAMPLE_PATH_COUNT;
const GX_GPU_SCANOUT_PROGRAM_COUNT = GX_GPU_PCRTC_SAMPLE_PATH_COUNT * 2;
const GX_GPU_SCANOUT_CIRCUIT_UNIFORM_BINDING = 3;
const GX_GPU_SCANOUT_CIRCUIT_UNIFORM_WORD_COUNT = 20;
const GX_GPU_SCANOUT_CIRCUIT_UNIFORM_BYTES = GX_GPU_SCANOUT_CIRCUIT_UNIFORM_WORD_COUNT * 4;
const GX_GPU_SCANOUT_POSITION_ATTRIB = 0;
const GX_GPU_RAW_VRAM_BYTES_PER_PIXEL = 4;
const GX_GPU_CPU_UPLOAD_BYTES_PER_PIXEL = 2;
const GX_GPU_RAW_VRAM_UPLOAD_BYTES = GX_GPU_VRAM_WIDTH * GX_GPU_VRAM_HEIGHT * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
const GX_GPU_RAW_VRAM_READBACK_BYTES = GX_GPU_VRAM_WIDTH * GX_GPU_VRAM_HEIGHT * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
const GX_GPU_READBACK_PACK_WIDTH = 512;
const GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD = 0;
const GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD = (GX_GPU_VRAM_WIDTH - 1) | ((GX_GPU_VRAM_HEIGHT - 1) << 10);
const GX_GPU_FIXED_COLOR_PLANE_SHADER_DEFINE = '#define GX_GPU_FIXED_COLOR_PLANE 1\n';
const GX_GPU_CPU_UPLOAD_SHADER_DEFINE = '#define GX_GPU_CPU_UPLOAD_SOURCE 1\n';
const GX_GPU_INTERLACED_FIELD_SHADER_DEFINE = '#define GX_GPU_INTERLACED_FIELD 1\n';
const GX_GPU_INTERLACED_WEAVE_SHADER_DEFINE = '#define GX_GPU_INTERLACED_WEAVE 1\n';

const gxGpuSolidVertices = new Float32Array(GX_GPU_SOLID_FLOAT_CAPACITY);
const gxGpuSolidVertexWords = new Uint32Array(gxGpuSolidVertices.buffer);
const gxGpuLineVertices = new Float32Array(GX_GPU_LINE_FLOAT_CAPACITY);
const gxGpuTexturedVertices = new Float32Array(GX_GPU_TEXTURED_FLOAT_CAPACITY);
const gxGpuTexturedVertexWords = new Uint32Array(gxGpuTexturedVertices.buffer);
const gxGpuTexturedUvPlane = new Float64Array(GX_GPU_TEXTURED_UV_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
const gxGpuColorPlane = new Float64Array(GX_GPU_COLOR_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
const gxGpuTransferVertices = new Float32Array(GX_GPU_TRANSFER_FLOAT_CAPACITY);
const gxGpuVramSnapshotUpload = new Uint8Array(GX_GPU_RAW_VRAM_UPLOAD_BYTES);
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
	skippedLineParity: number;
	blendEnabled: boolean;
	blendMode: number;
	readsVram: boolean;
	vramYAddressExtensionWord: number;
};

type GxGpuTransferProgram = {
	program: WebGLProgram;
	positionAttrib: number;
	sourceOffsetAttrib: number;
	sourceUniform: WebGLUniformLocation;
	vramUniform: WebGLUniformLocation;
	checkMaskBitUniform: WebGLUniformLocation;
	setMaskBitUniform: WebGLUniformLocation;
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
	skippedLineParity: GX_GPU_SKIPPED_LINE_NONE,
	blendEnabled: false,
	blendMode: 0,
	readsVram: false,
	vramYAddressExtensionWord: 0,
};

type GxGpuState = {
	backend: WebGLBackend;
	gl: WebGL2RenderingContext;
	solidProgram: WebGLProgram;
	fixedSolidProgram: WebGLProgram;
	lineProgram: WebGLProgram;
	texturedProgram: WebGLProgram;
	fixedTexturedProgram: WebGLProgram;
	transferProgram: GxGpuTransferProgram;
	cpuUploadProgram: GxGpuTransferProgram;
	cpuUploadUniform: WebGLUniformLocation;
	scanoutPrograms: WebGLProgram[];
	scanoutFieldPrograms: WebGLProgram[];
	scanoutWeaveProgram: WebGLProgram;
	readbackProgram: WebGLProgram;
	vramTexture: WebGLTexture;
	vramSampleTexture: WebGLTexture;
	cpuUploadTexture: WebGLTexture;
	vramFramebuffer: WebGLFramebuffer;
	readbackTexture: WebGLTexture;
	scanoutFieldsTexture: WebGLTexture;
	readbackFramebuffer: WebGLFramebuffer;
	scanoutFieldsFramebuffer: WebGLFramebuffer;
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
	solidSkippedLineParityUniform: WebGLUniformLocation;
	solidRasterPhaseUniform: WebGLUniformLocation;
	fixedSolidPositionAttrib: number;
	fixedSolidColorPlaneBaseAttrib: number;
	fixedSolidColorPlaneStepXAttrib: number;
	fixedSolidColorPlaneStepYAttrib: number;
	fixedSolidVramUniform: WebGLUniformLocation;
	fixedSolidBlendEnableUniform: WebGLUniformLocation;
	fixedSolidBlendModeUniform: WebGLUniformLocation;
	fixedSolidCheckMaskBitUniform: WebGLUniformLocation;
	fixedSolidSetMaskBitUniform: WebGLUniformLocation;
	fixedSolidDitherEnableUniform: WebGLUniformLocation;
	fixedSolidSkippedLineParityUniform: WebGLUniformLocation;
	fixedSolidRasterPhaseUniform: WebGLUniformLocation;
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
	lineSkippedLineParityUniform: WebGLUniformLocation;
	texturedPositionAttrib: number;
	texturedColorAttrib: number;
	texturedUvPlaneBaseAttrib: number;
	texturedUvPlaneStepXAttrib: number;
	texturedUvPlaneStepYAttrib: number;
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
	texturedSkippedLineParityUniform: WebGLUniformLocation;
	texturedRasterPhaseUniform: WebGLUniformLocation;
	fixedTexturedPositionAttrib: number;
	fixedTexturedUvPlaneBaseAttrib: number;
	fixedTexturedUvPlaneStepXAttrib: number;
	fixedTexturedUvPlaneStepYAttrib: number;
	fixedTexturedColorPlaneBaseAttrib: number;
	fixedTexturedColorPlaneStepXAttrib: number;
	fixedTexturedColorPlaneStepYAttrib: number;
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
	fixedTexturedSkippedLineParityUniform: WebGLUniformLocation;
	fixedTexturedRasterPhaseUniform: WebGLUniformLocation;
	scanoutFieldInterlaceUniforms: WebGLUniformLocation[];
	scanoutWeaveInterlaceUniform: WebGLUniformLocation;
	readbackParamsUniform: WebGLUniformLocation;
	readbackVramYAddressExtensionUniform: WebGLUniformLocation;
	scanoutCircuitUniforms: readonly [Uint32Array, Uint32Array];
	scanoutCircuitUniformUpload: Uint32Array;
	scanoutCircuitUniformBuffer: WebGLBuffer;
	scanoutCircuitUniformSlotBytes: number;
	scanoutCircuitUniformRevision: number;
	scanoutCircuitUniformField: number;
	scanoutCircuitUniformValid: boolean;
	scanoutFixedStateRevision: number;
	scanoutFixedStateValid: boolean;
	scanoutBackgroundRed: number;
	scanoutBackgroundGreen: number;
	scanoutBackgroundBlue: number;
	scanoutBlendAlpha: number;
	scanoutFieldUniformRevisions: Uint32Array;
	scanoutFieldUniformFields: Int8Array;
	scanoutFieldsWidth: number;
	scanoutFieldsHeight: number;
	scanoutFieldsValid: boolean;
	scanoutFieldsVramReplacementSerial: bigint;
	processedCommandCount: number;
	processedCommandSerial: number;
	vramSnapshotSerial: bigint;
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
	const transferProgramHandle = backend.buildProgram(transferVertexShader, transferFragmentShader, 'gx_gpu_transfer');
	const cpuUploadProgramHandle = backend.buildProgram(transferVertexShader, transferFragmentShader, 'gx_gpu_cpu_upload', GX_GPU_CPU_UPLOAD_SHADER_DEFINE);
	const scanoutPrograms: WebGLProgram[] = [];
	const scanoutFieldPrograms: WebGLProgram[] = [];
	const scanoutVertex = backend.compileShader(
		gl.VERTEX_SHADER, scanoutVertexShader, 'gx_gpu_scanout_shared', 'vs',
	);
	let scanoutWeaveProgram!: WebGLProgram;
	let readbackProgram!: WebGLProgram;
	try {
		for (let program = 0; program < GX_GPU_SCANOUT_PROGRAM_COUNT; program += 1) {
			const storageProgram = program % GX_GPU_PCRTC_SAMPLE_PATH_COUNT;
			const linearGx16 = storageProgram === GX_GPU_PCRTC_SAMPLE_LINEAR_GX16;
			const storagePath = linearGx16
				? GX_GPU_PCRTC_STORAGE_GX16
				: storageProgram;
			let defines = `#define GX_GPU_SCANOUT_STORAGE_PATH ${storagePath}\n`;
			if (linearGx16) defines += '#define GX_GPU_SCANOUT_LINEAR_GX16 1\n';
			if (program >= GX_GPU_SCANOUT_DOUBLE_ALPHA_PROGRAM_BASE) defines += '#define GX_GPU_SCANOUT_DOUBLE_ALPHA 1\n';
			scanoutPrograms.push(backend.buildProgramWithVertexShader(
				scanoutVertex, scanoutFragmentShader, `gx_gpu_scanout_${program}`, defines));
			scanoutFieldPrograms.push(backend.buildProgramWithVertexShader(
				scanoutVertex,
				scanoutFragmentShader,
				`gx_gpu_scanout_field_${program}`,
				GX_GPU_INTERLACED_FIELD_SHADER_DEFINE + defines,
			));
		}
		scanoutWeaveProgram = backend.buildProgramWithVertexShader(
			scanoutVertex,
			scanoutFragmentShader,
			'gx_gpu_scanout_weave',
			GX_GPU_INTERLACED_WEAVE_SHADER_DEFINE + '#define GX_GPU_SCANOUT_STORAGE_PATH 6\n',
		);
		readbackProgram = backend.buildProgramWithVertexShader(
			scanoutVertex, readbackFragmentShader, 'gx_gpu_readback',
		);
	} finally {
		gl.deleteShader(scanoutVertex);
	}
	const vramTexture = gl.createTexture() as WebGLTexture;
	initializeGxGpuTexture(backend, vramTexture, GX_GPU_SCANOUT_TEXTURE_UNIT);

	const vramSampleTexture = gl.createTexture() as WebGLTexture;
	initializeGxGpuTexture(backend, vramSampleTexture, GX_GPU_TEXTURE_SAMPLE_UNIT);

	const cpuUploadTexture = gl.createTexture() as WebGLTexture;
	backend.setActiveTexture(GX_GPU_TEXTURE_TRANSFER_UNIT);
	backend.bindTexture2D(cpuUploadTexture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT, 0, gl.RG, gl.UNSIGNED_BYTE, null);
	glSetTexture2DParams(gl, RGBA8_LINEAR_TEXTURE_PARAMS);
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
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, GX_GPU_READBACK_PACK_WIDTH, GX_GPU_TRANSFER_MAX_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	glSetTexture2DParams(gl, RGBA8_LINEAR_TEXTURE_PARAMS);
	const readbackFramebuffer = gl.createFramebuffer() as WebGLFramebuffer;
	gl.bindFramebuffer(gl.FRAMEBUFFER, readbackFramebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, readbackTexture, 0);
	const scanoutFieldsTexture = gl.createTexture() as WebGLTexture;
	backend.setActiveTexture(GX_GPU_SCANOUT_FIELDS_TEXTURE_UNIT);
	backend.bindTexture2D(scanoutFieldsTexture);
	glSetTexture2DParams(gl, RGBA8_LINEAR_TEXTURE_PARAMS);
	const scanoutFieldsFramebuffer = gl.createFramebuffer() as WebGLFramebuffer;
	gl.bindFramebuffer(gl.FRAMEBUFFER, scanoutFieldsFramebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, scanoutFieldsTexture, 0);

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
	const scanoutFieldInterlaceUniforms = scanoutFieldPrograms.map(
		program => gl.getUniformLocation(program, 'u_interlace') as WebGLUniformLocation,
	);
	const scanoutFieldUniformFields = new Int8Array(GX_GPU_SCANOUT_PROGRAM_COUNT);
	scanoutFieldUniformFields.fill(-1);
	const uniformOffsetAlignment = gl.getParameter(gl.UNIFORM_BUFFER_OFFSET_ALIGNMENT) as number;
	const uniformPayloadRemainder = GX_GPU_SCANOUT_CIRCUIT_UNIFORM_BYTES % uniformOffsetAlignment;
	const scanoutCircuitUniformSlotBytes = uniformPayloadRemainder === 0
		? GX_GPU_SCANOUT_CIRCUIT_UNIFORM_BYTES
		: GX_GPU_SCANOUT_CIRCUIT_UNIFORM_BYTES + uniformOffsetAlignment - uniformPayloadRemainder;
	const uniformSlotWords = scanoutCircuitUniformSlotBytes >> 2;
	const scanoutCircuitUniformUpload = new Uint32Array(uniformSlotWords * 2);
	const scanoutCircuitUniforms: readonly [Uint32Array, Uint32Array] = [
		scanoutCircuitUniformUpload.subarray(0, GX_GPU_SCANOUT_CIRCUIT_UNIFORM_WORD_COUNT),
		scanoutCircuitUniformUpload.subarray(uniformSlotWords, uniformSlotWords + GX_GPU_SCANOUT_CIRCUIT_UNIFORM_WORD_COUNT),
	];
	const scanoutCircuitUniformBuffer = backend.createUniformBuffer(
		scanoutCircuitUniformUpload.byteLength,
		'dynamic',
	);
	const transferProgram: GxGpuTransferProgram = {
		program: transferProgramHandle,
		positionAttrib: gl.getAttribLocation(transferProgramHandle, 'a_position'),
		sourceOffsetAttrib: gl.getAttribLocation(transferProgramHandle, 'a_sourceOffset'),
		sourceUniform: gl.getUniformLocation(transferProgramHandle, 'u_source') as WebGLUniformLocation,
		vramUniform: gl.getUniformLocation(transferProgramHandle, 'u_vram') as WebGLUniformLocation,
		checkMaskBitUniform: gl.getUniformLocation(transferProgramHandle, 'u_checkMaskBit') as WebGLUniformLocation,
		setMaskBitUniform: gl.getUniformLocation(transferProgramHandle, 'u_setMaskBit') as WebGLUniformLocation,
	};
	const cpuUploadProgram: GxGpuTransferProgram = {
		program: cpuUploadProgramHandle,
		positionAttrib: gl.getAttribLocation(cpuUploadProgramHandle, 'a_position'),
		sourceOffsetAttrib: gl.getAttribLocation(cpuUploadProgramHandle, 'a_sourceOffset'),
		sourceUniform: gl.getUniformLocation(cpuUploadProgramHandle, 'u_source') as WebGLUniformLocation,
		vramUniform: gl.getUniformLocation(cpuUploadProgramHandle, 'u_vram') as WebGLUniformLocation,
		checkMaskBitUniform: gl.getUniformLocation(cpuUploadProgramHandle, 'u_checkMaskBit') as WebGLUniformLocation,
		setMaskBitUniform: gl.getUniformLocation(cpuUploadProgramHandle, 'u_setMaskBit') as WebGLUniformLocation,
	};
	const cpuUploadUniform = gl.getUniformLocation(cpuUploadProgramHandle, 'u_upload') as WebGLUniformLocation;
	for (let program = 0; program < GX_GPU_SCANOUT_PROGRAM_COUNT; program += 1) {
		backend.useProgram(scanoutPrograms[program]!);
		backend.setUniformBlockBinding('GxGpuScanoutCircuit', GX_GPU_SCANOUT_CIRCUIT_UNIFORM_BINDING);
		gl.uniform1i(gl.getUniformLocation(scanoutPrograms[program]!, 'u_vram'), GX_GPU_SCANOUT_TEXTURE_UNIT);
		backend.useProgram(scanoutFieldPrograms[program]!);
		backend.setUniformBlockBinding('GxGpuScanoutCircuit', GX_GPU_SCANOUT_CIRCUIT_UNIFORM_BINDING);
		gl.uniform1i(gl.getUniformLocation(scanoutFieldPrograms[program]!, 'u_vram'), GX_GPU_SCANOUT_TEXTURE_UNIT);
	}
	backend.useProgram(scanoutWeaveProgram);
	gl.uniform1i(gl.getUniformLocation(scanoutWeaveProgram, 'u_vram'), GX_GPU_SCANOUT_FIELDS_TEXTURE_UNIT);
	backend.useProgram(readbackProgram);
	gl.uniform1i(gl.getUniformLocation(readbackProgram, 'u_vram'), GX_GPU_SCANOUT_TEXTURE_UNIT);
	gxGpuState = {
		backend,
		gl,
		solidProgram,
		fixedSolidProgram,
		lineProgram,
		texturedProgram,
		fixedTexturedProgram,
		transferProgram,
		cpuUploadProgram,
		cpuUploadUniform,
		scanoutPrograms,
		scanoutFieldPrograms,
		scanoutWeaveProgram,
		readbackProgram,
		vramTexture,
		vramSampleTexture,
		cpuUploadTexture,
		vramFramebuffer,
		readbackTexture,
		scanoutFieldsTexture,
		readbackFramebuffer,
		scanoutFieldsFramebuffer,
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
		solidSkippedLineParityUniform: gl.getUniformLocation(solidProgram, 'u_skippedLineParity') as WebGLUniformLocation,
		solidRasterPhaseUniform: gl.getUniformLocation(solidProgram, 'u_rasterPhase') as WebGLUniformLocation,
		fixedSolidPositionAttrib: gl.getAttribLocation(fixedSolidProgram, 'a_position'),
		fixedSolidColorPlaneBaseAttrib: gl.getAttribLocation(fixedSolidProgram, 'a_colorPlaneBase'),
		fixedSolidColorPlaneStepXAttrib: gl.getAttribLocation(fixedSolidProgram, 'a_colorPlaneStepX'),
		fixedSolidColorPlaneStepYAttrib: gl.getAttribLocation(fixedSolidProgram, 'a_colorPlaneStepY'),
		fixedSolidVramUniform: gl.getUniformLocation(fixedSolidProgram, 'u_vram') as WebGLUniformLocation,
		fixedSolidBlendEnableUniform: gl.getUniformLocation(fixedSolidProgram, 'u_blendEnable') as WebGLUniformLocation,
		fixedSolidBlendModeUniform: gl.getUniformLocation(fixedSolidProgram, 'u_blendMode') as WebGLUniformLocation,
		fixedSolidCheckMaskBitUniform: gl.getUniformLocation(fixedSolidProgram, 'u_checkMaskBit') as WebGLUniformLocation,
		fixedSolidSetMaskBitUniform: gl.getUniformLocation(fixedSolidProgram, 'u_setMaskBit') as WebGLUniformLocation,
		fixedSolidDitherEnableUniform: gl.getUniformLocation(fixedSolidProgram, 'u_ditherEnable') as WebGLUniformLocation,
		fixedSolidSkippedLineParityUniform: gl.getUniformLocation(fixedSolidProgram, 'u_skippedLineParity') as WebGLUniformLocation,
		fixedSolidRasterPhaseUniform: gl.getUniformLocation(fixedSolidProgram, 'u_rasterPhase') as WebGLUniformLocation,
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
		lineSkippedLineParityUniform: gl.getUniformLocation(lineProgram, 'u_skippedLineParity') as WebGLUniformLocation,
		texturedPositionAttrib: gl.getAttribLocation(texturedProgram, 'a_position'),
		texturedColorAttrib: gl.getAttribLocation(texturedProgram, 'a_color'),
		texturedUvPlaneBaseAttrib: gl.getAttribLocation(texturedProgram, 'a_uvPlaneBase'),
		texturedUvPlaneStepXAttrib: gl.getAttribLocation(texturedProgram, 'a_uvPlaneStepX'),
		texturedUvPlaneStepYAttrib: gl.getAttribLocation(texturedProgram, 'a_uvPlaneStepY'),
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
		texturedSkippedLineParityUniform: gl.getUniformLocation(texturedProgram, 'u_skippedLineParity') as WebGLUniformLocation,
		texturedRasterPhaseUniform: gl.getUniformLocation(texturedProgram, 'u_rasterPhase') as WebGLUniformLocation,
		fixedTexturedPositionAttrib: gl.getAttribLocation(fixedTexturedProgram, 'a_position'),
		fixedTexturedUvPlaneBaseAttrib: gl.getAttribLocation(fixedTexturedProgram, 'a_uvPlaneBase'),
		fixedTexturedUvPlaneStepXAttrib: gl.getAttribLocation(fixedTexturedProgram, 'a_uvPlaneStepX'),
		fixedTexturedUvPlaneStepYAttrib: gl.getAttribLocation(fixedTexturedProgram, 'a_uvPlaneStepY'),
		fixedTexturedColorPlaneBaseAttrib: gl.getAttribLocation(fixedTexturedProgram, 'a_colorPlaneBase'),
		fixedTexturedColorPlaneStepXAttrib: gl.getAttribLocation(fixedTexturedProgram, 'a_colorPlaneStepX'),
		fixedTexturedColorPlaneStepYAttrib: gl.getAttribLocation(fixedTexturedProgram, 'a_colorPlaneStepY'),
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
		fixedTexturedSkippedLineParityUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_skippedLineParity') as WebGLUniformLocation,
		fixedTexturedRasterPhaseUniform: gl.getUniformLocation(fixedTexturedProgram, 'u_rasterPhase') as WebGLUniformLocation,
		scanoutFieldInterlaceUniforms,
		scanoutWeaveInterlaceUniform: gl.getUniformLocation(scanoutWeaveProgram, 'u_interlace') as WebGLUniformLocation,
		readbackParamsUniform: gl.getUniformLocation(readbackProgram, 'u_readback') as WebGLUniformLocation,
		readbackVramYAddressExtensionUniform: gl.getUniformLocation(readbackProgram, 'u_vramYAddressExtensionWord') as WebGLUniformLocation,
		scanoutCircuitUniforms,
		scanoutCircuitUniformUpload,
		scanoutCircuitUniformBuffer,
		scanoutCircuitUniformSlotBytes,
		scanoutCircuitUniformRevision: 0,
		scanoutCircuitUniformField: -1,
		scanoutCircuitUniformValid: false,
		scanoutFixedStateRevision: 0,
		scanoutFixedStateValid: false,
		scanoutBackgroundRed: 0,
		scanoutBackgroundGreen: 0,
		scanoutBackgroundBlue: 0,
		scanoutBlendAlpha: 0,
		scanoutFieldUniformRevisions: new Uint32Array(GX_GPU_SCANOUT_PROGRAM_COUNT),
		scanoutFieldUniformFields,
		scanoutFieldsWidth: 0,
		scanoutFieldsHeight: 0,
		scanoutFieldsValid: false,
		scanoutFieldsVramReplacementSerial: 0n,
		processedCommandCount: 0,
		processedCommandSerial: 0,
		vramSnapshotSerial: 0n,
	};
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

function writeFixedSolidVertex(offset: number, x: number, y: number): number {
	gxGpuSolidVertices[offset] = x;
	gxGpuSolidVertices[offset + 1] = y;
	for (let component = 0; component < GX_GPU_COLOR_COMPONENTS; component += 1) {
		gxGpuSolidVertexWords[offset + 2 + component] = gxGpuColorPlane[component];
		gxGpuSolidVertexWords[offset + 5 + component] = gxGpuColorPlane[GX_GPU_COLOR_COMPONENTS + component];
		gxGpuSolidVertexWords[offset + 8 + component] = gxGpuColorPlane[GX_GPU_COLOR_COMPONENTS * 2 + component];
	}
	return offset + GX_GPU_FIXED_SOLID_VERTEX_FLOATS;
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
	let offset = vertexFloatCount;
	offset = writeFixedSolidVertex(offset, x0, y0);
	offset = writeFixedSolidVertex(offset, x1, y1);
	offset = writeFixedSolidVertex(offset, x2, y2);
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
	const sizeWord = commandBuffer.words[wordStart + 2];
	const width = gxGpuFillWidth(sizeWord);
	const height = gxGpuFillHeight(sizeWord);
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	if (width === 0 || height === 0) {
		return vertexFloatCount;
	}
	let y = gxGpuTransferY(xyWord, vramYAddressExtensionWord);
	let remainingHeight = height;
	let offset = vertexFloatCount;
	while (remainingHeight !== 0) {
		const rowHeight = gxGpuVramWrappedHeight(y, remainingHeight, vramYAddressExtensionWord);
		let x = gxGpuFillX(xyWord);
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(x, remainingWidth);
			offset = appendSolidQuad(offset, x, y, colorWord, x, y + rowHeight, colorWord, x + runWidth, y, colorWord, x + runWidth, y + rowHeight, colorWord);
			x = (x + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			remainingWidth -= runWidth;
		}
		y = gxGpuVramYAddress(y + rowHeight, vramYAddressExtensionWord);
		remainingHeight -= rowHeight;
	}
	return offset;
}

function appendSolidPolygon(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	if (gxGpuCommandTextureEnabled(opcode)) return vertexFloatCount;
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const words = commandBuffer.words;
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dx = gxGpuSigned11(drawingOffsetWord);
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const gouraud = gxGpuCommandGouraud(opcode);
	if (gouraud) {
		const color0 = words[wordStart];
		const xy0 = words[wordStart + 1];
		const color1 = words[wordStart + 2];
		const xy1 = words[wordStart + 3];
		const color2 = words[wordStart + 4];
		const xy2 = words[wordStart + 5];
		let offset = appendFixedSolidPrimitiveTriangle(vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const color3 = words[wordStart + 6];
			const xy3 = words[wordStart + 7];
			offset = appendFixedSolidPrimitiveTriangle(offset, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3);
		}
		return offset;
	}
	const color = words[wordStart];
	const xy0 = words[wordStart + 1];
	const xy1 = words[wordStart + 2];
	const xy2 = words[wordStart + 3];
	let offset = appendSolidPrimitiveTriangle(vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color);
	if (gxGpuCommandQuadPolygon(opcode)) {
		const xy3 = words[wordStart + 4];
		offset = appendSolidPrimitiveTriangle(offset, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color);
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
	if (gxGpuCommandTextureEnabled(opcode)) {
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
	if (x0 > x1) {
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

function writeTexturedVertex(offset: number, x: number, y: number, colorWord: number): number {
	gxGpuTexturedVertices[offset] = x;
	gxGpuTexturedVertices[offset + 1] = y;
	gxGpuTexturedVertices[offset + 2] = (colorWord & 0xff) / 255;
	gxGpuTexturedVertices[offset + 3] = ((colorWord >>> 8) & 0xff) / 255;
	gxGpuTexturedVertices[offset + 4] = ((colorWord >>> 16) & 0xff) / 255;
	return offset + GX_GPU_TEXTURED_VERTEX_FLOATS;
}

function prepareTexturedUvPlane(
	determinant: number,
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
): void {
	gxGpuTexturedUvPlane[0] = u0;
	gxGpuTexturedUvPlane[1] = v0;
	gxGpuTexturedUvPlane[2] = u1;
	gxGpuTexturedUvPlane[3] = v1;
	gxGpuTexturedUvPlane[4] = u2;
	gxGpuTexturedUvPlane[5] = v2;
	gxGpuTriangleAttributePlane(gxGpuTexturedUvPlane, 0, GX_GPU_TEXTURED_UV_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
}

function appendTexturedTriangle(
	vertexFloatCount: number,
	determinant: number,
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
	prepareTexturedUvPlane(determinant, x0, y0, u0, v0, x1, y1, u1, v1, x2, y2, u2, v2);
	let offset = vertexFloatCount;
	offset = writeTexturedVertex(offset, x0, y0, color0);
	offset = writeTexturedVertex(offset, x1, y1, color1);
	offset = writeTexturedVertex(offset, x2, y2, color2);
	for (let vertexOffset = vertexFloatCount; vertexOffset < offset; vertexOffset += GX_GPU_TEXTURED_VERTEX_FLOATS) {
		gxGpuTexturedVertexWords[vertexOffset + 5] = gxGpuTexturedUvPlane[0];
		gxGpuTexturedVertexWords[vertexOffset + 6] = gxGpuTexturedUvPlane[1];
		gxGpuTexturedVertexWords[vertexOffset + 7] = gxGpuTexturedUvPlane[2];
		gxGpuTexturedVertexWords[vertexOffset + 8] = gxGpuTexturedUvPlane[3];
		gxGpuTexturedVertexWords[vertexOffset + 9] = gxGpuTexturedUvPlane[4];
		gxGpuTexturedVertexWords[vertexOffset + 10] = gxGpuTexturedUvPlane[5];
	}
	return offset;
}

function writeFixedTexturedVertex(offset: number, x: number, y: number): number {
	gxGpuTexturedVertices[offset] = x;
	gxGpuTexturedVertices[offset + 1] = y;
	for (let component = 0; component < GX_GPU_TEXTURED_UV_COMPONENTS; component += 1) {
		gxGpuTexturedVertexWords[offset + 2 + component] = gxGpuTexturedUvPlane[component];
		gxGpuTexturedVertexWords[offset + 4 + component] = gxGpuTexturedUvPlane[GX_GPU_TEXTURED_UV_COMPONENTS + component];
		gxGpuTexturedVertexWords[offset + 6 + component] = gxGpuTexturedUvPlane[GX_GPU_TEXTURED_UV_COMPONENTS * 2 + component];
	}
	for (let component = 0; component < GX_GPU_COLOR_COMPONENTS; component += 1) {
		gxGpuTexturedVertexWords[offset + 8 + component] = gxGpuColorPlane[component];
		gxGpuTexturedVertexWords[offset + 11 + component] = gxGpuColorPlane[GX_GPU_COLOR_COMPONENTS + component];
		gxGpuTexturedVertexWords[offset + 14 + component] = gxGpuColorPlane[GX_GPU_COLOR_COMPONENTS * 2 + component];
	}
	return offset + GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS;
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
	if (fixedColor) {
		prepareTexturedUvPlane(determinant, x0, y0, u0, v0, x1, y1, u1, v1, x2, y2, u2, v2);
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
		let offset = vertexFloatCount;
		offset = writeFixedTexturedVertex(offset, x0, y0);
		offset = writeFixedTexturedVertex(offset, x1, y1);
		offset = writeFixedTexturedVertex(offset, x2, y2);
		return offset;
	}
	return appendTexturedTriangle(vertexFloatCount, determinant, x0, y0, color0, u0, v0, x1, y1, color1, u1, v1, x2, y2, color2, u2, v2);
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
	const determinant = rect.width * rect.height;
	let offset = vertexFloatCount;
	offset = appendTexturedTriangle(offset, determinant, rect.x0, rect.y0, colorWord, u0, v0, rect.x1, rect.y0, colorWord, u1, v0, rect.x0, rect.y1, colorWord, u0, v1);
	offset = appendTexturedTriangle(offset, determinant, rect.x0, rect.y1, colorWord, u0, v1, rect.x1, rect.y0, colorWord, u1, v0, rect.x1, rect.y1, colorWord, u1, v1);
	return offset;
}


function writeTransferVertex(vertices: Float32Array, offset: number, vertexFloatStride: number, x: number, y: number, sourceOffsetX: number, sourceOffsetY: number): number {
	vertices[offset] = x;
	vertices[offset + 1] = y;
	vertices[offset + 2] = sourceOffsetX;
	vertices[offset + 3] = sourceOffsetY;
	return offset + vertexFloatStride;
}

function appendTransferTriangle(
	vertexFloatCount: number,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	sourceOffsetX: number,
	sourceOffsetY: number,
): number {
	let offset = vertexFloatCount;
	offset = writeTransferVertex(gxGpuTransferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x0, y0, sourceOffsetX, sourceOffsetY);
	offset = writeTransferVertex(gxGpuTransferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x1, y1, sourceOffsetX, sourceOffsetY);
	offset = writeTransferVertex(gxGpuTransferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x2, y2, sourceOffsetX, sourceOffsetY);
	return offset;
}

function appendTransferQuad(vertexFloatCount: number, x: number, y: number, width: number, height: number, u: number, v: number): number {
	const x1 = x + width;
	const y1 = y + height;
	const sourceOffsetX = u - x;
	const sourceOffsetY = v - y;
	let offset = vertexFloatCount;
	offset = appendTransferTriangle(offset, x, y, x1, y, x, y1, sourceOffsetX, sourceOffsetY);
	offset = appendTransferTriangle(offset, x, y1, x1, y, x1, y1, sourceOffsetX, sourceOffsetY);
	return offset;
}

function writeVramSnapshotUpload(snapshotBytes: Uint8Array): void {
	for (let logicalY = 0; logicalY < GX_GPU_VRAM_HEIGHT; logicalY += 1) {
		let uploadByteOffset = logicalY * GX_GPU_VRAM_WIDTH * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
		let snapshotByteOffset = logicalY * GX_GPU_VRAM_WIDTH * 2;
		for (let column = 0; column < GX_GPU_VRAM_WIDTH; column += 1) {
			gxGpuVramSnapshotUpload[uploadByteOffset] = snapshotBytes[snapshotByteOffset];
			gxGpuVramSnapshotUpload[uploadByteOffset + 1] = snapshotBytes[snapshotByteOffset + 1];
			gxGpuVramSnapshotUpload[uploadByteOffset + 2] = 0;
			gxGpuVramSnapshotUpload[uploadByteOffset + 3] = 0xff;
			uploadByteOffset += GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
			snapshotByteOffset += 2;
		}
	}
}

function uploadGxGpuVramSnapshot(snapshotBytes: Uint8Array): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	writeVramSnapshotUpload(snapshotBytes);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	backend.setActiveTexture(GX_GPU_SCANOUT_TEXTURE_UNIT);
	backend.bindTexture2D(gxGpuState.vramTexture);
	gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, gxGpuVramSnapshotUpload, 0);
	gxGpuSampleDirtyRect.left = 0;
	gxGpuSampleDirtyRect.top = 0;
	gxGpuSampleDirtyRect.right = GX_GPU_VRAM_WIDTH;
	gxGpuSampleDirtyRect.bottom = GX_GPU_VRAM_HEIGHT;
}

function uploadCpuToVramPayload(commandBuffer: GxGpuCommandBufferView, payloadWordStart: number, pixelCount: number): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	const fullRows = pixelCount >>> 10;
	const lastRowWidth = pixelCount & (GX_GPU_VRAM_WIDTH - 1);
	let sourceByteOffset = payloadWordStart * 4;
	backend.setActiveTexture(GX_GPU_TEXTURE_TRANSFER_UNIT);
	backend.bindTexture2D(gxGpuState.cpuUploadTexture);
	if (fullRows !== 0) {
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, GX_GPU_VRAM_WIDTH, fullRows, gl.RG, gl.UNSIGNED_BYTE, commandBuffer.wordBytes, sourceByteOffset);
		sourceByteOffset += fullRows * GX_GPU_VRAM_WIDTH * GX_GPU_CPU_UPLOAD_BYTES_PER_PIXEL;
	}
	if (lastRowWidth !== 0) {
		gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, fullRows, lastRowWidth, 1, gl.RG, gl.UNSIGNED_BYTE, commandBuffer.wordBytes, sourceByteOffset);
	}
}

function appendCpuToVramRows(
	x: number,
	y: number,
	sourceRowStart: number,
	rowWidth: number,
	rowCount: number,
	transferVertexFloatCount: number,
	vramYAddressExtensionWord: number,
): number {
	let targetY = gxGpuVramYAddress(y + sourceRowStart, vramYAddressExtensionWord);
	let remainingRows = rowCount;
	while (remainingRows !== 0) {
		const runHeight = gxGpuVramWrappedHeight(targetY, remainingRows, vramYAddressExtensionWord);
		let targetRunX = x;
		let remainingWidth = rowWidth;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(targetRunX, remainingWidth);
			transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, targetRunX, targetY, runWidth, runHeight, targetRunX, targetY);
			remainingWidth -= runWidth;
			targetRunX = (targetRunX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
		}
		remainingRows -= runHeight;
		targetY = gxGpuVramYAddress(targetY + runHeight, vramYAddressExtensionWord);
	}
	return transferVertexFloatCount;
}

function uploadCpuToVram(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + 2];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const x = gxGpuTransferX(xyWord);
	const y = gxGpuTransferY(xyWord, vramYAddressExtensionWord);
	const width = gxGpuTransferWidth(sizeWord);
	const height = gxGpuTransferHeight(sizeWord);
	const uploadedPixels = gxGpuTransferEmittedPixelCount(width, height, commandBuffer.commandWordCount[commandIndex]);
	const fullRows = (uploadedPixels - (uploadedPixels % width)) / width;
	const lastRowWidth = uploadedPixels % width;
	const uploadHeight = fullRows + (lastRowWidth !== 0 ? 1 : 0);
	const payloadWordStart = wordStart + 3;
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	let transferVertexFloatCount = 0;

	uploadCpuToVramPayload(commandBuffer, payloadWordStart, uploadedPixels);
	if (fullRows !== 0) {
		transferVertexFloatCount = appendCpuToVramRows(x, y, 0, width, fullRows, transferVertexFloatCount, vramYAddressExtensionWord);
	}
	if (lastRowWidth !== 0) {
		transferVertexFloatCount = appendCpuToVramRows(x, y, fullRows, lastRowWidth, 1, transferVertexFloatCount, vramYAddressExtensionWord);
	}
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
		syncGxGpuSampleTextureLogicalArea(x, y, width, uploadHeight, vramYAddressExtensionWord);
	}
	if (transferVertexFloatCount !== 0) {
		gxGpuState.backend.useProgram(gxGpuState.cpuUploadProgram.program);
		gxGpuState.gl.uniform4ui(gxGpuState.cpuUploadUniform, x, y, width, gxGpuVramYAddressMask(vramYAddressExtensionWord) + 1);
		renderTransferCommands(transferVertexFloatCount, gxGpuState.cpuUploadTexture, GX_GPU_TEXTURE_TRANSFER_UNIT, maskBitModeWord, gxGpuState.cpuUploadProgram);
	}
	if (fullRows !== 0) {
		markGxGpuSampleTextureDirtyLogicalArea(x, y, width, fullRows, vramYAddressExtensionWord);
	}
	if (lastRowWidth !== 0) {
		markGxGpuSampleTextureDirtyLogicalArea(x, y + fullRows, lastRowWidth, 1, vramYAddressExtensionWord);
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
	vramYAddressExtensionWord: number,
): void {
	let transferVertexFloatCount = 0;
	let runSourceY = gxGpuVramYAddress(sourceY, vramYAddressExtensionWord);
	let runTargetY = gxGpuVramYAddress(targetY, vramYAddressExtensionWord);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const sourceRunHeight = gxGpuVramWrappedHeight(runSourceY, remainingHeight, vramYAddressExtensionWord);
		const targetRunHeight = gxGpuVramWrappedHeight(runTargetY, remainingHeight, vramYAddressExtensionWord);
		const runHeight = sourceRunHeight < targetRunHeight ? sourceRunHeight : targetRunHeight;
		syncGxGpuSampleTextureLogicalArea(sourceX, runSourceY, width, runHeight, vramYAddressExtensionWord);
		if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) syncGxGpuSampleTextureLogicalArea(targetX, runTargetY, width, runHeight, vramYAddressExtensionWord);
		runSourceY = gxGpuVramYAddress(runSourceY + runHeight, vramYAddressExtensionWord);
		runTargetY = gxGpuVramYAddress(runTargetY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
	runSourceY = gxGpuVramYAddress(sourceY, vramYAddressExtensionWord);
	runTargetY = gxGpuVramYAddress(targetY, vramYAddressExtensionWord);
	remainingHeight = height;
	while (remainingHeight !== 0) {
		const sourceRunHeight = gxGpuVramWrappedHeight(runSourceY, remainingHeight, vramYAddressExtensionWord);
		const targetRunHeight = gxGpuVramWrappedHeight(runTargetY, remainingHeight, vramYAddressExtensionWord);
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
		runSourceY = gxGpuVramYAddress(runSourceY + runHeight, vramYAddressExtensionWord);
		runTargetY = gxGpuVramYAddress(runTargetY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
	if (transferVertexFloatCount !== 0) {
		gxGpuState.backend.useProgram(gxGpuState.transferProgram.program);
		renderTransferCommands(transferVertexFloatCount, gxGpuState.vramSampleTexture, GX_GPU_TEXTURE_SAMPLE_UNIT, maskBitModeWord, gxGpuState.transferProgram);
	}
	markGxGpuSampleTextureDirtyLogicalArea(targetX, targetY, width, height, vramYAddressExtensionWord);
}

function copyVramToVram(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const sourceWord = commandBuffer.words[wordStart + 1];
	const targetWord = commandBuffer.words[wordStart + 2];
	const sizeWord = commandBuffer.words[wordStart + 3];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const sourceX = gxGpuTransferX(sourceWord);
	const sourceY = gxGpuTransferY(sourceWord, vramYAddressExtensionWord);
	const targetX = gxGpuTransferX(targetWord);
	const targetY = gxGpuTransferY(targetWord, vramYAddressExtensionWord);
	const width = gxGpuTransferWidth(sizeWord);
	const height = gxGpuTransferHeight(sizeWord);
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	if (gxGpuVramCopyNeedsChunking(sourceX, sourceY, targetX, targetY, width, height)) {
		const chunkHeight = gxGpuVramCopyChunkHeight(sourceY, targetY, height);
		for (let chunkTargetY = targetY; chunkTargetY < targetY + height; chunkTargetY += chunkHeight) {
			const chunkSourceY = sourceY + (chunkTargetY - targetY);
			const remainingHeight = targetY + height - chunkTargetY;
			const currentChunkHeight = chunkHeight < remainingHeight ? chunkHeight : remainingHeight;
			copyVramToVramArea(sourceX, chunkSourceY, targetX, chunkTargetY, width, currentChunkHeight, maskBitModeWord, vramYAddressExtensionWord);
		}
		return;
	}
	copyVramToVramArea(sourceX, sourceY, targetX, targetY, width, height, maskBitModeWord, vramYAddressExtensionWord);
}

function drawGxGpuLogicalVramArea(
	rect: GxGpuVramCopyRect,
	firstVertex: number,
	vertexCount: number,
	vramYAddressExtensionWord: number,
): void {
	const gl = gxGpuState.gl;
	if (rect.right <= rect.left || rect.bottom <= rect.top) return;
	gl.enable(gl.SCISSOR_TEST);
	const width = rect.right - rect.left;
	gl.scissor(rect.left, rect.top, width, rect.bottom - rect.top);
	gl.drawArrays(gl.TRIANGLES, firstVertex, vertexCount);
	markGxGpuSampleTextureDirtyLogicalArea(rect.left, rect.top, width, rect.bottom - rect.top, vramYAddressExtensionWord);
}

function resetGxGpuVramCopyRect(rect: GxGpuVramCopyRect): void {
	rect.left = GX_GPU_VRAM_WIDTH;
	rect.top = GX_GPU_VRAM_Y_ADDRESS_PERIOD;
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
	if (target.right <= target.left || target.bottom <= target.top) {
		target.left = source.left;
		target.top = source.top;
		target.right = source.right;
		target.bottom = source.bottom;
		return;
	}
	if (source.right <= source.left || source.bottom <= source.top) {
		return;
	}
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

function gxGpuVramCopyRectsOverlap(a: GxGpuVramCopyRect, b: GxGpuVramCopyRect, vramYAddressExtensionWord: number): boolean {
	if (a.right <= a.left || a.bottom <= a.top) {
		return false;
	}
	return gxGpuVramLogicalAreaOverlapsBounds(
		a.left,
		a.top,
		a.right - a.left,
		a.bottom - a.top,
		b.left,
		b.top,
		b.right,
		b.bottom,
		vramYAddressExtensionWord,
	);
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

function markGxGpuSampleTextureDirtyLogicalArea(x: number, y: number, width: number, height: number, vramYAddressExtensionWord: number): void {
	let rowY = gxGpuVramYAddress(y, vramYAddressExtensionWord);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight, vramYAddressExtensionWord);
		let columnX = x & (GX_GPU_VRAM_WIDTH - 1);
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			markGxGpuSampleTextureDirtyArea(columnX, rowY, columnX + runWidth, rowY + runHeight);
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			remainingWidth -= runWidth;
		}
		rowY = gxGpuVramYAddress(rowY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
}

function copyGxGpuVramAreaToSampleTexture(left: number, top: number, right: number, bottom: number): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	if (right <= left || bottom <= top) {
		return;
	}
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuState.vramFramebuffer);
	backend.setViewportRect(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(gxGpuState.vramSampleTexture);
	gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, left, top, left, top, right - left, bottom - top);
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

function syncGxGpuSampleTextureLogicalArea(x: number, y: number, width: number, height: number, vramYAddressExtensionWord: number): void {
	let rowY = gxGpuVramYAddress(y, vramYAddressExtensionWord);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight, vramYAddressExtensionWord);
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
		rowY = gxGpuVramYAddress(rowY + runHeight, vramYAddressExtensionWord);
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
	vramYAddressExtensionWord: number,
): void {
	resetGxGpuVramCopyRect(rect);
	for (let offset = vertexFloatStart; offset < vertexFloatEnd; offset += vertexFloatStride) {
		includeGxGpuVramCopyVertex(rect, vertices[offset], vertices[offset + 1]);
	}
	const drawingLeft = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const drawingTop = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	const drawingRight = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const drawingBottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	const left = rect.left > drawingLeft ? rect.left : drawingLeft;
	const top = rect.top > drawingTop ? rect.top : drawingTop;
	const right = rect.right < drawingRight ? rect.right : drawingRight;
	const bottom = rect.bottom < drawingBottom ? rect.bottom : drawingBottom;
	rect.left = left;
	rect.top = top;
	rect.right = right > left ? right : left;
	rect.bottom = bottom > top ? bottom : top;
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
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const textureMode = gxGpuDrawModeTextureMode(drawModeWord);
	const pageX = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	const pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord, vramYAddressExtensionWord);
	const rect = gxGpuVramCopyRectScratch;
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
	resetGxGpuVramCopyRect(rect);
	for (let offset = vertexFloatStart; offset < vertexFloatEnd; offset += vertexFloatStride) {
		const x = gxGpuTexturedVertices[offset];
		const y = gxGpuTexturedVertices[offset + 1];
		const planeOffset = fixedColor ? 2 : 5;
		const u = ((gxGpuTexturedVertexWords[offset + planeOffset] + gxGpuTexturedVertexWords[offset + planeOffset + 2] * x + gxGpuTexturedVertexWords[offset + planeOffset + 4] * y) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
		const v = ((gxGpuTexturedVertexWords[offset + planeOffset + 1] + gxGpuTexturedVertexWords[offset + planeOffset + 3] * x + gxGpuTexturedVertexWords[offset + planeOffset + 5] * y) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
		includeGxGpuVramCopyVertex(rect, u, v);
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
	if (gxGpuVramLogicalAreaOverlapsBounds(sourceX, sourceY, sourceWidth, sourceHeight, commandRect.left, commandRect.top, commandRect.right, commandRect.bottom, vramYAddressExtensionWord)) overlaps |= GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP;
	if (gxGpuVramLogicalAreaOverlapsBounds(sourceX, sourceY, sourceWidth, sourceHeight, batchRect.left, batchRect.top, batchRect.right, batchRect.bottom, vramYAddressExtensionWord)) overlaps |= GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP;
	syncGxGpuSampleTextureLogicalArea(sourceX, sourceY, sourceWidth, sourceHeight, vramYAddressExtensionWord);
	if (textureMode < 2) {
		const clutX = gxGpuTextureClutBaseX(textureWord);
		const clutY = gxGpuTextureClutBaseY(textureWord, vramYAddressExtensionWord);
		const clutWidth = textureMode === 0 ? GX_GPU_CLUT_4BIT_WORDS : GX_GPU_CLUT_8BIT_WORDS;
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1, commandRect.left, commandRect.top, commandRect.right, commandRect.bottom, vramYAddressExtensionWord)) overlaps |= GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP;
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1, batchRect.left, batchRect.top, batchRect.right, batchRect.bottom, vramYAddressExtensionWord)) overlaps |= GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP;
		syncGxGpuSampleTextureLogicalArea(clutX, clutY, clutWidth, 1, vramYAddressExtensionWord);
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
	skippedLineParityUniform: WebGLUniformLocation,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
	ditherEnabled: boolean,
	skippedLineParity: number,
): void {
	const gl = gxGpuState.gl;
	gl.uniform1i(vramUniform, GX_GPU_TEXTURE_SAMPLE_UNIT);
	gl.uniform1ui(blendEnableUniform, blendEnabled ? 1 : 0);
	gl.uniform1ui(blendModeUniform, blendMode);
	gl.uniform1ui(checkMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	gl.uniform1ui(setMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
	gl.uniform1ui(ditherEnableUniform, ditherEnabled ? 1 : 0);
	gl.uniform1ui(skippedLineParityUniform, skippedLineParity);
}

function writeTexturedUniforms(commandBuffer: GxGpuCommandBufferView, commandIndex: number, fixedColor: boolean): void {
	const gl = gxGpuState.gl;
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const textureWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2];
	const textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const texturePageY = gxGpuDrawModeTexturePageBaseY(drawModeWord, vramYAddressExtensionWord);
	const clutY = gxGpuTextureClutBaseY(textureWord, vramYAddressExtensionWord);
	gl.uniform1i(fixedColor ? gxGpuState.fixedTexturedVramUniform : gxGpuState.texturedVramUniform, GX_GPU_TEXTURE_SAMPLE_UNIT);
	gl.uniform2ui(fixedColor ? gxGpuState.fixedTexturedTexPageBaseUniform : gxGpuState.texturedTexPageBaseUniform, gxGpuDrawModeTexturePageBaseX(drawModeWord), texturePageY);
	gl.uniform2ui(fixedColor ? gxGpuState.fixedTexturedClutBaseUniform : gxGpuState.texturedClutBaseUniform, gxGpuTextureClutBaseX(textureWord), clutY);
	gl.uniform2ui(fixedColor ? gxGpuState.fixedTexturedTextureWindowAndUniform : gxGpuState.texturedTextureWindowAndUniform, gxGpuTextureWindowAndX(textureWindowWord), gxGpuTextureWindowAndY(textureWindowWord));
	gl.uniform2ui(fixedColor ? gxGpuState.fixedTexturedTextureWindowOrUniform : gxGpuState.texturedTextureWindowOrUniform, gxGpuTextureWindowOrX(textureWindowWord), gxGpuTextureWindowOrY(textureWindowWord));
	gl.uniform1ui(fixedColor ? gxGpuState.fixedTexturedTextureModeUniform : gxGpuState.texturedTextureModeUniform, gxGpuDrawModeTextureMode(drawModeWord));
	gl.uniform1ui(fixedColor ? gxGpuState.fixedTexturedRawTextureUniform : gxGpuState.texturedRawTextureUniform, gxGpuCommandRawTextureEnabled(opcode) ? 1 : 0);
	gl.uniform1ui(fixedColor ? gxGpuState.fixedTexturedBlendEnableUniform : gxGpuState.texturedBlendEnableUniform, gxGpuCommandSemiTransparencyEnabled(opcode) ? 1 : 0);
	gl.uniform1ui(fixedColor ? gxGpuState.fixedTexturedBlendModeUniform : gxGpuState.texturedBlendModeUniform, gxGpuDrawModeTransparencyMode(drawModeWord));
	gl.uniform1ui(fixedColor ? gxGpuState.fixedTexturedCheckMaskBitUniform : gxGpuState.texturedCheckMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	gl.uniform1ui(fixedColor ? gxGpuState.fixedTexturedSetMaskBitUniform : gxGpuState.texturedSetMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
	gl.uniform1ui(fixedColor ? gxGpuState.fixedTexturedDitherEnableUniform : gxGpuState.texturedDitherEnableUniform, commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode) ? 1 : 0);
	gl.uniform1ui(fixedColor ? gxGpuState.fixedTexturedSkippedLineParityUniform : gxGpuState.texturedSkippedLineParityUniform, commandBuffer.commandSkippedLineParity[commandIndex]);
	gl.uniform1f(
		fixedColor ? gxGpuState.fixedTexturedRasterPhaseUniform : gxGpuState.texturedRasterPhaseUniform,
		commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON ? 0.5 : 0,
	);
}

function writeTransferUniforms(program: GxGpuTransferProgram, sourceTextureUnit: number, maskBitModeWord: number): void {
	const gl = gxGpuState.gl;
	gl.uniform1i(program.sourceUniform, sourceTextureUnit);
	gl.uniform1i(program.vramUniform, GX_GPU_TEXTURE_SAMPLE_UNIT);
	gl.uniform1ui(program.checkMaskBitUniform, gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0);
	gl.uniform1ui(program.setMaskBitUniform, gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0);
}

function flushSolidCommands(
	vertexFloatCount: number,
	fixedColor: boolean,
	vramYAddressExtensionWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
	ditherEnabled: boolean,
	skippedLineParity: number,
	readsVram: boolean,
	rasterKind: GxGpuRasterKind,
	batchRect: GxGpuVramCopyRect,
): number {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	if (vertexFloatCount !== 0) {
		if (readsVram) {
			syncGxGpuSampleTextureLogicalArea(batchRect.left, batchRect.top, batchRect.right - batchRect.left, batchRect.bottom - batchRect.top, vramYAddressExtensionWord);
		}
		const vertices = gxGpuSolidVertices;
		const vertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
		backend.bindArrayBuffer(gxGpuState.solidVertexBuffer);
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices, 0, vertexFloatCount);
		renderNewSolidCommands(fixedColor, 0, vertexFloatCount / vertexFloatStride, batchRect, vramYAddressExtensionWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity, rasterKind);
	}
	return 0;
}

function finishSolidBatch(
	vertexFloatCount: number,
	fixedColor: boolean,
	vramYAddressExtensionWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
	ditherEnabled: boolean,
	skippedLineParity: number,
	readsVram: boolean,
	rasterKind: GxGpuRasterKind,
): number {
	flushSolidCommands(vertexFloatCount, fixedColor, vramYAddressExtensionWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity, readsVram, rasterKind, gxGpuSolidBatchRect);
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
	drawBounds: GxGpuVramCopyRect,
	vramYAddressExtensionWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
	ditherEnabled: boolean,
	skippedLineParity: number,
): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	backend.bindArrayBuffer(gxGpuState.lineVertexBuffer);
	gl.bufferSubData(gl.ARRAY_BUFFER, 0, gxGpuLineVertices, 0, vertexFloatCount);
	beginGxGpuVramRenderTarget();
	backend.useProgram(gxGpuState.lineProgram);
	writePrimitiveUniforms(
		gxGpuState.lineVramUniform,
		gxGpuState.lineBlendEnableUniform,
		gxGpuState.lineBlendModeUniform,
		gxGpuState.lineCheckMaskBitUniform,
		gxGpuState.lineSetMaskBitUniform,
		gxGpuState.lineDitherEnableUniform,
		gxGpuState.lineSkippedLineParityUniform,
		blendEnabled,
		blendMode,
		maskBitModeWord,
		ditherEnabled,
		skippedLineParity,
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
	drawGxGpuLogicalVramArea(
		drawBounds,
		0,
		vertexFloatCount / GX_GPU_LINE_VERTEX_FLOATS,
		vramYAddressExtensionWord,
	);
	gl.disable(gl.SCISSOR_TEST);
}

function flushLineCommands(vertexFloatCount: number): number {
	if (vertexFloatCount !== 0) {
		if (gxGpuLineBatchState.readsVram) {
			syncGxGpuSampleTextureLogicalArea(
				gxGpuLineBatchRect.left,
				gxGpuLineBatchRect.top,
				gxGpuLineBatchRect.right - gxGpuLineBatchRect.left,
				gxGpuLineBatchRect.bottom - gxGpuLineBatchRect.top,
				gxGpuLineBatchState.vramYAddressExtensionWord,
			);
		}
		renderNewLineCommands(vertexFloatCount, gxGpuLineBatchRect, gxGpuLineBatchState.vramYAddressExtensionWord, gxGpuLineBatchState.blendEnabled, gxGpuLineBatchState.blendMode, gxGpuLineBatchState.maskBitModeWord, gxGpuLineBatchState.ditherEnabled, gxGpuLineBatchState.skippedLineParity);
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
	if (offset !== commandVertexStart) {
		setGxGpuVertexBoundsRect(
			gxGpuLineCommandRect,
			gxGpuLineVertices,
			commandVertexStart,
			offset,
			GX_GPU_LINE_VERTEX_FLOATS,
			gxGpuLineBatchState.topLeftWord,
			gxGpuLineBatchState.bottomRightWord,
			gxGpuLineBatchState.vramYAddressExtensionWord,
		);
		if (gxGpuLineBatchState.readsVram && commandVertexStart !== 0 && gxGpuVramCopyRectsOverlap(gxGpuLineBatchRect, gxGpuLineCommandRect, gxGpuLineBatchState.vramYAddressExtensionWord)) {
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
				gxGpuLineBatchState.vramYAddressExtensionWord,
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

function executeNewGxGpuCommands(commandBuffer: GxGpuCommandBufferView, commandLimit: number): void {
	let commandIndex = gxGpuState.processedCommandCount;
	const commandKindWords = commandBuffer.commandKind;
	const commandDrawingAreaTopLeftWords = commandBuffer.commandDrawingAreaTopLeftWord;
	const commandDrawingAreaBottomRightWords = commandBuffer.commandDrawingAreaBottomRightWord;
	const commandSkippedLineParities = commandBuffer.commandSkippedLineParity;
	let vertexFloatCount = 0;
	let solidBatchTopLeftWord = GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD;
	let solidBatchBottomRightWord = GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD;
	let solidBatchVramYAddressExtensionWord = 0;
	let solidBatchMaskBitModeWord = 0;
	let solidBatchDitherEnabled = false;
	let solidBatchSkippedLineParity = GX_GPU_SKIPPED_LINE_NONE;
	let solidBatchBlendEnabled = false;
	let solidBatchBlendMode = 0;
	let solidBatchReadsVram = false;
	let solidBatchFixedColor = false;
	let solidBatchRasterKind = GxGpuRasterKind.Rectangle;
	let texturedVertexFloatCount = 0;
	let texturedBatchCommandIndex = 0;
	let lineVertexFloatCount = 0;
	resetGxGpuVramCopyRect(gxGpuSolidBatchRect);
	resetGxGpuVramCopyRect(gxGpuTexturedBatchRect);
	resetGxGpuVramCopyRect(gxGpuLineBatchRect);
	for (; commandIndex < commandLimit; commandIndex += 1) {
		const commandKind = commandKindWords[commandIndex];
		const commandDrawsTexture = (commandKind === GX_GPU_COMMAND_DRAW_POLYGON || commandKind === GX_GPU_COMMAND_DRAW_RECTANGLE)
			&& gxGpuCommandTextureEnabled(commandBuffer.commandOpcode[commandIndex]);
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
				const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
				const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
				const drawsTexture = commandDrawsTexture;
				const ditherEnabled = commandKindWords[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode);
				const skippedLineParity = commandSkippedLineParities[commandIndex];
				const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
				const blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0;
				const readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
				const fixedColor = commandKind === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuCommandGouraud(opcode);
				const rasterKind = commandKind === GX_GPU_COMMAND_DRAW_POLYGON
					? GxGpuRasterKind.Polygon
					: GxGpuRasterKind.Rectangle;
				const splitReadVramQuad = readsVram
					&& commandKindWords[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
					&& gxGpuCommandQuadPolygon(opcode);
				const batchMaskChange = maskBitModeWord !== solidBatchMaskBitModeWord;
				const batchStateChanged = topLeftWord !== solidBatchTopLeftWord
					|| bottomRightWord !== solidBatchBottomRightWord
					|| vramYAddressExtensionWord !== solidBatchVramYAddressExtensionWord
					|| batchMaskChange
					|| solidBatchDitherEnabled !== ditherEnabled
					|| solidBatchSkippedLineParity !== skippedLineParity
					|| solidBatchBlendEnabled !== blendEnabled
					|| solidBatchBlendMode !== blendMode
					|| solidBatchReadsVram !== readsVram
					|| solidBatchFixedColor !== fixedColor
					|| solidBatchRasterKind !== rasterKind;
				if (vertexFloatCount !== 0 && (batchStateChanged || drawsTexture || splitReadVramQuad)) {
					vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchFixedColor, solidBatchVramYAddressExtensionWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
				}
				solidBatchTopLeftWord = topLeftWord;
				solidBatchBottomRightWord = bottomRightWord;
				solidBatchVramYAddressExtensionWord = vramYAddressExtensionWord;
				solidBatchMaskBitModeWord = maskBitModeWord;
				solidBatchDitherEnabled = ditherEnabled;
				solidBatchSkippedLineParity = skippedLineParity;
				solidBatchBlendEnabled = blendEnabled;
				solidBatchBlendMode = blendMode;
				solidBatchReadsVram = readsVram;
				solidBatchFixedColor = fixedColor;
				solidBatchRasterKind = rasterKind;
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
							|| vramYAddressExtensionWord !== commandBuffer.commandVramYAddressExtensionWord[texturedBatchCommandIndex]
							|| commandKind !== commandKindWords[texturedBatchCommandIndex]
							|| drawModeWord !== batchDrawModeWord
							|| commandBuffer.commandTextureWindowWord[commandIndex] !== commandBuffer.commandTextureWindowWord[texturedBatchCommandIndex]
							|| maskBitModeWord !== commandBuffer.commandMaskBitModeWord[texturedBatchCommandIndex]
							|| skippedLineParity !== commandSkippedLineParities[texturedBatchCommandIndex]
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
						setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, texturedVertices, texturedCommandVertexStart, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
						let sourceOverlaps = syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, texturedCommandVertexStart, texturedVertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, texturedFixedColor);
						if ((sourceOverlaps & GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP) !== 0) {
							texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedCommandVertexStart, texturedBatchCommandIndex);
							texturedBatchCommandIndex = commandIndex;
							texturedCommandVertexStart = 0;
							texturedVertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, 0);
							setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, texturedVertices, 0, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
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
					if (vertexFloatCount !== commandVertexStart) {
						setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, solidVertices, commandVertexStart, vertexFloatCount, solidVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
						if (splitReadVramQuad && vertexFloatCount === solidTriangleFloatCount * 2) {
							renderReadVramSolidQuad(fixedColor, topLeftWord, bottomRightWord, vramYAddressExtensionWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity);
							vertexFloatCount = 0;
						} else {
							if (readsVram && commandVertexStart !== 0 && gxGpuVramCopyRectsOverlap(gxGpuSolidBatchRect, gxGpuSolidCommandRect, vramYAddressExtensionWord)) {
								vertexFloatCount = finishSolidBatch(commandVertexStart, solidBatchFixedColor, solidBatchVramYAddressExtensionWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
								vertexFloatCount = appendSolidCommandVertices(commandBuffer, commandIndex, vertexFloatCount);
								setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, solidVertices, 0, vertexFloatCount, solidVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
							}
							includeGxGpuVramCopyRect(gxGpuSolidBatchRect, gxGpuSolidCommandRect);
						}
					}
				}
				break;
			}
			case GX_GPU_COMMAND_FILL_RECTANGLE: {
				const topLeftWord = GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD;
				const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
				const bottomRightWord = GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD;
				const skippedLineParity = commandSkippedLineParities[commandIndex];
				const batchMaskChange = gxGpuMaskBitSetWhileDrawing(solidBatchMaskBitModeWord);
				if (vertexFloatCount !== 0 && (solidBatchTopLeftWord !== topLeftWord || solidBatchBottomRightWord !== bottomRightWord || solidBatchVramYAddressExtensionWord !== vramYAddressExtensionWord || batchMaskChange || solidBatchDitherEnabled || solidBatchSkippedLineParity !== skippedLineParity || solidBatchBlendEnabled || solidBatchReadsVram || solidBatchFixedColor || solidBatchRasterKind !== GxGpuRasterKind.Rectangle)) {
					vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchFixedColor, solidBatchVramYAddressExtensionWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
				}
				solidBatchTopLeftWord = topLeftWord;
				solidBatchBottomRightWord = bottomRightWord;
				solidBatchVramYAddressExtensionWord = vramYAddressExtensionWord;
				solidBatchMaskBitModeWord = 0;
				solidBatchDitherEnabled = false;
				solidBatchSkippedLineParity = skippedLineParity;
				solidBatchBlendEnabled = false;
				solidBatchBlendMode = 0;
				solidBatchReadsVram = false;
				solidBatchFixedColor = false;
				solidBatchRasterKind = GxGpuRasterKind.Rectangle;
				const commandVertexStart = vertexFloatCount;
				vertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
				if (vertexFloatCount !== commandVertexStart) {
					setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, gxGpuSolidVertices, commandVertexStart, vertexFloatCount, GX_GPU_SOLID_VERTEX_FLOATS, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
					includeGxGpuVramCopyRect(gxGpuSolidBatchRect, gxGpuSolidCommandRect);
				}
				break;
			}
			case GX_GPU_COMMAND_DRAW_LINE:
			case GX_GPU_COMMAND_DRAW_POLYLINE: {
				vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchFixedColor, solidBatchVramYAddressExtensionWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
				const opcode = commandBuffer.commandOpcode[commandIndex];
				const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
				const topLeftWord = commandDrawingAreaTopLeftWords[commandIndex];
				const bottomRightWord = commandDrawingAreaBottomRightWords[commandIndex];
				const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
				const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
				const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
				const blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0;
				const ditherEnabled = gxGpuDrawModeDitherEnabled(drawModeWord);
				const skippedLineParity = commandSkippedLineParities[commandIndex];
				const readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
				if (lineVertexFloatCount !== 0 && (topLeftWord !== gxGpuLineBatchState.topLeftWord
					|| bottomRightWord !== gxGpuLineBatchState.bottomRightWord
					|| vramYAddressExtensionWord !== gxGpuLineBatchState.vramYAddressExtensionWord
					|| maskBitModeWord !== gxGpuLineBatchState.maskBitModeWord
					|| ditherEnabled !== gxGpuLineBatchState.ditherEnabled
					|| skippedLineParity !== gxGpuLineBatchState.skippedLineParity
					|| blendEnabled !== gxGpuLineBatchState.blendEnabled
					|| blendMode !== gxGpuLineBatchState.blendMode
					|| readsVram !== gxGpuLineBatchState.readsVram)) {
					lineVertexFloatCount = flushLineCommands(lineVertexFloatCount);
				}
				gxGpuLineBatchState.topLeftWord = topLeftWord;
				gxGpuLineBatchState.bottomRightWord = bottomRightWord;
				gxGpuLineBatchState.vramYAddressExtensionWord = vramYAddressExtensionWord;
				gxGpuLineBatchState.maskBitModeWord = maskBitModeWord;
				gxGpuLineBatchState.ditherEnabled = ditherEnabled;
				gxGpuLineBatchState.skippedLineParity = skippedLineParity;
				gxGpuLineBatchState.blendEnabled = blendEnabled;
				gxGpuLineBatchState.blendMode = blendMode;
				gxGpuLineBatchState.readsVram = readsVram;
				lineVertexFloatCount = appendLineCommandVertices(commandBuffer, commandIndex, lineVertexFloatCount);
				break;
			}
			case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
				vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchFixedColor, solidBatchVramYAddressExtensionWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
				copyVramToVram(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
				vertexFloatCount = finishSolidBatch(vertexFloatCount, solidBatchFixedColor, solidBatchVramYAddressExtensionWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
				uploadCpuToVram(commandBuffer, commandIndex);
				break;
		}
	}
	if (gxGpuState.processedCommandCount < commandLimit) {
		gxGpuState.processedCommandCount = commandLimit;
	}
	finishSolidBatch(vertexFloatCount, solidBatchFixedColor, solidBatchVramYAddressExtensionWord, solidBatchBlendEnabled, solidBatchBlendMode, solidBatchMaskBitModeWord, solidBatchDitherEnabled, solidBatchSkippedLineParity, solidBatchReadsVram, solidBatchRasterKind);
	flushTexturedCommands(commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
	flushLineCommands(lineVertexFloatCount);
}

function renderNewSolidCommands(
	fixedColor: boolean,
	firstVertex: number,
	vertexCount: number,
	drawBounds: GxGpuVramCopyRect,
	vramYAddressExtensionWord: number,
	blendEnabled: boolean,
	blendMode: number,
	maskBitModeWord: number,
	ditherEnabled: boolean,
	skippedLineParity: number,
	rasterKind: GxGpuRasterKind,
): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	beginGxGpuVramRenderTarget();
	backend.useProgram(fixedColor ? gxGpuState.fixedSolidProgram : gxGpuState.solidProgram);
	gl.uniform1f(fixedColor ? gxGpuState.fixedSolidRasterPhaseUniform : gxGpuState.solidRasterPhaseUniform, rasterKind === GxGpuRasterKind.Polygon ? 0.5 : 0);
	writePrimitiveUniforms(
		fixedColor ? gxGpuState.fixedSolidVramUniform : gxGpuState.solidVramUniform,
		fixedColor ? gxGpuState.fixedSolidBlendEnableUniform : gxGpuState.solidBlendEnableUniform,
		fixedColor ? gxGpuState.fixedSolidBlendModeUniform : gxGpuState.solidBlendModeUniform,
		fixedColor ? gxGpuState.fixedSolidCheckMaskBitUniform : gxGpuState.solidCheckMaskBitUniform,
		fixedColor ? gxGpuState.fixedSolidSetMaskBitUniform : gxGpuState.solidSetMaskBitUniform,
		fixedColor ? gxGpuState.fixedSolidDitherEnableUniform : gxGpuState.solidDitherEnableUniform,
		fixedColor ? gxGpuState.fixedSolidSkippedLineParityUniform : gxGpuState.solidSkippedLineParityUniform,
		blendEnabled,
		blendMode,
		maskBitModeWord,
		ditherEnabled,
		skippedLineParity,
	);
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(gxGpuState.vramSampleTexture);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuState.solidVertexBuffer);
	if (fixedColor) {
		const vertexStrideBytes = GX_GPU_FIXED_SOLID_VERTEX_FLOATS * 4;
		gl.enableVertexAttribArray(gxGpuState.fixedSolidPositionAttrib);
		gl.vertexAttribPointer(gxGpuState.fixedSolidPositionAttrib, 2, gl.FLOAT, false, vertexStrideBytes, 0);
		gl.enableVertexAttribArray(gxGpuState.fixedSolidColorPlaneBaseAttrib);
		gl.vertexAttribIPointer(gxGpuState.fixedSolidColorPlaneBaseAttrib, 3, gl.UNSIGNED_INT, vertexStrideBytes, 2 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedSolidColorPlaneStepXAttrib);
		gl.vertexAttribIPointer(gxGpuState.fixedSolidColorPlaneStepXAttrib, 3, gl.UNSIGNED_INT, vertexStrideBytes, 5 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedSolidColorPlaneStepYAttrib);
		gl.vertexAttribIPointer(gxGpuState.fixedSolidColorPlaneStepYAttrib, 3, gl.UNSIGNED_INT, vertexStrideBytes, 8 * 4);
	} else {
		const vertexStrideBytes = GX_GPU_SOLID_VERTEX_FLOATS * 4;
		gl.enableVertexAttribArray(gxGpuState.solidPositionAttrib);
		gl.vertexAttribPointer(gxGpuState.solidPositionAttrib, 2, gl.FLOAT, false, vertexStrideBytes, 0);
		gl.enableVertexAttribArray(gxGpuState.solidColorAttrib);
		gl.vertexAttribPointer(gxGpuState.solidColorAttrib, 4, gl.FLOAT, false, vertexStrideBytes, 2 * 4);
	}
	drawGxGpuLogicalVramArea(
		drawBounds,
		firstVertex,
		vertexCount,
		vramYAddressExtensionWord,
	);
	gl.disable(gl.SCISSOR_TEST);
}

function renderReadVramSolidQuad(fixedColor: boolean, topLeftWord: number, bottomRightWord: number, vramYAddressExtensionWord: number, blendEnabled: boolean, blendMode: number, maskBitModeWord: number, ditherEnabled: boolean, skippedLineParity: number): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	const vertices = gxGpuSolidVertices;
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
	const triangleFloatCount = fixedColor ? GX_GPU_FIXED_SOLID_TRIANGLE_FLOATS : GX_GPU_SOLID_TRIANGLE_FLOATS;
	backend.bindArrayBuffer(gxGpuState.solidVertexBuffer);
	gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices, 0, triangleFloatCount * 2);
	setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, vertices, 0, triangleFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	syncGxGpuSampleTextureLogicalArea(gxGpuSolidCommandRect.left, gxGpuSolidCommandRect.top, gxGpuSolidCommandRect.right - gxGpuSolidCommandRect.left, gxGpuSolidCommandRect.bottom - gxGpuSolidCommandRect.top, vramYAddressExtensionWord);
	renderNewSolidCommands(fixedColor, 0, 3, gxGpuSolidCommandRect, vramYAddressExtensionWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity, GxGpuRasterKind.Polygon);
	setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, vertices, triangleFloatCount, triangleFloatCount * 2, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	syncGxGpuSampleTextureLogicalArea(gxGpuSolidCommandRect.left, gxGpuSolidCommandRect.top, gxGpuSolidCommandRect.right - gxGpuSolidCommandRect.left, gxGpuSolidCommandRect.bottom - gxGpuSolidCommandRect.top, vramYAddressExtensionWord);
	renderNewSolidCommands(fixedColor, 3, 3, gxGpuSolidCommandRect, vramYAddressExtensionWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity, GxGpuRasterKind.Polygon);
}

function renderTransferCommands(
	vertexFloatCount: number,
	sourceTexture: WebGLTexture,
	sourceTextureUnit: number,
	maskBitModeWord: number,
	program: GxGpuTransferProgram,
): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	backend.bindArrayBuffer(gxGpuState.transferVertexBuffer);
	gl.bufferSubData(gl.ARRAY_BUFFER, 0, gxGpuTransferVertices, 0, vertexFloatCount);
	beginGxGpuVramRenderTarget();
	gl.disable(gl.SCISSOR_TEST);
	writeTransferUniforms(program, sourceTextureUnit, maskBitModeWord);
	backend.setActiveTexture(sourceTextureUnit);
	backend.bindTexture2D(sourceTexture);
	backend.setActiveTexture(GX_GPU_TEXTURE_SAMPLE_UNIT);
	backend.bindTexture2D(gxGpuState.vramSampleTexture);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuState.transferVertexBuffer);
	gl.enableVertexAttribArray(program.positionAttrib);
	gl.vertexAttribPointer(program.positionAttrib, 2, gl.FLOAT, false, GX_GPU_TRANSFER_VERTEX_FLOATS * 4, 0);
	gl.enableVertexAttribArray(program.sourceOffsetAttrib);
	gl.vertexAttribPointer(program.sourceOffsetAttrib, 2, gl.FLOAT, false, GX_GPU_TRANSFER_VERTEX_FLOATS * 4, 2 * 4);
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
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
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
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedUvPlaneBaseAttrib);
		gl.vertexAttribIPointer(gxGpuState.fixedTexturedUvPlaneBaseAttrib, 2, gl.UNSIGNED_INT, vertexStrideBytes, 2 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedUvPlaneStepXAttrib);
		gl.vertexAttribIPointer(gxGpuState.fixedTexturedUvPlaneStepXAttrib, 2, gl.UNSIGNED_INT, vertexStrideBytes, 4 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedUvPlaneStepYAttrib);
		gl.vertexAttribIPointer(gxGpuState.fixedTexturedUvPlaneStepYAttrib, 2, gl.UNSIGNED_INT, vertexStrideBytes, 6 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedColorPlaneBaseAttrib);
		gl.vertexAttribIPointer(gxGpuState.fixedTexturedColorPlaneBaseAttrib, 3, gl.UNSIGNED_INT, vertexStrideBytes, 8 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedColorPlaneStepXAttrib);
		gl.vertexAttribIPointer(gxGpuState.fixedTexturedColorPlaneStepXAttrib, 3, gl.UNSIGNED_INT, vertexStrideBytes, 11 * 4);
		gl.enableVertexAttribArray(gxGpuState.fixedTexturedColorPlaneStepYAttrib);
		gl.vertexAttribIPointer(gxGpuState.fixedTexturedColorPlaneStepYAttrib, 3, gl.UNSIGNED_INT, vertexStrideBytes, 14 * 4);
	} else {
		gl.enableVertexAttribArray(gxGpuState.texturedPositionAttrib);
		gl.vertexAttribPointer(gxGpuState.texturedPositionAttrib, 2, gl.FLOAT, false, vertexStrideBytes, 0);
		gl.enableVertexAttribArray(gxGpuState.texturedColorAttrib);
		gl.vertexAttribPointer(gxGpuState.texturedColorAttrib, 3, gl.FLOAT, false, vertexStrideBytes, 2 * 4);
		gl.enableVertexAttribArray(gxGpuState.texturedUvPlaneBaseAttrib);
		gl.vertexAttribIPointer(gxGpuState.texturedUvPlaneBaseAttrib, 2, gl.UNSIGNED_INT, vertexStrideBytes, 5 * 4);
		gl.enableVertexAttribArray(gxGpuState.texturedUvPlaneStepXAttrib);
		gl.vertexAttribIPointer(gxGpuState.texturedUvPlaneStepXAttrib, 2, gl.UNSIGNED_INT, vertexStrideBytes, 7 * 4);
		gl.enableVertexAttribArray(gxGpuState.texturedUvPlaneStepYAttrib);
		gl.vertexAttribIPointer(gxGpuState.texturedUvPlaneStepYAttrib, 2, gl.UNSIGNED_INT, vertexStrideBytes, 9 * 4);
	}
	if (!splitTriangles) {
		drawGxGpuLogicalVramArea(
			gxGpuTexturedCommandRect,
			0,
			vertexFloatCount / vertexFloatStride,
			vramYAddressExtensionWord,
		);
	} else {
		const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
		const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
		const triangleFloatCount = 3 * vertexFloatStride;
		for (let vertexFloatStart = 0; vertexFloatStart < vertexFloatCount; vertexFloatStart += triangleFloatCount) {
			if (vertexFloatStart !== 0 && syncSourceBetweenTriangles) syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, 0, vertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, fixedColor);
			const vertexFloatEnd = vertexFloatStart + triangleFloatCount;
			setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, vertices, vertexFloatStart, vertexFloatEnd, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
			if (readsVram && vertexFloatStart !== 0) syncGxGpuSampleTextureLogicalArea(
				gxGpuVramCopyRectScratch.left,
				gxGpuVramCopyRectScratch.top,
				gxGpuVramCopyRectScratch.right - gxGpuVramCopyRectScratch.left,
				gxGpuVramCopyRectScratch.bottom - gxGpuVramCopyRectScratch.top,
				vramYAddressExtensionWord,
			);
			drawGxGpuLogicalVramArea(
				gxGpuVramCopyRectScratch,
				vertexFloatStart / vertexFloatStride,
				3,
				vramYAddressExtensionWord,
			);
		}
	}
	gl.disable(gl.SCISSOR_TEST);
}

function renderTexturedCommand(commandBuffer: GxGpuCommandBufferView, commandIndex: number, topLeftWord: number, bottomRightWord: number): void {
	const vertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, 0);
	if (vertexFloatCount === 0) return;
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const fixedColor = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
		&& gxGpuCommandGouraud(opcode)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	const vertices = gxGpuTexturedVertices;
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
	setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, vertices, 0, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	const sourceOverlaps = syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, 0, vertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, fixedColor);
	const sourceOverlapsDestination = (sourceOverlaps & GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP) !== 0;
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	if (readsVram) {
		syncGxGpuSampleTextureLogicalArea(gxGpuTexturedCommandRect.left, gxGpuTexturedCommandRect.top, gxGpuTexturedCommandRect.right - gxGpuTexturedCommandRect.left, gxGpuTexturedCommandRect.bottom - gxGpuTexturedCommandRect.top, vramYAddressExtensionWord);
	}
	renderTexturedVertices(
		commandBuffer,
		commandIndex,
		vertexFloatCount,
		topLeftWord,
		bottomRightWord,
		commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON,
		sourceOverlapsDestination,
	);
}

function flushTexturedCommands(commandBuffer: GxGpuCommandBufferView, vertexFloatCount: number, batchCommandIndex: number): number {
	if (vertexFloatCount !== 0) {
		const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[batchCommandIndex];
		const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[batchCommandIndex];
		const opcode = commandBuffer.commandOpcode[batchCommandIndex];
		const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[batchCommandIndex];
		const fixedColor = commandBuffer.commandKind[batchCommandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
			&& gxGpuCommandGouraud(opcode)
			&& !gxGpuCommandRawTextureEnabled(opcode);
		const vertices = gxGpuTexturedVertices;
		const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
		setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, vertices, 0, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
		const maskBitModeWord = commandBuffer.commandMaskBitModeWord[batchCommandIndex];
		const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
		if (readsVram) syncGxGpuSampleTextureLogicalArea(gxGpuTexturedCommandRect.left, gxGpuTexturedCommandRect.top, gxGpuTexturedCommandRect.right - gxGpuTexturedCommandRect.left, gxGpuTexturedCommandRect.bottom - gxGpuTexturedCommandRect.top, vramYAddressExtensionWord);
		renderTexturedVertices(commandBuffer, batchCommandIndex, vertexFloatCount, topLeftWord, bottomRightWord, readsVram, false);
	}
	resetGxGpuVramCopyRect(gxGpuTexturedBatchRect);
	return 0;
}

function writeGxGpuScanoutCircuitUniforms(
	words: Uint32Array,
	scanout: GxGpuPcrtcScanout,
	circuit: GxGpuPcrtcCircuit,
): void {
	words[0] = circuit.framebufferBaseWord;
	words[1] = circuit.framebufferWidth;
	words[2] = circuit.framebufferPagesPerRow;
	words[3] = circuit.framebufferX;
	words[4] = circuit.framebufferY;
	words[5] = circuit.displayX;
	words[6] = circuit.displayY;
	words[7] = circuit.fieldSourceDivisionMultiplierY;
	words[8] = circuit.sourcePhaseX;
	words[9] = circuit.fieldSourcePhase;
	words[10] = circuit.sourceStepX;
	words[11] = circuit.fieldSourceStride;
	words[12] = circuit.sourceDivisionMultiplierX;
	words[13] = scanout.outputHeight;
	words[14] = circuit.fieldDisplayY;
	words[15] = circuit.linearFieldSourceY;
	words[16] = circuit.linearFieldSourceRowStep;
}

function prepareGxGpuScanoutCircuitUniforms(scanout: GxGpuPcrtcScanout): void {
	if (!gxGpuState.scanoutFixedStateValid || gxGpuState.scanoutFixedStateRevision !== scanout.revision) {
		gxGpuState.scanoutBackgroundRed = (scanout.backgroundColor & 0xff) / 255;
		gxGpuState.scanoutBackgroundGreen = (scanout.backgroundColor >>> 8 & 0xff) / 255;
		gxGpuState.scanoutBackgroundBlue = (scanout.backgroundColor >>> 16 & 0xff) / 255;
		gxGpuState.scanoutBlendAlpha = scanout.blendAlpha / 255;
		gxGpuState.scanoutFixedStateRevision = scanout.revision;
		gxGpuState.scanoutFixedStateValid = true;
	}
	const field = scanout.interlaced ? scanout.field : -1;
	if (gxGpuState.scanoutCircuitUniformValid
		&& gxGpuState.scanoutCircuitUniformRevision === scanout.revision
		&& gxGpuState.scanoutCircuitUniformField === field) return;
	writeGxGpuScanoutCircuitUniforms(gxGpuState.scanoutCircuitUniforms[0], scanout, scanout.circuits[0]);
	writeGxGpuScanoutCircuitUniforms(gxGpuState.scanoutCircuitUniforms[1], scanout, scanout.circuits[1]);
	gxGpuState.backend.updateUniformBuffer(gxGpuState.scanoutCircuitUniformBuffer, gxGpuState.scanoutCircuitUniformUpload);
	gxGpuState.scanoutCircuitUniformRevision = scanout.revision;
	gxGpuState.scanoutCircuitUniformField = field;
	gxGpuState.scanoutCircuitUniformValid = true;
}

function drawGxGpuScanoutPass(
	state: RenderPassStateRegistry['gx_gpu'],
	circuitIndex: number,
	drawPath: number,
	fieldProgram: boolean,
): void {
	if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_NONE) return;
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	const scanout = state.pcrtcScanout;
	const circuit = scanout.circuits[circuitIndex]!;
	let programIndex = circuit.samplePath;
	if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB) {
		programIndex += GX_GPU_SCANOUT_DOUBLE_ALPHA_PROGRAM_BASE;
	}
	const programs = fieldProgram ? gxGpuState.scanoutFieldPrograms : gxGpuState.scanoutPrograms;
	backend.useProgram(programs[programIndex]!);
	if (fieldProgram
		&& (gxGpuState.scanoutFieldUniformFields[programIndex] !== scanout.field
			|| gxGpuState.scanoutFieldUniformRevisions[programIndex] !== scanout.revision)) {
		gl.uniform4ui(
			gxGpuState.scanoutFieldInterlaceUniforms[programIndex]!,
			scanout.fieldHeight,
			scanout.outputHeight,
			scanout.field,
			scanout.fieldOffset,
		);
		gxGpuState.scanoutFieldUniformFields[programIndex] = scanout.field;
		gxGpuState.scanoutFieldUniformRevisions[programIndex] = scanout.revision;
	}
	if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB) {
		backend.setBlendEnabled(false);
		gl.colorMask(true, true, true, false);
	} else if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
		backend.setBlendEnabled(false);
		gl.colorMask(true, true, true, true);
	} else if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA) {
		backend.setBlendEnabled(false);
		gl.colorMask(false, false, false, true);
	} else if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB) {
		backend.setBlendEnabled(true);
		backend.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
		gl.colorMask(true, true, true, false);
	} else if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB) {
		backend.setBlendEnabled(true);
		gl.blendColor(0, 0, 0, gxGpuState.scanoutBlendAlpha);
		backend.setBlendFunc(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA);
		gl.colorMask(true, true, true, false);
	} else if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA) {
		backend.setBlendEnabled(true);
		gl.blendColor(0, 0, 0, gxGpuState.scanoutBlendAlpha);
		backend.setBlendFuncSeparate(gl.CONSTANT_ALPHA, gl.ONE_MINUS_CONSTANT_ALPHA, gl.ONE, gl.ZERO);
		gl.colorMask(true, true, true, true);
	}
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function drawGxGpuScanoutCircuit(
	state: RenderPassStateRegistry['gx_gpu'],
	circuitIndex: number,
	drawPath: number,
	fieldProgram: boolean,
): void {
	if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_NONE) return;
	const gl = gxGpuState.gl;
	const scanout = state.pcrtcScanout;
	const circuit = scanout.circuits[circuitIndex]!;
	gxGpuState.backend.bindUniformBufferRange(
		GX_GPU_SCANOUT_CIRCUIT_UNIFORM_BINDING,
		gxGpuState.scanoutCircuitUniformBuffer,
		circuitIndex * gxGpuState.scanoutCircuitUniformSlotBytes,
		gxGpuState.scanoutCircuitUniformSlotBytes,
	);
	if (fieldProgram) {
		gl.scissor(
			circuit.displayX,
			scanout.fieldOffset + scanout.fieldHeight
				- circuit.fieldDisplayLineStart - circuit.fieldDisplayLineCount,
			circuit.displayWidth,
			circuit.fieldDisplayLineCount,
		);
	} else {
		gl.scissor(
			circuit.displayX,
			scanout.outputHeight - circuit.displayBottom,
			circuit.displayWidth,
			circuit.displayHeight,
		);
	}
	if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGBA) {
		drawGxGpuScanoutPass(
			state, circuitIndex, GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB, fieldProgram,
		);
		drawGxGpuScanoutPass(
			state, circuitIndex, GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA, fieldProgram,
		);
		return;
	}
	drawGxGpuScanoutPass(state, circuitIndex, drawPath, fieldProgram);
}

function prepareGxGpuScanoutDraw(): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	gl.disable(gl.SCISSOR_TEST);
	backend.setDepthTestEnabled(false);
	backend.setDepthMask(false);
	backend.setCullEnabled(false);
	backend.setBlendEnabled(false);
	gl.colorMask(true, true, true, true);
	backend.setActiveTexture(GX_GPU_SCANOUT_TEXTURE_UNIT);
	backend.bindTexture2D(gxGpuState.vramTexture);
	backend.bindVertexArray(null);
	backend.bindArrayBuffer(gxGpuState.scanoutVertexBuffer);
	gl.enableVertexAttribArray(GX_GPU_SCANOUT_POSITION_ATTRIB);
	gl.vertexAttribPointer(
		GX_GPU_SCANOUT_POSITION_ATTRIB, 2, gl.FLOAT, false, GX_GPU_SCANOUT_VERTEX_FLOATS * 4, 0,
	);
}

function scanoutProgressiveGxGpuVram(fbo: WebGLFramebuffer, state: RenderPassStateRegistry['gx_gpu']): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	const scanout = state.pcrtcScanout;
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	backend.setViewportRect(0, 0, state.width, state.height);
	prepareGxGpuScanoutDraw();
	if (scanout.backgroundRequired !== 0) {
		gl.clearColor(
			gxGpuState.scanoutBackgroundRed,
			gxGpuState.scanoutBackgroundGreen,
			gxGpuState.scanoutBackgroundBlue,
			0,
		);
		gl.clear(gl.COLOR_BUFFER_BIT);
	}
	gl.enable(gl.SCISSOR_TEST);
	drawGxGpuScanoutCircuit(state, 1, scanout.circuit2OutputPath, false);
	drawGxGpuScanoutCircuit(state, 0, scanout.circuit1OutputPath, false);
	gl.disable(gl.SCISSOR_TEST);
	backend.setBlendEnabled(false);
	gl.colorMask(true, true, true, true);
}

function scanoutInterlacedGxGpuVram(fbo: WebGLFramebuffer, state: RenderPassStateRegistry['gx_gpu']): void {
	const backend = gxGpuState.backend;
	const gl = gxGpuState.gl;
	const scanout = state.pcrtcScanout;
	const width = state.width;
	const height = state.height;
	const fieldHeight = scanout.fieldHeight;
	const fieldOffset = scanout.fieldOffset;
	const sizeChanged = gxGpuState.scanoutFieldsWidth !== width || gxGpuState.scanoutFieldsHeight !== height;
	const invalid = !gxGpuState.scanoutFieldsValid
		|| sizeChanged
		|| gxGpuState.scanoutFieldsVramReplacementSerial !== state.vramReplacementSerial;
	if (sizeChanged) {
		backend.setActiveTexture(GX_GPU_SCANOUT_FIELDS_TEXTURE_UNIT);
		backend.bindTexture2D(gxGpuState.scanoutFieldsTexture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
	}

	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuState.scanoutFieldsFramebuffer);
	backend.setViewportRect(0, fieldOffset, width, fieldHeight);
	prepareGxGpuScanoutDraw();
	if (invalid || scanout.backgroundRequired !== 0) {
		gl.clearColor(
			gxGpuState.scanoutBackgroundRed,
			gxGpuState.scanoutBackgroundGreen,
			gxGpuState.scanoutBackgroundBlue,
			0,
		);
	}
	if (invalid) {
		gl.clear(gl.COLOR_BUFFER_BIT);
	}
	if (scanout.backgroundRequired !== 0 && !invalid) {
		gl.enable(gl.SCISSOR_TEST);
		gl.scissor(0, fieldOffset, width, fieldHeight);
		gl.clear(gl.COLOR_BUFFER_BIT);
	} else {
		gl.enable(gl.SCISSOR_TEST);
	}
	drawGxGpuScanoutCircuit(state, 1, scanout.circuit2OutputPath, true);
	drawGxGpuScanoutCircuit(state, 0, scanout.circuit1OutputPath, true);
	gxGpuState.scanoutFieldsWidth = width;
	gxGpuState.scanoutFieldsHeight = height;
	gxGpuState.scanoutFieldsValid = true;
	gxGpuState.scanoutFieldsVramReplacementSerial = state.vramReplacementSerial;

	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	backend.setViewportRect(0, 0, width, height);
	gl.disable(gl.SCISSOR_TEST);
	backend.setBlendEnabled(false);
	gl.colorMask(true, true, true, true);
	backend.useProgram(gxGpuState.scanoutWeaveProgram);
	if (sizeChanged) {
		gl.uniform4ui(
			gxGpuState.scanoutWeaveInterlaceUniform,
			scanout.evenFieldHeight,
			height,
			width,
			scanout.oddFieldHeight,
		);
	}
	backend.setActiveTexture(GX_GPU_SCANOUT_FIELDS_TEXTURE_UNIT);
	backend.bindTexture2D(gxGpuState.scanoutFieldsTexture);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
}

function scanoutGxGpuVram(fbo: WebGLFramebuffer, state: RenderPassStateRegistry['gx_gpu']): void {
	prepareGxGpuScanoutCircuitUniforms(state.pcrtcScanout);
	if (state.pcrtcScanout.interlaced) {
		scanoutInterlacedGxGpuVram(fbo, state);
		return;
	}
	gxGpuState.scanoutFieldsValid = false;
	scanoutProgressiveGxGpuVram(fbo, state);
}

export function executeGxGpuVramCommands(source: GxGpuVramSource, commandLimit: number): void {
	const commandBuffer = source.commandBuffer;
	const commandSerial = commandBuffer.serial;
	if (gxGpuState.vramSnapshotSerial !== source.vramSnapshotSerial) {
		uploadGxGpuVramSnapshot(source.vramSnapshotBytes);
		gxGpuState.processedCommandCount = 0;
		gxGpuState.processedCommandSerial = commandSerial;
		gxGpuState.vramSnapshotSerial = source.vramSnapshotSerial;
	} else if (gxGpuState.processedCommandSerial !== commandSerial) {
		gxGpuState.processedCommandCount = 0;
		gxGpuState.processedCommandSerial = commandSerial;
	}
	executeNewGxGpuCommands(commandBuffer, commandLimit);
	completeGxGpuReadback(commandLimit, source.readbackPort);
}

function completeGxGpuReadback(commandLimit: number, readback: GxGpuVramSource['readbackPort']): void {
	if (!readback.claimReadback(commandLimit)) {
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
	gl.uniform4ui(gxGpuState.readbackParamsUniform, readback.x, readback.y, readback.width, packedWidth);
	gl.uniform1ui(gxGpuState.readbackVramYAddressExtensionUniform, readback.vramYAddressExtensionWord);
	gxGpuState.backend.setActiveTexture(GX_GPU_SCANOUT_TEXTURE_UNIT);
	gxGpuState.backend.bindTexture2D(gxGpuState.vramTexture);
	gxGpuState.backend.bindVertexArray(null);
	gxGpuState.backend.bindArrayBuffer(gxGpuState.scanoutVertexBuffer);
	gl.enableVertexAttribArray(GX_GPU_SCANOUT_POSITION_ATTRIB);
	gl.vertexAttribPointer(GX_GPU_SCANOUT_POSITION_ATTRIB, 2, gl.FLOAT, false, GX_GPU_SCANOUT_VERTEX_FLOATS * 4, 0);
	gl.drawArrays(gl.TRIANGLES, 0, 3);
	gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
	gl.readPixels(0, 0, packedWidth, packedHeight, gl.RGBA, gl.UNSIGNED_BYTE, readback.pixelBytes);
	readback.completeReadback(readbackToken);
}

export function captureRenderedVramSnapshot(gxGpu: GxGpu, output: GxGpuVramSource): void {
	executeGxGpuVramCommands(output, output.commandBuffer.executedCommandCount);
	const gl = gxGpuState.gl;
	gl.bindFramebuffer(gl.FRAMEBUFFER, gxGpuState.vramFramebuffer);
	gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
	gl.readPixels(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, gxGpuRawVramReadback);
	let snapshotByteOffset = 0;
	for (let logicalY = 0; logicalY < GX_GPU_VRAM_HEIGHT; logicalY += 1) {
		let readbackByteOffset = logicalY * GX_GPU_VRAM_WIDTH * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
		for (let column = 0; column < GX_GPU_VRAM_WIDTH; column += 1) {
			gxGpuVramSnapshotScratch[snapshotByteOffset] = gxGpuRawVramReadback[readbackByteOffset];
			gxGpuVramSnapshotScratch[snapshotByteOffset + 1] = gxGpuRawVramReadback[readbackByteOffset + 1];
			snapshotByteOffset += 2;
			readbackByteOffset += GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
		}
	}
	gxGpuState.vramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(gxGpuVramSnapshotScratch, gxGpuState.processedCommandCount);
}

function renderGxGpuPass(fbo: WebGLFramebuffer, state: RenderPassStateRegistry['gx_gpu']): void {
	executeGxGpuVramCommands(state, state.commandBuffer.presentCommandCount);
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
	state.vramYAddressExtensionWord = ctx.view.gxGpuVramYAddressExtensionWord;
	state.pcrtcScanout = ctx.view.gxGpuPcrtcScanout;
	state.vramSnapshotBytes = ctx.view.gxGpuVramSnapshotBytes;
	state.vramSnapshotSerial = ctx.view.gxGpuVramSnapshotSerial;
	state.vramReplacementSerial = ctx.view.gxGpuVramReplacementSerial;
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
		vramYAddressExtensionWord: registry.view.gxGpuVramYAddressExtensionWord,
		pcrtcScanout: registry.view.gxGpuPcrtcScanout,
		vramSnapshotBytes: registry.view.gxGpuVramSnapshotBytes,
		vramSnapshotSerial: registry.view.gxGpuVramSnapshotSerial,
		vramReplacementSerial: registry.view.gxGpuVramReplacementSerial,
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
