# VDP RPU ABI Draft

This draft defines the data contract for replacing the cart-visible DEX/BBU/MDU/SBX render units with one Render Processing Unit (RPU). It is intentionally a data-shape and ABI inventory, not an implementation. The RPU consumes raw buffers, raw surfaces, raw constants, and retained draw commands. The host backend executes those commands as WebGL/GLES2 draw calls and must not infer cart intent such as billboard, mesh, parallax, or skybox.

The cart owns vertex data, instance data, index data, texture coordinates, transforms, axes, UV rectangles, lighting/material constants, and draw ordering. The VDP stores and seals raw words and frame-pinned resources. VOUT exposes one retained RPU frame payload.

## Host output shape

`VdpDeviceOutput` must stop exposing unit categories. The visible output is scanout metadata plus one RPU frame transaction.

```ts
export type VdpDeviceOutput = Readonly<{
	ditherType: number;
	scanoutPhase: number;
	scanoutX: number;
	scanoutY: number;
	frameBufferWidth: number;
	frameBufferHeight: number;
	rpu: VdpRpuFrameOutput;
}>;

export type VdpRpuFrameOutput = Readonly<{
	commands: VdpRpuCommandBuffer;
	resources: VdpRpuFrameResources;
}>;
```

There are no `billboards`, `meshes`, `skyboxSamples`, `parallaxWeight`, ROM mesh tokens, material asset tokens, or dedicated XF/LPU/MFU/JTU snapshots in this output. Historical producers may be migrated internally, but the output ABI is generic.

## Fixed capacities

```ts
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
```

The fixed-capacity retained buffers mirror the existing VDP discipline: per-field arrays plus length latches, not per-command objects in runtime hot paths.

## Backend feature contract

The RPU is a GPU draw ABI. The WebGL/GLES2 backend must either support the required feature set or reject the RPU backend. It must not silently route through CPU expansion or software rasterization. The existing explicit software/headless backend remains the only CPU rendering path.

```ts
export const VDP_RPU_FEATURE_INSTANCED_ARRAYS = 1 << 0;
export const VDP_RPU_FEATURE_UINT_INDEX = 1 << 1;
export const VDP_RPU_FEATURE_DEPTH_TEXTURE = 1 << 2;

export const VDP_RPU_REQUIRED_FEATURES = VDP_RPU_FEATURE_INSTANCED_ARRAYS;
```

Baseline decisions:

- WebGL1 requires `ANGLE_instanced_arrays`.
- GLES2 requires an equivalent instancing extension.
- `U16` indices are core.
- `U32` indices require `VDP_RPU_FEATURE_UINT_INDEX`.
- Depth attachments are renderbuffer-style in the baseline.
- Sampling from a depth texture requires `VDP_RPU_FEATURE_DEPTH_TEXTURE`.

## Stream packet header

The RPU uses the same sealed-stream header shape as other VDP unit packets.

```ts
export const VDP_RPU_PACKET_KIND = 0x18000000;
```

Header layout:

- bits 31..24: packet kind;
- bits 23..16: payload word count;
- bits 15..0: flags/reserved, must be zero.

Payload word 0 is an RPU operation code.

```ts
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
```

Exact payload word counts:

```ts
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
```

Variable inline uploads must have enough data words for their byte/word count. Extra trailing words are part of the packet payload only when the header word count includes them.

## Submit lifecycle

```ts
export const VDP_RPU_FRAME_IDLE = 0;
export const VDP_RPU_FRAME_OPEN = 1;
export const VDP_RPU_PASS_OPEN = 2;
export const VDP_RPU_DRAW_OPEN = 3;

export type VdpRpuFrameBuildState =
	| typeof VDP_RPU_FRAME_IDLE
	| typeof VDP_RPU_FRAME_OPEN
	| typeof VDP_RPU_PASS_OPEN
	| typeof VDP_RPU_DRAW_OPEN;
```

Lifecycle rules:

- `VDP_CMD_BEGIN_FRAME` opens an RPU frame.
- RPU packets are valid only while an RPU frame is open.
- `BEGIN_PASS` requires an open frame and no open pass/draw.
- `BEGIN_DRAW` requires an open pass and no open draw.
- `BIND_*` requires an open draw.
- `END_DRAW` commits the current draw.
- `END_PASS` commits the current pass.
- `VDP_CMD_END_FRAME` requires no open pass/draw and seals the frame.

## Packet payload schemas

```ts
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
```

## Resource usage and revisions

```ts
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
```

The resource model is multi-revision backing store:

```ts
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
```

Rules:

- `BUFFER_DEFINE` and `SURFACE_DEFINE` create or replace the live record with a new revision.
- Uploads mutate the live revision only while no sealed/pending/visible frame pins that revision range.
- Uploads against pinned live data create a new live revision at the resource boundary.
- Draw admission pins exact `(id, revision, offset, length)` refs.
- VOUT keeps pinned refs alive while a frame is visible.
- Revisions without live, pending, active, or visible refs may be released.
- Host output receives pinned refs plus immutable pinned revision payloads, never mutable live state.

Frame resources:

```ts
export type VdpRpuFrameResources = Readonly<{
	bufferRevisions: VdpRpuBufferRevision[];
	surfaceRevisions: VdpRpuSurfaceRevision[];
	bufferRefs: VdpRpuFrameBufferRefs;
	surfaceRefs: VdpRpuFrameSurfaceRefs;
	constantWords: Uint32Array;
	constantBanks: VdpRpuConstantBankTable;
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
```

## Pass, pipeline, sampler, and primitive words

```ts
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
```

Reserved-bit rules:

- `(passOps & ~VDP_RPU_PASS_OPS_MASK) !== 0` faults.
- `(pipelineWord & ~VDP_RPU_PIPELINE_WORD_MASK) !== 0` faults.
- `(samplerWord & ~VDP_RPU_SAMPLER_WORD_MASK) !== 0` faults.
- Unknown enum values in blend/depth/cull/filter/wrap/primitive/index fields fault.
- NPOT texture surfaces require clamp wrapping and non-mip filtering.

## Retained command buffer

```ts
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
```

## Stream layouts

```ts
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
```

Draft closed table:

```ts
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
```

Instance affine and UV-rect fields are raw layout fields. They are not a sprite, billboard, parallax, or skybox contract.

## Shader variants

```ts
export const VDP_RPU_SHADER_V2_C4 = 0;
export const VDP_RPU_SHADER_V2_T2_C4 = 1;
export const VDP_RPU_SHADER_V3_C4_C0 = 2;
export const VDP_RPU_SHADER_V3_T2_C4_C0 = 3;
export const VDP_RPU_SHADER_V3_N3_T2_C4_C0_C1 = 4;
export const VDP_RPU_SHADER_V3_N3_T2_C4_J4_W4_C0_C1 = 5;
export const VDP_RPU_SHADER_V2_T2_C4_I_AFFINE2 = 6;
export const VDP_RPU_SHADER_V3_C4_I_MAT4 = 7;

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
```

Draft closed table:

```ts
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
```

`C0`, `C1`, and `C2` are generic constant slots. Their contents are defined by the fixed shader variant and uploaded by the cart as raw words.

## Fault model

```ts
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
```

Admission mapping:

| Condition | Fault |
|---|---|
| Bad RPU packet kind, payload count, reserved header flags, or variable payload length | `VDP_FAULT_RPU_BAD_PACKET` |
| RPU op in the wrong lifecycle state | `VDP_FAULT_RPU_BAD_STATE` |
| Pass, draw, stream, constant, texture, buffer-ref, or surface-ref capacity overflow | `VDP_FAULT_RPU_COMMAND_OVERFLOW` |
| Unknown shader variant | `VDP_FAULT_RPU_BAD_SHADER` |
| Stream layout does not match the shader variant slot | `VDP_FAULT_RPU_BAD_STREAM_LAYOUT` |
| Buffer id missing, usage mismatch, or byte range OOB | `VDP_FAULT_RPU_BUFFER_OOB` |
| Missing pinned resource revision at seal/present | `VDP_FAULT_RPU_STALE_RESOURCE` |
| Surface id missing, usage mismatch, format mismatch, or attachment OOB | `VDP_FAULT_RPU_BAD_SURFACE_USAGE` |
| Constant bank missing or range outside bank/table | `VDP_FAULT_RPU_BAD_CONSTANT_RANGE` |
| Required backend feature unavailable or unsupported sampler/index mode | `VDP_FAULT_RPU_UNSUPPORTED_FEATURE` |

## Frame handoff ownership

The runtime has exactly one generic RPU frame payload at each frame stage:

```ts
export type VdpBuildingFrameState = {
	rpu: VdpRpuFrameOutput;
};

export type VdpSubmittedFrame = {
	rpu: VdpRpuFrameOutput;
};
```

On seal, the VDP swaps the building RPU payload into the selected submitted frame. On present, VOUT swaps the submitted RPU payload into its visible payload and exposes that payload through `VdpDeviceOutput.rpu`. The previous visible/submitted payload is reset by clearing only used-prefix counts (`passCount`, `drawCount`, binding counts, resource-ref lengths, and constant-bank length); array storage is retained and stale raw words are not part of the visible ABI.

## Save-state shapes

Save-state stores device-visible resource state and the used prefixes of retained arrays. It does not store host GL handles, shader objects, VAOs, host textures, backend queues, or scene objects.

```ts
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
	buildState: number;
	buffers: VdpRpuBufferRecordSaveState[];
	bufferRevisions: VdpRpuBufferRevisionSaveState[];
	surfaces: VdpRpuSurfaceRecordSaveState[];
	surfaceRevisions: VdpRpuSurfaceRevisionSaveState[];
	buildingFrame: VdpRpuFrameSaveState;
	activeFrame: VdpRpuFrameSaveState;
	pendingFrame: VdpRpuFrameSaveState;
	visibleFrame: VdpRpuFrameSaveState;
};
```

## Files to add in implementation phase

When this moves from draft to implementation, mirrored runtime ownership should be:

- `src/bmsx/machine/devices/vdp/rpu.ts`
- `src/bmsx_cpp/machine/devices/vdp/rpu.h`
- `src/bmsx_cpp/machine/devices/vdp/rpu.cpp`

Docs to update after the migration begins:

- replace DEX/BBU/MDU/SBX cart-visible sections in `docs/video_display_processor.md`;
- update VOUT ownership in `docs/architecture.md`;
- update save-state docs and schema notes.
