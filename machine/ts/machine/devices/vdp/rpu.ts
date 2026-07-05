import type { Memory } from '../../memory/memory';
import { DEFAULT_VRAM_STAGING_SIZE, DEFAULT_VRAM_TEXTURE_SIZE, IO_WORD_SIZE } from '../../memory/map';
import type { DeviceStatusLatch } from '../device_status';
import {
	VDP_RPU_PASS_COST,
	VDP_RPU_PACKET_COST,
	VDP_RPU_BIND_COST,
	rpuDrawCost,
} from './budget';
import {
	RPU_PASS_DESC_SIZE,
	RPU_PASS_DESC_COLOR_SURFACE_DESC_ADDR_OFFSET,
	RPU_PASS_DESC_DEPTH_SURFACE_DESC_ADDR_OFFSET,
	RPU_PASS_DESC_VIEWPORT_XY_OFFSET,
	RPU_PASS_DESC_VIEWPORT_WH_OFFSET,
	RPU_PASS_DESC_OPS_OFFSET,
	RPU_PASS_DESC_CLEAR_COLOR_OFFSET,
	RPU_PASS_DESC_CLEAR_DEPTH_WORD_OFFSET,
	RPU_PASS_DESC_DRAW_DESCS_ADDR_OFFSET,
	RPU_PASS_DESC_DRAW_COUNT_OFFSET,
	RPU_DRAW_DESC_SIZE,
	RPU_DRAW_DESC_SHADER_VARIANT_OFFSET,
	RPU_DRAW_DESC_PRIMITIVE_OFFSET,
	RPU_DRAW_DESC_PIPELINE_WORD_OFFSET,
	RPU_DRAW_DESC_VERTEX_COUNT_OFFSET,
	RPU_DRAW_DESC_INSTANCE_COUNT_OFFSET,
	RPU_DRAW_DESC_INDEX_VRAM_ADDR_OFFSET,
	RPU_DRAW_DESC_INDEX_COUNT_OFFSET,
	RPU_DRAW_DESC_INDEX_TYPE_OFFSET,
	RPU_DRAW_DESC_STREAM_COUNT_OFFSET,
	RPU_DRAW_DESC_CONSTANT_COUNT_OFFSET,
	RPU_DRAW_DESC_TEXTURE_COUNT_OFFSET,
	RPU_DRAW_DESC_STREAM_DESCS_ADDR_OFFSET,
	RPU_DRAW_DESC_CONSTANT_DESCS_ADDR_OFFSET,
	RPU_DRAW_DESC_TEXTURE_DESCS_ADDR_OFFSET,
	RPU_STREAM_DESC_SIZE,
	RPU_STREAM_DESC_VRAM_ADDR_OFFSET,
	RPU_STREAM_DESC_BYTE_LENGTH_OFFSET,
	RPU_STREAM_DESC_LAYOUT_ID_OFFSET,
	RPU_STREAM_DESC_SLOT_OFFSET,
	RPU_STREAM_DESC_STEP_RATE_OFFSET,
	RPU_CONSTANT_DESC_SIZE,
	RPU_CONSTANT_DESC_VRAM_ADDR_OFFSET,
	RPU_CONSTANT_DESC_BYTE_LENGTH_OFFSET,
	RPU_CONSTANT_DESC_SLOT_OFFSET,
	RPU_TEXTURE_DESC_SIZE,
	RPU_TEXTURE_DESC_SURFACE_DESC_ADDR_OFFSET,
	RPU_TEXTURE_DESC_SLOT_OFFSET,
	readRpuDescU16,
	readRpuDescU32,
} from './rpu_desc';

export const VDP_RPU_PASS_CAPACITY = 64;
export const VDP_RPU_DRAW_CAPACITY = 4096;
export const VDP_RPU_STREAM_BINDING_CAPACITY = 8192;
export const VDP_RPU_CONSTANT_BINDING_CAPACITY = 8192;
export const VDP_RPU_TEXTURE_BINDING_CAPACITY = 4096;
export const VDP_RPU_PARAM_MEM_SIZE = DEFAULT_VRAM_STAGING_SIZE + DEFAULT_VRAM_TEXTURE_SIZE;
export const VDP_RPU_PARAM_MEM_PAGE_SHIFT = 12;
export const VDP_RPU_PARAM_MEM_PAGE_SIZE = 1 << VDP_RPU_PARAM_MEM_PAGE_SHIFT;
export function vdpRpuParamMemPageCount(byteLength: number): number {
	return (byteLength + VDP_RPU_PARAM_MEM_PAGE_SIZE - 1) >>> VDP_RPU_PARAM_MEM_PAGE_SHIFT;
}
export const VDP_RPU_PARAM_MEM_PAGE_COUNT = VDP_RPU_PARAM_MEM_SIZE >> VDP_RPU_PARAM_MEM_PAGE_SHIFT;

