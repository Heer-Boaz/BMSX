import {
	GX_GPU_STATUS_DISPLAY_DISABLE,
	type GxGpu,
} from '../../../machine/devices/gx/gpu';
import type { GxGpuDeviceOutput } from '../../../machine/devices/gx/device_output';
import {
	GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
	GX_GPU_COMMAND_DRAW_LINE,
	GX_GPU_COMMAND_DRAW_POLYGON,
	GX_GPU_COMMAND_DRAW_POLYLINE,
	GX_GPU_COMMAND_DRAW_RECTANGLE,
	GX_GPU_COMMAND_FILL_RECTANGLE,
	GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
	GX_GPU_COMMAND_CAPACITY,
	GX_GPU_READBACK_PENDING,
	GX_GPU_READBACK_SUBMITTED,
	GX_GPU_VRAM_BYTE_COUNT,
	GX_GPU_VRAM_HEIGHT,
	GX_GPU_VRAM_WIDTH,
	gxGpuDisplayStartY,
	gxGpuTransferHeight,
	gxGpuTransferWidth,
	type GxGpuCommandBufferView,
} from '../../../machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_DISPLAY_MODE_RGB24_BIT,
	GX_GPU_VERTEX_COORD_PERIOD,
	GX_GPU_TRIANGLE_UV_BASE_U,
	GX_GPU_TRIANGLE_UV_BASE_V,
	GX_GPU_TRIANGLE_UV_PLANE_WORDS,
	GX_GPU_TRIANGLE_UV_STEP_X_U,
	GX_GPU_TRIANGLE_UV_STEP_X_V,
	GX_GPU_TRIANGLE_UV_STEP_Y_U,
	GX_GPU_TRIANGLE_UV_STEP_Y_V,
	gxGpuCommandDrawsTexture,
	gxGpuCommandGouraud,
	gxGpuCommandQuadPolygon,
	gxGpuCommandRawTextureEnabled,
	gxGpuCommandRectangleHeight,
	gxGpuCommandRectangleWidth,
	gxGpuCommandSemiTransparencyEnabled,
	gxGpuCommandTextureEnabled,
	gxGpuDitheredPolygon,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuDrawingOffsetY,
	gxGpuDisplayStartX,
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
	gxGpuHorizontalVisibleColumns,
	gxGpuMaskBitCheckBeforeDraw,
	gxGpuMaskBitSetWhileDrawing,
	gxGpuSegmentExceedsPrimitiveSize,
	gxGpuSigned11,
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
	gxGpuTriangleUvPlane,
	gxGpuVertexY,
	gxGpuVerticalVisibleLines,
	gxGpuVramCopyChunkHeight,
	gxGpuVramCopyNeedsChunking,
	gxGpuVramWrappedHeight,
	gxGpuVramWrappedWidth,
} from '../gx_gpu_render_rules';
import type { RenderGraphPassContext, RenderPassStateRegistry } from '../backend';
import type { RenderPassLibrary } from '../pass/library';
import type { WebGPUBackend } from './backend';
import solidShaderCode from './shaders/gx_gpu_solid.wgsl';
import lineShaderCode from './shaders/gx_gpu_line.wgsl';
import texturedShaderCode from './shaders/gx_gpu_textured.wgsl';
import transferShaderCode from './shaders/gx_gpu_transfer.wgsl';
import scanoutShaderCode from './shaders/gx_gpu_scanout.wgsl';
import readbackShaderCode from './shaders/gx_gpu_readback.wgsl';

const GX_GPU_SOLID_VERTEX_FLOATS = 6;
const GX_GPU_SOLID_TRIANGLE_FLOATS = 3 * GX_GPU_SOLID_VERTEX_FLOATS;
const GX_GPU_SOLID_VERTICES_PER_COMMAND = 24;
const GX_GPU_SOLID_FLOAT_CAPACITY = GX_GPU_COMMAND_CAPACITY * GX_GPU_SOLID_VERTICES_PER_COMMAND * GX_GPU_SOLID_VERTEX_FLOATS;
const GX_GPU_LINE_VERTEX_FLOATS = 12;
const GX_GPU_LINE_VERTICES_PER_SEGMENT = 6;
const GX_GPU_LINE_SEGMENT_FLOATS = GX_GPU_LINE_VERTICES_PER_SEGMENT * GX_GPU_LINE_VERTEX_FLOATS;
const GX_GPU_LINE_SEGMENT_CAPACITY = 4096;
const GX_GPU_LINE_FLOAT_CAPACITY = GX_GPU_LINE_SEGMENT_CAPACITY * GX_GPU_LINE_SEGMENT_FLOATS;
const GX_GPU_TEXTURED_VERTEX_FLOATS = 7;
const GX_GPU_TEXTURED_VERTICES_PER_COMMAND = 6;
const GX_GPU_TEXTURED_FLOAT_CAPACITY = GX_GPU_COMMAND_CAPACITY * GX_GPU_TEXTURED_VERTICES_PER_COMMAND * GX_GPU_TEXTURED_VERTEX_FLOATS;
const GX_GPU_TEXTURE_PAGE_COORD_SIZE = 256;
const GX_GPU_TEXTURE_PAGE_4BIT_WIDTH_WORDS = 64;
const GX_GPU_TEXTURE_PAGE_8BIT_WIDTH_WORDS = 128;
const GX_GPU_CLUT_4BIT_WORDS = 16;
const GX_GPU_CLUT_8BIT_WORDS = 256;
const GX_GPU_TRANSFER_VERTEX_FLOATS = 4;
const GX_GPU_TRANSFER_VERTICES_PER_SEGMENT = 6;
const GX_GPU_TRANSFER_SEGMENTS_PER_ROW = 3;
const GX_GPU_TRANSFER_FLOAT_CAPACITY = GX_GPU_VRAM_HEIGHT * GX_GPU_TRANSFER_SEGMENTS_PER_ROW * GX_GPU_TRANSFER_VERTICES_PER_SEGMENT * GX_GPU_TRANSFER_VERTEX_FLOATS;
const GX_GPU_RAW_VRAM_BYTES_PER_PIXEL = 4;
const GX_GPU_UNIFORM_SLOT_BYTES = 256;
const GX_GPU_UNIFORM_BUFFER_BYTES = GX_GPU_COMMAND_CAPACITY * GX_GPU_UNIFORM_SLOT_BYTES;
const GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES = GX_GPU_VRAM_WIDTH * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
const GX_GPU_RAW_VRAM_UPLOAD_BYTES = GX_GPU_VRAM_WIDTH * GX_GPU_VRAM_HEIGHT * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
const GX_GPU_READBACK_PACK_WIDTH = 512;
const GX_GPU_READBACK_UNIFORM_BYTES = 16;
const GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD = 0;
const GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD = (GX_GPU_VRAM_WIDTH - 1) | ((GX_GPU_VRAM_HEIGHT - 1) << 10);

const gxGpuSolidVertices = new Float32Array(GX_GPU_SOLID_FLOAT_CAPACITY);
const gxGpuLineVertices = new Float32Array(GX_GPU_LINE_FLOAT_CAPACITY);
const gxGpuTexturedVertices = new Float32Array(GX_GPU_TEXTURED_FLOAT_CAPACITY);
const gxGpuTexturedUvPlanes = new Float64Array(GX_GPU_TRIANGLE_UV_PLANE_WORDS * 2);
let gxGpuTexturedUvPlaneCount = 0;
const gxGpuTransferVertices = new Float32Array(GX_GPU_TRANSFER_FLOAT_CAPACITY);
const gxGpuRawVramUploadRow = new Uint8Array(GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES);
const gxGpuRawVramUpload = new Uint8Array(GX_GPU_RAW_VRAM_UPLOAD_BYTES);
const gxGpuVramSnapshotScratch = new Uint8Array(GX_GPU_VRAM_BYTE_COUNT);
const primitiveUniformScratch = new Float32Array(8);
const texturedUniformScratch = new Float32Array(32);
const texturedUniformWords = new Uint32Array(texturedUniformScratch.buffer);
const transferUniformScratch = new Float32Array(4);
const scanoutUniformScratch = new Float32Array(8);
const readbackUniformScratch = new Uint32Array(GX_GPU_READBACK_UNIFORM_BYTES >> 2);
const gxGpuDynamicUniformOffsets = new Uint32Array(1);
const GX_GPU_SAMPLE_SOURCE_RECT_CAPACITY = 3;
const GX_GPU_SAMPLE_SOURCE_RECT_WORDS = GX_GPU_SAMPLE_SOURCE_RECT_CAPACITY * 4;
const GX_GPU_SAMPLE_SOURCE_TILE_SHIFT = 6;
const GX_GPU_SAMPLE_SOURCE_TILE_COLUMNS = GX_GPU_VRAM_WIDTH >>> GX_GPU_SAMPLE_SOURCE_TILE_SHIFT;
const gxGpuSampleSourceRects = new Int32Array(GX_GPU_SAMPLE_SOURCE_RECT_WORDS);
const gxGpuSampleSourceCandidateRects = new Int32Array(GX_GPU_SAMPLE_SOURCE_RECT_WORDS);
let gxGpuSampleSourceRectCount = 0;
let gxGpuSampleSourceCandidateRectCount = 0;
let gxGpuSampleSourceRectHash = 0;
let gxGpuSampleSourceCandidateRectHash = 0;
let gxGpuSampleSourceTileMask0 = 0;
let gxGpuSampleSourceTileMask1 = 0;
let gxGpuSampleSourceTileMask2 = 0;
let gxGpuSampleSourceTileMask3 = 0;
let gxGpuSampleSourceCandidateTileMask0 = 0;
let gxGpuSampleSourceCandidateTileMask1 = 0;
let gxGpuSampleSourceCandidateTileMask2 = 0;
let gxGpuSampleSourceCandidateTileMask3 = 0;


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

type GxGpuVramSource = Pick<GxGpuDeviceOutput, 'commandBuffer' | 'readbackPort' | 'vramSnapshotBytes' | 'vramSnapshotSerial'>;

