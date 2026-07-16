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
	GX_GPU_SCANOUT_INTERPRETATION_MASK,
	gxGpuScanoutField,
	gxGpuScanoutSourceLineStep,
} from '../../../machine/devices/gx/gpu_display';
import {
	GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP,
	GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP,
	GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK,
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
	gxGpuVramLogicalAreaOverlapsBounds,
	gxGpuVertexY,
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
const GX_GPU_POLYGON_VERTICES_PER_COMMAND = 6;
const GX_GPU_FIXED_SOLID_VERTEX_FLOATS = 11;
const GX_GPU_FIXED_SOLID_TRIANGLE_FLOATS = 3 * GX_GPU_FIXED_SOLID_VERTEX_FLOATS;
const GX_GPU_LINE_VERTEX_FLOATS = 12;
const GX_GPU_LINE_VERTICES_PER_SEGMENT = 6;
const GX_GPU_LINE_SEGMENT_FLOATS = GX_GPU_LINE_VERTICES_PER_SEGMENT * GX_GPU_LINE_VERTEX_FLOATS;
const GX_GPU_LINE_SEGMENT_CAPACITY = 4096;
const GX_GPU_LINE_FLOAT_CAPACITY = GX_GPU_LINE_SEGMENT_CAPACITY * GX_GPU_LINE_SEGMENT_FLOATS;
const GX_GPU_TEXTURED_UV_COMPONENTS = 2;
const GX_GPU_COLOR_COMPONENTS = 3;
const GX_GPU_TEXTURED_VERTEX_FLOATS = 14;
const GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS = 17;
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
const gxGpuSolidVertexWords = new Uint32Array(gxGpuSolidVertices.buffer);
const gxGpuLineVertices = new Float32Array(GX_GPU_LINE_FLOAT_CAPACITY);
const gxGpuTexturedVertices = new Float32Array(GX_GPU_TEXTURED_FLOAT_CAPACITY);
const gxGpuTexturedVertexWords = new Uint32Array(gxGpuTexturedVertices.buffer);
const gxGpuTexturedUvPlane = new Float64Array(GX_GPU_TEXTURED_UV_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
const gxGpuColorPlane = new Float64Array(GX_GPU_COLOR_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
const gxGpuTransferVertices = new Float32Array(GX_GPU_TRANSFER_FLOAT_CAPACITY);
const gxGpuRawVramUpload = new Uint8Array(GX_GPU_RAW_VRAM_UPLOAD_BYTES);
const gxGpuVramSnapshotScratch = new Uint8Array(GX_GPU_VRAM_BYTE_COUNT);
const primitiveUniformScratch = new Float32Array(8);
const texturedUniformScratch = new Float32Array(16);
const transferUniformScratch = new Float32Array(4);
const scanoutUniformScratch = new Uint32Array(4);
const readbackUniformScratch = new Uint32Array(GX_GPU_READBACK_UNIFORM_BYTES >> 2);
const gxGpuDynamicUniformOffsets = new Uint32Array(1);
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

type GxGpuPrimitiveBatchState = {
	topLeftWord: number;
	bottomRightWord: number;
	maskBitModeWord: number;
	ditherEnabled: boolean;
	interlacedRenderWord: number;
	blendEnabled: boolean;
	blendMode: number;
	readsVram: boolean;
};

type GxGpuSolidBatchState = GxGpuPrimitiveBatchState & {
	fixedColor: boolean;
};

type GxGpuLineBatchState = GxGpuPrimitiveBatchState & {
	uniformByteOffset: number;
	spansPhysicalRowBands: boolean;
};

type GxGpuVramSource = Pick<GxGpuDeviceOutput, 'commandBuffer' | 'readbackPort' | 'vramSnapshotBytes' | 'vramSnapshotSerial'>;

type WebGpuGxGpuState = {
	backend: WebGPUBackend;
	activeEncoder?: GPUCommandEncoder;
	submitCommandBuffers: GPUCommandBuffer[];
	vramDrawPassDescriptor: GPURenderPassDescriptor;
	scanoutPassDescriptor: GPURenderPassDescriptor;
	scanoutColorAttachment: GPURenderPassColorAttachment;
	scanoutFieldsPassDescriptor?: GPURenderPassDescriptor;
	scanoutFieldsColorAttachment?: GPURenderPassColorAttachment;
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
	scanoutBindGroupLayout: GPUBindGroupLayout;
	solidPipeline: GPURenderPipeline;
	fixedSolidPipeline: GPURenderPipeline;
	linePipeline: GPURenderPipeline;
	texturedPipeline: GPURenderPipeline;
	fixedTexturedPipeline: GPURenderPipeline;
	transferPipeline: GPURenderPipeline;
	scanoutPipeline: GPURenderPipeline;
	scanoutFieldPipeline: GPURenderPipeline;
	scanoutWeavePipeline: GPURenderPipeline;
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
	scanoutFieldsTexture?: GPUTexture;
	scanoutFieldsBindGroup?: GPUBindGroup;
	scanoutTargetTexture?: GPUTexture;
	scanoutTargetView: GPUTextureView;
	scanoutUniformDisplayStartWord: number;
	scanoutUniformDisplayModeWord: number;
	scanoutUniformFieldHeight: number;
	scanoutUniformDisplayDisableWord: number;
	scanoutFieldsWidth: number;
	scanoutFieldsHeight: number;
	scanoutFieldsDisplayStartWord: number;
	scanoutFieldsInterpretationWord: number;
	scanoutFieldsVramSnapshotSerial: bigint;
	scanoutFieldsValid: boolean;
	processedCommandCount: number;
	processedCommandSerial: number;
	vramSnapshotSerial: bigint;
};

const gxGpuVramCopyRectScratch: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuSolidBatchRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuSolidCommandRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuTexturedCommandRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuTexturedBatchRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuLineBatchRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuLineCommandRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuSampleDirtyRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuRectangleScratch: GxGpuRectangle = { x0: 0, y0: 0, x1: 0, y1: 0, width: 0, height: 0 };
const gxGpuSolidBatchState: GxGpuSolidBatchState = {
	topLeftWord: 0,
	bottomRightWord: 0,
	maskBitModeWord: 0,
	ditherEnabled: false,
	interlacedRenderWord: 0,
	blendEnabled: false,
	blendMode: 0,
	readsVram: false,
	fixedColor: false,
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
	uniformByteOffset: 0,
	spansPhysicalRowBands: false,
};

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

function createPipeline(device: GPUDevice, label: string, module: GPUShaderModule, bindGroupLayout: GPUBindGroupLayout, vertexBuffer: GPUVertexBufferLayout, targetFormat: GPUTextureFormat, vertexEntryPoint: string, fragmentEntryPoint: string): GPURenderPipeline {
	return device.createRenderPipeline({
		label,
		layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
		vertex: { module, entryPoint: vertexEntryPoint, buffers: [vertexBuffer] },
		fragment: { module, entryPoint: fragmentEntryPoint, targets: [{ format: targetFormat }] },
		primitive: { topology: 'triangle-list' },
	});
}

function createScanoutPipeline(device: GPUDevice, module: GPUShaderModule, bindGroupLayout: GPUBindGroupLayout, label: string, fragmentEntryPoint: string): GPURenderPipeline {
	return device.createRenderPipeline({
		label,
		layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
		vertex: { module, entryPoint: 'vs_main' },
		fragment: { module, entryPoint: fragmentEntryPoint, targets: [{ format: 'bgra8unorm' }] },
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
	const solidModule = device.createShaderModule({ label: 'gx_gpu_solid', code: solidShaderCode });
	const lineModule = device.createShaderModule({ label: 'gx_gpu_line', code: lineShaderCode });
	const texturedModule = device.createShaderModule({ label: 'gx_gpu_textured', code: texturedShaderCode });
	const transferModule = device.createShaderModule({ label: 'gx_gpu_transfer', code: transferShaderCode });
	const scanoutModule = device.createShaderModule({ label: 'gx_gpu_scanout', code: scanoutShaderCode });
	const solidPipeline = createPipeline(device, 'gx_gpu_solid', solidModule, primitiveLayout, {
		arrayStride: GX_GPU_SOLID_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'float32x4' },
		],
	}, 'rgba8unorm', 'vs_main', 'fs_main');
	const fixedSolidPipeline = createPipeline(device, 'gx_gpu_fixed_solid', solidModule, primitiveLayout, {
		arrayStride: GX_GPU_FIXED_SOLID_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'uint32x3' },
			{ shaderLocation: 2, offset: 5 * 4, format: 'uint32x3' },
			{ shaderLocation: 3, offset: 8 * 4, format: 'uint32x3' },
		],
	}, 'rgba8unorm', 'vs_fixed', 'fs_fixed');
	const linePipeline = createPipeline(device, 'gx_gpu_line', lineModule, primitiveLayout, {
		arrayStride: GX_GPU_LINE_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'float32x2' },
			{ shaderLocation: 2, offset: 4 * 4, format: 'float32x2' },
			{ shaderLocation: 3, offset: 6 * 4, format: 'float32x3' },
			{ shaderLocation: 4, offset: 9 * 4, format: 'float32x3' },
		],
	}, 'rgba8unorm', 'vs_main', 'fs_main');
	const texturedPipeline = createPipeline(device, 'gx_gpu_textured', texturedModule, primitiveLayout, {
		arrayStride: GX_GPU_TEXTURED_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'float32x3' },
			{ shaderLocation: 2, offset: 5 * 4, format: 'float32x2' },
			{ shaderLocation: 3, offset: 7 * 4, format: 'uint32' },
			{ shaderLocation: 4, offset: 8 * 4, format: 'uint32x2' },
			{ shaderLocation: 5, offset: 10 * 4, format: 'uint32x2' },
			{ shaderLocation: 6, offset: 12 * 4, format: 'uint32x2' },
		],
	}, 'rgba8unorm', 'vs_main', 'fs_main');
	const fixedTexturedPipeline = createPipeline(device, 'gx_gpu_fixed_textured', texturedModule, primitiveLayout, {
		arrayStride: GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'uint32x2' },
			{ shaderLocation: 2, offset: 4 * 4, format: 'uint32x2' },
			{ shaderLocation: 3, offset: 6 * 4, format: 'uint32x2' },
			{ shaderLocation: 4, offset: 8 * 4, format: 'uint32x3' },
			{ shaderLocation: 5, offset: 11 * 4, format: 'uint32x3' },
			{ shaderLocation: 6, offset: 14 * 4, format: 'uint32x3' },
		],
	}, 'rgba8unorm', 'vs_fixed', 'fs_fixed');
	const transferPipeline = createPipeline(device, 'gx_gpu_transfer', transferModule, transferLayout, {
		arrayStride: GX_GPU_TRANSFER_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'float32x2' },
		],
	}, 'rgba8unorm', 'vs_main', 'fs_main');
	const scanoutPipeline = createScanoutPipeline(device, scanoutModule, primitiveLayout, 'gx_gpu_scanout', 'fs_main');
	const scanoutFieldPipeline = createScanoutPipeline(device, scanoutModule, primitiveLayout, 'gx_gpu_scanout_field', 'fs_interlaced_field');
	const scanoutWeavePipeline = createScanoutPipeline(device, scanoutModule, primitiveLayout, 'gx_gpu_scanout_weave', 'fs_interlaced_weave');
	const gpureadPipeline = createReadbackPipeline(device, readbackLayout);
	const solidVertexBuffer = device.createBuffer({ size: gxGpuSolidVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const lineVertexBuffer = device.createBuffer({ size: gxGpuLineVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const texturedVertexBuffer = device.createBuffer({ size: gxGpuTexturedVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const transferVertexBuffer = device.createBuffer({ size: gxGpuTransferVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const primitiveUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_BUFFER_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const texturedUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_BUFFER_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const transferUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_BUFFER_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const scanoutUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_SLOT_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const gpureadUniformBuffer = device.createBuffer({ size: GX_GPU_READBACK_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const vramReadbackBuffer = device.createBuffer({ size: GX_GPU_RAW_VRAM_UPLOAD_BYTES, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const gpureadBuffer = device.createBuffer({ size: GX_GPU_VRAM_BYTE_COUNT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const vramDrawColorAttachment: GPURenderPassColorAttachment = { view: vramView, loadOp: 'load', storeOp: 'store' };
	const scanoutColorAttachment: GPURenderPassColorAttachment = { view: vramView, clearValue: [0, 0, 0, 1], loadOp: 'load', storeOp: 'store' };
	const gpureadColorAttachment: GPURenderPassColorAttachment = { view: gpureadView, loadOp: 'load', storeOp: 'store' };
	const vramCopySourceOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	const vramCopyDestinationOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	const vramUploadDestinationOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	gxGpuState = {
		backend,
		submitCommandBuffers: [],
		vramDrawPassDescriptor: { colorAttachments: [vramDrawColorAttachment] },
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
		scanoutBindGroupLayout: primitiveLayout,
		solidPipeline,
		fixedSolidPipeline,
		linePipeline,
		texturedPipeline,
		fixedTexturedPipeline,
		transferPipeline,
		scanoutPipeline,
		scanoutFieldPipeline,
		scanoutWeavePipeline,
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
		scanoutUniformDisplayStartWord: 0xffffffff,
		scanoutUniformDisplayModeWord: 0xffffffff,
		scanoutUniformFieldHeight: 0,
		scanoutUniformDisplayDisableWord: 0xffffffff,
		scanoutFieldsWidth: 0,
		scanoutFieldsHeight: 0,
		scanoutFieldsDisplayStartWord: 0,
		scanoutFieldsInterpretationWord: 0,
		scanoutFieldsVramSnapshotSerial: 0n,
		scanoutFieldsValid: false,
		processedCommandCount: 0,
		processedCommandSerial: 0,
		vramSnapshotSerial: 0n,
	};
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

function appendFixedSolidPrimitiveTriangle(vertexFloatCount: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number, x2: number, y2: number, color2: number): number {
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
			let offset = appendFixedSolidPrimitiveTriangle(vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2);
			if (gxGpuCommandQuadPolygon(opcode)) {
				const color3 = words[wordStart + 9];
				const xy3 = words[wordStart + 10];
				offset = appendFixedSolidPrimitiveTriangle(offset, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3);
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

function writeTexturedVertex(offset: number, x: number, y: number, colorWord: number, u: number, v: number): number {
	gxGpuTexturedVertices[offset] = x;
	gxGpuTexturedVertices[offset + 1] = y;
	gxGpuTexturedVertices[offset + 2] = (colorWord & 0xff) / 255;
	gxGpuTexturedVertices[offset + 3] = ((colorWord >>> 8) & 0xff) / 255;
	gxGpuTexturedVertices[offset + 4] = ((colorWord >>> 16) & 0xff) / 255;
	gxGpuTexturedVertices[offset + 5] = u;
	gxGpuTexturedVertices[offset + 6] = v;
	gxGpuTexturedVertexWords[offset + 7] = 0;
	return offset + GX_GPU_TEXTURED_VERTEX_FLOATS;
}

function appendTexturedTriangle(vertexFloatCount: number, x0: number, y0: number, color0: number, u0: number, v0: number, x1: number, y1: number, color1: number, u1: number, v1: number, x2: number, y2: number, color2: number, u2: number, v2: number): number {
	let offset = vertexFloatCount;
	offset = writeTexturedVertex(offset, x0, y0, color0, u0, v0);
	offset = writeTexturedVertex(offset, x1, y1, color1, u1, v1);
	offset = writeTexturedVertex(offset, x2, y2, color2, u2, v2);
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

function appendTexturedPrimitiveTriangle(vertexFloatCount: number, fixedColor: boolean, x0: number, y0: number, color0: number, u0: number, v0: number, x1: number, y1: number, color1: number, u1: number, v1: number, x2: number, y2: number, color2: number, u2: number, v2: number): number {
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
		let offset = vertexFloatCount;
		offset = writeFixedTexturedVertex(offset, x0, y0);
		offset = writeFixedTexturedVertex(offset, x1, y1);
		offset = writeFixedTexturedVertex(offset, x2, y2);
		return offset;
	}
	const offset = appendTexturedTriangle(vertexFloatCount, x0, y0, color0, u0, v0, x1, y1, color1, u1, v1, x2, y2, color2, u2, v2);
	for (let vertexOffset = vertexFloatCount; vertexOffset < offset; vertexOffset += GX_GPU_TEXTURED_VERTEX_FLOATS) {
		gxGpuTexturedVertexWords[vertexOffset + 7] = 1;
		gxGpuTexturedVertexWords[vertexOffset + 8] = gxGpuTexturedUvPlane[0];
		gxGpuTexturedVertexWords[vertexOffset + 9] = gxGpuTexturedUvPlane[1];
		gxGpuTexturedVertexWords[vertexOffset + 10] = gxGpuTexturedUvPlane[2];
		gxGpuTexturedVertexWords[vertexOffset + 11] = gxGpuTexturedUvPlane[3];
		gxGpuTexturedVertexWords[vertexOffset + 12] = gxGpuTexturedUvPlane[4];
		gxGpuTexturedVertexWords[vertexOffset + 13] = gxGpuTexturedUvPlane[5];
	}
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
		let offset = appendTexturedPrimitiveTriangle(vertexFloatCount, fixedColor, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, gxGpuTextureU(texture0), gxGpuTextureV(texture0), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2));
		if (gxGpuCommandQuadPolygon(opcode)) {
			const color3 = commandBuffer.words[wordStart + 9];
			const xy3 = commandBuffer.words[wordStart + 10];
			const texture3 = commandBuffer.words[wordStart + 11];
			offset = appendTexturedPrimitiveTriangle(offset, fixedColor, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3, gxGpuTextureU(texture3), gxGpuTextureV(texture3));
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
	let offset = appendTexturedPrimitiveTriangle(vertexFloatCount, fixedColor, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color, gxGpuTextureU(texture0), gxGpuTextureV(texture0), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, gxGpuTextureU(texture2), gxGpuTextureV(texture2));
	if (gxGpuCommandQuadPolygon(opcode)) {
		const xy3 = commandBuffer.words[wordStart + 7];
		const texture3 = commandBuffer.words[wordStart + 8];
		offset = appendTexturedPrimitiveTriangle(offset, fixedColor, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, gxGpuTextureU(texture2), gxGpuTextureV(texture2), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color, gxGpuTextureU(texture3), gxGpuTextureV(texture3));
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
	writeVramSnapshotUpload(snapshotBytes);
	gxGpuState.vramUploadDestination.texture = gxGpuState.vramTexture;
	gxGpuState.vramUploadDestinationOrigin.x = 0;
	gxGpuState.vramUploadDestinationOrigin.y = 0;
	gxGpuState.vramUploadLayout.offset = 0;
	gxGpuState.vramUploadLayout.bytesPerRow = GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES;
	gxGpuState.vramUploadLayout.rowsPerImage = GX_GPU_VRAM_HEIGHT;
	gxGpuState.vramUploadExtent.width = GX_GPU_VRAM_WIDTH;
	gxGpuState.vramUploadExtent.height = GX_GPU_VRAM_HEIGHT;
	gxGpuState.backend.device.queue.writeTexture(gxGpuState.vramUploadDestination, gxGpuRawVramUpload, gxGpuState.vramUploadLayout, gxGpuState.vramUploadExtent);
	gxGpuState.backend.accountUpload('texture', GX_GPU_RAW_VRAM_UPLOAD_BYTES);
	gxGpuSampleDirtyRect.left = 0;
	gxGpuSampleDirtyRect.top = 0;
	gxGpuSampleDirtyRect.right = GX_GPU_VRAM_WIDTH;
	gxGpuSampleDirtyRect.bottom = GX_GPU_VRAM_HEIGHT;
}

function writeCpuToVramUploadRun(
	commandBuffer: GxGpuCommandBufferView,
	payloadWordStart: number,
	sourceRowStart: number,
	sourceColumnStart: number,
	sourceStride: number,
	runWidth: number,
	runHeight: number,
	rowPitch: number,
): void {
	for (let row = 0; row < runHeight; row += 1) {
		let uploadByteOffset = row * rowPitch;
		let pixelIndex = (sourceRowStart + row) * sourceStride + sourceColumnStart;
		for (let column = 0; column < runWidth; column += 1) {
			const payloadWord = commandBuffer.words[payloadWordStart + (pixelIndex >>> 1)];
			const pixelWord = gxGpuTransferPixelWord(payloadWord, pixelIndex);
			gxGpuRawVramUpload[uploadByteOffset] = pixelWord & 0xff;
			gxGpuRawVramUpload[uploadByteOffset + 1] = (pixelWord >>> 8) & 0xff;
			gxGpuRawVramUpload[uploadByteOffset + 2] = 0;
			gxGpuRawVramUpload[uploadByteOffset + 3] = 0xff;
			uploadByteOffset += GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
			pixelIndex += 1;
		}
	}
}

function markGxGpuSampleTextureDirtyArea(left: number, top: number, right: number, bottom: number): void {
	if (right <= left || bottom <= top) return;
	if (left < gxGpuSampleDirtyRect.left) gxGpuSampleDirtyRect.left = left;
	if (top < gxGpuSampleDirtyRect.top) gxGpuSampleDirtyRect.top = top;
	if (right > gxGpuSampleDirtyRect.right) gxGpuSampleDirtyRect.right = right;
	if (bottom > gxGpuSampleDirtyRect.bottom) gxGpuSampleDirtyRect.bottom = bottom;
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
			if (syncGxGpuSampleTextureArea(columnX, rowY, columnX + runWidth, rowY + runHeight)) return;
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_WIDTH - 1);
			remainingWidth -= runWidth;
		}
		rowY = (rowY + runHeight) & (GX_GPU_VRAM_HEIGHT - 1);
		remainingHeight -= runHeight;
	}
}

function resetGxGpuVramCopyRect(rect: GxGpuVramCopyRect): void {
	rect.left = GX_GPU_VRAM_WIDTH;
	rect.top = GX_GPU_VRAM_HEIGHT * 2;
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
	if (target.right <= target.left || target.bottom <= target.top) {
		target.left = source.left;
		target.top = source.top;
		target.right = source.right;
		target.bottom = source.bottom;
		return;
	}
	if (source.right <= source.left || source.bottom <= source.top) return;
	if (source.left < target.left) target.left = source.left;
	if (source.top < target.top) target.top = source.top;
	if (source.right > target.right) target.right = source.right;
	if (source.bottom > target.bottom) target.bottom = source.bottom;
}

function gxGpuVramCopyRectsOverlap(a: GxGpuVramCopyRect, b: GxGpuVramCopyRect): boolean {
	if (a.right <= a.left || a.bottom <= a.top) return false;
	return gxGpuVramLogicalAreaOverlapsBounds(a.left, a.top, a.right - a.left, a.bottom - a.top, b.left, b.top, b.right, b.bottom);
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
	rect.right = rect.right > rect.left ? rect.right : rect.left;
	rect.bottom = rect.bottom > rect.top ? rect.bottom : rect.top;
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
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
	resetGxGpuVramCopyRect(rect);
	for (let offset = vertexFloatStart; offset < vertexFloatEnd; offset += vertexFloatStride) {
		if (fixedColor) {
			const x = gxGpuTexturedVertices[offset];
			const y = gxGpuTexturedVertices[offset + 1];
			const u = ((gxGpuTexturedVertexWords[offset + 2] + gxGpuTexturedVertexWords[offset + 4] * x + gxGpuTexturedVertexWords[offset + 6] * y) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
			const v = ((gxGpuTexturedVertexWords[offset + 3] + gxGpuTexturedVertexWords[offset + 5] * x + gxGpuTexturedVertexWords[offset + 7] * y) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
			includeGxGpuVramCopyVertex(rect, u, v);
		} else {
			includeGxGpuVramCopyVertex(rect, gxGpuTexturedVertices[offset + 5], gxGpuTexturedVertices[offset + 6]);
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

function drawVramVertices(
	pipeline: GPURenderPipeline,
	bindGroup: GPUBindGroup,
	vertexBuffer: GPUBuffer,
	vertexFloatCount: number,
	vertexFloatStride: number,
	vertexByteOffset: number,
	uniformByteOffset: number,
	drawBounds: GxGpuVramCopyRect,
	syncSampleBetweenDraws: boolean,
): void {
	const left = drawBounds.left;
	const top = drawBounds.top;
	const right = drawBounds.right;
	const bottom = drawBounds.bottom;
	if (right <= left || bottom <= top) return;
	const encoder = gxGpuState.activeEncoder!;
	gxGpuDynamicUniformOffsets[0] = uniformByteOffset;
	const vertexCount = vertexFloatCount / vertexFloatStride;
	const firstBand = top >= GX_GPU_VRAM_HEIGHT ? 1 : 0;
	const firstBandOrigin = firstBand * GX_GPU_VRAM_HEIGHT;
	if (bottom <= firstBandOrigin + GX_GPU_VRAM_HEIGHT) {
		const pass = encoder.beginRenderPass(gxGpuState.vramDrawPassDescriptor);
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup, gxGpuDynamicUniformOffsets);
		pass.setVertexBuffer(0, vertexBuffer, vertexByteOffset, vertexFloatCount * 4);
		pass.setScissorRect(left, top - firstBandOrigin, right - left, bottom - top);
		pass.draw(vertexCount, 1, 0, firstBand);
		pass.end();
		markGxGpuSampleTextureDirtyLogicalArea(left, top, right - left, bottom - top);
		return;
	}
	if (!syncSampleBetweenDraws) {
		const pass = encoder.beginRenderPass(gxGpuState.vramDrawPassDescriptor);
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup, gxGpuDynamicUniformOffsets);
		pass.setVertexBuffer(0, vertexBuffer, vertexByteOffset, vertexFloatCount * 4);
		for (let triangleFirst = 0; triangleFirst < vertexCount; triangleFirst += 3) {
			let logicalTop = top;
			while (logicalTop < bottom) {
				const band = logicalTop >= GX_GPU_VRAM_HEIGHT ? 1 : 0;
				const bandOrigin = band * GX_GPU_VRAM_HEIGHT;
				const logicalBandBottom = bandOrigin + GX_GPU_VRAM_HEIGHT;
				const logicalBottom = bottom < logicalBandBottom ? bottom : logicalBandBottom;
				pass.setScissorRect(left, logicalTop - bandOrigin, right - left, logicalBottom - logicalTop);
				pass.draw(3, 1, triangleFirst, band);
				logicalTop = logicalBottom;
			}
		}
		pass.end();
		markGxGpuSampleTextureDirtyLogicalArea(left, top, right - left, bottom - top);
		return;
	}
	let drewBand = false;
	for (let triangleFirst = 0; triangleFirst < vertexCount; triangleFirst += 3) {
		let logicalTop = top;
		while (logicalTop < bottom) {
			const band = logicalTop >= GX_GPU_VRAM_HEIGHT ? 1 : 0;
			const bandOrigin = band * GX_GPU_VRAM_HEIGHT;
			const logicalBandBottom = bandOrigin + GX_GPU_VRAM_HEIGHT;
			const logicalBottom = bottom < logicalBandBottom ? bottom : logicalBandBottom;
			if (drewBand) syncGxGpuSampleTextureLogicalArea(0, 0, GX_GPU_VRAM_WIDTH, GX_GPU_VRAM_HEIGHT);
			const pass = encoder.beginRenderPass(gxGpuState.vramDrawPassDescriptor);
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, bindGroup, gxGpuDynamicUniformOffsets);
			pass.setVertexBuffer(0, vertexBuffer, vertexByteOffset, vertexFloatCount * 4);
			pass.setScissorRect(left, logicalTop - bandOrigin, right - left, logicalBottom - logicalTop);
			pass.draw(3, 1, triangleFirst, band);
			pass.end();
			markGxGpuSampleTextureDirtyLogicalArea(left, logicalTop, right - left, logicalBottom - logicalTop);
			drewBand = true;
			logicalTop = logicalBottom;
		}
	}
}

function renderVramVertices(
	pipeline: GPURenderPipeline,
	bindGroup: GPUBindGroup,
	vertexBuffer: GPUBuffer,
	vertices: Float32Array,
	vertexFloatCount: number,
	vertexFloatStride: number,
	vertexByteOffset: number,
	uniformByteOffset: number,
	drawBounds: GxGpuVramCopyRect,
	syncSampleBetweenDraws: boolean,
): void {
	const backend = gxGpuState.backend;
	backend.device.queue.writeBuffer(vertexBuffer, vertexByteOffset, vertices.buffer, vertices.byteOffset, vertexFloatCount * 4);
	drawVramVertices(pipeline, bindGroup, vertexBuffer, vertexFloatCount, vertexFloatStride, vertexByteOffset, uniformByteOffset, drawBounds, syncSampleBetweenDraws);
	backend.accountUpload('vertex', vertexFloatCount * 4);
}

function flushSolidCommands(vertexFloatCount: number): number {
	if (vertexFloatCount !== 0) {
		const fixedColor = gxGpuSolidBatchState.fixedColor;
		const vertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
		const pipeline = fixedColor ? gxGpuState.fixedSolidPipeline : gxGpuState.solidPipeline;
		setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, gxGpuSolidVertices, 0, vertexFloatCount, vertexFloatStride, gxGpuSolidBatchState.topLeftWord, gxGpuSolidBatchState.bottomRightWord);
		const drawWidth = gxGpuVramCopyRectScratch.right - gxGpuVramCopyRectScratch.left;
		const drawHeight = gxGpuVramCopyRectScratch.bottom - gxGpuVramCopyRectScratch.top;
		if (gxGpuSolidBatchState.readsVram) syncGxGpuSampleTextureLogicalArea(gxGpuVramCopyRectScratch.left, gxGpuVramCopyRectScratch.top, drawWidth, drawHeight);
		writePrimitiveUniforms(gxGpuSolidBatchState.blendEnabled, gxGpuSolidBatchState.blendMode, gxGpuSolidBatchState.maskBitModeWord, gxGpuSolidBatchState.ditherEnabled, gxGpuSolidBatchState.interlacedRenderWord);
		const uniformByteOffset = gxGpuState.primitiveUniformByteOffset;
		const vertexByteOffset = gxGpuState.solidVertexByteOffset;
		gxGpuState.backend.device.queue.writeBuffer(gxGpuState.primitiveUniformBuffer, uniformByteOffset, primitiveUniformScratch);
		gxGpuState.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
		gxGpuState.solidVertexByteOffset += vertexFloatCount * 4;
		renderVramVertices(pipeline, gxGpuState.solidBindGroup, gxGpuState.solidVertexBuffer, gxGpuSolidVertices, vertexFloatCount, vertexFloatStride, vertexByteOffset, uniformByteOffset, gxGpuVramCopyRectScratch, gxGpuSolidBatchState.readsVram);
	}
	resetGxGpuVramCopyRect(gxGpuSolidBatchRect);
	return 0;
}

function renderReadVramSolidQuad(topLeftWord: number, bottomRightWord: number, blendEnabled: boolean, blendMode: number, maskBitModeWord: number, ditherEnabled: boolean, interlacedRenderWord: number): void {
	const fixedColor = gxGpuSolidBatchState.fixedColor;
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
	const triangleFloatCount = fixedColor ? GX_GPU_FIXED_SOLID_TRIANGLE_FLOATS : GX_GPU_SOLID_TRIANGLE_FLOATS;
	const pipeline = fixedColor ? gxGpuState.fixedSolidPipeline : gxGpuState.solidPipeline;
	setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, gxGpuSolidVertices, 0, triangleFloatCount, vertexFloatStride, topLeftWord, bottomRightWord);
	let drawLeft = gxGpuVramCopyRectScratch.left;
	let drawTop = gxGpuVramCopyRectScratch.top;
	let drawWidth = gxGpuVramCopyRectScratch.right - drawLeft;
	let drawHeight = gxGpuVramCopyRectScratch.bottom - drawTop;
	syncGxGpuSampleTextureLogicalArea(drawLeft, drawTop, drawWidth, drawHeight);
	writePrimitiveUniforms(blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord);
	const uniformByteOffset = gxGpuState.primitiveUniformByteOffset;
	const vertexByteOffset = gxGpuState.solidVertexByteOffset;
	const vertexFloatCount = triangleFloatCount * 2;
	gxGpuState.backend.device.queue.writeBuffer(gxGpuState.primitiveUniformBuffer, uniformByteOffset, primitiveUniformScratch);
	gxGpuState.backend.device.queue.writeBuffer(gxGpuState.solidVertexBuffer, vertexByteOffset, gxGpuSolidVertices.buffer, gxGpuSolidVertices.byteOffset, vertexFloatCount * 4);
	gxGpuState.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
	gxGpuState.solidVertexByteOffset += vertexFloatCount * 4;
	gxGpuState.backend.accountUpload('vertex', vertexFloatCount * 4);
	drawVramVertices(pipeline, gxGpuState.solidBindGroup, gxGpuState.solidVertexBuffer, triangleFloatCount, vertexFloatStride, vertexByteOffset, uniformByteOffset, gxGpuVramCopyRectScratch, true);
	setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, gxGpuSolidVertices, triangleFloatCount, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord);
	drawLeft = gxGpuVramCopyRectScratch.left;
	drawTop = gxGpuVramCopyRectScratch.top;
	drawWidth = gxGpuVramCopyRectScratch.right - drawLeft;
	drawHeight = gxGpuVramCopyRectScratch.bottom - drawTop;
	syncGxGpuSampleTextureLogicalArea(drawLeft, drawTop, drawWidth, drawHeight);
	drawVramVertices(pipeline, gxGpuState.solidBindGroup, gxGpuState.solidVertexBuffer, triangleFloatCount, vertexFloatStride, vertexByteOffset + triangleFloatCount * 4, uniformByteOffset, gxGpuVramCopyRectScratch, true);
}

function renderLineVertices(vertexFloatCount: number, uniformByteOffset: number, drawBounds: GxGpuVramCopyRect, readsVram: boolean): void {
	if (vertexFloatCount === 0) return;
	const vertexByteOffset = gxGpuState.lineVertexByteOffset;
	gxGpuState.lineVertexByteOffset += vertexFloatCount * 4;
	renderVramVertices(gxGpuState.linePipeline, gxGpuState.lineBindGroup, gxGpuState.lineVertexBuffer, gxGpuLineVertices, vertexFloatCount, GX_GPU_LINE_VERTEX_FLOATS, vertexByteOffset, uniformByteOffset, drawBounds, readsVram);
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
	syncSampleBetweenDraws: boolean,
): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const fixedColor = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
		&& gxGpuCommandGouraud(opcode)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
	const pipeline = fixedColor ? gxGpuState.fixedTexturedPipeline : gxGpuState.texturedPipeline;
	writeTexturedUniforms(commandBuffer, commandIndex);
	const uniformByteOffset = gxGpuState.texturedUniformByteOffset;
	const vertexByteOffset = gxGpuState.texturedVertexByteOffset;
	gxGpuState.backend.device.queue.writeBuffer(gxGpuState.texturedUniformBuffer, uniformByteOffset, texturedUniformScratch);
	gxGpuState.backend.device.queue.writeBuffer(gxGpuState.texturedVertexBuffer, vertexByteOffset, gxGpuTexturedVertices.buffer, gxGpuTexturedVertices.byteOffset, vertexFloatCount * 4);
	gxGpuState.texturedUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
	gxGpuState.texturedVertexByteOffset += vertexFloatCount * 4;
	gxGpuState.backend.accountUpload('vertex', vertexFloatCount * 4);
	if (!splitTriangles) {
		drawVramVertices(pipeline, gxGpuState.texturedBindGroup, gxGpuState.texturedVertexBuffer, vertexFloatCount, vertexFloatStride, vertexByteOffset, uniformByteOffset, gxGpuTexturedCommandRect, syncSampleBetweenDraws);
		return;
	}
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const triangleFloatCount = vertexFloatStride * 3;
	for (let vertexFloatStart = 0; vertexFloatStart < vertexFloatCount; vertexFloatStart += triangleFloatCount) {
		if (vertexFloatStart !== 0 && syncSourceBetweenTriangles) syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, 0, vertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, fixedColor);
		const vertexFloatEnd = vertexFloatStart + triangleFloatCount;
		setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, gxGpuTexturedVertices, vertexFloatStart, vertexFloatEnd, vertexFloatStride, topLeftWord, bottomRightWord);
		const drawWidth = gxGpuVramCopyRectScratch.right - gxGpuVramCopyRectScratch.left;
		const drawHeight = gxGpuVramCopyRectScratch.bottom - gxGpuVramCopyRectScratch.top;
		if (readsVram && vertexFloatStart !== 0) syncGxGpuSampleTextureLogicalArea(gxGpuVramCopyRectScratch.left, gxGpuVramCopyRectScratch.top, drawWidth, drawHeight);
		drawVramVertices(pipeline, gxGpuState.texturedBindGroup, gxGpuState.texturedVertexBuffer, triangleFloatCount, vertexFloatStride, vertexByteOffset + vertexFloatStart * 4, uniformByteOffset, gxGpuVramCopyRectScratch, syncSampleBetweenDraws);
	}
}

function renderTexturedCommand(commandBuffer: GxGpuCommandBufferView, commandIndex: number, topLeftWord: number, bottomRightWord: number): void {
	const vertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, 0);
	if (vertexFloatCount === 0) return;
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const fixedColor = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
		&& gxGpuCommandGouraud(opcode)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
	setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, gxGpuTexturedVertices, 0, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord);
	const sourceOverlaps = syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, 0, vertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, fixedColor);
	const sourceOverlapsDestination = (sourceOverlaps & GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP) !== 0;
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	if (readsVram) {
		syncGxGpuSampleTextureLogicalArea(gxGpuTexturedCommandRect.left, gxGpuTexturedCommandRect.top, gxGpuTexturedCommandRect.right - gxGpuTexturedCommandRect.left, gxGpuTexturedCommandRect.bottom - gxGpuTexturedCommandRect.top);
	}
	renderTexturedVertices(
		commandBuffer,
		commandIndex,
		vertexFloatCount,
		topLeftWord,
		bottomRightWord,
		commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON,
		sourceOverlapsDestination,
		readsVram || sourceOverlapsDestination,
	);
}

function flushTexturedCommands(commandBuffer: GxGpuCommandBufferView, vertexFloatCount: number, batchCommandIndex: number): number {
	if (vertexFloatCount !== 0) {
		const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[batchCommandIndex];
		const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[batchCommandIndex];
		const opcode = commandBuffer.commandOpcode[batchCommandIndex];
		const fixedColor = commandBuffer.commandKind[batchCommandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
			&& gxGpuCommandGouraud(opcode)
			&& !gxGpuCommandRawTextureEnabled(opcode);
		const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
		setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, gxGpuTexturedVertices, 0, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord);
		const maskBitModeWord = commandBuffer.commandMaskBitModeWord[batchCommandIndex];
		const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
		if (readsVram) syncGxGpuSampleTextureLogicalArea(gxGpuTexturedCommandRect.left, gxGpuTexturedCommandRect.top, gxGpuTexturedCommandRect.right - gxGpuTexturedCommandRect.left, gxGpuTexturedCommandRect.bottom - gxGpuTexturedCommandRect.top);
		renderTexturedVertices(commandBuffer, batchCommandIndex, vertexFloatCount, topLeftWord, bottomRightWord, readsVram, false, readsVram);
	}
	resetGxGpuVramCopyRect(gxGpuTexturedBatchRect);
	return 0;
}

function renderTransferCommands(vertexFloatCount: number, bindGroup: GPUBindGroup, maskBitModeWord: number): void {
	if (vertexFloatCount === 0) return;
	transferUniformScratch[0] = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0;
	transferUniformScratch[1] = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0;
	transferUniformScratch[2] = 0;
	transferUniformScratch[3] = 0;
	const uniformByteOffset = gxGpuState.transferUniformByteOffset;
	const vertexByteOffset = gxGpuState.transferVertexByteOffset;
	const backend = gxGpuState.backend;
	backend.device.queue.writeBuffer(gxGpuState.transferUniformBuffer, uniformByteOffset, transferUniformScratch);
	backend.device.queue.writeBuffer(gxGpuState.transferVertexBuffer, vertexByteOffset, gxGpuTransferVertices.buffer, gxGpuTransferVertices.byteOffset, vertexFloatCount * 4);
	gxGpuState.transferUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
	gxGpuState.transferVertexByteOffset += vertexFloatCount * 4;
	const pass = gxGpuState.activeEncoder!.beginRenderPass(gxGpuState.vramDrawPassDescriptor);
	pass.setPipeline(gxGpuState.transferPipeline);
	gxGpuDynamicUniformOffsets[0] = uniformByteOffset;
	pass.setBindGroup(0, bindGroup, gxGpuDynamicUniformOffsets);
	pass.setVertexBuffer(0, gxGpuState.transferVertexBuffer, vertexByteOffset, vertexFloatCount * 4);
	pass.draw(vertexFloatCount / GX_GPU_TRANSFER_VERTEX_FLOATS, 1, 0, 0);
	pass.end();
	backend.accountUpload('vertex', vertexFloatCount * 4);
}

function uploadCpuToVramRows(
	commandBuffer: GxGpuCommandBufferView,
	payloadWordStart: number,
	targetTexture: GPUTexture,
	x: number,
	y: number,
	sourceStride: number,
	sourceRowStart: number,
	rowWidth: number,
	rowCount: number,
	maskBitModeWord: number,
	transferVertexFloatCount: number,
): number {
	const device = gxGpuState.backend.device;
	let targetRunY = (y + sourceRowStart) & (GX_GPU_VRAM_HEIGHT - 1);
	let sourceRunRow = sourceRowStart;
	let remainingRows = rowCount;
	while (remainingRows !== 0) {
		const runHeight = gxGpuVramWrappedHeight(targetRunY, remainingRows);
		let targetRunX = x;
		let sourceColumnStart = 0;
		let remainingWidth = rowWidth;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(targetRunX, remainingWidth);
			const rowPitch = runWidth * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
			writeCpuToVramUploadRun(commandBuffer, payloadWordStart, sourceRunRow, sourceColumnStart, sourceStride, runWidth, runHeight, rowPitch);
			gxGpuState.vramUploadDestination.texture = targetTexture;
			gxGpuState.vramUploadDestinationOrigin.x = targetRunX;
			gxGpuState.vramUploadDestinationOrigin.y = targetRunY;
			gxGpuState.vramUploadLayout.offset = 0;
			gxGpuState.vramUploadLayout.bytesPerRow = rowPitch;
			gxGpuState.vramUploadLayout.rowsPerImage = runHeight;
			gxGpuState.vramUploadExtent.width = runWidth;
			gxGpuState.vramUploadExtent.height = runHeight;
			device.queue.writeTexture(gxGpuState.vramUploadDestination, gxGpuRawVramUpload, gxGpuState.vramUploadLayout, gxGpuState.vramUploadExtent);
			if (maskBitModeWord !== 0) {
				transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, targetRunX, targetRunY, runWidth, runHeight, targetRunX, targetRunY);
			}
			remainingWidth -= runWidth;
			sourceColumnStart += runWidth;
			targetRunX = 0;
		}
		remainingRows -= runHeight;
		sourceRunRow += runHeight;
		targetRunY = 0;
	}
	return transferVertexFloatCount;
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
	const device = gxGpuState.backend.device;
	gxGpuState.submitCommandBuffers[0] = gxGpuState.activeEncoder!.finish();
	device.queue.submit(gxGpuState.submitCommandBuffers);
	gxGpuState.activeEncoder = device.createCommandEncoder();
	const targetTexture = maskBitModeWord === 0 ? gxGpuState.vramTexture : gxGpuState.vramTransferTexture;
	if (fullRows !== 0) {
		transferVertexFloatCount = uploadCpuToVramRows(commandBuffer, payloadWordStart, targetTexture, x, y, width, 0, width, fullRows, maskBitModeWord, transferVertexFloatCount);
	}
	if (lastRowWidth !== 0) {
		transferVertexFloatCount = uploadCpuToVramRows(commandBuffer, payloadWordStart, targetTexture, x, y, width, fullRows, lastRowWidth, 1, maskBitModeWord, transferVertexFloatCount);
	}
	gxGpuState.backend.accountUpload('texture', uploadedPixels * 4);
	if (maskBitModeWord !== 0) {
		if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) syncGxGpuSampleTextureLogicalArea(x, y, width, uploadHeight);
		renderTransferCommands(transferVertexFloatCount, gxGpuState.transferFromUploadBindGroup, maskBitModeWord);
	}
	if (fullRows !== 0) markGxGpuSampleTextureDirtyLogicalArea(x, y, width, fullRows);
	if (lastRowWidth !== 0) markGxGpuSampleTextureDirtyLogicalArea(x, y + fullRows, lastRowWidth, 1);
}

function copyVramToVramArea(sourceX: number, sourceY: number, targetX: number, targetY: number, width: number, height: number, maskBitModeWord: number): void {
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
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) syncGxGpuSampleTextureLogicalArea(targetX, targetY, width, height);
	renderTransferCommands(transferVertexFloatCount, gxGpuState.transferFromSampleBindGroup, maskBitModeWord);
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

function flushLineCommands(vertexFloatCount: number): number {
	if (vertexFloatCount !== 0) {
		setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, gxGpuLineVertices, 0, vertexFloatCount, GX_GPU_LINE_VERTEX_FLOATS, gxGpuLineBatchState.topLeftWord, gxGpuLineBatchState.bottomRightWord);
		if (gxGpuLineBatchState.readsVram) syncGxGpuSampleTextureLogicalArea(gxGpuVramCopyRectScratch.left, gxGpuVramCopyRectScratch.top, gxGpuVramCopyRectScratch.right - gxGpuVramCopyRectScratch.left, gxGpuVramCopyRectScratch.bottom - gxGpuVramCopyRectScratch.top);
		renderLineVertices(vertexFloatCount, gxGpuLineBatchState.uniformByteOffset, gxGpuVramCopyRectScratch, gxGpuLineBatchState.readsVram);
	}
	resetGxGpuVramCopyRect(gxGpuLineBatchRect);
	return 0;
}

function appendBatchedLineSegment(vertexFloatCount: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number): number {
	let offset = vertexFloatCount;
	if (gxGpuLineBatchState.spansPhysicalRowBands && offset !== 0) {
		offset = flushLineCommands(offset);
	}
	if (offset + GX_GPU_LINE_SEGMENT_FLOATS > GX_GPU_LINE_FLOAT_CAPACITY) {
		offset = flushLineCommands(offset);
	}
	const commandVertexStart = offset;
	offset = appendLineSegment(offset, x0, y0, color0, x1, y1, color1);
	if (gxGpuLineBatchState.readsVram && offset !== commandVertexStart) {
		setGxGpuVertexBoundsRect(gxGpuLineCommandRect, gxGpuLineVertices, commandVertexStart, offset, GX_GPU_LINE_VERTEX_FLOATS, gxGpuLineBatchState.topLeftWord, gxGpuLineBatchState.bottomRightWord);
		if (commandVertexStart !== 0 && gxGpuVramCopyRectsOverlap(gxGpuLineCommandRect, gxGpuLineBatchRect)) {
			offset = flushLineCommands(commandVertexStart);
			offset = appendLineSegment(offset, x0, y0, color0, x1, y1, color1);
			setGxGpuVertexBoundsRect(gxGpuLineCommandRect, gxGpuLineVertices, 0, offset, GX_GPU_LINE_VERTEX_FLOATS, gxGpuLineBatchState.topLeftWord, gxGpuLineBatchState.bottomRightWord);
		}
		includeGxGpuVramCopyRect(gxGpuLineBatchRect, gxGpuLineCommandRect);
	}
	return offset;
}

function appendLineCommandVertices(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
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
			vertexFloatCount = appendBatchedLineSegment(vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1);
		} else {
			const xy1 = words[wordStart + 2];
			vertexFloatCount = appendBatchedLineSegment(vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color0);
		}
	} else if (gxGpuCommandGouraud(opcode)) {
		let color0 = words[wordStart];
		let xy0 = words[wordStart + 1];
		for (let wordIndex = wordStart + 2; wordIndex + 1 < wordEnd; wordIndex += 2) {
			const color1 = words[wordIndex];
			const xy1 = words[wordIndex + 1];
			vertexFloatCount = appendBatchedLineSegment(vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1);
			color0 = color1;
			xy0 = xy1;
		}
	} else {
		const color = words[wordStart];
		let xy0 = words[wordStart + 1];
		for (let wordIndex = wordStart + 2; wordIndex < wordEnd; wordIndex += 1) {
			const xy1 = words[wordIndex];
			vertexFloatCount = appendBatchedLineSegment(vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color);
			xy0 = xy1;
		}
	}
	return vertexFloatCount;
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
	gxGpuState.activeEncoder = gxGpuState.backend.device.createCommandEncoder();
	gxGpuState.solidVertexByteOffset = 0;
	gxGpuState.lineVertexByteOffset = 0;
	gxGpuState.texturedVertexByteOffset = 0;
	gxGpuState.transferVertexByteOffset = 0;
	gxGpuState.primitiveUniformByteOffset = 0;
	gxGpuState.texturedUniformByteOffset = 0;
	gxGpuState.transferUniformByteOffset = 0;
	let solidVertexFloatCount = 0;
	let texturedVertexFloatCount = 0;
	let texturedBatchCommandIndex = 0;
	let lineVertexFloatCount = 0;
	resetGxGpuVramCopyRect(gxGpuSolidBatchRect);
	resetGxGpuVramCopyRect(gxGpuTexturedBatchRect);
	resetGxGpuVramCopyRect(gxGpuLineBatchRect);
	for (; commandIndex < presentCommandCount; commandIndex += 1) {
		const commandKind = commandBuffer.commandKind[commandIndex];
		const topLeftWord = commandKind === GX_GPU_COMMAND_FILL_RECTANGLE ? GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD : commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
		const bottomRightWord = commandKind === GX_GPU_COMMAND_FILL_RECTANGLE ? GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD : commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
		const drawingAreaSpansPhysicalRowBands = commandKind !== GX_GPU_COMMAND_FILL_RECTANGLE
			&& commandKind !== GX_GPU_COMMAND_COPY_VRAM_TO_VRAM
			&& commandKind !== GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM
			&& gxGpuDrawingAreaTop(topLeftWord, bottomRightWord) < GX_GPU_VRAM_HEIGHT
			&& gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord) > GX_GPU_VRAM_HEIGHT;
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
				const drawsTexture = commandDrawsTexture;
				if (drawsTexture) {
					const fixedColor = commandKind === GX_GPU_COMMAND_DRAW_POLYGON
						&& gxGpuCommandGouraud(opcode)
						&& !gxGpuCommandRawTextureEnabled(opcode);
					if (solidVertexFloatCount !== 0) solidVertexFloatCount = flushSolidCommands(solidVertexFloatCount);
					const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
					const textureWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2];
					const ditherEnabled = commandKind === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode);
					const interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
					if (texturedVertexFloatCount !== 0) {
						const batchDrawModeWord = commandBuffer.commandDrawModeWord[texturedBatchCommandIndex];
						const batchOpcode = commandBuffer.commandOpcode[texturedBatchCommandIndex];
						const batchTextureWord = commandBuffer.words[commandBuffer.commandWordStart[texturedBatchCommandIndex] + 2];
						const batchDitherEnabled = commandBuffer.commandKind[texturedBatchCommandIndex] === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(batchDrawModeWord, batchOpcode);
						const batchFixedColor = commandBuffer.commandKind[texturedBatchCommandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
							&& gxGpuCommandGouraud(batchOpcode)
							&& !gxGpuCommandRawTextureEnabled(batchOpcode);
						const batchStateChanged = topLeftWord !== commandBuffer.commandDrawingAreaTopLeftWord[texturedBatchCommandIndex]
							|| bottomRightWord !== commandBuffer.commandDrawingAreaBottomRightWord[texturedBatchCommandIndex]
							|| drawModeWord !== batchDrawModeWord
							|| commandBuffer.commandTextureWindowWord[commandIndex] !== commandBuffer.commandTextureWindowWord[texturedBatchCommandIndex]
							|| maskBitModeWord !== commandBuffer.commandMaskBitModeWord[texturedBatchCommandIndex]
							|| interlacedRenderWord !== commandBuffer.commandInterlacedRenderWord[texturedBatchCommandIndex]
							|| (textureWord >>> 16) !== (batchTextureWord >>> 16)
							|| gxGpuCommandRawTextureEnabled(opcode) !== gxGpuCommandRawTextureEnabled(batchOpcode)
							|| fixedColor !== batchFixedColor
							|| gxGpuCommandSemiTransparencyEnabled(opcode) !== gxGpuCommandSemiTransparencyEnabled(batchOpcode)
							|| ditherEnabled !== batchDitherEnabled;
						if (batchStateChanged) texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
					}
					if (texturedVertexFloatCount === 0) texturedBatchCommandIndex = commandIndex;
					const texturedVertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
					let texturedCommandVertexStart = texturedVertexFloatCount;
					texturedVertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, texturedVertexFloatCount);
					if (texturedVertexFloatCount !== texturedCommandVertexStart) {
						setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, gxGpuTexturedVertices, texturedCommandVertexStart, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord);
						let sourceOverlaps = syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, texturedCommandVertexStart, texturedVertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, fixedColor);
						if ((sourceOverlaps & GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP) !== 0) {
							texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedCommandVertexStart, texturedBatchCommandIndex);
							texturedBatchCommandIndex = commandIndex;
							texturedCommandVertexStart = 0;
							texturedVertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, 0);
							setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, gxGpuTexturedVertices, 0, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord);
							sourceOverlaps = syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, 0, texturedVertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, fixedColor);
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
					if (drawingAreaSpansPhysicalRowBands && texturedVertexFloatCount !== 0) {
						texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
					}
					break;
				}
				const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
				const ditherEnabled = commandKind === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode);
				const interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
				const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
				const blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0;
				const readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
				const fixedColor = commandKind === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuCommandGouraud(opcode);
				const splitReadVramQuad = readsVram && commandKind === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuCommandQuadPolygon(opcode);
				const batchStateChanged = topLeftWord !== gxGpuSolidBatchState.topLeftWord
					|| bottomRightWord !== gxGpuSolidBatchState.bottomRightWord
					|| maskBitModeWord !== gxGpuSolidBatchState.maskBitModeWord
					|| ditherEnabled !== gxGpuSolidBatchState.ditherEnabled
					|| interlacedRenderWord !== gxGpuSolidBatchState.interlacedRenderWord
					|| blendEnabled !== gxGpuSolidBatchState.blendEnabled
					|| blendMode !== gxGpuSolidBatchState.blendMode
					|| readsVram !== gxGpuSolidBatchState.readsVram
					|| fixedColor !== gxGpuSolidBatchState.fixedColor;
				if (solidVertexFloatCount !== 0 && (batchStateChanged || splitReadVramQuad)) {
					solidVertexFloatCount = flushSolidCommands(solidVertexFloatCount);
				}
				gxGpuSolidBatchState.topLeftWord = topLeftWord;
				gxGpuSolidBatchState.bottomRightWord = bottomRightWord;
				gxGpuSolidBatchState.maskBitModeWord = maskBitModeWord;
				gxGpuSolidBatchState.ditherEnabled = ditherEnabled;
				gxGpuSolidBatchState.interlacedRenderWord = interlacedRenderWord;
				gxGpuSolidBatchState.blendEnabled = blendEnabled;
				gxGpuSolidBatchState.blendMode = blendMode;
				gxGpuSolidBatchState.readsVram = readsVram;
				gxGpuSolidBatchState.fixedColor = fixedColor;
				const commandVertexStart = solidVertexFloatCount;
				solidVertexFloatCount = appendSolidCommandVertices(commandBuffer, commandIndex, solidVertexFloatCount);
				const solidVertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
				const solidTriangleFloatCount = fixedColor ? GX_GPU_FIXED_SOLID_TRIANGLE_FLOATS : GX_GPU_SOLID_TRIANGLE_FLOATS;
				if (splitReadVramQuad && solidVertexFloatCount === solidTriangleFloatCount * 2) {
					renderReadVramSolidQuad(topLeftWord, bottomRightWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord);
					solidVertexFloatCount = 0;
				} else if (readsVram && solidVertexFloatCount !== commandVertexStart) {
					setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, gxGpuSolidVertices, commandVertexStart, solidVertexFloatCount, solidVertexFloatStride, topLeftWord, bottomRightWord);
					if (commandVertexStart !== 0 && gxGpuVramCopyRectsOverlap(gxGpuSolidCommandRect, gxGpuSolidBatchRect)) {
						solidVertexFloatCount = flushSolidCommands(commandVertexStart);
						solidVertexFloatCount = appendSolidCommandVertices(commandBuffer, commandIndex, solidVertexFloatCount);
						setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, gxGpuSolidVertices, 0, solidVertexFloatCount, solidVertexFloatStride, topLeftWord, bottomRightWord);
					}
					includeGxGpuVramCopyRect(gxGpuSolidBatchRect, gxGpuSolidCommandRect);
				}
				if (drawingAreaSpansPhysicalRowBands && solidVertexFloatCount !== 0) {
					solidVertexFloatCount = flushSolidCommands(solidVertexFloatCount);
				}
				break;
			}
			case GX_GPU_COMMAND_FILL_RECTANGLE: {
				const interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
				if (solidVertexFloatCount !== 0 && (gxGpuSolidBatchState.topLeftWord !== topLeftWord
					|| gxGpuSolidBatchState.bottomRightWord !== bottomRightWord
					|| gxGpuMaskBitSetWhileDrawing(gxGpuSolidBatchState.maskBitModeWord)
					|| gxGpuSolidBatchState.ditherEnabled
					|| gxGpuSolidBatchState.interlacedRenderWord !== interlacedRenderWord
					|| gxGpuSolidBatchState.blendEnabled
					|| gxGpuSolidBatchState.readsVram
					|| gxGpuSolidBatchState.fixedColor)) {
					solidVertexFloatCount = flushSolidCommands(solidVertexFloatCount);
				}
				gxGpuSolidBatchState.topLeftWord = topLeftWord;
				gxGpuSolidBatchState.bottomRightWord = bottomRightWord;
				gxGpuSolidBatchState.maskBitModeWord = 0;
				gxGpuSolidBatchState.ditherEnabled = false;
				gxGpuSolidBatchState.interlacedRenderWord = interlacedRenderWord;
				gxGpuSolidBatchState.blendEnabled = false;
				gxGpuSolidBatchState.blendMode = 0;
				gxGpuSolidBatchState.readsVram = false;
				gxGpuSolidBatchState.fixedColor = false;
				solidVertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, solidVertexFloatCount);
				break;
			}
			case GX_GPU_COMMAND_DRAW_LINE:
			case GX_GPU_COMMAND_DRAW_POLYLINE: {
				if (solidVertexFloatCount !== 0) solidVertexFloatCount = flushSolidCommands(solidVertexFloatCount);
				const opcode = commandBuffer.commandOpcode[commandIndex];
				const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
				const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
				const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
				const blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0;
				const ditherEnabled = gxGpuDrawModeDitherEnabled(drawModeWord);
				const interlacedRenderWord = commandBuffer.commandInterlacedRenderWord[commandIndex];
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
				gxGpuLineBatchState.spansPhysicalRowBands = drawingAreaSpansPhysicalRowBands;
				if (lineVertexFloatCount === 0) {
					writePrimitiveUniforms(blendEnabled, blendMode, maskBitModeWord, ditherEnabled, interlacedRenderWord);
					gxGpuLineBatchState.uniformByteOffset = gxGpuState.primitiveUniformByteOffset;
					gxGpuState.backend.device.queue.writeBuffer(gxGpuState.primitiveUniformBuffer, gxGpuLineBatchState.uniformByteOffset, primitiveUniformScratch);
					gxGpuState.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
				}
				lineVertexFloatCount = appendLineCommandVertices(commandBuffer, commandIndex, lineVertexFloatCount);
				break;
			}
			case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
				if (solidVertexFloatCount !== 0) solidVertexFloatCount = flushSolidCommands(solidVertexFloatCount);
				copyVramToVram(commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
				if (solidVertexFloatCount !== 0) solidVertexFloatCount = flushSolidCommands(solidVertexFloatCount);
				uploadCpuToVram(commandBuffer, commandIndex);
				break;
		}
	}
	if (solidVertexFloatCount !== 0) flushSolidCommands(solidVertexFloatCount);
	if (texturedVertexFloatCount !== 0) flushTexturedCommands(commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
	if (lineVertexFloatCount !== 0) flushLineCommands(lineVertexFloatCount);
	const encoder = gxGpuState.activeEncoder!;
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
	if (gxGpuState.vramSnapshotSerial !== source.vramSnapshotSerial) {
		uploadGxGpuVramSnapshot(source.vramSnapshotBytes);
		gxGpuState.processedCommandCount = 0;
		gxGpuState.processedCommandSerial = commandSerial;
		gxGpuState.vramSnapshotSerial = source.vramSnapshotSerial;
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

function scanoutProgressiveGxGpuVram(state: RenderPassStateRegistry['gx_gpu']): void {
	const target = state.targetColorTex as GPUTexture;
	const device = gxGpuState.backend.device;
	const clearOnly = (state.statusWord & GX_GPU_STATUS_DISPLAY_DISABLE) !== 0;
	if (!clearOnly && (gxGpuState.scanoutUniformDisplayStartWord !== state.displayStartWord
		|| gxGpuState.scanoutUniformDisplayModeWord !== state.displayModeWord)) {
		scanoutUniformScratch[0] = state.displayStartWord;
		scanoutUniformScratch[1] = state.displayModeWord;
		device.queue.writeBuffer(gxGpuState.scanoutUniformBuffer, 0, scanoutUniformScratch);
		gxGpuState.scanoutUniformDisplayStartWord = state.displayStartWord;
		gxGpuState.scanoutUniformDisplayModeWord = state.displayModeWord;
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

function scanoutInterlacedGxGpuVram(state: RenderPassStateRegistry['gx_gpu']): void {
	const target = state.targetColorTex as GPUTexture;
	const device = gxGpuState.backend.device;
	const width = state.width;
	const height = state.height;
	const fieldHeight = height >> 1;
	const displayDisableWord = state.statusWord & GX_GPU_STATUS_DISPLAY_DISABLE;
	const interpretationWord = state.displayModeWord & GX_GPU_SCANOUT_INTERPRETATION_MASK;
	const sizeChanged = gxGpuState.scanoutFieldsWidth !== width || gxGpuState.scanoutFieldsHeight !== height;
	const invalid = !gxGpuState.scanoutFieldsValid
		|| sizeChanged
		|| gxGpuState.scanoutFieldsDisplayStartWord !== state.displayStartWord
		|| gxGpuState.scanoutFieldsInterpretationWord !== interpretationWord
		|| gxGpuState.scanoutFieldsVramSnapshotSerial !== state.vramSnapshotSerial;
	if (sizeChanged) {
		if (gxGpuState.scanoutFieldsTexture) {
			gxGpuState.scanoutFieldsTexture.destroy();
		}
		const fieldsTexture = device.createTexture({
			size: { width, height, depthOrArrayLayers: 1 },
			format: 'bgra8unorm',
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		const fieldsView = fieldsTexture.createView();
		gxGpuState.scanoutFieldsTexture = fieldsTexture;
		if (gxGpuState.scanoutFieldsColorAttachment) {
			gxGpuState.scanoutFieldsColorAttachment.view = fieldsView;
		} else {
			const fieldsColorAttachment: GPURenderPassColorAttachment = { view: fieldsView, clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'store' };
			gxGpuState.scanoutFieldsColorAttachment = fieldsColorAttachment;
			gxGpuState.scanoutFieldsPassDescriptor = { colorAttachments: [fieldsColorAttachment] };
		}
		gxGpuState.scanoutFieldsBindGroup = createBindGroup(
			device,
			gxGpuState.scanoutBindGroupLayout,
			gxGpuState.scanoutUniformBuffer,
			scanoutUniformScratch.byteLength,
			fieldsView,
			gxGpuState.sampler,
		);
		gxGpuState.scanoutFieldsWidth = width;
		gxGpuState.scanoutFieldsHeight = height;
	}
	if (gxGpuState.scanoutUniformDisplayStartWord !== state.displayStartWord
		|| gxGpuState.scanoutUniformDisplayModeWord !== state.displayModeWord
		|| gxGpuState.scanoutUniformFieldHeight !== fieldHeight
		|| gxGpuState.scanoutUniformDisplayDisableWord !== displayDisableWord) {
		scanoutUniformScratch[0] = state.displayStartWord;
		scanoutUniformScratch[1] = state.displayModeWord;
		scanoutUniformScratch[2] = fieldHeight;
		scanoutUniformScratch[3] = displayDisableWord;
		device.queue.writeBuffer(gxGpuState.scanoutUniformBuffer, 0, scanoutUniformScratch);
		gxGpuState.scanoutUniformDisplayStartWord = state.displayStartWord;
		gxGpuState.scanoutUniformDisplayModeWord = state.displayModeWord;
		gxGpuState.scanoutUniformFieldHeight = fieldHeight;
		gxGpuState.scanoutUniformDisplayDisableWord = displayDisableWord;
	}
	if (gxGpuState.scanoutTargetTexture !== target) {
		gxGpuState.scanoutTargetTexture = target;
		gxGpuState.scanoutTargetView = target.createView();
	}

	const encoder = device.createCommandEncoder();
	gxGpuState.scanoutFieldsColorAttachment!.loadOp = invalid ? 'clear' : 'load';
	const fieldPass = encoder.beginRenderPass(gxGpuState.scanoutFieldsPassDescriptor!);
	fieldPass.setPipeline(gxGpuState.scanoutFieldPipeline);
	gxGpuDynamicUniformOffsets[0] = 0;
	fieldPass.setBindGroup(0, gxGpuState.scanoutBindGroup, gxGpuDynamicUniformOffsets);
	if (invalid) {
		fieldPass.setViewport(0, 0, width, height, 0, 1);
		gxGpuState.scanoutFieldsDisplayStartWord = state.displayStartWord;
		gxGpuState.scanoutFieldsInterpretationWord = interpretationWord;
		gxGpuState.scanoutFieldsVramSnapshotSerial = state.vramSnapshotSerial;
		gxGpuState.scanoutFieldsValid = true;
	} else {
		fieldPass.setViewport(0, gxGpuScanoutField(state.statusWord) * fieldHeight, width, fieldHeight, 0, 1);
	}
	fieldPass.draw(3);
	fieldPass.end();

	gxGpuState.scanoutColorAttachment.view = gxGpuState.scanoutTargetView;
	gxGpuState.scanoutColorAttachment.loadOp = 'load';
	const weavePass = encoder.beginRenderPass(gxGpuState.scanoutPassDescriptor);
	weavePass.setPipeline(gxGpuState.scanoutWeavePipeline);
	weavePass.setBindGroup(0, gxGpuState.scanoutFieldsBindGroup!, gxGpuDynamicUniformOffsets);
	weavePass.draw(3);
	weavePass.end();
	gxGpuState.submitCommandBuffers[0] = encoder.finish();
	device.queue.submit(gxGpuState.submitCommandBuffers);
}

function scanoutGxGpuVram(state: RenderPassStateRegistry['gx_gpu']): void {
	if (gxGpuScanoutSourceLineStep(state.displayModeWord) !== 0) {
		scanoutInterlacedGxGpuVram(state);
		return;
	}
	gxGpuState.scanoutFieldsValid = false;
	scanoutProgressiveGxGpuVram(state);
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