export const VDP_RPU_FEATURE_INSTANCED_ARRAYS = 1 << 0;
export const VDP_RPU_FEATURE_UINT_INDEX = 1 << 1;
export const VDP_RPU_FEATURE_DEPTH_TEXTURE = 1 << 2;
export const VDP_RPU_REQUIRED_FEATURES = VDP_RPU_FEATURE_INSTANCED_ARRAYS | VDP_RPU_FEATURE_UINT_INDEX;

export const VDP_RPU_PACKET_KIND = 0x18000000;
export const VDP_RPU_FAULT_SENTINEL = 0xffffffff;

export const VDP_RPU_OP_EXEC_PASS_LIST = 64;
export const VDP_RPU_OP_SEAL_FRAME     = 65;

export const VDP_RPU_EXEC_PASS_LIST_WORDS = 2; // payload words: op_word + addr_word
export const VDP_RPU_SEAL_FRAME_WORDS     = 1; // payload words: op_word only

// Old opcodes removed from execution path; numeric values preserved for reference:
// VDP_RPU_OP_BUFFER_DEFINE          = 1
// VDP_RPU_OP_BUFFER_UPLOAD_DMA      = 2
// VDP_RPU_OP_BUFFER_UPLOAD_INLINE   = 3
// VDP_RPU_OP_BUFFER_DISCARD         = 4
// VDP_RPU_OP_SURFACE_DEFINE         = 8
// VDP_RPU_OP_CONSTANT_BANK_DEFINE   = 16
// VDP_RPU_OP_CONSTANT_UPLOAD_DMA    = 17
// VDP_RPU_OP_CONSTANT_UPLOAD_INLINE = 18
// VDP_RPU_OP_CONSTANT_UPLOAD_DEVICE = 19
// VDP_RPU_OP_BEGIN_PASS             = 32
// VDP_RPU_OP_END_PASS               = 33
// VDP_RPU_OP_BEGIN_DRAW             = 40
// VDP_RPU_OP_BIND_STREAM            = 41
// VDP_RPU_OP_BIND_CONSTANTS         = 42
// VDP_RPU_OP_BIND_TEXTURE           = 43
// VDP_RPU_OP_END_DRAW               = 44

export const VDP_RPU_SURFACE_FORMAT_RGBA8 = 0;
export const VDP_RPU_SURFACE_FORMAT_DEPTH16 = 1;

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

export const VDP_FAULT_RPU_BAD_PACKET        = 0x0700;
export const VDP_FAULT_RPU_FETCH_OOB         = 0x0701;
export const VDP_FAULT_RPU_BAD_STREAM_LAYOUT = 0x0702;
export const VDP_FAULT_RPU_COMMAND_OVERFLOW  = 0x0708;
export const VDP_FAULT_RPU_BAD_STATE         = 0x0709;

export const VDP_RPU_FRAME_IDLE = 0;
export const VDP_RPU_FRAME_OPEN = 1;

export type VdpRpuFrameBuildState =
	| typeof VDP_RPU_FRAME_IDLE
	| typeof VDP_RPU_FRAME_OPEN;

export type VdpRpuFrameOutput = {
	commands: VdpRpuCommandBuffer;
	vdpVram: Uint8Array;
	vdpVramPageRevisions: Uint32Array;
};