type WebGpuGxGpuState = {
	backend: WebGPUBackend;
	activeEncoder?: GPUCommandEncoder;
	submitCommandBuffers: GPUCommandBuffer[];
	vramDrawPassDescriptor: GPURenderPassDescriptor;
	vramClearPassDescriptor: GPURenderPassDescriptor;
	scanoutPassDescriptor: GPURenderPassDescriptor;
	scanoutColorAttachment: GPURenderPassColorAttachment;
	vramCopySource: GPUTexelCopyTextureInfo;
	vramCopySourceOrigin: GPUOrigin3DDict;
	vramCopyDestination: GPUTexelCopyTextureInfo;
	vramCopyDestinationOrigin: GPUOrigin3DDict;
	vramCopyExtent: GPUExtent3DDict;
	vramUploadDestination: GPUTexelCopyTextureInfo;
	vramUploadDestinationOrigin: GPUOrigin3DDict;
	vramUploadLayout: GPUTexelCopyBufferLayout;
	vramUploadExtent: GPUExtent3DDict;
	vramReadbackBuffer: GPUBuffer;
	vramReadbackSource: GPUTexelCopyTextureInfo;
	vramReadbackDestination: GPUTexelCopyBufferInfo;
	vramReadbackExtent: GPUExtent3DDict;
	gpureadBuffer: GPUBuffer;
	gpureadTexture: GPUTexture;
	gpureadPassDescriptor: GPURenderPassDescriptor;
	gpureadPipeline: GPURenderPipeline;
	gpureadUniformBuffer: GPUBuffer;
	gpureadBindGroup: GPUBindGroup;
	gpureadSource: GPUTexelCopyTextureInfo;
	gpureadDestination: GPUTexelCopyBufferInfo;
	gpureadExtent: GPUExtent3DDict;
	gpureadMappedByteCount: number;
	gpureadToken: number;
	gpureadPort: GxGpuVramSource['readbackPort'] | null;
	gpureadCompletion: Promise<void> | null;
	vramTexture: GPUTexture;
	vramSampleTexture: GPUTexture;
	vramTransferTexture: GPUTexture;
	vramView: GPUTextureView;
	vramSampleView: GPUTextureView;
	vramTransferView: GPUTextureView;
	sampler: GPUSampler;
	solidPipeline: GPURenderPipeline;
	linePipeline: GPURenderPipeline;
	texturedPipeline: GPURenderPipeline;
	transferPipeline: GPURenderPipeline;
	scanoutPipeline: GPURenderPipeline;
	solidVertexBuffer: GPUBuffer;
	lineVertexBuffer: GPUBuffer;
	texturedVertexBuffer: GPUBuffer;
	transferVertexBuffer: GPUBuffer;
	primitiveUniformBuffer: GPUBuffer;
	texturedUniformBuffer: GPUBuffer;
	transferUniformBuffer: GPUBuffer;
	scanoutUniformBuffer: GPUBuffer;
	solidVertexByteOffset: number;
	lineVertexByteOffset: number;
	texturedVertexByteOffset: number;
	transferVertexByteOffset: number;
	primitiveUniformByteOffset: number;
	texturedUniformByteOffset: number;
	transferUniformByteOffset: number;
	solidBindGroup: GPUBindGroup;
	lineBindGroup: GPUBindGroup;
	texturedBindGroup: GPUBindGroup;
	transferFromSampleBindGroup: GPUBindGroup;
	transferFromUploadBindGroup: GPUBindGroup;
	scanoutBindGroup: GPUBindGroup;
	scanoutTargetTexture?: GPUTexture;
	scanoutTargetView: GPUTextureView;
	processedCommandCount: number;
	processedCommandSerial: number;
	vramClearSerial: number;
	vramSnapshotSerial: number;
};

const gxGpuVramCopyRectScratch: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuLineBatchRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuLineCommandRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuRectangleScratch: GxGpuRectangle = { x0: 0, y0: 0, x1: 0, y1: 0, width: 0, height: 0 };

let gxGpuState: WebGpuGxGpuState;

function createVramTexture(device: GPUDevice): GPUTexture {
	return device.createTexture({
		size: { width: GX_GPU_VRAM_WIDTH, height: GX_GPU_VRAM_HEIGHT, depthOrArrayLayers: 1 },
		format: 'rgba8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
	});
}

function createPrimitiveBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
	return device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		],
	});
}

function createTransferBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
	return device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
			{ binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
		],
	});
}

function createBindGroup(device: GPUDevice, layout: GPUBindGroupLayout, uniformBuffer: GPUBuffer, uniformByteLength: number, textureView: GPUTextureView, sampler: GPUSampler): GPUBindGroup {
	return device.createBindGroup({
		layout,
		entries: [
			{ binding: 0, resource: { buffer: uniformBuffer, size: uniformByteLength } },
			{ binding: 1, resource: textureView },
			{ binding: 2, resource: sampler },
		],
	});
}

function createTransferBindGroup(device: GPUDevice, layout: GPUBindGroupLayout, uniformBuffer: GPUBuffer, uniformByteLength: number, sourceView: GPUTextureView, vramView: GPUTextureView, sampler: GPUSampler): GPUBindGroup {
	return device.createBindGroup({
		layout,
		entries: [
			{ binding: 0, resource: { buffer: uniformBuffer, size: uniformByteLength } },
			{ binding: 1, resource: sourceView },
			{ binding: 2, resource: vramView },
			{ binding: 3, resource: sampler },
		],
	});
}

function createPipeline(device: GPUDevice, label: string, shaderCode: string, bindGroupLayout: GPUBindGroupLayout, vertexBuffer: GPUVertexBufferLayout, targetFormat: GPUTextureFormat): GPURenderPipeline {
	const module = device.createShaderModule({ label, code: shaderCode });
	return device.createRenderPipeline({
		label,
		layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
		vertex: { module, entryPoint: 'vs_main', buffers: [vertexBuffer] },
		fragment: { module, entryPoint: 'fs_main', targets: [{ format: targetFormat }] },
		primitive: { topology: 'triangle-list' },
	});
}

function createScanoutPipeline(device: GPUDevice, bindGroupLayout: GPUBindGroupLayout): GPURenderPipeline {
	const module = device.createShaderModule({ label: 'gx_gpu_scanout', code: scanoutShaderCode });
	return device.createRenderPipeline({
		label: 'gx_gpu_scanout',
		layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
		vertex: { module, entryPoint: 'vs_main' },
		fragment: { module, entryPoint: 'fs_main', targets: [{ format: 'bgra8unorm' }] },
		primitive: { topology: 'triangle-list' },
	});
}

function createReadbackPipeline(device: GPUDevice, bindGroupLayout: GPUBindGroupLayout): GPURenderPipeline {
	const module = device.createShaderModule({ label: 'gx_gpu_readback', code: readbackShaderCode });
	return device.createRenderPipeline({
		label: 'gx_gpu_readback',
		layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
		vertex: { module, entryPoint: 'vs_main' },
		fragment: { module, entryPoint: 'fs_main', targets: [{ format: 'rgba8unorm' }] },
		primitive: { topology: 'triangle-list' },
	});
}

