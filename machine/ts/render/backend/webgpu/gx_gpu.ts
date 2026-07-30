import type { GxGpu } from '../../../machine/devices/gx/gpu';
import type { GxGpuDeviceOutput } from '../../../machine/devices/gx/device_output';
import {
	GX_GPU_CLUT_4BIT_WORDS,
	GX_GPU_CLUT_8BIT_WORDS,
} from '../../../spec/gx/gp0';
import {
	GX_GPU_TRANSFER_MAX_BYTE_COUNT,
	GX_GPU_TRANSFER_MAX_HEIGHT,
	gxGpuTransferHeight,
	gxGpuTransferWidth,
	gxGpuDrawingAreaBottomExclusive,
	gxGpuDrawingAreaLeft,
	gxGpuDrawingAreaRightExclusive,
	gxGpuDrawingAreaTop,
	gxGpuSigned11,
} from '../../../spec/gx/gp0';
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
	GX_GPU_SKIPPED_LINE_NONE,
	type GxGpuCommandBufferView,
} from '../../../machine/devices/gx/gpu_command_buffer';
import {
	GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA,
	GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB,
	GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGBA,
	GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB,
	GX_GPU_PCRTC_SCANOUT_DRAW_NONE,
	GX_GPU_PCRTC_SCANOUT_DRAW_PATH_COUNT,
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
	gxGpuTexturedBatchDrawModeWord,
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
	GX_GPU_VRAM_ADDRESS_WORD_COUNT,
	GX_GPU_VRAM_X_ADDRESS_PERIOD,
	GX_GPU_VRAM_Y_ADDRESS_PERIOD,
	GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT,
	gxGpuVramYAddress,
	gxGpuVramYAddressMask,
} from '../../../spec/gx/vram';
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
const GX_GPU_TEXTURE_SOURCE_FLOATS = 2;
const GX_GPU_TEXTURED_VERTEX_FLOATS = 13;
const GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS = 19;
const GX_GPU_TEXTURED_TEXTURE_SOURCE_FLOAT_OFFSET = GX_GPU_TEXTURED_VERTEX_FLOATS - GX_GPU_TEXTURE_SOURCE_FLOATS;
const GX_GPU_FIXED_TEXTURED_TEXTURE_SOURCE_FLOAT_OFFSET = GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS - GX_GPU_TEXTURE_SOURCE_FLOATS;
const GX_GPU_TEXTURED_FLOAT_CAPACITY = GX_GPU_COMMAND_CAPACITY * GX_GPU_POLYGON_VERTICES_PER_COMMAND * GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS;
const GX_GPU_TEXTURE_PAGE_COORD_SIZE = 256;
const GX_GPU_TEXTURE_PAGE_4BIT_WIDTH_WORDS = 64;
const GX_GPU_TEXTURE_PAGE_8BIT_WIDTH_WORDS = 128;
const GX_GPU_TRANSFER_VERTEX_FLOATS = 4;
const GX_GPU_TRANSFER_VERTICES_PER_SEGMENT = 6;
const GX_GPU_TRANSFER_SEGMENTS_PER_ROW = 3;
const GX_GPU_TRANSFER_FLOAT_CAPACITY = GX_GPU_TRANSFER_MAX_HEIGHT * GX_GPU_TRANSFER_SEGMENTS_PER_ROW * GX_GPU_TRANSFER_VERTICES_PER_SEGMENT * GX_GPU_TRANSFER_VERTEX_FLOATS;
const GX_GPU_RAW_VRAM_BYTES_PER_PIXEL = 4;
const GX_GPU_CPU_UPLOAD_BYTES_PER_PIXEL = 2;
const GX_GPU_CPU_UPLOAD_ROW_BYTES = GX_GPU_VRAM_X_ADDRESS_PERIOD * GX_GPU_CPU_UPLOAD_BYTES_PER_PIXEL;
const GX_GPU_UNIFORM_SLOT_BYTES = 256;
const GX_GPU_UNIFORM_BUFFER_BYTES = GX_GPU_COMMAND_CAPACITY * GX_GPU_UNIFORM_SLOT_BYTES;
const GX_GPU_SCANOUT_UNIFORM_SLOT_COUNT = 3;
const GX_GPU_SCANOUT_UNIFORM_BUFFER_BYTES = GX_GPU_SCANOUT_UNIFORM_SLOT_COUNT * GX_GPU_UNIFORM_SLOT_BYTES;
const GX_GPU_SCANOUT_UNIFORM_WORD_COUNT = 28;
const GX_GPU_SCANOUT_UNIFORM_BYTES = GX_GPU_SCANOUT_UNIFORM_WORD_COUNT * 4;
const GX_GPU_SCANOUT_PROGRAM_STORAGE_COUNT = GX_GPU_PCRTC_SAMPLE_PATH_COUNT;
const GX_GPU_SCANOUT_PIPELINE_COUNT = GX_GPU_PCRTC_SCANOUT_DRAW_PATH_COUNT * GX_GPU_SCANOUT_PROGRAM_STORAGE_COUNT;
const GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES = GX_GPU_VRAM_X_ADDRESS_PERIOD * GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
const GX_GPU_READBACK_PACK_WIDTH = 512;
const GX_GPU_READBACK_UNIFORM_BYTES = 32;
const GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD = 0;
const GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD = (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1) | ((GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1) << 10);

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
	vramYAddressExtensionWord: number;
	maskBitModeWord: number;
	ditherEnabled: boolean;
	skippedLineParity: number;
	blendEnabled: boolean;
	blendMode: number;
	readsVram: boolean;
};

type GxGpuSolidBatchState = GxGpuPrimitiveBatchState & {
	fixedColor: boolean;
	rasterKind: GxGpuRasterKind;
};

type GxGpuLineBatchState = GxGpuPrimitiveBatchState & {
	uniformByteOffset: number;
};

type GxGpuVramSource = Pick<GxGpuDeviceOutput, 'commandBuffer' | 'readbackPort' | 'vramSnapshotBytes' | 'vramSnapshotSerial'>;

export type WebGpuGxGpuState = {
	backend: WebGPUBackend;
	solidVertices: Float32Array;
	solidVertexWords: Uint32Array;
	lineVertices: Float32Array;
	texturedVertices: Float32Array;
	texturedVertexWords: Uint32Array;
	texturedVertexHalfWords: Uint16Array;
	texturedUvPlane: Uint32Array;
	colorPlane: Uint32Array;
	texturedTextureSource: Uint16Array;
	transferVertices: Float32Array;
	primitiveUniformScratch: Uint32Array;
	primitiveUniformFloatScratch: Float32Array;
	texturedUniformScratch: Uint32Array;
	texturedUniformFloatScratch: Float32Array;
	transferUniformScratch: Uint32Array;
	scanoutUniformScratch: Uint32Array;
	readbackUniformScratch: Uint32Array;
	dynamicUniformOffsets: Uint32Array;
	scanoutClearColor: GPUColorDict;
	scanoutBlendConstant: GPUColorDict;
	vramCopyRectScratch: GxGpuVramCopyRect;
	solidBatchRect: GxGpuVramCopyRect;
	solidCommandRect: GxGpuVramCopyRect;
	texturedCommandRect: GxGpuVramCopyRect;
	texturedDependencyBatchRect: GxGpuVramCopyRect;
	texturedBatchRect: GxGpuVramCopyRect;
	lineBatchRect: GxGpuVramCopyRect;
	lineCommandRect: GxGpuVramCopyRect;
	sampleDirtyRect: GxGpuVramCopyRect;
	rectangleScratch: GxGpuRectangle;
	solidBatchState: GxGpuSolidBatchState;
	lineBatchState: GxGpuLineBatchState;
	gpureadCompletionCallback: () => void;
	vramTextureRows: number;
	vramSnapshotUpload: Uint8Array;
	vramSnapshotScratch: Uint8Array;
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
	gpureadDeferredGpu: GxGpu | null;
	gpureadDeferredToken: number;
	vramTexture: GPUTexture;
	vramSampleTexture: GPUTexture;
	cpuUploadTexture: GPUTexture;
	vramView: GPUTextureView;
	vramSampleView: GPUTextureView;
	cpuUploadView: GPUTextureView;
	sampler: GPUSampler;
	scanoutBindGroupLayout: GPUBindGroupLayout;
	solidPipeline: GPURenderPipeline;
	fixedSolidPipeline: GPURenderPipeline;
	linePipeline: GPURenderPipeline;
	texturedPipeline: GPURenderPipeline;
	fixedTexturedPipeline: GPURenderPipeline;
	transferPipeline: GPURenderPipeline;
	cpuUploadPipeline: GPURenderPipeline;
	scanoutPipelines: GPURenderPipeline[];
	scanoutFieldPipelines: GPURenderPipeline[];
	scanoutBackgroundPipeline: GPURenderPipeline;
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
	scanoutUniformPcrtcRevision: number;
	scanoutUniformField: number;
	scanoutUniformValid: boolean;
	scanoutFixedStatePcrtcRevision: number;
	scanoutFixedStateValid: boolean;
	scanoutFieldsWidth: number;
	scanoutFieldsHeight: number;
	scanoutFieldsValid: boolean;
	scanoutFieldsVramReplacementSerial: bigint;
	processedCommandCount: number;
	processedCommandSerial: number;
	vramSnapshotSerial: bigint;
};

function createVramTexture(device: GPUDevice, height: number): GPUTexture {
	return device.createTexture({
		size: { width: GX_GPU_VRAM_X_ADDRESS_PERIOD, height, depthOrArrayLayers: 1 },
		format: 'rgba8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.COPY_DST,
	});
}