export class VdpRpuCommandBuffer {
	public passCount = 0;
	public drawCount = 0;
	public streamBindingCount = 0;
	public constantBindingCount = 0;
	public textureBindingCount = 0;
	public readonly passFirstDraw = new Uint32Array(VDP_RPU_PASS_CAPACITY);
	public readonly passDrawCount = new Uint16Array(VDP_RPU_PASS_CAPACITY);
	public readonly passColorSurfaceDescAddr = new Uint32Array(VDP_RPU_PASS_CAPACITY);
	public readonly passDepthSurfaceDescAddr = new Uint32Array(VDP_RPU_PASS_CAPACITY);
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
	public readonly drawIndexVramAddr = new Uint32Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawIndexCount = new Uint32Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawIndexType = new Uint8Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawFirstStreamBinding = new Uint32Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawStreamBindingCount = new Uint8Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawFirstConstantBinding = new Uint32Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawConstantBindingCount = new Uint8Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawFirstTextureBinding = new Uint32Array(VDP_RPU_DRAW_CAPACITY);
	public readonly drawTextureBindingCount = new Uint8Array(VDP_RPU_DRAW_CAPACITY);
	public readonly streamLayoutId = new Uint16Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly streamSlot = new Uint8Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly streamVramAddr = new Uint32Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly streamByteLength = new Uint32Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly streamStepRate = new Uint8Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly constantBindingSlot = new Uint8Array(VDP_RPU_CONSTANT_BINDING_CAPACITY);
	public readonly constantVramAddr = new Uint32Array(VDP_RPU_CONSTANT_BINDING_CAPACITY);
	public readonly constantByteLength = new Uint32Array(VDP_RPU_CONSTANT_BINDING_CAPACITY);
	public readonly textureSlot = new Uint8Array(VDP_RPU_TEXTURE_BINDING_CAPACITY);
	public readonly textureSurfaceDescAddr = new Uint32Array(VDP_RPU_TEXTURE_BINDING_CAPACITY);
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
	instanceMode: number;
	textureSlotCount: number;
	usesC0: 0 | 1;
	lightingConstantSlot: number;
	jointConstantSlot: number;
	constantSlotCount: number;
	constantSlots: readonly VdpRpuShaderConstantSlotSpec[];
}>;

export const VDP_RPU_RESOURCE_NONE = 0xffffffff;

export const VDP_RPU_CONSTANT_SOURCE_XF_Q16 = 0;
export const VDP_RPU_CONSTANT_SOURCE_LPU_RAW = 1;
export const VDP_RPU_CONSTANT_SOURCE_MFU_Q16 = 2;
export const VDP_RPU_CONSTANT_SOURCE_JTU_Q16 = 3;
export const VDP_RPU_CONSTANT_SOURCE_MASK = 0x00000003;

