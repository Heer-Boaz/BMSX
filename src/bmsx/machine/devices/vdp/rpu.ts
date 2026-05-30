import type { Memory } from '../../memory/memory';
import { IO_WORD_SIZE } from '../../memory/map';
import type { DeviceStatusLatch } from '../device_status';
import { packedHigh16, packedLow16 } from '../../common/word';
import { decodeSignedQ16_16 } from '../../../common/fixed_point';
import {
	VDP_RPU_BIND_COST,
	VDP_RPU_DISCARD_COST,
	VDP_RPU_PACKET_COST,
	VDP_RPU_PASS_COST,
	VDP_RPU_RESOURCE_COST,
	rpuDrawCost,
	rpuUploadCost,
} from './budget';

const VDP_RPU_EMPTY_BYTES = new Uint8Array(0);

export const VDP_RPU_PASS_CAPACITY = 64;
export const VDP_RPU_DRAW_CAPACITY = 4096;
export const VDP_RPU_DRAW_BATCH_CAPACITY = VDP_RPU_DRAW_CAPACITY;
export const VDP_RPU_STREAM_BINDING_CAPACITY = 8192;
export const VDP_RPU_CONSTANT_BINDING_CAPACITY = 8192;
export const VDP_RPU_TEXTURE_BINDING_CAPACITY = 4096;
export const VDP_RPU_BUFFER_CAPACITY = 1024;
export const VDP_RPU_BUFFER_SLOT_BYTE_CAPACITY = 0x00010000;
export const VDP_RPU_BUFFER_BYTE_CAPACITY =
	VDP_RPU_BUFFER_CAPACITY * VDP_RPU_BUFFER_SLOT_BYTE_CAPACITY;
export const VDP_RPU_BUFFER_REF_CAPACITY = 4096;
export const VDP_RPU_FRAME_BUFFER_BYTE_CAPACITY = 0x00400000;
export const VDP_RPU_SURFACE_CAPACITY = 256;
export const VDP_RPU_SURFACE_REF_CAPACITY = 1024;
export const VDP_RPU_CONSTANT_BANK_CAPACITY = 256;
export const VDP_RPU_CONSTANT_WORD_CAPACITY = 65536;
export const VDP_RPU_RESOURCE_NONE = 0xffffffff;
export const VDP_RPU_REF_NONE = 0xffff;

export const VDP_RPU_FEATURE_INSTANCED_ARRAYS = 1 << 0;
export const VDP_RPU_FEATURE_UINT_INDEX = 1 << 1;
export const VDP_RPU_FEATURE_DEPTH_TEXTURE = 1 << 2;
export const VDP_RPU_REQUIRED_FEATURES = VDP_RPU_FEATURE_INSTANCED_ARRAYS | VDP_RPU_FEATURE_UINT_INDEX;

export const VDP_RPU_PACKET_KIND = 0x18000000;
export const VDP_RPU_OP_BUFFER_DEFINE = 1;
export const VDP_RPU_OP_BUFFER_UPLOAD_DMA = 2;
export const VDP_RPU_OP_BUFFER_UPLOAD_INLINE = 3;
export const VDP_RPU_OP_BUFFER_DISCARD = 4;
export const VDP_RPU_OP_SURFACE_DEFINE = 8;
export const VDP_RPU_OP_CONSTANT_BANK_DEFINE = 16;
export const VDP_RPU_OP_CONSTANT_UPLOAD_DMA = 17;
export const VDP_RPU_OP_CONSTANT_UPLOAD_INLINE = 18;
export const VDP_RPU_OP_CONSTANT_UPLOAD_DEVICE = 19;
export const VDP_RPU_OP_BEGIN_PASS = 32;
export const VDP_RPU_OP_END_PASS = 33;
export const VDP_RPU_OP_BEGIN_DRAW = 40;
export const VDP_RPU_OP_BIND_STREAM = 41;
export const VDP_RPU_OP_BIND_CONSTANTS = 42;
export const VDP_RPU_OP_BIND_TEXTURE = 43;
export const VDP_RPU_OP_END_DRAW = 44;

export const VDP_RPU_BUFFER_DEFINE_WORDS = 4;
export const VDP_RPU_BUFFER_UPLOAD_DMA_WORDS = 5;
export const VDP_RPU_BUFFER_DISCARD_WORDS = 2;
export const VDP_RPU_SURFACE_DEFINE_WORDS = 4;
export const VDP_RPU_CONSTANT_BANK_DEFINE_WORDS = 4;
export const VDP_RPU_CONSTANT_UPLOAD_DMA_WORDS = 5;
export const VDP_RPU_CONSTANT_UPLOAD_DEVICE_WORDS = 6;
export const VDP_RPU_BEGIN_PASS_WORDS = 8;
export const VDP_RPU_END_PASS_WORDS = 1;
export const VDP_RPU_BEGIN_DRAW_WORDS = 9;
export const VDP_RPU_BIND_STREAM_WORDS = 6;
export const VDP_RPU_BIND_CONSTANTS_WORDS = 5;
export const VDP_RPU_BIND_TEXTURE_WORDS = 3;
export const VDP_RPU_END_DRAW_WORDS = 1;
export const VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS = 4;
export const VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS = 4;

export const VDP_RPU_CONSTANT_SOURCE_XF_Q16 = 0;
export const VDP_RPU_CONSTANT_SOURCE_LPU_RAW = 1;
export const VDP_RPU_CONSTANT_SOURCE_MFU_Q16 = 2;
export const VDP_RPU_CONSTANT_SOURCE_JTU_Q16 = 3;
export const VDP_RPU_CONSTANT_SOURCE_MASK = 0x00000003;

export const VDP_RPU_FRAME_IDLE = 0;
export const VDP_RPU_FRAME_OPEN = 1;
export const VDP_RPU_PASS_OPEN = 2;
export const VDP_RPU_DRAW_OPEN = 3;

export type VdpRpuFrameBuildState =
	| typeof VDP_RPU_FRAME_IDLE
	| typeof VDP_RPU_FRAME_OPEN
	| typeof VDP_RPU_PASS_OPEN
	| typeof VDP_RPU_DRAW_OPEN;

export const VDP_RPU_BUFFER_USAGE_VERTEX = 1 << 0;
export const VDP_RPU_BUFFER_USAGE_INDEX = 1 << 1;
export const VDP_RPU_BUFFER_USAGE_CONSTANT = 1 << 2;
export const VDP_RPU_BUFFER_USAGE_MASK =
	VDP_RPU_BUFFER_USAGE_VERTEX
	| VDP_RPU_BUFFER_USAGE_INDEX
	| VDP_RPU_BUFFER_USAGE_CONSTANT;

export const VDP_RPU_SURFACE_FORMAT_RGBA8 = 0;
export const VDP_RPU_SURFACE_FORMAT_DEPTH16 = 1;
export const VDP_RPU_SURFACE_USAGE_COLOR = 1 << 0;
export const VDP_RPU_SURFACE_USAGE_DEPTH = 1 << 1;
export const VDP_RPU_SURFACE_USAGE_TEXTURE = 1 << 2;
export const VDP_RPU_SURFACE_USAGE_MASK =
	VDP_RPU_SURFACE_USAGE_COLOR
	| VDP_RPU_SURFACE_USAGE_DEPTH
	| VDP_RPU_SURFACE_USAGE_TEXTURE;
export const VDP_RPU_WIDTH_MASK = 0x0000ffff;
export const VDP_RPU_HEIGHT_SHIFT = 16;
export const VDP_RPU_FORMAT_MASK = 0x000000ff;
export const VDP_RPU_USAGE_SHIFT = 8;

export const VDP_RPU_PASS_COLOR_CLEAR = 1 << 0;
export const VDP_RPU_PASS_DEPTH_CLEAR = 1 << 1;
export const VDP_RPU_PASS_COLOR_STORE = 1 << 2;
export const VDP_RPU_PASS_DEPTH_STORE = 1 << 3;
export const VDP_RPU_PASS_OPS_MASK =
	VDP_RPU_PASS_COLOR_CLEAR
	| VDP_RPU_PASS_DEPTH_CLEAR
	| VDP_RPU_PASS_COLOR_STORE
	| VDP_RPU_PASS_DEPTH_STORE;

export const VDP_RPU_BLEND_NONE = 0;
export const VDP_RPU_BLEND_ALPHA = 1;
export const VDP_RPU_BLEND_ADD = 2;
export const VDP_RPU_DEPTH_NONE = 0;
export const VDP_RPU_DEPTH_LESS = 1;
export const VDP_RPU_DEPTH_LEQUAL = 2;
export const VDP_RPU_CULL_NONE = 0;
export const VDP_RPU_CULL_BACK = 1;
export const VDP_RPU_CULL_FRONT = 2;
export const VDP_RPU_PIPE_BLEND_MASK = 0x0000000f;
export const VDP_RPU_PIPE_DEPTH_MASK = 0x000000f0;
export const VDP_RPU_PIPE_CULL_MASK = 0x00000f00;
export const VDP_RPU_PIPE_DEPTH_WRITE = 0x00001000;
export const VDP_RPU_PIPE_COLOR_WRITE_MASK = 0x000f0000;
export const VDP_RPU_PIPELINE_WORD_MASK =
	VDP_RPU_PIPE_BLEND_MASK
	| VDP_RPU_PIPE_DEPTH_MASK
	| VDP_RPU_PIPE_CULL_MASK
	| VDP_RPU_PIPE_DEPTH_WRITE
	| VDP_RPU_PIPE_COLOR_WRITE_MASK;

export const VDP_RPU_PRIM_TRIANGLES = 0;
export const VDP_RPU_PRIM_TRIANGLE_STRIP = 1;
export const VDP_RPU_PRIM_LINES = 2;
export const VDP_RPU_PRIM_POINTS = 3;
export const VDP_RPU_INDEX_NONE = 0;
export const VDP_RPU_INDEX_U16 = 1;
export const VDP_RPU_INDEX_U32 = 2;
export const VDP_RPU_DRAW_PRIMITIVE_MASK = 0x000000ff;
export const VDP_RPU_DRAW_INDEX_TYPE_SHIFT = 8;
export const VDP_RPU_DRAW_INDEX_TYPE_MASK = 0x0000ff00;

export const VDP_RPU_ATTR_POS = 0;
export const VDP_RPU_ATTR_UV0 = 1;
export const VDP_RPU_ATTR_COLOR = 2;
export const VDP_RPU_ATTR_NORMAL = 3;
export const VDP_RPU_ATTR_JOINTS = 4;
export const VDP_RPU_ATTR_WEIGHTS = 5;
export const VDP_RPU_ATTR_INSTANCE0 = 6;
export const VDP_RPU_ATTR_INSTANCE1 = 7;
export const VDP_RPU_ATTR_INSTANCE2 = 8;
export const VDP_RPU_ATTR_INSTANCE3 = 9;
export const VDP_RPU_ATTR_INSTANCE_COLOR = 10;
export const VDP_RPU_ATTR_INSTANCE_UVRECT = 11;
export const VDP_RPU_ATTR_MORPH_POS = 12;
export const VDP_RPU_ATTR_MORPH_NRM = 13;
export const VDP_RPU_ATTR_F32 = 0;
export const VDP_RPU_ATTR_U8 = 1;
export const VDP_RPU_ATTR_U8N = 2;
export const VDP_RPU_ATTR_S16N = 3;

export const VDP_RPU_LAYOUT_V2_C4 = 0;
export const VDP_RPU_LAYOUT_V2_T2_C4 = 1;
export const VDP_RPU_LAYOUT_V3_C4 = 2;
export const VDP_RPU_LAYOUT_V3_T2_C4 = 3;
export const VDP_RPU_LAYOUT_V3_N3_C4 = 4;
export const VDP_RPU_LAYOUT_V3_N3_T2_C4 = 5;
export const VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4 = 6;
export const VDP_RPU_LAYOUT_V3_DM3 = 8;
export const VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4 = 32;
export const VDP_RPU_LAYOUT_I_MAT4_C4 = 33;

export const VDP_RPU_SHADER_V2_C4 = 0;
export const VDP_RPU_SHADER_V2_T2_C4 = 1;
export const VDP_RPU_SHADER_V3_C4_C0 = 2;
export const VDP_RPU_SHADER_V3_T2_C4_C0 = 3;
export const VDP_RPU_SHADER_V3_N3_T2_C4_C0_C1 = 4;
export const VDP_RPU_SHADER_V3_N3_T2_C4_J4_W4_C0_C1 = 5;
export const VDP_RPU_SHADER_V2_T2_C4_I_AFFINE2 = 6;
export const VDP_RPU_SHADER_V3_C4_I_MAT4 = 7;
export const VDP_RPU_SHADER_VARIANT_MASK = 0x00000007;
export const VDP_RPU_SHADER_FLAG_MORPH = 0x00000008;
export const VDP_RPU_SHADER_FLAG_T1 = 0x00000010;
export const VDP_RPU_INSTANCE_MODE_NONE = 0;
export const VDP_RPU_INSTANCE_MODE_AFFINE2 = 1;
export const VDP_RPU_INSTANCE_MODE_MAT4 = 2;

export const VDP_FAULT_RPU_BAD_PACKET = 0x0700;
export const VDP_FAULT_RPU_BAD_STREAM_LAYOUT = 0x0702;
export const VDP_FAULT_RPU_BUFFER_OOB = 0x0703;
export const VDP_FAULT_RPU_STALE_RESOURCE = 0x0704;
export const VDP_FAULT_RPU_BAD_SURFACE_USAGE = 0x0705;
export const VDP_FAULT_RPU_BAD_CONSTANT_RANGE = 0x0706;
export const VDP_FAULT_RPU_COMMAND_OVERFLOW = 0x0708;
export const VDP_FAULT_RPU_BAD_STATE = 0x0709;