function bootstrapGxGpuPass(backend: WebGPUBackend): void {
	const device = backend.device;
	const vramTexture = createVramTexture(device);
	const vramSampleTexture = createVramTexture(device);
	const vramTransferTexture = createVramTexture(device);
	const gpureadTexture = device.createTexture({
		size: { width: GX_GPU_READBACK_PACK_WIDTH, height: GX_GPU_VRAM_HEIGHT, depthOrArrayLayers: 1 },
		format: 'rgba8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});
	const vramView = vramTexture.createView();
	const vramSampleView = vramSampleTexture.createView();
	const vramTransferView = vramTransferTexture.createView();
	const gpureadView = gpureadTexture.createView();
	const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'repeat', addressModeV: 'repeat' });
	const primitiveLayout = createPrimitiveBindGroupLayout(device);
	const transferLayout = createTransferBindGroupLayout(device);
	const readbackLayout = device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
			{ binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
		],
	});
	const solidPipeline = createPipeline(device, 'gx_gpu_solid', solidShaderCode, primitiveLayout, {
		arrayStride: GX_GPU_SOLID_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'float32x4' },
		],
	}, 'rgba8unorm');
	const linePipeline = createPipeline(device, 'gx_gpu_line', lineShaderCode, primitiveLayout, {
		arrayStride: GX_GPU_LINE_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'float32x2' },
			{ shaderLocation: 2, offset: 4 * 4, format: 'float32x2' },
			{ shaderLocation: 3, offset: 6 * 4, format: 'float32x3' },
			{ shaderLocation: 4, offset: 9 * 4, format: 'float32x3' },
		],
	}, 'rgba8unorm');
	const texturedPipeline = createPipeline(device, 'gx_gpu_textured', texturedShaderCode, primitiveLayout, {
		arrayStride: GX_GPU_TEXTURED_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'float32x3' },
			{ shaderLocation: 2, offset: 5 * 4, format: 'float32x2' },
		],
	}, 'rgba8unorm');
	const transferPipeline = createPipeline(device, 'gx_gpu_transfer', transferShaderCode, transferLayout, {
		arrayStride: GX_GPU_TRANSFER_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'float32x2' },
		],
	}, 'rgba8unorm');
	const scanoutPipeline = createScanoutPipeline(device, primitiveLayout);
	const gpureadPipeline = createReadbackPipeline(device, readbackLayout);
	const solidVertexBuffer = device.createBuffer({ size: gxGpuSolidVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const lineVertexBuffer = device.createBuffer({ size: gxGpuLineVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const texturedVertexBuffer = device.createBuffer({ size: gxGpuTexturedVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const transferVertexBuffer = device.createBuffer({ size: gxGpuTransferVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const primitiveUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_BUFFER_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const texturedUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_BUFFER_BYTES * 2, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const transferUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_BUFFER_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const scanoutUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_SLOT_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const gpureadUniformBuffer = device.createBuffer({ size: GX_GPU_READBACK_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const vramReadbackBuffer = device.createBuffer({ size: GX_GPU_RAW_VRAM_UPLOAD_BYTES, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const gpureadBuffer = device.createBuffer({ size: GX_GPU_VRAM_BYTE_COUNT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const vramDrawColorAttachment: GPURenderPassColorAttachment = { view: vramView, loadOp: 'load', storeOp: 'store' };
	const vramClearColorAttachment: GPURenderPassColorAttachment = { view: vramView, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' };
	const scanoutColorAttachment: GPURenderPassColorAttachment = { view: vramView, clearValue: [0, 0, 0, 1], loadOp: 'load', storeOp: 'store' };
	const gpureadColorAttachment: GPURenderPassColorAttachment = { view: gpureadView, loadOp: 'load', storeOp: 'store' };
	const vramCopySourceOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	const vramCopyDestinationOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	const vramUploadDestinationOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	gxGpuState = {
		backend,
		submitCommandBuffers: [],
		vramDrawPassDescriptor: { colorAttachments: [vramDrawColorAttachment] },
		vramClearPassDescriptor: { colorAttachments: [vramClearColorAttachment] },
		scanoutPassDescriptor: { colorAttachments: [scanoutColorAttachment] },
		scanoutColorAttachment,
		vramCopySource: { texture: vramTexture, origin: vramCopySourceOrigin },
		vramCopySourceOrigin,
		vramCopyDestination: { texture: vramSampleTexture, origin: vramCopyDestinationOrigin },
		vramCopyDestinationOrigin,
		vramCopyExtent: { width: 0, height: 0, depthOrArrayLayers: 1 },
		vramUploadDestination: { texture: vramTexture, origin: vramUploadDestinationOrigin },
		vramUploadDestinationOrigin,
		vramUploadLayout: { offset: 0, bytesPerRow: GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES },
		vramUploadExtent: { width: 0, height: 0, depthOrArrayLayers: 1 },
		vramReadbackBuffer,
		vramReadbackSource: { texture: vramTexture },
		vramReadbackDestination: { buffer: vramReadbackBuffer, bytesPerRow: GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES, rowsPerImage: GX_GPU_VRAM_HEIGHT },
		vramReadbackExtent: { width: GX_GPU_VRAM_WIDTH, height: GX_GPU_VRAM_HEIGHT, depthOrArrayLayers: 1 },
		gpureadBuffer,
		gpureadTexture,
		gpureadPassDescriptor: { colorAttachments: [gpureadColorAttachment] },
		gpureadPipeline,
		gpureadUniformBuffer,
		gpureadBindGroup: device.createBindGroup({
			layout: readbackLayout,
			entries: [
				{ binding: 0, resource: { buffer: gpureadUniformBuffer, size: GX_GPU_READBACK_UNIFORM_BYTES } },
				{ binding: 1, resource: vramView },
			],
		}),
		gpureadSource: { texture: gpureadTexture },
		gpureadDestination: { buffer: gpureadBuffer, bytesPerRow: 256, rowsPerImage: 1 },
		gpureadExtent: { width: 0, height: 0, depthOrArrayLayers: 1 },
		gpureadMappedByteCount: 0,
		gpureadToken: 0,
		gpureadPort: null,
		gpureadCompletion: null,
		vramTexture,
		vramSampleTexture,
		vramTransferTexture,
		vramView,
		vramSampleView,
		vramTransferView,
		sampler,
		solidPipeline,
		linePipeline,
		texturedPipeline,
		transferPipeline,
		scanoutPipeline,
		solidVertexBuffer,
		lineVertexBuffer,
		texturedVertexBuffer,
		transferVertexBuffer,
		primitiveUniformBuffer,
		texturedUniformBuffer,
		transferUniformBuffer,
		scanoutUniformBuffer,
		solidVertexByteOffset: 0,
		lineVertexByteOffset: 0,
		texturedVertexByteOffset: 0,
		transferVertexByteOffset: 0,
		primitiveUniformByteOffset: 0,
		texturedUniformByteOffset: 0,
		transferUniformByteOffset: 0,
		solidBindGroup: createBindGroup(device, primitiveLayout, primitiveUniformBuffer, primitiveUniformScratch.byteLength, vramSampleView, sampler),
		lineBindGroup: createBindGroup(device, primitiveLayout, primitiveUniformBuffer, primitiveUniformScratch.byteLength, vramSampleView, sampler),
		texturedBindGroup: createBindGroup(device, primitiveLayout, texturedUniformBuffer, texturedUniformScratch.byteLength, vramSampleView, sampler),
		transferFromSampleBindGroup: createTransferBindGroup(device, transferLayout, transferUniformBuffer, transferUniformScratch.byteLength, vramSampleView, vramSampleView, sampler),
		transferFromUploadBindGroup: createTransferBindGroup(device, transferLayout, transferUniformBuffer, transferUniformScratch.byteLength, vramTransferView, vramSampleView, sampler),
		scanoutBindGroup: createBindGroup(device, primitiveLayout, scanoutUniformBuffer, scanoutUniformScratch.byteLength, vramView, sampler),
		scanoutTargetView: vramView,
		processedCommandCount: 0,
		processedCommandSerial: 0,
		vramClearSerial: 0,
		vramSnapshotSerial: 0,
	};
	clearGxGpuVram();
}

function clearGxGpuVram(): void {
	invalidateGxGpuSampleSourceCache();
	const encoder = gxGpuState.backend.device.createCommandEncoder();
	const pass = encoder.beginRenderPass(gxGpuState.vramClearPassDescriptor);
	pass.end();
	gxGpuState.submitCommandBuffers[0] = encoder.finish();
	gxGpuState.backend.device.queue.submit(gxGpuState.submitCommandBuffers);
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
	return writeSolidVertex(offset, x, y, (colorWord & 0xff) / 255, ((colorWord >>> 8) & 0xff) / 255, ((colorWord >>> 16) & 0xff) / 255);
}

function appendSolidTriangle(vertexFloatCount: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number, x2: number, y2: number, color2: number): number {
	let offset = vertexFloatCount;
	offset = writeSolidColorVertex(offset, x0, y0, color0);
	offset = writeSolidColorVertex(offset, x1, y1, color1);
	offset = writeSolidColorVertex(offset, x2, y2, color2);
	return offset;
}

function appendSolidPrimitiveTriangle(vertexFloatCount: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number, x2: number, y2: number, color2: number): number {
	if (gxGpuTriangleExceedsPrimitiveSize(x0, y0, x1, y1, x2, y2)) return vertexFloatCount;
	const xShift = gxGpuTriangleRasterShift(x0, x1, x2);
	const yShift = gxGpuTriangleRasterShift(y0, y1, y2);
	return appendSolidTriangle(vertexFloatCount, x0 + xShift, y0 + yShift, color0, x1 + xShift, y1 + yShift, color1, x2 + xShift, y2 + yShift, color2);
}

function appendSolidQuad(vertexFloatCount: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number, x2: number, y2: number, color2: number, x3: number, y3: number, color3: number): number {
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
	if (width === 0 || height === 0) return vertexFloatCount;
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
	if (gxGpuCommandDrawsTexture(opcode, drawModeWord)) return vertexFloatCount;
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
			let offset = appendSolidPrimitiveTriangle(vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2);
			if (gxGpuCommandQuadPolygon(opcode)) {
				const color3 = words[wordStart + 9];
				const xy3 = words[wordStart + 10];
				offset = appendSolidPrimitiveTriangle(offset, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3);
			}
			return offset;
		}
		const color = words[wordStart];
		const xy0 = words[wordStart + 1];
		const xy1 = words[wordStart + 3];
		const xy2 = words[wordStart + 5];
		let offset = appendSolidPrimitiveTriangle(vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const xy3 = words[wordStart + 7];
			offset = appendSolidPrimitiveTriangle(offset, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color);
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
		let offset = appendSolidPrimitiveTriangle(vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const color3 = words[wordStart + 6];
			const xy3 = words[wordStart + 7];
			offset = appendSolidPrimitiveTriangle(offset, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3);
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
	if (gxGpuCommandDrawsTexture(opcode, commandBuffer.commandDrawModeWord[commandIndex])) return vertexFloatCount;
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = commandBuffer.words[wordStart];
	const rect = readGxGpuRectangle(commandBuffer, commandIndex, opcode);
	if (rect.width === 0 || rect.height === 0) return vertexFloatCount;
	return appendSolidQuad(vertexFloatCount, rect.x0, rect.y0, colorWord, rect.x0, rect.y1, colorWord, rect.x1, rect.y0, colorWord, rect.x1, rect.y1, colorWord);
}

function writeLineVertex(offset: number, x: number, y: number, x0: number, y0: number, x1: number, y1: number, color0: number, color1: number): number {
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
	if (gxGpuSegmentExceedsPrimitiveSize(x0, y0, x1, y1)) return vertexFloatCount;
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
	return offset + GX_GPU_TEXTURED_VERTEX_FLOATS;
}

function appendTexturedTriangle(vertexFloatCount: number, x0: number, y0: number, color0: number, u0: number, v0: number, x1: number, y1: number, color1: number, u1: number, v1: number, x2: number, y2: number, color2: number, u2: number, v2: number): number {
	let offset = vertexFloatCount;
	offset = writeTexturedVertex(offset, x0, y0, color0, u0, v0);
	offset = writeTexturedVertex(offset, x1, y1, color1, u1, v1);
	offset = writeTexturedVertex(offset, x2, y2, color2, u2, v2);
	return offset;
}

function appendTexturedPrimitiveTriangle(vertexFloatCount: number, x0: number, y0: number, color0: number, u0: number, v0: number, x1: number, y1: number, color1: number, u1: number, v1: number, x2: number, y2: number, color2: number, u2: number, v2: number): number {
	if (gxGpuTriangleExceedsPrimitiveSize(x0, y0, x1, y1, x2, y2)) return vertexFloatCount;
	const determinant = ((x1 - x0) * (y2 - y1)) - ((x2 - x1) * (y1 - y0));
	if (determinant === 0) return vertexFloatCount;
	const xShift = gxGpuTriangleRasterShift(x0, x1, x2);
	const yShift = gxGpuTriangleRasterShift(y0, y1, y2);
	x0 += xShift;
	y0 += yShift;
	x1 += xShift;
	y1 += yShift;
	x2 += xShift;
	y2 += yShift;
	gxGpuTriangleUvPlane(gxGpuTexturedUvPlanes, gxGpuTexturedUvPlaneCount * GX_GPU_TRIANGLE_UV_PLANE_WORDS, determinant, x0, y0, u0, v0, x1, y1, u1, v1, x2, y2, u2, v2);
	gxGpuTexturedUvPlaneCount += 1;
	return appendTexturedTriangle(vertexFloatCount, x0, y0, color0, u0, v0, x1, y1, color1, u1, v1, x2, y2, color2, u2, v2);
}

function appendTexturedPolygon(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const opcode = commandBuffer.commandOpcode[commandIndex];
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
		let offset = appendTexturedPrimitiveTriangle(vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, gxGpuTextureU(texture0), gxGpuTextureV(texture0), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2));
		if (gxGpuCommandQuadPolygon(opcode)) {
			const color3 = commandBuffer.words[wordStart + 9];
			const xy3 = commandBuffer.words[wordStart + 10];
			const texture3 = commandBuffer.words[wordStart + 11];
			offset = appendTexturedPrimitiveTriangle(offset, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3, gxGpuTextureU(texture3), gxGpuTextureV(texture3));
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
	let offset = appendTexturedPrimitiveTriangle(vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color, gxGpuTextureU(texture0), gxGpuTextureV(texture0), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, gxGpuTextureU(texture2), gxGpuTextureV(texture2));
	if (gxGpuCommandQuadPolygon(opcode)) {
		const xy3 = commandBuffer.words[wordStart + 7];
		const texture3 = commandBuffer.words[wordStart + 8];
		offset = appendTexturedPrimitiveTriangle(offset, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, gxGpuTextureU(texture2), gxGpuTextureV(texture2), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color, gxGpuTextureU(texture3), gxGpuTextureV(texture3));
	}
	return offset;
}

function appendTexturedRectangle(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = commandBuffer.words[wordStart];
	const textureWord = commandBuffer.words[wordStart + 2];
	const rect = readGxGpuRectangle(commandBuffer, commandIndex, opcode);
	if (rect.width === 0 || rect.height === 0) return vertexFloatCount;
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

function appendTransferTriangle(vertexFloatCount: number, x0: number, y0: number, u0: number, v0: number, x1: number, y1: number, u1: number, v1: number, x2: number, y2: number, u2: number, v2: number): number {
	let offset = vertexFloatCount;
	offset = writeUvVertex(gxGpuTransferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x0, y0, u0, v0);
	offset = writeUvVertex(gxGpuTransferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x1, y1, u1, v1);
	offset = writeUvVertex(gxGpuTransferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x2, y2, u2, v2);
	return offset;
}

function writeUvVertex(vertices: Float32Array, offset: number, _stride: number, x: number, y: number, u: number, v: number): number {
	vertices[offset] = x;
	vertices[offset + 1] = y;
	vertices[offset + 2] = u;
	vertices[offset + 3] = v;
	return offset + _stride;
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

function writeVramSnapshotUpload(snapshotBytes: Uint8Array): void {
	let uploadOffset = 0;
	let snapshotOffset = 0;
	for (let pixel = 0; pixel < GX_GPU_VRAM_WIDTH * GX_GPU_VRAM_HEIGHT; pixel += 1) {
		gxGpuRawVramUpload[uploadOffset] = snapshotBytes[snapshotOffset];
		gxGpuRawVramUpload[uploadOffset + 1] = snapshotBytes[snapshotOffset + 1];
		gxGpuRawVramUpload[uploadOffset + 2] = 0;
		gxGpuRawVramUpload[uploadOffset + 3] = 0xff;
		uploadOffset += 4;
		snapshotOffset += 2;
	}
}

function uploadGxGpuVramSnapshot(snapshotBytes: Uint8Array): void {
	invalidateGxGpuSampleSourceCache();
	writeVramSnapshotUpload(snapshotBytes);
	gxGpuState.vramUploadDestination.texture = gxGpuState.vramTexture;
	gxGpuState.vramUploadDestinationOrigin.x = 0;
	gxGpuState.vramUploadDestinationOrigin.y = 0;
	gxGpuState.vramUploadLayout.offset = 0;
	gxGpuState.vramUploadExtent.width = GX_GPU_VRAM_WIDTH;
	gxGpuState.vramUploadExtent.height = GX_GPU_VRAM_HEIGHT;
	gxGpuState.backend.device.queue.writeTexture(gxGpuState.vramUploadDestination, gxGpuRawVramUpload, gxGpuState.vramUploadLayout, gxGpuState.vramUploadExtent);
	gxGpuState.backend.accountUpload('texture', GX_GPU_RAW_VRAM_UPLOAD_BYTES);
}

function writeCpuToVramUploadRow(commandBuffer: GxGpuCommandBufferView, payloadWordStart: number, rowPixelStart: number, width: number): void {
	let rowByteOffset = 0;
	for (let column = 0; column < width; column += 1) {
		const pixelIndex = rowPixelStart + column;
		const payloadWord = commandBuffer.words[payloadWordStart + (pixelIndex >>> 1)];
		rowByteOffset = writeRawVramUploadPixel(rowByteOffset, gxGpuTransferPixelWord(payloadWord, pixelIndex));
	}
}

function invalidateGxGpuSampleSourceCache(): void {
	gxGpuSampleSourceRectCount = 0;
	gxGpuSampleSourceRectHash = 0;
	gxGpuSampleSourceTileMask0 = 0;
	gxGpuSampleSourceTileMask1 = 0;
	gxGpuSampleSourceTileMask2 = 0;
	gxGpuSampleSourceTileMask3 = 0;
}

function invalidateGxGpuSampleSourceCacheForWrite(left: number, top: number, right: number, bottom: number): void {
	if (gxGpuSampleSourceRectCount === 0) {
		return;
	}
	if (right <= left || bottom <= top) {
		return;
	}
	resetGxGpuSampleSourceCandidateMasks();
	appendGxGpuSampleSourceCandidateMaskRect(left, top, right - left, bottom - top);
	if (((gxGpuSampleSourceCandidateTileMask0 & gxGpuSampleSourceTileMask0)
		| (gxGpuSampleSourceCandidateTileMask1 & gxGpuSampleSourceTileMask1)
		| (gxGpuSampleSourceCandidateTileMask2 & gxGpuSampleSourceTileMask2)
		| (gxGpuSampleSourceCandidateTileMask3 & gxGpuSampleSourceTileMask3)) !== 0) {
		invalidateGxGpuSampleSourceCache();
	}
}

function gxGpuSampleSourceCandidateCacheMatches(): boolean {
	if (gxGpuSampleSourceRectCount !== gxGpuSampleSourceCandidateRectCount
		|| gxGpuSampleSourceRectHash !== gxGpuSampleSourceCandidateRectHash
		|| gxGpuSampleSourceTileMask0 !== gxGpuSampleSourceCandidateTileMask0
		|| gxGpuSampleSourceTileMask1 !== gxGpuSampleSourceCandidateTileMask1
		|| gxGpuSampleSourceTileMask2 !== gxGpuSampleSourceCandidateTileMask2
		|| gxGpuSampleSourceTileMask3 !== gxGpuSampleSourceCandidateTileMask3) {
		return false;
	}
	return gxGpuSampleSourceRects[0] === gxGpuSampleSourceCandidateRects[0]
		&& gxGpuSampleSourceRects[1] === gxGpuSampleSourceCandidateRects[1]
		&& gxGpuSampleSourceRects[2] === gxGpuSampleSourceCandidateRects[2]
		&& gxGpuSampleSourceRects[3] === gxGpuSampleSourceCandidateRects[3]
		&& gxGpuSampleSourceRects[4] === gxGpuSampleSourceCandidateRects[4]
		&& gxGpuSampleSourceRects[5] === gxGpuSampleSourceCandidateRects[5]
		&& gxGpuSampleSourceRects[6] === gxGpuSampleSourceCandidateRects[6]
		&& gxGpuSampleSourceRects[7] === gxGpuSampleSourceCandidateRects[7]
		&& gxGpuSampleSourceRects[8] === gxGpuSampleSourceCandidateRects[8]
		&& gxGpuSampleSourceRects[9] === gxGpuSampleSourceCandidateRects[9]
		&& gxGpuSampleSourceRects[10] === gxGpuSampleSourceCandidateRects[10]
		&& gxGpuSampleSourceRects[11] === gxGpuSampleSourceCandidateRects[11];
}

function resetGxGpuSampleSourceCandidateMasks(): void {
	gxGpuSampleSourceCandidateTileMask0 = 0;
	gxGpuSampleSourceCandidateTileMask1 = 0;
	gxGpuSampleSourceCandidateTileMask2 = 0;
	gxGpuSampleSourceCandidateTileMask3 = 0;
}

function includeGxGpuSampleSourceCandidateMaskArea(left: number, top: number, right: number, bottom: number): void {
	if (right <= left || bottom <= top) {
		return;
	}
	const tileLeft = left >>> GX_GPU_SAMPLE_SOURCE_TILE_SHIFT;
	const tileRight = (right - 1) >>> GX_GPU_SAMPLE_SOURCE_TILE_SHIFT;
	const tileTop = top >>> GX_GPU_SAMPLE_SOURCE_TILE_SHIFT;
	const tileBottom = (bottom - 1) >>> GX_GPU_SAMPLE_SOURCE_TILE_SHIFT;
	for (let tileY = tileTop; tileY <= tileBottom; tileY += 1) {
		for (let tileX = tileLeft; tileX <= tileRight; tileX += 1) {
			const tileIndex = tileY * GX_GPU_SAMPLE_SOURCE_TILE_COLUMNS + tileX;
			const bit = 1 << (tileIndex & 31);
			switch (tileIndex >>> 5) {
				case 0:
					gxGpuSampleSourceCandidateTileMask0 |= bit;
					break;
				case 1:
					gxGpuSampleSourceCandidateTileMask1 |= bit;
					break;
				case 2:
					gxGpuSampleSourceCandidateTileMask2 |= bit;
					break;
				default:
					gxGpuSampleSourceCandidateTileMask3 |= bit;
					break;
			}
		}
	}
}

function appendGxGpuSampleSourceCandidateMaskRect(x: number, y: number, width: number, height: number): void {
	if (width <= 0 || height <= 0) {
		return;
	}
	let rowY = y & (GX_GPU_VRAM_HEIGHT - 1);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight);
		let columnX = x & (GX_GPU_VRAM_WIDTH - 1);
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			includeGxGpuSampleSourceCandidateMaskArea(columnX, rowY, columnX + runWidth, rowY + runHeight);
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			remainingWidth -= runWidth;
		}
		rowY = (rowY + runHeight) & (GX_GPU_VRAM_HEIGHT - 1);
		remainingHeight -= runHeight;
	}
}

function hashGxGpuSampleSourceRect(hash: number, x: number, y: number, width: number, height: number): number {
	let value = Math.imul(hash ^ x, 0x45d9f3b);
	value = Math.imul(value ^ y, 0x45d9f3b);
	value = Math.imul(value ^ width, 0x45d9f3b);
	return Math.imul(value ^ height, 0x45d9f3b) >>> 0;
}

function resetGxGpuSampleSourceCandidateRects(): void {
	gxGpuSampleSourceCandidateRectCount = 0;
	gxGpuSampleSourceCandidateRectHash = 0;
	resetGxGpuSampleSourceCandidateMasks();
}

function appendGxGpuSampleSourceCandidateRect(x: number, y: number, width: number, height: number): void {
	const offset = gxGpuSampleSourceCandidateRectCount << 2;
	gxGpuSampleSourceCandidateRects[offset] = x;
	gxGpuSampleSourceCandidateRects[offset + 1] = y;
	gxGpuSampleSourceCandidateRects[offset + 2] = x + width;
	gxGpuSampleSourceCandidateRects[offset + 3] = y + height;
	gxGpuSampleSourceCandidateRectHash = hashGxGpuSampleSourceRect(gxGpuSampleSourceCandidateRectHash, x, y, width, height);
	appendGxGpuSampleSourceCandidateMaskRect(x, y, width, height);
	gxGpuSampleSourceCandidateRectCount += 1;
}

function writeGxGpuSampleSourceCandidateCache(): void {
	gxGpuSampleSourceRects[0] = gxGpuSampleSourceCandidateRects[0];
	gxGpuSampleSourceRects[1] = gxGpuSampleSourceCandidateRects[1];
	gxGpuSampleSourceRects[2] = gxGpuSampleSourceCandidateRects[2];
	gxGpuSampleSourceRects[3] = gxGpuSampleSourceCandidateRects[3];
	gxGpuSampleSourceRects[4] = gxGpuSampleSourceCandidateRects[4];
	gxGpuSampleSourceRects[5] = gxGpuSampleSourceCandidateRects[5];
	gxGpuSampleSourceRects[6] = gxGpuSampleSourceCandidateRects[6];
	gxGpuSampleSourceRects[7] = gxGpuSampleSourceCandidateRects[7];
	gxGpuSampleSourceRects[8] = gxGpuSampleSourceCandidateRects[8];
	gxGpuSampleSourceRects[9] = gxGpuSampleSourceCandidateRects[9];
	gxGpuSampleSourceRects[10] = gxGpuSampleSourceCandidateRects[10];
	gxGpuSampleSourceRects[11] = gxGpuSampleSourceCandidateRects[11];
	gxGpuSampleSourceRectCount = gxGpuSampleSourceCandidateRectCount;
	gxGpuSampleSourceRectHash = gxGpuSampleSourceCandidateRectHash;
	gxGpuSampleSourceTileMask0 = gxGpuSampleSourceCandidateTileMask0;
	gxGpuSampleSourceTileMask1 = gxGpuSampleSourceCandidateTileMask1;
	gxGpuSampleSourceTileMask2 = gxGpuSampleSourceCandidateTileMask2;
	gxGpuSampleSourceTileMask3 = gxGpuSampleSourceCandidateTileMask3;
}

function copyGxGpuVramAreaToSampleTexture(left: number, top: number, right: number, bottom: number): void {
	const encoder = gxGpuState.activeEncoder!;
	if (right <= left || bottom <= top) return;
	gxGpuState.vramCopySourceOrigin.x = left;
	gxGpuState.vramCopySourceOrigin.y = top;
	gxGpuState.vramCopyDestinationOrigin.x = left;
	gxGpuState.vramCopyDestinationOrigin.y = top;
	gxGpuState.vramCopyExtent.width = right - left;
	gxGpuState.vramCopyExtent.height = bottom - top;
	encoder.copyTextureToTexture(gxGpuState.vramCopySource, gxGpuState.vramCopyDestination, gxGpuState.vramCopyExtent);
}

function copyGxGpuVramLogicalAreaToSampleTexture(x: number, y: number, width: number, height: number): void {
	let rowY = y & (GX_GPU_VRAM_HEIGHT - 1);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight);
		let columnX = x & (GX_GPU_VRAM_WIDTH - 1);
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			copyGxGpuVramAreaToSampleTexture(columnX, rowY, columnX + runWidth, rowY + runHeight);
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			remainingWidth -= runWidth;
		}
		rowY = (rowY + runHeight) & (GX_GPU_VRAM_HEIGHT - 1);
		remainingHeight -= runHeight;
	}
}

function resetGxGpuVramCopyRect(rect: GxGpuVramCopyRect): void {
	rect.left = GX_GPU_VRAM_WIDTH;
	rect.top = GX_GPU_VRAM_HEIGHT;
	rect.right = 0;
	rect.bottom = 0;
}

function includeGxGpuVramCopyVertex(rect: GxGpuVramCopyRect, x: number, y: number): void {
	if (x < rect.left) rect.left = x;
	if (y < rect.top) rect.top = y;
	const right = x + 1;
	const bottom = y + 1;
	if (right > rect.right) rect.right = right;
	if (bottom > rect.bottom) rect.bottom = bottom;
}

function includeGxGpuVramCopyRect(target: GxGpuVramCopyRect, source: GxGpuVramCopyRect): void {
	if (source.left < target.left) target.left = source.left;
	if (source.top < target.top) target.top = source.top;
	if (source.right > target.right) target.right = source.right;
	if (source.bottom > target.bottom) target.bottom = source.bottom;
}

function gxGpuVramCopyRectsOverlap(a: GxGpuVramCopyRect, b: GxGpuVramCopyRect): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function setGxGpuVertexBoundsRect(rect: GxGpuVramCopyRect, vertices: Float32Array, vertexFloatStart: number, vertexFloatEnd: number, vertexFloatStride: number, topLeftWord: number, bottomRightWord: number): void {
	resetGxGpuVramCopyRect(rect);
	for (let offset = vertexFloatStart; offset < vertexFloatEnd; offset += vertexFloatStride) {
		includeGxGpuVramCopyVertex(rect, vertices[offset], vertices[offset + 1]);
	}
	const drawingLeft = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const drawingTop = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord);
	const drawingRight = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const drawingBottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord);
	rect.left = rect.left > drawingLeft ? rect.left : drawingLeft;
	rect.top = rect.top > drawingTop ? rect.top : drawingTop;
	rect.right = rect.right < drawingRight ? rect.right : drawingRight;
	rect.bottom = rect.bottom < drawingBottom ? rect.bottom : drawingBottom;
}

function copyGxGpuVertexBoundsToSampleTexture(vertices: Float32Array, vertexFloatCount: number, vertexFloatStride: number, topLeftWord: number, bottomRightWord: number): void {
	setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, vertices, 0, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord);
	copyGxGpuVramAreaToSampleTexture(gxGpuVramCopyRectScratch.left, gxGpuVramCopyRectScratch.top, gxGpuVramCopyRectScratch.right, gxGpuVramCopyRectScratch.bottom);
}

function copyGxGpuTexturedSourceToSampleTexture(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): void {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const textureWord = commandBuffer.words[wordStart + 2];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const textureMode = gxGpuDrawModeTextureMode(drawModeWord);
	const pageX = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	const pageY = gxGpuDrawModeTexturePageBaseY(drawModeWord);
	const clutX = gxGpuTextureClutBaseX(textureWord);
	const clutY = gxGpuTextureClutBaseY(textureWord);
	resetGxGpuSampleSourceCandidateRects();
	const rect = gxGpuVramCopyRectScratch;
	resetGxGpuVramCopyRect(rect);
	for (let offset = 0; offset < vertexFloatCount; offset += GX_GPU_TEXTURED_VERTEX_FLOATS) {
		includeGxGpuVramCopyVertex(rect, gxGpuTexturedVertices[offset + 5], gxGpuTexturedVertices[offset + 6]);
	}
	const copyCompleteTexturePage = commandBuffer.commandTextureWindowWord[commandIndex] !== 0
		|| rect.left < 0
		|| rect.top < 0
		|| rect.right > GX_GPU_TEXTURE_PAGE_COORD_SIZE
		|| rect.bottom > GX_GPU_TEXTURE_PAGE_COORD_SIZE;
	if (textureMode === 0) {
		if (copyCompleteTexturePage) {
			appendGxGpuSampleSourceCandidateRect(pageX, pageY, GX_GPU_TEXTURE_PAGE_4BIT_WIDTH_WORDS, GX_GPU_TEXTURE_PAGE_COORD_SIZE);
			appendGxGpuSampleSourceCandidateRect(clutX, clutY, GX_GPU_CLUT_4BIT_WORDS, 1);
			if (gxGpuSampleSourceCandidateCacheMatches()) {
				return;
			}
			copyGxGpuVramLogicalAreaToSampleTexture(pageX, pageY, GX_GPU_TEXTURE_PAGE_4BIT_WIDTH_WORDS, GX_GPU_TEXTURE_PAGE_COORD_SIZE);
		} else {
			const wordLeft = rect.left >> 2;
			const wordRight = (rect.right + 3) >> 2;
			appendGxGpuSampleSourceCandidateRect(pageX + wordLeft, pageY + rect.top, wordRight - wordLeft, rect.bottom - rect.top);
			appendGxGpuSampleSourceCandidateRect(clutX, clutY, GX_GPU_CLUT_4BIT_WORDS, 1);
			if (gxGpuSampleSourceCandidateCacheMatches()) {
				return;
			}
			copyGxGpuVramLogicalAreaToSampleTexture(pageX + wordLeft, pageY + rect.top, wordRight - wordLeft, rect.bottom - rect.top);
		}
		copyGxGpuVramLogicalAreaToSampleTexture(clutX, clutY, GX_GPU_CLUT_4BIT_WORDS, 1);
		writeGxGpuSampleSourceCandidateCache();
		return;
	}
	if (textureMode === 1) {
		if (copyCompleteTexturePage) {
			appendGxGpuSampleSourceCandidateRect(pageX, pageY, GX_GPU_TEXTURE_PAGE_8BIT_WIDTH_WORDS, GX_GPU_TEXTURE_PAGE_COORD_SIZE);
			appendGxGpuSampleSourceCandidateRect(clutX, clutY, GX_GPU_CLUT_8BIT_WORDS, 1);
			if (gxGpuSampleSourceCandidateCacheMatches()) {
				return;
			}
			copyGxGpuVramLogicalAreaToSampleTexture(pageX, pageY, GX_GPU_TEXTURE_PAGE_8BIT_WIDTH_WORDS, GX_GPU_TEXTURE_PAGE_COORD_SIZE);
		} else {
			const wordLeft = rect.left >> 1;
			const wordRight = (rect.right + 1) >> 1;
			appendGxGpuSampleSourceCandidateRect(pageX + wordLeft, pageY + rect.top, wordRight - wordLeft, rect.bottom - rect.top);
			appendGxGpuSampleSourceCandidateRect(clutX, clutY, GX_GPU_CLUT_8BIT_WORDS, 1);
			if (gxGpuSampleSourceCandidateCacheMatches()) {
				return;
			}
			copyGxGpuVramLogicalAreaToSampleTexture(pageX + wordLeft, pageY + rect.top, wordRight - wordLeft, rect.bottom - rect.top);
		}
		copyGxGpuVramLogicalAreaToSampleTexture(clutX, clutY, GX_GPU_CLUT_8BIT_WORDS, 1);
		writeGxGpuSampleSourceCandidateCache();
		return;
	}
	if (copyCompleteTexturePage) {
		appendGxGpuSampleSourceCandidateRect(pageX, pageY, GX_GPU_TEXTURE_PAGE_COORD_SIZE, GX_GPU_TEXTURE_PAGE_COORD_SIZE);
		if (gxGpuSampleSourceCandidateCacheMatches()) {
			return;
		}
		copyGxGpuVramLogicalAreaToSampleTexture(pageX, pageY, GX_GPU_TEXTURE_PAGE_COORD_SIZE, GX_GPU_TEXTURE_PAGE_COORD_SIZE);
		writeGxGpuSampleSourceCandidateCache();
		return;
	}
	appendGxGpuSampleSourceCandidateRect(pageX + rect.left, pageY + rect.top, rect.right - rect.left, rect.bottom - rect.top);
	if (gxGpuSampleSourceCandidateCacheMatches()) {
		return;
	}
	copyGxGpuVramLogicalAreaToSampleTexture(pageX + rect.left, pageY + rect.top, rect.right - rect.left, rect.bottom - rect.top);
	writeGxGpuSampleSourceCandidateCache();
}

function writePrimitiveUniforms(blendEnabled: boolean, blendMode: number, maskBitModeWord: number, ditherEnabled: boolean, interlacedRenderWord: number): void {
	primitiveUniformScratch[0] = blendEnabled ? 1 : 0;
	primitiveUniformScratch[1] = blendMode;
	primitiveUniformScratch[2] = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0;
	primitiveUniformScratch[3] = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0;
	primitiveUniformScratch[4] = ditherEnabled ? 1 : 0;
	primitiveUniformScratch[5] = interlacedRenderWord;
	primitiveUniformScratch[6] = 0;
	primitiveUniformScratch[7] = 0;
}

function drawVramVertices(pipeline: GPURenderPipeline, bindGroup: GPUBindGroup, vertexBuffer: GPUBuffer, vertexFloatCount: number, vertexFloatStride: number, vertexByteOffset: number, uniformByteOffset: number, topLeftWord: number, bottomRightWord: number): void {
	const encoder = gxGpuState.activeEncoder!;
	const pass = encoder.beginRenderPass(gxGpuState.vramDrawPassDescriptor);
	const left = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const top = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord);
	const right = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const bottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord);
	pass.setScissorRect(left, top, right - left, bottom - top);
	pass.setPipeline(pipeline);
	gxGpuDynamicUniformOffsets[0] = uniformByteOffset;
	pass.setBindGroup(0, bindGroup, gxGpuDynamicUniformOffsets);
	pass.setVertexBuffer(0, vertexBuffer, vertexByteOffset, vertexFloatCount * 4);
	pass.draw(vertexFloatCount / vertexFloatStride);
	pass.end();
}

function renderVramVertices(pipeline: GPURenderPipeline, bindGroup: GPUBindGroup, vertexBuffer: GPUBuffer, vertices: Float32Array, vertexFloatCount: number, vertexFloatStride: number, vertexByteOffset: number, uniformByteOffset: number, topLeftWord: number, bottomRightWord: number): void {
	const backend = gxGpuState.backend;
	backend.device.queue.writeBuffer(vertexBuffer, vertexByteOffset, vertices.buffer, vertices.byteOffset, vertexFloatCount * 4);
	drawVramVertices(pipeline, bindGroup, vertexBuffer, vertexFloatCount, vertexFloatStride, vertexByteOffset, uniformByteOffset, topLeftWord, bottomRightWord);
	backend.accountUpload('vertex', vertexFloatCount * 4);
}

function renderSolidVertices(vertexFloatCount: number, topLeftWord: number, bottomRightWord: number, blendEnabled: boolean, blendMode: number, maskBitModeWord: number, ditherEnabled: boolean, interlacedRenderWord: number): void {
	if (vertexFloatCount === 0) return;
	invalidateGxGpuSampleSourceCacheForWrite(
		gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord),
		gxGpuDrawingAreaTop(topLeftWord, bottomRightWord),
		gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord),
		gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord),
	);
	writePrimitiveUniforms(blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord);
	const uniformByteOffset = gxGpuState.primitiveUniformByteOffset;
	const vertexByteOffset = gxGpuState.solidVertexByteOffset;
	gxGpuState.backend.device.queue.writeBuffer(gxGpuState.primitiveUniformBuffer, uniformByteOffset, primitiveUniformScratch);
	gxGpuState.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
	gxGpuState.solidVertexByteOffset += vertexFloatCount * 4;
	renderVramVertices(gxGpuState.solidPipeline, gxGpuState.solidBindGroup, gxGpuState.solidVertexBuffer, gxGpuSolidVertices, vertexFloatCount, GX_GPU_SOLID_VERTEX_FLOATS, vertexByteOffset, uniformByteOffset, topLeftWord, bottomRightWord);
}

function renderReadVramSolidQuad(topLeftWord: number, bottomRightWord: number, blendEnabled: boolean, blendMode: number, maskBitModeWord: number, ditherEnabled: boolean, interlacedRenderWord: number): void {
	setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, gxGpuSolidVertices, 0, GX_GPU_SOLID_TRIANGLE_FLOATS, GX_GPU_SOLID_VERTEX_FLOATS, topLeftWord, bottomRightWord);
	copyGxGpuVramAreaToSampleTexture(gxGpuVramCopyRectScratch.left, gxGpuVramCopyRectScratch.top, gxGpuVramCopyRectScratch.right, gxGpuVramCopyRectScratch.bottom);
	invalidateGxGpuSampleSourceCacheForWrite(
		gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord),
		gxGpuDrawingAreaTop(topLeftWord, bottomRightWord),
		gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord),
		gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord),
	);
	writePrimitiveUniforms(blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord);
	const uniformByteOffset = gxGpuState.primitiveUniformByteOffset;
	const vertexByteOffset = gxGpuState.solidVertexByteOffset;
	const vertexFloatCount = GX_GPU_SOLID_TRIANGLE_FLOATS * 2;
	gxGpuState.backend.device.queue.writeBuffer(gxGpuState.primitiveUniformBuffer, uniformByteOffset, primitiveUniformScratch);
	gxGpuState.backend.device.queue.writeBuffer(gxGpuState.solidVertexBuffer, vertexByteOffset, gxGpuSolidVertices.buffer, gxGpuSolidVertices.byteOffset, vertexFloatCount * 4);
	gxGpuState.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
	gxGpuState.solidVertexByteOffset += vertexFloatCount * 4;
	gxGpuState.backend.accountUpload('vertex', vertexFloatCount * 4);
	drawVramVertices(gxGpuState.solidPipeline, gxGpuState.solidBindGroup, gxGpuState.solidVertexBuffer, GX_GPU_SOLID_TRIANGLE_FLOATS, GX_GPU_SOLID_VERTEX_FLOATS, vertexByteOffset, uniformByteOffset, topLeftWord, bottomRightWord);
	setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, gxGpuSolidVertices, GX_GPU_SOLID_TRIANGLE_FLOATS, vertexFloatCount, GX_GPU_SOLID_VERTEX_FLOATS, topLeftWord, bottomRightWord);
	copyGxGpuVramAreaToSampleTexture(gxGpuVramCopyRectScratch.left, gxGpuVramCopyRectScratch.top, gxGpuVramCopyRectScratch.right, gxGpuVramCopyRectScratch.bottom);
	drawVramVertices(gxGpuState.solidPipeline, gxGpuState.solidBindGroup, gxGpuState.solidVertexBuffer, GX_GPU_SOLID_TRIANGLE_FLOATS, GX_GPU_SOLID_VERTEX_FLOATS, vertexByteOffset + GX_GPU_SOLID_TRIANGLE_FLOATS * 4, uniformByteOffset, topLeftWord, bottomRightWord);
}