export const VDP_RPU_SHADER_VARIANTS: readonly VdpRpuShaderVariantSpec[] = [
	{
		id: VDP_RPU_SHADER_V2_C4,
		requiredFeatureMask: 0,
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
	streamBindingCount: number;
	constantBindingCount: number;
	textureBindingCount: number;
	passFirstDraw: number[];
	passDrawCount: number[];
	passColorSurfaceDescAddr: number[];
	passDepthSurfaceDescAddr: number[];
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
	drawIndexVramAddr: number[];
	drawIndexCount: number[];
	drawIndexType: number[];
	drawFirstStreamBinding: number[];
	drawStreamBindingCount: number[];
	drawFirstConstantBinding: number[];
	drawConstantBindingCount: number[];
	drawFirstTextureBinding: number[];
	drawTextureBindingCount: number[];
	streamLayoutId: number[];
	streamSlot: number[];
	streamVramAddr: number[];
	streamByteLength: number[];
	streamStepRate: number[];
	constantBindingSlot: number[];
	constantVramAddr: number[];
	constantByteLength: number[];
	textureSlot: number[];
	textureSurfaceDescAddr: number[];
};

export type VdpRpuFrameSaveState = {
	commands: VdpRpuCommandBufferSaveState;
};

export type VdpRpuSaveState = {
	buildState: VdpRpuFrameBuildState;
};

export function createVdpRpuFrameOutput(vdpVram: Uint8Array, vdpVramPageRevisions: Uint32Array): VdpRpuFrameOutput {
	return {
		commands: new VdpRpuCommandBuffer(),
		vdpVram,
		vdpVramPageRevisions,
	};
}

export function resetVdpRpuFrameOutput(frame: VdpRpuFrameOutput): void {
	frame.commands.passCount = 0;
	frame.commands.drawCount = 0;
	frame.commands.streamBindingCount = 0;
	frame.commands.constantBindingCount = 0;
	frame.commands.textureBindingCount = 0;
}

export function bumpVdpRpuVramPageRevisions(pageRevisions: Uint32Array, offset: number, byteLength: number): void {
	if (byteLength === 0) {
		return;
	}
	const firstPage = offset >>> VDP_RPU_PARAM_MEM_PAGE_SHIFT;
	const lastPage = (offset + byteLength - 1) >>> VDP_RPU_PARAM_MEM_PAGE_SHIFT;
	for (let page = firstPage; page <= lastPage; page += 1) {
		pageRevisions[page] = (pageRevisions[page]! + 1) >>> 0;
	}
}

export function vdpRpuVramRangeRevision(frame: VdpRpuFrameOutput, vramAddr: number, byteLength: number): number {
	if (byteLength === 0) {
		return 0;
	}
	const firstPage = vramAddr >>> VDP_RPU_PARAM_MEM_PAGE_SHIFT;
	const lastPage = (vramAddr + byteLength - 1) >>> VDP_RPU_PARAM_MEM_PAGE_SHIFT;
	const pageRevisions = frame.vdpVramPageRevisions;
	let revision = byteLength >>> 0;
	for (let page = firstPage; page <= lastPage; page += 1) {
		revision = (((revision << 5) - revision + pageRevisions[page]!) >>> 0);
	}
	return revision;
}

export class VdpRpuUnit {
	public lastPacketCost = 0;
	public lastPacketSealedFrame = false;
	private buildState: VdpRpuFrameBuildState = VDP_RPU_FRAME_IDLE;

	public constructor(
		private readonly memory: Memory,
		private readonly fault: DeviceStatusLatch,
		private readonly vdpVram: Uint8Array,
	) {}


	public reset(): void {
		this.lastPacketCost = 0;
		this.lastPacketSealedFrame = false;
		this.buildState = VDP_RPU_FRAME_IDLE;
	}

	public beginFrame(frame: VdpRpuFrameOutput): boolean {
		this.lastPacketCost = 0;
		this.lastPacketSealedFrame = false;
		if (this.buildState !== VDP_RPU_FRAME_IDLE) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, this.buildState);
			return false;
		}
		resetVdpRpuFrameOutput(frame);
		this.buildState = VDP_RPU_FRAME_OPEN;
		return true;
	}

	public cancelFrame(frame: VdpRpuFrameOutput): void {
		this.lastPacketCost = 0;
		this.lastPacketSealedFrame = false;
		resetVdpRpuFrameOutput(frame);
		this.buildState = VDP_RPU_FRAME_IDLE;
	}

	public endFrame(frame: VdpRpuFrameOutput): boolean {
		this.lastPacketCost = 0;
		this.lastPacketSealedFrame = false;
		void frame;
		if (this.buildState !== VDP_RPU_FRAME_OPEN) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, this.buildState);
			return false;
		}
		this.buildState = VDP_RPU_FRAME_IDLE;
		return true;
	}

	public captureState(): VdpRpuSaveState {
		return {
			buildState: this.buildState,
		};
	}

	public restoreState(state: VdpRpuSaveState): void {
		this.buildState = state.buildState;
	}

	private decodePacketPayloadWords(headerWord: number): number {
		this.lastPacketCost = 0;
		this.lastPacketSealedFrame = false;
		if ((headerWord & 0x0000ffff) !== 0) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
			return VDP_RPU_FAULT_SENTINEL;
		}
		const payloadWords = (headerWord >>> 16) & 0xff;
		if (payloadWords === 0) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
			return VDP_RPU_FAULT_SENTINEL;
		}
		return payloadWords;
	}

	public consumePacketFromMemory(frame: VdpRpuFrameOutput, headerWord: number, cursor: number, end: number): number {
		const payloadWords = this.decodePacketPayloadWords(headerWord);
		if (payloadWords === VDP_RPU_FAULT_SENTINEL) {
			return VDP_RPU_FAULT_SENTINEL;
		}
		const payloadEnd = cursor + payloadWords * IO_WORD_SIZE;
		if (payloadEnd > end) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
			return VDP_RPU_FAULT_SENTINEL;
		}
		const op = this.memory.readU32(cursor);
		return this.consumePacketPayloadFromMemory(frame, op, cursor, payloadWords) ? payloadEnd : VDP_RPU_FAULT_SENTINEL;
	}

	public consumePacketFromWords(frame: VdpRpuFrameOutput, words: Uint32Array, headerWord: number, cursor: number, wordCount: number): number {
		const payloadWords = this.decodePacketPayloadWords(headerWord);
		if (payloadWords === VDP_RPU_FAULT_SENTINEL) {
			return VDP_RPU_FAULT_SENTINEL;
		}
		if (cursor + payloadWords > wordCount) {
			this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, headerWord);
			return VDP_RPU_FAULT_SENTINEL;
		}
		const op = words[cursor];
		return this.consumePacketPayloadFromWords(frame, words, op, cursor, payloadWords) ? cursor + payloadWords : VDP_RPU_FAULT_SENTINEL;
	}

	private consumePacketPayloadFromMemory(frame: VdpRpuFrameOutput, op: number, cursor: number, payloadWords: number): boolean {
		if (this.buildState === VDP_RPU_FRAME_IDLE) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, op);
			return false;
		}
		switch (op & 0xff) {
			case VDP_RPU_OP_EXEC_PASS_LIST:
				if (payloadWords !== VDP_RPU_EXEC_PASS_LIST_WORDS) {
					this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, op);
					return false;
				}
				return this.acceptExecPassList(frame, op, this.memory.readU32(cursor + IO_WORD_SIZE));
			case VDP_RPU_OP_SEAL_FRAME:
				if (payloadWords !== VDP_RPU_SEAL_FRAME_WORDS) {
					this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, op);
					return false;
				}
				return this.acceptSealFrame(frame);
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
		switch (op & 0xff) {
			case VDP_RPU_OP_EXEC_PASS_LIST:
				if (payloadWords !== VDP_RPU_EXEC_PASS_LIST_WORDS) {
					this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, op);
					return false;
				}
				return this.acceptExecPassList(frame, op, words[cursor + 1]);
			case VDP_RPU_OP_SEAL_FRAME:
				if (payloadWords !== VDP_RPU_SEAL_FRAME_WORDS) {
					this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, op);
					return false;
				}
				return this.acceptSealFrame(frame);
			default:
				this.fault.raise(VDP_FAULT_RPU_BAD_PACKET, op);
				return false;
		}
	}

	private acceptExecPassList(frame: VdpRpuFrameOutput, opWord: number, passDescAddr: number): boolean {
		if (this.buildState !== VDP_RPU_FRAME_OPEN) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, opWord);
			return false;
		}
		const passCount = (opWord >>> 8) & 0xffff;
		const cmd = frame.commands;
		const vram = this.vdpVram;
		let cost = VDP_RPU_PACKET_COST;

		for (let p = 0; p < passCount; p += 1) {
			const pb = (passDescAddr + p * RPU_PASS_DESC_SIZE) >>> 0;
			if (!this.checkVramRange(pb, RPU_PASS_DESC_SIZE)) {
				return false;
			}
			if (cmd.passCount >= VDP_RPU_PASS_CAPACITY) {
				this.fault.raise(VDP_FAULT_RPU_COMMAND_OVERFLOW, cmd.passCount);
				return false;
			}
			const pi = cmd.passCount++;
			cost += VDP_RPU_PASS_COST;
			cmd.passColorSurfaceDescAddr[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_COLOR_SURFACE_DESC_ADDR_OFFSET);
			cmd.passDepthSurfaceDescAddr[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_DEPTH_SURFACE_DESC_ADDR_OFFSET);
			cmd.passViewportXY[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_VIEWPORT_XY_OFFSET);
			cmd.passViewportWH[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_VIEWPORT_WH_OFFSET);
			cmd.passOps[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_OPS_OFFSET);
			cmd.passClearColor[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_CLEAR_COLOR_OFFSET);
			cmd.passClearDepthWord[pi] = readRpuDescU32(vram, pb + RPU_PASS_DESC_CLEAR_DEPTH_WORD_OFFSET);

			const drawDescsAddr = readRpuDescU32(vram, pb + RPU_PASS_DESC_DRAW_DESCS_ADDR_OFFSET);
			const drawCount = readRpuDescU16(vram, pb + RPU_PASS_DESC_DRAW_COUNT_OFFSET);
			cmd.passFirstDraw[pi] = cmd.drawCount;

			for (let d = 0; d < drawCount; d += 1) {
				const db = (drawDescsAddr + d * RPU_DRAW_DESC_SIZE) >>> 0;
				if (!this.checkVramRange(db, RPU_DRAW_DESC_SIZE)) {
					cmd.passDrawCount[pi] = d;
					return false;
				}
				if (cmd.drawCount >= VDP_RPU_DRAW_CAPACITY) {
					cmd.passDrawCount[pi] = d;
					this.fault.raise(VDP_FAULT_RPU_COMMAND_OVERFLOW, cmd.drawCount);
					return false;
				}
				const di = cmd.drawCount++;
				cmd.drawShaderVariant[di] = readRpuDescU16(vram, db + RPU_DRAW_DESC_SHADER_VARIANT_OFFSET);
				cmd.drawPrimitive[di] = vram[db + RPU_DRAW_DESC_PRIMITIVE_OFFSET]!;
				cmd.drawPipelineWord[di] = readRpuDescU32(vram, db + RPU_DRAW_DESC_PIPELINE_WORD_OFFSET);
				cmd.drawVertexCount[di] = readRpuDescU32(vram, db + RPU_DRAW_DESC_VERTEX_COUNT_OFFSET);
				cmd.drawInstanceCount[di] = readRpuDescU32(vram, db + RPU_DRAW_DESC_INSTANCE_COUNT_OFFSET);
				cmd.drawIndexVramAddr[di] = readRpuDescU32(vram, db + RPU_DRAW_DESC_INDEX_VRAM_ADDR_OFFSET);
				cmd.drawIndexCount[di] = readRpuDescU32(vram, db + RPU_DRAW_DESC_INDEX_COUNT_OFFSET);
				cmd.drawIndexType[di] = vram[db + RPU_DRAW_DESC_INDEX_TYPE_OFFSET]!;
				cmd.drawFirstStreamBinding[di] = cmd.streamBindingCount;
				const firstConstantBinding = cmd.constantBindingCount;
				cmd.drawFirstConstantBinding[di] = firstConstantBinding;
				cmd.drawFirstTextureBinding[di] = cmd.textureBindingCount;
				cost += rpuDrawCost(cmd.drawVertexCount[di], cmd.drawInstanceCount[di], cmd.drawIndexCount[di]);

				const streamCount = vram[db + RPU_DRAW_DESC_STREAM_COUNT_OFFSET]!;
				const constantCount = vram[db + RPU_DRAW_DESC_CONSTANT_COUNT_OFFSET]!;
				const textureCount = vram[db + RPU_DRAW_DESC_TEXTURE_COUNT_OFFSET]!;
				const streamDescsAddr = readRpuDescU32(vram, db + RPU_DRAW_DESC_STREAM_DESCS_ADDR_OFFSET);
				const constantDescsAddr = readRpuDescU32(vram, db + RPU_DRAW_DESC_CONSTANT_DESCS_ADDR_OFFSET);
				const textureDescsAddr = readRpuDescU32(vram, db + RPU_DRAW_DESC_TEXTURE_DESCS_ADDR_OFFSET);
				const acceptedDrawCount = d + 1;

				for (let s = 0; s < streamCount; s += 1) {
					const sb = (streamDescsAddr + s * RPU_STREAM_DESC_SIZE) >>> 0;
					if (!this.checkVramRange(sb, RPU_STREAM_DESC_SIZE)) {
						cmd.drawStreamBindingCount[di] = s;
						cmd.drawConstantBindingCount[di] = 0;
						cmd.drawTextureBindingCount[di] = 0;
						cmd.passDrawCount[pi] = acceptedDrawCount;
						return false;
					}
					if (cmd.streamBindingCount >= VDP_RPU_STREAM_BINDING_CAPACITY) {
						cmd.drawStreamBindingCount[di] = s;
						cmd.passDrawCount[pi] = acceptedDrawCount;
						this.fault.raise(VDP_FAULT_RPU_COMMAND_OVERFLOW, cmd.streamBindingCount);
						return false;
					}
					const si = cmd.streamBindingCount++;
					cmd.streamVramAddr[si] = readRpuDescU32(vram, sb + RPU_STREAM_DESC_VRAM_ADDR_OFFSET);
					cmd.streamByteLength[si] = readRpuDescU32(vram, sb + RPU_STREAM_DESC_BYTE_LENGTH_OFFSET);
					cmd.streamLayoutId[si] = readRpuDescU16(vram, sb + RPU_STREAM_DESC_LAYOUT_ID_OFFSET);
					cmd.streamSlot[si] = vram[sb + RPU_STREAM_DESC_SLOT_OFFSET]!;
					cmd.streamStepRate[si] = vram[sb + RPU_STREAM_DESC_STEP_RATE_OFFSET]!;
					cost += VDP_RPU_BIND_COST;
				}
				cmd.drawStreamBindingCount[di] = streamCount;

				for (let c = 0; c < constantCount; c += 1) {
					const cb = (constantDescsAddr + c * RPU_CONSTANT_DESC_SIZE) >>> 0;
					if (!this.checkVramRange(cb, RPU_CONSTANT_DESC_SIZE)) {
						cmd.drawConstantBindingCount[di] = c;
						cmd.drawTextureBindingCount[di] = 0;
						cmd.passDrawCount[pi] = acceptedDrawCount;
						return false;
					}
					const ci = cmd.constantBindingCount;
					if (ci >= VDP_RPU_CONSTANT_BINDING_CAPACITY) {
						cmd.drawConstantBindingCount[di] = c;
						cmd.passDrawCount[pi] = acceptedDrawCount;
						this.fault.raise(VDP_FAULT_RPU_COMMAND_OVERFLOW, ci);
						return false;
					}
					cmd.constantBindingCount = ci + 1;
					cmd.constantBindingSlot[ci] = vram[cb + RPU_CONSTANT_DESC_SLOT_OFFSET]!;
					cmd.constantVramAddr[ci] = readRpuDescU32(vram, cb + RPU_CONSTANT_DESC_VRAM_ADDR_OFFSET);
					cmd.constantByteLength[ci] = readRpuDescU32(vram, cb + RPU_CONSTANT_DESC_BYTE_LENGTH_OFFSET);
					cost += VDP_RPU_BIND_COST;
				}
				cmd.drawConstantBindingCount[di] = constantCount;

				for (let t = 0; t < textureCount; t += 1) {
					const tb = (textureDescsAddr + t * RPU_TEXTURE_DESC_SIZE) >>> 0;
					if (!this.checkVramRange(tb, RPU_TEXTURE_DESC_SIZE)) {
						cmd.drawTextureBindingCount[di] = t;
						cmd.passDrawCount[pi] = acceptedDrawCount;
						return false;
					}
					if (cmd.textureBindingCount >= VDP_RPU_TEXTURE_BINDING_CAPACITY) {
						cmd.drawTextureBindingCount[di] = t;
						cmd.passDrawCount[pi] = acceptedDrawCount;
						this.fault.raise(VDP_FAULT_RPU_COMMAND_OVERFLOW, cmd.textureBindingCount);
						return false;
					}
					const ti = cmd.textureBindingCount++;
					cmd.textureSlot[ti] = vram[tb + RPU_TEXTURE_DESC_SLOT_OFFSET]!;
					cmd.textureSurfaceDescAddr[ti] = readRpuDescU32(vram, tb + RPU_TEXTURE_DESC_SURFACE_DESC_ADDR_OFFSET);
					cost += VDP_RPU_BIND_COST;
				}
				cmd.drawTextureBindingCount[di] = textureCount;
			}
			cmd.passDrawCount[pi] = drawCount;
		}

		this.lastPacketCost = cost;
		return true;
	}

	private acceptSealFrame(frame: VdpRpuFrameOutput): boolean {
		if (this.buildState !== VDP_RPU_FRAME_OPEN) {
			this.fault.raise(VDP_FAULT_RPU_BAD_STATE, VDP_RPU_OP_SEAL_FRAME);
			return false;
		}
		void frame;
		this.buildState = VDP_RPU_FRAME_IDLE;
		this.lastPacketSealedFrame = true;
		this.lastPacketCost = VDP_RPU_PACKET_COST;
		return true;
	}

	private checkVramRange(addr: number, size: number): boolean {
		if (addr >= this.vdpVram.byteLength || size > this.vdpVram.byteLength - addr) {
			this.fault.raise(VDP_FAULT_RPU_FETCH_OOB, addr);
			return false;
		}
		return true;
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
	const passCount = commands.passCount;
	const drawCount = commands.drawCount;
	const streamBindingCount = commands.streamBindingCount;
	const constantBindingCount = commands.constantBindingCount;
	const textureBindingCount = commands.textureBindingCount;
	return {
		passCount,
		drawCount,
		streamBindingCount,
		constantBindingCount,
		textureBindingCount,
		passFirstDraw: captureVdpRpuArrayState(commands.passFirstDraw, passCount),
		passDrawCount: captureVdpRpuArrayState(commands.passDrawCount, passCount),
		passColorSurfaceDescAddr: captureVdpRpuArrayState(commands.passColorSurfaceDescAddr, passCount),
		passDepthSurfaceDescAddr: captureVdpRpuArrayState(commands.passDepthSurfaceDescAddr, passCount),
		passViewportXY: captureVdpRpuArrayState(commands.passViewportXY, passCount),
		passViewportWH: captureVdpRpuArrayState(commands.passViewportWH, passCount),
		passOps: captureVdpRpuArrayState(commands.passOps, passCount),
		passClearColor: captureVdpRpuArrayState(commands.passClearColor, passCount),
		passClearDepthWord: captureVdpRpuArrayState(commands.passClearDepthWord, passCount),
		drawShaderVariant: captureVdpRpuArrayState(commands.drawShaderVariant, drawCount),
		drawPrimitive: captureVdpRpuArrayState(commands.drawPrimitive, drawCount),
		drawPipelineWord: captureVdpRpuArrayState(commands.drawPipelineWord, drawCount),
		drawVertexCount: captureVdpRpuArrayState(commands.drawVertexCount, drawCount),
		drawInstanceCount: captureVdpRpuArrayState(commands.drawInstanceCount, drawCount),
		drawIndexVramAddr: captureVdpRpuArrayState(commands.drawIndexVramAddr, drawCount),
		drawIndexCount: captureVdpRpuArrayState(commands.drawIndexCount, drawCount),
		drawIndexType: captureVdpRpuArrayState(commands.drawIndexType, drawCount),
		drawFirstStreamBinding: captureVdpRpuArrayState(commands.drawFirstStreamBinding, drawCount),
		drawStreamBindingCount: captureVdpRpuArrayState(commands.drawStreamBindingCount, drawCount),
		drawFirstConstantBinding: captureVdpRpuArrayState(commands.drawFirstConstantBinding, drawCount),
		drawConstantBindingCount: captureVdpRpuArrayState(commands.drawConstantBindingCount, drawCount),
		drawFirstTextureBinding: captureVdpRpuArrayState(commands.drawFirstTextureBinding, drawCount),
		drawTextureBindingCount: captureVdpRpuArrayState(commands.drawTextureBindingCount, drawCount),
		streamLayoutId: captureVdpRpuArrayState(commands.streamLayoutId, streamBindingCount),
		streamSlot: captureVdpRpuArrayState(commands.streamSlot, streamBindingCount),
		streamVramAddr: captureVdpRpuArrayState(commands.streamVramAddr, streamBindingCount),
		streamByteLength: captureVdpRpuArrayState(commands.streamByteLength, streamBindingCount),
		streamStepRate: captureVdpRpuArrayState(commands.streamStepRate, streamBindingCount),
		constantBindingSlot: captureVdpRpuArrayState(commands.constantBindingSlot, constantBindingCount),
		constantVramAddr: captureVdpRpuArrayState(commands.constantVramAddr, constantBindingCount),
		constantByteLength: captureVdpRpuArrayState(commands.constantByteLength, constantBindingCount),
		textureSlot: captureVdpRpuArrayState(commands.textureSlot, textureBindingCount),
		textureSurfaceDescAddr: captureVdpRpuArrayState(commands.textureSurfaceDescAddr, textureBindingCount),
	};
}