export type VdpRpuFrameResources = Readonly<{
	bufferRefs: VdpRpuFrameBufferRefs;
	surfaceRefs: VdpRpuFrameSurfaceRefs;
	constantWords: Uint32Array;
	constantBanks: VdpRpuConstantBankTable;
}>;

export type VdpRpuFrameOutput = Readonly<{
	commands: VdpRpuCommandBuffer;
	resources: VdpRpuFrameResources;
}>;

export class VdpRpuFrameBufferRefs {
	public length = 0;
	public snapshotByteLength = 0;
	public readonly snapshotBytes = new Uint8Array(VDP_RPU_FRAME_BUFFER_BYTE_CAPACITY);
	public readonly bufferId = new Uint32Array(VDP_RPU_BUFFER_REF_CAPACITY);
	public readonly revision = new Uint32Array(VDP_RPU_BUFFER_REF_CAPACITY);
	public readonly sourceByteOffset = new Uint32Array(VDP_RPU_BUFFER_REF_CAPACITY);
	public readonly byteOffset = new Uint32Array(VDP_RPU_BUFFER_REF_CAPACITY);
	public readonly byteLength = new Uint32Array(VDP_RPU_BUFFER_REF_CAPACITY);
	public readonly usage = new Uint8Array(VDP_RPU_BUFFER_REF_CAPACITY);
	public readonly bytes: Uint8Array[] = [];

	public constructor() {
		for (let index = 0; index < VDP_RPU_BUFFER_REF_CAPACITY; index += 1) {
			this.bytes[index] = VDP_RPU_EMPTY_BYTES;
		}
	}
}

export class VdpRpuFrameSurfaceRefs {
	public length = 0;
	public readonly surfaceId = new Uint32Array(VDP_RPU_SURFACE_REF_CAPACITY);
	public readonly revision = new Uint32Array(VDP_RPU_SURFACE_REF_CAPACITY);
	public readonly width = new Uint16Array(VDP_RPU_SURFACE_REF_CAPACITY);
	public readonly height = new Uint16Array(VDP_RPU_SURFACE_REF_CAPACITY);
	public readonly format = new Uint8Array(VDP_RPU_SURFACE_REF_CAPACITY);
	public readonly usage = new Uint8Array(VDP_RPU_SURFACE_REF_CAPACITY);
}

export class VdpRpuConstantBankTable {
	public length = 0;
	public readonly firstWord = new Uint32Array(VDP_RPU_CONSTANT_BANK_CAPACITY);
	public readonly wordCount = new Uint16Array(VDP_RPU_CONSTANT_BANK_CAPACITY);
	public readonly epoch = new Uint32Array(VDP_RPU_CONSTANT_BANK_CAPACITY);
}

export class VdpRpuCommandBuffer {
	public passCount = 0;
	public drawCount = 0;
	public drawBatchCount = 0;
	public streamBindingCount = 0;
	public constantBindingCount = 0;
	public textureBindingCount = 0;
	public readonly passFirstDraw = new Uint32Array(VDP_RPU_PASS_CAPACITY);
	public readonly passDrawCount = new Uint16Array(VDP_RPU_PASS_CAPACITY);
	public readonly passFirstBatch = new Uint32Array(VDP_RPU_PASS_CAPACITY);
	public readonly passBatchCount = new Uint16Array(VDP_RPU_PASS_CAPACITY);
	public readonly passColorSurfaceRef = new Uint16Array(VDP_RPU_PASS_CAPACITY);
	public readonly passDepthSurfaceRef = new Uint16Array(VDP_RPU_PASS_CAPACITY);
	public readonly passViewportXY = new Uint32Array(VDP_RPU_PASS_CAPACITY);
	public readonly passViewportWH = new Uint32Array(VDP_RPU_PASS_CAPACITY);
	public readonly passOps = new Uint32Array(VDP_RPU_PASS_CAPACITY);
	public readonly passClearColor = new Uint32Array(VDP_RPU_PASS_CAPACITY);
	public readonly passClearDepthWord = new Uint32Array(VDP_RPU_PASS_CAPACITY);
	public readonly drawShaderVariant = new Uint16Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawPrimitive = new Uint8Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawPipelineWord = new Uint32Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawVertexCount = new Uint32Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawInstanceCount = new Uint32Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawIndexBufferRef = new Uint16Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawIndexByteOffset = new Uint32Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawIndexCount = new Uint32Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawIndexType = new Uint8Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawFirstStreamBinding = new Uint32Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawStreamBindingCount = new Uint8Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawFirstConstantBinding = new Uint32Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawConstantBindingCount = new Uint8Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawFirstTextureBinding = new Uint32Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawTextureBindingCount = new Uint8Array(VDP_RPU_DRAW_CAPACITY);
	public readonly batchFirstDraw = new Uint32Array(VDP_RPU_DRAW_BATCH_CAPACITY);
	public readonly batchDrawCount = new Uint16Array(VDP_RPU_DRAW_BATCH_CAPACITY);
	public readonly batchVertexCount = new Uint32Array(VDP_RPU_DRAW_BATCH_CAPACITY);
	public readonly batchInstanceCount = new Uint32Array(VDP_RPU_DRAW_BATCH_CAPACITY);
	public readonly batchIndexCount = new Uint32Array(VDP_RPU_DRAW_BATCH_CAPACITY);
	public readonly streamLayoutId = new Uint16Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly streamSlot = new Uint8Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly streamBufferRef = new Uint16Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly streamByteOffset = new Uint32Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly streamStepRate = new Uint8Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly constantBindingSlot = new Uint8Array(VDP_RPU_CONSTANT_BINDING_CAPACITY);
	public readonly constantBank = new Uint16Array(VDP_RPU_CONSTANT_BINDING_CAPACITY);
	public readonly constantFirstWord = new Uint16Array(VDP_RPU_CONSTANT_BINDING_CAPACITY);
	public readonly constantWordCount = new Uint16Array(VDP_RPU_CONSTANT_BINDING_CAPACITY);
	public readonly textureSlot = new Uint8Array(VDP_RPU_TEXTURE_BINDING_CAPACITY);
	public readonly textureSurfaceRef = new Uint16Array(VDP_RPU_TEXTURE_BINDING_CAPACITY);
}

export type VdpRpuStreamAttributeSpec = Readonly<{
	attribute: number;
	componentCount: number;
	componentType: number;
	normalized: 0 | 1;
	byteOffset: number;
}>;

export type VdpRpuStreamLayoutSpec = Readonly<{
	id: number;
	byteStride: number;
	attributeCount: number;
	attributes: readonly VdpRpuStreamAttributeSpec[];
}>;

