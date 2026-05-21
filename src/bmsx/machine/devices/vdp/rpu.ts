export const VDP_RPU_PASS_CAPACITY = 64;
export const VDP_RPU_DRAW_CAPACITY = 4096;
export const VDP_RPU_STREAM_BINDING_CAPACITY = 8192;
export const VDP_RPU_CONSTANT_BINDING_CAPACITY = 8192;
export const VDP_RPU_TEXTURE_BINDING_CAPACITY = 4096;
export const VDP_RPU_BUFFER_CAPACITY = 1024;
export const VDP_RPU_BUFFER_REF_CAPACITY = 4096;
export const VDP_RPU_SURFACE_CAPACITY = 256;
export const VDP_RPU_SURFACE_REF_CAPACITY = 1024;
export const VDP_RPU_CONSTANT_BANK_CAPACITY = 256;
export const VDP_RPU_CONSTANT_WORD_CAPACITY = 65536;
export const VDP_RPU_RESOURCE_NONE = 0xffffffff;

export const VDP_RPU_FEATURE_INSTANCED_ARRAYS = 1 << 0;
export const VDP_RPU_FEATURE_UINT_INDEX = 1 << 1;
export const VDP_RPU_FEATURE_DEPTH_TEXTURE = 1 << 2;
export const VDP_RPU_REQUIRED_FEATURES = VDP_RPU_FEATURE_INSTANCED_ARRAYS;

export const VDP_RPU_PACKET_KIND = 0x18000000;
export const VDP_RPU_OP_BUFFER_DEFINE = 1;
export const VDP_RPU_OP_BUFFER_UPLOAD_DMA = 2;
export const VDP_RPU_OP_BUFFER_UPLOAD_INLINE = 3;
export const VDP_RPU_OP_BUFFER_DISCARD = 4;
export const VDP_RPU_OP_SURFACE_DEFINE = 8;
export const VDP_RPU_OP_CONSTANT_BANK_DEFINE = 16;
export const VDP_RPU_OP_CONSTANT_UPLOAD_DMA = 17;
export const VDP_RPU_OP_CONSTANT_UPLOAD_INLINE = 18;
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
export const VDP_RPU_BEGIN_PASS_WORDS = 8;
export const VDP_RPU_END_PASS_WORDS = 1;
export const VDP_RPU_BEGIN_DRAW_WORDS = 9;
export const VDP_RPU_BIND_STREAM_WORDS = 6;
export const VDP_RPU_BIND_CONSTANTS_WORDS = 5;
export const VDP_RPU_BIND_TEXTURE_WORDS = 4;
export const VDP_RPU_END_DRAW_WORDS = 1;
export const VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS = 4;
export const VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS = 4;

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

export const VDP_RPU_SURFACE_FORMAT_RGBA8 = 0;
export const VDP_RPU_SURFACE_FORMAT_DEPTH16 = 1;
export const VDP_RPU_SURFACE_USAGE_COLOR = 1 << 0;
export const VDP_RPU_SURFACE_USAGE_DEPTH = 1 << 1;
export const VDP_RPU_SURFACE_USAGE_TEXTURE = 1 << 2;
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

export const VDP_RPU_FILTER_NEAREST = 0;
export const VDP_RPU_FILTER_LINEAR = 1;
export const VDP_RPU_WRAP_CLAMP = 0;
export const VDP_RPU_WRAP_REPEAT = 1;
export const VDP_RPU_SAMPLER_MIN_FILTER_MASK = 0x00000003;
export const VDP_RPU_SAMPLER_MAG_FILTER_MASK = 0x0000000c;
export const VDP_RPU_SAMPLER_WRAP_U_MASK = 0x00000030;
export const VDP_RPU_SAMPLER_WRAP_V_MASK = 0x000000c0;
export const VDP_RPU_SAMPLER_WORD_MASK =
	VDP_RPU_SAMPLER_MIN_FILTER_MASK
	| VDP_RPU_SAMPLER_MAG_FILTER_MASK
	| VDP_RPU_SAMPLER_WRAP_U_MASK
	| VDP_RPU_SAMPLER_WRAP_V_MASK;

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