function renderLineVertices(vertexFloatCount: number, topLeftWord: number, bottomRightWord: number, uniformByteOffset: number): void {
	if (vertexFloatCount === 0) return;
	invalidateGxGpuSampleSourceCacheForWrite(
		gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord),
		gxGpuDrawingAreaTop(topLeftWord, bottomRightWord),
		gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord),
		gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord),
	);
	const vertexByteOffset = gxGpuState.lineVertexByteOffset;
	gxGpuState.lineVertexByteOffset += vertexFloatCount * 4;
	renderVramVertices(gxGpuState.linePipeline, gxGpuState.lineBindGroup, gxGpuState.lineVertexBuffer, gxGpuLineVertices, vertexFloatCount, GX_GPU_LINE_VERTEX_FLOATS, vertexByteOffset, uniformByteOffset, topLeftWord, bottomRightWord);
}

function writeTexturedUniforms(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const textureWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2];
	const textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	texturedUniformScratch[0] = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	texturedUniformScratch[1] = gxGpuDrawModeTexturePageBaseY(drawModeWord);
	texturedUniformScratch[2] = gxGpuTextureClutBaseX(textureWord);
	texturedUniformScratch[3] = gxGpuTextureClutBaseY(textureWord);
	texturedUniformScratch[4] = gxGpuTextureWindowAndX(textureWindowWord);
	texturedUniformScratch[5] = gxGpuTextureWindowAndY(textureWindowWord);
	texturedUniformScratch[6] = gxGpuTextureWindowOrX(textureWindowWord);
	texturedUniformScratch[7] = gxGpuTextureWindowOrY(textureWindowWord);
	texturedUniformScratch[8] = gxGpuDrawModeTextureMode(drawModeWord);
	texturedUniformScratch[9] = gxGpuCommandRawTextureEnabled(opcode) ? 1 : 0;
	texturedUniformScratch[10] = gxGpuCommandSemiTransparencyEnabled(opcode) ? 1 : 0;
	texturedUniformScratch[11] = gxGpuDrawModeTransparencyMode(drawModeWord);
	texturedUniformScratch[12] = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0;
	texturedUniformScratch[13] = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0;
	texturedUniformScratch[14] = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode) ? 1 : 0;
	texturedUniformScratch[15] = commandBuffer.commandInterlacedRenderWord[commandIndex];
	texturedUniformWords[16] = 0;
}