export const VDP_RPU_STREAM_LAYOUTS: readonly VdpRpuStreamLayoutSpec[] = [
	{
		id: VDP_RPU_LAYOUT_V2_C4,
		byteStride: 12,
		attributeCount: 2,
		attributes: [
			{ attribute: VDP_RPU_ATTR_POS, componentCount: 2, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 8 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_V2_T2_C4,
		byteStride: 20,
		attributeCount: 3,
		attributes: [
			{ attribute: VDP_RPU_ATTR_POS, componentCount: 2, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_UV0, componentCount: 2, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 8 },
			{ attribute: VDP_RPU_ATTR_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 16 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_V3_C4,
		byteStride: 16,
		attributeCount: 2,
		attributes: [
			{ attribute: VDP_RPU_ATTR_POS, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 12 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_V3_T2_C4,
		byteStride: 24,
		attributeCount: 3,
		attributes: [
			{ attribute: VDP_RPU_ATTR_POS, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_UV0, componentCount: 2, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 12 },
			{ attribute: VDP_RPU_ATTR_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 20 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_V3_N3_C4,
		byteStride: 28,
		attributeCount: 3,
		attributes: [
			{ attribute: VDP_RPU_ATTR_POS, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_NORMAL, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 12 },
			{ attribute: VDP_RPU_ATTR_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 24 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_V3_N3_T2_C4,
		byteStride: 36,
		attributeCount: 4,
		attributes: [
			{ attribute: VDP_RPU_ATTR_POS, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_NORMAL, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 12 },
			{ attribute: VDP_RPU_ATTR_UV0, componentCount: 2, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 24 },
			{ attribute: VDP_RPU_ATTR_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 32 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4,
		byteStride: 44,
		attributeCount: 6,
		attributes: [
			{ attribute: VDP_RPU_ATTR_POS, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_NORMAL, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 12 },
			{ attribute: VDP_RPU_ATTR_UV0, componentCount: 2, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 24 },
			{ attribute: VDP_RPU_ATTR_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 32 },
			{ attribute: VDP_RPU_ATTR_JOINTS, componentCount: 4, componentType: VDP_RPU_ATTR_U8, normalized: 0, byteOffset: 36 },
			{ attribute: VDP_RPU_ATTR_WEIGHTS, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 40 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_V3_DM3,
		byteStride: 24,
		attributeCount: 2,
		attributes: [
			{ attribute: VDP_RPU_ATTR_MORPH_POS, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_MORPH_NRM, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 12 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4,
		byteStride: 48,
		attributeCount: 4,
		attributes: [
			{ attribute: VDP_RPU_ATTR_INSTANCE0, componentCount: 4, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_INSTANCE1, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 16 },
			{ attribute: VDP_RPU_ATTR_INSTANCE_UVRECT, componentCount: 4, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 28 },
			{ attribute: VDP_RPU_ATTR_INSTANCE_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 44 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_I_MAT4_C4,
		byteStride: 68,
		attributeCount: 5,
		attributes: [
			{ attribute: VDP_RPU_ATTR_INSTANCE0, componentCount: 4, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_INSTANCE1, componentCount: 4, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 16 },
			{ attribute: VDP_RPU_ATTR_INSTANCE2, componentCount: 4, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 32 },
			{ attribute: VDP_RPU_ATTR_INSTANCE3, componentCount: 4, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 48 },
			{ attribute: VDP_RPU_ATTR_INSTANCE_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 64 },
		],
	},
];

export type VdpRpuShaderConstantSlotSpec = Readonly<{
	slot: number;
	maxWords: number;
	vertexVisible: 0 | 1;
	fragmentVisible: 0 | 1;
}>;

export type VdpRpuShaderVariantSpec = Readonly<{
	id: number;
	requiredFeatureMask: number;
	vertexLayout: number;
	instanceLayout: number;
	instanceMode: number;
	textureSlotCount: number;
	usesC0: 0 | 1;
	lightingConstantSlot: number;
	jointConstantSlot: number;
	constantSlotCount: number;
	constantSlots: readonly VdpRpuShaderConstantSlotSpec[];
}>;

export const VDP_RPU_SHADER_VARIANTS: readonly VdpRpuShaderVariantSpec[] = [
	{
		id: VDP_RPU_SHADER_V2_C4,
		requiredFeatureMask: 0,
		vertexLayout: VDP_RPU_LAYOUT_V2_C4,
		instanceLayout: VDP_RPU_RESOURCE_NONE,
		instanceMode: VDP_RPU_INSTANCE_MODE_NONE,
		textureSlotCount: 0,
		usesC0: 0,
		lightingConstantSlot: VDP_RPU_RESOURCE_NONE,
		jointConstantSlot: VDP_RPU_RESOURCE_NONE,
		constantSlotCount: 0,
		constantSlots: [],
	},
	{
		id: VDP_RPU_SHADER_V2_T2_C4,
		requiredFeatureMask: 0,
		vertexLayout: VDP_RPU_LAYOUT_V2_T2_C4,
		instanceLayout: VDP_RPU_RESOURCE_NONE,
		instanceMode: VDP_RPU_INSTANCE_MODE_NONE,
		textureSlotCount: 1,
		usesC0: 0,
		lightingConstantSlot: VDP_RPU_RESOURCE_NONE,
		jointConstantSlot: VDP_RPU_RESOURCE_NONE,
		constantSlotCount: 0,
		constantSlots: [],
	},
	{
		id: VDP_RPU_SHADER_V3_C4_C0,
		requiredFeatureMask: 0,
		vertexLayout: VDP_RPU_LAYOUT_V3_C4,
		instanceLayout: VDP_RPU_RESOURCE_NONE,
		instanceMode: VDP_RPU_INSTANCE_MODE_NONE,
		textureSlotCount: 0,
		usesC0: 1,
		lightingConstantSlot: VDP_RPU_RESOURCE_NONE,
		jointConstantSlot: VDP_RPU_RESOURCE_NONE,
		constantSlotCount: 1,
		constantSlots: [
			{ slot: 0, maxWords: 32, vertexVisible: 1, fragmentVisible: 0 },
		],
	},
	{
		id: VDP_RPU_SHADER_V3_T2_C4_C0,
		requiredFeatureMask: 0,
		vertexLayout: VDP_RPU_LAYOUT_V3_T2_C4,
		instanceLayout: VDP_RPU_RESOURCE_NONE,
		instanceMode: VDP_RPU_INSTANCE_MODE_NONE,
		textureSlotCount: 1,
		usesC0: 1,
		lightingConstantSlot: VDP_RPU_RESOURCE_NONE,
		jointConstantSlot: VDP_RPU_RESOURCE_NONE,
		constantSlotCount: 1,
		constantSlots: [
			{ slot: 0, maxWords: 32, vertexVisible: 1, fragmentVisible: 0 },
		],
	},
	{
		id: VDP_RPU_SHADER_V3_N3_T2_C4_C0_C1,
		requiredFeatureMask: 0,
		vertexLayout: VDP_RPU_LAYOUT_V3_N3_T2_C4,
		instanceLayout: VDP_RPU_RESOURCE_NONE,
		instanceMode: VDP_RPU_INSTANCE_MODE_NONE,
		textureSlotCount: 1,
		usesC0: 1,
		lightingConstantSlot: 1,
		jointConstantSlot: VDP_RPU_RESOURCE_NONE,
		constantSlotCount: 2,
		constantSlots: [
			{ slot: 0, maxWords: 32, vertexVisible: 1, fragmentVisible: 0 },
			{ slot: 1, maxWords: 72, vertexVisible: 0, fragmentVisible: 1 },
		],
	},
	{
		id: VDP_RPU_SHADER_V3_N3_T2_C4_J4_W4_C0_C1,
		requiredFeatureMask: 0,
		vertexLayout: VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4,
		instanceLayout: VDP_RPU_RESOURCE_NONE,
		instanceMode: VDP_RPU_INSTANCE_MODE_NONE,
		textureSlotCount: 1,
		usesC0: 1,
		lightingConstantSlot: 2,
		jointConstantSlot: 1,
		constantSlotCount: 3,
		constantSlots: [
			{ slot: 0, maxWords: 32, vertexVisible: 1, fragmentVisible: 0 },
			{ slot: 1, maxWords: 384, vertexVisible: 1, fragmentVisible: 0 },
			{ slot: 2, maxWords: 72, vertexVisible: 0, fragmentVisible: 1 },
		],
	},
	{
		id: VDP_RPU_SHADER_V2_T2_C4_I_AFFINE2,
		requiredFeatureMask: VDP_RPU_FEATURE_INSTANCED_ARRAYS,
		vertexLayout: VDP_RPU_LAYOUT_V2_T2_C4,
		instanceLayout: VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4,
		instanceMode: VDP_RPU_INSTANCE_MODE_AFFINE2,
		textureSlotCount: 1,
		usesC0: 0,
		lightingConstantSlot: VDP_RPU_RESOURCE_NONE,
		jointConstantSlot: VDP_RPU_RESOURCE_NONE,
		constantSlotCount: 0,
		constantSlots: [],
	},
	{
		id: VDP_RPU_SHADER_V3_C4_I_MAT4,
		requiredFeatureMask: VDP_RPU_FEATURE_INSTANCED_ARRAYS,
		vertexLayout: VDP_RPU_LAYOUT_V3_C4,
		instanceLayout: VDP_RPU_LAYOUT_I_MAT4_C4,
		instanceMode: VDP_RPU_INSTANCE_MODE_MAT4,
		textureSlotCount: 0,
		usesC0: 0,
		lightingConstantSlot: VDP_RPU_RESOURCE_NONE,
		jointConstantSlot: VDP_RPU_RESOURCE_NONE,
		constantSlotCount: 0,
		constantSlots: [],
	},
];

export function resolveVdpRpuStreamLayoutSpec(layoutId: number): VdpRpuStreamLayoutSpec {
	switch (layoutId) {
		case VDP_RPU_LAYOUT_V2_T2_C4:
			return VDP_RPU_STREAM_LAYOUTS[1];
		case VDP_RPU_LAYOUT_V3_C4:
			return VDP_RPU_STREAM_LAYOUTS[2];
		case VDP_RPU_LAYOUT_V3_T2_C4:
			return VDP_RPU_STREAM_LAYOUTS[3];
		case VDP_RPU_LAYOUT_V3_N3_C4:
			return VDP_RPU_STREAM_LAYOUTS[4];
		case VDP_RPU_LAYOUT_V3_N3_T2_C4:
			return VDP_RPU_STREAM_LAYOUTS[5];
		case VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4:
			return VDP_RPU_STREAM_LAYOUTS[6];
		case VDP_RPU_LAYOUT_V3_DM3:
			return VDP_RPU_STREAM_LAYOUTS[7];
		case VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4:
			return VDP_RPU_STREAM_LAYOUTS[8];
		case VDP_RPU_LAYOUT_I_MAT4_C4:
			return VDP_RPU_STREAM_LAYOUTS[9];
		case VDP_RPU_LAYOUT_V2_C4:
		default:
			return VDP_RPU_STREAM_LAYOUTS[0];
	}
}

export function resolveVdpRpuShaderVariantSpec(shaderVariant: number): VdpRpuShaderVariantSpec {
	return VDP_RPU_SHADER_VARIANTS[shaderVariant & VDP_RPU_SHADER_VARIANT_MASK];
}

export type VdpRpuCommandBufferSaveState = {
	passCount: number;
	drawCount: number;
	drawBatchCount: number;
	streamBindingCount: number;
	constantBindingCount: number;
	textureBindingCount: number;
	passFirstDraw: number[];
	passDrawCount: number[];
	passFirstBatch: number[];
	passBatchCount: number[];
	passColorSurfaceRef: number[];
	passDepthSurfaceRef: number[];
	passViewportXY: number[];
	passViewportWH: number[];
	passOps: number[];
	passClearColor: number[];
	passClearDepthWord: number[];
	drawShaderVariant: number[];
	drawPrimitive: number[];
	drawPipelineWord: number[];
	drawVertexCount: number[];
	drawInstanceCount: number[];
	drawIndexBufferRef: number[];
	drawIndexByteOffset: number[];
	drawIndexCount: number[];
	drawIndexType: number[];
	drawFirstStreamBinding: number[];
	drawStreamBindingCount: number[];
	drawFirstConstantBinding: number[];
	drawConstantBindingCount: number[];
	drawFirstTextureBinding: number[];
	drawTextureBindingCount: number[];
	batchFirstDraw: number[];
	batchDrawCount: number[];
	batchVertexCount: number[];
	batchInstanceCount: number[];
	batchIndexCount: number[];
	streamLayoutId: number[];
	streamSlot: number[];
	streamBufferRef: number[];
	streamByteOffset: number[];
	streamStepRate: number[];
	constantBindingSlot: number[];
	constantBank: number[];
	constantFirstWord: number[];
	constantWordCount: number[];
	textureSlot: number[];
	textureSurfaceRef: number[];
};

export type VdpRpuFrameBufferRefSaveState = {
	bufferId: number;
	revision: number;
	sourceByteOffset: number;
	byteOffset: number;
	byteLength: number;
	usage: number;
};

export type VdpRpuFrameSurfaceRefSaveState = {
	surfaceId: number;
	revision: number;
	width: number;
	height: number;
	format: number;
	usage: number;
};

export type VdpRpuConstantBankSaveState = {
	firstWord: number;
	wordCount: number;
	epoch: number;
};

export type VdpRpuFrameSaveState = {
	commands: VdpRpuCommandBufferSaveState;
	bufferRefs: VdpRpuFrameBufferRefSaveState[];
	bufferBytes: number[];
	surfaceRefs: VdpRpuFrameSurfaceRefSaveState[];
	constantWords: number[];
	constantBanks: VdpRpuConstantBankSaveState[];
};

export type VdpRpuBufferRecordSaveState = {
	bufferId: number;
	liveRevision: number;
	byteLength: number;
	usage: number;
};

export type VdpRpuBufferImageSaveState = {
	bufferId: number;
	bytes: Uint8Array;
};

export type VdpRpuSurfaceRecordSaveState = {
	surfaceId: number;
	liveRevision: number;
	width: number;
	height: number;
	format: number;
	usage: number;
};


export type VdpRpuSaveState = {
	buildState: VdpRpuFrameBuildState;
	openPassIndex: number;
	openDrawIndex: number;
	buffers: VdpRpuBufferRecordSaveState[];
	bufferImages: VdpRpuBufferImageSaveState[];
	surfaces: VdpRpuSurfaceRecordSaveState[];
};

export function createVdpRpuFrameOutput(): VdpRpuFrameOutput {
	return {
		commands: new VdpRpuCommandBuffer(),
		resources: {
			bufferRefs: new VdpRpuFrameBufferRefs(),
			surfaceRefs: new VdpRpuFrameSurfaceRefs(),
			constantWords: new Uint32Array(VDP_RPU_CONSTANT_WORD_CAPACITY),
			constantBanks: new VdpRpuConstantBankTable(),
		},
	};
}

export function resetVdpRpuFrameOutput(frame: VdpRpuFrameOutput): void {
	frame.commands.passCount = 0;
	frame.commands.drawCount = 0;
	frame.commands.drawBatchCount = 0;
	frame.commands.streamBindingCount = 0;
	frame.commands.constantBindingCount = 0;
	frame.commands.textureBindingCount = 0;
	frame.resources.bufferRefs.length = 0;
	frame.resources.bufferRefs.snapshotByteLength = 0;
	frame.resources.surfaceRefs.length = 0;
	frame.resources.constantBanks.length = 0;
}

export class VdpRpuUnit {
	public lastPacketCost = 0;
	private buildState: VdpRpuFrameBuildState = VDP_RPU_FRAME_IDLE;
	private openPassIndex = 0;
	private openDrawIndex = 0;
	private readonly bufferDefined = new Uint8Array(VDP_RPU_BUFFER_CAPACITY);
	private readonly bufferRevision = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
	private readonly bufferByteLength = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
	private readonly bufferUsage = new Uint32Array(VDP_RPU_BUFFER_CAPACITY);
	private readonly bufferBytes = new Uint8Array(VDP_RPU_BUFFER_BYTE_CAPACITY);
	private readonly surfaceDefined = new Uint8Array(VDP_RPU_SURFACE_CAPACITY);
	private readonly surfaceRevision = new Uint32Array(VDP_RPU_SURFACE_CAPACITY);
	private readonly surfaceWidth = new Uint16Array(VDP_RPU_SURFACE_CAPACITY);
	private readonly surfaceHeight = new Uint16Array(VDP_RPU_SURFACE_CAPACITY);
	private readonly surfaceFormat = new Uint8Array(VDP_RPU_SURFACE_CAPACITY);
	private readonly surfaceUsage = new Uint8Array(VDP_RPU_SURFACE_CAPACITY);
	private readonly deviceConstantFloatScratch = new Float32Array(1);
	private readonly deviceConstantWordScratch = new Uint32Array(this.deviceConstantFloatScratch.buffer);

	public constructor(
		private readonly memory: Memory,
		private readonly fault: DeviceStatusLatch,
		private readonly xfMatrixWords: Uint32Array,
		private readonly lightRegisterWords: Uint32Array,
		private readonly morphWeightWords: Uint32Array,
		private readonly jointMatrixWords: Uint32Array,
	) {}

	public reset(): void {
		this.lastPacketCost = 0;
		this.buildState = VDP_RPU_FRAME_IDLE;
		this.openPassIndex = 0;
		this.openDrawIndex = 0;
		for (let bufferId = 0; bufferId < VDP_RPU_BUFFER_CAPACITY; bufferId += 1) {
			this.bufferDefined[bufferId] = 0;
			this.bufferRevision[bufferId] = 0;
			this.bufferByteLength[bufferId] = 0;
			this.bufferUsage[bufferId] = 0;
		}
		for (let surfaceId = 0; surfaceId < VDP_RPU_SURFACE_CAPACITY; surfaceId += 1) {
			this.surfaceDefined[surfaceId] = 0;
			this.surfaceRevision[surfaceId] = 0;
			this.surfaceWidth[surfaceId] = 0;
			this.surfaceHeight[surfaceId] = 0;
			this.surfaceFormat[surfaceId] = 0;
			this.surfaceUsage[surfaceId] = 0;
		}
	}

	public beginFrame(frame: VdpRpuFrameOutput): boolean {
		this.lastPacketCost = 0;
		if (this.buildState !== VDP_RPU_FRAME_IDLE) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, this.buildState);
			return false;
		}
		resetVdpRpuFrameOutput(frame);
		this.buildState = VDP_RPU_FRAME_OPEN;
		this.openPassIndex = 0;
		this.openDrawIndex = 0;
		return true;
	}

	public cancelFrame(frame: VdpRpuFrameOutput): void {
		this.lastPacketCost = 0;
		resetVdpRpuFrameOutput(frame);
		this.buildState = VDP_RPU_FRAME_IDLE;
		this.openPassIndex = 0;
		this.openDrawIndex = 0;
	}

	public endFrame(frame: VdpRpuFrameOutput): boolean {
		this.lastPacketCost = 0;
		void frame;
		if (this.buildState === VDP_RPU_DRAW_OPEN || this.buildState === VDP_RPU_PASS_OPEN) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, this.buildState);
			return false;
		}
		if (this.buildState !== VDP_RPU_FRAME_OPEN) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, this.buildState);
			return false;
		}
		this.buildState = VDP_RPU_FRAME_IDLE;
		this.openPassIndex = 0;
		this.openDrawIndex = 0;
		return true;
	}

	public captureState(): VdpRpuSaveState {
		let bufferCount = 0;
		for (let bufferId = 0; bufferId < VDP_RPU_BUFFER_CAPACITY; bufferId += 1) {
			if (this.bufferDefined[bufferId] !== 0) {
				bufferCount += 1;
			}
		}
		let surfaceCount = 0;
		for (let surfaceId = 0; surfaceId < VDP_RPU_SURFACE_CAPACITY; surfaceId += 1) {
			if (this.surfaceDefined[surfaceId] !== 0) {
				surfaceCount += 1;
			}
		}
		const buffers: VdpRpuBufferRecordSaveState[] = [];
		const bufferImages: VdpRpuBufferImageSaveState[] = [];
		let bufferIndex = 0;
		for (let bufferId = 0; bufferId < VDP_RPU_BUFFER_CAPACITY; bufferId += 1) {
			if (this.bufferDefined[bufferId] !== 0) {
				const byteLength = this.bufferByteLength[bufferId];
				const bytes = new Uint8Array(byteLength);
				const byteBase = this.bufferByteBase(bufferId);
				for (let byteIndex = 0; byteIndex < byteLength; byteIndex += 1) {
					bytes[byteIndex] = this.bufferBytes[byteBase + byteIndex];
				}
				buffers[bufferIndex] = {
					bufferId,
					liveRevision: this.bufferRevision[bufferId],
					byteLength,
					usage: this.bufferUsage[bufferId],
				};
				bufferImages[bufferIndex] = {
					bufferId,
					bytes,
				};
				bufferIndex += 1;
			}
		}
		const surfaces: VdpRpuSurfaceRecordSaveState[] = [];
		let surfaceIndex = 0;
		for (let surfaceId = 0; surfaceId < VDP_RPU_SURFACE_CAPACITY; surfaceId += 1) {
			if (this.surfaceDefined[surfaceId] !== 0) {
				surfaces[surfaceIndex] = {
					surfaceId,
					liveRevision: this.surfaceRevision[surfaceId],
					width: this.surfaceWidth[surfaceId],
					height: this.surfaceHeight[surfaceId],
					format: this.surfaceFormat[surfaceId],
					usage: this.surfaceUsage[surfaceId],
				};
				surfaceIndex += 1;
			}
		}
		return {
			buildState: this.buildState,
			openPassIndex: this.openPassIndex,
			openDrawIndex: this.openDrawIndex,
			buffers,
			bufferImages,
			surfaces,
		};
	}

	public restoreState(state: VdpRpuSaveState): void {
		this.reset();
		this.buildState = state.buildState;
		this.openPassIndex = state.openPassIndex;
		this.openDrawIndex = state.openDrawIndex;
		for (let index = 0; index < state.buffers.length; index += 1) {
			const buffer = state.buffers[index];
			this.bufferDefined[buffer.bufferId] = 1;
			this.bufferRevision[buffer.bufferId] = buffer.liveRevision;
			this.bufferByteLength[buffer.bufferId] = buffer.byteLength;
			this.bufferUsage[buffer.bufferId] = buffer.usage;
		}
		for (let index = 0; index < state.bufferImages.length; index += 1) {
			const image = state.bufferImages[index];
			const byteBase = this.bufferByteBase(image.bufferId);
			for (let byteIndex = 0; byteIndex < image.bytes.length; byteIndex += 1) {
				this.bufferBytes[byteBase + byteIndex] = image.bytes[byteIndex];
			}
		}
		for (let index = 0; index < state.surfaces.length; index += 1) {
			const surface = state.surfaces[index];
			this.surfaceDefined[surface.surfaceId] = 1;
			this.surfaceRevision[surface.surfaceId] = surface.liveRevision;
			this.surfaceWidth[surface.surfaceId] = surface.width;
			this.surfaceHeight[surface.surfaceId] = surface.height;
			this.surfaceFormat[surface.surfaceId] = surface.format;
			this.surfaceUsage[surface.surfaceId] = surface.usage;
		}
	}

	public rebindFrameResources(frame: VdpRpuFrameOutput): void {
		for (let index = 0; index < frame.resources.bufferRefs.length; index += 1) {
			frame.resources.bufferRefs.bytes[index] = frame.resources.bufferRefs.snapshotBytes;
		}
	}

	public consumePacketFromMemory(frame: VdpRpuFrameOutput, headerWord: number, cursor: number, end: number): number {
		this.lastPacketCost = 0;
		if ((headerWord & 0x0000ffff) !== 0) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
			return VDP_RPU_RESOURCE_NONE;
		}
		const payloadWords = (headerWord >>> 16) & 0xff;
		const payloadEnd = cursor + payloadWords * IO_WORD_SIZE;
		if (payloadWords === 0 || payloadEnd > end) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
			return VDP_RPU_RESOURCE_NONE;
		}
		const op = this.memory.readU32(cursor);
		if (this.consumePacketPayloadFromMemory(frame, op, cursor, payloadWords)) {
			return payloadEnd;
		}
		return VDP_RPU_RESOURCE_NONE;
	}

	public consumePacketFromWords(frame: VdpRpuFrameOutput, words: Uint32Array, headerWord: number, cursor: number, wordCount: number): number {
		this.lastPacketCost = 0;
		if ((headerWord & 0x0000ffff) !== 0) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
			return VDP_RPU_RESOURCE_NONE;
		}
		const payloadWords = (headerWord >>> 16) & 0xff;
		if (payloadWords === 0 || cursor + payloadWords > wordCount) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
			return VDP_RPU_RESOURCE_NONE;
		}
		const op = words[cursor];
		if (this.consumePacketPayloadFromWords(frame, words, op, cursor, payloadWords)) {
			return cursor + payloadWords;
		}
		return VDP_RPU_RESOURCE_NONE;
	}

	private consumePacketPayloadFromMemory(frame: VdpRpuFrameOutput, op: number, cursor: number, payloadWords: number): boolean {
		if (this.buildState === VDP_RPU_FRAME_IDLE) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, op);
			return false;
		}
		switch (op) {
			case VDP_RPU_OP_BUFFER_DEFINE:
				return payloadWords === VDP_RPU_BUFFER_DEFINE_WORDS
					&& this.acceptBufferDefine(
						this.memory.readU32(cursor + IO_WORD_SIZE),
						this.memory.readU32(cursor + IO_WORD_SIZE * 2),
						this.memory.readU32(cursor + IO_WORD_SIZE * 3),
					);
			case VDP_RPU_OP_BUFFER_UPLOAD_DMA:
				return payloadWords === VDP_RPU_BUFFER_UPLOAD_DMA_WORDS
					&& this.acceptBufferUploadDma(
						this.memory.readU32(cursor + IO_WORD_SIZE),
						this.memory.readU32(cursor + IO_WORD_SIZE * 2),
						this.memory.readU32(cursor + IO_WORD_SIZE * 3),
						this.memory.readU32(cursor + IO_WORD_SIZE * 4),
					);
			case VDP_RPU_OP_BUFFER_UPLOAD_INLINE:
				return this.acceptBufferUploadInlineFromMemory(cursor, payloadWords);
			case VDP_RPU_OP_BUFFER_DISCARD:
				return payloadWords === VDP_RPU_BUFFER_DISCARD_WORDS
					&& this.acceptBufferDiscard(this.memory.readU32(cursor + IO_WORD_SIZE));
			case VDP_RPU_OP_SURFACE_DEFINE:
				return payloadWords === VDP_RPU_SURFACE_DEFINE_WORDS
					&& this.acceptSurfaceDefine(
						this.memory.readU32(cursor + IO_WORD_SIZE),
						this.memory.readU32(cursor + IO_WORD_SIZE * 2),
						this.memory.readU32(cursor + IO_WORD_SIZE * 3),
					);
			case VDP_RPU_OP_CONSTANT_BANK_DEFINE:
				return payloadWords === VDP_RPU_CONSTANT_BANK_DEFINE_WORDS
					&& this.acceptConstantBankDefine(
						frame,
						this.memory.readU32(cursor + IO_WORD_SIZE),
						this.memory.readU32(cursor + IO_WORD_SIZE * 2),
						this.memory.readU32(cursor + IO_WORD_SIZE * 3),
					);
			case VDP_RPU_OP_CONSTANT_UPLOAD_DMA:
				return payloadWords === VDP_RPU_CONSTANT_UPLOAD_DMA_WORDS
					&& this.acceptConstantUploadDma(
						frame,
						this.memory.readU32(cursor + IO_WORD_SIZE),
						this.memory.readU32(cursor + IO_WORD_SIZE * 2),
						this.memory.readU32(cursor + IO_WORD_SIZE * 3),
						this.memory.readU32(cursor + IO_WORD_SIZE * 4),
					);
			case VDP_RPU_OP_CONSTANT_UPLOAD_INLINE:
				return this.acceptConstantUploadInlineFromMemory(frame, cursor, payloadWords);
			case VDP_RPU_OP_CONSTANT_UPLOAD_DEVICE:
				return payloadWords === VDP_RPU_CONSTANT_UPLOAD_DEVICE_WORDS
					&& this.acceptConstantUploadDevice(
						frame,
						this.memory.readU32(cursor + IO_WORD_SIZE),
						this.memory.readU32(cursor + IO_WORD_SIZE * 2),
						this.memory.readU32(cursor + IO_WORD_SIZE * 3),
						this.memory.readU32(cursor + IO_WORD_SIZE * 4),
						this.memory.readU32(cursor + IO_WORD_SIZE * 5),
					);
			case VDP_RPU_OP_BEGIN_PASS:
				return payloadWords === VDP_RPU_BEGIN_PASS_WORDS
					&& this.acceptBeginPass(
						frame,
						this.memory.readU32(cursor + IO_WORD_SIZE),
						this.memory.readU32(cursor + IO_WORD_SIZE * 2),
						this.memory.readU32(cursor + IO_WORD_SIZE * 3),
						this.memory.readU32(cursor + IO_WORD_SIZE * 4),
						this.memory.readU32(cursor + IO_WORD_SIZE * 5),
						this.memory.readU32(cursor + IO_WORD_SIZE * 6),
						this.memory.readU32(cursor + IO_WORD_SIZE * 7),
					);
			case VDP_RPU_OP_END_PASS:
				return payloadWords === VDP_RPU_END_PASS_WORDS && this.acceptEndPass(frame);
			case VDP_RPU_OP_BEGIN_DRAW:
				return payloadWords === VDP_RPU_BEGIN_DRAW_WORDS
					&& this.acceptBeginDraw(
						frame,
						this.memory.readU32(cursor + IO_WORD_SIZE),
						this.memory.readU32(cursor + IO_WORD_SIZE * 2),
						this.memory.readU32(cursor + IO_WORD_SIZE * 3),
						this.memory.readU32(cursor + IO_WORD_SIZE * 4),
						this.memory.readU32(cursor + IO_WORD_SIZE * 5),
						this.memory.readU32(cursor + IO_WORD_SIZE * 6),
						this.memory.readU32(cursor + IO_WORD_SIZE * 7),
						this.memory.readU32(cursor + IO_WORD_SIZE * 8),
					);
			case VDP_RPU_OP_BIND_STREAM:
				return payloadWords === VDP_RPU_BIND_STREAM_WORDS
					&& this.acceptBindStream(
						frame,
						this.memory.readU32(cursor + IO_WORD_SIZE),
						this.memory.readU32(cursor + IO_WORD_SIZE * 2),
						this.memory.readU32(cursor + IO_WORD_SIZE * 3),
						this.memory.readU32(cursor + IO_WORD_SIZE * 4),
						this.memory.readU32(cursor + IO_WORD_SIZE * 5),
					);
			case VDP_RPU_OP_BIND_CONSTANTS:
				return payloadWords === VDP_RPU_BIND_CONSTANTS_WORDS
					&& this.acceptBindConstants(
						frame,
						this.memory.readU32(cursor + IO_WORD_SIZE),
						this.memory.readU32(cursor + IO_WORD_SIZE * 2),
						this.memory.readU32(cursor + IO_WORD_SIZE * 3),
						this.memory.readU32(cursor + IO_WORD_SIZE * 4),
					);
			case VDP_RPU_OP_BIND_TEXTURE:
				return payloadWords === VDP_RPU_BIND_TEXTURE_WORDS
					&& this.acceptBindTexture(
						frame,
						this.memory.readU32(cursor + IO_WORD_SIZE),
						this.memory.readU32(cursor + IO_WORD_SIZE * 2),
					);
			case VDP_RPU_OP_END_DRAW:
				return payloadWords === VDP_RPU_END_DRAW_WORDS && this.acceptEndDraw(frame);
			default:
				this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, op);
				return false;
		}
	}

	private consumePacketPayloadFromWords(frame: VdpRpuFrameOutput, words: Uint32Array, op: number, cursor: number, payloadWords: number): boolean {
		if (this.buildState === VDP_RPU_FRAME_IDLE) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, op);
			return false;
		}
		switch (op) {
			case VDP_RPU_OP_BUFFER_DEFINE:
				return payloadWords === VDP_RPU_BUFFER_DEFINE_WORDS && this.acceptBufferDefine(words[cursor + 1], words[cursor + 2], words[cursor + 3]);
			case VDP_RPU_OP_BUFFER_UPLOAD_DMA:
				return payloadWords === VDP_RPU_BUFFER_UPLOAD_DMA_WORDS && this.acceptBufferUploadDma(words[cursor + 1], words[cursor + 2], words[cursor + 3], words[cursor + 4]);
			case VDP_RPU_OP_BUFFER_UPLOAD_INLINE:
				return this.acceptBufferUploadInlineFromWords(words, cursor, payloadWords);
			case VDP_RPU_OP_BUFFER_DISCARD:
				return payloadWords === VDP_RPU_BUFFER_DISCARD_WORDS && this.acceptBufferDiscard(words[cursor + 1]);
			case VDP_RPU_OP_SURFACE_DEFINE:
				return payloadWords === VDP_RPU_SURFACE_DEFINE_WORDS && this.acceptSurfaceDefine(words[cursor + 1], words[cursor + 2], words[cursor + 3]);
			case VDP_RPU_OP_CONSTANT_BANK_DEFINE:
				return payloadWords === VDP_RPU_CONSTANT_BANK_DEFINE_WORDS && this.acceptConstantBankDefine(frame, words[cursor + 1], words[cursor + 2], words[cursor + 3]);
			case VDP_RPU_OP_CONSTANT_UPLOAD_DMA:
				return payloadWords === VDP_RPU_CONSTANT_UPLOAD_DMA_WORDS && this.acceptConstantUploadDma(frame, words[cursor + 1], words[cursor + 2], words[cursor + 3], words[cursor + 4]);
			case VDP_RPU_OP_CONSTANT_UPLOAD_INLINE:
				return this.acceptConstantUploadInlineFromWords(frame, words, cursor, payloadWords);
			case VDP_RPU_OP_CONSTANT_UPLOAD_DEVICE:
				return payloadWords === VDP_RPU_CONSTANT_UPLOAD_DEVICE_WORDS && this.acceptConstantUploadDevice(frame, words[cursor + 1], words[cursor + 2], words[cursor + 3], words[cursor + 4], words[cursor + 5]);
			case VDP_RPU_OP_BEGIN_PASS:
				return payloadWords === VDP_RPU_BEGIN_PASS_WORDS && this.acceptBeginPass(frame, words[cursor + 1], words[cursor + 2], words[cursor + 3], words[cursor + 4], words[cursor + 5], words[cursor + 6], words[cursor + 7]);
			case VDP_RPU_OP_END_PASS:
				return payloadWords === VDP_RPU_END_PASS_WORDS && this.acceptEndPass(frame);
			case VDP_RPU_OP_BEGIN_DRAW:
				return payloadWords === VDP_RPU_BEGIN_DRAW_WORDS && this.acceptBeginDraw(frame, words[cursor + 1], words[cursor + 2], words[cursor + 3], words[cursor + 4], words[cursor + 5], words[cursor + 6], words[cursor + 7], words[cursor + 8]);
			case VDP_RPU_OP_BIND_STREAM:
				return payloadWords === VDP_RPU_BIND_STREAM_WORDS && this.acceptBindStream(frame, words[cursor + 1], words[cursor + 2], words[cursor + 3], words[cursor + 4], words[cursor + 5]);
			case VDP_RPU_OP_BIND_CONSTANTS:
				return payloadWords === VDP_RPU_BIND_CONSTANTS_WORDS && this.acceptBindConstants(frame, words[cursor + 1], words[cursor + 2], words[cursor + 3], words[cursor + 4]);
			case VDP_RPU_OP_BIND_TEXTURE:
				return payloadWords === VDP_RPU_BIND_TEXTURE_WORDS && this.acceptBindTexture(frame, words[cursor + 1], words[cursor + 2]);
			case VDP_RPU_OP_END_DRAW:
				return payloadWords === VDP_RPU_END_DRAW_WORDS && this.acceptEndDraw(frame);
			default:
				this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, op);
				return false;
		}
	}

	private acceptBufferDefine(bufferId: number, byteLength: number, usage: number): boolean {
		if (bufferId >= VDP_RPU_BUFFER_CAPACITY || byteLength === 0 || byteLength > VDP_RPU_BUFFER_SLOT_BYTE_CAPACITY) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, bufferId);
			return false;
		}
		this.bufferDefined[bufferId] = 1;
		this.bufferRevision[bufferId] = (this.bufferRevision[bufferId] + 1) >>> 0;
		this.bufferByteLength[bufferId] = byteLength >>> 0;
		this.bufferUsage[bufferId] = usage >>> 0;
		this.lastPacketCost = VDP_RPU_RESOURCE_COST;
		return true;
	}

	private acceptBufferUploadDma(bufferId: number, dstByteOffset: number, srcAddr: number, byteLength: number): boolean {
		if (
			bufferId >= VDP_RPU_BUFFER_CAPACITY
			|| this.bufferDefined[bufferId] === 0
			|| !this.acceptBufferRange(bufferId, dstByteOffset, byteLength)
			|| !this.memory.isReadableMainMemoryRange(srcAddr, byteLength)
		) {
			this.fault.raise(VDP_FAULT_RPU_BUFFER_OOB, bufferId);
			return false;
		}
		if (!this.memory.readBytesInto(srcAddr, this.bufferBytes, byteLength, this.bufferByteBase(bufferId) + dstByteOffset)) {
			this.fault.raise(VDP_FAULT_RPU_BUFFER_OOB, srcAddr);
			return false;
		}
		this.bufferRevision[bufferId] = (this.bufferRevision[bufferId] + 1) >>> 0;
		this.lastPacketCost = rpuUploadCost(byteLength);
		return true;
	}

	private acceptBufferUploadInlineFromMemory(cursor: number, payloadWords: number): boolean {
		if (payloadWords < VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, payloadWords);
			return false;
		}
		const bufferId = this.memory.readU32(cursor + IO_WORD_SIZE);
		const dstByteOffset = this.memory.readU32(cursor + IO_WORD_SIZE * 2);
		const byteLength = this.memory.readU32(cursor + IO_WORD_SIZE * 3);
		const dataWords = (byteLength + 3) >>> 2;
		if (payloadWords !== VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS + dataWords) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, payloadWords);
			return false;
		}
		if (!this.acceptBufferRange(bufferId, dstByteOffset, byteLength)) {
			this.fault.raise(VDP_FAULT_RPU_BUFFER_OOB, bufferId);
			return false;
		}
		for (let index = 0; index < dataWords; index += 1) {
			this.writeInlineBufferWord(this.bufferByteBase(bufferId) + dstByteOffset, index, this.memory.readU32(cursor + IO_WORD_SIZE * (VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS + index)), byteLength);
		}
		this.bufferRevision[bufferId] = (this.bufferRevision[bufferId] + 1) >>> 0;
		this.lastPacketCost = rpuUploadCost(byteLength);
		return true;
	}

	private acceptBufferUploadInlineFromWords(words: Uint32Array, cursor: number, payloadWords: number): boolean {
		if (payloadWords < VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, payloadWords);
			return false;
		}
		const bufferId = words[cursor + 1];
		const dstByteOffset = words[cursor + 2];
		const byteLength = words[cursor + 3];
		const dataWords = (byteLength + 3) >>> 2;
		if (payloadWords !== VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS + dataWords) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, payloadWords);
			return false;
		}
		if (!this.acceptBufferRange(bufferId, dstByteOffset, byteLength)) {
			this.fault.raise(VDP_FAULT_RPU_BUFFER_OOB, bufferId);
			return false;
		}
		for (let index = 0; index < dataWords; index += 1) {
			this.writeInlineBufferWord(this.bufferByteBase(bufferId) + dstByteOffset, index, words[cursor + VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS + index], byteLength);
		}
		this.bufferRevision[bufferId] = (this.bufferRevision[bufferId] + 1) >>> 0;
		this.lastPacketCost = rpuUploadCost(byteLength);
		return true;
	}

	private writeInlineBufferWord(dstByteOffset: number, wordIndex: number, word: number, byteLength: number): void {
		const byteBase = wordIndex << 2;
		const dst = dstByteOffset + byteBase;
		if (byteBase < byteLength) {
			this.bufferBytes[dst] = word & 0xff;
		}
		if (byteBase + 1 < byteLength) {
			this.bufferBytes[dst + 1] = (word >>> 8) & 0xff;
		}
		if (byteBase + 2 < byteLength) {
			this.bufferBytes[dst + 2] = (word >>> 16) & 0xff;
		}
		if (byteBase + 3 < byteLength) {
			this.bufferBytes[dst + 3] = (word >>> 24) & 0xff;
		}
	}

	private acceptBufferDiscard(bufferId: number): boolean {
		if (bufferId >= VDP_RPU_BUFFER_CAPACITY) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, bufferId);
			return false;
		}
		this.bufferDefined[bufferId] = 0;
		this.bufferRevision[bufferId] = (this.bufferRevision[bufferId] + 1) >>> 0;
		this.bufferByteLength[bufferId] = 0;
		this.bufferUsage[bufferId] = 0;
		this.lastPacketCost = VDP_RPU_DISCARD_COST;
		return true;
	}

	private acceptSurfaceDefine(surfaceId: number, widthHeight: number, formatUsage: number): boolean {
		const width = packedLow16(widthHeight);
		const height = packedHigh16(widthHeight);
		const format = formatUsage & VDP_RPU_FORMAT_MASK;
		const usage = (formatUsage >>> VDP_RPU_USAGE_SHIFT) & 0xff;
		if (surfaceId >= VDP_RPU_SURFACE_CAPACITY || width === 0 || height === 0) {
			this.fault.raise(VDP_FAULT_RPU_BAD_SURFACE_USAGE, surfaceId);
			return false;
		}
		this.surfaceDefined[surfaceId] = 1;
		this.surfaceRevision[surfaceId] = (this.surfaceRevision[surfaceId] + 1) >>> 0;
		this.surfaceWidth[surfaceId] = width;
		this.surfaceHeight[surfaceId] = height;
		this.surfaceFormat[surfaceId] = format;
		this.surfaceUsage[surfaceId] = usage;
		this.lastPacketCost = VDP_RPU_RESOURCE_COST;
		return true;
	}

	private acceptConstantBankDefine(frame: VdpRpuFrameOutput, bankId: number, firstWord: number, wordCount: number): boolean {
		if (bankId >= VDP_RPU_CONSTANT_BANK_CAPACITY || wordCount > VDP_RPU_CONSTANT_WORD_CAPACITY || firstWord > VDP_RPU_CONSTANT_WORD_CAPACITY - wordCount) {
			this.fault.raise(VDP_FAULT_RPU_BAD_CONSTANT_RANGE, bankId);
			return false;
		}
		const banks = frame.resources.constantBanks;
		banks.firstWord[bankId] = firstWord >>> 0;
		banks.wordCount[bankId] = wordCount;
		banks.epoch[bankId] = (banks.epoch[bankId] + 1) >>> 0;
		if (bankId + 1 > banks.length) {
			banks.length = bankId + 1;
		}
		this.lastPacketCost = VDP_RPU_RESOURCE_COST;
		return true;
	}

	private acceptConstantUploadDma(frame: VdpRpuFrameOutput, bankId: number, dstWordOffset: number, srcAddr: number, wordCount: number): boolean {
		if (!this.acceptConstantRange(frame, bankId, dstWordOffset, wordCount) || !this.memory.isReadableMainMemoryRange(srcAddr, wordCount * IO_WORD_SIZE)) {
			this.fault.raise(VDP_FAULT_RPU_BAD_CONSTANT_RANGE, bankId);
			return false;
		}
		const firstWord = frame.resources.constantBanks.firstWord[bankId] + dstWordOffset;
		for (let index = 0; index < wordCount; index += 1) {
			frame.resources.constantWords[firstWord + index] = this.memory.readU32(srcAddr + index * IO_WORD_SIZE);
		}
		frame.resources.constantBanks.epoch[bankId] = (frame.resources.constantBanks.epoch[bankId] + 1) >>> 0;
		this.lastPacketCost = rpuUploadCost(wordCount * IO_WORD_SIZE);
		return true;
	}

	private acceptConstantUploadInlineFromMemory(frame: VdpRpuFrameOutput, cursor: number, payloadWords: number): boolean {
		if (payloadWords < VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, payloadWords);
			return false;
		}
		const bankId = this.memory.readU32(cursor + IO_WORD_SIZE);
		const dstWordOffset = this.memory.readU32(cursor + IO_WORD_SIZE * 2);
		const wordCount = this.memory.readU32(cursor + IO_WORD_SIZE * 3);
		if (payloadWords !== VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS + wordCount || !this.acceptConstantRange(frame, bankId, dstWordOffset, wordCount)) {
			this.fault.raise(VDP_FAULT_RPU_BAD_CONSTANT_RANGE, bankId);
			return false;
		}
		const firstWord = frame.resources.constantBanks.firstWord[bankId] + dstWordOffset;
		for (let index = 0; index < wordCount; index += 1) {
			frame.resources.constantWords[firstWord + index] = this.memory.readU32(cursor + IO_WORD_SIZE * (VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS + index));
		}
		frame.resources.constantBanks.epoch[bankId] = (frame.resources.constantBanks.epoch[bankId] + 1) >>> 0;
		this.lastPacketCost = rpuUploadCost(wordCount * IO_WORD_SIZE);
		return true;
	}

	private acceptConstantUploadInlineFromWords(frame: VdpRpuFrameOutput, words: Uint32Array, cursor: number, payloadWords: number): boolean {
		if (payloadWords < VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, payloadWords);
			return false;
		}
		const bankId = words[cursor + 1];
		const dstWordOffset = words[cursor + 2];
		const wordCount = words[cursor + 3];
		if (payloadWords !== VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS + wordCount || !this.acceptConstantRange(frame, bankId, dstWordOffset, wordCount)) {
			this.fault.raise(VDP_FAULT_RPU_BAD_CONSTANT_RANGE, bankId);
			return false;
		}
		const firstWord = frame.resources.constantBanks.firstWord[bankId] + dstWordOffset;
		for (let index = 0; index < wordCount; index += 1) {
			frame.resources.constantWords[firstWord + index] = words[cursor + VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS + index];
		}
		frame.resources.constantBanks.epoch[bankId] = (frame.resources.constantBanks.epoch[bankId] + 1) >>> 0;
		this.lastPacketCost = rpuUploadCost(wordCount * IO_WORD_SIZE);
		return true;
	}

	private acceptConstantUploadDevice(frame: VdpRpuFrameOutput, bankId: number, dstWordOffset: number, sourceWord: number, sourceWordOffset: number, wordCount: number): boolean {
		const source = sourceWord & VDP_RPU_CONSTANT_SOURCE_MASK;
		let sourceWords = this.xfMatrixWords;
		let convertQ16 = true;
		switch (source) {
			case VDP_RPU_CONSTANT_SOURCE_XF_Q16:
				break;
			case VDP_RPU_CONSTANT_SOURCE_LPU_RAW:
				sourceWords = this.lightRegisterWords;
				convertQ16 = false;
				break;
			case VDP_RPU_CONSTANT_SOURCE_MFU_Q16:
				sourceWords = this.morphWeightWords;
				break;
			case VDP_RPU_CONSTANT_SOURCE_JTU_Q16:
				sourceWords = this.jointMatrixWords;
				break;
		}
		if (
			!this.acceptConstantRange(frame, bankId, dstWordOffset, wordCount)
			|| wordCount > sourceWords.length
			|| sourceWordOffset > sourceWords.length - wordCount
		) {
			this.fault.raise(VDP_FAULT_RPU_BAD_CONSTANT_RANGE, bankId);
			return false;
		}
		const firstWord = frame.resources.constantBanks.firstWord[bankId] + dstWordOffset;
		for (let index = 0; index < wordCount; index += 1) {
			const word = sourceWords[sourceWordOffset + index];
			frame.resources.constantWords[firstWord + index] = convertQ16 ? this.encodeDeviceQ16WordAsF32Word(word) : word;
		}
		frame.resources.constantBanks.epoch[bankId] = (frame.resources.constantBanks.epoch[bankId] + 1) >>> 0;
		this.lastPacketCost = rpuUploadCost(wordCount * IO_WORD_SIZE);
		return true;
	}

	private encodeDeviceQ16WordAsF32Word(word: number): number {
		this.deviceConstantFloatScratch[0] = decodeSignedQ16_16(word);
		return this.deviceConstantWordScratch[0];
	}

	private acceptConstantRange(frame: VdpRpuFrameOutput, bankId: number, firstWord: number, wordCount: number): boolean {
		return bankId < frame.resources.constantBanks.length
			&& wordCount <= frame.resources.constantBanks.wordCount[bankId]
			&& firstWord <= frame.resources.constantBanks.wordCount[bankId] - wordCount;
	}

	private acceptBeginPass(frame: VdpRpuFrameOutput, colorSurfaceId: number, depthSurfaceId: number, viewportXY: number, viewportWH: number, passOps: number, clearColor: number, clearDepthWord: number): boolean {
		if (this.buildState !== VDP_RPU_FRAME_OPEN || frame.commands.passCount >= VDP_RPU_PASS_CAPACITY) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, passOps);
			return false;
		}
		const colorRef = this.pinSurface(frame, colorSurfaceId);
		const depthRef = this.pinSurface(frame, depthSurfaceId);
		const passIndex = frame.commands.passCount;
		frame.commands.passFirstDraw[passIndex] = frame.commands.drawCount;
		frame.commands.passDrawCount[passIndex] = 0;
		frame.commands.passFirstBatch[passIndex] = frame.commands.drawBatchCount;
		frame.commands.passBatchCount[passIndex] = 0;
		frame.commands.passColorSurfaceRef[passIndex] = colorRef;
		frame.commands.passDepthSurfaceRef[passIndex] = depthRef;
		frame.commands.passViewportXY[passIndex] = viewportXY >>> 0;
		frame.commands.passViewportWH[passIndex] = viewportWH >>> 0;
		frame.commands.passOps[passIndex] = passOps >>> 0;
		frame.commands.passClearColor[passIndex] = clearColor >>> 0;
		frame.commands.passClearDepthWord[passIndex] = clearDepthWord >>> 0;
		frame.commands.passCount += 1;
		this.openPassIndex = passIndex;
		this.buildState = VDP_RPU_PASS_OPEN;
		this.lastPacketCost = VDP_RPU_PASS_COST;
		return true;
	}

	private acceptEndPass(frame: VdpRpuFrameOutput): boolean {
		if (this.buildState !== VDP_RPU_PASS_OPEN) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, this.buildState);
			return false;
		}
		frame.commands.passDrawCount[this.openPassIndex] = frame.commands.drawCount - frame.commands.passFirstDraw[this.openPassIndex];
		frame.commands.passBatchCount[this.openPassIndex] = frame.commands.drawBatchCount - frame.commands.passFirstBatch[this.openPassIndex];
		this.buildState = VDP_RPU_FRAME_OPEN;
		this.lastPacketCost = VDP_RPU_PACKET_COST;
		return true;
	}

	private acceptBeginDraw(frame: VdpRpuFrameOutput, shaderVariantWord: number, primitiveIndexType: number, pipelineWord: number, vertexCount: number, instanceCount: number, indexBufferId: number, indexByteOffset: number, indexCount: number): boolean {
		if (this.buildState !== VDP_RPU_PASS_OPEN || frame.commands.drawCount >= VDP_RPU_DRAW_CAPACITY) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, this.buildState);
			return false;
		}
		const shaderVariant = shaderVariantWord & VDP_RPU_SHADER_VARIANT_MASK;
		const primitive = primitiveIndexType & VDP_RPU_DRAW_PRIMITIVE_MASK;
		const indexType = (primitiveIndexType & VDP_RPU_DRAW_INDEX_TYPE_MASK) >>> VDP_RPU_DRAW_INDEX_TYPE_SHIFT;
		let indexRef = VDP_RPU_REF_NONE;
		if (indexType !== VDP_RPU_INDEX_NONE) {
			const indexBytes = indexType === VDP_RPU_INDEX_U16 ? 2 : 4;
			const indexByteLength = (indexCount * indexBytes) >>> 0;
			indexRef = this.pinBuffer(frame, indexBufferId, indexByteOffset, indexByteLength, VDP_RPU_BUFFER_USAGE_INDEX);
		}
		const drawIndex = frame.commands.drawCount;
		frame.commands.drawShaderVariant[drawIndex] = shaderVariant;
		frame.commands.drawPrimitive[drawIndex] = primitive;
		frame.commands.drawPipelineWord[drawIndex] = pipelineWord >>> 0;
		frame.commands.drawVertexCount[drawIndex] = vertexCount >>> 0;
		frame.commands.drawInstanceCount[drawIndex] = instanceCount >>> 0;
		frame.commands.drawIndexBufferRef[drawIndex] = indexRef;
		frame.commands.drawIndexByteOffset[drawIndex] = indexByteOffset >>> 0;
		frame.commands.drawIndexCount[drawIndex] = indexCount >>> 0;
		frame.commands.drawIndexType[drawIndex] = indexType;
		frame.commands.drawFirstStreamBinding[drawIndex] = frame.commands.streamBindingCount;
		frame.commands.drawStreamBindingCount[drawIndex] = 0;
		frame.commands.drawFirstConstantBinding[drawIndex] = frame.commands.constantBindingCount;
		frame.commands.drawConstantBindingCount[drawIndex] = 0;
		frame.commands.drawFirstTextureBinding[drawIndex] = frame.commands.textureBindingCount;
		frame.commands.drawTextureBindingCount[drawIndex] = 0;
		frame.commands.drawCount += 1;
		this.openDrawIndex = drawIndex;
		this.buildState = VDP_RPU_DRAW_OPEN;
		this.lastPacketCost = rpuDrawCost(vertexCount, instanceCount, indexCount);
		return true;
	}

	private acceptEndDraw(frame: VdpRpuFrameOutput): boolean {
		if (this.buildState !== VDP_RPU_DRAW_OPEN) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, this.buildState);
			return false;
		}
		const drawIndex = this.openDrawIndex;
		frame.commands.drawStreamBindingCount[drawIndex] = frame.commands.streamBindingCount - frame.commands.drawFirstStreamBinding[drawIndex];
		frame.commands.drawConstantBindingCount[drawIndex] = frame.commands.constantBindingCount - frame.commands.drawFirstConstantBinding[drawIndex];
		frame.commands.drawTextureBindingCount[drawIndex] = frame.commands.textureBindingCount - frame.commands.drawFirstTextureBinding[drawIndex];
		if (!this.recordDrawBatch(frame, drawIndex)) {
			return false;
		}
		this.buildState = VDP_RPU_PASS_OPEN;
		this.lastPacketCost = VDP_RPU_PACKET_COST;
		return true;
	}

	private recordDrawBatch(frame: VdpRpuFrameOutput, drawIndex: number): boolean {
		const commands = frame.commands;
		if (commands.drawBatchCount > commands.passFirstBatch[this.openPassIndex]) {
			const batchIndex = commands.drawBatchCount - 1;
			if (this.canMergeDrawIntoBatch(commands, batchIndex, drawIndex)) {
				commands.batchDrawCount[batchIndex] += 1;
				if (commands.drawIndexType[drawIndex] === VDP_RPU_INDEX_NONE) {
					const shaderVariant = resolveVdpRpuShaderVariantSpec(commands.drawShaderVariant[drawIndex]);
					if (shaderVariant.instanceMode === VDP_RPU_INSTANCE_MODE_NONE) {
						commands.batchVertexCount[batchIndex] = (commands.batchVertexCount[batchIndex] + commands.drawVertexCount[drawIndex]) >>> 0;
					} else {
						commands.batchInstanceCount[batchIndex] = (commands.batchInstanceCount[batchIndex] + commands.drawInstanceCount[drawIndex]) >>> 0;
					}
				} else {
					const shaderVariant = resolveVdpRpuShaderVariantSpec(commands.drawShaderVariant[drawIndex]);
					if (shaderVariant.instanceMode === VDP_RPU_INSTANCE_MODE_NONE) {
						commands.batchIndexCount[batchIndex] = (commands.batchIndexCount[batchIndex] + commands.drawIndexCount[drawIndex]) >>> 0;
					} else {
						commands.batchInstanceCount[batchIndex] = (commands.batchInstanceCount[batchIndex] + commands.drawInstanceCount[drawIndex]) >>> 0;
					}
				}
				return true;
			}
		}
		if (commands.drawBatchCount >= VDP_RPU_DRAW_BATCH_CAPACITY) {
			this.fault.raise(VDP_FAULT_RPU_COMMAND_OVERFLOW, drawIndex);
			return false;
		}
		const batchIndex = commands.drawBatchCount;
		commands.batchFirstDraw[batchIndex] = drawIndex;
		commands.batchDrawCount[batchIndex] = 1;
		commands.batchVertexCount[batchIndex] = commands.drawVertexCount[drawIndex];
		commands.batchInstanceCount[batchIndex] = commands.drawInstanceCount[drawIndex];
		commands.batchIndexCount[batchIndex] = commands.drawIndexCount[drawIndex];
		commands.drawBatchCount += 1;
		return true;
	}

	private canMergeDrawIntoBatch(commands: VdpRpuCommandBuffer, batchIndex: number, drawIndex: number): boolean {
		const firstDraw = commands.batchFirstDraw[batchIndex];
		if (commands.drawPrimitive[firstDraw] === VDP_RPU_PRIM_TRIANGLE_STRIP) {
			return false;
		}
		if (
			commands.drawShaderVariant[firstDraw] !== commands.drawShaderVariant[drawIndex]
			|| commands.drawPrimitive[firstDraw] !== commands.drawPrimitive[drawIndex]
			|| commands.drawPipelineWord[firstDraw] !== commands.drawPipelineWord[drawIndex]
			|| commands.drawIndexType[firstDraw] !== commands.drawIndexType[drawIndex]
			|| commands.drawIndexBufferRef[firstDraw] !== commands.drawIndexBufferRef[drawIndex]
			|| !this.sameDrawConstants(commands, firstDraw, drawIndex)
			|| !this.sameDrawTextures(commands, firstDraw, drawIndex)
			|| !this.compatibleDrawStreams(commands, batchIndex, drawIndex)
		) {
			return false;
		}
		const shaderVariant = resolveVdpRpuShaderVariantSpec(commands.drawShaderVariant[firstDraw]);
		if (shaderVariant.instanceMode === VDP_RPU_INSTANCE_MODE_NONE) {
			const batchElementCount = commands.drawIndexType[firstDraw] === VDP_RPU_INDEX_NONE ? commands.batchVertexCount[batchIndex] : commands.batchIndexCount[batchIndex];
			const drawElementCount = commands.drawIndexType[firstDraw] === VDP_RPU_INDEX_NONE ? commands.drawVertexCount[drawIndex] : commands.drawIndexCount[drawIndex];
			if (commands.drawPrimitive[firstDraw] === VDP_RPU_PRIM_LINES) {
				if (((batchElementCount | drawElementCount) & 1) !== 0) {
					return false;
				}
			} else if (commands.drawPrimitive[firstDraw] === VDP_RPU_PRIM_TRIANGLES && (batchElementCount % 3 !== 0 || drawElementCount % 3 !== 0)) {
				return false;
			}
		}
		if (commands.drawIndexType[firstDraw] === VDP_RPU_INDEX_NONE) {
			if (shaderVariant.instanceMode === VDP_RPU_INSTANCE_MODE_NONE) {
				return this.streamOffsetIsBatchTail(commands, batchIndex, drawIndex, 0, commands.batchVertexCount[batchIndex]);
			}
			return commands.drawVertexCount[firstDraw] === commands.drawVertexCount[drawIndex]
				&& this.streamOffsetMatchesBatchHead(commands, batchIndex, drawIndex, 0)
				&& this.streamOffsetIsBatchTail(commands, batchIndex, drawIndex, 1, commands.batchInstanceCount[batchIndex]);
		}
		if (shaderVariant.instanceMode === VDP_RPU_INSTANCE_MODE_NONE) {
			const indexBytes = commands.drawIndexType[firstDraw] === VDP_RPU_INDEX_U16 ? 2 : 4;
			return commands.drawIndexByteOffset[drawIndex] === commands.drawIndexByteOffset[firstDraw] + commands.batchIndexCount[batchIndex] * indexBytes
				&& this.streamOffsetMatchesBatchHead(commands, batchIndex, drawIndex, 0);
		}
		return commands.drawIndexByteOffset[drawIndex] === commands.drawIndexByteOffset[firstDraw]
			&& commands.drawIndexCount[drawIndex] === commands.drawIndexCount[firstDraw]
			&& commands.drawVertexCount[drawIndex] === commands.drawVertexCount[firstDraw]
			&& this.streamOffsetMatchesBatchHead(commands, batchIndex, drawIndex, 0)
			&& this.streamOffsetIsBatchTail(commands, batchIndex, drawIndex, 1, commands.batchInstanceCount[batchIndex]);
	}

	private sameDrawConstants(commands: VdpRpuCommandBuffer, leftDraw: number, rightDraw: number): boolean {
		const leftCount = commands.drawConstantBindingCount[leftDraw];
		if (leftCount !== commands.drawConstantBindingCount[rightDraw]) {
			return false;
		}
		const leftFirst = commands.drawFirstConstantBinding[leftDraw];
		const rightFirst = commands.drawFirstConstantBinding[rightDraw];
		for (let offset = 0; offset < leftCount; offset += 1) {
			const left = leftFirst + offset;
			const right = rightFirst + offset;
			if (
				commands.constantBindingSlot[left] !== commands.constantBindingSlot[right]
				|| commands.constantBank[left] !== commands.constantBank[right]
				|| commands.constantFirstWord[left] !== commands.constantFirstWord[right]
				|| commands.constantWordCount[left] !== commands.constantWordCount[right]
			) {
				return false;
			}
		}
		return true;
	}

	private sameDrawTextures(commands: VdpRpuCommandBuffer, leftDraw: number, rightDraw: number): boolean {
		const leftCount = commands.drawTextureBindingCount[leftDraw];
		if (leftCount !== commands.drawTextureBindingCount[rightDraw]) {
			return false;
		}
		const leftFirst = commands.drawFirstTextureBinding[leftDraw];
		const rightFirst = commands.drawFirstTextureBinding[rightDraw];
		for (let offset = 0; offset < leftCount; offset += 1) {
			const left = leftFirst + offset;
			const right = rightFirst + offset;
			if (
				commands.textureSlot[left] !== commands.textureSlot[right]
				|| commands.textureSurfaceRef[left] !== commands.textureSurfaceRef[right]
			) {
				return false;
			}
		}
		return true;
	}

	private compatibleDrawStreams(commands: VdpRpuCommandBuffer, batchIndex: number, drawIndex: number): boolean {
		const firstDraw = commands.batchFirstDraw[batchIndex];
		const firstCount = commands.drawStreamBindingCount[firstDraw];
		if (firstCount !== commands.drawStreamBindingCount[drawIndex]) {
			return false;
		}
		const firstBinding = commands.drawFirstStreamBinding[firstDraw];
		const drawBinding = commands.drawFirstStreamBinding[drawIndex];
		for (let offset = 0; offset < firstCount; offset += 1) {
			const left = firstBinding + offset;
			const right = drawBinding + offset;
			if (
				commands.streamSlot[left] !== commands.streamSlot[right]
				|| commands.streamLayoutId[left] !== commands.streamLayoutId[right]
				|| commands.streamBufferRef[left] !== commands.streamBufferRef[right]
				|| commands.streamStepRate[left] !== commands.streamStepRate[right]
			) {
				return false;
			}
		}
		return true;
	}

	private drawStreamBinding(commands: VdpRpuCommandBuffer, drawIndex: number, streamSlot: number): number {
		const bindingEnd = commands.drawFirstStreamBinding[drawIndex] + commands.drawStreamBindingCount[drawIndex];
		for (let bindingIndex = commands.drawFirstStreamBinding[drawIndex]; bindingIndex < bindingEnd; bindingIndex += 1) {
			if (commands.streamSlot[bindingIndex] === streamSlot) {
				return bindingIndex;
			}
		}
		return VDP_RPU_REF_NONE;
	}

	private streamOffsetMatchesBatchHead(commands: VdpRpuCommandBuffer, batchIndex: number, drawIndex: number, streamSlot: number): boolean {
		const firstBinding = this.drawStreamBinding(commands, commands.batchFirstDraw[batchIndex], streamSlot);
		const drawBinding = this.drawStreamBinding(commands, drawIndex, streamSlot);
		if (firstBinding === VDP_RPU_REF_NONE || drawBinding === VDP_RPU_REF_NONE) {
			return firstBinding === drawBinding;
		}
		return commands.streamByteOffset[firstBinding] === commands.streamByteOffset[drawBinding];
	}

	private streamOffsetIsBatchTail(commands: VdpRpuCommandBuffer, batchIndex: number, drawIndex: number, streamSlot: number, elementCount: number): boolean {
		const firstBinding = this.drawStreamBinding(commands, commands.batchFirstDraw[batchIndex], streamSlot);
		const drawBinding = this.drawStreamBinding(commands, drawIndex, streamSlot);
		if (firstBinding === VDP_RPU_REF_NONE || drawBinding === VDP_RPU_REF_NONE) {
			return false;
		}
		const stride = this.streamLayoutStride(commands.streamLayoutId[firstBinding]);
		return commands.streamByteOffset[drawBinding] === commands.streamByteOffset[firstBinding] + elementCount * stride;
	}

	private acceptBindStream(frame: VdpRpuFrameOutput, streamSlot: number, layoutId: number, bufferId: number, byteOffset: number, stepRate: number): boolean {
		if (this.buildState !== VDP_RPU_DRAW_OPEN || frame.commands.streamBindingCount >= VDP_RPU_STREAM_BINDING_CAPACITY) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STREAM_LAYOUT, layoutId);
			return false;
		}
		const drawIndex = this.openDrawIndex;
		const elementCount = stepRate === 0 ? frame.commands.drawVertexCount[drawIndex] : frame.commands.drawInstanceCount[drawIndex];
		const byteStride = this.streamLayoutStride(layoutId);
		const byteLength = (elementCount * byteStride) >>> 0;
		const bufferRef = this.pinBuffer(frame, bufferId, byteOffset, byteLength, VDP_RPU_BUFFER_USAGE_VERTEX);
		const bindingIndex = frame.commands.streamBindingCount;
		frame.commands.streamLayoutId[bindingIndex] = layoutId;
		frame.commands.streamSlot[bindingIndex] = streamSlot;
		frame.commands.streamBufferRef[bindingIndex] = bufferRef;
		frame.commands.streamByteOffset[bindingIndex] = byteOffset >>> 0;
		frame.commands.streamStepRate[bindingIndex] = stepRate;
		frame.commands.streamBindingCount += 1;
		this.lastPacketCost = VDP_RPU_BIND_COST;
		return true;
	}

	private acceptBindConstants(frame: VdpRpuFrameOutput, bindingSlot: number, bankId: number, firstWord: number, wordCount: number): boolean {
		if (this.buildState !== VDP_RPU_DRAW_OPEN || frame.commands.constantBindingCount >= VDP_RPU_CONSTANT_BINDING_CAPACITY) {
			this.fault.raise(VDP_FAULT_RPU_BAD_CONSTANT_RANGE, bankId);
			return false;
		}
		let boundBankId = bankId;
		let boundFirstWord = firstWord;
		let boundWordCount = wordCount;
		if (!this.acceptConstantRange(frame, bankId, firstWord, wordCount)) {
			boundBankId = VDP_RPU_REF_NONE;
			boundFirstWord = 0;
			boundWordCount = 0;
		}
		const bindingIndex = frame.commands.constantBindingCount;
		frame.commands.constantBindingSlot[bindingIndex] = bindingSlot;
		frame.commands.constantBank[bindingIndex] = boundBankId;
		frame.commands.constantFirstWord[bindingIndex] = boundFirstWord;
		frame.commands.constantWordCount[bindingIndex] = boundWordCount;
		frame.commands.constantBindingCount += 1;
		this.lastPacketCost = VDP_RPU_BIND_COST;
		return true;
	}

	private acceptBindTexture(frame: VdpRpuFrameOutput, textureSlot: number, surfaceId: number): boolean {
		if (this.buildState !== VDP_RPU_DRAW_OPEN || frame.commands.textureBindingCount >= VDP_RPU_TEXTURE_BINDING_CAPACITY) {
			this.fault.raise(VDP_FAULT_RPU_BAD_SURFACE_USAGE, surfaceId);
			return false;
		}
		const surfaceRef = this.pinSurface(frame, surfaceId);
		const bindingIndex = frame.commands.textureBindingCount;
		frame.commands.textureSlot[bindingIndex] = textureSlot;
		frame.commands.textureSurfaceRef[bindingIndex] = surfaceRef;
		frame.commands.textureBindingCount += 1;
		this.lastPacketCost = VDP_RPU_BIND_COST;
		return true;
	}

	private pinBuffer(frame: VdpRpuFrameOutput, bufferId: number, byteOffset: number, byteLength: number, usage: number): number {
		if (!this.acceptBufferRange(bufferId, byteOffset, byteLength) || byteLength > VDP_RPU_FRAME_BUFFER_BYTE_CAPACITY) {
			return VDP_RPU_REF_NONE;
		}
		const refs = frame.resources.bufferRefs;
		const revision = this.bufferRevision[bufferId];
		const bufferOffset = this.bufferByteBase(bufferId);
		const requestEnd = (byteOffset + byteLength) >>> 0;
		const snapshotByteLimit = VDP_RPU_FRAME_BUFFER_BYTE_CAPACITY - byteLength;
		for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
			if (refs.bufferId[refIndex] === bufferId && refs.revision[refIndex] === revision && refs.usage[refIndex] === usage) {
				const sourceByteOffset = refs.sourceByteOffset[refIndex];
				const sourceByteEnd = (sourceByteOffset + refs.byteLength[refIndex]) >>> 0;
				if (byteOffset >= sourceByteOffset && requestEnd <= sourceByteEnd) {
					return refIndex;
				}
				if (byteOffset === sourceByteEnd) {
					if (refs.snapshotByteLength > snapshotByteLimit) {
						return VDP_RPU_REF_NONE;
					}
					const snapshotOffset = refs.byteOffset[refIndex] + refs.byteLength[refIndex];
					for (let index = 0; index < byteLength; index += 1) {
						refs.snapshotBytes[snapshotOffset + index] = this.bufferBytes[bufferOffset + byteOffset + index];
					}
					refs.byteLength[refIndex] = (refs.byteLength[refIndex] + byteLength) >>> 0;
					refs.snapshotByteLength += byteLength;
					return refIndex;
				}
			}
		}
		if (refs.length >= VDP_RPU_BUFFER_REF_CAPACITY) {
			return VDP_RPU_REF_NONE;
		}
		if (refs.snapshotByteLength > snapshotByteLimit) {
			return VDP_RPU_REF_NONE;
		}
		const snapshotOffset = refs.snapshotByteLength;
		for (let index = 0; index < byteLength; index += 1) {
			refs.snapshotBytes[snapshotOffset + index] = this.bufferBytes[bufferOffset + byteOffset + index];
		}
		const refIndex = refs.length;
		refs.bufferId[refIndex] = bufferId;
		refs.revision[refIndex] = revision;
		refs.sourceByteOffset[refIndex] = byteOffset;
		refs.byteOffset[refIndex] = snapshotOffset;
		refs.byteLength[refIndex] = byteLength;
		refs.usage[refIndex] = usage;
		refs.bytes[refIndex] = refs.snapshotBytes;
		refs.length += 1;
		refs.snapshotByteLength += byteLength;
		return refIndex;
	}

	private bufferByteBase(bufferId: number): number {
		return bufferId * VDP_RPU_BUFFER_SLOT_BYTE_CAPACITY;
	}

	private acceptBufferRange(bufferId: number, byteOffset: number, byteLength: number): boolean {
		return bufferId < VDP_RPU_BUFFER_CAPACITY
			&& this.bufferDefined[bufferId] !== 0
			&& byteLength <= this.bufferByteLength[bufferId]
			&& byteOffset <= this.bufferByteLength[bufferId] - byteLength;
	}

	private pinSurface(frame: VdpRpuFrameOutput, surfaceId: number): number {
		if (surfaceId === VDP_RPU_RESOURCE_NONE) {
			return VDP_RPU_REF_NONE;
		}
		if (frame.resources.surfaceRefs.length >= VDP_RPU_SURFACE_REF_CAPACITY || surfaceId >= VDP_RPU_SURFACE_CAPACITY || this.surfaceDefined[surfaceId] === 0) {
			return VDP_RPU_REF_NONE;
		}
		const refIndex = frame.resources.surfaceRefs.length;
		frame.resources.surfaceRefs.surfaceId[refIndex] = surfaceId;
		frame.resources.surfaceRefs.revision[refIndex] = this.surfaceRevision[surfaceId];
		frame.resources.surfaceRefs.width[refIndex] = this.surfaceWidth[surfaceId];
		frame.resources.surfaceRefs.height[refIndex] = this.surfaceHeight[surfaceId];
		frame.resources.surfaceRefs.format[refIndex] = this.surfaceFormat[surfaceId];
		frame.resources.surfaceRefs.usage[refIndex] = this.surfaceUsage[surfaceId];
		frame.resources.surfaceRefs.length += 1;
		return refIndex;
	}

	private streamLayoutStride(layoutId: number): number {
		return resolveVdpRpuStreamLayoutSpec(layoutId).byteStride;
	}
}