export const VDP_FAULT_RPU_BAD_PACKET = 0x0700;
export const VDP_FAULT_RPU_BAD_SHADER = 0x0701;
export const VDP_FAULT_RPU_BAD_STREAM_LAYOUT = 0x0702;
export const VDP_FAULT_RPU_BUFFER_OOB = 0x0703;
export const VDP_FAULT_RPU_STALE_RESOURCE = 0x0704;
export const VDP_FAULT_RPU_BAD_SURFACE_USAGE = 0x0705;
export const VDP_FAULT_RPU_BAD_CONSTANT_RANGE = 0x0706;
export const VDP_FAULT_RPU_UNSUPPORTED_FEATURE = 0x0707;
export const VDP_FAULT_RPU_COMMAND_OVERFLOW = 0x0708;
export const VDP_FAULT_RPU_BAD_STATE = 0x0709;

export type VdpRpuBufferDefinePacket = readonly [
	op: typeof VDP_RPU_OP_BUFFER_DEFINE,
	bufferId: number,
	byteLength: number,
	usage: number,
];

export type VdpRpuBufferUploadDmaPacket = readonly [
	op: typeof VDP_RPU_OP_BUFFER_UPLOAD_DMA,
	bufferId: number,
	dstByteOffset: number,
	srcAddr: number,
	byteLength: number,
];

export type VdpRpuBufferUploadInlinePacket = readonly number[];

export type VdpRpuBufferDiscardPacket = readonly [
	op: typeof VDP_RPU_OP_BUFFER_DISCARD,
	bufferId: number,
];

export type VdpRpuSurfaceDefinePacket = readonly [
	op: typeof VDP_RPU_OP_SURFACE_DEFINE,
	surfaceId: number,
	widthHeight: number,
	formatUsage: number,
];

export type VdpRpuConstantBankDefinePacket = readonly [
	op: typeof VDP_RPU_OP_CONSTANT_BANK_DEFINE,
	bankId: number,
	firstWord: number,
	wordCount: number,
];

export type VdpRpuConstantUploadDmaPacket = readonly [
	op: typeof VDP_RPU_OP_CONSTANT_UPLOAD_DMA,
	bankId: number,
	dstWordOffset: number,
	srcAddr: number,
	wordCount: number,
];

export type VdpRpuBeginPassPacket = readonly [
	op: typeof VDP_RPU_OP_BEGIN_PASS,
	colorSurfaceId: number,
	depthSurfaceId: number,
	viewportXY: number,
	viewportWH: number,
	passOps: number,
	clearColor: number,
	clearDepthWord: number,
];

export type VdpRpuBeginDrawPacket = readonly [
	op: typeof VDP_RPU_OP_BEGIN_DRAW,
	shaderVariant: number,
	primitiveIndexType: number,
	pipelineWord: number,
	vertexCount: number,
	instanceCount: number,
	indexBufferId: number,
	indexByteOffset: number,
	indexCount: number,
];

export type VdpRpuBindStreamPacket = readonly [
	op: typeof VDP_RPU_OP_BIND_STREAM,
	streamSlot: number,
	layoutId: number,
	bufferId: number,
	byteOffset: number,
	stepRate: number,
];

export type VdpRpuBindConstantsPacket = readonly [
	op: typeof VDP_RPU_OP_BIND_CONSTANTS,
	bindingSlot: number,
	bankId: number,
	firstWord: number,
	wordCount: number,
];

export type VdpRpuBindTexturePacket = readonly [
	op: typeof VDP_RPU_OP_BIND_TEXTURE,
	textureSlot: number,
	surfaceId: number,
	samplerWord: number,
];

export type VdpRpuBufferRecord = {
	bufferId: number;
	liveRevision: number;
	byteLength: number;
	usage: number;
};

export type VdpRpuBufferRevision = {
	bufferId: number;
	revision: number;
	bytes: Uint8Array;
};

export type VdpRpuSurfaceRecord = {
	surfaceId: number;
	liveRevision: number;
	width: number;
	height: number;
	format: number;
	usage: number;
};

export type VdpRpuSurfaceRevision = {
	surfaceId: number;
	revision: number;
	bytes: Uint8Array;
};

