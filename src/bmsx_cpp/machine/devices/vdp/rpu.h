#pragma once

#include "common/primitives.h"
#include "machine/common/word.h"
#include "machine/devices/device_status.h"
#include "machine/devices/vdp/jtu.h"
#include "machine/devices/vdp/lpu.h"
#include "machine/devices/vdp/mfu.h"
#include "machine/devices/vdp/xf.h"
#include "machine/memory/memory.h"
#include <array>
#include <cstddef>
#include <memory>
#include <vector>

namespace bmsx {

constexpr size_t VDP_RPU_PASS_CAPACITY = 64u;
constexpr size_t VDP_RPU_DRAW_CAPACITY = 4096u;
constexpr size_t VDP_RPU_DRAW_BATCH_CAPACITY = VDP_RPU_DRAW_CAPACITY;
constexpr size_t VDP_RPU_STREAM_BINDING_CAPACITY = 8192u;
constexpr size_t VDP_RPU_CONSTANT_BINDING_CAPACITY = 8192u;
constexpr size_t VDP_RPU_TEXTURE_BINDING_CAPACITY = 4096u;
constexpr size_t VDP_RPU_BUFFER_CAPACITY = 1024u;
constexpr size_t VDP_RPU_BUFFER_SLOT_BYTE_CAPACITY = 0x00010000u;
constexpr size_t VDP_RPU_BUFFER_BYTE_CAPACITY = VDP_RPU_BUFFER_CAPACITY * VDP_RPU_BUFFER_SLOT_BYTE_CAPACITY;
constexpr size_t VDP_RPU_BUFFER_REF_CAPACITY = 4096u;
constexpr size_t VDP_RPU_FRAME_BUFFER_BYTE_CAPACITY = 0x00400000u;
constexpr size_t VDP_RPU_SURFACE_CAPACITY = 256u;
constexpr size_t VDP_RPU_SURFACE_REF_CAPACITY = 1024u;
constexpr size_t VDP_RPU_CONSTANT_BANK_CAPACITY = 256u;
constexpr size_t VDP_RPU_CONSTANT_WORD_CAPACITY = 65536u;
constexpr u32 VDP_RPU_RESOURCE_NONE = 0xffffffffu;
constexpr u32 VDP_RPU_REF_NONE = 0xffffu;

constexpr u32 VDP_RPU_FEATURE_INSTANCED_ARRAYS = 1u << 0u;
constexpr u32 VDP_RPU_FEATURE_UINT_INDEX = 1u << 1u;
constexpr u32 VDP_RPU_FEATURE_DEPTH_TEXTURE = 1u << 2u;
constexpr u32 VDP_RPU_REQUIRED_FEATURES = VDP_RPU_FEATURE_INSTANCED_ARRAYS | VDP_RPU_FEATURE_UINT_INDEX;

constexpr u32 VDP_RPU_PACKET_KIND = 0x18000000u;
constexpr u32 VDP_RPU_OP_BUFFER_DEFINE = 1u;
constexpr u32 VDP_RPU_OP_BUFFER_UPLOAD_DMA = 2u;
constexpr u32 VDP_RPU_OP_BUFFER_UPLOAD_INLINE = 3u;
constexpr u32 VDP_RPU_OP_BUFFER_DISCARD = 4u;
constexpr u32 VDP_RPU_OP_SURFACE_DEFINE = 8u;
constexpr u32 VDP_RPU_OP_CONSTANT_BANK_DEFINE = 16u;
constexpr u32 VDP_RPU_OP_CONSTANT_UPLOAD_DMA = 17u;
constexpr u32 VDP_RPU_OP_CONSTANT_UPLOAD_INLINE = 18u;
constexpr u32 VDP_RPU_OP_CONSTANT_UPLOAD_DEVICE = 19u;
constexpr u32 VDP_RPU_OP_BEGIN_PASS = 32u;
constexpr u32 VDP_RPU_OP_END_PASS = 33u;
constexpr u32 VDP_RPU_OP_BEGIN_DRAW = 40u;
constexpr u32 VDP_RPU_OP_BIND_STREAM = 41u;
constexpr u32 VDP_RPU_OP_BIND_CONSTANTS = 42u;
constexpr u32 VDP_RPU_OP_BIND_TEXTURE = 43u;
constexpr u32 VDP_RPU_OP_END_DRAW = 44u;

constexpr u32 VDP_RPU_BUFFER_DEFINE_WORDS = 4u;
constexpr u32 VDP_RPU_BUFFER_UPLOAD_DMA_WORDS = 5u;
constexpr u32 VDP_RPU_BUFFER_DISCARD_WORDS = 2u;
constexpr u32 VDP_RPU_SURFACE_DEFINE_WORDS = 4u;
constexpr u32 VDP_RPU_CONSTANT_BANK_DEFINE_WORDS = 4u;
constexpr u32 VDP_RPU_CONSTANT_UPLOAD_DMA_WORDS = 5u;
constexpr u32 VDP_RPU_CONSTANT_UPLOAD_DEVICE_WORDS = 6u;
constexpr u32 VDP_RPU_BEGIN_PASS_WORDS = 8u;
constexpr u32 VDP_RPU_END_PASS_WORDS = 1u;
constexpr u32 VDP_RPU_BEGIN_DRAW_WORDS = 9u;
constexpr u32 VDP_RPU_BIND_STREAM_WORDS = 6u;
constexpr u32 VDP_RPU_BIND_CONSTANTS_WORDS = 5u;
constexpr u32 VDP_RPU_BIND_TEXTURE_WORDS = 3u;
constexpr u32 VDP_RPU_END_DRAW_WORDS = 1u;
constexpr u32 VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS = 4u;
constexpr u32 VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS = 4u;

constexpr u32 VDP_RPU_CONSTANT_SOURCE_XF_Q16 = 0u;
constexpr u32 VDP_RPU_CONSTANT_SOURCE_LPU_RAW = 1u;
constexpr u32 VDP_RPU_CONSTANT_SOURCE_MFU_Q16 = 2u;
constexpr u32 VDP_RPU_CONSTANT_SOURCE_JTU_Q16 = 3u;
constexpr u32 VDP_RPU_CONSTANT_SOURCE_MASK = 0x00000003u;

constexpr u32 VDP_RPU_FRAME_IDLE = 0u;
constexpr u32 VDP_RPU_FRAME_OPEN = 1u;
constexpr u32 VDP_RPU_PASS_OPEN = 2u;
constexpr u32 VDP_RPU_DRAW_OPEN = 3u;
using VdpRpuFrameBuildState = u32;

constexpr u32 VDP_RPU_BUFFER_USAGE_VERTEX = 1u << 0u;
constexpr u32 VDP_RPU_BUFFER_USAGE_INDEX = 1u << 1u;
constexpr u32 VDP_RPU_BUFFER_USAGE_CONSTANT = 1u << 2u;
constexpr u32 VDP_RPU_BUFFER_USAGE_MASK = VDP_RPU_BUFFER_USAGE_VERTEX | VDP_RPU_BUFFER_USAGE_INDEX | VDP_RPU_BUFFER_USAGE_CONSTANT;

constexpr u32 VDP_RPU_SURFACE_FORMAT_RGBA8 = 0u;
constexpr u32 VDP_RPU_SURFACE_FORMAT_DEPTH16 = 1u;
constexpr u32 VDP_RPU_SURFACE_USAGE_COLOR = 1u << 0u;
constexpr u32 VDP_RPU_SURFACE_USAGE_DEPTH = 1u << 1u;
constexpr u32 VDP_RPU_SURFACE_USAGE_TEXTURE = 1u << 2u;
constexpr u32 VDP_RPU_SURFACE_USAGE_MASK = VDP_RPU_SURFACE_USAGE_COLOR | VDP_RPU_SURFACE_USAGE_DEPTH | VDP_RPU_SURFACE_USAGE_TEXTURE;
constexpr u32 VDP_RPU_WIDTH_MASK = 0x0000ffffu;
constexpr u32 VDP_RPU_HEIGHT_SHIFT = 16u;
constexpr u32 VDP_RPU_FORMAT_MASK = 0x000000ffu;
constexpr u32 VDP_RPU_USAGE_SHIFT = 8u;

constexpr u32 VDP_RPU_PASS_COLOR_CLEAR = 1u << 0u;
constexpr u32 VDP_RPU_PASS_DEPTH_CLEAR = 1u << 1u;
constexpr u32 VDP_RPU_PASS_COLOR_STORE = 1u << 2u;
constexpr u32 VDP_RPU_PASS_DEPTH_STORE = 1u << 3u;
constexpr u32 VDP_RPU_PASS_OPS_MASK = VDP_RPU_PASS_COLOR_CLEAR | VDP_RPU_PASS_DEPTH_CLEAR | VDP_RPU_PASS_COLOR_STORE | VDP_RPU_PASS_DEPTH_STORE;

constexpr u32 VDP_RPU_BLEND_NONE = 0u;
constexpr u32 VDP_RPU_BLEND_ALPHA = 1u;
constexpr u32 VDP_RPU_BLEND_ADD = 2u;
constexpr u32 VDP_RPU_DEPTH_NONE = 0u;
constexpr u32 VDP_RPU_DEPTH_LESS = 1u;
constexpr u32 VDP_RPU_DEPTH_LEQUAL = 2u;
constexpr u32 VDP_RPU_CULL_NONE = 0u;
constexpr u32 VDP_RPU_CULL_BACK = 1u;
constexpr u32 VDP_RPU_CULL_FRONT = 2u;
constexpr u32 VDP_RPU_PIPE_BLEND_MASK = 0x0000000fu;
constexpr u32 VDP_RPU_PIPE_DEPTH_MASK = 0x000000f0u;
constexpr u32 VDP_RPU_PIPE_CULL_MASK = 0x00000f00u;
constexpr u32 VDP_RPU_PIPE_DEPTH_WRITE = 0x00001000u;
constexpr u32 VDP_RPU_PIPE_COLOR_WRITE_MASK = 0x000f0000u;
constexpr u32 VDP_RPU_PIPELINE_WORD_MASK = VDP_RPU_PIPE_BLEND_MASK | VDP_RPU_PIPE_DEPTH_MASK | VDP_RPU_PIPE_CULL_MASK | VDP_RPU_PIPE_DEPTH_WRITE | VDP_RPU_PIPE_COLOR_WRITE_MASK;

constexpr u32 VDP_RPU_PRIM_TRIANGLES = 0u;
constexpr u32 VDP_RPU_PRIM_TRIANGLE_STRIP = 1u;
constexpr u32 VDP_RPU_PRIM_LINES = 2u;
constexpr u32 VDP_RPU_PRIM_POINTS = 3u;
constexpr u32 VDP_RPU_INDEX_NONE = 0u;
constexpr u32 VDP_RPU_INDEX_U16 = 1u;
constexpr u32 VDP_RPU_INDEX_U32 = 2u;
constexpr u32 VDP_RPU_DRAW_PRIMITIVE_MASK = 0x000000ffu;
constexpr u32 VDP_RPU_DRAW_INDEX_TYPE_SHIFT = 8u;
constexpr u32 VDP_RPU_DRAW_INDEX_TYPE_MASK = 0x0000ff00u;

constexpr u32 VDP_RPU_ATTR_POS = 0u;
constexpr u32 VDP_RPU_ATTR_UV0 = 1u;
constexpr u32 VDP_RPU_ATTR_COLOR = 2u;
constexpr u32 VDP_RPU_ATTR_NORMAL = 3u;
constexpr u32 VDP_RPU_ATTR_JOINTS = 4u;
constexpr u32 VDP_RPU_ATTR_WEIGHTS = 5u;
constexpr u32 VDP_RPU_ATTR_INSTANCE0 = 6u;
constexpr u32 VDP_RPU_ATTR_INSTANCE1 = 7u;
constexpr u32 VDP_RPU_ATTR_INSTANCE2 = 8u;
constexpr u32 VDP_RPU_ATTR_INSTANCE3 = 9u;
constexpr u32 VDP_RPU_ATTR_INSTANCE_COLOR = 10u;
constexpr u32 VDP_RPU_ATTR_INSTANCE_UVRECT = 11u;
constexpr u32 VDP_RPU_ATTR_MORPH_POS = 12u;
constexpr u32 VDP_RPU_ATTR_MORPH_NRM = 13u;
constexpr u32 VDP_RPU_ATTR_F32 = 0u;
constexpr u32 VDP_RPU_ATTR_U8 = 1u;
constexpr u32 VDP_RPU_ATTR_U8N = 2u;
constexpr u32 VDP_RPU_ATTR_S16N = 3u;

constexpr u32 VDP_RPU_LAYOUT_V2_C4 = 0u;
constexpr u32 VDP_RPU_LAYOUT_V2_T2_C4 = 1u;
constexpr u32 VDP_RPU_LAYOUT_V3_C4 = 2u;
constexpr u32 VDP_RPU_LAYOUT_V3_T2_C4 = 3u;
constexpr u32 VDP_RPU_LAYOUT_V3_N3_C4 = 4u;
constexpr u32 VDP_RPU_LAYOUT_V3_N3_T2_C4 = 5u;
constexpr u32 VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4 = 6u;
constexpr u32 VDP_RPU_LAYOUT_V3_DM3 = 8u;
constexpr u32 VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4 = 32u;
constexpr u32 VDP_RPU_LAYOUT_I_MAT4_C4 = 33u;

constexpr u32 VDP_RPU_SHADER_V2_C4 = 0u;
constexpr u32 VDP_RPU_SHADER_V2_T2_C4 = 1u;
constexpr u32 VDP_RPU_SHADER_V3_C4_C0 = 2u;
constexpr u32 VDP_RPU_SHADER_V3_T2_C4_C0 = 3u;
constexpr u32 VDP_RPU_SHADER_V3_N3_T2_C4_C0_C1 = 4u;
constexpr u32 VDP_RPU_SHADER_V3_N3_T2_C4_J4_W4_C0_C1 = 5u;
constexpr u32 VDP_RPU_SHADER_V2_T2_C4_I_AFFINE2 = 6u;
constexpr u32 VDP_RPU_SHADER_V3_C4_I_MAT4 = 7u;
constexpr u32 VDP_RPU_SHADER_VARIANT_MASK = 0x00000007u;
constexpr u32 VDP_RPU_SHADER_FLAG_MORPH = 0x00000008u;
constexpr u32 VDP_RPU_SHADER_FLAG_T1 = 0x00000010u;
constexpr u32 VDP_RPU_INSTANCE_MODE_NONE = 0U;
constexpr u32 VDP_RPU_INSTANCE_MODE_AFFINE2 = 1U;
constexpr u32 VDP_RPU_INSTANCE_MODE_MAT4 = 2U;

constexpr u32 VDP_FAULT_RPU_BAD_PACKET = 0x0700u;
constexpr u32 VDP_FAULT_RPU_BAD_STREAM_LAYOUT = 0x0702U;
constexpr u32 VDP_FAULT_RPU_BUFFER_OOB = 0x0703U;
constexpr u32 VDP_FAULT_RPU_STALE_RESOURCE = 0x0704U;
constexpr u32 VDP_FAULT_RPU_BAD_SURFACE_USAGE = 0x0705U;
constexpr u32 VDP_FAULT_RPU_BAD_CONSTANT_RANGE = 0x0706U;
constexpr u32 VDP_FAULT_RPU_COMMAND_OVERFLOW = 0x0708U;
constexpr u32 VDP_FAULT_RPU_BAD_STATE = 0x0709U;

struct VdpRpuFrameBufferRefs {
	VdpRpuFrameBufferRefs();
	size_t length = 0U;
	size_t snapshotByteLength = 0U;
	std::array<u8, VDP_RPU_FRAME_BUFFER_BYTE_CAPACITY> snapshotBytes{};
	std::array<u32, VDP_RPU_BUFFER_REF_CAPACITY> bufferId{};
	std::array<u32, VDP_RPU_BUFFER_REF_CAPACITY> revision{};
	std::array<u32, VDP_RPU_BUFFER_REF_CAPACITY> sourceByteOffset{};
	std::array<u32, VDP_RPU_BUFFER_REF_CAPACITY> byteOffset{};
	std::array<u32, VDP_RPU_BUFFER_REF_CAPACITY> byteLength{};
	std::array<u8, VDP_RPU_BUFFER_REF_CAPACITY> usage{};
	std::array<const u8*, VDP_RPU_BUFFER_REF_CAPACITY> bytes{};
};

struct VdpRpuFrameSurfaceRefs {
	size_t length = 0U;
	std::array<u32, VDP_RPU_SURFACE_REF_CAPACITY> surfaceId{};
	std::array<u32, VDP_RPU_SURFACE_REF_CAPACITY> revision{};
	std::array<u16, VDP_RPU_SURFACE_REF_CAPACITY> width{};
	std::array<u16, VDP_RPU_SURFACE_REF_CAPACITY> height{};
	std::array<u8, VDP_RPU_SURFACE_REF_CAPACITY> format{};
	std::array<u8, VDP_RPU_SURFACE_REF_CAPACITY> usage{};
};

struct VdpRpuConstantBankTable {
	size_t length = 0U;
	std::array<u32, VDP_RPU_CONSTANT_BANK_CAPACITY> firstWord{};
	std::array<u16, VDP_RPU_CONSTANT_BANK_CAPACITY> wordCount{};
	std::array<u32, VDP_RPU_CONSTANT_BANK_CAPACITY> epoch{};
};

struct VdpRpuFrameResources {
	VdpRpuFrameBufferRefs bufferRefs;
	VdpRpuFrameSurfaceRefs surfaceRefs{};
	std::array<u32, VDP_RPU_CONSTANT_WORD_CAPACITY> constantWords{};
	VdpRpuConstantBankTable constantBanks{};
};

struct VdpRpuCommandBuffer {
	size_t passCount = 0U;
	size_t drawCount = 0U;
	size_t drawBatchCount = 0U;
	size_t streamBindingCount = 0U;
	size_t constantBindingCount = 0U;
	size_t textureBindingCount = 0U;
	std::array<u32, VDP_RPU_PASS_CAPACITY> passFirstDraw{};
	std::array<u16, VDP_RPU_PASS_CAPACITY> passDrawCount{};
	std::array<u32, VDP_RPU_PASS_CAPACITY> passFirstBatch{};
	std::array<u16, VDP_RPU_PASS_CAPACITY> passBatchCount{};
	std::array<u16, VDP_RPU_PASS_CAPACITY> passColorSurfaceRef{};
	std::array<u16, VDP_RPU_PASS_CAPACITY> passDepthSurfaceRef{};
	std::array<u32, VDP_RPU_PASS_CAPACITY> passViewportXY{};
	std::array<u32, VDP_RPU_PASS_CAPACITY> passViewportWH{};
	std::array<u32, VDP_RPU_PASS_CAPACITY> passOps{};
	std::array<u32, VDP_RPU_PASS_CAPACITY> passClearColor{};
	std::array<u32, VDP_RPU_PASS_CAPACITY> passClearDepthWord{};
	std::array<u16, VDP_RPU_DRAW_CAPACITY> drawShaderVariant{};
	std::array<u8, VDP_RPU_DRAW_CAPACITY> drawPrimitive{};
	std::array<u32, VDP_RPU_DRAW_CAPACITY> drawPipelineWord{};
	std::array<u32, VDP_RPU_DRAW_CAPACITY> drawVertexCount{};
	std::array<u32, VDP_RPU_DRAW_CAPACITY> drawInstanceCount{};
	std::array<u16, VDP_RPU_DRAW_CAPACITY> drawIndexBufferRef{};
	std::array<u32, VDP_RPU_DRAW_CAPACITY> drawIndexByteOffset{};
	std::array<u32, VDP_RPU_DRAW_CAPACITY> drawIndexCount{};
	std::array<u8, VDP_RPU_DRAW_CAPACITY> drawIndexType{};
	std::array<u32, VDP_RPU_DRAW_CAPACITY> drawFirstStreamBinding{};
	std::array<u8, VDP_RPU_DRAW_CAPACITY> drawStreamBindingCount{};
	std::array<u32, VDP_RPU_DRAW_CAPACITY> drawFirstConstantBinding{};
	std::array<u8, VDP_RPU_DRAW_CAPACITY> drawConstantBindingCount{};
	std::array<u32, VDP_RPU_DRAW_CAPACITY> drawFirstTextureBinding{};
	std::array<u8, VDP_RPU_DRAW_CAPACITY> drawTextureBindingCount{};
	std::array<u32, VDP_RPU_DRAW_BATCH_CAPACITY> batchFirstDraw{};
	std::array<u16, VDP_RPU_DRAW_BATCH_CAPACITY> batchDrawCount{};
	std::array<u32, VDP_RPU_DRAW_BATCH_CAPACITY> batchVertexCount{};
	std::array<u32, VDP_RPU_DRAW_BATCH_CAPACITY> batchInstanceCount{};
	std::array<u32, VDP_RPU_DRAW_BATCH_CAPACITY> batchIndexCount{};
	std::array<u16, VDP_RPU_STREAM_BINDING_CAPACITY> streamLayoutId{};
	std::array<u8, VDP_RPU_STREAM_BINDING_CAPACITY> streamSlot{};
	std::array<u16, VDP_RPU_STREAM_BINDING_CAPACITY> streamBufferRef{};
	std::array<u32, VDP_RPU_STREAM_BINDING_CAPACITY> streamByteOffset{};
	std::array<u8, VDP_RPU_STREAM_BINDING_CAPACITY> streamStepRate{};
	std::array<u8, VDP_RPU_CONSTANT_BINDING_CAPACITY> constantBindingSlot{};
	std::array<u16, VDP_RPU_CONSTANT_BINDING_CAPACITY> constantBank{};
	std::array<u16, VDP_RPU_CONSTANT_BINDING_CAPACITY> constantFirstWord{};
	std::array<u16, VDP_RPU_CONSTANT_BINDING_CAPACITY> constantWordCount{};
	std::array<u8, VDP_RPU_TEXTURE_BINDING_CAPACITY> textureSlot{};
	std::array<u16, VDP_RPU_TEXTURE_BINDING_CAPACITY> textureSurfaceRef{};
};

struct VdpRpuFrameOutput {
	VdpRpuCommandBuffer commands{};
	VdpRpuFrameResources resources{};
};

struct VdpRpuStreamAttributeSpec {
	u32 attribute = 0U;
	u32 componentCount = 0U;
	u32 componentType = 0U;
	u32 normalized = 0U;
	u32 byteOffset = 0U;
};

struct VdpRpuStreamLayoutSpec {
	u32 id = 0U;
	u32 byteStride = 0U;
	size_t attributeCount = 0U;
	std::array<VdpRpuStreamAttributeSpec, 6U> attributes{};
};

struct VdpRpuShaderConstantSlotSpec {
	u32 slot = 0U;
	u32 maxWords = 0U;
	u32 vertexVisible = 0U;
	u32 fragmentVisible = 0U;
};

struct VdpRpuShaderVariantSpec {
	u32 id = 0u;
	u32 requiredFeatureMask = 0U;
	u32 vertexLayout = 0U;
	u32 instanceLayout = 0U;
	u32 instanceMode = 0U;
	u32 textureSlotCount = 0U;
	u32 usesC0 = 0U;
	u32 lightingConstantSlot = 0U;
	u32 jointConstantSlot = 0U;
	size_t constantSlotCount = 0U;
	std::array<VdpRpuShaderConstantSlotSpec, 3U> constantSlots{};
};

inline constexpr std::array<VdpRpuStreamLayoutSpec, 10U> VDP_RPU_STREAM_LAYOUTS{{
	{.id=VDP_RPU_LAYOUT_V2_C4, .byteStride=12U, .attributeCount=2U, .attributes={{{.attribute=VDP_RPU_ATTR_POS, .componentCount=2U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=0U}, {.attribute=VDP_RPU_ATTR_COLOR, .componentCount=4U, .componentType=VDP_RPU_ATTR_U8N, .normalized=1U, .byteOffset=8U}}}},
	{.id=VDP_RPU_LAYOUT_V2_T2_C4, .byteStride=20U, .attributeCount=3U, .attributes={{{.attribute=VDP_RPU_ATTR_POS, .componentCount=2U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=0U}, {.attribute=VDP_RPU_ATTR_UV0, .componentCount=2U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=8U}, {.attribute=VDP_RPU_ATTR_COLOR, .componentCount=4U, .componentType=VDP_RPU_ATTR_U8N, .normalized=1U, .byteOffset=16U}}}},
	{.id=VDP_RPU_LAYOUT_V3_C4, .byteStride=16U, .attributeCount=2U, .attributes={{{.attribute=VDP_RPU_ATTR_POS, .componentCount=3U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=0U}, {.attribute=VDP_RPU_ATTR_COLOR, .componentCount=4U, .componentType=VDP_RPU_ATTR_U8N, .normalized=1U, .byteOffset=12U}}}},
	{.id=VDP_RPU_LAYOUT_V3_T2_C4, .byteStride=24U, .attributeCount=3U, .attributes={{{.attribute=VDP_RPU_ATTR_POS, .componentCount=3U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=0U}, {.attribute=VDP_RPU_ATTR_UV0, .componentCount=2U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=12U}, {.attribute=VDP_RPU_ATTR_COLOR, .componentCount=4U, .componentType=VDP_RPU_ATTR_U8N, .normalized=1U, .byteOffset=20U}}}},
	{.id=VDP_RPU_LAYOUT_V3_N3_C4, .byteStride=28U, .attributeCount=3U, .attributes={{{.attribute=VDP_RPU_ATTR_POS, .componentCount=3U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=0U}, {.attribute=VDP_RPU_ATTR_NORMAL, .componentCount=3U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=12U}, {.attribute=VDP_RPU_ATTR_COLOR, .componentCount=4U, .componentType=VDP_RPU_ATTR_U8N, .normalized=1U, .byteOffset=24U}}}},
	{.id=VDP_RPU_LAYOUT_V3_N3_T2_C4, .byteStride=36U, .attributeCount=4U, .attributes={{{.attribute=VDP_RPU_ATTR_POS, .componentCount=3U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=0U}, {.attribute=VDP_RPU_ATTR_NORMAL, .componentCount=3U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=12U}, {.attribute=VDP_RPU_ATTR_UV0, .componentCount=2U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=24U}, {.attribute=VDP_RPU_ATTR_COLOR, .componentCount=4U, .componentType=VDP_RPU_ATTR_U8N, .normalized=1U, .byteOffset=32U}}}},
	{.id=VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4, .byteStride=44U, .attributeCount=6U, .attributes={{{.attribute=VDP_RPU_ATTR_POS, .componentCount=3U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=0U}, {.attribute=VDP_RPU_ATTR_NORMAL, .componentCount=3U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=12U}, {.attribute=VDP_RPU_ATTR_UV0, .componentCount=2U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=24U}, {.attribute=VDP_RPU_ATTR_COLOR, .componentCount=4U, .componentType=VDP_RPU_ATTR_U8N, .normalized=1U, .byteOffset=32U}, {.attribute=VDP_RPU_ATTR_JOINTS, .componentCount=4U, .componentType=VDP_RPU_ATTR_U8, .normalized=0U, .byteOffset=36U}, {.attribute=VDP_RPU_ATTR_WEIGHTS, .componentCount=4U, .componentType=VDP_RPU_ATTR_U8N, .normalized=1U, .byteOffset=40U}}}},
	{.id=VDP_RPU_LAYOUT_V3_DM3, .byteStride=24U, .attributeCount=2U, .attributes={{{.attribute=VDP_RPU_ATTR_MORPH_POS, .componentCount=3U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=0U}, {.attribute=VDP_RPU_ATTR_MORPH_NRM, .componentCount=3U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=12U}}}},
	{.id=VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4, .byteStride=48U, .attributeCount=4U, .attributes={{{.attribute=VDP_RPU_ATTR_INSTANCE0, .componentCount=4U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=0U}, {.attribute=VDP_RPU_ATTR_INSTANCE1, .componentCount=3U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=16U}, {.attribute=VDP_RPU_ATTR_INSTANCE_UVRECT, .componentCount=4U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=28U}, {.attribute=VDP_RPU_ATTR_INSTANCE_COLOR, .componentCount=4U, .componentType=VDP_RPU_ATTR_U8N, .normalized=1U, .byteOffset=44U}}}},
	{.id=VDP_RPU_LAYOUT_I_MAT4_C4, .byteStride=68U, .attributeCount=5U, .attributes={{{.attribute=VDP_RPU_ATTR_INSTANCE0, .componentCount=4U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=0U}, {.attribute=VDP_RPU_ATTR_INSTANCE1, .componentCount=4U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=16U}, {.attribute=VDP_RPU_ATTR_INSTANCE2, .componentCount=4U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=32U}, {.attribute=VDP_RPU_ATTR_INSTANCE3, .componentCount=4U, .componentType=VDP_RPU_ATTR_F32, .normalized=0U, .byteOffset=48U}, {.attribute=VDP_RPU_ATTR_INSTANCE_COLOR, .componentCount=4U, .componentType=VDP_RPU_ATTR_U8N, .normalized=1U, .byteOffset=64U}}}},
}};

inline constexpr std::array<VdpRpuShaderVariantSpec, 8U> VDP_RPU_SHADER_VARIANTS{{
	{VDP_RPU_SHADER_V2_C4, 0U, VDP_RPU_LAYOUT_V2_C4, VDP_RPU_RESOURCE_NONE, VDP_RPU_INSTANCE_MODE_NONE, 0U, 0U, VDP_RPU_RESOURCE_NONE, VDP_RPU_RESOURCE_NONE, 0U, {}},
	{VDP_RPU_SHADER_V2_T2_C4, 0U, VDP_RPU_LAYOUT_V2_T2_C4, VDP_RPU_RESOURCE_NONE, VDP_RPU_INSTANCE_MODE_NONE, 1u, 0U, VDP_RPU_RESOURCE_NONE, VDP_RPU_RESOURCE_NONE, 0U, {}},
	{VDP_RPU_SHADER_V3_C4_C0, 0U, VDP_RPU_LAYOUT_V3_C4, VDP_RPU_RESOURCE_NONE, VDP_RPU_INSTANCE_MODE_NONE, 0U, 1U, VDP_RPU_RESOURCE_NONE, VDP_RPU_RESOURCE_NONE, 1U, {{{.slot=0U, .maxWords=32U, .vertexVisible=1U, .fragmentVisible=0U}}}},
	{VDP_RPU_SHADER_V3_T2_C4_C0, 0U, VDP_RPU_LAYOUT_V3_T2_C4, VDP_RPU_RESOURCE_NONE, VDP_RPU_INSTANCE_MODE_NONE, 1U, 1U, VDP_RPU_RESOURCE_NONE, VDP_RPU_RESOURCE_NONE, 1u, {{{.slot=0U, .maxWords=32U, .vertexVisible=1U, .fragmentVisible=0U}}}},
	{VDP_RPU_SHADER_V3_N3_T2_C4_C0_C1, 0U, VDP_RPU_LAYOUT_V3_N3_T2_C4, VDP_RPU_RESOURCE_NONE, VDP_RPU_INSTANCE_MODE_NONE, 1u, 1U, 1U, VDP_RPU_RESOURCE_NONE, 2U, {{{.slot=0U, .maxWords=32U, .vertexVisible=1u, .fragmentVisible=0U}, {.slot=1U, .maxWords=72U, .vertexVisible=0U, .fragmentVisible=1U}}}},
	{VDP_RPU_SHADER_V3_N3_T2_C4_J4_W4_C0_C1, 0u, VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4, VDP_RPU_RESOURCE_NONE, VDP_RPU_INSTANCE_MODE_NONE, 1U, 1U, 2U, 1U, 3U, {{{.slot=0U, .maxWords=32U, .vertexVisible=1U, .fragmentVisible=0U}, {.slot=1U, .maxWords=384U, .vertexVisible=1U, .fragmentVisible=0U}, {.slot=2U, .maxWords=72U, .vertexVisible=0U, .fragmentVisible=1U}}}},
	{VDP_RPU_SHADER_V2_T2_C4_I_AFFINE2, VDP_RPU_FEATURE_INSTANCED_ARRAYS, VDP_RPU_LAYOUT_V2_T2_C4, VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4, VDP_RPU_INSTANCE_MODE_AFFINE2, 1U, 0U, VDP_RPU_RESOURCE_NONE, VDP_RPU_RESOURCE_NONE, 0U, {}},
	{.id=VDP_RPU_SHADER_V3_C4_I_MAT4, .requiredFeatureMask=VDP_RPU_FEATURE_INSTANCED_ARRAYS, .vertexLayout=VDP_RPU_LAYOUT_V3_C4, .instanceLayout=VDP_RPU_LAYOUT_I_MAT4_C4, .instanceMode=VDP_RPU_INSTANCE_MODE_MAT4, .textureSlotCount=0U, .usesC0=0U, .lightingConstantSlot=VDP_RPU_RESOURCE_NONE, .jointConstantSlot=VDP_RPU_RESOURCE_NONE, .constantSlotCount=0U, .constantSlots={}},
}};

auto resolveVdpRpuStreamLayoutSpec(u32 layoutId) -> const VdpRpuStreamLayoutSpec&;
auto resolveVdpRpuShaderVariantSpec(u32 shaderVariant) -> const VdpRpuShaderVariantSpec&;

struct VdpRpuCommandBufferSaveState {
	size_t passCount = 0U;
	size_t drawCount = 0U;
	size_t drawBatchCount = 0U;
	size_t streamBindingCount = 0U;
	size_t constantBindingCount = 0U;
	size_t textureBindingCount = 0U;
	std::vector<u32> passFirstDraw;
	std::vector<u16> passDrawCount;
	std::vector<u32> passFirstBatch;
	std::vector<u16> passBatchCount;
	std::vector<u16> passColorSurfaceRef;
	std::vector<u16> passDepthSurfaceRef;
	std::vector<u32> passViewportXY;
	std::vector<u32> passViewportWH;
	std::vector<u32> passOps;
	std::vector<u32> passClearColor;
	std::vector<u32> passClearDepthWord;
	std::vector<u16> drawShaderVariant;
	std::vector<u8> drawPrimitive;
	std::vector<u32> drawPipelineWord;
	std::vector<u32> drawVertexCount;
	std::vector<u32> drawInstanceCount;
	std::vector<u16> drawIndexBufferRef;
	std::vector<u32> drawIndexByteOffset;
	std::vector<u32> drawIndexCount;
	std::vector<u8> drawIndexType{};
	std::vector<u32> drawFirstStreamBinding;
	std::vector<u8> drawStreamBindingCount;
	std::vector<u32> drawFirstConstantBinding;
	std::vector<u8> drawConstantBindingCount;
	std::vector<u32> drawFirstTextureBinding;
	std::vector<u8> drawTextureBindingCount;
	std::vector<u32> batchFirstDraw;
	std::vector<u16> batchDrawCount;
	std::vector<u32> batchVertexCount;
	std::vector<u32> batchInstanceCount;
	std::vector<u32> batchIndexCount;
	std::vector<u16> streamLayoutId;
	std::vector<u8> streamSlot;
	std::vector<u16> streamBufferRef;
	std::vector<u32> streamByteOffset;
	std::vector<u8> streamStepRate;
	std::vector<u8> constantBindingSlot;
	std::vector<u16> constantBank;
	std::vector<u16> constantFirstWord;
	std::vector<u16> constantWordCount;
	std::vector<u8> textureSlot;
	std::vector<u16> textureSurfaceRef;
};

struct VdpRpuFrameBufferRefSaveState {
	u32 bufferId = 0U;
	u32 revision = 0U;
	u32 sourceByteOffset = 0U;
	u32 byteOffset = 0U;
	u32 byteLength = 0U;
	u32 usage = 0U;
};

struct VdpRpuFrameSurfaceRefSaveState {
	u32 surfaceId = 0U;
	u32 revision = 0U;
	u32 width = 0U;
	u32 height = 0U;
	u32 format = 0U;
	u32 usage = 0U;
};

struct VdpRpuConstantBankSaveState {
	u32 firstWord = 0U;
	u32 wordCount = 0U;
	u32 epoch = 0U;
};

struct VdpRpuBufferRecordSaveState {
	u32 bufferId = 0U;
	u32 liveRevision = 0U;
	u32 byteLength = 0U;
	u32 usage = 0u;
};

struct VdpRpuBufferImageSaveState {
	u32 bufferId = 0u;
	std::vector<u8> bytes;
};

struct VdpRpuSurfaceRecordSaveState {
	u32 surfaceId = 0U;
	u32 liveRevision = 0U;
	u32 width = 0U;
	u32 height = 0U;
	u32 format = 0U;
	u32 usage = 0U;
};

struct VdpRpuFrameSaveState {
	VdpRpuCommandBufferSaveState commands{};
	std::vector<VdpRpuFrameBufferRefSaveState> bufferRefs;
	std::vector<u8> bufferBytes;
	std::vector<VdpRpuFrameSurfaceRefSaveState> surfaceRefs;
	std::vector<u32> constantWords;
	std::vector<VdpRpuConstantBankSaveState> constantBanks;
};

struct VdpRpuSaveState {
	VdpRpuFrameBuildState buildState = VDP_RPU_FRAME_IDLE;
	u32 openPassIndex = 0U;
	u32 openDrawIndex = 0U;
	std::vector<VdpRpuBufferRecordSaveState> buffers;
	std::vector<VdpRpuBufferImageSaveState> bufferImages;
	std::vector<VdpRpuSurfaceRecordSaveState> surfaces;
};

class VdpRpuUnit {
public:
	VdpRpuUnit(
		Memory& memory,
		DeviceStatusLatch& fault,
		const std::array<u32, VDP_XF_MATRIX_REGISTER_WORDS>& xfMatrixWords,
		const std::array<u32, VDP_LPU_REGISTER_WORDS>& lightRegisterWords,
		const std::array<u32, VDP_MFU_WEIGHT_COUNT>& morphWeightWords,
		const std::array<u32, VDP_JTU_REGISTER_WORDS>& jointMatrixWords
	);