type VdpRpuSaveArray = Uint32Array | Uint16Array | Uint8Array;

function captureVdpRpuArrayState(source: VdpRpuSaveArray, length: number): number[] {
	const state: number[] = [];
	for (let index = 0; index < length; index += 1) {
		state[index] = source[index];
	}
	return state;
}

function restoreVdpRpuArrayState(target: VdpRpuSaveArray, state: number[]): void {
	for (let index = 0; index < state.length; index += 1) {
		target[index] = state[index];
	}
}

function captureVdpRpuCommandBufferState(commands: VdpRpuCommandBuffer): VdpRpuCommandBufferSaveState {
	return {
		passCount: commands.passCount,
		drawCount: commands.drawCount,
		drawBatchCount: commands.drawBatchCount,
		streamBindingCount: commands.streamBindingCount,
		constantBindingCount: commands.constantBindingCount,
		textureBindingCount: commands.textureBindingCount,
		passFirstDraw: captureVdpRpuArrayState(commands.passFirstDraw, commands.passCount),
		passDrawCount: captureVdpRpuArrayState(commands.passDrawCount, commands.passCount),
		passFirstBatch: captureVdpRpuArrayState(commands.passFirstBatch, commands.passCount),
		passBatchCount: captureVdpRpuArrayState(commands.passBatchCount, commands.passCount),
		passColorSurfaceRef: captureVdpRpuArrayState(commands.passColorSurfaceRef, commands.passCount),
		passDepthSurfaceRef: captureVdpRpuArrayState(commands.passDepthSurfaceRef, commands.passCount),
		passViewportXY: captureVdpRpuArrayState(commands.passViewportXY, commands.passCount),
		passViewportWH: captureVdpRpuArrayState(commands.passViewportWH, commands.passCount),
		passOps: captureVdpRpuArrayState(commands.passOps, commands.passCount),
		passClearColor: captureVdpRpuArrayState(commands.passClearColor, commands.passCount),
		passClearDepthWord: captureVdpRpuArrayState(commands.passClearDepthWord, commands.passCount),
		drawShaderVariant: captureVdpRpuArrayState(commands.drawShaderVariant, commands.drawCount),
		drawPrimitive: captureVdpRpuArrayState(commands.drawPrimitive, commands.drawCount),
		drawPipelineWord: captureVdpRpuArrayState(commands.drawPipelineWord, commands.drawCount),
		drawVertexCount: captureVdpRpuArrayState(commands.drawVertexCount, commands.drawCount),
		drawInstanceCount: captureVdpRpuArrayState(commands.drawInstanceCount, commands.drawCount),
		drawIndexBufferRef: captureVdpRpuArrayState(commands.drawIndexBufferRef, commands.drawCount),
		drawIndexByteOffset: captureVdpRpuArrayState(commands.drawIndexByteOffset, commands.drawCount),
		drawIndexCount: captureVdpRpuArrayState(commands.drawIndexCount, commands.drawCount),
		drawIndexType: captureVdpRpuArrayState(commands.drawIndexType, commands.drawCount),
		drawFirstStreamBinding: captureVdpRpuArrayState(commands.drawFirstStreamBinding, commands.drawCount),
		drawStreamBindingCount: captureVdpRpuArrayState(commands.drawStreamBindingCount, commands.drawCount),
		drawFirstConstantBinding: captureVdpRpuArrayState(commands.drawFirstConstantBinding, commands.drawCount),
		drawConstantBindingCount: captureVdpRpuArrayState(commands.drawConstantBindingCount, commands.drawCount),
		drawFirstTextureBinding: captureVdpRpuArrayState(commands.drawFirstTextureBinding, commands.drawCount),
		drawTextureBindingCount: captureVdpRpuArrayState(commands.drawTextureBindingCount, commands.drawCount),
		batchFirstDraw: captureVdpRpuArrayState(commands.batchFirstDraw, commands.drawBatchCount),
		batchDrawCount: captureVdpRpuArrayState(commands.batchDrawCount, commands.drawBatchCount),
		batchVertexCount: captureVdpRpuArrayState(commands.batchVertexCount, commands.drawBatchCount),
		batchInstanceCount: captureVdpRpuArrayState(commands.batchInstanceCount, commands.drawBatchCount),
		batchIndexCount: captureVdpRpuArrayState(commands.batchIndexCount, commands.drawBatchCount),
		streamLayoutId: captureVdpRpuArrayState(commands.streamLayoutId, commands.streamBindingCount),
		streamSlot: captureVdpRpuArrayState(commands.streamSlot, commands.streamBindingCount),
		streamBufferRef: captureVdpRpuArrayState(commands.streamBufferRef, commands.streamBindingCount),
		streamByteOffset: captureVdpRpuArrayState(commands.streamByteOffset, commands.streamBindingCount),
		streamStepRate: captureVdpRpuArrayState(commands.streamStepRate, commands.streamBindingCount),
		constantBindingSlot: captureVdpRpuArrayState(commands.constantBindingSlot, commands.constantBindingCount),
		constantBank: captureVdpRpuArrayState(commands.constantBank, commands.constantBindingCount),
		constantFirstWord: captureVdpRpuArrayState(commands.constantFirstWord, commands.constantBindingCount),
		constantWordCount: captureVdpRpuArrayState(commands.constantWordCount, commands.constantBindingCount),
		textureSlot: captureVdpRpuArrayState(commands.textureSlot, commands.textureBindingCount),
		textureSurfaceRef: captureVdpRpuArrayState(commands.textureSurfaceRef, commands.textureBindingCount),
	};
}