export type VdpRpuFrameResources = Readonly<{
	bufferRevisions: VdpRpuBufferRevision[];
	surfaceRevisions: VdpRpuSurfaceRevision[];
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
	public readonly bufferId = new Uint32Array(VDP_RPU_BUFFER_REF_CAPACITY);
	public readonly revision = new Uint32Array(VDP_RPU_BUFFER_REF_CAPACITY);
	public readonly byteOffset = new Uint32Array(VDP_RPU_BUFFER_REF_CAPACITY);
	public readonly byteLength = new Uint32Array(VDP_RPU_BUFFER_REF_CAPACITY);
	public readonly usage = new Uint8Array(VDP_RPU_BUFFER_REF_CAPACITY);
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
	public streamBindingCount = 0;
	public constantBindingCount = 0;
	public textureBindingCount = 0;
	public readonly passFirstDraw = new Uint32Array(VDP_RPU_PASS_CAPACITY);
	public readonly passDrawCount = new Uint16Array(VDP_RPU_PASS_CAPACITY);
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
	public readonly streamLayoutId = new Uint16Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly streamBufferRef = new Uint16Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly streamByteOffset = new Uint32Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly streamStepRate = new Uint8Array(VDP_RPU_STREAM_BINDING_CAPACITY);
	public readonly constantBindingSlot = new Uint8Array(VDP_RPU_CONSTANT_BINDING_CAPACITY);
	public readonly constantBank = new Uint16Array(VDP_RPU_CONSTANT_BINDING_CAPACITY);
	public readonly constantFirstWord = new Uint16Array(VDP_RPU_CONSTANT_BINDING_CAPACITY);
	public readonly constantWordCount = new Uint16Array(VDP_RPU_CONSTANT_BINDING_CAPACITY);
	public readonly textureSlot = new Uint8Array(VDP_RPU_TEXTURE_BINDING_CAPACITY);
	public readonly textureSurfaceRef = new Uint16Array(VDP_RPU_TEXTURE_BINDING_CAPACITY);
	public readonly textureSamplerWord = new Uint32Array(VDP_RPU_TEXTURE_BINDING_CAPACITY);
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
	attributes: readonly VdpRpuStreamAttributeSpec[];
}>;