function createPrimitiveBindGroupLayout(device: GPUDevice): GPUBindGroupLayout {
	return device.createBindGroupLayout({
		entries: [
			{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } },
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

function createPipeline(
	device: GPUDevice,
	label: string,
	module: GPUShaderModule,
	bindGroupLayout: GPUBindGroupLayout,
	vertexBuffer: GPUVertexBufferLayout,
	targetFormat: GPUTextureFormat,
	vertexEntryPoint: string,
	fragmentEntryPoint: string,
	shaderConstants: Record<string, number>,
): GPURenderPipeline {
	return device.createRenderPipeline({
		label,
		layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
		vertex: { module, entryPoint: vertexEntryPoint, constants: shaderConstants, buffers: [vertexBuffer] },
		fragment: { module, entryPoint: fragmentEntryPoint, constants: shaderConstants, targets: [{ format: targetFormat }] },
		primitive: { topology: 'triangle-list' },
	});
}

function createScanoutPipeline(
	device: GPUDevice,
	module: GPUShaderModule,
	pipelineLayout: GPUPipelineLayout,
	label: string,
	fragmentEntryPoint: string,
	constants: Record<string, number> = {},
	writeMask: GPUColorWriteFlags = GPUColorWrite.ALL,
	blend?: GPUBlendState,
): GPURenderPipeline {
	return device.createRenderPipeline({
		label,
		layout: pipelineLayout,
		vertex: { module, entryPoint: 'vs_main' },
		fragment: {
			module,
			entryPoint: fragmentEntryPoint,
			constants,
			targets: [{ format: 'bgra8unorm', writeMask, blend }],
		},
		primitive: { topology: 'triangle-list' },
	});
}

function createReadbackPipeline(
	device: GPUDevice,
	bindGroupLayout: GPUBindGroupLayout,
	shaderConstants: Record<string, number>,
): GPURenderPipeline {
	const module = device.createShaderModule({ label: 'gx_gpu_readback', code: readbackShaderCode });
	return device.createRenderPipeline({
		label: 'gx_gpu_readback',
		layout: device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
		vertex: { module, entryPoint: 'vs_main' },
		fragment: {
			module,
			entryPoint: 'fs_main',
			constants: shaderConstants,
			targets: [{ format: 'rgba8unorm' }],
		},
		primitive: { topology: 'triangle-list' },
	});
}

function bootstrapGxGpuPass(backend: WebGPUBackend): void {
	const device = backend.device;
	const vramTextureRows = backend.gxGpuVramTextureRows;
	const vramRawByteCount = vramTextureRows * GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES;
	const solidVertices = new Float32Array(GX_GPU_SOLID_FLOAT_CAPACITY);
	const solidVertexWords = new Uint32Array(solidVertices.buffer);
	const lineVertices = new Float32Array(GX_GPU_LINE_FLOAT_CAPACITY);
	const texturedVertices = new Float32Array(GX_GPU_TEXTURED_FLOAT_CAPACITY);
	const texturedVertexWords = new Uint32Array(texturedVertices.buffer);
	const texturedVertexHalfWords = new Uint16Array(texturedVertices.buffer);
	const texturedUvPlane = new Uint32Array(GX_GPU_TEXTURED_UV_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
	const colorPlane = new Uint32Array(GX_GPU_COLOR_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
	const texturedTextureSource = new Uint16Array(4);
	const transferVertices = new Float32Array(GX_GPU_TRANSFER_FLOAT_CAPACITY);
	const primitiveUniformScratch = new Uint32Array(8);
	const primitiveUniformFloatScratch = new Float32Array(primitiveUniformScratch.buffer);
	const texturedUniformScratch = new Uint32Array(16);
	const texturedUniformFloatScratch = new Float32Array(texturedUniformScratch.buffer);
	const transferUniformScratch = new Uint32Array(8);
	const scanoutUniformScratch = new Uint32Array(GX_GPU_SCANOUT_UNIFORM_BUFFER_BYTES >> 2);
	const readbackUniformScratch = new Uint32Array(GX_GPU_READBACK_UNIFORM_BYTES >> 2);
	const dynamicUniformOffsets = new Uint32Array(1);
	const scanoutClearColor: GPUColorDict = { r: 0, g: 0, b: 0, a: 0 };
	const scanoutBlendConstant: GPUColorDict = { r: 0, g: 0, b: 0, a: 0 };
	const vramShaderConstants = {
		gxGpuVramXAddressPeriod: GX_GPU_VRAM_X_ADDRESS_PERIOD,
		gxGpuVramYAddressPeriod: GX_GPU_VRAM_Y_ADDRESS_PERIOD,
		gxGpuVramTextureRowMask: backend.gxGpuVramTextureRowMask,
	};
	const readbackShaderConstants = {
		gxGpuVramXAddressPeriod: GX_GPU_VRAM_X_ADDRESS_PERIOD,
		gxGpuVramYAddressPeriod: GX_GPU_VRAM_Y_ADDRESS_PERIOD,
		gxGpuVramYAddressExtensionBit: GX_GPU_VRAM_Y_ADDRESS_EXTENSION_BIT,
		gxGpuVramTextureRowMask: backend.gxGpuVramTextureRowMask,
	};
	const vramTexture = createVramTexture(device, vramTextureRows);
	const vramSampleTexture = createVramTexture(device, vramTextureRows);
	const cpuUploadTexture = device.createTexture({
		size: { width: GX_GPU_VRAM_X_ADDRESS_PERIOD, height: GX_GPU_TRANSFER_MAX_HEIGHT, depthOrArrayLayers: 1 },
		format: 'rg8unorm',
		usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
	});
	const gpureadTexture = device.createTexture({
		size: { width: GX_GPU_READBACK_PACK_WIDTH, height: GX_GPU_TRANSFER_MAX_HEIGHT, depthOrArrayLayers: 1 },
		format: 'rgba8unorm',
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});
	const vramView = vramTexture.createView();
	const vramSampleView = vramSampleTexture.createView();
	const cpuUploadView = cpuUploadTexture.createView();
	const gpureadView = gpureadTexture.createView();
	const sampler = device.createSampler({ magFilter: 'nearest', minFilter: 'nearest', addressModeU: 'repeat', addressModeV: 'repeat' });
	const primitiveLayout = createPrimitiveBindGroupLayout(device);
	const transferLayout = createTransferBindGroupLayout(device);
	const scanoutPipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [primitiveLayout] });
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
	}, 'rgba8unorm', 'vs_main', 'fs_main', vramShaderConstants);
	const fixedSolidPipeline = createPipeline(device, 'gx_gpu_fixed_solid', solidModule, primitiveLayout, {
		arrayStride: GX_GPU_FIXED_SOLID_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'uint32x3' },
			{ shaderLocation: 2, offset: 5 * 4, format: 'uint32x3' },
			{ shaderLocation: 3, offset: 8 * 4, format: 'uint32x3' },
		],
	}, 'rgba8unorm', 'vs_fixed', 'fs_fixed', vramShaderConstants);
	const linePipeline = createPipeline(device, 'gx_gpu_line', lineModule, primitiveLayout, {
		arrayStride: GX_GPU_LINE_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'float32x2' },
			{ shaderLocation: 2, offset: 4 * 4, format: 'float32x2' },
			{ shaderLocation: 3, offset: 6 * 4, format: 'float32x3' },
			{ shaderLocation: 4, offset: 9 * 4, format: 'float32x3' },
		],
	}, 'rgba8unorm', 'vs_main', 'fs_main', vramShaderConstants);
	const texturedPipeline = createPipeline(device, 'gx_gpu_textured', texturedModule, primitiveLayout, {
		arrayStride: GX_GPU_TEXTURED_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'float32x3' },
			{ shaderLocation: 2, offset: 5 * 4, format: 'uint32x2' },
			{ shaderLocation: 3, offset: 7 * 4, format: 'uint32x2' },
			{ shaderLocation: 4, offset: 9 * 4, format: 'uint32x2' },
			{ shaderLocation: 5, offset: GX_GPU_TEXTURED_TEXTURE_SOURCE_FLOAT_OFFSET * 4, format: 'uint16x4' },
		],
	}, 'rgba8unorm', 'vs_main', 'fs_main', vramShaderConstants);
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
			{ shaderLocation: 7, offset: GX_GPU_FIXED_TEXTURED_TEXTURE_SOURCE_FLOAT_OFFSET * 4, format: 'uint16x4' },
		],
	}, 'rgba8unorm', 'vs_fixed', 'fs_fixed', vramShaderConstants);
	const transferPipeline = createPipeline(device, 'gx_gpu_transfer', transferModule, transferLayout, {
		arrayStride: GX_GPU_TRANSFER_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'float32x2' },
		],
	}, 'rgba8unorm', 'vs_main', 'fs_main', vramShaderConstants);
	const cpuUploadPipeline = createPipeline(device, 'gx_gpu_cpu_upload', transferModule, transferLayout, {
		arrayStride: GX_GPU_TRANSFER_VERTEX_FLOATS * 4,
		attributes: [
			{ shaderLocation: 0, offset: 0, format: 'float32x2' },
			{ shaderLocation: 1, offset: 2 * 4, format: 'float32x2' },
		],
	}, 'rgba8unorm', 'vs_main', 'fs_cpu_upload', vramShaderConstants);
	const sourceBlend: GPUBlendState = {
		color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
		alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
	};
	const constantBlend: GPUBlendState = {
		color: { srcFactor: 'constant', dstFactor: 'one-minus-constant', operation: 'add' },
		alpha: { srcFactor: 'one', dstFactor: 'zero', operation: 'add' },
	};
	const scanoutPipelines = new Array<GPURenderPipeline>(GX_GPU_SCANOUT_PIPELINE_COUNT);
	const scanoutFieldPipelines = new Array<GPURenderPipeline>(GX_GPU_SCANOUT_PIPELINE_COUNT);
	for (let drawPath = GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGB;
		drawPath < GX_GPU_PCRTC_SCANOUT_DRAW_PATH_COUNT;
		drawPath += 1) {
		if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGBA) continue;
		let writeMask = GPUColorWrite.RED | GPUColorWrite.GREEN | GPUColorWrite.BLUE;
		let blend: GPUBlendState | undefined;
		if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA) {
			writeMask = GPUColorWrite.ALL;
		} else if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA) {
			writeMask = GPUColorWrite.ALPHA;
		} else if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB) {
			blend = sourceBlend;
		} else if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB
			|| drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA) {
			blend = constantBlend;
			if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA) {
				writeMask = GPUColorWrite.ALL;
			}
		}
		for (let storageProgram = 0;
			storageProgram < GX_GPU_SCANOUT_PROGRAM_STORAGE_COUNT;
			storageProgram += 1) {
			const pipelineIndex = drawPath * GX_GPU_SCANOUT_PROGRAM_STORAGE_COUNT + storageProgram;
			const storagePath = storageProgram === GX_GPU_PCRTC_SAMPLE_LINEAR_GX16
				? GX_GPU_PCRTC_STORAGE_GX16
				: storageProgram;
			const constants = {
				storagePath,
				linearGx16: storageProgram === GX_GPU_PCRTC_SAMPLE_LINEAR_GX16 ? 1 : 0,
				doubleAlpha: drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB ? 1 : 0,
				interlacedField: 0,
				gxGpuVramXAddressPeriod: GX_GPU_VRAM_X_ADDRESS_PERIOD,
				gxGpuVramAddressWordMask: GX_GPU_VRAM_ADDRESS_WORD_COUNT - 1,
				gxGpuVramPhysicalWordMask: backend.gxGpuVramPhysicalWordMask,
			};
			scanoutPipelines[pipelineIndex] = createScanoutPipeline(
				device,
				scanoutModule,
				scanoutPipelineLayout,
				`gx_gpu_scanout_${drawPath}_${storageProgram}`,
				'fs_circuit',
				constants,
				writeMask,
				blend,
			);
			constants.interlacedField = 1;
			scanoutFieldPipelines[pipelineIndex] = createScanoutPipeline(
				device,
				scanoutModule,
				scanoutPipelineLayout,
				`gx_gpu_scanout_field_${drawPath}_${storageProgram}`,
				'fs_interlaced_field',
				constants,
				writeMask,
				blend,
			);
		}
	}
	const scanoutBackgroundPipeline = createScanoutPipeline(
		device, scanoutModule, scanoutPipelineLayout, 'gx_gpu_scanout_background', 'fs_background');
	const scanoutWeavePipeline = createScanoutPipeline(device, scanoutModule, scanoutPipelineLayout, 'gx_gpu_scanout_weave', 'fs_interlaced_weave');
	const gpureadPipeline = createReadbackPipeline(device, readbackLayout, readbackShaderConstants);
	const solidVertexBuffer = device.createBuffer({ size: solidVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const lineVertexBuffer = device.createBuffer({ size: lineVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const texturedVertexBuffer = device.createBuffer({ size: texturedVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const transferVertexBuffer = device.createBuffer({ size: transferVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const vramAliasBandCount = GX_GPU_VRAM_Y_ADDRESS_PERIOD / vramTextureRows;
	const primitiveUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_BUFFER_BYTES * vramAliasBandCount, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const texturedUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_BUFFER_BYTES * vramAliasBandCount, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const transferUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_BUFFER_BYTES * vramAliasBandCount, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const scanoutUniformBuffer = device.createBuffer({ size: GX_GPU_SCANOUT_UNIFORM_BUFFER_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const gpureadUniformBuffer = device.createBuffer({ size: GX_GPU_READBACK_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const vramReadbackBuffer = device.createBuffer({ size: vramRawByteCount, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const gpureadBuffer = device.createBuffer({ size: GX_GPU_TRANSFER_MAX_BYTE_COUNT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const vramDrawColorAttachment: GPURenderPassColorAttachment = { view: vramView, loadOp: 'load', storeOp: 'store' };
	const scanoutColorAttachment: GPURenderPassColorAttachment = { view: vramView, clearValue: scanoutClearColor, loadOp: 'load', storeOp: 'store' };
	const gpureadColorAttachment: GPURenderPassColorAttachment = { view: gpureadView, loadOp: 'load', storeOp: 'store' };
	const vramCopySourceOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	const vramCopyDestinationOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	const vramUploadDestinationOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	const gx: WebGpuGxGpuState = {
		backend,
		solidVertices,
		solidVertexWords,
		lineVertices,
		texturedVertices,
		texturedVertexWords,
		texturedVertexHalfWords,
		texturedUvPlane,
		colorPlane,
		texturedTextureSource,
		transferVertices,
		primitiveUniformScratch,
		primitiveUniformFloatScratch,
		texturedUniformScratch,
		texturedUniformFloatScratch,
		transferUniformScratch,
		scanoutUniformScratch,
		readbackUniformScratch,
		dynamicUniformOffsets,
		scanoutClearColor,
		scanoutBlendConstant,
		vramCopyRectScratch: { left: 0, top: 0, right: 0, bottom: 0 },
		solidBatchRect: { left: 0, top: 0, right: 0, bottom: 0 },
		solidCommandRect: { left: 0, top: 0, right: 0, bottom: 0 },
		texturedCommandRect: { left: 0, top: 0, right: 0, bottom: 0 },
		texturedDependencyBatchRect: { left: 0, top: 0, right: 0, bottom: 0 },
		texturedBatchRect: { left: 0, top: 0, right: 0, bottom: 0 },
		lineBatchRect: { left: 0, top: 0, right: 0, bottom: 0 },
		lineCommandRect: { left: 0, top: 0, right: 0, bottom: 0 },
		sampleDirtyRect: { left: 0, top: 0, right: 0, bottom: 0 },
		rectangleScratch: { x0: 0, y0: 0, x1: 0, y1: 0, width: 0, height: 0 },
		solidBatchState: {
			topLeftWord: 0,
			bottomRightWord: 0,
			vramYAddressExtensionWord: 0,
			maskBitModeWord: 0,
			ditherEnabled: false,
			skippedLineParity: GX_GPU_SKIPPED_LINE_NONE,
			blendEnabled: false,
			blendMode: 0,
			readsVram: false,
			fixedColor: false,
			rasterKind: GxGpuRasterKind.Rectangle,
		},
		lineBatchState: {
			topLeftWord: 0,
			bottomRightWord: 0,
			vramYAddressExtensionWord: 0,
			maskBitModeWord: 0,
			ditherEnabled: false,
			skippedLineParity: GX_GPU_SKIPPED_LINE_NONE,
			blendEnabled: false,
			blendMode: 0,
			readsVram: false,
			uniformByteOffset: 0,
		},
		gpureadCompletionCallback: () => completeGxGpuReadback(gx),
		vramTextureRows,
		vramSnapshotUpload: new Uint8Array(vramRawByteCount),
		vramSnapshotScratch: new Uint8Array(vramTextureRows * GX_GPU_CPU_UPLOAD_ROW_BYTES),
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
		vramReadbackDestination: { buffer: vramReadbackBuffer, bytesPerRow: GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES, rowsPerImage: vramTextureRows },
		vramReadbackExtent: { width: GX_GPU_VRAM_X_ADDRESS_PERIOD, height: vramTextureRows, depthOrArrayLayers: 1 },
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
		gpureadDeferredGpu: null,
		gpureadDeferredToken: 0,
		vramTexture,
		vramSampleTexture,
		cpuUploadTexture,
		vramView,
		vramSampleView,
		cpuUploadView,
		sampler,
		scanoutBindGroupLayout: primitiveLayout,
		solidPipeline,
		fixedSolidPipeline,
		linePipeline,
		texturedPipeline,
		fixedTexturedPipeline,
		transferPipeline,
		cpuUploadPipeline,
		scanoutPipelines,
		scanoutFieldPipelines,
		scanoutBackgroundPipeline,
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
		transferFromUploadBindGroup: createTransferBindGroup(device, transferLayout, transferUniformBuffer, transferUniformScratch.byteLength, cpuUploadView, vramSampleView, sampler),
		scanoutBindGroup: createBindGroup(device, primitiveLayout, scanoutUniformBuffer, GX_GPU_SCANOUT_UNIFORM_BYTES, vramView, sampler),
		scanoutTargetView: vramView,
		scanoutUniformPcrtcRevision: 0,
		scanoutUniformField: -1,
		scanoutUniformValid: false,
		scanoutFixedStatePcrtcRevision: 0,
		scanoutFixedStateValid: false,
		scanoutFieldsWidth: 0,
		scanoutFieldsHeight: 0,
		scanoutFieldsValid: false,
		scanoutFieldsVramReplacementSerial: 0n,
		processedCommandCount: 0,
		processedCommandSerial: 0,
		vramSnapshotSerial: 0n,
	};
	backend.gxGpuState = gx;
}

function writeSolidVertex(gx: WebGpuGxGpuState, offset: number, x: number, y: number, r: number, g: number, b: number): number {
	gx.solidVertices[offset] = x;
	gx.solidVertices[offset + 1] = y;
	gx.solidVertices[offset + 2] = r;
	gx.solidVertices[offset + 3] = g;
	gx.solidVertices[offset + 4] = b;
	gx.solidVertices[offset + 5] = 1.0;
	return offset + GX_GPU_SOLID_VERTEX_FLOATS;
}

function writeSolidColorVertex(gx: WebGpuGxGpuState, offset: number, x: number, y: number, colorWord: number): number {
	return writeSolidVertex(gx, offset, x, y, (colorWord & 0xff) / 255, ((colorWord >>> 8) & 0xff) / 255, ((colorWord >>> 16) & 0xff) / 255);
}

function appendSolidTriangle(gx: WebGpuGxGpuState, vertexFloatCount: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number, x2: number, y2: number, color2: number): number {
	let offset = vertexFloatCount;
	offset = writeSolidColorVertex(gx, offset, x0, y0, color0);
	offset = writeSolidColorVertex(gx, offset, x1, y1, color1);
	offset = writeSolidColorVertex(gx, offset, x2, y2, color2);
	return offset;
}

function appendSolidPrimitiveTriangle(gx: WebGpuGxGpuState, vertexFloatCount: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number, x2: number, y2: number, color2: number): number {
	if (gxGpuTriangleExceedsPrimitiveSize(x0, y0, x1, y1, x2, y2)) return vertexFloatCount;
	const xShift = gxGpuTriangleRasterShift(x0, x1, x2);
	const yShift = gxGpuTriangleRasterShift(y0, y1, y2);
	return appendSolidTriangle(gx, vertexFloatCount, x0 + xShift, y0 + yShift, color0, x1 + xShift, y1 + yShift, color1, x2 + xShift, y2 + yShift, color2);
}

function writeFixedSolidVertex(gx: WebGpuGxGpuState, offset: number, x: number, y: number): number {
	gx.solidVertices[offset] = x;
	gx.solidVertices[offset + 1] = y;
	for (let component = 0; component < GX_GPU_COLOR_COMPONENTS; component += 1) {
		gx.solidVertexWords[offset + 2 + component] = gx.colorPlane[component];
		gx.solidVertexWords[offset + 5 + component] = gx.colorPlane[GX_GPU_COLOR_COMPONENTS + component];
		gx.solidVertexWords[offset + 8 + component] = gx.colorPlane[GX_GPU_COLOR_COMPONENTS * 2 + component];
	}
	return offset + GX_GPU_FIXED_SOLID_VERTEX_FLOATS;
}

function appendFixedSolidPrimitiveTriangle(gx: WebGpuGxGpuState, vertexFloatCount: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number, x2: number, y2: number, color2: number): number {
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
	gx.colorPlane[0] = color0 & 0xff;
	gx.colorPlane[1] = (color0 >>> 8) & 0xff;
	gx.colorPlane[2] = (color0 >>> 16) & 0xff;
	gx.colorPlane[3] = color1 & 0xff;
	gx.colorPlane[4] = (color1 >>> 8) & 0xff;
	gx.colorPlane[5] = (color1 >>> 16) & 0xff;
	gx.colorPlane[6] = color2 & 0xff;
	gx.colorPlane[7] = (color2 >>> 8) & 0xff;
	gx.colorPlane[8] = (color2 >>> 16) & 0xff;
	gxGpuTriangleAttributePlane(gx.colorPlane, 0, GX_GPU_COLOR_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
	let offset = vertexFloatCount;
	offset = writeFixedSolidVertex(gx, offset, x0, y0);
	offset = writeFixedSolidVertex(gx, offset, x1, y1);
	offset = writeFixedSolidVertex(gx, offset, x2, y2);
	return offset;
}

function appendSolidQuad(gx: WebGpuGxGpuState, vertexFloatCount: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number, x2: number, y2: number, color2: number, x3: number, y3: number, color3: number): number {
	let offset = vertexFloatCount;
	offset = appendSolidTriangle(gx, offset, x0, y0, color0, x1, y1, color1, x2, y2, color2);
	offset = appendSolidTriangle(gx, offset, x2, y2, color2, x1, y1, color1, x3, y3, color3);
	return offset;
}

function appendFillRectangle(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = commandBuffer.words[wordStart];
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + 2];
	const width = gxGpuFillWidth(sizeWord);
	const height = gxGpuFillHeight(sizeWord);
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	if (width === 0 || height === 0) return vertexFloatCount;
	let y = gxGpuTransferY(xyWord, vramYAddressExtensionWord);
	let remainingHeight = height;
	let offset = vertexFloatCount;
	while (remainingHeight !== 0) {
		const rowHeight = gxGpuVramWrappedHeight(y, remainingHeight, vramYAddressExtensionWord, gx.backend.gxGpuVramTextureRowMask);
		let x = gxGpuFillX(xyWord);
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(x, remainingWidth);
			offset = appendSolidQuad(gx, offset, x, y, colorWord, x, y + rowHeight, colorWord, x + runWidth, y, colorWord, x + runWidth, y + rowHeight, colorWord);
			x = (x + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
			remainingWidth -= runWidth;
		}
		y = gxGpuVramYAddress(y + rowHeight, vramYAddressExtensionWord);
		remainingHeight -= rowHeight;
	}
	return offset;
}

function appendSolidPolygon(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
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
		let offset = appendFixedSolidPrimitiveTriangle(gx, vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2);
		if (gxGpuCommandQuadPolygon(opcode)) {
			const color3 = words[wordStart + 6];
			const xy3 = words[wordStart + 7];
			offset = appendFixedSolidPrimitiveTriangle(gx, offset, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3);
		}
		return offset;
	}
	const color = words[wordStart];
	const xy0 = words[wordStart + 1];
	const xy1 = words[wordStart + 2];
	const xy2 = words[wordStart + 3];
	let offset = appendSolidPrimitiveTriangle(gx, vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color);
	if (gxGpuCommandQuadPolygon(opcode)) {
		const xy3 = words[wordStart + 4];
		offset = appendSolidPrimitiveTriangle(gx, offset, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color);
	}
	return offset;
}

function readGxGpuRectangle(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, commandIndex: number, opcode: number): GxGpuRectangle {
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const xyWord = commandBuffer.words[wordStart + 1];
	const sizeWord = commandBuffer.words[wordStart + commandBuffer.commandWordCount[commandIndex] - 1];
	const width = gxGpuCommandRectangleWidth(opcode, sizeWord);
	const height = gxGpuCommandRectangleHeight(opcode, sizeWord);
	const drawingOffsetWord = commandBuffer.commandDrawingOffsetWord[commandIndex];
	const x0 = gxGpuSigned11(gxGpuSigned11(drawingOffsetWord) + gxGpuSigned11(xyWord));
	const y0 = gxGpuSigned11(gxGpuDrawingOffsetY(drawingOffsetWord) + gxGpuVertexY(xyWord));
	const rect = gx.rectangleScratch;
	rect.x0 = x0;
	rect.y0 = y0;
	rect.x1 = x0 + width;
	rect.y1 = y0 + height;
	rect.width = width;
	rect.height = height;
	return rect;
}

function appendSolidRectangle(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	if (gxGpuCommandTextureEnabled(opcode)) return vertexFloatCount;
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = commandBuffer.words[wordStart];
	const rect = readGxGpuRectangle(gx, commandBuffer, commandIndex, opcode);
	if (rect.width === 0 || rect.height === 0) return vertexFloatCount;
	return appendSolidQuad(gx, vertexFloatCount, rect.x0, rect.y0, colorWord, rect.x0, rect.y1, colorWord, rect.x1, rect.y0, colorWord, rect.x1, rect.y1, colorWord);
}

function writeLineVertex(gx: WebGpuGxGpuState, offset: number, x: number, y: number, x0: number, y0: number, x1: number, y1: number, color0: number, color1: number): number {
	gx.lineVertices[offset] = x;
	gx.lineVertices[offset + 1] = y;
	gx.lineVertices[offset + 2] = x0;
	gx.lineVertices[offset + 3] = y0;
	gx.lineVertices[offset + 4] = x1;
	gx.lineVertices[offset + 5] = y1;
	gx.lineVertices[offset + 6] = (color0 & 0xff) / 255;
	gx.lineVertices[offset + 7] = ((color0 >>> 8) & 0xff) / 255;
	gx.lineVertices[offset + 8] = ((color0 >>> 16) & 0xff) / 255;
	gx.lineVertices[offset + 9] = (color1 & 0xff) / 255;
	gx.lineVertices[offset + 10] = ((color1 >>> 8) & 0xff) / 255;
	gx.lineVertices[offset + 11] = ((color1 >>> 16) & 0xff) / 255;
	return offset + GX_GPU_LINE_VERTEX_FLOATS;
}

function appendLineSegment(gx: WebGpuGxGpuState, vertexFloatCount: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number): number {
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
		offset = writeLineVertex(gx, offset, x0, y0 - 1, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(gx, offset, x0, y0 + 2, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(gx, offset, x1 + 1, y1 - 1, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(gx, offset, x0, y0 + 2, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(gx, offset, x1 + 1, y1 - 1, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(gx, offset, x1 + 1, y1 + 2, x0, y0, x1, y1, color0, color1);
		return offset;
	}
	if (y0 < y1) {
		offset = writeLineVertex(gx, offset, x0 - 1, y0, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(gx, offset, x1 - 1, y1 + 1, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(gx, offset, x0 + 2, y0, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(gx, offset, x1 - 1, y1 + 1, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(gx, offset, x0 + 2, y0, x0, y0, x1, y1, color0, color1);
		offset = writeLineVertex(gx, offset, x1 + 2, y1 + 1, x0, y0, x1, y1, color0, color1);
		return offset;
	}
	offset = writeLineVertex(gx, offset, x1 - 1, y1, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(gx, offset, x0 - 1, y0 + 1, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(gx, offset, x1 + 2, y1, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(gx, offset, x0 - 1, y0 + 1, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(gx, offset, x1 + 2, y1, x0, y0, x1, y1, color0, color1);
	offset = writeLineVertex(gx, offset, x0 + 2, y0 + 1, x0, y0, x1, y1, color0, color1);
	return offset;
}

function writeTexturedTextureSource(gx: WebGpuGxGpuState, floatOffset: number): void {
	const halfWordOffset = floatOffset << 1;
	gx.texturedVertexHalfWords[halfWordOffset] = gx.texturedTextureSource[0];
	gx.texturedVertexHalfWords[halfWordOffset + 1] = gx.texturedTextureSource[1];
	gx.texturedVertexHalfWords[halfWordOffset + 2] = gx.texturedTextureSource[2];
	gx.texturedVertexHalfWords[halfWordOffset + 3] = gx.texturedTextureSource[3];
}

function writeTexturedVertex(gx: WebGpuGxGpuState, offset: number, x: number, y: number, colorWord: number): number {
	gx.texturedVertices[offset] = x;
	gx.texturedVertices[offset + 1] = y;
	gx.texturedVertices[offset + 2] = (colorWord & 0xff) / 255;
	gx.texturedVertices[offset + 3] = ((colorWord >>> 8) & 0xff) / 255;
	gx.texturedVertices[offset + 4] = ((colorWord >>> 16) & 0xff) / 255;
	writeTexturedTextureSource(gx, offset + GX_GPU_TEXTURED_TEXTURE_SOURCE_FLOAT_OFFSET);
	return offset + GX_GPU_TEXTURED_VERTEX_FLOATS;
}

function prepareTexturedUvPlane(gx: WebGpuGxGpuState, determinant: number, x0: number, y0: number, u0: number, v0: number, x1: number, y1: number, u1: number, v1: number, x2: number, y2: number, u2: number, v2: number): void {
	gx.texturedUvPlane[0] = u0;
	gx.texturedUvPlane[1] = v0;
	gx.texturedUvPlane[2] = u1;
	gx.texturedUvPlane[3] = v1;
	gx.texturedUvPlane[4] = u2;
	gx.texturedUvPlane[5] = v2;
	gxGpuTriangleAttributePlane(gx.texturedUvPlane, 0, GX_GPU_TEXTURED_UV_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
}

function appendTexturedTriangle(gx: WebGpuGxGpuState, vertexFloatCount: number, determinant: number, x0: number, y0: number, color0: number, u0: number, v0: number, x1: number, y1: number, color1: number, u1: number, v1: number, x2: number, y2: number, color2: number, u2: number, v2: number): number {
	prepareTexturedUvPlane(gx, determinant, x0, y0, u0, v0, x1, y1, u1, v1, x2, y2, u2, v2);
	let offset = vertexFloatCount;
	offset = writeTexturedVertex(gx, offset, x0, y0, color0);
	offset = writeTexturedVertex(gx, offset, x1, y1, color1);
	offset = writeTexturedVertex(gx, offset, x2, y2, color2);
	for (let vertexOffset = vertexFloatCount; vertexOffset < offset; vertexOffset += GX_GPU_TEXTURED_VERTEX_FLOATS) {
		gx.texturedVertexWords[vertexOffset + 5] = gx.texturedUvPlane[0];
		gx.texturedVertexWords[vertexOffset + 6] = gx.texturedUvPlane[1];
		gx.texturedVertexWords[vertexOffset + 7] = gx.texturedUvPlane[2];
		gx.texturedVertexWords[vertexOffset + 8] = gx.texturedUvPlane[3];
		gx.texturedVertexWords[vertexOffset + 9] = gx.texturedUvPlane[4];
		gx.texturedVertexWords[vertexOffset + 10] = gx.texturedUvPlane[5];
	}
	return offset;
}

function writeFixedTexturedVertex(gx: WebGpuGxGpuState, offset: number, x: number, y: number): number {
	gx.texturedVertices[offset] = x;
	gx.texturedVertices[offset + 1] = y;
	for (let component = 0; component < GX_GPU_TEXTURED_UV_COMPONENTS; component += 1) {
		gx.texturedVertexWords[offset + 2 + component] = gx.texturedUvPlane[component];
		gx.texturedVertexWords[offset + 4 + component] = gx.texturedUvPlane[GX_GPU_TEXTURED_UV_COMPONENTS + component];
		gx.texturedVertexWords[offset + 6 + component] = gx.texturedUvPlane[GX_GPU_TEXTURED_UV_COMPONENTS * 2 + component];
	}
	for (let component = 0; component < GX_GPU_COLOR_COMPONENTS; component += 1) {
		gx.texturedVertexWords[offset + 8 + component] = gx.colorPlane[component];
		gx.texturedVertexWords[offset + 11 + component] = gx.colorPlane[GX_GPU_COLOR_COMPONENTS + component];
		gx.texturedVertexWords[offset + 14 + component] = gx.colorPlane[GX_GPU_COLOR_COMPONENTS * 2 + component];
	}
	writeTexturedTextureSource(gx, offset + GX_GPU_FIXED_TEXTURED_TEXTURE_SOURCE_FLOAT_OFFSET);
	return offset + GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS;
}

function appendTexturedPrimitiveTriangle(gx: WebGpuGxGpuState, vertexFloatCount: number, fixedColor: boolean, x0: number, y0: number, color0: number, u0: number, v0: number, x1: number, y1: number, color1: number, u1: number, v1: number, x2: number, y2: number, color2: number, u2: number, v2: number): number {
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
	if (fixedColor) {
		prepareTexturedUvPlane(gx, determinant, x0, y0, u0, v0, x1, y1, u1, v1, x2, y2, u2, v2);
		gx.colorPlane[0] = color0 & 0xff;
		gx.colorPlane[1] = (color0 >>> 8) & 0xff;
		gx.colorPlane[2] = (color0 >>> 16) & 0xff;
		gx.colorPlane[3] = color1 & 0xff;
		gx.colorPlane[4] = (color1 >>> 8) & 0xff;
		gx.colorPlane[5] = (color1 >>> 16) & 0xff;
		gx.colorPlane[6] = color2 & 0xff;
		gx.colorPlane[7] = (color2 >>> 8) & 0xff;
		gx.colorPlane[8] = (color2 >>> 16) & 0xff;
		gxGpuTriangleAttributePlane(gx.colorPlane, 0, GX_GPU_COLOR_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
		let offset = vertexFloatCount;
		offset = writeFixedTexturedVertex(gx, offset, x0, y0);
		offset = writeFixedTexturedVertex(gx, offset, x1, y1);
		offset = writeFixedTexturedVertex(gx, offset, x2, y2);
		return offset;
	}
	return appendTexturedTriangle(gx, vertexFloatCount, determinant, x0, y0, color0, u0, v0, x1, y1, color1, u1, v1, x2, y2, color2, u2, v2);
}

function appendTexturedPolygon(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
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
		let offset = appendTexturedPrimitiveTriangle(gx, vertexFloatCount, fixedColor, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, gxGpuTextureU(texture0), gxGpuTextureV(texture0), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2));
		if (gxGpuCommandQuadPolygon(opcode)) {
			const color3 = commandBuffer.words[wordStart + 9];
			const xy3 = commandBuffer.words[wordStart + 10];
			const texture3 = commandBuffer.words[wordStart + 11];
			offset = appendTexturedPrimitiveTriangle(gx, offset, fixedColor, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color2, gxGpuTextureU(texture2), gxGpuTextureV(texture2), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color3, gxGpuTextureU(texture3), gxGpuTextureV(texture3));
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
	let offset = appendTexturedPrimitiveTriangle(gx, vertexFloatCount, fixedColor, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color, gxGpuTextureU(texture0), gxGpuTextureV(texture0), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, gxGpuTextureU(texture2), gxGpuTextureV(texture2));
	if (gxGpuCommandQuadPolygon(opcode)) {
		const xy3 = commandBuffer.words[wordStart + 7];
		const texture3 = commandBuffer.words[wordStart + 8];
		offset = appendTexturedPrimitiveTriangle(gx, offset, fixedColor, dx + gxGpuSigned11(xy2), dy + gxGpuVertexY(xy2), color, gxGpuTextureU(texture2), gxGpuTextureV(texture2), dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color, gxGpuTextureU(texture1), gxGpuTextureV(texture1), dx + gxGpuSigned11(xy3), dy + gxGpuVertexY(xy3), color, gxGpuTextureU(texture3), gxGpuTextureV(texture3));
	}
	return offset;
}

function appendTexturedRectangle(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const wordStart = commandBuffer.commandWordStart[commandIndex];
	const colorWord = commandBuffer.words[wordStart];
	const textureWord = commandBuffer.words[wordStart + 2];
	const rect = readGxGpuRectangle(gx, commandBuffer, commandIndex, opcode);
	if (rect.width === 0 || rect.height === 0) return vertexFloatCount;
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const xFlip = gxGpuDrawModeTextureRectangleXFlip(drawModeWord);
	const yFlip = gxGpuDrawModeTextureRectangleYFlip(drawModeWord);
	const u0 = gxGpuTextureU(textureWord);
	const v0 = gxGpuTextureV(textureWord);
	const u1 = u0 + (xFlip ? -rect.width : rect.width);
	const v1 = v0 + (yFlip ? -rect.height : rect.height);
	const determinant = rect.width * rect.height;
	let offset = vertexFloatCount;
	offset = appendTexturedTriangle(gx, offset, determinant, rect.x0, rect.y0, colorWord, u0, v0, rect.x1, rect.y0, colorWord, u1, v0, rect.x0, rect.y1, colorWord, u0, v1);
	offset = appendTexturedTriangle(gx, offset, determinant, rect.x0, rect.y1, colorWord, u0, v1, rect.x1, rect.y0, colorWord, u1, v0, rect.x1, rect.y1, colorWord, u1, v1);
	return offset;
}

function appendTransferTriangle(gx: WebGpuGxGpuState, vertexFloatCount: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, sourceOffsetX: number, sourceOffsetY: number): number {
	let offset = vertexFloatCount;
	offset = writeTransferVertex(gx.transferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x0, y0, sourceOffsetX, sourceOffsetY);
	offset = writeTransferVertex(gx.transferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x1, y1, sourceOffsetX, sourceOffsetY);
	offset = writeTransferVertex(gx.transferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x2, y2, sourceOffsetX, sourceOffsetY);
	return offset;
}

function writeTransferVertex(vertices: Float32Array, offset: number, vertexFloatStride: number, x: number, y: number, sourceOffsetX: number, sourceOffsetY: number): number {
	vertices[offset] = x;
	vertices[offset + 1] = y;
	vertices[offset + 2] = sourceOffsetX;
	vertices[offset + 3] = sourceOffsetY;
	return offset + vertexFloatStride;
}

function appendTransferQuad(gx: WebGpuGxGpuState, vertexFloatCount: number, x: number, y: number, width: number, height: number, u: number, v: number): number {
	const x1 = x + width;
	const y1 = y + height;
	const sourceOffsetX = u - x;
	const sourceOffsetY = v - y;
	let offset = vertexFloatCount;
	offset = appendTransferTriangle(gx, offset, x, y, x1, y, x, y1, sourceOffsetX, sourceOffsetY);
	offset = appendTransferTriangle(gx, offset, x, y1, x1, y, x1, y1, sourceOffsetX, sourceOffsetY);
	return offset;
}

function writeVramSnapshotUpload(gx: WebGpuGxGpuState, snapshotBytes: Uint8Array): void {
	const upload = gx.vramSnapshotUpload;
	let uploadOffset = 0;
	let snapshotOffset = 0;
	for (let pixel = 0; pixel < GX_GPU_VRAM_X_ADDRESS_PERIOD * gx.vramTextureRows; pixel += 1) {
		upload[uploadOffset] = snapshotBytes[snapshotOffset];
		upload[uploadOffset + 1] = snapshotBytes[snapshotOffset + 1];
		upload[uploadOffset + 2] = 0;
		upload[uploadOffset + 3] = 0xff;
		uploadOffset += 4;
		snapshotOffset += 2;
	}
}

function uploadGxGpuVramSnapshot(gx: WebGpuGxGpuState, snapshotBytes: Uint8Array): void {
	writeVramSnapshotUpload(gx, snapshotBytes);
	gx.vramUploadDestination.texture = gx.vramTexture;
	gx.vramUploadDestinationOrigin.x = 0;
	gx.vramUploadDestinationOrigin.y = 0;
	gx.vramUploadLayout.offset = 0;
	gx.vramUploadLayout.bytesPerRow = GX_GPU_RAW_VRAM_UPLOAD_ROW_BYTES;
	gx.vramUploadLayout.rowsPerImage = gx.vramTextureRows;
	gx.vramUploadExtent.width = GX_GPU_VRAM_X_ADDRESS_PERIOD;
	gx.vramUploadExtent.height = gx.vramTextureRows;
	gx.backend.device.queue.writeTexture(gx.vramUploadDestination, gx.vramSnapshotUpload, gx.vramUploadLayout, gx.vramUploadExtent);
	gx.backend.accountUpload('texture', gx.vramSnapshotUpload.byteLength);
	gx.sampleDirtyRect.left = 0;
	gx.sampleDirtyRect.top = 0;
	gx.sampleDirtyRect.right = GX_GPU_VRAM_X_ADDRESS_PERIOD;
	gx.sampleDirtyRect.bottom = gx.vramTextureRows;
}

function uploadCpuToVramPayload(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, payloadWordStart: number, pixelCount: number): void {
	const device = gx.backend.device;
	const fullRows = pixelCount >>> 10;
	const lastRowWidth = pixelCount & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
	let sourceByteOffset = payloadWordStart * 4;
	gx.vramUploadDestination.texture = gx.cpuUploadTexture;
	gx.vramUploadDestinationOrigin.x = 0;
	gx.vramUploadDestinationOrigin.y = 0;
	gx.vramUploadLayout.bytesPerRow = GX_GPU_CPU_UPLOAD_ROW_BYTES;
	if (fullRows !== 0) {
		gx.vramUploadLayout.offset = sourceByteOffset;
		gx.vramUploadLayout.rowsPerImage = fullRows;
		gx.vramUploadExtent.width = GX_GPU_VRAM_X_ADDRESS_PERIOD;
		gx.vramUploadExtent.height = fullRows;
		device.queue.writeTexture(gx.vramUploadDestination, commandBuffer.wordBytes, gx.vramUploadLayout, gx.vramUploadExtent);
		sourceByteOffset += fullRows * GX_GPU_CPU_UPLOAD_ROW_BYTES;
	}
	if (lastRowWidth !== 0) {
		gx.vramUploadDestinationOrigin.y = fullRows;
		gx.vramUploadLayout.offset = sourceByteOffset;
		gx.vramUploadLayout.rowsPerImage = 1;
		gx.vramUploadExtent.width = lastRowWidth;
		gx.vramUploadExtent.height = 1;
		device.queue.writeTexture(gx.vramUploadDestination, commandBuffer.wordBytes, gx.vramUploadLayout, gx.vramUploadExtent);
	}
	gx.backend.accountUpload('texture', pixelCount * GX_GPU_CPU_UPLOAD_BYTES_PER_PIXEL);
}

function markGxGpuSampleTextureDirtyArea(gx: WebGpuGxGpuState, left: number, top: number, right: number, bottom: number): void {
	if (right <= left || bottom <= top) return;
	if (left < gx.sampleDirtyRect.left) gx.sampleDirtyRect.left = left;
	if (top < gx.sampleDirtyRect.top) gx.sampleDirtyRect.top = top;
	if (right > gx.sampleDirtyRect.right) gx.sampleDirtyRect.right = right;
	if (bottom > gx.sampleDirtyRect.bottom) gx.sampleDirtyRect.bottom = bottom;
}

function markGxGpuSampleTextureDirtyLogicalArea(gx: WebGpuGxGpuState, x: number, y: number, width: number, height: number, vramYAddressExtensionWord: number): void {
	let rowY = gxGpuVramYAddress(y, vramYAddressExtensionWord);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight, vramYAddressExtensionWord, gx.backend.gxGpuVramTextureRowMask);
		const physicalY = rowY & gx.backend.gxGpuVramTextureRowMask;
		let columnX = x & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			markGxGpuSampleTextureDirtyArea(gx, columnX, physicalY, columnX + runWidth, physicalY + runHeight);
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
			remainingWidth -= runWidth;
		}
		rowY = gxGpuVramYAddress(rowY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
}

function copyGxGpuVramAreaToSampleTexture(gx: WebGpuGxGpuState, left: number, top: number, right: number, bottom: number): void {
	const encoder = gx.activeEncoder!;
	if (right <= left || bottom <= top) return;
	gx.vramCopySourceOrigin.x = left;
	gx.vramCopySourceOrigin.y = top;
	gx.vramCopyDestinationOrigin.x = left;
	gx.vramCopyDestinationOrigin.y = top;
	gx.vramCopyExtent.width = right - left;
	gx.vramCopyExtent.height = bottom - top;
	encoder.copyTextureToTexture(gx.vramCopySource, gx.vramCopyDestination, gx.vramCopyExtent);
}

function syncGxGpuSampleTextureArea(gx: WebGpuGxGpuState, left: number, top: number, right: number, bottom: number): boolean {
	if (left >= gx.sampleDirtyRect.right
		|| gx.sampleDirtyRect.left >= right
		|| top >= gx.sampleDirtyRect.bottom
		|| gx.sampleDirtyRect.top >= bottom) {
		return false;
	}
	copyGxGpuVramAreaToSampleTexture(gx, gx.sampleDirtyRect.left, gx.sampleDirtyRect.top, gx.sampleDirtyRect.right, gx.sampleDirtyRect.bottom);
	resetGxGpuVramCopyRect(gx.sampleDirtyRect);
	return true;
}

function syncGxGpuSampleTextureLogicalArea(gx: WebGpuGxGpuState, x: number, y: number, width: number, height: number, vramYAddressExtensionWord: number): void {
	let rowY = gxGpuVramYAddress(y, vramYAddressExtensionWord);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight, vramYAddressExtensionWord, gx.backend.gxGpuVramTextureRowMask);
		const physicalY = rowY & gx.backend.gxGpuVramTextureRowMask;
		let columnX = x & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			if (syncGxGpuSampleTextureArea(gx, columnX, physicalY, columnX + runWidth, physicalY + runHeight)) return;
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
			remainingWidth -= runWidth;
		}
		rowY = gxGpuVramYAddress(rowY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
}

function resetGxGpuVramCopyRect(rect: GxGpuVramCopyRect): void {
	rect.left = GX_GPU_VRAM_X_ADDRESS_PERIOD;
	rect.top = GX_GPU_VRAM_Y_ADDRESS_PERIOD;
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

function gxGpuVramCopyRectsOverlap(gx: WebGpuGxGpuState, a: GxGpuVramCopyRect, b: GxGpuVramCopyRect, vramYAddressExtensionWord: number): boolean {
	if (a.right <= a.left || a.bottom <= a.top) return false;
	return gxGpuVramLogicalAreaOverlapsBounds(a.left, a.top, a.right - a.left, a.bottom - a.top, b.left, b.top, b.right, b.bottom, vramYAddressExtensionWord, gx.backend.gxGpuVramTextureRowMask);
}

function setGxGpuVertexBoundsRect(rect: GxGpuVramCopyRect, vertices: Float32Array, vertexFloatStart: number, vertexFloatEnd: number, vertexFloatStride: number, topLeftWord: number, bottomRightWord: number, vramYAddressExtensionWord: number): void {
	resetGxGpuVramCopyRect(rect);
	for (let offset = vertexFloatStart; offset < vertexFloatEnd; offset += vertexFloatStride) {
		includeGxGpuVramCopyVertex(rect, vertices[offset], vertices[offset + 1]);
	}
	const drawingLeft = gxGpuDrawingAreaLeft(topLeftWord, bottomRightWord);
	const drawingTop = gxGpuDrawingAreaTop(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	const drawingRight = gxGpuDrawingAreaRightExclusive(topLeftWord, bottomRightWord);
	const drawingBottom = gxGpuDrawingAreaBottomExclusive(topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	rect.left = rect.left > drawingLeft ? rect.left : drawingLeft;
	rect.top = rect.top > drawingTop ? rect.top : drawingTop;
	rect.right = rect.right < drawingRight ? rect.right : drawingRight;
	rect.bottom = rect.bottom < drawingBottom ? rect.bottom : drawingBottom;
	rect.right = rect.right > rect.left ? rect.right : rect.left;
	rect.bottom = rect.bottom > rect.top ? rect.bottom : rect.top;
}

function syncGxGpuTexturedSourceTexture(gx: WebGpuGxGpuState,
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
	const rect = gx.vramCopyRectScratch;
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
	resetGxGpuVramCopyRect(rect);
	for (let offset = vertexFloatStart; offset < vertexFloatEnd; offset += vertexFloatStride) {
		const x = gx.texturedVertices[offset];
		const y = gx.texturedVertices[offset + 1];
		const planeOffset = fixedColor ? 2 : 5;
		const u = ((gx.texturedVertexWords[offset + planeOffset] + gx.texturedVertexWords[offset + planeOffset + 2] * x + gx.texturedVertexWords[offset + planeOffset + 4] * y) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
		const v = ((gx.texturedVertexWords[offset + planeOffset + 1] + gx.texturedVertexWords[offset + planeOffset + 3] * x + gx.texturedVertexWords[offset + planeOffset + 5] * y) & GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >>> GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS;
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
	if (gxGpuVramLogicalAreaOverlapsBounds(sourceX, sourceY, sourceWidth, sourceHeight, commandRect.left, commandRect.top, commandRect.right, commandRect.bottom, vramYAddressExtensionWord, gx.backend.gxGpuVramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP;
	if (gxGpuVramLogicalAreaOverlapsBounds(sourceX, sourceY, sourceWidth, sourceHeight, batchRect.left, batchRect.top, batchRect.right, batchRect.bottom, vramYAddressExtensionWord, gx.backend.gxGpuVramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP;
	syncGxGpuSampleTextureLogicalArea(gx, sourceX, sourceY, sourceWidth, sourceHeight, vramYAddressExtensionWord);
	if (textureMode < 2) {
		const clutX = gxGpuTextureClutBaseX(textureWord);
		const clutY = gxGpuTextureClutBaseY(textureWord, vramYAddressExtensionWord);
		const clutWidth = textureMode === 0 ? GX_GPU_CLUT_4BIT_WORDS : GX_GPU_CLUT_8BIT_WORDS;
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1, commandRect.left, commandRect.top, commandRect.right, commandRect.bottom, vramYAddressExtensionWord, gx.backend.gxGpuVramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP;
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1, batchRect.left, batchRect.top, batchRect.right, batchRect.bottom, vramYAddressExtensionWord, gx.backend.gxGpuVramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP;
		syncGxGpuSampleTextureLogicalArea(gx, clutX, clutY, clutWidth, 1, vramYAddressExtensionWord);
	}
	return overlaps;
}

function writePrimitiveUniforms(gx: WebGpuGxGpuState, blendEnabled: boolean, blendMode: number, maskBitModeWord: number, ditherEnabled: boolean, skippedLineParity: number, rasterKind: GxGpuRasterKind): void {
	gx.primitiveUniformScratch[0] = blendEnabled ? 1 : 0;
	gx.primitiveUniformScratch[1] = blendMode;
	gx.primitiveUniformScratch[2] = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0;
	gx.primitiveUniformScratch[3] = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0;
	gx.primitiveUniformScratch[4] = ditherEnabled ? 1 : 0;
	gx.primitiveUniformScratch[5] = skippedLineParity;
	gx.primitiveUniformFloatScratch[6] = rasterKind === GxGpuRasterKind.Polygon ? 0.5 : 0;
	gx.primitiveUniformScratch[7] = 0;
}

function drawVramVertices(gx: WebGpuGxGpuState,
	pipeline: GPURenderPipeline,
	bindGroup: GPUBindGroup,
	vertexBuffer: GPUBuffer,
	vertexFloatCount: number,
	vertexFloatStride: number,
	primitiveVertexCount: number,
	vertexByteOffset: number,
	uniformByteOffset: number,
	drawBounds: GxGpuVramCopyRect,
	syncSampleBetweenAliasBands: boolean,
	vramYAddressExtensionWord: number,
): void {
	const left = drawBounds.left;
	const top = drawBounds.top;
	const right = drawBounds.right;
	const bottom = drawBounds.bottom;
	if (right <= left || bottom <= top) return;
	const encoder = gx.activeEncoder!;
	const vertexCount = vertexFloatCount / vertexFloatStride;
	if (gx.vramTextureRows === GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		gx.dynamicUniformOffsets[0] = uniformByteOffset;
		const pass = encoder.beginRenderPass(gx.vramDrawPassDescriptor);
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup, gx.dynamicUniformOffsets);
		pass.setVertexBuffer(0, vertexBuffer, vertexByteOffset, vertexFloatCount * 4);
		pass.setScissorRect(left, top, right - left, bottom - top);
		pass.draw(vertexCount);
		pass.end();
		markGxGpuSampleTextureDirtyLogicalArea(gx, left, top, right - left, bottom - top, vramYAddressExtensionWord);
		return;
	}
	for (let firstVertex = 0; firstVertex < vertexCount; firstVertex += primitiveVertexCount) {
		let logicalYBase = top & ~gx.backend.gxGpuVramTextureRowMask;
		while (logicalYBase < bottom) {
			const logicalTop = top > logicalYBase ? top : logicalYBase;
			const logicalBottomEdge = logicalYBase + gx.vramTextureRows;
			const logicalBottom = bottom < logicalBottomEdge ? bottom : logicalBottomEdge;
			const physicalTop = logicalTop - logicalYBase;
			const physicalBottom = logicalBottom - logicalYBase;
			if (syncSampleBetweenAliasBands) {
				syncGxGpuSampleTextureArea(gx, left, physicalTop, right, physicalBottom);
			}
			gx.dynamicUniformOffsets[0] = uniformByteOffset
				+ (logicalYBase / gx.vramTextureRows) * GX_GPU_UNIFORM_SLOT_BYTES;
			const pass = encoder.beginRenderPass(gx.vramDrawPassDescriptor);
			pass.setViewport(0, -logicalYBase, GX_GPU_VRAM_X_ADDRESS_PERIOD, GX_GPU_VRAM_Y_ADDRESS_PERIOD, 0, 1);
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, bindGroup, gx.dynamicUniformOffsets);
			pass.setVertexBuffer(0, vertexBuffer, vertexByteOffset, vertexFloatCount * 4);
			pass.setScissorRect(left, physicalTop, right - left, logicalBottom - logicalTop);
			pass.draw(primitiveVertexCount, 1, firstVertex, 0);
			pass.end();
			markGxGpuSampleTextureDirtyArea(gx, left, physicalTop, right, physicalBottom);
			logicalYBase += gx.vramTextureRows;
		}
	}
}

function renderVramVertices(gx: WebGpuGxGpuState,
	pipeline: GPURenderPipeline,
	bindGroup: GPUBindGroup,
	vertexBuffer: GPUBuffer,
	vertices: Float32Array,
	vertexFloatCount: number,
	vertexFloatStride: number,
	primitiveVertexCount: number,
	vertexByteOffset: number,
	uniformByteOffset: number,
	drawBounds: GxGpuVramCopyRect,
	syncSampleBetweenAliasBands: boolean,
	vramYAddressExtensionWord: number,
): void {
	const backend = gx.backend;
	backend.device.queue.writeBuffer(vertexBuffer, vertexByteOffset, vertices.buffer, vertices.byteOffset, vertexFloatCount * 4);
	drawVramVertices(gx,
		pipeline,
		bindGroup,
		vertexBuffer,
		vertexFloatCount,
		vertexFloatStride,
		primitiveVertexCount,
		vertexByteOffset,
		uniformByteOffset,
		drawBounds,
		syncSampleBetweenAliasBands,
		vramYAddressExtensionWord,
	);
	backend.accountUpload('vertex', vertexFloatCount * 4);
}

function flushSolidCommands(gx: WebGpuGxGpuState, vertexFloatCount: number): number {
	if (vertexFloatCount !== 0) {
		const fixedColor = gx.solidBatchState.fixedColor;
		const vertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
		const pipeline = fixedColor ? gx.fixedSolidPipeline : gx.solidPipeline;
		const drawWidth = gx.solidBatchRect.right - gx.solidBatchRect.left;
		const drawHeight = gx.solidBatchRect.bottom - gx.solidBatchRect.top;
		if (gx.solidBatchState.readsVram) syncGxGpuSampleTextureLogicalArea(gx, gx.solidBatchRect.left, gx.solidBatchRect.top, drawWidth, drawHeight, gx.solidBatchState.vramYAddressExtensionWord);
		writePrimitiveUniforms(gx, gx.solidBatchState.blendEnabled, gx.solidBatchState.blendMode, gx.solidBatchState.maskBitModeWord, gx.solidBatchState.ditherEnabled, gx.solidBatchState.skippedLineParity, gx.solidBatchState.rasterKind);
		const uniformByteOffset = gx.primitiveUniformByteOffset;
		const vertexByteOffset = gx.solidVertexByteOffset;
		gx.backend.device.queue.writeBuffer(gx.primitiveUniformBuffer, uniformByteOffset, gx.primitiveUniformScratch);
		gx.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
		if (gx.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
			for (let logicalYBase = gx.vramTextureRows;
				logicalYBase < GX_GPU_VRAM_Y_ADDRESS_PERIOD;
				logicalYBase += gx.vramTextureRows) {
				gx.primitiveUniformScratch[7] = logicalYBase;
				gx.backend.device.queue.writeBuffer(
					gx.primitiveUniformBuffer,
					gx.primitiveUniformByteOffset,
					gx.primitiveUniformScratch,
				);
				gx.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
			}
		}
		gx.solidVertexByteOffset += vertexFloatCount * 4;
		renderVramVertices(gx,
			pipeline,
			gx.solidBindGroup,
			gx.solidVertexBuffer,
			gx.solidVertices,
			vertexFloatCount,
			vertexFloatStride,
			gx.solidBatchState.rasterKind === GxGpuRasterKind.Polygon ? 3 : 6,
			vertexByteOffset,
			uniformByteOffset,
			gx.solidBatchRect,
			gx.solidBatchState.readsVram,
			gx.solidBatchState.vramYAddressExtensionWord,
		);
	}
	resetGxGpuVramCopyRect(gx.solidBatchRect);
	return 0;
}

function renderReadVramSolidQuad(gx: WebGpuGxGpuState, topLeftWord: number, bottomRightWord: number, vramYAddressExtensionWord: number, blendEnabled: boolean, blendMode: number, maskBitModeWord: number, ditherEnabled: boolean, skippedLineParity: number): void {
	const fixedColor = gx.solidBatchState.fixedColor;
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
	const triangleFloatCount = fixedColor ? GX_GPU_FIXED_SOLID_TRIANGLE_FLOATS : GX_GPU_SOLID_TRIANGLE_FLOATS;
	const pipeline = fixedColor ? gx.fixedSolidPipeline : gx.solidPipeline;
	setGxGpuVertexBoundsRect(gx.vramCopyRectScratch, gx.solidVertices, 0, triangleFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	let drawLeft = gx.vramCopyRectScratch.left;
	let drawTop = gx.vramCopyRectScratch.top;
	let drawWidth = gx.vramCopyRectScratch.right - drawLeft;
	let drawHeight = gx.vramCopyRectScratch.bottom - drawTop;
	syncGxGpuSampleTextureLogicalArea(gx, drawLeft, drawTop, drawWidth, drawHeight, vramYAddressExtensionWord);
	writePrimitiveUniforms(gx, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity, GxGpuRasterKind.Polygon);
	const uniformByteOffset = gx.primitiveUniformByteOffset;
	const vertexByteOffset = gx.solidVertexByteOffset;
	const vertexFloatCount = triangleFloatCount * 2;
	gx.backend.device.queue.writeBuffer(gx.primitiveUniformBuffer, uniformByteOffset, gx.primitiveUniformScratch);
	gx.backend.device.queue.writeBuffer(gx.solidVertexBuffer, vertexByteOffset, gx.solidVertices.buffer, gx.solidVertices.byteOffset, vertexFloatCount * 4);
	gx.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
	if (gx.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		for (let logicalYBase = gx.vramTextureRows;
			logicalYBase < GX_GPU_VRAM_Y_ADDRESS_PERIOD;
			logicalYBase += gx.vramTextureRows) {
			gx.primitiveUniformScratch[7] = logicalYBase;
			gx.backend.device.queue.writeBuffer(
				gx.primitiveUniformBuffer,
				gx.primitiveUniformByteOffset,
				gx.primitiveUniformScratch,
			);
			gx.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
		}
	}
	gx.solidVertexByteOffset += vertexFloatCount * 4;
	gx.backend.accountUpload('vertex', vertexFloatCount * 4);
	drawVramVertices(gx,
		pipeline,
		gx.solidBindGroup,
		gx.solidVertexBuffer,
		triangleFloatCount,
		vertexFloatStride,
		3,
		vertexByteOffset,
		uniformByteOffset,
		gx.vramCopyRectScratch,
		true,
		vramYAddressExtensionWord,
	);
	setGxGpuVertexBoundsRect(gx.vramCopyRectScratch, gx.solidVertices, triangleFloatCount, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	drawLeft = gx.vramCopyRectScratch.left;
	drawTop = gx.vramCopyRectScratch.top;
	drawWidth = gx.vramCopyRectScratch.right - drawLeft;
	drawHeight = gx.vramCopyRectScratch.bottom - drawTop;
	syncGxGpuSampleTextureLogicalArea(gx, drawLeft, drawTop, drawWidth, drawHeight, vramYAddressExtensionWord);
	drawVramVertices(gx,
		pipeline,
		gx.solidBindGroup,
		gx.solidVertexBuffer,
		triangleFloatCount,
		vertexFloatStride,
		3,
		vertexByteOffset + triangleFloatCount * 4,
		uniformByteOffset,
		gx.vramCopyRectScratch,
		true,
		vramYAddressExtensionWord,
	);
}

function renderLineVertices(gx: WebGpuGxGpuState,
	vertexFloatCount: number,
	uniformByteOffset: number,
	drawBounds: GxGpuVramCopyRect,
	syncSampleBetweenAliasBands: boolean,
	vramYAddressExtensionWord: number,
): void {
	if (vertexFloatCount === 0) return;
	const vertexByteOffset = gx.lineVertexByteOffset;
	gx.lineVertexByteOffset += vertexFloatCount * 4;
	renderVramVertices(gx,
		gx.linePipeline,
		gx.lineBindGroup,
		gx.lineVertexBuffer,
		gx.lineVertices,
		vertexFloatCount,
		GX_GPU_LINE_VERTEX_FLOATS,
		GX_GPU_LINE_VERTICES_PER_SEGMENT,
		vertexByteOffset,
		uniformByteOffset,
		drawBounds,
		syncSampleBetweenAliasBands,
		vramYAddressExtensionWord,
	);
}

function writeTexturedUniforms(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	gx.texturedUniformScratch[0] = gxGpuTextureWindowAndX(textureWindowWord);
	gx.texturedUniformScratch[1] = gxGpuTextureWindowAndY(textureWindowWord);
	gx.texturedUniformScratch[2] = gxGpuTextureWindowOrX(textureWindowWord);
	gx.texturedUniformScratch[3] = gxGpuTextureWindowOrY(textureWindowWord);
	gx.texturedUniformScratch[4] = gxGpuDrawModeTextureMode(drawModeWord);
	gx.texturedUniformScratch[5] = gxGpuCommandRawTextureEnabled(opcode) ? 1 : 0;
	gx.texturedUniformScratch[6] = gxGpuCommandSemiTransparencyEnabled(opcode) ? 1 : 0;
	gx.texturedUniformScratch[7] = gxGpuDrawModeTransparencyMode(drawModeWord);
	gx.texturedUniformScratch[8] = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0;
	gx.texturedUniformScratch[9] = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0;
	gx.texturedUniformScratch[10] = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode) ? 1 : 0;
	gx.texturedUniformScratch[11] = commandBuffer.commandSkippedLineParity[commandIndex];
	gx.texturedUniformFloatScratch[12] = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON ? 0.5 : 0;
	gx.texturedUniformScratch[13] = 0;
}

function appendTexturedCommandVertices(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const textureWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	gx.texturedTextureSource[0] = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	gx.texturedTextureSource[1] = gxGpuDrawModeTexturePageBaseY(drawModeWord, vramYAddressExtensionWord);
	gx.texturedTextureSource[2] = gxGpuTextureClutBaseX(textureWord);
	gx.texturedTextureSource[3] = gxGpuTextureClutBaseY(textureWord, vramYAddressExtensionWord);
	return commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
		? appendTexturedPolygon(gx, commandBuffer, commandIndex, vertexFloatCount)
		: appendTexturedRectangle(gx, commandBuffer, commandIndex, vertexFloatCount);
}

function renderTexturedVertices(gx: WebGpuGxGpuState,
	commandBuffer: GxGpuCommandBufferView,
	commandIndex: number,
	vertexFloatCount: number,
	topLeftWord: number,
	bottomRightWord: number,
	splitTriangles: boolean,
	syncSourceBetweenTriangles: boolean,
): void {
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const fixedColor = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
		&& gxGpuCommandGouraud(opcode)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
	const pipeline = fixedColor ? gx.fixedTexturedPipeline : gx.texturedPipeline;
	writeTexturedUniforms(gx, commandBuffer, commandIndex);
	const uniformByteOffset = gx.texturedUniformByteOffset;
	const vertexByteOffset = gx.texturedVertexByteOffset;
	gx.backend.device.queue.writeBuffer(gx.texturedUniformBuffer, uniformByteOffset, gx.texturedUniformScratch);
	gx.backend.device.queue.writeBuffer(gx.texturedVertexBuffer, vertexByteOffset, gx.texturedVertices.buffer, gx.texturedVertices.byteOffset, vertexFloatCount * 4);
	gx.texturedUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
	if (gx.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		for (let logicalYBase = gx.vramTextureRows;
			logicalYBase < GX_GPU_VRAM_Y_ADDRESS_PERIOD;
			logicalYBase += gx.vramTextureRows) {
			gx.texturedUniformScratch[13] = logicalYBase;
			gx.backend.device.queue.writeBuffer(
				gx.texturedUniformBuffer,
				gx.texturedUniformByteOffset,
				gx.texturedUniformScratch,
			);
			gx.texturedUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
		}
	}
	gx.texturedVertexByteOffset += vertexFloatCount * 4;
	gx.backend.accountUpload('vertex', vertexFloatCount * 4);
	const primitiveVertexCount = splitTriangles ? 3 : GX_GPU_POLYGON_VERTICES_PER_COMMAND;
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const syncSampleBetweenAliasBands = readsVram || syncSourceBetweenTriangles;
	if (!splitTriangles) {
		drawVramVertices(gx,
			pipeline,
			gx.texturedBindGroup,
			gx.texturedVertexBuffer,
			vertexFloatCount,
			vertexFloatStride,
			primitiveVertexCount,
			vertexByteOffset,
			uniformByteOffset,
			gx.texturedCommandRect,
			syncSampleBetweenAliasBands,
			vramYAddressExtensionWord,
		);
		return;
	}
	const triangleFloatCount = vertexFloatStride * 3;
	if (!syncSourceBetweenTriangles
		&& !readsVram
		&& gx.vramTextureRows === GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		drawVramVertices(gx,
			pipeline,
			gx.texturedBindGroup,
			gx.texturedVertexBuffer,
			vertexFloatCount,
			vertexFloatStride,
			primitiveVertexCount,
			vertexByteOffset,
			uniformByteOffset,
			gx.texturedCommandRect,
			syncSampleBetweenAliasBands,
			vramYAddressExtensionWord,
		);
	} else {
		let dependencyBatchFloatStart = 0;
		resetGxGpuVramCopyRect(gx.texturedDependencyBatchRect);
		for (let vertexFloatStart = 0; vertexFloatStart < vertexFloatCount; vertexFloatStart += triangleFloatCount) {
			const vertexFloatEnd = vertexFloatStart + triangleFloatCount;
			setGxGpuVertexBoundsRect(gx.vramCopyRectScratch, gx.texturedVertices, vertexFloatStart, vertexFloatEnd, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
			if (vertexFloatStart !== dependencyBatchFloatStart
				&& (gx.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD
					|| syncSourceBetweenTriangles
					|| gxGpuVramCopyRectsOverlap(gx, gx.texturedDependencyBatchRect, gx.vramCopyRectScratch, vramYAddressExtensionWord))) {
				if (dependencyBatchFloatStart !== 0) {
					if (syncSourceBetweenTriangles) syncGxGpuTexturedSourceTexture(gx, commandBuffer, commandIndex, 0, vertexFloatCount, gx.texturedCommandRect, gx.texturedBatchRect, fixedColor);
					if (readsVram) syncGxGpuSampleTextureLogicalArea(gx,
						gx.texturedDependencyBatchRect.left,
						gx.texturedDependencyBatchRect.top,
						gx.texturedDependencyBatchRect.right - gx.texturedDependencyBatchRect.left,
						gx.texturedDependencyBatchRect.bottom - gx.texturedDependencyBatchRect.top,
						vramYAddressExtensionWord,
					);
				}
				drawVramVertices(gx,
					pipeline,
					gx.texturedBindGroup,
					gx.texturedVertexBuffer,
					vertexFloatStart - dependencyBatchFloatStart,
					vertexFloatStride,
					primitiveVertexCount,
					vertexByteOffset + dependencyBatchFloatStart * 4,
					uniformByteOffset,
					gx.texturedDependencyBatchRect,
					syncSampleBetweenAliasBands,
					vramYAddressExtensionWord,
				);
				dependencyBatchFloatStart = vertexFloatStart;
				resetGxGpuVramCopyRect(gx.texturedDependencyBatchRect);
			}
			includeGxGpuVramCopyRect(gx.texturedDependencyBatchRect, gx.vramCopyRectScratch);
		}
		if (dependencyBatchFloatStart !== 0) {
			if (syncSourceBetweenTriangles) syncGxGpuTexturedSourceTexture(gx, commandBuffer, commandIndex, 0, vertexFloatCount, gx.texturedCommandRect, gx.texturedBatchRect, fixedColor);
			if (readsVram) syncGxGpuSampleTextureLogicalArea(gx,
				gx.texturedDependencyBatchRect.left,
				gx.texturedDependencyBatchRect.top,
				gx.texturedDependencyBatchRect.right - gx.texturedDependencyBatchRect.left,
				gx.texturedDependencyBatchRect.bottom - gx.texturedDependencyBatchRect.top,
				vramYAddressExtensionWord,
			);
		}
		drawVramVertices(gx,
			pipeline,
			gx.texturedBindGroup,
			gx.texturedVertexBuffer,
			vertexFloatCount - dependencyBatchFloatStart,
			vertexFloatStride,
			primitiveVertexCount,
			vertexByteOffset + dependencyBatchFloatStart * 4,
			uniformByteOffset,
			gx.texturedDependencyBatchRect,
			syncSampleBetweenAliasBands,
			vramYAddressExtensionWord,
		);
	}
}

function renderTexturedCommand(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, commandIndex: number, topLeftWord: number, bottomRightWord: number): void {
	const vertexFloatCount = appendTexturedCommandVertices(gx, commandBuffer, commandIndex, 0);
	if (vertexFloatCount === 0) return;
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const fixedColor = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
		&& gxGpuCommandGouraud(opcode)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
	setGxGpuVertexBoundsRect(gx.texturedCommandRect, gx.texturedVertices, 0, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	const sourceOverlaps = syncGxGpuTexturedSourceTexture(gx, commandBuffer, commandIndex, 0, vertexFloatCount, gx.texturedCommandRect, gx.texturedBatchRect, fixedColor);
	const sourceOverlapsDestination = (sourceOverlaps & GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP) !== 0;
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	if (readsVram) {
		syncGxGpuSampleTextureLogicalArea(gx, gx.texturedCommandRect.left, gx.texturedCommandRect.top, gx.texturedCommandRect.right - gx.texturedCommandRect.left, gx.texturedCommandRect.bottom - gx.texturedCommandRect.top, vramYAddressExtensionWord);
	}
	renderTexturedVertices(gx,
		commandBuffer,
		commandIndex,
		vertexFloatCount,
		topLeftWord,
		bottomRightWord,
		commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON,
		sourceOverlapsDestination,
	);
}

function flushTexturedCommands(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, vertexFloatCount: number, batchCommandIndex: number): number {
	if (vertexFloatCount !== 0) {
		const topLeftWord = commandBuffer.commandDrawingAreaTopLeftWord[batchCommandIndex];
		const bottomRightWord = commandBuffer.commandDrawingAreaBottomRightWord[batchCommandIndex];
		const opcode = commandBuffer.commandOpcode[batchCommandIndex];
		const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[batchCommandIndex];
		const fixedColor = commandBuffer.commandKind[batchCommandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
			&& gxGpuCommandGouraud(opcode)
			&& !gxGpuCommandRawTextureEnabled(opcode);
		const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
		setGxGpuVertexBoundsRect(gx.texturedCommandRect, gx.texturedVertices, 0, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
		const maskBitModeWord = commandBuffer.commandMaskBitModeWord[batchCommandIndex];
		const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
		if (readsVram) syncGxGpuSampleTextureLogicalArea(gx, gx.texturedCommandRect.left, gx.texturedCommandRect.top, gx.texturedCommandRect.right - gx.texturedCommandRect.left, gx.texturedCommandRect.bottom - gx.texturedCommandRect.top, vramYAddressExtensionWord);
		renderTexturedVertices(gx, commandBuffer, batchCommandIndex, vertexFloatCount, topLeftWord, bottomRightWord, readsVram, false);
	}
	resetGxGpuVramCopyRect(gx.texturedBatchRect);
	return 0;
}

function renderTransferCommands(gx: WebGpuGxGpuState,
	vertexFloatCount: number,
	bindGroup: GPUBindGroup,
	maskBitModeWord: number,
	syncSampleBetweenAliasBands: boolean,
	pipeline: GPURenderPipeline,
): void {
	if (vertexFloatCount === 0) return;
	gx.transferUniformScratch[0] = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0;
	gx.transferUniformScratch[1] = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0;
	gx.transferUniformScratch[2] = 0;
	const uniformByteOffset = gx.transferUniformByteOffset;
	const vertexByteOffset = gx.transferVertexByteOffset;
	const backend = gx.backend;
	backend.device.queue.writeBuffer(gx.transferUniformBuffer, uniformByteOffset, gx.transferUniformScratch);
	backend.device.queue.writeBuffer(gx.transferVertexBuffer, vertexByteOffset, gx.transferVertices.buffer, gx.transferVertices.byteOffset, vertexFloatCount * 4);
	gx.transferUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
	if (gx.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		for (let logicalYBase = gx.vramTextureRows;
			logicalYBase < GX_GPU_VRAM_Y_ADDRESS_PERIOD;
			logicalYBase += gx.vramTextureRows) {
			gx.transferUniformScratch[2] = logicalYBase;
			backend.device.queue.writeBuffer(
				gx.transferUniformBuffer,
				gx.transferUniformByteOffset,
				gx.transferUniformScratch,
			);
			gx.transferUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
		}
	}
	gx.transferVertexByteOffset += vertexFloatCount * 4;
	const encoder = gx.activeEncoder!;
	if (gx.vramTextureRows === GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		const pass = encoder.beginRenderPass(gx.vramDrawPassDescriptor);
		pass.setPipeline(pipeline);
		gx.dynamicUniformOffsets[0] = uniformByteOffset;
		pass.setBindGroup(0, bindGroup, gx.dynamicUniformOffsets);
		pass.setVertexBuffer(0, gx.transferVertexBuffer, vertexByteOffset, vertexFloatCount * 4);
		pass.draw(vertexFloatCount / GX_GPU_TRANSFER_VERTEX_FLOATS, 1, 0, 0);
		pass.end();
	} else {
		const transferSegmentFloats = GX_GPU_TRANSFER_VERTICES_PER_SEGMENT * GX_GPU_TRANSFER_VERTEX_FLOATS;
		for (let vertexFloatStart = 0;
			vertexFloatStart < vertexFloatCount;
			vertexFloatStart += transferSegmentFloats) {
			const left = gx.transferVertices[vertexFloatStart];
			const top = gx.transferVertices[vertexFloatStart + 1];
			const right = gx.transferVertices[vertexFloatStart + GX_GPU_TRANSFER_VERTEX_FLOATS];
			const bottom = gx.transferVertices[vertexFloatStart + GX_GPU_TRANSFER_VERTEX_FLOATS * 2 + 1];
			let logicalYBase = top & ~backend.gxGpuVramTextureRowMask;
			while (logicalYBase < bottom) {
				const logicalTop = top > logicalYBase ? top : logicalYBase;
				const logicalBottomEdge = logicalYBase + gx.vramTextureRows;
				const logicalBottom = bottom < logicalBottomEdge ? bottom : logicalBottomEdge;
				const physicalTop = logicalTop - logicalYBase;
				const physicalBottom = logicalBottom - logicalYBase;
				if (syncSampleBetweenAliasBands) {
					syncGxGpuSampleTextureArea(gx, left, physicalTop, right, physicalBottom);
				}
				const pass = encoder.beginRenderPass(gx.vramDrawPassDescriptor);
				pass.setViewport(0, -logicalYBase, GX_GPU_VRAM_X_ADDRESS_PERIOD, GX_GPU_VRAM_Y_ADDRESS_PERIOD, 0, 1);
				pass.setScissorRect(left, physicalTop, right - left, logicalBottom - logicalTop);
				pass.setPipeline(pipeline);
				gx.dynamicUniformOffsets[0] = uniformByteOffset
					+ (logicalYBase / gx.vramTextureRows) * GX_GPU_UNIFORM_SLOT_BYTES;
				pass.setBindGroup(0, bindGroup, gx.dynamicUniformOffsets);
				pass.setVertexBuffer(0, gx.transferVertexBuffer, vertexByteOffset, vertexFloatCount * 4);
				pass.draw(
					GX_GPU_TRANSFER_VERTICES_PER_SEGMENT,
					1,
					vertexFloatStart / GX_GPU_TRANSFER_VERTEX_FLOATS,
					0,
				);
				pass.end();
				markGxGpuSampleTextureDirtyArea(gx, left, physicalTop, right, physicalBottom);
				logicalYBase += gx.vramTextureRows;
			}
		}
	}
	backend.accountUpload('vertex', vertexFloatCount * 4);
}

function appendCpuToVramRows(gx: WebGpuGxGpuState,
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
		const runHeight = gxGpuVramWrappedHeight(targetY, remainingRows, vramYAddressExtensionWord, gx.backend.gxGpuVramTextureRowMask);
		let targetRunX = x;
		let remainingWidth = rowWidth;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(targetRunX, remainingWidth);
			transferVertexFloatCount = appendTransferQuad(gx, transferVertexFloatCount, targetRunX, targetY, runWidth, runHeight, targetRunX, targetY);
			remainingWidth -= runWidth;
			targetRunX = (targetRunX + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
		}
		remainingRows -= runHeight;
		targetY = gxGpuVramYAddress(targetY + runHeight, vramYAddressExtensionWord);
	}
	return transferVertexFloatCount;
}

function uploadCpuToVram(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
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
	const device = gx.backend.device;
	gx.submitCommandBuffers[0] = gx.activeEncoder!.finish();
	device.queue.submit(gx.submitCommandBuffers);
	gx.activeEncoder = device.createCommandEncoder();
	uploadCpuToVramPayload(gx, commandBuffer, payloadWordStart, uploadedPixels);
	if (fullRows !== 0) {
		transferVertexFloatCount = appendCpuToVramRows(gx, x, y, 0, width, fullRows, transferVertexFloatCount, vramYAddressExtensionWord);
	}
	if (lastRowWidth !== 0) {
		transferVertexFloatCount = appendCpuToVramRows(gx, x, y, fullRows, lastRowWidth, 1, transferVertexFloatCount, vramYAddressExtensionWord);
	}
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) syncGxGpuSampleTextureLogicalArea(gx, x, y, width, uploadHeight, vramYAddressExtensionWord);
	gx.transferUniformScratch[4] = x;
	gx.transferUniformScratch[5] = y;
	gx.transferUniformScratch[6] = width;
	gx.transferUniformScratch[7] = gxGpuVramYAddressMask(vramYAddressExtensionWord) + 1;
	renderTransferCommands(gx,
		transferVertexFloatCount,
		gx.transferFromUploadBindGroup,
		maskBitModeWord,
		gxGpuMaskBitCheckBeforeDraw(maskBitModeWord),
		gx.cpuUploadPipeline,
	);
	if (gx.vramTextureRows === GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		if (fullRows !== 0) markGxGpuSampleTextureDirtyLogicalArea(gx, x, y, width, fullRows, vramYAddressExtensionWord);
		if (lastRowWidth !== 0) markGxGpuSampleTextureDirtyLogicalArea(gx, x, y + fullRows, lastRowWidth, 1, vramYAddressExtensionWord);
	}
}

function copyVramToVramArea(gx: WebGpuGxGpuState, sourceX: number, sourceY: number, targetX: number, targetY: number, width: number, height: number, maskBitModeWord: number, vramYAddressExtensionWord: number): void {
	let transferVertexFloatCount = 0;
	let runSourceY = gxGpuVramYAddress(sourceY, vramYAddressExtensionWord);
	let runTargetY = gxGpuVramYAddress(targetY, vramYAddressExtensionWord);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const sourceRunHeight = gxGpuVramWrappedHeight(runSourceY, remainingHeight, vramYAddressExtensionWord, gx.backend.gxGpuVramTextureRowMask);
		const targetRunHeight = gxGpuVramWrappedHeight(runTargetY, remainingHeight, vramYAddressExtensionWord, gx.backend.gxGpuVramTextureRowMask);
		const runHeight = sourceRunHeight < targetRunHeight ? sourceRunHeight : targetRunHeight;
		syncGxGpuSampleTextureLogicalArea(gx, sourceX, runSourceY, width, runHeight, vramYAddressExtensionWord);
		if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) syncGxGpuSampleTextureLogicalArea(gx, targetX, runTargetY, width, runHeight, vramYAddressExtensionWord);
		runSourceY = gxGpuVramYAddress(runSourceY + runHeight, vramYAddressExtensionWord);
		runTargetY = gxGpuVramYAddress(runTargetY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
	runSourceY = gxGpuVramYAddress(sourceY, vramYAddressExtensionWord);
	runTargetY = gxGpuVramYAddress(targetY, vramYAddressExtensionWord);
	remainingHeight = height;
	while (remainingHeight !== 0) {
		const sourceRunHeight = gxGpuVramWrappedHeight(runSourceY, remainingHeight, vramYAddressExtensionWord, gx.backend.gxGpuVramTextureRowMask);
		const targetRunHeight = gxGpuVramWrappedHeight(runTargetY, remainingHeight, vramYAddressExtensionWord, gx.backend.gxGpuVramTextureRowMask);
		const runHeight = sourceRunHeight < targetRunHeight ? sourceRunHeight : targetRunHeight;
		let runSourceX = sourceX;
		let runTargetX = targetX;
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const sourceRunWidth = gxGpuVramWrappedWidth(runSourceX, remainingWidth);
			const targetRunWidth = gxGpuVramWrappedWidth(runTargetX, remainingWidth);
			const runWidth = sourceRunWidth < targetRunWidth ? sourceRunWidth : targetRunWidth;
			transferVertexFloatCount = appendTransferQuad(gx, transferVertexFloatCount, runTargetX, runTargetY, runWidth, runHeight, runSourceX, runSourceY);
			runSourceX = (runSourceX + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
			runTargetX = (runTargetX + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
			remainingWidth -= runWidth;
		}
		runSourceY = gxGpuVramYAddress(runSourceY + runHeight, vramYAddressExtensionWord);
		runTargetY = gxGpuVramYAddress(runTargetY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
	renderTransferCommands(gx,
		transferVertexFloatCount,
		gx.transferFromSampleBindGroup,
		maskBitModeWord,
		true,
		gx.transferPipeline,
	);
	if (gx.vramTextureRows === GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		markGxGpuSampleTextureDirtyLogicalArea(gx, targetX, targetY, width, height, vramYAddressExtensionWord);
	}
}

function copyVramToVram(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
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
	if (gxGpuVramCopyNeedsChunking(
		sourceX,
		sourceY,
		targetX,
		targetY,
		width,
		height,
		vramYAddressExtensionWord,
		gx.backend.gxGpuVramTextureRowMask,
	)) {
		const chunkHeight = gxGpuVramCopyChunkHeight(
			sourceY,
			targetY,
			height,
			vramYAddressExtensionWord,
			gx.backend.gxGpuVramTextureRowMask,
		);
		for (let chunkTargetY = targetY; chunkTargetY < targetY + height; chunkTargetY += chunkHeight) {
			const chunkSourceY = sourceY + (chunkTargetY - targetY);
			const remainingHeight = targetY + height - chunkTargetY;
			const currentChunkHeight = chunkHeight < remainingHeight ? chunkHeight : remainingHeight;
			copyVramToVramArea(gx, sourceX, chunkSourceY, targetX, chunkTargetY, width, currentChunkHeight, maskBitModeWord, vramYAddressExtensionWord);
		}
		return;
	}
	copyVramToVramArea(gx, sourceX, sourceY, targetX, targetY, width, height, maskBitModeWord, vramYAddressExtensionWord);
}

function appendSolidCommandVertices(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	switch (commandBuffer.commandKind[commandIndex]) {
		case GX_GPU_COMMAND_DRAW_POLYGON:
			return appendSolidPolygon(gx, commandBuffer, commandIndex, vertexFloatCount);
		case GX_GPU_COMMAND_DRAW_RECTANGLE:
			return appendSolidRectangle(gx, commandBuffer, commandIndex, vertexFloatCount);
		default:
			return appendFillRectangle(gx, commandBuffer, commandIndex, vertexFloatCount);
	}
}

function flushLineCommands(gx: WebGpuGxGpuState, vertexFloatCount: number): number {
	if (vertexFloatCount !== 0) {
		if (gx.lineBatchState.readsVram) syncGxGpuSampleTextureLogicalArea(gx, gx.lineBatchRect.left, gx.lineBatchRect.top, gx.lineBatchRect.right - gx.lineBatchRect.left, gx.lineBatchRect.bottom - gx.lineBatchRect.top, gx.lineBatchState.vramYAddressExtensionWord);
		renderLineVertices(gx,
			vertexFloatCount,
			gx.lineBatchState.uniformByteOffset,
			gx.lineBatchRect,
			gx.lineBatchState.readsVram,
			gx.lineBatchState.vramYAddressExtensionWord,
		);
	}
	resetGxGpuVramCopyRect(gx.lineBatchRect);
	return 0;
}

function appendBatchedLineSegment(gx: WebGpuGxGpuState, vertexFloatCount: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number): number {
	let offset = vertexFloatCount;
	if (offset + GX_GPU_LINE_SEGMENT_FLOATS > GX_GPU_LINE_FLOAT_CAPACITY) {
		offset = flushLineCommands(gx, offset);
	}
	const commandVertexStart = offset;
	offset = appendLineSegment(gx, offset, x0, y0, color0, x1, y1, color1);
	if (offset !== commandVertexStart) {
		setGxGpuVertexBoundsRect(gx.lineCommandRect, gx.lineVertices, commandVertexStart, offset, GX_GPU_LINE_VERTEX_FLOATS, gx.lineBatchState.topLeftWord, gx.lineBatchState.bottomRightWord, gx.lineBatchState.vramYAddressExtensionWord);
		if (gx.lineBatchState.readsVram && commandVertexStart !== 0 && gxGpuVramCopyRectsOverlap(gx, gx.lineCommandRect, gx.lineBatchRect, gx.lineBatchState.vramYAddressExtensionWord)) {
			offset = flushLineCommands(gx, commandVertexStart);
			offset = appendLineSegment(gx, offset, x0, y0, color0, x1, y1, color1);
			setGxGpuVertexBoundsRect(gx.lineCommandRect, gx.lineVertices, 0, offset, GX_GPU_LINE_VERTEX_FLOATS, gx.lineBatchState.topLeftWord, gx.lineBatchState.bottomRightWord, gx.lineBatchState.vramYAddressExtensionWord);
		}
		if (offset === GX_GPU_LINE_SEGMENT_FLOATS) {
			writePrimitiveUniforms(gx, gx.lineBatchState.blendEnabled, gx.lineBatchState.blendMode, gx.lineBatchState.maskBitModeWord, gx.lineBatchState.ditherEnabled, gx.lineBatchState.skippedLineParity, GxGpuRasterKind.Line);
			gx.lineBatchState.uniformByteOffset = gx.primitiveUniformByteOffset;
			gx.backend.device.queue.writeBuffer(gx.primitiveUniformBuffer, gx.lineBatchState.uniformByteOffset, gx.primitiveUniformScratch);
			gx.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
			if (gx.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
				for (let logicalYBase = gx.vramTextureRows;
					logicalYBase < GX_GPU_VRAM_Y_ADDRESS_PERIOD;
					logicalYBase += gx.vramTextureRows) {
					gx.primitiveUniformScratch[7] = logicalYBase;
					gx.backend.device.queue.writeBuffer(
						gx.primitiveUniformBuffer,
						gx.primitiveUniformByteOffset,
						gx.primitiveUniformScratch,
					);
					gx.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
				}
			}
		}
		includeGxGpuVramCopyRect(gx.lineBatchRect, gx.lineCommandRect);
	}
	return offset;
}

function appendLineCommandVertices(gx: WebGpuGxGpuState, commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
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
			vertexFloatCount = appendBatchedLineSegment(gx, vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1);
		} else {
			const xy1 = words[wordStart + 2];
			vertexFloatCount = appendBatchedLineSegment(gx, vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color0);
		}
	} else if (gxGpuCommandGouraud(opcode)) {
		let color0 = words[wordStart];
		let xy0 = words[wordStart + 1];
		for (let wordIndex = wordStart + 2; wordIndex + 1 < wordEnd; wordIndex += 2) {
			const color1 = words[wordIndex];
			const xy1 = words[wordIndex + 1];
			vertexFloatCount = appendBatchedLineSegment(gx, vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color0, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color1);
			color0 = color1;
			xy0 = xy1;
		}
	} else {
		const color = words[wordStart];
		let xy0 = words[wordStart + 1];
		for (let wordIndex = wordStart + 2; wordIndex < wordEnd; wordIndex += 1) {
			const xy1 = words[wordIndex];
			vertexFloatCount = appendBatchedLineSegment(gx, vertexFloatCount, dx + gxGpuSigned11(xy0), dy + gxGpuVertexY(xy0), color, dx + gxGpuSigned11(xy1), dy + gxGpuVertexY(xy1), color);
			xy0 = xy1;
		}
	}
	return vertexFloatCount;
}

function executeNewGxGpuCommands(gx: WebGpuGxGpuState,
	commandBuffer: GxGpuCommandBufferView,
	readback: GxGpuVramSource['readbackPort'],
	commandLimit: number,
	readbackClaimed: boolean,
): void {
	let commandIndex = gx.processedCommandCount;
	const readbackCanSubmit = gx.gpureadCompletion === null
		&& (readback.phase === GX_GPU_READBACK_PENDING
			|| (readbackClaimed && readback.phase === GX_GPU_READBACK_SUBMITTED))
		&& commandLimit === readback.fenceCommandCount;
	if (commandIndex >= commandLimit && !readbackCanSubmit) {
		return;
	}
	gx.activeEncoder = gx.backend.device.createCommandEncoder();
	gx.solidVertexByteOffset = 0;
	gx.lineVertexByteOffset = 0;
	gx.texturedVertexByteOffset = 0;
	gx.transferVertexByteOffset = 0;
	gx.primitiveUniformByteOffset = 0;
	gx.texturedUniformByteOffset = 0;
	gx.transferUniformByteOffset = 0;
	let solidVertexFloatCount = 0;
	let texturedVertexFloatCount = 0;
	let texturedBatchCommandIndex = 0;
	let lineVertexFloatCount = 0;
	resetGxGpuVramCopyRect(gx.solidBatchRect);
	resetGxGpuVramCopyRect(gx.texturedBatchRect);
	resetGxGpuVramCopyRect(gx.lineBatchRect);
	for (; commandIndex < commandLimit; commandIndex += 1) {
		if (gx.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
			if (solidVertexFloatCount !== 0) solidVertexFloatCount = flushSolidCommands(gx, solidVertexFloatCount);
			if (texturedVertexFloatCount !== 0) texturedVertexFloatCount = flushTexturedCommands(gx, commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
			if (lineVertexFloatCount !== 0) lineVertexFloatCount = flushLineCommands(gx, lineVertexFloatCount);
		}
		const commandKind = commandBuffer.commandKind[commandIndex];
		const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
		const topLeftWord = commandKind === GX_GPU_COMMAND_FILL_RECTANGLE ? GX_GPU_FULL_DRAWING_AREA_TOP_LEFT_WORD : commandBuffer.commandDrawingAreaTopLeftWord[commandIndex];
		const bottomRightWord = commandKind === GX_GPU_COMMAND_FILL_RECTANGLE
			? GX_GPU_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD
			: commandBuffer.commandDrawingAreaBottomRightWord[commandIndex];
		const commandDrawsTexture = (commandKind === GX_GPU_COMMAND_DRAW_POLYGON || commandKind === GX_GPU_COMMAND_DRAW_RECTANGLE)
			&& gxGpuCommandTextureEnabled(commandBuffer.commandOpcode[commandIndex]);
		if (texturedVertexFloatCount !== 0 && !commandDrawsTexture) {
			texturedVertexFloatCount = flushTexturedCommands(gx, commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
		}
		if (lineVertexFloatCount !== 0 && commandKind !== GX_GPU_COMMAND_DRAW_LINE && commandKind !== GX_GPU_COMMAND_DRAW_POLYLINE) {
			lineVertexFloatCount = flushLineCommands(gx, lineVertexFloatCount);
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
					if (solidVertexFloatCount !== 0) solidVertexFloatCount = flushSolidCommands(gx, solidVertexFloatCount);
					const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
					const ditherEnabled = commandKind === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode);
					const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
					const skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
					if (texturedVertexFloatCount !== 0) {
						const batchDrawModeWord = commandBuffer.commandDrawModeWord[texturedBatchCommandIndex];
						const batchOpcode = commandBuffer.commandOpcode[texturedBatchCommandIndex];
						const batchBlendEnabled = gxGpuCommandSemiTransparencyEnabled(batchOpcode);
						const batchDitherEnabled = commandBuffer.commandKind[texturedBatchCommandIndex] === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(batchDrawModeWord, batchOpcode);
						const batchFixedColor = commandBuffer.commandKind[texturedBatchCommandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
							&& gxGpuCommandGouraud(batchOpcode)
							&& !gxGpuCommandRawTextureEnabled(batchOpcode);
						const batchStateChanged = topLeftWord !== commandBuffer.commandDrawingAreaTopLeftWord[texturedBatchCommandIndex]
							|| bottomRightWord !== commandBuffer.commandDrawingAreaBottomRightWord[texturedBatchCommandIndex]
							|| vramYAddressExtensionWord !== commandBuffer.commandVramYAddressExtensionWord[texturedBatchCommandIndex]
							|| commandKind !== commandBuffer.commandKind[texturedBatchCommandIndex]
							|| gxGpuTexturedBatchDrawModeWord(drawModeWord, blendEnabled) !== gxGpuTexturedBatchDrawModeWord(batchDrawModeWord, batchBlendEnabled)
							|| commandBuffer.commandTextureWindowWord[commandIndex] !== commandBuffer.commandTextureWindowWord[texturedBatchCommandIndex]
							|| maskBitModeWord !== commandBuffer.commandMaskBitModeWord[texturedBatchCommandIndex]
							|| skippedLineParity !== commandBuffer.commandSkippedLineParity[texturedBatchCommandIndex]
							|| gxGpuCommandRawTextureEnabled(opcode) !== gxGpuCommandRawTextureEnabled(batchOpcode)
							|| fixedColor !== batchFixedColor
							|| blendEnabled !== batchBlendEnabled
							|| ditherEnabled !== batchDitherEnabled;
						if (batchStateChanged) texturedVertexFloatCount = flushTexturedCommands(gx, commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
					}
					if (texturedVertexFloatCount === 0) texturedBatchCommandIndex = commandIndex;
					const texturedVertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
					let texturedCommandVertexStart = texturedVertexFloatCount;
					texturedVertexFloatCount = appendTexturedCommandVertices(gx, commandBuffer, commandIndex, texturedVertexFloatCount);
					if (texturedVertexFloatCount !== texturedCommandVertexStart) {
						setGxGpuVertexBoundsRect(gx.texturedCommandRect, gx.texturedVertices, texturedCommandVertexStart, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
						let sourceOverlaps = syncGxGpuTexturedSourceTexture(gx, commandBuffer, commandIndex, texturedCommandVertexStart, texturedVertexFloatCount, gx.texturedCommandRect, gx.texturedBatchRect, fixedColor);
						if ((sourceOverlaps & GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP) !== 0) {
							texturedVertexFloatCount = flushTexturedCommands(gx, commandBuffer, texturedCommandVertexStart, texturedBatchCommandIndex);
							texturedBatchCommandIndex = commandIndex;
							texturedCommandVertexStart = 0;
							texturedVertexFloatCount = appendTexturedCommandVertices(gx, commandBuffer, commandIndex, 0);
							setGxGpuVertexBoundsRect(gx.texturedCommandRect, gx.texturedVertices, 0, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
							sourceOverlaps = syncGxGpuTexturedSourceTexture(gx, commandBuffer, commandIndex, 0, texturedVertexFloatCount, gx.texturedCommandRect, gx.texturedBatchRect, fixedColor);
						}
						if ((sourceOverlaps & GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP) !== 0) {
							if (texturedCommandVertexStart !== 0) texturedVertexFloatCount = flushTexturedCommands(gx, commandBuffer, texturedCommandVertexStart, texturedBatchCommandIndex);
							texturedVertexFloatCount = 0;
							resetGxGpuVramCopyRect(gx.texturedBatchRect);
							renderTexturedCommand(gx, commandBuffer, commandIndex, topLeftWord, bottomRightWord);
						} else {
							includeGxGpuVramCopyRect(gx.texturedBatchRect, gx.texturedCommandRect);
						}
					}
					break;
				}
				const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
				const ditherEnabled = commandKind === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode);
				const skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
				const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
				const blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0;
				const readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
				const fixedColor = commandKind === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuCommandGouraud(opcode);
				const rasterKind = commandKind === GX_GPU_COMMAND_DRAW_POLYGON
					? GxGpuRasterKind.Polygon
					: GxGpuRasterKind.Rectangle;
				const splitReadVramQuad = readsVram && commandKind === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuCommandQuadPolygon(opcode);
				const batchStateChanged = topLeftWord !== gx.solidBatchState.topLeftWord
					|| bottomRightWord !== gx.solidBatchState.bottomRightWord
					|| vramYAddressExtensionWord !== gx.solidBatchState.vramYAddressExtensionWord
					|| maskBitModeWord !== gx.solidBatchState.maskBitModeWord
					|| ditherEnabled !== gx.solidBatchState.ditherEnabled
					|| skippedLineParity !== gx.solidBatchState.skippedLineParity
					|| blendEnabled !== gx.solidBatchState.blendEnabled
					|| blendMode !== gx.solidBatchState.blendMode
					|| readsVram !== gx.solidBatchState.readsVram
					|| fixedColor !== gx.solidBatchState.fixedColor
					|| rasterKind !== gx.solidBatchState.rasterKind;
				if (solidVertexFloatCount !== 0 && (batchStateChanged || splitReadVramQuad)) {
					solidVertexFloatCount = flushSolidCommands(gx, solidVertexFloatCount);
				}
				gx.solidBatchState.topLeftWord = topLeftWord;
				gx.solidBatchState.bottomRightWord = bottomRightWord;
				gx.solidBatchState.vramYAddressExtensionWord = vramYAddressExtensionWord;
				gx.solidBatchState.maskBitModeWord = maskBitModeWord;
				gx.solidBatchState.ditherEnabled = ditherEnabled;
				gx.solidBatchState.skippedLineParity = skippedLineParity;
				gx.solidBatchState.blendEnabled = blendEnabled;
				gx.solidBatchState.blendMode = blendMode;
				gx.solidBatchState.readsVram = readsVram;
				gx.solidBatchState.fixedColor = fixedColor;
				gx.solidBatchState.rasterKind = rasterKind;
				const commandVertexStart = solidVertexFloatCount;
				solidVertexFloatCount = appendSolidCommandVertices(gx, commandBuffer, commandIndex, solidVertexFloatCount);
				const solidVertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
				const solidTriangleFloatCount = fixedColor ? GX_GPU_FIXED_SOLID_TRIANGLE_FLOATS : GX_GPU_SOLID_TRIANGLE_FLOATS;
				if (solidVertexFloatCount !== commandVertexStart) {
					setGxGpuVertexBoundsRect(gx.solidCommandRect, gx.solidVertices, commandVertexStart, solidVertexFloatCount, solidVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
					if (splitReadVramQuad && solidVertexFloatCount === solidTriangleFloatCount * 2) {
						renderReadVramSolidQuad(gx, topLeftWord, bottomRightWord, vramYAddressExtensionWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity);
						solidVertexFloatCount = 0;
					} else {
						if (readsVram && commandVertexStart !== 0 && gxGpuVramCopyRectsOverlap(gx, gx.solidCommandRect, gx.solidBatchRect, vramYAddressExtensionWord)) {
							solidVertexFloatCount = flushSolidCommands(gx, commandVertexStart);
							solidVertexFloatCount = appendSolidCommandVertices(gx, commandBuffer, commandIndex, solidVertexFloatCount);
							setGxGpuVertexBoundsRect(gx.solidCommandRect, gx.solidVertices, 0, solidVertexFloatCount, solidVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
						}
						includeGxGpuVramCopyRect(gx.solidBatchRect, gx.solidCommandRect);
					}
				}
				break;
			}
			case GX_GPU_COMMAND_FILL_RECTANGLE: {
				const skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
				if (solidVertexFloatCount !== 0 && (gx.solidBatchState.topLeftWord !== topLeftWord
					|| gx.solidBatchState.bottomRightWord !== bottomRightWord
					|| gx.solidBatchState.vramYAddressExtensionWord !== vramYAddressExtensionWord
					|| gxGpuMaskBitSetWhileDrawing(gx.solidBatchState.maskBitModeWord)
					|| gx.solidBatchState.ditherEnabled
					|| gx.solidBatchState.skippedLineParity !== skippedLineParity
					|| gx.solidBatchState.blendEnabled
					|| gx.solidBatchState.readsVram
					|| gx.solidBatchState.fixedColor
					|| gx.solidBatchState.rasterKind !== GxGpuRasterKind.Rectangle)) {
					solidVertexFloatCount = flushSolidCommands(gx, solidVertexFloatCount);
				}
				gx.solidBatchState.topLeftWord = topLeftWord;
				gx.solidBatchState.bottomRightWord = bottomRightWord;
				gx.solidBatchState.vramYAddressExtensionWord = vramYAddressExtensionWord;
				gx.solidBatchState.maskBitModeWord = 0;
				gx.solidBatchState.ditherEnabled = false;
				gx.solidBatchState.skippedLineParity = skippedLineParity;
				gx.solidBatchState.blendEnabled = false;
				gx.solidBatchState.blendMode = 0;
				gx.solidBatchState.readsVram = false;
				gx.solidBatchState.fixedColor = false;
				gx.solidBatchState.rasterKind = GxGpuRasterKind.Rectangle;
				const commandVertexStart = solidVertexFloatCount;
				solidVertexFloatCount = appendFillRectangle(gx, commandBuffer, commandIndex, solidVertexFloatCount);
				if (solidVertexFloatCount !== commandVertexStart) {
					setGxGpuVertexBoundsRect(gx.solidCommandRect, gx.solidVertices, commandVertexStart, solidVertexFloatCount, GX_GPU_SOLID_VERTEX_FLOATS, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
					includeGxGpuVramCopyRect(gx.solidBatchRect, gx.solidCommandRect);
				}
				break;
			}
			case GX_GPU_COMMAND_DRAW_LINE:
			case GX_GPU_COMMAND_DRAW_POLYLINE: {
				if (solidVertexFloatCount !== 0) solidVertexFloatCount = flushSolidCommands(gx, solidVertexFloatCount);
				const opcode = commandBuffer.commandOpcode[commandIndex];
				const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
				const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
				const blendEnabled = gxGpuCommandSemiTransparencyEnabled(opcode);
				const blendMode = blendEnabled ? gxGpuDrawModeTransparencyMode(drawModeWord) : 0;
				const ditherEnabled = gxGpuDrawModeDitherEnabled(drawModeWord);
				const skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
				const readsVram = blendEnabled || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
				if (lineVertexFloatCount !== 0 && (topLeftWord !== gx.lineBatchState.topLeftWord
					|| bottomRightWord !== gx.lineBatchState.bottomRightWord
					|| vramYAddressExtensionWord !== gx.lineBatchState.vramYAddressExtensionWord
					|| maskBitModeWord !== gx.lineBatchState.maskBitModeWord
					|| ditherEnabled !== gx.lineBatchState.ditherEnabled
					|| skippedLineParity !== gx.lineBatchState.skippedLineParity
					|| blendEnabled !== gx.lineBatchState.blendEnabled
					|| blendMode !== gx.lineBatchState.blendMode
					|| readsVram !== gx.lineBatchState.readsVram)) {
					lineVertexFloatCount = flushLineCommands(gx, lineVertexFloatCount);
				}
				gx.lineBatchState.topLeftWord = topLeftWord;
				gx.lineBatchState.bottomRightWord = bottomRightWord;
				gx.lineBatchState.vramYAddressExtensionWord = vramYAddressExtensionWord;
				gx.lineBatchState.maskBitModeWord = maskBitModeWord;
				gx.lineBatchState.ditherEnabled = ditherEnabled;
				gx.lineBatchState.skippedLineParity = skippedLineParity;
				gx.lineBatchState.blendEnabled = blendEnabled;
				gx.lineBatchState.blendMode = blendMode;
				gx.lineBatchState.readsVram = readsVram;
				lineVertexFloatCount = appendLineCommandVertices(gx, commandBuffer, commandIndex, lineVertexFloatCount);
				break;
			}
			case GX_GPU_COMMAND_COPY_VRAM_TO_VRAM:
				if (solidVertexFloatCount !== 0) solidVertexFloatCount = flushSolidCommands(gx, solidVertexFloatCount);
				copyVramToVram(gx, commandBuffer, commandIndex);
				break;
			case GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM:
				if (solidVertexFloatCount !== 0) solidVertexFloatCount = flushSolidCommands(gx, solidVertexFloatCount);
				uploadCpuToVram(gx, commandBuffer, commandIndex);
				break;
		}
	}
	if (solidVertexFloatCount !== 0) flushSolidCommands(gx, solidVertexFloatCount);
	if (texturedVertexFloatCount !== 0) flushTexturedCommands(gx, commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
	if (lineVertexFloatCount !== 0) flushLineCommands(gx, lineVertexFloatCount);
	const encoder = gx.activeEncoder!;
	let readbackSubmitted = false;
	if (readbackCanSubmit && (readbackClaimed || readback.claimReadback(commandLimit))) {
		const pixelCount = readback.width * readback.height;
		const wordCount = (pixelCount + 1) >> 1;
		const packedWidth = wordCount < GX_GPU_READBACK_PACK_WIDTH ? wordCount : GX_GPU_READBACK_PACK_WIDTH;
		const packedHeight = ((wordCount - 1) / packedWidth | 0) + 1;
		gx.readbackUniformScratch[0] = readback.x;
		gx.readbackUniformScratch[1] = readback.y;
		gx.readbackUniformScratch[2] = readback.width;
		gx.readbackUniformScratch[3] = packedWidth;
		gx.readbackUniformScratch[4] = readback.vramYAddressExtensionWord;
		gx.backend.device.queue.writeBuffer(gx.gpureadUniformBuffer, 0, gx.readbackUniformScratch);
		const pass = encoder.beginRenderPass(gx.gpureadPassDescriptor);
		pass.setViewport(0, 0, packedWidth, packedHeight, 0, 1);
		pass.setScissorRect(0, 0, packedWidth, packedHeight);
		pass.setPipeline(gx.gpureadPipeline);
		pass.setBindGroup(0, gx.gpureadBindGroup);
		pass.draw(3);
		pass.end();
		gx.gpureadDestination.bytesPerRow = (packedWidth * 4 + 255) & ~255;
		gx.gpureadDestination.rowsPerImage = packedHeight;
		gx.gpureadExtent.width = packedWidth;
		gx.gpureadExtent.height = packedHeight;
		encoder.copyTextureToBuffer(gx.gpureadSource, gx.gpureadDestination, gx.gpureadExtent);
		gx.gpureadMappedByteCount = wordCount * 4;
		gx.gpureadToken = readback.token;
		gx.gpureadPort = readback;
		readbackSubmitted = true;
	}
	gx.submitCommandBuffers[0] = encoder.finish();
	gx.backend.device.queue.submit(gx.submitCommandBuffers);
	gx.activeEncoder = undefined;
	if (gx.processedCommandCount < commandLimit) {
		gx.processedCommandCount = commandLimit;
	}
	if (readbackSubmitted) {
		gx.gpureadCompletion = gx.gpureadBuffer.mapAsync(GPUMapMode.READ, 0, gx.gpureadMappedByteCount).then(gx.gpureadCompletionCallback);
	}
}

function executeGxGpuVramCommands(gx: WebGpuGxGpuState, source: GxGpuVramSource, commandLimit: number, readbackClaimed: boolean): void {
	const commandBuffer = source.commandBuffer;
	const commandSerial = commandBuffer.serial;
	if (gx.vramSnapshotSerial !== source.vramSnapshotSerial) {
		uploadGxGpuVramSnapshot(gx, source.vramSnapshotBytes);
		gx.processedCommandCount = 0;
		gx.processedCommandSerial = commandSerial;
		gx.vramSnapshotSerial = source.vramSnapshotSerial;
	} else if (gx.processedCommandSerial !== commandSerial) {
		gx.processedCommandCount = 0;
		gx.processedCommandSerial = commandSerial;
	}
	executeNewGxGpuCommands(gx, commandBuffer, source.readbackPort, commandLimit, readbackClaimed);
}

export function serviceGxGpuReadback(gx: WebGpuGxGpuState, gxGpu: GxGpu, source: GxGpuVramSource): void {
	const readback = source.readbackPort;
	const commandLimit = readback.fenceCommandCount;
	if (gx.gpureadCompletion !== null) {
		readback.claimReadback(commandLimit);
		gx.gpureadDeferredGpu = gxGpu;
		gx.gpureadDeferredToken = readback.token;
		return;
	}
	executeGxGpuVramCommands(gx, source, commandLimit, false);
}

function submitDeferredGxGpuReadback(gx: WebGpuGxGpuState): void {
	const gxGpu = gx.gpureadDeferredGpu;
	if (gxGpu === null) {
		return;
	}
	const token = gx.gpureadDeferredToken;
	gx.gpureadDeferredGpu = null;
	const output = gxGpu.readDeviceOutput();
	const readback = output.readbackPort;
	if (readback.phase === GX_GPU_READBACK_SUBMITTED && readback.token === token) {
		executeGxGpuVramCommands(gx, output, readback.fenceCommandCount, true);
	}
}

function completeGxGpuReadback(gx: WebGpuGxGpuState): void {
	const readback = gx.gpureadPort!;
	if (readback.phase === GX_GPU_READBACK_SUBMITTED && readback.token === gx.gpureadToken) {
		readback.pixelBytes.set(new Uint8Array(gx.gpureadBuffer.getMappedRange(0, gx.gpureadMappedByteCount)));
		readback.completeReadback(gx.gpureadToken);
	}
	gx.gpureadBuffer.unmap();
	gx.gpureadPort = null;
	gx.gpureadCompletion = null;
	submitDeferredGxGpuReadback(gx);
}

function writeGxGpuScanoutCircuitUniforms(gx: WebGpuGxGpuState,
	circuit: GxGpuPcrtcCircuit,
	wordOffset: number,
): void {
	gx.scanoutUniformScratch[wordOffset] = circuit.framebufferBaseWord;
	gx.scanoutUniformScratch[wordOffset + 1] = circuit.framebufferWidth;
	gx.scanoutUniformScratch[wordOffset + 2] = circuit.framebufferPagesPerRow;
	gx.scanoutUniformScratch[wordOffset + 3] = circuit.framebufferX;
	gx.scanoutUniformScratch[wordOffset + 4] = circuit.framebufferY;
	gx.scanoutUniformScratch[wordOffset + 5] = circuit.displayX;
	gx.scanoutUniformScratch[wordOffset + 6] = circuit.displayY;
	gx.scanoutUniformScratch[wordOffset + 7] = circuit.fieldSourceDivisionMultiplierY;
	gx.scanoutUniformScratch[wordOffset + 8] = circuit.sourcePhaseX;
	gx.scanoutUniformScratch[wordOffset + 9] = circuit.fieldSourcePhase;
	gx.scanoutUniformScratch[wordOffset + 10] = circuit.sourceStepX;
	gx.scanoutUniformScratch[wordOffset + 11] = circuit.fieldSourceStride;
	gx.scanoutUniformScratch[wordOffset + 12] = circuit.sourceDivisionMultiplierX;
	gx.scanoutUniformScratch[wordOffset + 14] = circuit.fieldDisplayY;
	gx.scanoutUniformScratch[wordOffset + 15] = circuit.linearFieldSourceY;
	gx.scanoutUniformScratch[wordOffset + 16] = circuit.linearFieldSourceRowStep;
}

function writeGxGpuScanoutGlobalUniforms(gx: WebGpuGxGpuState, scanout: GxGpuPcrtcScanout, wordOffset: number): void {
	gx.scanoutUniformScratch[wordOffset + 13] = scanout.outputHeight;
	gx.scanoutUniformScratch[wordOffset + 20] = scanout.evenFieldHeight;
	gx.scanoutUniformScratch[wordOffset + 21] = scanout.oddFieldHeight;
	gx.scanoutUniformScratch[wordOffset + 22] = scanout.field;
	gx.scanoutUniformScratch[wordOffset + 23] = scanout.fieldOffset;
	gx.scanoutUniformScratch[wordOffset + 24] = scanout.backgroundColor & 0xff;
	gx.scanoutUniformScratch[wordOffset + 25] = scanout.backgroundColor >>> 8 & 0xff;
	gx.scanoutUniformScratch[wordOffset + 26] = scanout.backgroundColor >>> 16 & 0xff;
}

function writeGxGpuScanoutUniforms(gx: WebGpuGxGpuState, scanout: GxGpuPcrtcScanout, field: number): void {
	const circuit2WordOffset = GX_GPU_UNIFORM_SLOT_BYTES >> 2;
	const circuit1WordOffset = GX_GPU_UNIFORM_SLOT_BYTES >> 1;
	writeGxGpuScanoutGlobalUniforms(gx, scanout, 0);
	writeGxGpuScanoutCircuitUniforms(gx, scanout.circuits[0], 0);
	gx.scanoutUniformScratch.copyWithin(circuit2WordOffset, 0, GX_GPU_SCANOUT_UNIFORM_WORD_COUNT);
	gx.scanoutUniformScratch.copyWithin(circuit1WordOffset, 0, GX_GPU_SCANOUT_UNIFORM_WORD_COUNT);
	writeGxGpuScanoutCircuitUniforms(gx, scanout.circuits[1], circuit2WordOffset);
	gx.backend.device.queue.writeBuffer(gx.scanoutUniformBuffer, 0, gx.scanoutUniformScratch);
	gx.scanoutUniformPcrtcRevision = scanout.revision;
	gx.scanoutUniformField = field;
	gx.scanoutUniformValid = true;
}

function prepareGxGpuScanoutState(gx: WebGpuGxGpuState, scanout: GxGpuPcrtcScanout): void {
	const field = scanout.interlaced ? scanout.field : -1;
	if (!gx.scanoutUniformValid
		|| gx.scanoutUniformField !== field
		|| gx.scanoutUniformPcrtcRevision !== scanout.revision) {
		writeGxGpuScanoutUniforms(gx, scanout, field);
	}
	if (!gx.scanoutFixedStateValid
		|| gx.scanoutFixedStatePcrtcRevision !== scanout.revision) {
		gx.scanoutClearColor.r = (scanout.backgroundColor & 0xff) / 255;
		gx.scanoutClearColor.g = (scanout.backgroundColor >>> 8 & 0xff) / 255;
		gx.scanoutClearColor.b = (scanout.backgroundColor >>> 16 & 0xff) / 255;
		gx.scanoutBlendConstant.a = scanout.blendAlpha / 255;
		gx.scanoutFixedStatePcrtcRevision = scanout.revision;
		gx.scanoutFixedStateValid = true;
	}
}

function drawGxGpuScanoutPass(gx: WebGpuGxGpuState,
	pass: GPURenderPassEncoder,
	scanout: GxGpuPcrtcScanout,
	circuitIndex: number,
	drawPath: number,
	fieldProgram: boolean,
): void {
	const circuit = scanout.circuits[circuitIndex];
	const pipelineIndex = drawPath * GX_GPU_SCANOUT_PROGRAM_STORAGE_COUNT + circuit.samplePath;
	pass.setPipeline((fieldProgram ? gx.scanoutFieldPipelines : gx.scanoutPipelines)[pipelineIndex]!);
	if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB
		|| drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA) {
		pass.setBlendConstant(gx.scanoutBlendConstant);
	}
	pass.draw(3);
}

function drawGxGpuScanoutCircuit(gx: WebGpuGxGpuState,
	pass: GPURenderPassEncoder,
	scanout: GxGpuPcrtcScanout,
	circuitIndex: number,
	drawPath: number,
	fieldProgram: boolean,
	uniformSlot: number,
): void {
	if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_NONE) return;
	const circuit = scanout.circuits[circuitIndex];
	gx.dynamicUniformOffsets[0] = uniformSlot * GX_GPU_UNIFORM_SLOT_BYTES;
	pass.setBindGroup(0, gx.scanoutBindGroup, gx.dynamicUniformOffsets);
	if (fieldProgram) {
		pass.setScissorRect(
			circuit.displayX,
			scanout.fieldOffset + circuit.fieldDisplayLineStart,
			circuit.displayWidth,
			circuit.fieldDisplayLineCount,
		);
	} else {
		pass.setScissorRect(circuit.displayX, circuit.displayY, circuit.displayWidth, circuit.displayHeight);
	}
	if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGBA) {
		drawGxGpuScanoutPass(gx,
			pass, scanout, circuitIndex, GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB, fieldProgram,
		);
		drawGxGpuScanoutPass(gx,
			pass, scanout, circuitIndex, GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA, fieldProgram,
		);
		return;
	}
	drawGxGpuScanoutPass(gx, pass, scanout, circuitIndex, drawPath, fieldProgram);
}

function scanoutProgressiveGxGpuVram(gx: WebGpuGxGpuState,
	state: RenderPassStateRegistry['gx_gpu'],
	scanout: GxGpuPcrtcScanout,
): void {
	const target = state.targetColorTex as GPUTexture;
	const device = gx.backend.device;
	if (gx.scanoutTargetTexture !== target) {
		gx.scanoutTargetTexture = target;
		gx.scanoutTargetView = target.createView();
	}
	gx.scanoutColorAttachment.view = gx.scanoutTargetView;
	gx.scanoutColorAttachment.loadOp = scanout.backgroundRequired !== 0 ? 'clear' : 'load';
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginRenderPass(gx.scanoutPassDescriptor);
	drawGxGpuScanoutCircuit(gx, pass, scanout, 1, scanout.circuit2OutputPath, false, 1);
	drawGxGpuScanoutCircuit(gx, pass, scanout, 0, scanout.circuit1OutputPath, false, 2);
	pass.end();
	gx.submitCommandBuffers[0] = encoder.finish();
	device.queue.submit(gx.submitCommandBuffers);
}

function scanoutInterlacedGxGpuVram(gx: WebGpuGxGpuState,
	state: RenderPassStateRegistry['gx_gpu'],
	scanout: GxGpuPcrtcScanout,
	vramReplacementSerial: bigint,
): void {
	const target = state.targetColorTex as GPUTexture;
	const device = gx.backend.device;
	const width = state.width;
	const height = state.height;
	const sizeChanged = gx.scanoutFieldsWidth !== width || gx.scanoutFieldsHeight !== height;
	const invalid = !gx.scanoutFieldsValid
		|| sizeChanged
		|| gx.scanoutFieldsVramReplacementSerial !== vramReplacementSerial;
	if (sizeChanged) {
		if (gx.scanoutFieldsTexture) {
			gx.scanoutFieldsTexture.destroy();
		}
		const fieldsTexture = device.createTexture({
			size: { width, height, depthOrArrayLayers: 1 },
			format: 'bgra8unorm',
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
		});
		const fieldsView = fieldsTexture.createView();
		gx.scanoutFieldsTexture = fieldsTexture;
		if (gx.scanoutFieldsColorAttachment) {
			gx.scanoutFieldsColorAttachment.view = fieldsView;
		} else {
			const fieldsColorAttachment: GPURenderPassColorAttachment = {
				view: fieldsView,
				clearValue: gx.scanoutClearColor,
				loadOp: 'clear',
				storeOp: 'store',
			};
			gx.scanoutFieldsColorAttachment = fieldsColorAttachment;
			gx.scanoutFieldsPassDescriptor = { colorAttachments: [fieldsColorAttachment] };
		}
		gx.scanoutFieldsBindGroup = createBindGroup(
			device,
			gx.scanoutBindGroupLayout,
			gx.scanoutUniformBuffer,
			GX_GPU_SCANOUT_UNIFORM_BYTES,
			fieldsView,
			gx.sampler,
		);
		gx.scanoutFieldsWidth = width;
		gx.scanoutFieldsHeight = height;
	}
	if (gx.scanoutTargetTexture !== target) {
		gx.scanoutTargetTexture = target;
		gx.scanoutTargetView = target.createView();
	}

	const encoder = device.createCommandEncoder();
	gx.scanoutFieldsColorAttachment!.loadOp = invalid ? 'clear' : 'load';
	const fieldPass = encoder.beginRenderPass(gx.scanoutFieldsPassDescriptor!);
	fieldPass.setViewport(0, scanout.fieldOffset, width, scanout.fieldHeight, 0, 1);
	if (scanout.backgroundRequired !== 0 && !invalid) {
		fieldPass.setPipeline(gx.scanoutBackgroundPipeline);
		gx.dynamicUniformOffsets[0] = 0;
		fieldPass.setBindGroup(0, gx.scanoutBindGroup, gx.dynamicUniformOffsets);
		fieldPass.setScissorRect(0, scanout.fieldOffset, width, scanout.fieldHeight);
		fieldPass.draw(3);
	}
	drawGxGpuScanoutCircuit(gx, fieldPass, scanout, 1, scanout.circuit2OutputPath, true, 1);
	drawGxGpuScanoutCircuit(gx, fieldPass, scanout, 0, scanout.circuit1OutputPath, true, 2);
	fieldPass.end();
	gx.scanoutFieldsValid = true;
	gx.scanoutFieldsVramReplacementSerial = vramReplacementSerial;

	gx.scanoutColorAttachment.view = gx.scanoutTargetView;
	gx.scanoutColorAttachment.loadOp = 'load';
	const weavePass = encoder.beginRenderPass(gx.scanoutPassDescriptor);
	weavePass.setPipeline(gx.scanoutWeavePipeline);
	gx.dynamicUniformOffsets[0] = 0;
	weavePass.setBindGroup(0, gx.scanoutFieldsBindGroup!, gx.dynamicUniformOffsets);
	weavePass.draw(3);
	weavePass.end();
	gx.submitCommandBuffers[0] = encoder.finish();
	device.queue.submit(gx.submitCommandBuffers);
}

function scanoutGxGpuVram(gx: WebGpuGxGpuState,
	state: RenderPassStateRegistry['gx_gpu'],
	output: GxGpuDeviceOutput,
): void {
	const scanout = output.pcrtcScanout;
	prepareGxGpuScanoutState(gx, scanout);
	if (scanout.interlaced) {
		scanoutInterlacedGxGpuVram(gx, state, scanout, output.vramReplacementSerial);
		return;
	}
	gx.scanoutFieldsValid = false;
	scanoutProgressiveGxGpuVram(gx, state, scanout);
}

function renderGxGpuPass(gx: WebGpuGxGpuState,
	state: RenderPassStateRegistry['gx_gpu'],
	output: GxGpuDeviceOutput,
): void {
	executeGxGpuVramCommands(gx, output, output.commandBuffer.presentCommandCount, false);
	scanoutGxGpuVram(gx, state, output);
}

function writeGxGpuState(ctx: RenderGraphPassContext, state: RenderPassStateRegistry['gx_gpu']): void {
	state.width = ctx.presenter.offscreenCanvasSize.x;
	state.height = ctx.presenter.offscreenCanvasSize.y;
	state.targetColorTex = ctx.getTex('frame_color');
}

export function registerGxGpuPass(registry: RenderPassLibrary): void {
	const gxGpuPipelineState: RenderPassStateRegistry['gx_gpu'] = {
		width: 0,
		height: 0,
	};
	registry.register({
		id: 'gx_gpu',
		name: 'GXGPU (WebGPU)',
		stateOnly: true,
		initialState: gxGpuPipelineState,
		graph: { writes: ['frame_color'], writeState: writeGxGpuState },
		bootstrap: (backend) => bootstrapGxGpuPass(backend as WebGPUBackend),
		exec: (backend: WebGPUBackend, _fbo, state: RenderPassStateRegistry['gx_gpu'], _pipelineHandle, output) =>
			renderGxGpuPass(backend.gxGpuState, state, output),
	});
}

export async function captureRenderedVramSnapshot(gx: WebGpuGxGpuState, gxGpu: GxGpu, output: GxGpuVramSource): Promise<void> {
	executeGxGpuVramCommands(gx, output, output.commandBuffer.executedCommandCount, false);
	if (gx.gpureadCompletion !== null) {
		await gx.gpureadCompletion;
	}
	const device = gx.backend.device;
	const encoder = device.createCommandEncoder();
	encoder.copyTextureToBuffer(gx.vramReadbackSource, gx.vramReadbackDestination, gx.vramReadbackExtent);
	gx.submitCommandBuffers[0] = encoder.finish();
	device.queue.submit(gx.submitCommandBuffers);
	await gx.vramReadbackBuffer.mapAsync(GPUMapMode.READ);
	const readback = new Uint8Array(gx.vramReadbackBuffer.getMappedRange());
	const snapshot = gx.vramSnapshotScratch;
	let snapshotByteOffset = 0;
	let readbackByteOffset = 0;
	for (let pixel = 0; pixel < GX_GPU_VRAM_X_ADDRESS_PERIOD * gx.vramTextureRows; pixel += 1) {
		snapshot[snapshotByteOffset] = readback[readbackByteOffset];
		snapshot[snapshotByteOffset + 1] = readback[readbackByteOffset + 1];
		snapshotByteOffset += 2;
		readbackByteOffset += GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
	}
	gx.vramReadbackBuffer.unmap();
	gx.vramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(snapshot, gx.processedCommandCount);
}