function restoreVdpRpuCommandBufferState(commands: VdpRpuCommandBuffer, state: VdpRpuCommandBufferSaveState): void {
	commands.passCount = state.passCount;
	commands.drawCount = state.drawCount;
	commands.drawBatchCount = state.drawBatchCount;
	commands.streamBindingCount = state.streamBindingCount;
	commands.constantBindingCount = state.constantBindingCount;
	commands.textureBindingCount = state.textureBindingCount;
	restoreVdpRpuArrayState(commands.passFirstDraw, state.passFirstDraw);
	restoreVdpRpuArrayState(commands.passDrawCount, state.passDrawCount);
	restoreVdpRpuArrayState(commands.passFirstBatch, state.passFirstBatch);
	restoreVdpRpuArrayState(commands.passBatchCount, state.passBatchCount);
	restoreVdpRpuArrayState(commands.passColorSurfaceRef, state.passColorSurfaceRef);
	restoreVdpRpuArrayState(commands.passDepthSurfaceRef, state.passDepthSurfaceRef);
	restoreVdpRpuArrayState(commands.passViewportXY, state.passViewportXY);
	restoreVdpRpuArrayState(commands.passViewportWH, state.passViewportWH);
	restoreVdpRpuArrayState(commands.passOps, state.passOps);
	restoreVdpRpuArrayState(commands.passClearColor, state.passClearColor);
	restoreVdpRpuArrayState(commands.passClearDepthWord, state.passClearDepthWord);
	restoreVdpRpuArrayState(commands.drawShaderVariant, state.drawShaderVariant);
	restoreVdpRpuArrayState(commands.drawPrimitive, state.drawPrimitive);
	restoreVdpRpuArrayState(commands.drawPipelineWord, state.drawPipelineWord);
	restoreVdpRpuArrayState(commands.drawVertexCount, state.drawVertexCount);
	restoreVdpRpuArrayState(commands.drawInstanceCount, state.drawInstanceCount);
	restoreVdpRpuArrayState(commands.drawIndexBufferRef, state.drawIndexBufferRef);
	restoreVdpRpuArrayState(commands.drawIndexByteOffset, state.drawIndexByteOffset);
	restoreVdpRpuArrayState(commands.drawIndexCount, state.drawIndexCount);
	restoreVdpRpuArrayState(commands.drawIndexType, state.drawIndexType);
	restoreVdpRpuArrayState(commands.drawFirstStreamBinding, state.drawFirstStreamBinding);
	restoreVdpRpuArrayState(commands.drawStreamBindingCount, state.drawStreamBindingCount);
	restoreVdpRpuArrayState(commands.drawFirstConstantBinding, state.drawFirstConstantBinding);
	restoreVdpRpuArrayState(commands.drawConstantBindingCount, state.drawConstantBindingCount);
	restoreVdpRpuArrayState(commands.drawFirstTextureBinding, state.drawFirstTextureBinding);
	restoreVdpRpuArrayState(commands.drawTextureBindingCount, state.drawTextureBindingCount);
	restoreVdpRpuArrayState(commands.batchFirstDraw, state.batchFirstDraw);
	restoreVdpRpuArrayState(commands.batchDrawCount, state.batchDrawCount);
	restoreVdpRpuArrayState(commands.batchVertexCount, state.batchVertexCount);
	restoreVdpRpuArrayState(commands.batchInstanceCount, state.batchInstanceCount);
	restoreVdpRpuArrayState(commands.batchIndexCount, state.batchIndexCount);
	restoreVdpRpuArrayState(commands.streamLayoutId, state.streamLayoutId);
	restoreVdpRpuArrayState(commands.streamSlot, state.streamSlot);
	restoreVdpRpuArrayState(commands.streamBufferRef, state.streamBufferRef);
	restoreVdpRpuArrayState(commands.streamByteOffset, state.streamByteOffset);
	restoreVdpRpuArrayState(commands.streamStepRate, state.streamStepRate);
	restoreVdpRpuArrayState(commands.constantBindingSlot, state.constantBindingSlot);
	restoreVdpRpuArrayState(commands.constantBank, state.constantBank);
	restoreVdpRpuArrayState(commands.constantFirstWord, state.constantFirstWord);
	restoreVdpRpuArrayState(commands.constantWordCount, state.constantWordCount);
	restoreVdpRpuArrayState(commands.textureSlot, state.textureSlot);
	restoreVdpRpuArrayState(commands.textureSurfaceRef, state.textureSurfaceRef);
}