export const VDP_RPU_STREAM_LAYOUTS: readonly VdpRpuStreamLayoutSpec[] = [
	{
		id: VDP_RPU_LAYOUT_V2_C4,
		byteStride: 12,
		attributes: [
			{ attribute: VDP_RPU_ATTR_POS, componentCount: 2, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 8 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_V2_T2_C4,
		byteStride: 20,
		attributes: [
			{ attribute: VDP_RPU_ATTR_POS, componentCount: 2, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_UV0, componentCount: 2, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 8 },
			{ attribute: VDP_RPU_ATTR_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 16 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_V3_C4,
		byteStride: 16,
		attributes: [
			{ attribute: VDP_RPU_ATTR_POS, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 12 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_V3_T2_C4,
		byteStride: 24,
		attributes: [
			{ attribute: VDP_RPU_ATTR_POS, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_UV0, componentCount: 2, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 12 },
			{ attribute: VDP_RPU_ATTR_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 20 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_V3_N3_C4,
		byteStride: 28,
		attributes: [
			{ attribute: VDP_RPU_ATTR_POS, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_NORMAL, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 12 },
			{ attribute: VDP_RPU_ATTR_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 24 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_V3_N3_T2_C4,
		byteStride: 36,
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
		id: VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4,
		byteStride: 44,
		attributes: [
			{ attribute: VDP_RPU_ATTR_INSTANCE0, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 0 },
			{ attribute: VDP_RPU_ATTR_INSTANCE1, componentCount: 3, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 12 },
			{ attribute: VDP_RPU_ATTR_INSTANCE_UVRECT, componentCount: 4, componentType: VDP_RPU_ATTR_F32, normalized: 0, byteOffset: 24 },
			{ attribute: VDP_RPU_ATTR_INSTANCE_COLOR, componentCount: 4, componentType: VDP_RPU_ATTR_U8N, normalized: 1, byteOffset: 40 },
		],
	},
	{
		id: VDP_RPU_LAYOUT_I_MAT4_C4,
		byteStride: 68,
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
	textureSlotCount: number;
	constantSlots: readonly VdpRpuShaderConstantSlotSpec[];
}>;

export const VDP_RPU_SHADER_VARIANTS: readonly VdpRpuShaderVariantSpec[] = [
	{
		id: VDP_RPU_SHADER_V2_C4,
		requiredFeatureMask: 0,
		vertexLayout: VDP_RPU_LAYOUT_V2_C4,
		instanceLayout: VDP_RPU_RESOURCE_NONE,
		textureSlotCount: 0,
		constantSlots: [],
	},
	{
		id: VDP_RPU_SHADER_V2_T2_C4,
		requiredFeatureMask: 0,
		vertexLayout: VDP_RPU_LAYOUT_V2_T2_C4,
		instanceLayout: VDP_RPU_RESOURCE_NONE,
		textureSlotCount: 1,
		constantSlots: [],
	},
	{
		id: VDP_RPU_SHADER_V3_C4_C0,
		requiredFeatureMask: 0,
		vertexLayout: VDP_RPU_LAYOUT_V3_C4,
		instanceLayout: VDP_RPU_RESOURCE_NONE,
		textureSlotCount: 0,
		constantSlots: [
			{ slot: 0, maxWords: 32, vertexVisible: 1, fragmentVisible: 0 },
		],
	},
	{
		id: VDP_RPU_SHADER_V3_T2_C4_C0,
		requiredFeatureMask: 0,
		vertexLayout: VDP_RPU_LAYOUT_V3_T2_C4,
		instanceLayout: VDP_RPU_RESOURCE_NONE,
		textureSlotCount: 1,
		constantSlots: [
			{ slot: 0, maxWords: 32, vertexVisible: 1, fragmentVisible: 0 },
		],
	},
	{
		id: VDP_RPU_SHADER_V3_N3_T2_C4_C0_C1,
		requiredFeatureMask: 0,
		vertexLayout: VDP_RPU_LAYOUT_V3_N3_T2_C4,
		instanceLayout: VDP_RPU_RESOURCE_NONE,
		textureSlotCount: 1,
		constantSlots: [
			{ slot: 0, maxWords: 32, vertexVisible: 1, fragmentVisible: 0 },
			{ slot: 1, maxWords: 64, vertexVisible: 0, fragmentVisible: 1 },
		],
	},
	{
		id: VDP_RPU_SHADER_V3_N3_T2_C4_J4_W4_C0_C1,
		requiredFeatureMask: 0,
		vertexLayout: VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4,
		instanceLayout: VDP_RPU_RESOURCE_NONE,
		textureSlotCount: 1,
		constantSlots: [
			{ slot: 0, maxWords: 32, vertexVisible: 1, fragmentVisible: 0 },
			{ slot: 1, maxWords: 384, vertexVisible: 1, fragmentVisible: 0 },
			{ slot: 2, maxWords: 64, vertexVisible: 0, fragmentVisible: 1 },
		],
	},
	{
		id: VDP_RPU_SHADER_V2_T2_C4_I_AFFINE2,
		requiredFeatureMask: VDP_RPU_FEATURE_INSTANCED_ARRAYS,
		vertexLayout: VDP_RPU_LAYOUT_V2_T2_C4,
		instanceLayout: VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4,
		textureSlotCount: 1,
		constantSlots: [],
	},
	{
		id: VDP_RPU_SHADER_V3_C4_I_MAT4,
		requiredFeatureMask: VDP_RPU_FEATURE_INSTANCED_ARRAYS,
		vertexLayout: VDP_RPU_LAYOUT_V3_C4,
		instanceLayout: VDP_RPU_LAYOUT_I_MAT4_C4,
		textureSlotCount: 0,
		constantSlots: [],
	},
];

export type VdpRpuCommandBufferSaveState = {
	passCount: number;
	drawCount: number;
	streamBindingCount: number;
	constantBindingCount: number;
	textureBindingCount: number;
	passFirstDraw: number[];
	passDrawCount: number[];
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
	streamLayoutId: number[];
	streamBufferRef: number[];
	streamByteOffset: number[];
	streamStepRate: number[];
	constantBindingSlot: number[];
	constantBank: number[];
	constantFirstWord: number[];
	constantWordCount: number[];
	textureSlot: number[];
	textureSurfaceRef: number[];
	textureSamplerWord: number[];
};

export type VdpRpuFrameBufferRefSaveState = {
	bufferId: number;
	revision: number;
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
	surfaceRefs: VdpRpuFrameSurfaceRefSaveState[];
	bufferRevisions: VdpRpuBufferRevisionSaveState[];
	surfaceRevisions: VdpRpuSurfaceRevisionSaveState[];
	constantWords: number[];
	constantBanks: VdpRpuConstantBankSaveState[];
};

export type VdpRpuBufferRecordSaveState = {
	bufferId: number;
	liveRevision: number;
	byteLength: number;
	usage: number;
};

export type VdpRpuBufferRevisionSaveState = {
	bufferId: number;
	revision: number;
	bytes: number[];
};

export type VdpRpuSurfaceRecordSaveState = {
	surfaceId: number;
	liveRevision: number;
	width: number;
	height: number;
	format: number;
	usage: number;
};

export type VdpRpuSurfaceRevisionSaveState = {
	surfaceId: number;
	revision: number;
	bytes: number[];
};

export type VdpRpuSaveState = {
	buildState: VdpRpuFrameBuildState;
	buffers: VdpRpuBufferRecordSaveState[];
	bufferRevisions: VdpRpuBufferRevisionSaveState[];
	surfaces: VdpRpuSurfaceRecordSaveState[];
	surfaceRevisions: VdpRpuSurfaceRevisionSaveState[];
	buildingFrame: VdpRpuFrameSaveState;
	activeFrame: VdpRpuFrameSaveState;
	pendingFrame: VdpRpuFrameSaveState;
	visibleFrame: VdpRpuFrameSaveState;
};

export function createVdpRpuFrameOutput(): VdpRpuFrameOutput {
	return {
		commands: new VdpRpuCommandBuffer(),
		resources: {
			bufferRevisions: [],
			surfaceRevisions: [],
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
	frame.commands.streamBindingCount = 0;
	frame.commands.constantBindingCount = 0;
	frame.commands.textureBindingCount = 0;
	frame.resources.bufferRevisions.length = 0;
	frame.resources.surfaceRevisions.length = 0;
	frame.resources.bufferRefs.length = 0;
	frame.resources.surfaceRefs.length = 0;
	frame.resources.constantBanks.length = 0;
}

function captureVdpRpuCommandBufferState(commands: VdpRpuCommandBuffer): VdpRpuCommandBufferSaveState {
	return {
		passCount: commands.passCount,
		drawCount: commands.drawCount,
		streamBindingCount: commands.streamBindingCount,
		constantBindingCount: commands.constantBindingCount,
		textureBindingCount: commands.textureBindingCount,
		passFirstDraw: Array.from(commands.passFirstDraw.subarray(0, commands.passCount)),
		passDrawCount: Array.from(commands.passDrawCount.subarray(0, commands.passCount)),
		passColorSurfaceRef: Array.from(commands.passColorSurfaceRef.subarray(0, commands.passCount)),
		passDepthSurfaceRef: Array.from(commands.passDepthSurfaceRef.subarray(0, commands.passCount)),
		passViewportXY: Array.from(commands.passViewportXY.subarray(0, commands.passCount)),
		passViewportWH: Array.from(commands.passViewportWH.subarray(0, commands.passCount)),
		passOps: Array.from(commands.passOps.subarray(0, commands.passCount)),
		passClearColor: Array.from(commands.passClearColor.subarray(0, commands.passCount)),
		passClearDepthWord: Array.from(commands.passClearDepthWord.subarray(0, commands.passCount)),
		drawShaderVariant: Array.from(commands.drawShaderVariant.subarray(0, commands.drawCount)),
		drawPrimitive: Array.from(commands.drawPrimitive.subarray(0, commands.drawCount)),
		drawPipelineWord: Array.from(commands.drawPipelineWord.subarray(0, commands.drawCount)),
		drawVertexCount: Array.from(commands.drawVertexCount.subarray(0, commands.drawCount)),
		drawInstanceCount: Array.from(commands.drawInstanceCount.subarray(0, commands.drawCount)),
		drawIndexBufferRef: Array.from(commands.drawIndexBufferRef.subarray(0, commands.drawCount)),
		drawIndexByteOffset: Array.from(commands.drawIndexByteOffset.subarray(0, commands.drawCount)),
		drawIndexCount: Array.from(commands.drawIndexCount.subarray(0, commands.drawCount)),
		drawIndexType: Array.from(commands.drawIndexType.subarray(0, commands.drawCount)),
		drawFirstStreamBinding: Array.from(commands.drawFirstStreamBinding.subarray(0, commands.drawCount)),
		drawStreamBindingCount: Array.from(commands.drawStreamBindingCount.subarray(0, commands.drawCount)),
		drawFirstConstantBinding: Array.from(commands.drawFirstConstantBinding.subarray(0, commands.drawCount)),
		drawConstantBindingCount: Array.from(commands.drawConstantBindingCount.subarray(0, commands.drawCount)),
		drawFirstTextureBinding: Array.from(commands.drawFirstTextureBinding.subarray(0, commands.drawCount)),
		drawTextureBindingCount: Array.from(commands.drawTextureBindingCount.subarray(0, commands.drawCount)),
		streamLayoutId: Array.from(commands.streamLayoutId.subarray(0, commands.streamBindingCount)),
		streamBufferRef: Array.from(commands.streamBufferRef.subarray(0, commands.streamBindingCount)),
		streamByteOffset: Array.from(commands.streamByteOffset.subarray(0, commands.streamBindingCount)),
		streamStepRate: Array.from(commands.streamStepRate.subarray(0, commands.streamBindingCount)),
		constantBindingSlot: Array.from(commands.constantBindingSlot.subarray(0, commands.constantBindingCount)),
		constantBank: Array.from(commands.constantBank.subarray(0, commands.constantBindingCount)),
		constantFirstWord: Array.from(commands.constantFirstWord.subarray(0, commands.constantBindingCount)),
		constantWordCount: Array.from(commands.constantWordCount.subarray(0, commands.constantBindingCount)),
		textureSlot: Array.from(commands.textureSlot.subarray(0, commands.textureBindingCount)),
		textureSurfaceRef: Array.from(commands.textureSurfaceRef.subarray(0, commands.textureBindingCount)),
		textureSamplerWord: Array.from(commands.textureSamplerWord.subarray(0, commands.textureBindingCount)),
	};
}

function restoreVdpRpuCommandBufferState(commands: VdpRpuCommandBuffer, state: VdpRpuCommandBufferSaveState): void {
	commands.passCount = state.passCount;
	commands.drawCount = state.drawCount;
	commands.streamBindingCount = state.streamBindingCount;
	commands.constantBindingCount = state.constantBindingCount;
	commands.textureBindingCount = state.textureBindingCount;
	commands.passFirstDraw.set(state.passFirstDraw);
	commands.passDrawCount.set(state.passDrawCount);
	commands.passColorSurfaceRef.set(state.passColorSurfaceRef);
	commands.passDepthSurfaceRef.set(state.passDepthSurfaceRef);
	commands.passViewportXY.set(state.passViewportXY);
	commands.passViewportWH.set(state.passViewportWH);
	commands.passOps.set(state.passOps);
	commands.passClearColor.set(state.passClearColor);
	commands.passClearDepthWord.set(state.passClearDepthWord);
	commands.drawShaderVariant.set(state.drawShaderVariant);
	commands.drawPrimitive.set(state.drawPrimitive);
	commands.drawPipelineWord.set(state.drawPipelineWord);
	commands.drawVertexCount.set(state.drawVertexCount);
	commands.drawInstanceCount.set(state.drawInstanceCount);
	commands.drawIndexBufferRef.set(state.drawIndexBufferRef);
	commands.drawIndexByteOffset.set(state.drawIndexByteOffset);
	commands.drawIndexCount.set(state.drawIndexCount);
	commands.drawIndexType.set(state.drawIndexType);
	commands.drawFirstStreamBinding.set(state.drawFirstStreamBinding);
	commands.drawStreamBindingCount.set(state.drawStreamBindingCount);
	commands.drawFirstConstantBinding.set(state.drawFirstConstantBinding);
	commands.drawConstantBindingCount.set(state.drawConstantBindingCount);
	commands.drawFirstTextureBinding.set(state.drawFirstTextureBinding);
	commands.drawTextureBindingCount.set(state.drawTextureBindingCount);
	commands.streamLayoutId.set(state.streamLayoutId);
	commands.streamBufferRef.set(state.streamBufferRef);
	commands.streamByteOffset.set(state.streamByteOffset);
	commands.streamStepRate.set(state.streamStepRate);
	commands.constantBindingSlot.set(state.constantBindingSlot);
	commands.constantBank.set(state.constantBank);
	commands.constantFirstWord.set(state.constantFirstWord);
	commands.constantWordCount.set(state.constantWordCount);
	commands.textureSlot.set(state.textureSlot);
	commands.textureSurfaceRef.set(state.textureSurfaceRef);
	commands.textureSamplerWord.set(state.textureSamplerWord);
}

function captureVdpRpuFrameBufferRefsState(refs: VdpRpuFrameBufferRefs): VdpRpuFrameBufferRefSaveState[] {
	const states = new Array<VdpRpuFrameBufferRefSaveState>(refs.length);
	for (let index = 0; index < refs.length; index += 1) {
		states[index] = {
			bufferId: refs.bufferId[index],
			revision: refs.revision[index],
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
		refs.byteOffset[index] = state.byteOffset;
		refs.byteLength[index] = state.byteLength;
		refs.usage[index] = state.usage;
	}
}

function captureVdpRpuFrameSurfaceRefsState(refs: VdpRpuFrameSurfaceRefs): VdpRpuFrameSurfaceRefSaveState[] {
	const states = new Array<VdpRpuFrameSurfaceRefSaveState>(refs.length);
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
	const states = new Array<VdpRpuConstantBankSaveState>(banks.length);
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
	return Array.from(frame.resources.constantWords.subarray(0, wordCount));
}

export function captureVdpRpuFrameState(frame: VdpRpuFrameOutput): VdpRpuFrameSaveState {
	return {
		commands: captureVdpRpuCommandBufferState(frame.commands),
		bufferRefs: captureVdpRpuFrameBufferRefsState(frame.resources.bufferRefs),
		surfaceRefs: captureVdpRpuFrameSurfaceRefsState(frame.resources.surfaceRefs),
		bufferRevisions: frame.resources.bufferRevisions.map((revision) => ({
			bufferId: revision.bufferId,
			revision: revision.revision,
			bytes: Array.from(revision.bytes),
		})),
		surfaceRevisions: frame.resources.surfaceRevisions.map((revision) => ({
			surfaceId: revision.surfaceId,
			revision: revision.revision,
			bytes: Array.from(revision.bytes),
		})),
		constantWords: captureVdpRpuConstantWords(frame),
		constantBanks: captureVdpRpuConstantBankState(frame.resources.constantBanks),
	};
}

export function restoreVdpRpuFrameState(frame: VdpRpuFrameOutput, state: VdpRpuFrameSaveState): void {
	resetVdpRpuFrameOutput(frame);
	restoreVdpRpuCommandBufferState(frame.commands, state.commands);
	restoreVdpRpuFrameBufferRefsState(frame.resources.bufferRefs, state.bufferRefs);
	restoreVdpRpuFrameSurfaceRefsState(frame.resources.surfaceRefs, state.surfaceRefs);
	for (let index = 0; index < state.bufferRevisions.length; index += 1) {
		const revision = state.bufferRevisions[index];
		frame.resources.bufferRevisions.push({
			bufferId: revision.bufferId,
			revision: revision.revision,
			bytes: new Uint8Array(revision.bytes),
		});
	}
	for (let index = 0; index < state.surfaceRevisions.length; index += 1) {
		const revision = state.surfaceRevisions[index];
		frame.resources.surfaceRevisions.push({
			surfaceId: revision.surfaceId,
			revision: revision.revision,
			bytes: new Uint8Array(revision.bytes),
		});
	}
	frame.resources.constantWords.set(state.constantWords);
	restoreVdpRpuConstantBankState(frame.resources.constantBanks, state.constantBanks);
}
