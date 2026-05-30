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

export const VDP_RPU_REQUIRED_FEATURES = VDP_RPU_FEATURE_INSTANCED_ARRAYS | VDP_RPU_FEATURE_UINT_INDEX;
```

Baseline decisions:

- WebGL1 requires `ANGLE_instanced_arrays`.
- GLES2 requires an equivalent instancing extension.
- `U16` indices are core.
- `U32` indices are part of the baseline RPU backend contract. WebGL2 provides this directly; GLES2 must expose `GL_OES_element_index_uint` during backend initialization.
- Depth attachments are renderbuffer-style in the baseline.
- Sampling from a depth texture requires `VDP_RPU_FEATURE_DEPTH_TEXTURE`.

## Representable weird command buffers

The RPU is an emulated hardware unit, not a high-level host graphics API. Packet
admission may still fault structural stream/resource errors such as malformed
packet lengths, impossible buffer ranges, or missing resources. Backend feature
availability is a host/backend initialization contract, not a cart-visible RPU
fault. After admission, however, a representable retained command buffer is
backend input as-is. The WebGL/GLES2 executor must not add a second semantic
validation layer that rejects cart-visible draws because they
look like mismatched layouts, odd state combinations, or nonsense constants.
Raw pipeline bits, primitive/index selector bits, color masks,
usage bits, format bits, slot words, and defined-or-unknown stream layout ids
are retained as programmed. Shader selection is a fixed low-bit selector, so
high bits do not create an unavailable host shader; they decode to one of the
fixed variants. Those cases should flow to the GPU and produce
deterministic-but-weird rendered output.
Draw vertex/instance/index counts are also raw words. Buffer pin byte-span
calculation uses register-word arithmetic; count overflow wraps into the pinned
span instead of becoming a semantic draw rejection. The backend still receives
the original draw counts.

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
export const VDP_RPU_OP_CONSTANT_UPLOAD_DEVICE = 19;

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

export type VdpRpuConstantUploadDevicePacket = readonly [
	op: typeof VDP_RPU_OP_CONSTANT_UPLOAD_DEVICE,
	bankId: number,
	dstWordOffset: number,
	sourceWord: number,
	sourceWordOffset: number,
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
];
```

Stream slots are fixed shader inputs, not semantic unit categories. Slot `0`
feeds the vertex attribute stream for the selected fixed shader variant. Slot
`1` feeds the instance attribute stream for instanced variants. Other
representable slot values are retained but not consumed by the baseline fixed
shader inputs. Multiple binds to the same consumed slot are deterministic: the
last bind in the draw wins.

## Device constant upload

`CONSTANT_UPLOAD_DEVICE` is the bridge from existing VDP datapath registers to
ordinary RPU constant banks. It does not add semantic host-output categories:
XF/LPU/MFU/JTU remain VDP-owned registerfiles, and the RPU copies their raw
words into `constantWords` during packet admission. After that, the backend sees
only normal bound constants.

Payload:

```ts
[
	VDP_RPU_OP_CONSTANT_UPLOAD_DEVICE,
	bankId,
	dstWordOffset,
	sourceWord,
	sourceWordOffset,
	wordCount,
]
```

Source selector is `sourceWord & VDP_RPU_CONSTANT_SOURCE_MASK`; high bits are
weird-but-representable and ignored. `XF_Q16`, `MFU_Q16`, and `JTU_Q16` decode
signed Q16.16 register words to IEEE `f32` words before writing the RPU constant
bank. `LPU_RAW` copies the light register words unchanged. Out-of-range source
or destination spans are structural range faults. There is still no
`VdpDeviceOutput.xf`, `.lpu`, `.mfu`, or `.jtu` payload.

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

The runtime resource model is a fixed RPU-owned buffer arena plus resource
records. Retained command buffers pin refs into that arena; they do not own
immutable per-frame byte copies.

```ts
export type VdpRpuBufferRecord = {
	bufferId: number;
	liveRevision: number;
	byteLength: number;
	usage: number;
};

export type VdpRpuSurfaceRecord = {
	surfaceId: number;
	liveRevision: number;
	width: number;
	height: number;
	format: number;
	usage: number;
};
```

Rules:

- `BUFFER_DEFINE` and `SURFACE_DEFINE` create or replace the live record with a new revision.
- Uploads mutate the RPU arena bytes directly and bump the live revision word.
- Draw admission pins exact `(id, revision, offset, length)` refs into that arena.
- VOUT keeps retained refs visible, but those refs are live aliases to RPU
  arena storage, not snapshots.
- If the cart mutates a buffer after a submitted or visible command buffer has
  pinned it, the retained command sees the current arena bytes. That is
  representable emulator behavior: it may render weirdly, and the backend must
  not reject it as a high-level API misuse.