function writeTexturedUvPlaneUniforms(planeIndex: number): void {
	const offset = planeIndex * GX_GPU_TRIANGLE_UV_PLANE_WORDS;
	const baseU = gxGpuTexturedUvPlanes[offset + GX_GPU_TRIANGLE_UV_BASE_U];
	const baseV = gxGpuTexturedUvPlanes[offset + GX_GPU_TRIANGLE_UV_BASE_V];
	const stepXU = gxGpuTexturedUvPlanes[offset + GX_GPU_TRIANGLE_UV_STEP_X_U];
	const stepXV = gxGpuTexturedUvPlanes[offset + GX_GPU_TRIANGLE_UV_STEP_X_V];
	const stepYU = gxGpuTexturedUvPlanes[offset + GX_GPU_TRIANGLE_UV_STEP_Y_U];
	const stepYV = gxGpuTexturedUvPlanes[offset + GX_GPU_TRIANGLE_UV_STEP_Y_V];
	texturedUniformWords[16] = 1;
	texturedUniformWords[20] = baseU;
	texturedUniformWords[21] = baseV;
	texturedUniformWords[24] = stepXU;
	texturedUniformWords[25] = stepXV;
	texturedUniformWords[28] = stepYU;
	texturedUniformWords[29] = stepYV;
}