function captureVdpRpuFrameBufferRefsState(refs: VdpRpuFrameBufferRefs): VdpRpuFrameBufferRefSaveState[] {
	const states: VdpRpuFrameBufferRefSaveState[] = [];
	for (let index = 0; index < refs.length; index += 1) {
		states[index] = {
			bufferId: refs.bufferId[index],
			revision: refs.revision[index],
			sourceByteOffset: refs.sourceByteOffset[index],
			byteOffset: refs.byteOffset[index],
			byteLength: refs.byteLength[index],
			usage: refs.usage[index],
		};
	}
	return states;
}

function restoreVdpRpuFrameBufferRefsState(refs: VdpRpuFrameBufferRefs, states: VdpRpuFrameBufferRefSaveState[]): void {
	refs.length = states.length;
	for (let index = 0; index < states.length; index += 1) {
		const state = states[index];
		refs.bufferId[index] = state.bufferId;
		refs.revision[index] = state.revision;
		refs.sourceByteOffset[index] = state.sourceByteOffset;
		refs.byteOffset[index] = state.byteOffset;
		refs.byteLength[index] = state.byteLength;
		refs.usage[index] = state.usage;
	}
}

function captureVdpRpuFrameSurfaceRefsState(refs: VdpRpuFrameSurfaceRefs): VdpRpuFrameSurfaceRefSaveState[] {
	const states: VdpRpuFrameSurfaceRefSaveState[] = [];
	for (let index = 0; index < refs.length; index += 1) {
		states[index] = {
			surfaceId: refs.surfaceId[index],
			revision: refs.revision[index],
			width: refs.width[index],
			height: refs.height[index],
			format: refs.format[index],
			usage: refs.usage[index],
		};
	}
	return states;
}