- Structural resource errors still fault at admission: missing resources,
  out-of-range byte spans, capacity overflow, zero-size surfaces, or malformed
  packets.
- Buffer usage bits and surface usage/format mismatches are retained raw
  metadata. They are not a high-level API validation gate for draws, texture
  binds, or pass attachments.
- Host backends materialize pinned RPU-owned `RGBA8` color attachments as GPU
  textures and pinned `DEPTH16` depth attachments as renderbuffers. The retained
  command buffer carries only raw surface refs; attachment storage is backend
  runtime cache, not serialized frame state.
- Save-state is the persistence boundary that serializes the live RPU arena
  prefixes needed by defined buffers; restored frame refs are rebound to that
  arena.

Frame resources:

```ts
export type VdpRpuFrameResources = Readonly<{
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
	public readonly bytes: Uint8Array[];
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

## Pass, pipeline, and primitive words

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

Representable raw-word rules:

- `passOps`, `pipelineWord`, primitive bits, and index-type bits are retained as raw words after structural packet/resource admission.
- Unknown enum values in blend/depth/cull/primitive/index fields do not fault merely because they are weird.
- Unknown stream layout ids do not fault once the buffer range can be pinned;
  admission uses the baseline `V2_C4` stride for range pinning, and the backend
  consumes the retained layout id through its deterministic layout decoder.
- The backend maps the retained raw words onto WebGL/GLES2 state deterministically; weird-but-representable state may render weirdly. Texture sampling is fixed nearest/clamp and is not part of the packet ABI.

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
The baseline host executor maps `V2_T2_C4_I_AFFINE2` and `V3_C4_I_MAT4` to
GPU instanced drawcalls. It must not expand instances on the CPU; a backend
without instanced arrays lacks the required RPU feature.
The `V3_N3_T2_C4_C0_C1` and `V3_N3_T2_C4_J4_W4_C0_C1` variants are likewise
fixed GPU datapaths: C0 is the transform matrix block, C1 is the raw fragment
lighting/material block, and the skinned variant reads raw joint matrices from
constant slot 1. The VDP does not interpret those values as mesh, model, or
gameplay semantics; the shader consumes the programmed words directly.

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
export const VDP_RPU_SHADER_VARIANT_MASK = 0x00000007;

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

`BEGIN_DRAW.shaderVariant` is decoded with `VDP_RPU_SHADER_VARIANT_MASK`.
The retained command buffer stores the decoded fixed variant selector; high
shader-word bits are weird-but-representable cart state, not a host-shader
validation fault.

## Fault model

```ts
export const VDP_FAULT_RPU_BAD_PACKET = 0x0700;
export const VDP_FAULT_RPU_BAD_STREAM_LAYOUT = 0x0702;
export const VDP_FAULT_RPU_BUFFER_OOB = 0x0703;
export const VDP_FAULT_RPU_STALE_RESOURCE = 0x0704;
export const VDP_FAULT_RPU_BAD_SURFACE_USAGE = 0x0705;
export const VDP_FAULT_RPU_BAD_CONSTANT_RANGE = 0x0706;
export const VDP_FAULT_RPU_COMMAND_OVERFLOW = 0x0708;
export const VDP_FAULT_RPU_BAD_STATE = 0x0709;
```

Admission mapping:

| Condition | Fault |
|---|---|
| Bad RPU packet kind, payload count, reserved header flags, or variable payload length | `VDP_FAULT_RPU_BAD_PACKET` |
| RPU op in the wrong lifecycle state | `VDP_FAULT_RPU_BAD_STATE` |
| Pass, draw, stream, constant, texture, buffer-ref, or surface-ref capacity overflow | `VDP_FAULT_RPU_COMMAND_OVERFLOW` |
| Stream binding outside fixed command storage | `VDP_FAULT_RPU_BAD_STREAM_LAYOUT` |
| Buffer id missing or byte range OOB | `VDP_FAULT_RPU_BUFFER_OOB` |
| RPU arena/resource-table save-state cannot be rebound to retained refs | `VDP_FAULT_RPU_STALE_RESOURCE` |
| Surface id missing, zero-size surface, or surface-ref capacity overflow | `VDP_FAULT_RPU_BAD_SURFACE_USAGE` |
| Constant bank missing or range outside bank/table | `VDP_FAULT_RPU_BAD_CONSTANT_RANGE` |

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

export type VdpRpuSaveState = {
	buildState: number;
	openPassIndex: number;
	openDrawIndex: number;
	buffers: VdpRpuBufferRecordSaveState[];
	bufferImages: VdpRpuBufferImageSaveState[];
	surfaces: VdpRpuSurfaceRecordSaveState[];
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
