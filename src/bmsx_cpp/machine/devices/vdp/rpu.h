#pragma once

#include "common/primitives.h"
#include <array>
#include <cstddef>
#include <memory>
#include <vector>

namespace bmsx {

constexpr size_t VDP_RPU_PASS_CAPACITY = 64u;
constexpr size_t VDP_RPU_DRAW_CAPACITY = 4096u;
constexpr size_t VDP_RPU_STREAM_BINDING_CAPACITY = 8192u;
constexpr size_t VDP_RPU_CONSTANT_BINDING_CAPACITY = 8192u;
constexpr size_t VDP_RPU_TEXTURE_BINDING_CAPACITY = 4096u;
constexpr size_t VDP_RPU_BUFFER_CAPACITY = 1024u;
constexpr size_t VDP_RPU_BUFFER_REF_CAPACITY = 4096u;
constexpr size_t VDP_RPU_SURFACE_CAPACITY = 256u;
constexpr size_t VDP_RPU_SURFACE_REF_CAPACITY = 1024u;
constexpr size_t VDP_RPU_CONSTANT_BANK_CAPACITY = 256u;
constexpr size_t VDP_RPU_CONSTANT_WORD_CAPACITY = 65536u;
constexpr u32 VDP_RPU_RESOURCE_NONE = 0xffffffffu;

constexpr u32 VDP_RPU_FEATURE_INSTANCED_ARRAYS = 1u << 0u;
constexpr u32 VDP_RPU_FEATURE_UINT_INDEX = 1u << 1u;
constexpr u32 VDP_RPU_FEATURE_DEPTH_TEXTURE = 1u << 2u;
constexpr u32 VDP_RPU_REQUIRED_FEATURES = VDP_RPU_FEATURE_INSTANCED_ARRAYS;

constexpr u32 VDP_RPU_PACKET_KIND = 0x18000000u;
constexpr u32 VDP_RPU_OP_BUFFER_DEFINE = 1u;
constexpr u32 VDP_RPU_OP_BUFFER_UPLOAD_DMA = 2u;
constexpr u32 VDP_RPU_OP_BUFFER_UPLOAD_INLINE = 3u;
constexpr u32 VDP_RPU_OP_BUFFER_DISCARD = 4u;
constexpr u32 VDP_RPU_OP_SURFACE_DEFINE = 8u;
constexpr u32 VDP_RPU_OP_CONSTANT_BANK_DEFINE = 16u;
constexpr u32 VDP_RPU_OP_CONSTANT_UPLOAD_DMA = 17u;
constexpr u32 VDP_RPU_OP_CONSTANT_UPLOAD_INLINE = 18u;
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
constexpr u32 VDP_RPU_BEGIN_PASS_WORDS = 8u;
constexpr u32 VDP_RPU_END_PASS_WORDS = 1u;
constexpr u32 VDP_RPU_BEGIN_DRAW_WORDS = 9u;
constexpr u32 VDP_RPU_BIND_STREAM_WORDS = 6u;
constexpr u32 VDP_RPU_BIND_CONSTANTS_WORDS = 5u;
constexpr u32 VDP_RPU_BIND_TEXTURE_WORDS = 4u;
constexpr u32 VDP_RPU_END_DRAW_WORDS = 1u;
constexpr u32 VDP_RPU_BUFFER_UPLOAD_INLINE_MIN_WORDS = 4u;
constexpr u32 VDP_RPU_CONSTANT_UPLOAD_INLINE_MIN_WORDS = 4u;

constexpr u32 VDP_RPU_FRAME_IDLE = 0u;
constexpr u32 VDP_RPU_FRAME_OPEN = 1u;
constexpr u32 VDP_RPU_PASS_OPEN = 2u;
constexpr u32 VDP_RPU_DRAW_OPEN = 3u;
using VdpRpuFrameBuildState = u32;

constexpr u32 VDP_RPU_BUFFER_USAGE_VERTEX = 1u << 0u;
constexpr u32 VDP_RPU_BUFFER_USAGE_INDEX = 1u << 1u;
constexpr u32 VDP_RPU_BUFFER_USAGE_CONSTANT = 1u << 2u;

constexpr u32 VDP_RPU_SURFACE_FORMAT_RGBA8 = 0u;
constexpr u32 VDP_RPU_SURFACE_FORMAT_DEPTH16 = 1u;
constexpr u32 VDP_RPU_SURFACE_USAGE_COLOR = 1u << 0u;
constexpr u32 VDP_RPU_SURFACE_USAGE_DEPTH = 1u << 1u;
constexpr u32 VDP_RPU_SURFACE_USAGE_TEXTURE = 1u << 2u;
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

constexpr u32 VDP_RPU_FILTER_NEAREST = 0u;
constexpr u32 VDP_RPU_FILTER_LINEAR = 1u;
constexpr u32 VDP_RPU_WRAP_CLAMP = 0u;
constexpr u32 VDP_RPU_WRAP_REPEAT = 1u;
constexpr u32 VDP_RPU_SAMPLER_MIN_FILTER_MASK = 0x00000003u;
constexpr u32 VDP_RPU_SAMPLER_MAG_FILTER_MASK = 0x0000000cu;
constexpr u32 VDP_RPU_SAMPLER_WRAP_U_MASK = 0x00000030u;
constexpr u32 VDP_RPU_SAMPLER_WRAP_V_MASK = 0x000000c0u;
constexpr u32 VDP_RPU_SAMPLER_WORD_MASK = VDP_RPU_SAMPLER_MIN_FILTER_MASK | VDP_RPU_SAMPLER_MAG_FILTER_MASK | VDP_RPU_SAMPLER_WRAP_U_MASK | VDP_RPU_SAMPLER_WRAP_V_MASK;

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

constexpr u32 VDP_FAULT_RPU_BAD_PACKET = 0x0700u;
constexpr u32 VDP_FAULT_RPU_BAD_SHADER = 0x0701u;
constexpr u32 VDP_FAULT_RPU_BAD_STREAM_LAYOUT = 0x0702u;
constexpr u32 VDP_FAULT_RPU_BUFFER_OOB = 0x0703u;
constexpr u32 VDP_FAULT_RPU_STALE_RESOURCE = 0x0704u;
constexpr u32 VDP_FAULT_RPU_BAD_SURFACE_USAGE = 0x0705u;
constexpr u32 VDP_FAULT_RPU_BAD_CONSTANT_RANGE = 0x0706u;
constexpr u32 VDP_FAULT_RPU_UNSUPPORTED_FEATURE = 0x0707u;
constexpr u32 VDP_FAULT_RPU_COMMAND_OVERFLOW = 0x0708u;
constexpr u32 VDP_FAULT_RPU_BAD_STATE = 0x0709u;

struct VdpRpuBufferRecord {
	u32 bufferId = 0u;
	u32 liveRevision = 0u;
	u32 byteLength = 0u;
	u32 usage = 0u;
};

struct VdpRpuBufferRevision {
	u32 bufferId = 0u;
	u32 revision = 0u;
	std::vector<u8> bytes{};
};

struct VdpRpuSurfaceRecord {
	u32 surfaceId = 0u;
	u32 liveRevision = 0u;
	u32 width = 0u;
	u32 height = 0u;
	u32 format = 0u;
	u32 usage = 0u;
};

struct VdpRpuSurfaceRevision {
	u32 surfaceId = 0u;
	u32 revision = 0u;
	std::vector<u8> bytes{};
};

struct VdpRpuFrameBufferRefs {
	size_t length = 0u;
	std::array<u32, VDP_RPU_BUFFER_REF_CAPACITY> bufferId{};
	std::array<u32, VDP_RPU_BUFFER_REF_CAPACITY> revision{};
	std::array<u32, VDP_RPU_BUFFER_REF_CAPACITY> byteOffset{};
	std::array<u32, VDP_RPU_BUFFER_REF_CAPACITY> byteLength{};
	std::array<u8, VDP_RPU_BUFFER_REF_CAPACITY> usage{};
};

struct VdpRpuFrameSurfaceRefs {
	size_t length = 0u;
	std::array<u32, VDP_RPU_SURFACE_REF_CAPACITY> surfaceId{};
	std::array<u32, VDP_RPU_SURFACE_REF_CAPACITY> revision{};
	std::array<u16, VDP_RPU_SURFACE_REF_CAPACITY> width{};
	std::array<u16, VDP_RPU_SURFACE_REF_CAPACITY> height{};
	std::array<u8, VDP_RPU_SURFACE_REF_CAPACITY> format{};
	std::array<u8, VDP_RPU_SURFACE_REF_CAPACITY> usage{};
};

struct VdpRpuConstantBankTable {
	size_t length = 0u;
	std::array<u32, VDP_RPU_CONSTANT_BANK_CAPACITY> firstWord{};
	std::array<u16, VDP_RPU_CONSTANT_BANK_CAPACITY> wordCount{};
	std::array<u32, VDP_RPU_CONSTANT_BANK_CAPACITY> epoch{};
};

struct VdpRpuFrameResources {
	std::vector<VdpRpuBufferRevision> bufferRevisions{};
	std::vector<VdpRpuSurfaceRevision> surfaceRevisions{};
	VdpRpuFrameBufferRefs bufferRefs{};
	VdpRpuFrameSurfaceRefs surfaceRefs{};
	std::array<u32, VDP_RPU_CONSTANT_WORD_CAPACITY> constantWords{};
	VdpRpuConstantBankTable constantBanks{};
};

struct VdpRpuCommandBuffer {
	size_t passCount = 0u;
	size_t drawCount = 0u;
	size_t streamBindingCount = 0u;
	size_t constantBindingCount = 0u;
	size_t textureBindingCount = 0u;
	std::array<u32, VDP_RPU_PASS_CAPACITY> passFirstDraw{};
	std::array<u16, VDP_RPU_PASS_CAPACITY> passDrawCount{};
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
	std::array<u16, VDP_RPU_STREAM_BINDING_CAPACITY> streamLayoutId{};
	std::array<u16, VDP_RPU_STREAM_BINDING_CAPACITY> streamBufferRef{};
	std::array<u32, VDP_RPU_STREAM_BINDING_CAPACITY> streamByteOffset{};
	std::array<u8, VDP_RPU_STREAM_BINDING_CAPACITY> streamStepRate{};
	std::array<u8, VDP_RPU_CONSTANT_BINDING_CAPACITY> constantBindingSlot{};
	std::array<u16, VDP_RPU_CONSTANT_BINDING_CAPACITY> constantBank{};
	std::array<u16, VDP_RPU_CONSTANT_BINDING_CAPACITY> constantFirstWord{};
	std::array<u16, VDP_RPU_CONSTANT_BINDING_CAPACITY> constantWordCount{};
	std::array<u8, VDP_RPU_TEXTURE_BINDING_CAPACITY> textureSlot{};
	std::array<u16, VDP_RPU_TEXTURE_BINDING_CAPACITY> textureSurfaceRef{};
	std::array<u32, VDP_RPU_TEXTURE_BINDING_CAPACITY> textureSamplerWord{};
};

struct VdpRpuFrameOutput {
	VdpRpuCommandBuffer commands{};
	VdpRpuFrameResources resources{};
};

struct VdpRpuStreamAttributeSpec {
	u32 attribute = 0u;
	u32 componentCount = 0u;
	u32 componentType = 0u;
	u32 normalized = 0u;
	u32 byteOffset = 0u;
};

struct VdpRpuStreamLayoutSpec {
	u32 id = 0u;
	u32 byteStride = 0u;
	size_t attributeCount = 0u;
	std::array<VdpRpuStreamAttributeSpec, 6u> attributes{};
};

struct VdpRpuShaderConstantSlotSpec {
	u32 slot = 0u;
	u32 maxWords = 0u;
	u32 vertexVisible = 0u;
	u32 fragmentVisible = 0u;
};

struct VdpRpuShaderVariantSpec {
	u32 id = 0u;
	u32 requiredFeatureMask = 0u;
	u32 vertexLayout = 0u;
	u32 instanceLayout = 0u;
	u32 textureSlotCount = 0u;
	size_t constantSlotCount = 0u;
	std::array<VdpRpuShaderConstantSlotSpec, 3u> constantSlots{};
};

inline constexpr std::array<VdpRpuStreamLayoutSpec, 9u> VDP_RPU_STREAM_LAYOUTS{{
	{VDP_RPU_LAYOUT_V2_C4, 12u, 2u, {{{VDP_RPU_ATTR_POS, 2u, VDP_RPU_ATTR_F32, 0u, 0u}, {VDP_RPU_ATTR_COLOR, 4u, VDP_RPU_ATTR_U8N, 1u, 8u}}}},
	{VDP_RPU_LAYOUT_V2_T2_C4, 20u, 3u, {{{VDP_RPU_ATTR_POS, 2u, VDP_RPU_ATTR_F32, 0u, 0u}, {VDP_RPU_ATTR_UV0, 2u, VDP_RPU_ATTR_F32, 0u, 8u}, {VDP_RPU_ATTR_COLOR, 4u, VDP_RPU_ATTR_U8N, 1u, 16u}}}},
	{VDP_RPU_LAYOUT_V3_C4, 16u, 2u, {{{VDP_RPU_ATTR_POS, 3u, VDP_RPU_ATTR_F32, 0u, 0u}, {VDP_RPU_ATTR_COLOR, 4u, VDP_RPU_ATTR_U8N, 1u, 12u}}}},
	{VDP_RPU_LAYOUT_V3_T2_C4, 24u, 3u, {{{VDP_RPU_ATTR_POS, 3u, VDP_RPU_ATTR_F32, 0u, 0u}, {VDP_RPU_ATTR_UV0, 2u, VDP_RPU_ATTR_F32, 0u, 12u}, {VDP_RPU_ATTR_COLOR, 4u, VDP_RPU_ATTR_U8N, 1u, 20u}}}},
	{VDP_RPU_LAYOUT_V3_N3_C4, 28u, 3u, {{{VDP_RPU_ATTR_POS, 3u, VDP_RPU_ATTR_F32, 0u, 0u}, {VDP_RPU_ATTR_NORMAL, 3u, VDP_RPU_ATTR_F32, 0u, 12u}, {VDP_RPU_ATTR_COLOR, 4u, VDP_RPU_ATTR_U8N, 1u, 24u}}}},
	{VDP_RPU_LAYOUT_V3_N3_T2_C4, 36u, 4u, {{{VDP_RPU_ATTR_POS, 3u, VDP_RPU_ATTR_F32, 0u, 0u}, {VDP_RPU_ATTR_NORMAL, 3u, VDP_RPU_ATTR_F32, 0u, 12u}, {VDP_RPU_ATTR_UV0, 2u, VDP_RPU_ATTR_F32, 0u, 24u}, {VDP_RPU_ATTR_COLOR, 4u, VDP_RPU_ATTR_U8N, 1u, 32u}}}},
	{VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4, 44u, 6u, {{{VDP_RPU_ATTR_POS, 3u, VDP_RPU_ATTR_F32, 0u, 0u}, {VDP_RPU_ATTR_NORMAL, 3u, VDP_RPU_ATTR_F32, 0u, 12u}, {VDP_RPU_ATTR_UV0, 2u, VDP_RPU_ATTR_F32, 0u, 24u}, {VDP_RPU_ATTR_COLOR, 4u, VDP_RPU_ATTR_U8N, 1u, 32u}, {VDP_RPU_ATTR_JOINTS, 4u, VDP_RPU_ATTR_U8, 0u, 36u}, {VDP_RPU_ATTR_WEIGHTS, 4u, VDP_RPU_ATTR_U8N, 1u, 40u}}}},
	{VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4, 44u, 4u, {{{VDP_RPU_ATTR_INSTANCE0, 3u, VDP_RPU_ATTR_F32, 0u, 0u}, {VDP_RPU_ATTR_INSTANCE1, 3u, VDP_RPU_ATTR_F32, 0u, 12u}, {VDP_RPU_ATTR_INSTANCE_UVRECT, 4u, VDP_RPU_ATTR_F32, 0u, 24u}, {VDP_RPU_ATTR_INSTANCE_COLOR, 4u, VDP_RPU_ATTR_U8N, 1u, 40u}}}},
	{VDP_RPU_LAYOUT_I_MAT4_C4, 68u, 5u, {{{VDP_RPU_ATTR_INSTANCE0, 4u, VDP_RPU_ATTR_F32, 0u, 0u}, {VDP_RPU_ATTR_INSTANCE1, 4u, VDP_RPU_ATTR_F32, 0u, 16u}, {VDP_RPU_ATTR_INSTANCE2, 4u, VDP_RPU_ATTR_F32, 0u, 32u}, {VDP_RPU_ATTR_INSTANCE3, 4u, VDP_RPU_ATTR_F32, 0u, 48u}, {VDP_RPU_ATTR_INSTANCE_COLOR, 4u, VDP_RPU_ATTR_U8N, 1u, 64u}}}},
}};

inline constexpr std::array<VdpRpuShaderVariantSpec, 8u> VDP_RPU_SHADER_VARIANTS{{
	{VDP_RPU_SHADER_V2_C4, 0u, VDP_RPU_LAYOUT_V2_C4, VDP_RPU_RESOURCE_NONE, 0u, 0u, {}},
	{VDP_RPU_SHADER_V2_T2_C4, 0u, VDP_RPU_LAYOUT_V2_T2_C4, VDP_RPU_RESOURCE_NONE, 1u, 0u, {}},
	{VDP_RPU_SHADER_V3_C4_C0, 0u, VDP_RPU_LAYOUT_V3_C4, VDP_RPU_RESOURCE_NONE, 0u, 1u, {{{0u, 32u, 1u, 0u}}}},
	{VDP_RPU_SHADER_V3_T2_C4_C0, 0u, VDP_RPU_LAYOUT_V3_T2_C4, VDP_RPU_RESOURCE_NONE, 1u, 1u, {{{0u, 32u, 1u, 0u}}}},
	{VDP_RPU_SHADER_V3_N3_T2_C4_C0_C1, 0u, VDP_RPU_LAYOUT_V3_N3_T2_C4, VDP_RPU_RESOURCE_NONE, 1u, 2u, {{{0u, 32u, 1u, 0u}, {1u, 64u, 0u, 1u}}}},
	{VDP_RPU_SHADER_V3_N3_T2_C4_J4_W4_C0_C1, 0u, VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4, VDP_RPU_RESOURCE_NONE, 1u, 3u, {{{0u, 32u, 1u, 0u}, {1u, 384u, 1u, 0u}, {2u, 64u, 0u, 1u}}}},
	{VDP_RPU_SHADER_V2_T2_C4_I_AFFINE2, VDP_RPU_FEATURE_INSTANCED_ARRAYS, VDP_RPU_LAYOUT_V2_T2_C4, VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4, 1u, 0u, {}},
	{VDP_RPU_SHADER_V3_C4_I_MAT4, VDP_RPU_FEATURE_INSTANCED_ARRAYS, VDP_RPU_LAYOUT_V3_C4, VDP_RPU_LAYOUT_I_MAT4_C4, 0u, 0u, {}},
}};

struct VdpRpuCommandBufferSaveState {
	size_t passCount = 0u;
	size_t drawCount = 0u;
	size_t streamBindingCount = 0u;
	size_t constantBindingCount = 0u;
	size_t textureBindingCount = 0u;
	std::vector<u32> passFirstDraw{};
	std::vector<u16> passDrawCount{};
	std::vector<u16> passColorSurfaceRef{};
	std::vector<u16> passDepthSurfaceRef{};
	std::vector<u32> passViewportXY{};
	std::vector<u32> passViewportWH{};
	std::vector<u32> passOps{};
	std::vector<u32> passClearColor{};
	std::vector<u32> passClearDepthWord{};
	std::vector<u16> drawShaderVariant{};
	std::vector<u8> drawPrimitive{};
	std::vector<u32> drawPipelineWord{};
	std::vector<u32> drawVertexCount{};
	std::vector<u32> drawInstanceCount{};
	std::vector<u16> drawIndexBufferRef{};
	std::vector<u32> drawIndexByteOffset{};
	std::vector<u32> drawIndexCount{};
	std::vector<u8> drawIndexType{};
	std::vector<u32> drawFirstStreamBinding{};
	std::vector<u8> drawStreamBindingCount{};
	std::vector<u32> drawFirstConstantBinding{};
	std::vector<u8> drawConstantBindingCount{};
	std::vector<u32> drawFirstTextureBinding{};
	std::vector<u8> drawTextureBindingCount{};
	std::vector<u16> streamLayoutId{};
	std::vector<u16> streamBufferRef{};
	std::vector<u32> streamByteOffset{};
	std::vector<u8> streamStepRate{};
	std::vector<u8> constantBindingSlot{};
	std::vector<u16> constantBank{};
	std::vector<u16> constantFirstWord{};
	std::vector<u16> constantWordCount{};
	std::vector<u8> textureSlot{};
	std::vector<u16> textureSurfaceRef{};
	std::vector<u32> textureSamplerWord{};
};

struct VdpRpuFrameBufferRefSaveState {
	u32 bufferId = 0u;
	u32 revision = 0u;
	u32 byteOffset = 0u;
	u32 byteLength = 0u;
	u32 usage = 0u;
};

struct VdpRpuFrameSurfaceRefSaveState {
	u32 surfaceId = 0u;
	u32 revision = 0u;
	u32 width = 0u;
	u32 height = 0u;
	u32 format = 0u;
	u32 usage = 0u;
};

struct VdpRpuConstantBankSaveState {
	u32 firstWord = 0u;
	u32 wordCount = 0u;
	u32 epoch = 0u;
};

struct VdpRpuBufferRecordSaveState {
	u32 bufferId = 0u;
	u32 liveRevision = 0u;
	u32 byteLength = 0u;
	u32 usage = 0u;
};

struct VdpRpuBufferRevisionSaveState {
	u32 bufferId = 0u;
	u32 revision = 0u;
	std::vector<u8> bytes{};
};

struct VdpRpuSurfaceRecordSaveState {
	u32 surfaceId = 0u;
	u32 liveRevision = 0u;
	u32 width = 0u;
	u32 height = 0u;
	u32 format = 0u;
	u32 usage = 0u;
};

struct VdpRpuSurfaceRevisionSaveState {
	u32 surfaceId = 0u;
	u32 revision = 0u;
	std::vector<u8> bytes{};
};

struct VdpRpuFrameSaveState {
	VdpRpuCommandBufferSaveState commands{};
	std::vector<VdpRpuFrameBufferRefSaveState> bufferRefs{};
	std::vector<VdpRpuFrameSurfaceRefSaveState> surfaceRefs{};
	std::vector<VdpRpuBufferRevisionSaveState> bufferRevisions{};
	std::vector<VdpRpuSurfaceRevisionSaveState> surfaceRevisions{};
	std::vector<u32> constantWords{};
	std::vector<VdpRpuConstantBankSaveState> constantBanks{};
};

struct VdpRpuSaveState {
	VdpRpuFrameBuildState buildState = VDP_RPU_FRAME_IDLE;
	std::vector<VdpRpuBufferRecordSaveState> buffers{};
	std::vector<VdpRpuBufferRevisionSaveState> bufferRevisions{};
	std::vector<VdpRpuSurfaceRecordSaveState> surfaces{};
	std::vector<VdpRpuSurfaceRevisionSaveState> surfaceRevisions{};
	VdpRpuFrameSaveState buildingFrame{};
	VdpRpuFrameSaveState activeFrame{};
	VdpRpuFrameSaveState pendingFrame{};
	VdpRpuFrameSaveState visibleFrame{};
};

std::unique_ptr<VdpRpuFrameOutput> createVdpRpuFrameOutput();
void resetVdpRpuFrameOutput(VdpRpuFrameOutput& frame);
VdpRpuFrameSaveState captureVdpRpuFrameState(const VdpRpuFrameOutput& frame);
void restoreVdpRpuFrameState(VdpRpuFrameOutput& frame, const VdpRpuFrameSaveState& state);

} // namespace bmsx