function renderTexturedCommand(commandBuffer: GxGpuCommandBufferView, commandIndex: number, topLeftWord: number, bottomRightWord: number): void {
	let vertexFloatCount = 0;
	gxGpuTexturedUvPlaneCount = 0;
	if (commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON) vertexFloatCount = appendTexturedPolygon(commandBuffer, commandIndex, vertexFloatCount);
	else vertexFloatCount = appendTexturedRectangle(commandBuffer, commandIndex, vertexFloatCount);
	if (vertexFloatCount === 0) return;
	copyGxGpuTexturedSourceToSampleTexture(commandBuffer, commandIndex, vertexFloatCount);
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	if (gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) {
		copyGxGpuVertexBoundsToSampleTexture(gxGpuTexturedVertices, vertexFloatCount, GX_GPU_TEXTURED_VERTEX_FLOATS, topLeftWord, bottomRightWord);
	}
	setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, gxGpuTexturedVertices, 0, vertexFloatCount, GX_GPU_TEXTURED_VERTEX_FLOATS, topLeftWord, bottomRightWord);
	invalidateGxGpuSampleSourceCacheForWrite(gxGpuVramCopyRectScratch.left, gxGpuVramCopyRectScratch.top, gxGpuVramCopyRectScratch.right, gxGpuVramCopyRectScratch.bottom);
	writeTexturedUniforms(commandBuffer, commandIndex);
	if (gxGpuTexturedUvPlaneCount === 0) {
		const uniformByteOffset = gxGpuState.texturedUniformByteOffset;
		const vertexByteOffset = gxGpuState.texturedVertexByteOffset;
		gxGpuState.backend.device.queue.writeBuffer(gxGpuState.texturedUniformBuffer, uniformByteOffset, texturedUniformScratch);
		gxGpuState.texturedUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
		gxGpuState.texturedVertexByteOffset += vertexFloatCount * 4;
		renderVramVertices(gxGpuState.texturedPipeline, gxGpuState.texturedBindGroup, gxGpuState.texturedVertexBuffer, gxGpuTexturedVertices, vertexFloatCount, GX_GPU_TEXTURED_VERTEX_FLOATS, vertexByteOffset, uniformByteOffset, topLeftWord, bottomRightWord);
		return;
	}
	const triangleFloatCount = GX_GPU_TEXTURED_VERTEX_FLOATS * 3;
	const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const vertexByteOffset = gxGpuState.texturedVertexByteOffset;
	gxGpuState.backend.device.queue.writeBuffer(gxGpuState.texturedVertexBuffer, vertexByteOffset, gxGpuTexturedVertices.buffer, gxGpuTexturedVertices.byteOffset, vertexFloatCount * 4);
	gxGpuState.texturedVertexByteOffset += vertexFloatCount * 4;
	gxGpuState.backend.accountUpload('vertex', vertexFloatCount * 4);
	for (let planeIndex = 0; planeIndex < gxGpuTexturedUvPlaneCount; planeIndex += 1) {
		writeTexturedUvPlaneUniforms(planeIndex);
		const uniformByteOffset = gxGpuState.texturedUniformByteOffset;
		gxGpuState.backend.device.queue.writeBuffer(gxGpuState.texturedUniformBuffer, uniformByteOffset, texturedUniformScratch);
		gxGpuState.texturedUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
		drawVramVertices(gxGpuState.texturedPipeline, gxGpuState.texturedBindGroup, gxGpuState.texturedVertexBuffer, triangleFloatCount, GX_GPU_TEXTURED_VERTEX_FLOATS, vertexByteOffset + planeIndex * triangleFloatCount * 4, uniformByteOffset, topLeftWord, bottomRightWord);
		if (readsVram && planeIndex + 1 < gxGpuTexturedUvPlaneCount) {
			copyGxGpuVertexBoundsToSampleTexture(gxGpuTexturedVertices, triangleFloatCount, GX_GPU_TEXTURED_VERTEX_FLOATS, topLeftWord, bottomRightWord);
		}
	}
}

function renderTransferCommands(vertexFloatCount: number, bindGroup: GPUBindGroup, maskBitModeWord: number): void {
	if (vertexFloatCount === 0) return;
	transferUniformScratch[0] = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0;
	transferUniformScratch[1] = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0;
	transferUniformScratch[2] = 0;
	transferUniformScratch[3] = 0;
	const uniformByteOffset = gxGpuState.transferUniformByteOffset;
	const vertexByteOffset = gxGpuState.transferVertexByteOffset;
	gxGpuState.backend.device.queue.writeBuffer(gxGpuState.transferUniformBuffer, uniformByteOffset, transferUniformScratch);
	gxGpuState.transferUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
	gxGpuState.transferVertexByteOffset += vertexFloatCount * 4;
	renderVramVertices(gxGpuState.transferPipeline, bindGroup, gxGpuState.transferVertexBuffer, gxGpuTransferVertices, vertexFloatCount, GX_GPU_TRANSFER_VERTEX_FLOATS, vertexByteOffset, uniformByteOffset, GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD, GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD);
}

