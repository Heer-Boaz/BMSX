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

const gxGpuSolidVertices = new Float32Array(GX_GPU_SOLID_FLOAT_CAPACITY);
const gxGpuSolidVertexWords = new Uint32Array(gxGpuSolidVertices.buffer);
const gxGpuLineVertices = new Float32Array(GX_GPU_LINE_FLOAT_CAPACITY);
const gxGpuTexturedVertices = new Float32Array(GX_GPU_TEXTURED_FLOAT_CAPACITY);
const gxGpuTexturedVertexWords = new Uint32Array(gxGpuTexturedVertices.buffer);
const gxGpuTexturedVertexHalfWords = new Uint16Array(gxGpuTexturedVertices.buffer);
const gxGpuTexturedUvPlane = new Uint32Array(GX_GPU_TEXTURED_UV_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
const gxGpuColorPlane = new Uint32Array(GX_GPU_COLOR_COMPONENTS * GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES);
const gxGpuTexturedTextureSource = new Uint16Array(4);
const gxGpuTransferVertices = new Float32Array(GX_GPU_TRANSFER_FLOAT_CAPACITY);
const primitiveUniformScratch = new Uint32Array(8);
const primitiveUniformFloatScratch = new Float32Array(primitiveUniformScratch.buffer);
const texturedUniformScratch = new Uint32Array(16);
const texturedUniformFloatScratch = new Float32Array(texturedUniformScratch.buffer);
const transferUniformScratch = new Uint32Array(8);
const scanoutUniformScratch = new Uint32Array(GX_GPU_SCANOUT_UNIFORM_BUFFER_BYTES >> 2);
const readbackUniformScratch = new Uint32Array(GX_GPU_READBACK_UNIFORM_BYTES >> 2);
const gxGpuDynamicUniformOffsets = new Uint32Array(1);
const gxGpuScanoutClearColor: GPUColorDict = { r: 0, g: 0, b: 0, a: 0 };
const gxGpuScanoutBlendConstant: GPUColorDict = { r: 0, g: 0, b: 0, a: 0 };
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

type WebGpuGxGpuState = {
	backend: WebGPUBackend;
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

const gxGpuVramCopyRectScratch: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuSolidBatchRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuSolidCommandRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuTexturedCommandRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuTexturedDependencyBatchRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuTexturedBatchRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuLineBatchRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuLineCommandRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuSampleDirtyRect: GxGpuVramCopyRect = { left: 0, top: 0, right: 0, bottom: 0 };
const gxGpuRectangleScratch: GxGpuRectangle = { x0: 0, y0: 0, x1: 0, y1: 0, width: 0, height: 0 };
const gxGpuSolidBatchState: GxGpuSolidBatchState = {
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
};
const gxGpuLineBatchState: GxGpuLineBatchState = {
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
};

let gxGpuState: WebGpuGxGpuState;

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
	const solidVertexBuffer = device.createBuffer({ size: gxGpuSolidVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const lineVertexBuffer = device.createBuffer({ size: gxGpuLineVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const texturedVertexBuffer = device.createBuffer({ size: gxGpuTexturedVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const transferVertexBuffer = device.createBuffer({ size: gxGpuTransferVertices.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
	const vramAliasBandCount = GX_GPU_VRAM_Y_ADDRESS_PERIOD / vramTextureRows;
	const primitiveUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_BUFFER_BYTES * vramAliasBandCount, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const texturedUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_BUFFER_BYTES * vramAliasBandCount, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const transferUniformBuffer = device.createBuffer({ size: GX_GPU_UNIFORM_BUFFER_BYTES * vramAliasBandCount, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const scanoutUniformBuffer = device.createBuffer({ size: GX_GPU_SCANOUT_UNIFORM_BUFFER_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const gpureadUniformBuffer = device.createBuffer({ size: GX_GPU_READBACK_UNIFORM_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
	const vramReadbackBuffer = device.createBuffer({ size: vramRawByteCount, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const gpureadBuffer = device.createBuffer({ size: GX_GPU_TRANSFER_MAX_BYTE_COUNT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
	const vramDrawColorAttachment: GPURenderPassColorAttachment = { view: vramView, loadOp: 'load', storeOp: 'store' };
	const scanoutColorAttachment: GPURenderPassColorAttachment = { view: vramView, clearValue: gxGpuScanoutClearColor, loadOp: 'load', storeOp: 'store' };
	const gpureadColorAttachment: GPURenderPassColorAttachment = { view: gpureadView, loadOp: 'load', storeOp: 'store' };
	const vramCopySourceOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	const vramCopyDestinationOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	const vramUploadDestinationOrigin: GPUOrigin3DDict = { x: 0, y: 0, z: 0 };
	gxGpuState = {
		backend,
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
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	if (width === 0 || height === 0) return vertexFloatCount;
	let y = gxGpuTransferY(xyWord, vramYAddressExtensionWord);
	let remainingHeight = height;
	let offset = vertexFloatCount;
	while (remainingHeight !== 0) {
		const rowHeight = gxGpuVramWrappedHeight(y, remainingHeight, vramYAddressExtensionWord, gxGpuState.backend.gxGpuVramTextureRowMask);
		let x = gxGpuFillX(xyWord);
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(x, remainingWidth);
			offset = appendSolidQuad(offset, x, y, colorWord, x, y + rowHeight, colorWord, x + runWidth, y, colorWord, x + runWidth, y + rowHeight, colorWord);
			x = (x + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
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
	if (gxGpuCommandTextureEnabled(opcode)) return vertexFloatCount;
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

function writeTexturedTextureSource(floatOffset: number): void {
	const halfWordOffset = floatOffset << 1;
	gxGpuTexturedVertexHalfWords[halfWordOffset] = gxGpuTexturedTextureSource[0];
	gxGpuTexturedVertexHalfWords[halfWordOffset + 1] = gxGpuTexturedTextureSource[1];
	gxGpuTexturedVertexHalfWords[halfWordOffset + 2] = gxGpuTexturedTextureSource[2];
	gxGpuTexturedVertexHalfWords[halfWordOffset + 3] = gxGpuTexturedTextureSource[3];
}

function writeTexturedVertex(offset: number, x: number, y: number, colorWord: number): number {
	gxGpuTexturedVertices[offset] = x;
	gxGpuTexturedVertices[offset + 1] = y;
	gxGpuTexturedVertices[offset + 2] = (colorWord & 0xff) / 255;
	gxGpuTexturedVertices[offset + 3] = ((colorWord >>> 8) & 0xff) / 255;
	gxGpuTexturedVertices[offset + 4] = ((colorWord >>> 16) & 0xff) / 255;
	writeTexturedTextureSource(offset + GX_GPU_TEXTURED_TEXTURE_SOURCE_FLOAT_OFFSET);
	return offset + GX_GPU_TEXTURED_VERTEX_FLOATS;
}

function prepareTexturedUvPlane(determinant: number, x0: number, y0: number, u0: number, v0: number, x1: number, y1: number, u1: number, v1: number, x2: number, y2: number, u2: number, v2: number): void {
	gxGpuTexturedUvPlane[0] = u0;
	gxGpuTexturedUvPlane[1] = v0;
	gxGpuTexturedUvPlane[2] = u1;
	gxGpuTexturedUvPlane[3] = v1;
	gxGpuTexturedUvPlane[4] = u2;
	gxGpuTexturedUvPlane[5] = v2;
	gxGpuTriangleAttributePlane(gxGpuTexturedUvPlane, 0, GX_GPU_TEXTURED_UV_COMPONENTS, determinant, x0, y0, x1, y1, x2, y2);
}

function appendTexturedTriangle(vertexFloatCount: number, determinant: number, x0: number, y0: number, color0: number, u0: number, v0: number, x1: number, y1: number, color1: number, u1: number, v1: number, x2: number, y2: number, color2: number, u2: number, v2: number): number {
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
	writeTexturedTextureSource(offset + GX_GPU_FIXED_TEXTURED_TEXTURE_SOURCE_FLOAT_OFFSET);
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
	const determinant = rect.width * rect.height;
	let offset = vertexFloatCount;
	offset = appendTexturedTriangle(offset, determinant, rect.x0, rect.y0, colorWord, u0, v0, rect.x1, rect.y0, colorWord, u1, v0, rect.x0, rect.y1, colorWord, u0, v1);
	offset = appendTexturedTriangle(offset, determinant, rect.x0, rect.y1, colorWord, u0, v1, rect.x1, rect.y0, colorWord, u1, v0, rect.x1, rect.y1, colorWord, u1, v1);
	return offset;
}

function appendTransferTriangle(vertexFloatCount: number, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, sourceOffsetX: number, sourceOffsetY: number): number {
	let offset = vertexFloatCount;
	offset = writeTransferVertex(gxGpuTransferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x0, y0, sourceOffsetX, sourceOffsetY);
	offset = writeTransferVertex(gxGpuTransferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x1, y1, sourceOffsetX, sourceOffsetY);
	offset = writeTransferVertex(gxGpuTransferVertices, offset, GX_GPU_TRANSFER_VERTEX_FLOATS, x2, y2, sourceOffsetX, sourceOffsetY);
	return offset;
}

function writeTransferVertex(vertices: Float32Array, offset: number, vertexFloatStride: number, x: number, y: number, sourceOffsetX: number, sourceOffsetY: number): number {
	vertices[offset] = x;
	vertices[offset + 1] = y;
	vertices[offset + 2] = sourceOffsetX;
	vertices[offset + 3] = sourceOffsetY;
	return offset + vertexFloatStride;
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
	const upload = gxGpuState.vramSnapshotUpload;
	let uploadOffset = 0;
	let snapshotOffset = 0;
	for (let pixel = 0; pixel < GX_GPU_VRAM_X_ADDRESS_PERIOD * gxGpuState.vramTextureRows; pixel += 1) {
		upload[uploadOffset] = snapshotBytes[snapshotOffset];
		upload[uploadOffset + 1] = snapshotBytes[snapshotOffset + 1];
		upload[uploadOffset + 2] = 0;
		upload[uploadOffset + 3] = 0xff;
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
	gxGpuState.vramUploadLayout.rowsPerImage = gxGpuState.vramTextureRows;
	gxGpuState.vramUploadExtent.width = GX_GPU_VRAM_X_ADDRESS_PERIOD;
	gxGpuState.vramUploadExtent.height = gxGpuState.vramTextureRows;
	gxGpuState.backend.device.queue.writeTexture(gxGpuState.vramUploadDestination, gxGpuState.vramSnapshotUpload, gxGpuState.vramUploadLayout, gxGpuState.vramUploadExtent);
	gxGpuState.backend.accountUpload('texture', gxGpuState.vramSnapshotUpload.byteLength);
	gxGpuSampleDirtyRect.left = 0;
	gxGpuSampleDirtyRect.top = 0;
	gxGpuSampleDirtyRect.right = GX_GPU_VRAM_X_ADDRESS_PERIOD;
	gxGpuSampleDirtyRect.bottom = gxGpuState.vramTextureRows;
}

function uploadCpuToVramPayload(commandBuffer: GxGpuCommandBufferView, payloadWordStart: number, pixelCount: number): void {
	const device = gxGpuState.backend.device;
	const fullRows = pixelCount >>> 10;
	const lastRowWidth = pixelCount & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
	let sourceByteOffset = payloadWordStart * 4;
	gxGpuState.vramUploadDestination.texture = gxGpuState.cpuUploadTexture;
	gxGpuState.vramUploadDestinationOrigin.x = 0;
	gxGpuState.vramUploadDestinationOrigin.y = 0;
	gxGpuState.vramUploadLayout.bytesPerRow = GX_GPU_CPU_UPLOAD_ROW_BYTES;
	if (fullRows !== 0) {
		gxGpuState.vramUploadLayout.offset = sourceByteOffset;
		gxGpuState.vramUploadLayout.rowsPerImage = fullRows;
		gxGpuState.vramUploadExtent.width = GX_GPU_VRAM_X_ADDRESS_PERIOD;
		gxGpuState.vramUploadExtent.height = fullRows;
		device.queue.writeTexture(gxGpuState.vramUploadDestination, commandBuffer.wordBytes, gxGpuState.vramUploadLayout, gxGpuState.vramUploadExtent);
		sourceByteOffset += fullRows * GX_GPU_CPU_UPLOAD_ROW_BYTES;
	}
	if (lastRowWidth !== 0) {
		gxGpuState.vramUploadDestinationOrigin.y = fullRows;
		gxGpuState.vramUploadLayout.offset = sourceByteOffset;
		gxGpuState.vramUploadLayout.rowsPerImage = 1;
		gxGpuState.vramUploadExtent.width = lastRowWidth;
		gxGpuState.vramUploadExtent.height = 1;
		device.queue.writeTexture(gxGpuState.vramUploadDestination, commandBuffer.wordBytes, gxGpuState.vramUploadLayout, gxGpuState.vramUploadExtent);
	}
	gxGpuState.backend.accountUpload('texture', pixelCount * GX_GPU_CPU_UPLOAD_BYTES_PER_PIXEL);
}

function markGxGpuSampleTextureDirtyArea(left: number, top: number, right: number, bottom: number): void {
	if (right <= left || bottom <= top) return;
	if (left < gxGpuSampleDirtyRect.left) gxGpuSampleDirtyRect.left = left;
	if (top < gxGpuSampleDirtyRect.top) gxGpuSampleDirtyRect.top = top;
	if (right > gxGpuSampleDirtyRect.right) gxGpuSampleDirtyRect.right = right;
	if (bottom > gxGpuSampleDirtyRect.bottom) gxGpuSampleDirtyRect.bottom = bottom;
}

function markGxGpuSampleTextureDirtyLogicalArea(x: number, y: number, width: number, height: number, vramYAddressExtensionWord: number): void {
	let rowY = gxGpuVramYAddress(y, vramYAddressExtensionWord);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight, vramYAddressExtensionWord, gxGpuState.backend.gxGpuVramTextureRowMask);
		const physicalY = rowY & gxGpuState.backend.gxGpuVramTextureRowMask;
		let columnX = x & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			markGxGpuSampleTextureDirtyArea(columnX, physicalY, columnX + runWidth, physicalY + runHeight);
			columnX = (columnX + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
			remainingWidth -= runWidth;
		}
		rowY = gxGpuVramYAddress(rowY + runHeight, vramYAddressExtensionWord);
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

function syncGxGpuSampleTextureLogicalArea(x: number, y: number, width: number, height: number, vramYAddressExtensionWord: number): void {
	let rowY = gxGpuVramYAddress(y, vramYAddressExtensionWord);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const runHeight = gxGpuVramWrappedHeight(rowY, remainingHeight, vramYAddressExtensionWord, gxGpuState.backend.gxGpuVramTextureRowMask);
		const physicalY = rowY & gxGpuState.backend.gxGpuVramTextureRowMask;
		let columnX = x & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(columnX, remainingWidth);
			if (syncGxGpuSampleTextureArea(columnX, physicalY, columnX + runWidth, physicalY + runHeight)) return;
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

function gxGpuVramCopyRectsOverlap(a: GxGpuVramCopyRect, b: GxGpuVramCopyRect, vramYAddressExtensionWord: number): boolean {
	if (a.right <= a.left || a.bottom <= a.top) return false;
	return gxGpuVramLogicalAreaOverlapsBounds(a.left, a.top, a.right - a.left, a.bottom - a.top, b.left, b.top, b.right, b.bottom, vramYAddressExtensionWord, gxGpuState.backend.gxGpuVramTextureRowMask);
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
	if (gxGpuVramLogicalAreaOverlapsBounds(sourceX, sourceY, sourceWidth, sourceHeight, commandRect.left, commandRect.top, commandRect.right, commandRect.bottom, vramYAddressExtensionWord, gxGpuState.backend.gxGpuVramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP;
	if (gxGpuVramLogicalAreaOverlapsBounds(sourceX, sourceY, sourceWidth, sourceHeight, batchRect.left, batchRect.top, batchRect.right, batchRect.bottom, vramYAddressExtensionWord, gxGpuState.backend.gxGpuVramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP;
	syncGxGpuSampleTextureLogicalArea(sourceX, sourceY, sourceWidth, sourceHeight, vramYAddressExtensionWord);
	if (textureMode < 2) {
		const clutX = gxGpuTextureClutBaseX(textureWord);
		const clutY = gxGpuTextureClutBaseY(textureWord, vramYAddressExtensionWord);
		const clutWidth = textureMode === 0 ? GX_GPU_CLUT_4BIT_WORDS : GX_GPU_CLUT_8BIT_WORDS;
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1, commandRect.left, commandRect.top, commandRect.right, commandRect.bottom, vramYAddressExtensionWord, gxGpuState.backend.gxGpuVramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_COMMAND_OVERLAP;
		if (gxGpuVramLogicalAreaOverlapsBounds(clutX, clutY, clutWidth, 1, batchRect.left, batchRect.top, batchRect.right, batchRect.bottom, vramYAddressExtensionWord, gxGpuState.backend.gxGpuVramTextureRowMask)) overlaps |= GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP;
		syncGxGpuSampleTextureLogicalArea(clutX, clutY, clutWidth, 1, vramYAddressExtensionWord);
	}
	return overlaps;
}

function writePrimitiveUniforms(blendEnabled: boolean, blendMode: number, maskBitModeWord: number, ditherEnabled: boolean, skippedLineParity: number, rasterKind: GxGpuRasterKind): void {
	primitiveUniformScratch[0] = blendEnabled ? 1 : 0;
	primitiveUniformScratch[1] = blendMode;
	primitiveUniformScratch[2] = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0;
	primitiveUniformScratch[3] = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0;
	primitiveUniformScratch[4] = ditherEnabled ? 1 : 0;
	primitiveUniformScratch[5] = skippedLineParity;
	primitiveUniformFloatScratch[6] = rasterKind === GxGpuRasterKind.Polygon ? 0.5 : 0;
	primitiveUniformScratch[7] = 0;
}

function drawVramVertices(
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
	const encoder = gxGpuState.activeEncoder!;
	const vertexCount = vertexFloatCount / vertexFloatStride;
	if (gxGpuState.vramTextureRows === GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		gxGpuDynamicUniformOffsets[0] = uniformByteOffset;
		const pass = encoder.beginRenderPass(gxGpuState.vramDrawPassDescriptor);
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup, gxGpuDynamicUniformOffsets);
		pass.setVertexBuffer(0, vertexBuffer, vertexByteOffset, vertexFloatCount * 4);
		pass.setScissorRect(left, top, right - left, bottom - top);
		pass.draw(vertexCount);
		pass.end();
		markGxGpuSampleTextureDirtyLogicalArea(left, top, right - left, bottom - top, vramYAddressExtensionWord);
		return;
	}
	for (let firstVertex = 0; firstVertex < vertexCount; firstVertex += primitiveVertexCount) {
		let logicalYBase = top & ~gxGpuState.backend.gxGpuVramTextureRowMask;
		while (logicalYBase < bottom) {
			const logicalTop = top > logicalYBase ? top : logicalYBase;
			const logicalBottomEdge = logicalYBase + gxGpuState.vramTextureRows;
			const logicalBottom = bottom < logicalBottomEdge ? bottom : logicalBottomEdge;
			const physicalTop = logicalTop - logicalYBase;
			const physicalBottom = logicalBottom - logicalYBase;
			if (syncSampleBetweenAliasBands) {
				syncGxGpuSampleTextureArea(left, physicalTop, right, physicalBottom);
			}
			gxGpuDynamicUniformOffsets[0] = uniformByteOffset
				+ (logicalYBase / gxGpuState.vramTextureRows) * GX_GPU_UNIFORM_SLOT_BYTES;
			const pass = encoder.beginRenderPass(gxGpuState.vramDrawPassDescriptor);
			pass.setViewport(0, -logicalYBase, GX_GPU_VRAM_X_ADDRESS_PERIOD, GX_GPU_VRAM_Y_ADDRESS_PERIOD, 0, 1);
			pass.setPipeline(pipeline);
			pass.setBindGroup(0, bindGroup, gxGpuDynamicUniformOffsets);
			pass.setVertexBuffer(0, vertexBuffer, vertexByteOffset, vertexFloatCount * 4);
			pass.setScissorRect(left, physicalTop, right - left, logicalBottom - logicalTop);
			pass.draw(primitiveVertexCount, 1, firstVertex, 0);
			pass.end();
			markGxGpuSampleTextureDirtyArea(left, physicalTop, right, physicalBottom);
			logicalYBase += gxGpuState.vramTextureRows;
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
	primitiveVertexCount: number,
	vertexByteOffset: number,
	uniformByteOffset: number,
	drawBounds: GxGpuVramCopyRect,
	syncSampleBetweenAliasBands: boolean,
	vramYAddressExtensionWord: number,
): void {
	const backend = gxGpuState.backend;
	backend.device.queue.writeBuffer(vertexBuffer, vertexByteOffset, vertices.buffer, vertices.byteOffset, vertexFloatCount * 4);
	drawVramVertices(
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

function flushSolidCommands(vertexFloatCount: number): number {
	if (vertexFloatCount !== 0) {
		const fixedColor = gxGpuSolidBatchState.fixedColor;
		const vertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
		const pipeline = fixedColor ? gxGpuState.fixedSolidPipeline : gxGpuState.solidPipeline;
		const drawWidth = gxGpuSolidBatchRect.right - gxGpuSolidBatchRect.left;
		const drawHeight = gxGpuSolidBatchRect.bottom - gxGpuSolidBatchRect.top;
		if (gxGpuSolidBatchState.readsVram) syncGxGpuSampleTextureLogicalArea(gxGpuSolidBatchRect.left, gxGpuSolidBatchRect.top, drawWidth, drawHeight, gxGpuSolidBatchState.vramYAddressExtensionWord);
		writePrimitiveUniforms(gxGpuSolidBatchState.blendEnabled, gxGpuSolidBatchState.blendMode, gxGpuSolidBatchState.maskBitModeWord, gxGpuSolidBatchState.ditherEnabled, gxGpuSolidBatchState.skippedLineParity, gxGpuSolidBatchState.rasterKind);
		const uniformByteOffset = gxGpuState.primitiveUniformByteOffset;
		const vertexByteOffset = gxGpuState.solidVertexByteOffset;
		gxGpuState.backend.device.queue.writeBuffer(gxGpuState.primitiveUniformBuffer, uniformByteOffset, primitiveUniformScratch);
		gxGpuState.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
		if (gxGpuState.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
			for (let logicalYBase = gxGpuState.vramTextureRows;
				logicalYBase < GX_GPU_VRAM_Y_ADDRESS_PERIOD;
				logicalYBase += gxGpuState.vramTextureRows) {
				primitiveUniformScratch[7] = logicalYBase;
				gxGpuState.backend.device.queue.writeBuffer(
					gxGpuState.primitiveUniformBuffer,
					gxGpuState.primitiveUniformByteOffset,
					primitiveUniformScratch,
				);
				gxGpuState.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
			}
		}
		gxGpuState.solidVertexByteOffset += vertexFloatCount * 4;
		renderVramVertices(
			pipeline,
			gxGpuState.solidBindGroup,
			gxGpuState.solidVertexBuffer,
			gxGpuSolidVertices,
			vertexFloatCount,
			vertexFloatStride,
			gxGpuSolidBatchState.rasterKind === GxGpuRasterKind.Polygon ? 3 : 6,
			vertexByteOffset,
			uniformByteOffset,
			gxGpuSolidBatchRect,
			gxGpuSolidBatchState.readsVram,
			gxGpuSolidBatchState.vramYAddressExtensionWord,
		);
	}
	resetGxGpuVramCopyRect(gxGpuSolidBatchRect);
	return 0;
}

function renderReadVramSolidQuad(topLeftWord: number, bottomRightWord: number, vramYAddressExtensionWord: number, blendEnabled: boolean, blendMode: number, maskBitModeWord: number, ditherEnabled: boolean, skippedLineParity: number): void {
	const fixedColor = gxGpuSolidBatchState.fixedColor;
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
	const triangleFloatCount = fixedColor ? GX_GPU_FIXED_SOLID_TRIANGLE_FLOATS : GX_GPU_SOLID_TRIANGLE_FLOATS;
	const pipeline = fixedColor ? gxGpuState.fixedSolidPipeline : gxGpuState.solidPipeline;
	setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, gxGpuSolidVertices, 0, triangleFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	let drawLeft = gxGpuVramCopyRectScratch.left;
	let drawTop = gxGpuVramCopyRectScratch.top;
	let drawWidth = gxGpuVramCopyRectScratch.right - drawLeft;
	let drawHeight = gxGpuVramCopyRectScratch.bottom - drawTop;
	syncGxGpuSampleTextureLogicalArea(drawLeft, drawTop, drawWidth, drawHeight, vramYAddressExtensionWord);
	writePrimitiveUniforms(blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity, GxGpuRasterKind.Polygon);
	const uniformByteOffset = gxGpuState.primitiveUniformByteOffset;
	const vertexByteOffset = gxGpuState.solidVertexByteOffset;
	const vertexFloatCount = triangleFloatCount * 2;
	gxGpuState.backend.device.queue.writeBuffer(gxGpuState.primitiveUniformBuffer, uniformByteOffset, primitiveUniformScratch);
	gxGpuState.backend.device.queue.writeBuffer(gxGpuState.solidVertexBuffer, vertexByteOffset, gxGpuSolidVertices.buffer, gxGpuSolidVertices.byteOffset, vertexFloatCount * 4);
	gxGpuState.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
	if (gxGpuState.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		for (let logicalYBase = gxGpuState.vramTextureRows;
			logicalYBase < GX_GPU_VRAM_Y_ADDRESS_PERIOD;
			logicalYBase += gxGpuState.vramTextureRows) {
			primitiveUniformScratch[7] = logicalYBase;
			gxGpuState.backend.device.queue.writeBuffer(
				gxGpuState.primitiveUniformBuffer,
				gxGpuState.primitiveUniformByteOffset,
				primitiveUniformScratch,
			);
			gxGpuState.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
		}
	}
	gxGpuState.solidVertexByteOffset += vertexFloatCount * 4;
	gxGpuState.backend.accountUpload('vertex', vertexFloatCount * 4);
	drawVramVertices(
		pipeline,
		gxGpuState.solidBindGroup,
		gxGpuState.solidVertexBuffer,
		triangleFloatCount,
		vertexFloatStride,
		3,
		vertexByteOffset,
		uniformByteOffset,
		gxGpuVramCopyRectScratch,
		true,
		vramYAddressExtensionWord,
	);
	setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, gxGpuSolidVertices, triangleFloatCount, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
	drawLeft = gxGpuVramCopyRectScratch.left;
	drawTop = gxGpuVramCopyRectScratch.top;
	drawWidth = gxGpuVramCopyRectScratch.right - drawLeft;
	drawHeight = gxGpuVramCopyRectScratch.bottom - drawTop;
	syncGxGpuSampleTextureLogicalArea(drawLeft, drawTop, drawWidth, drawHeight, vramYAddressExtensionWord);
	drawVramVertices(
		pipeline,
		gxGpuState.solidBindGroup,
		gxGpuState.solidVertexBuffer,
		triangleFloatCount,
		vertexFloatStride,
		3,
		vertexByteOffset + triangleFloatCount * 4,
		uniformByteOffset,
		gxGpuVramCopyRectScratch,
		true,
		vramYAddressExtensionWord,
	);
}

function renderLineVertices(
	vertexFloatCount: number,
	uniformByteOffset: number,
	drawBounds: GxGpuVramCopyRect,
	syncSampleBetweenAliasBands: boolean,
	vramYAddressExtensionWord: number,
): void {
	if (vertexFloatCount === 0) return;
	const vertexByteOffset = gxGpuState.lineVertexByteOffset;
	gxGpuState.lineVertexByteOffset += vertexFloatCount * 4;
	renderVramVertices(
		gxGpuState.linePipeline,
		gxGpuState.lineBindGroup,
		gxGpuState.lineVertexBuffer,
		gxGpuLineVertices,
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

function writeTexturedUniforms(commandBuffer: GxGpuCommandBufferView, commandIndex: number): void {
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const textureWindowWord = commandBuffer.commandTextureWindowWord[commandIndex];
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	texturedUniformScratch[0] = gxGpuTextureWindowAndX(textureWindowWord);
	texturedUniformScratch[1] = gxGpuTextureWindowAndY(textureWindowWord);
	texturedUniformScratch[2] = gxGpuTextureWindowOrX(textureWindowWord);
	texturedUniformScratch[3] = gxGpuTextureWindowOrY(textureWindowWord);
	texturedUniformScratch[4] = gxGpuDrawModeTextureMode(drawModeWord);
	texturedUniformScratch[5] = gxGpuCommandRawTextureEnabled(opcode) ? 1 : 0;
	texturedUniformScratch[6] = gxGpuCommandSemiTransparencyEnabled(opcode) ? 1 : 0;
	texturedUniformScratch[7] = gxGpuDrawModeTransparencyMode(drawModeWord);
	texturedUniformScratch[8] = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0;
	texturedUniformScratch[9] = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0;
	texturedUniformScratch[10] = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON && gxGpuDitheredPolygon(drawModeWord, opcode) ? 1 : 0;
	texturedUniformScratch[11] = commandBuffer.commandSkippedLineParity[commandIndex];
	texturedUniformFloatScratch[12] = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON ? 0.5 : 0;
	texturedUniformScratch[13] = 0;
}

function appendTexturedCommandVertices(commandBuffer: GxGpuCommandBufferView, commandIndex: number, vertexFloatCount: number): number {
	const drawModeWord = commandBuffer.commandDrawModeWord[commandIndex];
	const textureWord = commandBuffer.words[commandBuffer.commandWordStart[commandIndex] + 2];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	gxGpuTexturedTextureSource[0] = gxGpuDrawModeTexturePageBaseX(drawModeWord);
	gxGpuTexturedTextureSource[1] = gxGpuDrawModeTexturePageBaseY(drawModeWord, vramYAddressExtensionWord);
	gxGpuTexturedTextureSource[2] = gxGpuTextureClutBaseX(textureWord);
	gxGpuTexturedTextureSource[3] = gxGpuTextureClutBaseY(textureWord, vramYAddressExtensionWord);
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
	if (gxGpuState.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		for (let logicalYBase = gxGpuState.vramTextureRows;
			logicalYBase < GX_GPU_VRAM_Y_ADDRESS_PERIOD;
			logicalYBase += gxGpuState.vramTextureRows) {
			texturedUniformScratch[13] = logicalYBase;
			gxGpuState.backend.device.queue.writeBuffer(
				gxGpuState.texturedUniformBuffer,
				gxGpuState.texturedUniformByteOffset,
				texturedUniformScratch,
			);
			gxGpuState.texturedUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
		}
	}
	gxGpuState.texturedVertexByteOffset += vertexFloatCount * 4;
	gxGpuState.backend.accountUpload('vertex', vertexFloatCount * 4);
	const primitiveVertexCount = splitTriangles ? 3 : GX_GPU_POLYGON_VERTICES_PER_COMMAND;
	const maskBitModeWord = commandBuffer.commandMaskBitModeWord[commandIndex];
	const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
	const syncSampleBetweenAliasBands = readsVram || syncSourceBetweenTriangles;
	if (!splitTriangles) {
		drawVramVertices(
			pipeline,
			gxGpuState.texturedBindGroup,
			gxGpuState.texturedVertexBuffer,
			vertexFloatCount,
			vertexFloatStride,
			primitiveVertexCount,
			vertexByteOffset,
			uniformByteOffset,
			gxGpuTexturedCommandRect,
			syncSampleBetweenAliasBands,
			vramYAddressExtensionWord,
		);
		return;
	}
	const triangleFloatCount = vertexFloatStride * 3;
	if (!syncSourceBetweenTriangles
		&& !readsVram
		&& gxGpuState.vramTextureRows === GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		drawVramVertices(
			pipeline,
			gxGpuState.texturedBindGroup,
			gxGpuState.texturedVertexBuffer,
			vertexFloatCount,
			vertexFloatStride,
			primitiveVertexCount,
			vertexByteOffset,
			uniformByteOffset,
			gxGpuTexturedCommandRect,
			syncSampleBetweenAliasBands,
			vramYAddressExtensionWord,
		);
	} else {
		let dependencyBatchFloatStart = 0;
		resetGxGpuVramCopyRect(gxGpuTexturedDependencyBatchRect);
		for (let vertexFloatStart = 0; vertexFloatStart < vertexFloatCount; vertexFloatStart += triangleFloatCount) {
			const vertexFloatEnd = vertexFloatStart + triangleFloatCount;
			setGxGpuVertexBoundsRect(gxGpuVramCopyRectScratch, gxGpuTexturedVertices, vertexFloatStart, vertexFloatEnd, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
			if (vertexFloatStart !== dependencyBatchFloatStart
				&& (gxGpuState.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD
					|| syncSourceBetweenTriangles
					|| gxGpuVramCopyRectsOverlap(gxGpuTexturedDependencyBatchRect, gxGpuVramCopyRectScratch, vramYAddressExtensionWord))) {
				if (dependencyBatchFloatStart !== 0) {
					if (syncSourceBetweenTriangles) syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, 0, vertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, fixedColor);
					if (readsVram) syncGxGpuSampleTextureLogicalArea(
						gxGpuTexturedDependencyBatchRect.left,
						gxGpuTexturedDependencyBatchRect.top,
						gxGpuTexturedDependencyBatchRect.right - gxGpuTexturedDependencyBatchRect.left,
						gxGpuTexturedDependencyBatchRect.bottom - gxGpuTexturedDependencyBatchRect.top,
						vramYAddressExtensionWord,
					);
				}
				drawVramVertices(
					pipeline,
					gxGpuState.texturedBindGroup,
					gxGpuState.texturedVertexBuffer,
					vertexFloatStart - dependencyBatchFloatStart,
					vertexFloatStride,
					primitiveVertexCount,
					vertexByteOffset + dependencyBatchFloatStart * 4,
					uniformByteOffset,
					gxGpuTexturedDependencyBatchRect,
					syncSampleBetweenAliasBands,
					vramYAddressExtensionWord,
				);
				dependencyBatchFloatStart = vertexFloatStart;
				resetGxGpuVramCopyRect(gxGpuTexturedDependencyBatchRect);
			}
			includeGxGpuVramCopyRect(gxGpuTexturedDependencyBatchRect, gxGpuVramCopyRectScratch);
		}
		if (dependencyBatchFloatStart !== 0) {
			if (syncSourceBetweenTriangles) syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, 0, vertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, fixedColor);
			if (readsVram) syncGxGpuSampleTextureLogicalArea(
				gxGpuTexturedDependencyBatchRect.left,
				gxGpuTexturedDependencyBatchRect.top,
				gxGpuTexturedDependencyBatchRect.right - gxGpuTexturedDependencyBatchRect.left,
				gxGpuTexturedDependencyBatchRect.bottom - gxGpuTexturedDependencyBatchRect.top,
				vramYAddressExtensionWord,
			);
		}
		drawVramVertices(
			pipeline,
			gxGpuState.texturedBindGroup,
			gxGpuState.texturedVertexBuffer,
			vertexFloatCount - dependencyBatchFloatStart,
			vertexFloatStride,
			primitiveVertexCount,
			vertexByteOffset + dependencyBatchFloatStart * 4,
			uniformByteOffset,
			gxGpuTexturedDependencyBatchRect,
			syncSampleBetweenAliasBands,
			vramYAddressExtensionWord,
		);
	}
}

function renderTexturedCommand(commandBuffer: GxGpuCommandBufferView, commandIndex: number, topLeftWord: number, bottomRightWord: number): void {
	const vertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, 0);
	if (vertexFloatCount === 0) return;
	const opcode = commandBuffer.commandOpcode[commandIndex];
	const vramYAddressExtensionWord = commandBuffer.commandVramYAddressExtensionWord[commandIndex];
	const fixedColor = commandBuffer.commandKind[commandIndex] === GX_GPU_COMMAND_DRAW_POLYGON
		&& gxGpuCommandGouraud(opcode)
		&& !gxGpuCommandRawTextureEnabled(opcode);
	const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
	setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, gxGpuTexturedVertices, 0, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
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
		const vertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
		setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, gxGpuTexturedVertices, 0, vertexFloatCount, vertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
		const maskBitModeWord = commandBuffer.commandMaskBitModeWord[batchCommandIndex];
		const readsVram = gxGpuCommandSemiTransparencyEnabled(opcode) || gxGpuMaskBitCheckBeforeDraw(maskBitModeWord);
		if (readsVram) syncGxGpuSampleTextureLogicalArea(gxGpuTexturedCommandRect.left, gxGpuTexturedCommandRect.top, gxGpuTexturedCommandRect.right - gxGpuTexturedCommandRect.left, gxGpuTexturedCommandRect.bottom - gxGpuTexturedCommandRect.top, vramYAddressExtensionWord);
		renderTexturedVertices(commandBuffer, batchCommandIndex, vertexFloatCount, topLeftWord, bottomRightWord, readsVram, false);
	}
	resetGxGpuVramCopyRect(gxGpuTexturedBatchRect);
	return 0;
}

function renderTransferCommands(
	vertexFloatCount: number,
	bindGroup: GPUBindGroup,
	maskBitModeWord: number,
	syncSampleBetweenAliasBands: boolean,
	pipeline: GPURenderPipeline,
): void {
	if (vertexFloatCount === 0) return;
	transferUniformScratch[0] = gxGpuMaskBitCheckBeforeDraw(maskBitModeWord) ? 1 : 0;
	transferUniformScratch[1] = gxGpuMaskBitSetWhileDrawing(maskBitModeWord) ? 1 : 0;
	transferUniformScratch[2] = 0;
	const uniformByteOffset = gxGpuState.transferUniformByteOffset;
	const vertexByteOffset = gxGpuState.transferVertexByteOffset;
	const backend = gxGpuState.backend;
	backend.device.queue.writeBuffer(gxGpuState.transferUniformBuffer, uniformByteOffset, transferUniformScratch);
	backend.device.queue.writeBuffer(gxGpuState.transferVertexBuffer, vertexByteOffset, gxGpuTransferVertices.buffer, gxGpuTransferVertices.byteOffset, vertexFloatCount * 4);
	gxGpuState.transferUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
	if (gxGpuState.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		for (let logicalYBase = gxGpuState.vramTextureRows;
			logicalYBase < GX_GPU_VRAM_Y_ADDRESS_PERIOD;
			logicalYBase += gxGpuState.vramTextureRows) {
			transferUniformScratch[2] = logicalYBase;
			backend.device.queue.writeBuffer(
				gxGpuState.transferUniformBuffer,
				gxGpuState.transferUniformByteOffset,
				transferUniformScratch,
			);
			gxGpuState.transferUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
		}
	}
	gxGpuState.transferVertexByteOffset += vertexFloatCount * 4;
	const encoder = gxGpuState.activeEncoder!;
	if (gxGpuState.vramTextureRows === GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		const pass = encoder.beginRenderPass(gxGpuState.vramDrawPassDescriptor);
		pass.setPipeline(pipeline);
		gxGpuDynamicUniformOffsets[0] = uniformByteOffset;
		pass.setBindGroup(0, bindGroup, gxGpuDynamicUniformOffsets);
		pass.setVertexBuffer(0, gxGpuState.transferVertexBuffer, vertexByteOffset, vertexFloatCount * 4);
		pass.draw(vertexFloatCount / GX_GPU_TRANSFER_VERTEX_FLOATS, 1, 0, 0);
		pass.end();
	} else {
		const transferSegmentFloats = GX_GPU_TRANSFER_VERTICES_PER_SEGMENT * GX_GPU_TRANSFER_VERTEX_FLOATS;
		for (let vertexFloatStart = 0;
			vertexFloatStart < vertexFloatCount;
			vertexFloatStart += transferSegmentFloats) {
			const left = gxGpuTransferVertices[vertexFloatStart];
			const top = gxGpuTransferVertices[vertexFloatStart + 1];
			const right = gxGpuTransferVertices[vertexFloatStart + GX_GPU_TRANSFER_VERTEX_FLOATS];
			const bottom = gxGpuTransferVertices[vertexFloatStart + GX_GPU_TRANSFER_VERTEX_FLOATS * 2 + 1];
			let logicalYBase = top & ~backend.gxGpuVramTextureRowMask;
			while (logicalYBase < bottom) {
				const logicalTop = top > logicalYBase ? top : logicalYBase;
				const logicalBottomEdge = logicalYBase + gxGpuState.vramTextureRows;
				const logicalBottom = bottom < logicalBottomEdge ? bottom : logicalBottomEdge;
				const physicalTop = logicalTop - logicalYBase;
				const physicalBottom = logicalBottom - logicalYBase;
				if (syncSampleBetweenAliasBands) {
					syncGxGpuSampleTextureArea(left, physicalTop, right, physicalBottom);
				}
				const pass = encoder.beginRenderPass(gxGpuState.vramDrawPassDescriptor);
				pass.setViewport(0, -logicalYBase, GX_GPU_VRAM_X_ADDRESS_PERIOD, GX_GPU_VRAM_Y_ADDRESS_PERIOD, 0, 1);
				pass.setScissorRect(left, physicalTop, right - left, logicalBottom - logicalTop);
				pass.setPipeline(pipeline);
				gxGpuDynamicUniformOffsets[0] = uniformByteOffset
					+ (logicalYBase / gxGpuState.vramTextureRows) * GX_GPU_UNIFORM_SLOT_BYTES;
				pass.setBindGroup(0, bindGroup, gxGpuDynamicUniformOffsets);
				pass.setVertexBuffer(0, gxGpuState.transferVertexBuffer, vertexByteOffset, vertexFloatCount * 4);
				pass.draw(
					GX_GPU_TRANSFER_VERTICES_PER_SEGMENT,
					1,
					vertexFloatStart / GX_GPU_TRANSFER_VERTEX_FLOATS,
					0,
				);
				pass.end();
				markGxGpuSampleTextureDirtyArea(left, physicalTop, right, physicalBottom);
				logicalYBase += gxGpuState.vramTextureRows;
			}
		}
	}
	backend.accountUpload('vertex', vertexFloatCount * 4);
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
		const runHeight = gxGpuVramWrappedHeight(targetY, remainingRows, vramYAddressExtensionWord, gxGpuState.backend.gxGpuVramTextureRowMask);
		let targetRunX = x;
		let remainingWidth = rowWidth;
		while (remainingWidth !== 0) {
			const runWidth = gxGpuVramWrappedWidth(targetRunX, remainingWidth);
			transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, targetRunX, targetY, runWidth, runHeight, targetRunX, targetY);
			remainingWidth -= runWidth;
			targetRunX = (targetRunX + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
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
	const device = gxGpuState.backend.device;
	gxGpuState.submitCommandBuffers[0] = gxGpuState.activeEncoder!.finish();
	device.queue.submit(gxGpuState.submitCommandBuffers);
	gxGpuState.activeEncoder = device.createCommandEncoder();
	uploadCpuToVramPayload(commandBuffer, payloadWordStart, uploadedPixels);
	if (fullRows !== 0) {
		transferVertexFloatCount = appendCpuToVramRows(x, y, 0, width, fullRows, transferVertexFloatCount, vramYAddressExtensionWord);
	}
	if (lastRowWidth !== 0) {
		transferVertexFloatCount = appendCpuToVramRows(x, y, fullRows, lastRowWidth, 1, transferVertexFloatCount, vramYAddressExtensionWord);
	}
	if (gxGpuMaskBitCheckBeforeDraw(maskBitModeWord)) syncGxGpuSampleTextureLogicalArea(x, y, width, uploadHeight, vramYAddressExtensionWord);
	transferUniformScratch[4] = x;
	transferUniformScratch[5] = y;
	transferUniformScratch[6] = width;
	transferUniformScratch[7] = gxGpuVramYAddressMask(vramYAddressExtensionWord) + 1;
	renderTransferCommands(
		transferVertexFloatCount,
		gxGpuState.transferFromUploadBindGroup,
		maskBitModeWord,
		gxGpuMaskBitCheckBeforeDraw(maskBitModeWord),
		gxGpuState.cpuUploadPipeline,
	);
	if (gxGpuState.vramTextureRows === GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		if (fullRows !== 0) markGxGpuSampleTextureDirtyLogicalArea(x, y, width, fullRows, vramYAddressExtensionWord);
		if (lastRowWidth !== 0) markGxGpuSampleTextureDirtyLogicalArea(x, y + fullRows, lastRowWidth, 1, vramYAddressExtensionWord);
	}
}

function copyVramToVramArea(sourceX: number, sourceY: number, targetX: number, targetY: number, width: number, height: number, maskBitModeWord: number, vramYAddressExtensionWord: number): void {
	let transferVertexFloatCount = 0;
	let runSourceY = gxGpuVramYAddress(sourceY, vramYAddressExtensionWord);
	let runTargetY = gxGpuVramYAddress(targetY, vramYAddressExtensionWord);
	let remainingHeight = height;
	while (remainingHeight !== 0) {
		const sourceRunHeight = gxGpuVramWrappedHeight(runSourceY, remainingHeight, vramYAddressExtensionWord, gxGpuState.backend.gxGpuVramTextureRowMask);
		const targetRunHeight = gxGpuVramWrappedHeight(runTargetY, remainingHeight, vramYAddressExtensionWord, gxGpuState.backend.gxGpuVramTextureRowMask);
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
		const sourceRunHeight = gxGpuVramWrappedHeight(runSourceY, remainingHeight, vramYAddressExtensionWord, gxGpuState.backend.gxGpuVramTextureRowMask);
		const targetRunHeight = gxGpuVramWrappedHeight(runTargetY, remainingHeight, vramYAddressExtensionWord, gxGpuState.backend.gxGpuVramTextureRowMask);
		const runHeight = sourceRunHeight < targetRunHeight ? sourceRunHeight : targetRunHeight;
		let runSourceX = sourceX;
		let runTargetX = targetX;
		let remainingWidth = width;
		while (remainingWidth !== 0) {
			const sourceRunWidth = gxGpuVramWrappedWidth(runSourceX, remainingWidth);
			const targetRunWidth = gxGpuVramWrappedWidth(runTargetX, remainingWidth);
			const runWidth = sourceRunWidth < targetRunWidth ? sourceRunWidth : targetRunWidth;
			transferVertexFloatCount = appendTransferQuad(transferVertexFloatCount, runTargetX, runTargetY, runWidth, runHeight, runSourceX, runSourceY);
			runSourceX = (runSourceX + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
			runTargetX = (runTargetX + runWidth) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1);
			remainingWidth -= runWidth;
		}
		runSourceY = gxGpuVramYAddress(runSourceY + runHeight, vramYAddressExtensionWord);
		runTargetY = gxGpuVramYAddress(runTargetY + runHeight, vramYAddressExtensionWord);
		remainingHeight -= runHeight;
	}
	renderTransferCommands(
		transferVertexFloatCount,
		gxGpuState.transferFromSampleBindGroup,
		maskBitModeWord,
		true,
		gxGpuState.transferPipeline,
	);
	if (gxGpuState.vramTextureRows === GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
		markGxGpuSampleTextureDirtyLogicalArea(targetX, targetY, width, height, vramYAddressExtensionWord);
	}
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
	if (gxGpuVramCopyNeedsChunking(
		sourceX,
		sourceY,
		targetX,
		targetY,
		width,
		height,
		vramYAddressExtensionWord,
		gxGpuState.backend.gxGpuVramTextureRowMask,
	)) {
		const chunkHeight = gxGpuVramCopyChunkHeight(
			sourceY,
			targetY,
			height,
			vramYAddressExtensionWord,
			gxGpuState.backend.gxGpuVramTextureRowMask,
		);
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
		if (gxGpuLineBatchState.readsVram) syncGxGpuSampleTextureLogicalArea(gxGpuLineBatchRect.left, gxGpuLineBatchRect.top, gxGpuLineBatchRect.right - gxGpuLineBatchRect.left, gxGpuLineBatchRect.bottom - gxGpuLineBatchRect.top, gxGpuLineBatchState.vramYAddressExtensionWord);
		renderLineVertices(
			vertexFloatCount,
			gxGpuLineBatchState.uniformByteOffset,
			gxGpuLineBatchRect,
			gxGpuLineBatchState.readsVram,
			gxGpuLineBatchState.vramYAddressExtensionWord,
		);
	}
	resetGxGpuVramCopyRect(gxGpuLineBatchRect);
	return 0;
}

function appendBatchedLineSegment(vertexFloatCount: number, x0: number, y0: number, color0: number, x1: number, y1: number, color1: number): number {
	let offset = vertexFloatCount;
	if (offset + GX_GPU_LINE_SEGMENT_FLOATS > GX_GPU_LINE_FLOAT_CAPACITY) {
		offset = flushLineCommands(offset);
	}
	const commandVertexStart = offset;
	offset = appendLineSegment(offset, x0, y0, color0, x1, y1, color1);
	if (offset !== commandVertexStart) {
		setGxGpuVertexBoundsRect(gxGpuLineCommandRect, gxGpuLineVertices, commandVertexStart, offset, GX_GPU_LINE_VERTEX_FLOATS, gxGpuLineBatchState.topLeftWord, gxGpuLineBatchState.bottomRightWord, gxGpuLineBatchState.vramYAddressExtensionWord);
		if (gxGpuLineBatchState.readsVram && commandVertexStart !== 0 && gxGpuVramCopyRectsOverlap(gxGpuLineCommandRect, gxGpuLineBatchRect, gxGpuLineBatchState.vramYAddressExtensionWord)) {
			offset = flushLineCommands(commandVertexStart);
			offset = appendLineSegment(offset, x0, y0, color0, x1, y1, color1);
			setGxGpuVertexBoundsRect(gxGpuLineCommandRect, gxGpuLineVertices, 0, offset, GX_GPU_LINE_VERTEX_FLOATS, gxGpuLineBatchState.topLeftWord, gxGpuLineBatchState.bottomRightWord, gxGpuLineBatchState.vramYAddressExtensionWord);
		}
		if (offset === GX_GPU_LINE_SEGMENT_FLOATS) {
			writePrimitiveUniforms(gxGpuLineBatchState.blendEnabled, gxGpuLineBatchState.blendMode, gxGpuLineBatchState.maskBitModeWord, gxGpuLineBatchState.ditherEnabled, gxGpuLineBatchState.skippedLineParity, GxGpuRasterKind.Line);
			gxGpuLineBatchState.uniformByteOffset = gxGpuState.primitiveUniformByteOffset;
			gxGpuState.backend.device.queue.writeBuffer(gxGpuState.primitiveUniformBuffer, gxGpuLineBatchState.uniformByteOffset, primitiveUniformScratch);
			gxGpuState.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
			if (gxGpuState.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
				for (let logicalYBase = gxGpuState.vramTextureRows;
					logicalYBase < GX_GPU_VRAM_Y_ADDRESS_PERIOD;
					logicalYBase += gxGpuState.vramTextureRows) {
					primitiveUniformScratch[7] = logicalYBase;
					gxGpuState.backend.device.queue.writeBuffer(
						gxGpuState.primitiveUniformBuffer,
						gxGpuState.primitiveUniformByteOffset,
						primitiveUniformScratch,
					);
					gxGpuState.primitiveUniformByteOffset += GX_GPU_UNIFORM_SLOT_BYTES;
				}
			}
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

function executeNewGxGpuCommands(
	commandBuffer: GxGpuCommandBufferView,
	readback: GxGpuVramSource['readbackPort'],
	commandLimit: number,
	readbackClaimed: boolean,
): void {
	let commandIndex = gxGpuState.processedCommandCount;
	const readbackCanSubmit = gxGpuState.gpureadCompletion === null
		&& (readback.phase === GX_GPU_READBACK_PENDING
			|| (readbackClaimed && readback.phase === GX_GPU_READBACK_SUBMITTED))
		&& commandLimit === readback.fenceCommandCount;
	if (commandIndex >= commandLimit && !readbackCanSubmit) {
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
	for (; commandIndex < commandLimit; commandIndex += 1) {
		if (gxGpuState.vramTextureRows !== GX_GPU_VRAM_Y_ADDRESS_PERIOD) {
			if (solidVertexFloatCount !== 0) solidVertexFloatCount = flushSolidCommands(solidVertexFloatCount);
			if (texturedVertexFloatCount !== 0) texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
			if (lineVertexFloatCount !== 0) lineVertexFloatCount = flushLineCommands(lineVertexFloatCount);
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
						if (batchStateChanged) texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedVertexFloatCount, texturedBatchCommandIndex);
					}
					if (texturedVertexFloatCount === 0) texturedBatchCommandIndex = commandIndex;
					const texturedVertexFloatStride = fixedColor ? GX_GPU_FIXED_TEXTURED_VERTEX_FLOATS : GX_GPU_TEXTURED_VERTEX_FLOATS;
					let texturedCommandVertexStart = texturedVertexFloatCount;
					texturedVertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, texturedVertexFloatCount);
					if (texturedVertexFloatCount !== texturedCommandVertexStart) {
						setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, gxGpuTexturedVertices, texturedCommandVertexStart, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
						let sourceOverlaps = syncGxGpuTexturedSourceTexture(commandBuffer, commandIndex, texturedCommandVertexStart, texturedVertexFloatCount, gxGpuTexturedCommandRect, gxGpuTexturedBatchRect, fixedColor);
						if ((sourceOverlaps & GX_GPU_TEXTURE_SOURCE_BATCH_OVERLAP) !== 0) {
							texturedVertexFloatCount = flushTexturedCommands(commandBuffer, texturedCommandVertexStart, texturedBatchCommandIndex);
							texturedBatchCommandIndex = commandIndex;
							texturedCommandVertexStart = 0;
							texturedVertexFloatCount = appendTexturedCommandVertices(commandBuffer, commandIndex, 0);
							setGxGpuVertexBoundsRect(gxGpuTexturedCommandRect, gxGpuTexturedVertices, 0, texturedVertexFloatCount, texturedVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
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
				const batchStateChanged = topLeftWord !== gxGpuSolidBatchState.topLeftWord
					|| bottomRightWord !== gxGpuSolidBatchState.bottomRightWord
					|| vramYAddressExtensionWord !== gxGpuSolidBatchState.vramYAddressExtensionWord
					|| maskBitModeWord !== gxGpuSolidBatchState.maskBitModeWord
					|| ditherEnabled !== gxGpuSolidBatchState.ditherEnabled
					|| skippedLineParity !== gxGpuSolidBatchState.skippedLineParity
					|| blendEnabled !== gxGpuSolidBatchState.blendEnabled
					|| blendMode !== gxGpuSolidBatchState.blendMode
					|| readsVram !== gxGpuSolidBatchState.readsVram
					|| fixedColor !== gxGpuSolidBatchState.fixedColor
					|| rasterKind !== gxGpuSolidBatchState.rasterKind;
				if (solidVertexFloatCount !== 0 && (batchStateChanged || splitReadVramQuad)) {
					solidVertexFloatCount = flushSolidCommands(solidVertexFloatCount);
				}
				gxGpuSolidBatchState.topLeftWord = topLeftWord;
				gxGpuSolidBatchState.bottomRightWord = bottomRightWord;
				gxGpuSolidBatchState.vramYAddressExtensionWord = vramYAddressExtensionWord;
				gxGpuSolidBatchState.maskBitModeWord = maskBitModeWord;
				gxGpuSolidBatchState.ditherEnabled = ditherEnabled;
				gxGpuSolidBatchState.skippedLineParity = skippedLineParity;
				gxGpuSolidBatchState.blendEnabled = blendEnabled;
				gxGpuSolidBatchState.blendMode = blendMode;
				gxGpuSolidBatchState.readsVram = readsVram;
				gxGpuSolidBatchState.fixedColor = fixedColor;
				gxGpuSolidBatchState.rasterKind = rasterKind;
				const commandVertexStart = solidVertexFloatCount;
				solidVertexFloatCount = appendSolidCommandVertices(commandBuffer, commandIndex, solidVertexFloatCount);
				const solidVertexFloatStride = fixedColor ? GX_GPU_FIXED_SOLID_VERTEX_FLOATS : GX_GPU_SOLID_VERTEX_FLOATS;
				const solidTriangleFloatCount = fixedColor ? GX_GPU_FIXED_SOLID_TRIANGLE_FLOATS : GX_GPU_SOLID_TRIANGLE_FLOATS;
				if (solidVertexFloatCount !== commandVertexStart) {
					setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, gxGpuSolidVertices, commandVertexStart, solidVertexFloatCount, solidVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
					if (splitReadVramQuad && solidVertexFloatCount === solidTriangleFloatCount * 2) {
						renderReadVramSolidQuad(topLeftWord, bottomRightWord, vramYAddressExtensionWord, blendEnabled, blendMode, maskBitModeWord, ditherEnabled, skippedLineParity);
						solidVertexFloatCount = 0;
					} else {
						if (readsVram && commandVertexStart !== 0 && gxGpuVramCopyRectsOverlap(gxGpuSolidCommandRect, gxGpuSolidBatchRect, vramYAddressExtensionWord)) {
							solidVertexFloatCount = flushSolidCommands(commandVertexStart);
							solidVertexFloatCount = appendSolidCommandVertices(commandBuffer, commandIndex, solidVertexFloatCount);
							setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, gxGpuSolidVertices, 0, solidVertexFloatCount, solidVertexFloatStride, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
						}
						includeGxGpuVramCopyRect(gxGpuSolidBatchRect, gxGpuSolidCommandRect);
					}
				}
				break;
			}
			case GX_GPU_COMMAND_FILL_RECTANGLE: {
				const skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
				if (solidVertexFloatCount !== 0 && (gxGpuSolidBatchState.topLeftWord !== topLeftWord
					|| gxGpuSolidBatchState.bottomRightWord !== bottomRightWord
					|| gxGpuSolidBatchState.vramYAddressExtensionWord !== vramYAddressExtensionWord
					|| gxGpuMaskBitSetWhileDrawing(gxGpuSolidBatchState.maskBitModeWord)
					|| gxGpuSolidBatchState.ditherEnabled
					|| gxGpuSolidBatchState.skippedLineParity !== skippedLineParity
					|| gxGpuSolidBatchState.blendEnabled
					|| gxGpuSolidBatchState.readsVram
					|| gxGpuSolidBatchState.fixedColor
					|| gxGpuSolidBatchState.rasterKind !== GxGpuRasterKind.Rectangle)) {
					solidVertexFloatCount = flushSolidCommands(solidVertexFloatCount);
				}
				gxGpuSolidBatchState.topLeftWord = topLeftWord;
				gxGpuSolidBatchState.bottomRightWord = bottomRightWord;
				gxGpuSolidBatchState.vramYAddressExtensionWord = vramYAddressExtensionWord;
				gxGpuSolidBatchState.maskBitModeWord = 0;
				gxGpuSolidBatchState.ditherEnabled = false;
				gxGpuSolidBatchState.skippedLineParity = skippedLineParity;
				gxGpuSolidBatchState.blendEnabled = false;
				gxGpuSolidBatchState.blendMode = 0;
				gxGpuSolidBatchState.readsVram = false;
				gxGpuSolidBatchState.fixedColor = false;
				gxGpuSolidBatchState.rasterKind = GxGpuRasterKind.Rectangle;
				const commandVertexStart = solidVertexFloatCount;
				solidVertexFloatCount = appendFillRectangle(commandBuffer, commandIndex, solidVertexFloatCount);
				if (solidVertexFloatCount !== commandVertexStart) {
					setGxGpuVertexBoundsRect(gxGpuSolidCommandRect, gxGpuSolidVertices, commandVertexStart, solidVertexFloatCount, GX_GPU_SOLID_VERTEX_FLOATS, topLeftWord, bottomRightWord, vramYAddressExtensionWord);
					includeGxGpuVramCopyRect(gxGpuSolidBatchRect, gxGpuSolidCommandRect);
				}
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
				const skippedLineParity = commandBuffer.commandSkippedLineParity[commandIndex];
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
	if (readbackCanSubmit && (readbackClaimed || readback.claimReadback(commandLimit))) {
		const pixelCount = readback.width * readback.height;
		const wordCount = (pixelCount + 1) >> 1;
		const packedWidth = wordCount < GX_GPU_READBACK_PACK_WIDTH ? wordCount : GX_GPU_READBACK_PACK_WIDTH;
		const packedHeight = ((wordCount - 1) / packedWidth | 0) + 1;
		readbackUniformScratch[0] = readback.x;
		readbackUniformScratch[1] = readback.y;
		readbackUniformScratch[2] = readback.width;
		readbackUniformScratch[3] = packedWidth;
		readbackUniformScratch[4] = readback.vramYAddressExtensionWord;
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
	if (gxGpuState.processedCommandCount < commandLimit) {
		gxGpuState.processedCommandCount = commandLimit;
	}
	if (readbackSubmitted) {
		gxGpuState.gpureadCompletion = gxGpuState.gpureadBuffer.mapAsync(GPUMapMode.READ, 0, gxGpuState.gpureadMappedByteCount).then(completeGxGpuReadback);
	}
}

function executeGxGpuVramCommands(source: GxGpuVramSource, commandLimit: number, readbackClaimed: boolean): void {
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
	executeNewGxGpuCommands(commandBuffer, source.readbackPort, commandLimit, readbackClaimed);
}

export function serviceGxGpuReadback(gxGpu: GxGpu, source: GxGpuVramSource): void {
	const readback = source.readbackPort;
	const commandLimit = readback.fenceCommandCount;
	if (gxGpuState.gpureadCompletion !== null) {
		readback.claimReadback(commandLimit);
		gxGpuState.gpureadDeferredGpu = gxGpu;
		gxGpuState.gpureadDeferredToken = readback.token;
		return;
	}
	executeGxGpuVramCommands(source, commandLimit, false);
}

function submitDeferredGxGpuReadback(): void {
	const gxGpu = gxGpuState.gpureadDeferredGpu;
	if (gxGpu === null) {
		return;
	}
	const token = gxGpuState.gpureadDeferredToken;
	gxGpuState.gpureadDeferredGpu = null;
	const output = gxGpu.readDeviceOutput();
	const readback = output.readbackPort;
	if (readback.phase === GX_GPU_READBACK_SUBMITTED && readback.token === token) {
		executeGxGpuVramCommands(output, readback.fenceCommandCount, true);
	}
}

function completeGxGpuReadback(): void {
	const readback = gxGpuState.gpureadPort!;
	if (readback.phase === GX_GPU_READBACK_SUBMITTED && readback.token === gxGpuState.gpureadToken) {
		readback.pixelBytes.set(new Uint8Array(gxGpuState.gpureadBuffer.getMappedRange(0, gxGpuState.gpureadMappedByteCount)));
		readback.completeReadback(gxGpuState.gpureadToken);
	}
	gxGpuState.gpureadBuffer.unmap();
	gxGpuState.gpureadPort = null;
	gxGpuState.gpureadCompletion = null;
	submitDeferredGxGpuReadback();
}

function writeGxGpuScanoutCircuitUniforms(
	circuit: GxGpuPcrtcCircuit,
	wordOffset: number,
): void {
	scanoutUniformScratch[wordOffset] = circuit.framebufferBaseWord;
	scanoutUniformScratch[wordOffset + 1] = circuit.framebufferWidth;
	scanoutUniformScratch[wordOffset + 2] = circuit.framebufferPagesPerRow;
	scanoutUniformScratch[wordOffset + 3] = circuit.framebufferX;
	scanoutUniformScratch[wordOffset + 4] = circuit.framebufferY;
	scanoutUniformScratch[wordOffset + 5] = circuit.displayX;
	scanoutUniformScratch[wordOffset + 6] = circuit.displayY;
	scanoutUniformScratch[wordOffset + 7] = circuit.fieldSourceDivisionMultiplierY;
	scanoutUniformScratch[wordOffset + 8] = circuit.sourcePhaseX;
	scanoutUniformScratch[wordOffset + 9] = circuit.fieldSourcePhase;
	scanoutUniformScratch[wordOffset + 10] = circuit.sourceStepX;
	scanoutUniformScratch[wordOffset + 11] = circuit.fieldSourceStride;
	scanoutUniformScratch[wordOffset + 12] = circuit.sourceDivisionMultiplierX;
	scanoutUniformScratch[wordOffset + 14] = circuit.fieldDisplayY;
	scanoutUniformScratch[wordOffset + 15] = circuit.linearFieldSourceY;
	scanoutUniformScratch[wordOffset + 16] = circuit.linearFieldSourceRowStep;
}

function writeGxGpuScanoutGlobalUniforms(scanout: GxGpuPcrtcScanout, wordOffset: number): void {
	scanoutUniformScratch[wordOffset + 13] = scanout.outputHeight;
	scanoutUniformScratch[wordOffset + 20] = scanout.evenFieldHeight;
	scanoutUniformScratch[wordOffset + 21] = scanout.oddFieldHeight;
	scanoutUniformScratch[wordOffset + 22] = scanout.field;
	scanoutUniformScratch[wordOffset + 23] = scanout.fieldOffset;
	scanoutUniformScratch[wordOffset + 24] = scanout.backgroundColor & 0xff;
	scanoutUniformScratch[wordOffset + 25] = scanout.backgroundColor >>> 8 & 0xff;
	scanoutUniformScratch[wordOffset + 26] = scanout.backgroundColor >>> 16 & 0xff;
}

function writeGxGpuScanoutUniforms(scanout: GxGpuPcrtcScanout, field: number): void {
	const circuit2WordOffset = GX_GPU_UNIFORM_SLOT_BYTES >> 2;
	const circuit1WordOffset = GX_GPU_UNIFORM_SLOT_BYTES >> 1;
	writeGxGpuScanoutGlobalUniforms(scanout, 0);
	writeGxGpuScanoutCircuitUniforms(scanout.circuits[0], 0);
	scanoutUniformScratch.copyWithin(circuit2WordOffset, 0, GX_GPU_SCANOUT_UNIFORM_WORD_COUNT);
	scanoutUniformScratch.copyWithin(circuit1WordOffset, 0, GX_GPU_SCANOUT_UNIFORM_WORD_COUNT);
	writeGxGpuScanoutCircuitUniforms(scanout.circuits[1], circuit2WordOffset);
	gxGpuState.backend.device.queue.writeBuffer(gxGpuState.scanoutUniformBuffer, 0, scanoutUniformScratch);
	gxGpuState.scanoutUniformPcrtcRevision = scanout.revision;
	gxGpuState.scanoutUniformField = field;
	gxGpuState.scanoutUniformValid = true;
}

function prepareGxGpuScanoutState(scanout: GxGpuPcrtcScanout): void {
	const field = scanout.interlaced ? scanout.field : -1;
	if (!gxGpuState.scanoutUniformValid
		|| gxGpuState.scanoutUniformField !== field
		|| gxGpuState.scanoutUniformPcrtcRevision !== scanout.revision) {
		writeGxGpuScanoutUniforms(scanout, field);
	}
	if (!gxGpuState.scanoutFixedStateValid
		|| gxGpuState.scanoutFixedStatePcrtcRevision !== scanout.revision) {
		gxGpuScanoutClearColor.r = (scanout.backgroundColor & 0xff) / 255;
		gxGpuScanoutClearColor.g = (scanout.backgroundColor >>> 8 & 0xff) / 255;
		gxGpuScanoutClearColor.b = (scanout.backgroundColor >>> 16 & 0xff) / 255;
		gxGpuScanoutBlendConstant.a = scanout.blendAlpha / 255;
		gxGpuState.scanoutFixedStatePcrtcRevision = scanout.revision;
		gxGpuState.scanoutFixedStateValid = true;
	}
}

function drawGxGpuScanoutPass(
	pass: GPURenderPassEncoder,
	scanout: GxGpuPcrtcScanout,
	circuitIndex: number,
	drawPath: number,
	fieldProgram: boolean,
): void {
	const circuit = scanout.circuits[circuitIndex];
	const pipelineIndex = drawPath * GX_GPU_SCANOUT_PROGRAM_STORAGE_COUNT + circuit.samplePath;
	pass.setPipeline((fieldProgram ? gxGpuState.scanoutFieldPipelines : gxGpuState.scanoutPipelines)[pipelineIndex]!);
	if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB
		|| drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGBA) {
		pass.setBlendConstant(gxGpuScanoutBlendConstant);
	}
	pass.draw(3);
}

function drawGxGpuScanoutCircuit(
	pass: GPURenderPassEncoder,
	scanout: GxGpuPcrtcScanout,
	circuitIndex: number,
	drawPath: number,
	fieldProgram: boolean,
	uniformSlot: number,
): void {
	if (drawPath === GX_GPU_PCRTC_SCANOUT_DRAW_NONE) return;
	const circuit = scanout.circuits[circuitIndex];
	gxGpuDynamicUniformOffsets[0] = uniformSlot * GX_GPU_UNIFORM_SLOT_BYTES;
	pass.setBindGroup(0, gxGpuState.scanoutBindGroup, gxGpuDynamicUniformOffsets);
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
		drawGxGpuScanoutPass(
			pass, scanout, circuitIndex, GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_SOURCE_RGB, fieldProgram,
		);
		drawGxGpuScanoutPass(
			pass, scanout, circuitIndex, GX_GPU_PCRTC_SCANOUT_DRAW_RAW_ALPHA, fieldProgram,
		);
		return;
	}
	drawGxGpuScanoutPass(pass, scanout, circuitIndex, drawPath, fieldProgram);
}

function scanoutProgressiveGxGpuVram(
	state: RenderPassStateRegistry['gx_gpu'],
	scanout: GxGpuPcrtcScanout,
): void {
	const target = state.targetColorTex as GPUTexture;
	const device = gxGpuState.backend.device;
	if (gxGpuState.scanoutTargetTexture !== target) {
		gxGpuState.scanoutTargetTexture = target;
		gxGpuState.scanoutTargetView = target.createView();
	}
	gxGpuState.scanoutColorAttachment.view = gxGpuState.scanoutTargetView;
	gxGpuState.scanoutColorAttachment.loadOp = scanout.backgroundRequired !== 0 ? 'clear' : 'load';
	const encoder = device.createCommandEncoder();
	const pass = encoder.beginRenderPass(gxGpuState.scanoutPassDescriptor);
	drawGxGpuScanoutCircuit(pass, scanout, 1, scanout.circuit2OutputPath, false, 1);
	drawGxGpuScanoutCircuit(pass, scanout, 0, scanout.circuit1OutputPath, false, 2);
	pass.end();
	gxGpuState.submitCommandBuffers[0] = encoder.finish();
	device.queue.submit(gxGpuState.submitCommandBuffers);
}

function scanoutInterlacedGxGpuVram(
	state: RenderPassStateRegistry['gx_gpu'],
	scanout: GxGpuPcrtcScanout,
	vramReplacementSerial: bigint,
): void {
	const target = state.targetColorTex as GPUTexture;
	const device = gxGpuState.backend.device;
	const width = state.width;
	const height = state.height;
	const sizeChanged = gxGpuState.scanoutFieldsWidth !== width || gxGpuState.scanoutFieldsHeight !== height;
	const invalid = !gxGpuState.scanoutFieldsValid
		|| sizeChanged
		|| gxGpuState.scanoutFieldsVramReplacementSerial !== vramReplacementSerial;
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
			const fieldsColorAttachment: GPURenderPassColorAttachment = {
				view: fieldsView,
				clearValue: gxGpuScanoutClearColor,
				loadOp: 'clear',
				storeOp: 'store',
			};
			gxGpuState.scanoutFieldsColorAttachment = fieldsColorAttachment;
			gxGpuState.scanoutFieldsPassDescriptor = { colorAttachments: [fieldsColorAttachment] };
		}
		gxGpuState.scanoutFieldsBindGroup = createBindGroup(
			device,
			gxGpuState.scanoutBindGroupLayout,
			gxGpuState.scanoutUniformBuffer,
			GX_GPU_SCANOUT_UNIFORM_BYTES,
			fieldsView,
			gxGpuState.sampler,
		);
		gxGpuState.scanoutFieldsWidth = width;
		gxGpuState.scanoutFieldsHeight = height;
	}
	if (gxGpuState.scanoutTargetTexture !== target) {
		gxGpuState.scanoutTargetTexture = target;
		gxGpuState.scanoutTargetView = target.createView();
	}

	const encoder = device.createCommandEncoder();
	gxGpuState.scanoutFieldsColorAttachment!.loadOp = invalid ? 'clear' : 'load';
	const fieldPass = encoder.beginRenderPass(gxGpuState.scanoutFieldsPassDescriptor!);
	fieldPass.setViewport(0, scanout.fieldOffset, width, scanout.fieldHeight, 0, 1);
	if (scanout.backgroundRequired !== 0 && !invalid) {
		fieldPass.setPipeline(gxGpuState.scanoutBackgroundPipeline);
		gxGpuDynamicUniformOffsets[0] = 0;
		fieldPass.setBindGroup(0, gxGpuState.scanoutBindGroup, gxGpuDynamicUniformOffsets);
		fieldPass.setScissorRect(0, scanout.fieldOffset, width, scanout.fieldHeight);
		fieldPass.draw(3);
	}
	drawGxGpuScanoutCircuit(fieldPass, scanout, 1, scanout.circuit2OutputPath, true, 1);
	drawGxGpuScanoutCircuit(fieldPass, scanout, 0, scanout.circuit1OutputPath, true, 2);
	fieldPass.end();
	gxGpuState.scanoutFieldsValid = true;
	gxGpuState.scanoutFieldsVramReplacementSerial = vramReplacementSerial;

	gxGpuState.scanoutColorAttachment.view = gxGpuState.scanoutTargetView;
	gxGpuState.scanoutColorAttachment.loadOp = 'load';
	const weavePass = encoder.beginRenderPass(gxGpuState.scanoutPassDescriptor);
	weavePass.setPipeline(gxGpuState.scanoutWeavePipeline);
	gxGpuDynamicUniformOffsets[0] = 0;
	weavePass.setBindGroup(0, gxGpuState.scanoutFieldsBindGroup!, gxGpuDynamicUniformOffsets);
	weavePass.draw(3);
	weavePass.end();
	gxGpuState.submitCommandBuffers[0] = encoder.finish();
	device.queue.submit(gxGpuState.submitCommandBuffers);
}

function scanoutGxGpuVram(
	state: RenderPassStateRegistry['gx_gpu'],
	output: GxGpuDeviceOutput,
): void {
	const scanout = output.pcrtcScanout;
	prepareGxGpuScanoutState(scanout);
	if (scanout.interlaced) {
		scanoutInterlacedGxGpuVram(state, scanout, output.vramReplacementSerial);
		return;
	}
	gxGpuState.scanoutFieldsValid = false;
	scanoutProgressiveGxGpuVram(state, scanout);
}

function renderGxGpuPass(
	state: RenderPassStateRegistry['gx_gpu'],
	output: GxGpuDeviceOutput,
): void {
	executeGxGpuVramCommands(output, output.commandBuffer.presentCommandCount, false);
	scanoutGxGpuVram(state, output);
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
		exec: (_backend: WebGPUBackend, _fbo, state: RenderPassStateRegistry['gx_gpu'], _pipelineHandle, output) =>
			renderGxGpuPass(state, output),
	});
}

export async function captureRenderedVramSnapshot(gxGpu: GxGpu, output: GxGpuVramSource): Promise<void> {
	executeGxGpuVramCommands(output, output.commandBuffer.executedCommandCount, false);
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
	const snapshot = gxGpuState.vramSnapshotScratch;
	let snapshotByteOffset = 0;
	let readbackByteOffset = 0;
	for (let pixel = 0; pixel < GX_GPU_VRAM_X_ADDRESS_PERIOD * gxGpuState.vramTextureRows; pixel += 1) {
		snapshot[snapshotByteOffset] = readback[readbackByteOffset];
		snapshot[snapshotByteOffset + 1] = readback[readbackByteOffset + 1];
		snapshotByteOffset += 2;
		readbackByteOffset += GX_GPU_RAW_VRAM_BYTES_PER_PIXEL;
	}
	gxGpuState.vramReadbackBuffer.unmap();
	gxGpuState.vramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(snapshot, gxGpuState.processedCommandCount);
}