function restoreVdpRpuFrameSurfaceRefsState(refs: VdpRpuFrameSurfaceRefs, states: VdpRpuFrameSurfaceRefSaveState[]): void {
	refs.length = states.length;
	for (let index = 0; index < states.length; index += 1) {
		const state = states[index];
		refs.surfaceId[index] = state.surfaceId;
		refs.revision[index] = state.revision;
		refs.width[index] = state.width;
		refs.height[index] = state.height;
		refs.format[index] = state.format;
		refs.usage[index] = state.usage;
	}
}

function captureVdpRpuConstantBankState(banks: VdpRpuConstantBankTable): VdpRpuConstantBankSaveState[] {
	const states: VdpRpuConstantBankSaveState[] = [];
	for (let index = 0; index < banks.length; index += 1) {
		states[index] = {
			firstWord: banks.firstWord[index],
			wordCount: banks.wordCount[index],
			epoch: banks.epoch[index],
		};
	}
	return states;
}

function restoreVdpRpuConstantBankState(banks: VdpRpuConstantBankTable, states: VdpRpuConstantBankSaveState[]): void {
	banks.length = states.length;
	for (let index = 0; index < states.length; index += 1) {
		const state = states[index];
		banks.firstWord[index] = state.firstWord;
		banks.wordCount[index] = state.wordCount;
		banks.epoch[index] = state.epoch;
	}
}