	void reset();
	auto beginFrame(VdpRpuFrameOutput& frame) -> bool;
	void cancelFrame(VdpRpuFrameOutput& frame);
	auto endFrame(VdpRpuFrameOutput& frame) -> bool;
	[[nodiscard]] auto captureState() const -> VdpRpuSaveState;
	void restoreState(const VdpRpuSaveState& state);
	void rebindFrameResources(VdpRpuFrameOutput& frame);
	auto consumePacketFromMemory(VdpRpuFrameOutput& frame, u32 headerWord, u32 cursor, u32 end) -> u32;
	auto consumePacketFromWords(VdpRpuFrameOutput& frame, const u32* words, u32 headerWord, u32 cursor, u32 wordCount) -> u32;
	int lastPacketCost = 0;

private:
	Memory& m_memory;
	DeviceStatusLatch& m_fault;
	const std::array<u32, VDP_XF_MATRIX_REGISTER_WORDS>& m_xfMatrixWords;
	const std::array<u32, VDP_LPU_REGISTER_WORDS>& m_lightRegisterWords;
	const std::array<u32, VDP_MFU_WEIGHT_COUNT>& m_morphWeightWords;
	const std::array<u32, VDP_JTU_REGISTER_WORDS>& m_jointMatrixWords;
	VdpRpuFrameBuildState m_buildState = VDP_RPU_FRAME_IDLE;
	u32 m_openPassIndex = 0U;
	u32 m_openDrawIndex = 0U;
	std::array<u8, VDP_RPU_BUFFER_CAPACITY> m_bufferDefined{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> m_bufferRevision{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> m_bufferByteLength{};
	std::array<u32, VDP_RPU_BUFFER_CAPACITY> m_bufferUsage{};
	std::vector<u8> m_bufferBytes;
	std::array<u8, VDP_RPU_SURFACE_CAPACITY> m_surfaceDefined{};
	std::array<u32, VDP_RPU_SURFACE_CAPACITY> m_surfaceRevision{};
	std::array<u16, VDP_RPU_SURFACE_CAPACITY> m_surfaceWidth{};
	std::array<u16, VDP_RPU_SURFACE_CAPACITY> m_surfaceHeight{};
	std::array<u8, VDP_RPU_SURFACE_CAPACITY> m_surfaceFormat{};
	std::array<u8, VDP_RPU_SURFACE_CAPACITY> m_surfaceUsage{};

	auto consumePacketPayloadFromMemory(VdpRpuFrameOutput& frame, u32 op, u32 cursor, u32 payloadWords) -> bool;
	auto consumePacketPayloadFromWords(VdpRpuFrameOutput& frame, const u32* words, u32 op, u32 cursor, u32 payloadWords) -> bool;
	auto acceptBufferDefine(u32 bufferId, u32 byteLength, u32 usage) -> bool;
	auto acceptBufferUploadDma(u32 bufferId, u32 dstByteOffset, u32 srcAddr, u32 byteLength) -> bool;
	auto acceptBufferUploadInlineFromMemory(u32 cursor, u32 payloadWords) -> bool;
	auto acceptBufferUploadInlineFromWords(const u32* words, u32 cursor, u32 payloadWords) -> bool;
	void writeInlineBufferWord(u32 dstByteOffset, u32 wordIndex, u32 word, u32 byteLength);
	auto acceptBufferDiscard(u32 bufferId) -> bool;
	auto acceptSurfaceDefine(u32 surfaceId, u32 widthHeight, u32 formatUsage) -> bool;
	auto acceptConstantBankDefine(VdpRpuFrameOutput& frame, u32 bankId, u32 firstWord, u32 wordCount) -> bool;
	auto acceptConstantUploadDma(VdpRpuFrameOutput& frame, u32 bankId, u32 dstWordOffset, u32 srcAddr, u32 wordCount) -> bool;
	auto acceptConstantUploadInlineFromMemory(VdpRpuFrameOutput& frame, u32 cursor, u32 payloadWords) -> bool;
	auto acceptConstantUploadInlineFromWords(VdpRpuFrameOutput& frame, const u32* words, u32 cursor, u32 payloadWords) -> bool;
	auto acceptConstantUploadDevice(VdpRpuFrameOutput& frame, u32 bankId, u32 dstWordOffset, u32 sourceWord, u32 sourceWordOffset, u32 wordCount) -> bool;
	[[nodiscard]] auto encodeDeviceQ16WordAsF32Word(u32 word) const -> u32;
	[[nodiscard]] bool acceptConstantRange(const VdpRpuFrameOutput& frame, u32 bankId, u32 firstWord, u32 wordCount) const;
	auto acceptBeginPass(VdpRpuFrameOutput& frame, u32 colorSurfaceId, u32 depthSurfaceId, u32 viewportXY, u32 viewportWH, u32 passOps, u32 clearColor, u32 clearDepthWord) -> bool;
	auto acceptEndPass(VdpRpuFrameOutput& frame) -> bool;
	auto acceptBeginDraw(VdpRpuFrameOutput& frame, u32 shaderVariant, u32 primitiveIndexType, u32 pipelineWord, u32 vertexCount, u32 instanceCount, u32 indexBufferId, u32 indexByteOffset, u32 indexCount) -> bool;
	auto acceptEndDraw(VdpRpuFrameOutput& frame) -> bool;
	auto acceptBindStream(VdpRpuFrameOutput& frame, u32 streamSlot, u32 layoutId, u32 bufferId, u32 byteOffset, u32 stepRate) -> bool;
	auto acceptBindConstants(VdpRpuFrameOutput& frame, u32 bindingSlot, u32 bankId, u32 firstWord, u32 wordCount) -> bool;
	auto acceptBindTexture(VdpRpuFrameOutput& frame, u32 textureSlot, u32 surfaceId) -> bool;
	auto recordDrawBatch(VdpRpuFrameOutput& frame, u32 drawIndex) -> bool;
	[[nodiscard]] auto canMergeDrawIntoBatch(const VdpRpuCommandBuffer& commands, size_t batchIndex, u32 drawIndex) const -> bool;
	[[nodiscard]] auto sameDrawConstants(const VdpRpuCommandBuffer& commands, u32 leftDraw, u32 rightDraw) const -> bool;
	[[nodiscard]] auto sameDrawTextures(const VdpRpuCommandBuffer& commands, u32 leftDraw, u32 rightDraw) const -> bool;
	[[nodiscard]] auto compatibleDrawStreams(const VdpRpuCommandBuffer& commands, size_t batchIndex, u32 drawIndex) const -> bool;
	[[nodiscard]] auto drawStreamBinding(const VdpRpuCommandBuffer& commands, u32 drawIndex, u32 streamSlot) const -> u32;
	[[nodiscard]] auto streamOffsetMatchesBatchHead(const VdpRpuCommandBuffer& commands, size_t batchIndex, u32 drawIndex, u32 streamSlot) const -> bool;
	[[nodiscard]] auto streamOffsetIsBatchTail(const VdpRpuCommandBuffer& commands, size_t batchIndex, u32 drawIndex, u32 streamSlot, u32 elementCount) const -> bool;
	auto pinBuffer(VdpRpuFrameOutput& frame, u32 bufferId, u32 byteOffset, u32 byteLength, u32 usage) -> i32;
	auto pinSurface(VdpRpuFrameOutput& frame, u32 surfaceId) -> i32;
	[[nodiscard]] auto acceptBufferRange(u32 bufferId, u32 byteOffset, u32 byteLength) const -> bool;
	[[nodiscard]] auto bufferByteBase(u32 bufferId) const -> u32;
	[[nodiscard]] auto streamLayoutStride(u32 layoutId) const -> u32;
};

auto createVdpRpuFrameOutput() -> std::unique_ptr<VdpRpuFrameOutput>;
void resetVdpRpuFrameOutput(VdpRpuFrameOutput& frame);
auto captureVdpRpuFrameState(const VdpRpuFrameOutput& frame) -> VdpRpuFrameSaveState;
void restoreVdpRpuFrameState(VdpRpuFrameOutput& frame, const VdpRpuFrameSaveState& state);

} // namespace bmsx