function uploadCpuToVram(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
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
	invalidateGxGpuSampleSourceCacheForWrite(x, y, x + width, y + uploadHeight);
	const targetTexture = maskBitModeWord === 0 ? gxGpuState.vramTexture : gxGpuState.vramTransferTexture;
	for (let row = 0; row < uploadHeight; row += 1) {
		const rowWidth = row === fullRows ? lastRowWidth : width;
		writeCpuToVramUploadRow(commandBuffer, payloadWordStart, row * width, rowWidth);
		const targetY = (y + row) & (GX_GPU_VRAM_HEIGHT - 1);
		const firstWidth = gxGpuVramWrappedWidth(x, rowWidth);
		gxGpuState.vramUploadDestination.texture = targetTexture;
		gxGpuState.vramUploadDestinationOrigin.x = x;
		gxGpuState.vramUploadDestinationOrigin.y = targetY;
		gxGpuState.vramUploadLayout.offset = 0;
		gxGpuState.vramUploadExtent.width = firstWidth;
		gxGpuState.vramUploadExtent.height = 1;
		gxGpuState.backend.device.queue.writeTexture(gxGpuState.vramUploadDestination, gxGpuRawVramUploadRow, gxGpuState.vramUploadLayout, gxGpuState.vramUploadExtent);
		if (maskBitModeWord !== 0) transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, x, targetY, firstWidth, 1, x, targetY);
		if (firstWidth !== rowWidth) {
			gxGpuState.vramUploadDestinationOrigin.x = 0;
			gxGpuState.vramUploadLayout.offset = firstWidth * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
			gxGpuState.vramUploadExtent.width = rowWidth - firstWidth;
			gxGpuState.backend.device.queue.writeTexture(gxGpuState.vramUploadDestination, gxGpuRawVramUploadRow, gxGpuState.vramUploadLayout, gxGpuState.vramUploadExtent);
			if (maskBitModeWord !== 0) transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, 0, targetY, rowWidth - firstWidth, 1, 0, targetY);
		}
	}
	gxGpuState.backend.accountUpload('texture', uploadedPixels * 4);
	if (maskBitModeWord !== 0) {
		if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) copyGxGpuVramLogicalAreaToSampleTexture(x, y, width, uploadHeight);
		renderTransferCommands(transferVertexFloatCount, gxGpuState.transferFromUploadBindGroup, maskBitModeWord);
	}
}

function copyVramToVramArea(sourceX: number, sourceY: number, targetX: number, targetY: number, width: number, height: number, maskBitModeWord: number): void {
	invalidateGxGpuSampleSourceCacheForWrite(targetX, targetY, targetX + width, targetY + height);
	let transferVertexFloatCount = 0;
	for (let row = 0; row < height; row += 1) {
		const rowSourceY = (sourceY + row) & (GX_GPU_VRAM_HEIGHT - 1);
		const rowTargetY = (targetY + row) & (GX_GPU_VRAM_HEIGHT - 1);
		let rowSourceX = sourceX;
		let rowTargetX = targetX;
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const sourceRunWidth = gxGpuVramWrappedWidth(rowSourceX, remainingWidth);
			const targetRunWidth = gxGpuVramWrappedWidth(rowTargetX, remainingWidth);
			const runWidth = sourceRunWidth < targetRunWidth ? sourceRunWidth : targetRunWidth;
			transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, rowTargetX, rowTargetY, runWidth, 1, rowSourceX, rowSourceY);
			rowSourceX = (rowSourceX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			rowTargetX = (rowTargetX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			remainingWidth -= runWidth;
		}
	}
	copyGxGpuVramLogicalAreaToSampleTexture(sourceX, sourceY, width, height);
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) copyGxGpuVramLogicalAreaToSampleTexture(targetX, targetY, width, height);
	renderTransferCommands(transferVertexFloatCount, gxGpuState.transferFromSampleBindGroup, maskBitModeWord);
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

function renderSolidCommand(commandBuffer: GxGpuCommandBufferView, commandIndex: number, topLeftWord: number, bottomRightWord: number): void {
	let vertexFloatCount = 0;
	switch (commandBuffer.commandKind[commandIndex]) {
		case GX_GPU_COMMAND_DRAW_POLYGON:
			vertexFloatCount = appendSolidPolygon(commandBuffer, commandIndex, vertexFloatCount);
			break;
		case GX_GPU_COMMAND_DRAW_RECTANGLE:
			vertexFloatCount = appendSolidRectangle(commandBuffer, commandIndex, vertexFloatCount);
			break;
		default:
			vertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, vertexFloatCount);
			break;
	}
	if (vertexFloatCount === 0) return;
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const maskBitModeWord = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_FILL_RECTANGLE ? 0 : commandBuffer.commandMaskBitModeWord[commandIndex];
	const blendEnabled = commandBuffer.commandKind[commandIndex] !== GX_GPU_COMMAND_FILL_RECTANGLE && gxGpuCommandSemiTransparencyEnabled(opcode);
	const blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0;
	const ditherEnabled = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode);
	const readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	if (readsVram
		&& commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
		&& gxGpuCommandQuadPolygon(opcode)
		&& vertexFloatCount === GX_GPU_SOLID_TRIANGLE_FLOATS * 2) {
		renderReadVramSolidQuad(topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, commandBuffer.commandInterlacedRenderWord[commandIndex]);
		return;
	}
	if (readsVram) copyGxGpuVertexBoundsToSampleTexture(gxGpuSolidVertices, vertexFloatCount, GX_GPU_SOLID_VERTEX_FLOATS, topLeftWord, bottomRightWord);
	renderSolidVertices(vertexFloatCount, topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, commandBuffer.commandInterlacedRenderWord[commandIndex]);
}

function flushLineCommands(vertexFloatCount: number, topLeftWord: number, bottomRightWord: number, readsVram: boolean, uniformByteOffset: number): number {
	if (vertexFloatCount !== 0) {
		if (readsVram) copyGxGpuVramAreaToSampleTexture(gxGpuLineBatchRect.left, gxGpuLineBatchRect.top, gxGpuLineBatchRect.right, gxGpuLineBatchRect.bottom);
		renderLineVertices(vertexFloatCount, topLeftWord, bottomRightWord, uniformByteOffset);
	}
	return 0;
}

function appendBatchedLineSegment(vertexFloatCount: number, topLeftWord: number, bottomRightWord: number, readsVram: boolean, uniformByteOffset: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number): number {
	let offset = vertexFloatCount;
	if (offset + GX_GPU_LINE_SEGMENT_FLOATS > GX_GPU_LINE_FLOAT_CAPACITY) {
		offset = flushLineCommands(offset, topLeftWord, bottomRightWord, readsVram, uniformByteOffset);
		resetGxGpuVramCopyRect(gxGpuLineBatchRect);
	}
	const commandVertexStart = offset;
	offset = appendLineSegment(offset, x0, y0, color0, x1, y1, color1);
	if (readsVram && offset !== commandVertexStart) {
		setGxGpuVertexBoundsRect(gxGpuLineCommandRect, gxGpuLineVertices, commandVertexStart, offset, GX_GPU_LINE_VERTEX_FLOATS, topLeftWord, bottomRightWord);
		if (commandVertexStart !== 0 && gxGpuVramCopyRectsOverlap(gxGpuLineBatchRect, gxGpuLineCommandRect)) {
			offset = flushLineCommands(commandVertexStart, topLeftWord, bottomRightWord, readsVram, uniformByteOffset);
			resetGxGpuVramCopyRect(gxGpuLineBatchRect);
			offset = appendLineSegment(offset, x0, y0, color0, x1, y1, color1);
			setGxGpuVertexBoundsRect(gxGpuLineCommandRect, gxGpuLineVertices, 0, offset, GX_GPU_LINE_VERTEX_FLOATS, topLeftWord, bottomRightWord);
		}
		includeGxGpuVramCopyRect(gxGpuLineBatchRect, gxGpuLineCommandRect);
	}
	return offset;
}

function renderLineCommand(commandBuffer: GxGpuCommandBufferView, commandIndex: number, topLeftWord: number, bottomRightWord: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const wordEnd = wordStart + commandBuffer.commandWordCount[commandIndex];
	const words = commandBuffer.words;
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const dy = gxGpuDrawingOffsetY(drawingOffsetWord);
	const dx = gxGpuSigned11(drawingOffsetWord);
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
	const blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0;
	const ditherEnabled = gxGpuDrawModeDitherEnabled(drawModeWord);
	const interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
	const readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	writePrimitiveUniforms(blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord);
	const uniformByteOffset = gxGpuState.primitiveUniformByteOffset;
	gxGpuState.backend.device.queue.writeBuffer(gxGpuState.primitiveUniformBuffer, uniformByteOffset, primitiveUniformScratch);
	gxGpuState.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
	let vertexFloatCount = 0;
	resetGxGpuVramCopyRect(gxGpuLineBatchRect);
	if (commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_LINE) {
		const color0 = words[wordStart];
		const xy0 = words[wordStart + 1];
		if (gxGpuCommandGouraud(opcode)) {
			const color1 = words[wordStart + 2];
			const xy1 = words[wordStart + 3];
			vertexFloatCount = appendBatchedLineSegment(vertexFloatCount, topLeftWord, bottomRightWord, readsVram, uniformByteOffset, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1);
		} else {
			const xy1 = words[wordStart + 2];
			vertexFloatCount = appendBatchedLineSegment(vertexFloatCount, topLeftWord, bottomRightWord, readsVram, uniformByteOffset, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color0);
		}
	} else if (gxGpuCommandGouraud(opcode)) {
		let color0 = words[wordStart];
		let xy0 = words[wordStart + 1];
		for (let wordIndex = wordStart + 2; wordIndex + 1 < wordEnd; wordIndex += 2) {
			const color1 = words[wordIndex];
			const xy1 = words[wordIndex + 1];
			vertexFloatCount = appendBatchedLineSegment(vertexFloatCount, topLeftWord, bottomRightWord, readsVram, uniformByteOffset, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1);
			color0 = color1;
			xy0 = xy1;
		}
	} else {
		const color = words[wordStart];
		let xy0 = words[wordStart + 1];
		for (let wordIndex = wordStart + 2; wordIndex < wordEnd; wordIndex += 1) {
			const xy1 = words[wordIndex];
			vertexFloatCount = appendBatchedLineSegment(vertexFloatCount, topLeftWord, bottomRightWord, readsVram, uniformByteOffset, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color);
			xy0 = xy1;
		}
	}
	flushLineCommands(vertexFloatCount, topLeftWord, bottomRightWord, readsVram, uniformByteOffset);
	resetGxGpuVramCopyRect(gxGpuLineBatchRect);
}