function restoreVdpRpuCommandBufferState(commands: VdpRpuCommandBuffer, state: VdpRpuCommandBufferSaveState): void {
	commands.passCount = state.passCount;
	commands.drawCount = state.drawCount;
	commands.streamBindingCount = state.streamBindingCount;
	commands.constantBindingCount = state.constantBindingCount;
	commands.textureBindingCount = state.textureBindingCount;
	restoreVdpRpuArrayState(commands.passFirstDraw, state.passFirstDraw);
	restoreVdpRpuArrayState(commands.passDrawCount, state.passDrawCount);
	restoreVdpRpuArrayState(commands.passColorSurfaceDescAddr, state.passColorSurfaceDescAddr);
	restoreVdpRpuArrayState(commands.passDepthSurfaceDescAddr, state.passDepthSurfaceDescAddr);
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
	restoreVdpRpuArrayState(commands.drawIndexVramAddr, state.drawIndexVramAddr);
	restoreVdpRpuArrayState(commands.drawIndexCount, state.drawIndexCount);
	restoreVdpRpuArrayState(commands.drawIndexType, state.drawIndexType);
	restoreVdpRpuArrayState(commands.drawFirstStreamBinding, state.drawFirstStreamBinding);
	restoreVdpRpuArrayState(commands.drawStreamBindingCount, state.drawStreamBindingCount);
	restoreVdpRpuArrayState(commands.drawFirstConstantBinding, state.drawFirstConstantBinding);
	restoreVdpRpuArrayState(commands.drawConstantBindingCount, state.drawConstantBindingCount);
	restoreVdpRpuArrayState(commands.drawFirstTextureBinding, state.drawFirstTextureBinding);
	restoreVdpRpuArrayState(commands.drawTextureBindingCount, state.drawTextureBindingCount);
	restoreVdpRpuArrayState(commands.streamLayoutId, state.streamLayoutId);
	restoreVdpRpuArrayState(commands.streamSlot, state.streamSlot);
	restoreVdpRpuArrayState(commands.streamVramAddr, state.streamVramAddr);
	restoreVdpRpuArrayState(commands.streamByteLength, state.streamByteLength);
	restoreVdpRpuArrayState(commands.streamStepRate, state.streamStepRate);
	restoreVdpRpuArrayState(commands.constantBindingSlot, state.constantBindingSlot);
	restoreVdpRpuArrayState(commands.constantVramAddr, state.constantVramAddr);
	restoreVdpRpuArrayState(commands.constantByteLength, state.constantByteLength);
	restoreVdpRpuArrayState(commands.textureSlot, state.textureSlot);
	restoreVdpRpuArrayState(commands.textureSurfaceDescAddr, state.textureSurfaceDescAddr);
}

export function captureVdpRpuFrameState(frame: VdpRpuFrameOutput): VdpRpuFrameSaveState {
	return {
		commands: captureVdpRpuCommandBufferState(frame.commands),
	};
}

export function restoreVdpRpuFrameState(frame: VdpRpuFrameOutput, state: VdpRpuFrameSaveState): void {
	resetVdpRpuFrameOutput(frame);
	restoreVdpRpuCommandBufferState(frame.commands, state.commands);
}