function captureVdpRpuConstantWords(frame: VdpRpuFrameOutput): number[] {
	let wordCount = 0;
	const banks = frame.resources.constantBanks;
	for (let index = 0; index < banks.length; index += 1) {
		const bankEnd = banks.firstWord[index] + banks.wordCount[index];
		if (bankEnd > wordCount) {
			wordCount = bankEnd;
		}
	}
	return captureVdpRpuArrayState(frame.resources.constantWords, wordCount);
}

export function captureVdpRpuFrameState(frame: VdpRpuFrameOutput): VdpRpuFrameSaveState {
	return {
		commands: captureVdpRpuCommandBufferState(frame.commands),
		bufferRefs: captureVdpRpuFrameBufferRefsState(frame.resources.bufferRefs),
		bufferBytes: captureVdpRpuArrayState(frame.resources.bufferRefs.snapshotBytes, frame.resources.bufferRefs.snapshotByteLength),
		surfaceRefs: captureVdpRpuFrameSurfaceRefsState(frame.resources.surfaceRefs),
		constantWords: captureVdpRpuConstantWords(frame),
		constantBanks: captureVdpRpuConstantBankState(frame.resources.constantBanks),
	};
}

export function restoreVdpRpuFrameState(frame: VdpRpuFrameOutput, state: VdpRpuFrameSaveState): void {
	resetVdpRpuFrameOutput(frame);
	restoreVdpRpuCommandBufferState(frame.commands, state.commands);
	restoreVdpRpuFrameBufferRefsState(frame.resources.bufferRefs, state.bufferRefs);
	restoreVdpRpuArrayState(frame.resources.bufferRefs.snapshotBytes, state.bufferBytes);
	frame.resources.bufferRefs.snapshotByteLength = state.bufferBytes.length;
	for (let index = 0; index < frame.resources.bufferRefs.length; index += 1) {
		frame.resources.bufferRefs.bytes[index] = frame.resources.bufferRefs.snapshotBytes;
	}
	restoreVdpRpuFrameSurfaceRefsState(frame.resources.surfaceRefs, state.surfaceRefs);
	restoreVdpRpuArrayState(frame.resources.constantWords, state.constantWords);
	restoreVdpRpuConstantBankState(frame.resources.constantBanks, state.constantBanks);
}