function executeNewGxGpuCommands(commandBuffer: GxGpuCommandBufferView, readback: GxGpuVramSource['readbackPort']): void {
	let commandIndex = gxGpuState.processedCommandCount;
	const presentCommandCount = commandBuffer.presentCommandCount;
	const readbackCanSubmit = gxGpuState.gpureadCompletion === null
		&& readback.phase === GX_GPU_READBACK_PENDING
		&& commandBuffer.presentCommandCount === readback.fenceCommandCount;
	if (commandIndex === presentCommandCount && !readbackCanSubmit) {
		return;
	}
	const encoder = gxGpuState.backend.device.createCommandEncoder();
	gxGpuState.activeEncoder = encoder;
	gxGpuState.solidVertexByteOffset = 0;
	gxGpuState.lineVertexByteOffset = 0;
	gxGpuState.texturedVertexByteOffset = 0;
	gxGpuState.transferVertexByteOffset = 0;
	gxGpuState.primitiveUniformByteOffset = 0;
	gxGpuState.texturedUniformByteOffset = 0;
	gxGpuState.transferUniformByteOffset = 0;
	for (; commandIndex < presentCommandCount; commandIndex += 1) {
		const topLeftWord = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_FILL_RECTANGLE ? GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD : commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
		const bottomRightWord = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_FILL_RECTANGLE ? GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD : commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
		switch (commandBuffer.commandKind[commandIndex]) {
			case GX_GPU_COMMAND_DRAW_POLYGON:
			case GX_GPU_COMMAND_DRAW_RECTANGLE:
				if (gxGpuCommandDrawsTexture(commandBuffer.commandOpcode[commandIndex], commandBuffer.commandDrawModeWord[commandIndex])) renderTexturedCommand(commandBuffer, commandIndex, topLeftWord, bottomRightWord);
				else renderSolidCommand(commandBuffer, commandIndex, topLeftWord, bottomRightWord);
				break;
			case GX_GPU_COMMAND_FILL_RECTANGLE:
				renderSolidCommand(commandBuffer, commandIndex, topLeftWord, bottomRightWord);
				break;
			case GX_GPU_COMMAND_DRAW_LINE:
			case GX_GPU_COMMAND_DRAW_POLYLINE:
				renderLineCommand(commandBuffer, commandIndex, topLeftWord, bottomRightWord);
				break;
			case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
				copyVramToVram(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
				uploadCpuToVram(commandBuffer, commandIndex);
				break;
		}
	}
	let readbackSubmitted = false;
	if (gxGpuState.gpureadCompletion === null && readback.claimReadback(commandBuffer.presentCommandCount)) {
		const pixelCount = readback.width * readback.height;
		const wordCount = (pixelCount + 1) >> 1;
		const packedWidth = wordCount < GX_GPU_READBACK_PACK_WIDTH ? wordCount : GX_GPU_READBACK_PACK_WIDTH;
		const packedHeight = ((wordCount - 1) / packedWidth | 0) + 1;
		readbackUniformScratch[0] = readback.x;
		readbackUniformScratch[1] = readback.y;
		readbackUniformScratch[2] = readback.width;
		readbackUniformScratch[3] = packedWidth;
		gxGpuState.backend.device.queue.writeBuffer(gxGpuState.gpureadUniformBuffer, 0, readbackUniformScratch);
		const pass = encoder.beginRenderPass(gxGpuState.gpureadPassDescriptor);
		pass.setViewport(0, 0, packedWidth, packedHeight, 0, 1);
		pass.setScissorRect(0, 0, packedWidth, packedHeight);
		pass.setPipeline(gxGpuState.gpureadPipeline);
		pass.setBindGroup(0, gxGpuState.gpureadBindGroup);
		pass.draw(3);
		pass.end();
		gxGpuState.gpureadDestination.bytesPerRow = (packedWidth * 4 + 255) & ~255;
		gxGpuState.gpureadDestination.rowsPerImage = packedHeight;
		gxGpuState.gpureadExtent.width = packedWidth;
		gxGpuState.gpureadExtent.height = packedHeight;
		encoder.copyTextureToBuffer(gxGpuState.gpureadSource, gxGpuState.gpureadDestination, gxGpuState.gpureadExtent);
		gxGpuState.gpureadMappedByteCount = wordCount * 4;
		gxGpuState.gpureadToken = readback.token;
		gxGpuState.gpureadPort = readback;
		readbackSubmitted = true;
	}
	gxGpuState.submitCommandBuffers[0] = encoder.finish();
	gxGpuState.backend.device.queue.submit(gxGpuState.submitCommandBuffers);
	gxGpuState.activeEncoder = undefined;
	gxGpuState.processedCommandCount = presentCommandCount;
	if (readbackSubmitted) {
		gxGpuState.gpureadCompletion = gxGpuState.gpureadBuffer.mapAsync(GPUMapMode.READ, 0, gxGpuState.gpureadMappedByteCount).then(completeGxGpuReadback);
	}
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
	executeNewGxGpuCommands(commandBuffer, source.readbackPort);
}

function completeGxGpuReadback(): void {
	const readback = gxGpuState.gpureadPort!;
	if (readback.phase !== GX_GPU_READBACK_SUBMITTED || readback.token !== gxGpuState.gpureadToken) {
		gxGpuState.gpureadBuffer.unmap();
		gxGpuState.gpureadPort = null;
		gxGpuState.gpureadCompletion = null;
		return;
	}
	readback.pixelBytes.set(new Uint8Array(gxGpuState.gpureadBuffer.getMappedRange(0, gxGpuState.gpureadMappedByteCount)));
	gxGpuState.gpureadBuffer.unmap();
	readback.completeReadback(gxGpuState.gpureadToken);
	gxGpuState.gpureadPort = null;
	gxGpuState.gpureadCompletion = null;
}

function scanoutGxGpuVram(state: RenderPassStateRegistry['gx_gpu']): void {
	const target = state.targetColorTex as GPUTexture;
	const device = gxGpuState.backend.device;
	const clearOnly = (state.statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) !== 0;
	if (!clearOnly) {
		scanoutUniformScratch[0] = gxGpuDisplayStartX(state.displayStartWord);
		scanoutUniformScratch[1] = gxGpuDisplayStartY(state.displayStartWord);
		scanoutUniformScratch[2] = gxGpuHorizontalVisibleColumns(state.horizontalDisplayRangeWord, state.displayModeWord);
		scanoutUniformScratch[3] = gxGpuVerticalVisibleLines(state.verticalDisplayRangeWord, state.displayModeWord);
		scanoutUniformScratch[4] = (state.displayModeWord & GX_GPU_DISPLAY_MODE_RGB24_BIT) !== 0 ? 1 : 0;
		device.queue.writeBuffer(gxGpuState.scanoutUniformBuffer, 0, scanoutUniformScratch);
	}
	if (gxGpuState.scanoutTargetTexture !== target) {
		gxGpuState.scanoutTargetTexture = target;
		gxGpuState.scanoutTargetView = target.createView();
	}
	gxGpuState.scanoutColorAttachment.view = gxGpuState.scanoutTargetView;
	gxGpuState.scanoutColorAttachment.loadOp = clearOnly ? 'clear' : 'load';
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginRenderPass(gxGpuState.scanoutPassDescriptor);
	if (!clearOnly) {
		pass.setPipeline(gxGpuState.scanoutPipeline);
		gxGpuDynamicUniformOffsets[0] = 0;
		pass.setBindGroup(0, gxGpuState.scanoutBindGroup, gxGpuDynamicUniformOffsets);
		pass.draw(3);
	}
	pass.end();
	gxGpuState.submitCommandBuffers[0] = encoder.finish();
	device.queue.submit(gxGpuState.submitCommandBuffers);
}

function renderGxGpuPass(state: RenderPassStateRegistry['gx_gpu']): void {
	executeGxGpuVramCommands(state);
	scanoutGxGpuVram(state);
}

function writeGxGpuState(ctx: RenderGraphPassContext, state: RenderPassStateRegistry['gx_gpu']): void {
	state.width = ctx.view.offscreenCanvasSize.x;
	state.height = ctx.view.offscreenCanvasSize.y;
	state.commandBuffer = ctx.view.gxGpuCommandBuffer;
	state.readbackPort = ctx.view.gxGpuReadbackPort;
	state.statusWord = ctx.view.gxGpuStatusWord;
	state.displayModeWord = ctx.view.gxGpuDisplayModeWord;
	state.displayStartWord = ctx.view.gxGpuDisplayStartWord;
	state.horizontalDisplayRangeWord = ctx.view.gxGpuHorizontalDisplayRangeWord;
	state.verticalDisplayRangeWord = ctx.view.gxGpuVerticalDisplayRangeWord;
	state.vramSnapshotBytes = ctx.view.gxGpuVramSnapshotBytes;
	state.vramSnapshotSerial = ctx.view.gxGpuVramSnapshotSerial;
	state.targetColorTex = ctx.getTex('frame_color');
}

export function registerGxGpuPass(registry: RenderPassLibrary): void {
	const gxGpuPipelineState: RenderPassStateRegistry['gx_gpu'] = {
		width: 0,
		height: 0,
		commandBuffer: registry.view.gxGpuCommandBuffer,
		readbackPort: registry.view.gxGpuReadbackPort,
		statusWord: registry.view.gxGpuStatusWord,
		displayModeWord: registry.view.gxGpuDisplayModeWord,
		displayStartWord: registry.view.gxGpuDisplayStartWord,
		horizontalDisplayRangeWord: registry.view.gxGpuHorizontalDisplayRangeWord,
		verticalDisplayRangeWord: registry.view.gxGpuVerticalDisplayRangeWord,
		vramSnapshotBytes: registry.view.gxGpuVramSnapshotBytes,
		vramSnapshotSerial: registry.view.gxGpuVramSnapshotSerial,
		targetColorTex: null,
	};
	registry.register({
		id: 'gx_gpu',
		name: 'GXGPU (WebGPU)',
		stateOnly: true,
		initialState: gxGpuPipelineState,
		graph: { writes: ['frame_color'], writeState: writeGxGpuState },
		bootstrap: (backend) => bootstrapGxGpuPass(backend as WebGPUBackend),
		exec: (_backend: WebGPUBackend, _fbo, state: RenderPassStateRegistry['gx_gpu']) => renderGxGpuPass(state),
	});
}

export async function captureRenderedVramSnapshot(gxGpu: GxGpu, output: GxGpuVramSource): Promise<void> {
	executeGxGpuVramCommands(output);
	if (gxGpuState.gpureadCompletion !== null) {
		await gxGpuState.gpureadCompletion;
	}
	const device = gxGpuState.backend.device;
	const encoder = device.createCommandEncoder();
	encoder.copyTextureToBuffer(gxGpuState.vramReadbackSource, gxGpuState.vramReadbackDestination, gxGpuState.vramReadbackExtent);
	gxGpuState.submitCommandBuffers[0] = encoder.finish();
	device.queue.submit(gxGpuState.submitCommandBuffers);
	await gxGpuState.vramReadbackBuffer.mapAsync(GPUMapMode.READ);
	const readback = new Uint8Array(gxGpuState.vramReadbackBuffer.getMappedRange());
	let snapshotByteOffset = 0;
	let readbackByteOffset = 0;
	for (let pixel = 0; pixel < GX_GPU_VRAM_WIDTH * GX_GPU_VRAM_HEIGHT; pixel += 1) {
		gxGpuVramSnapshotScratch[snapshotByteOffset] = readback[readbackByteOffset];
		gxGpuVramSnapshotScratch[snapshotByteOffset + 1] = readback[readbackByteOffset + 1];
		snapshotByteOffset += 2;
		readbackByteOffset += GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
	}
	gxGpuState.vramReadbackBuffer.unmap();
	gxGpuState.vramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(gxGpuVramSnapshotScratch);
}
