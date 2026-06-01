#pragma once

#include "common/primitives.h"
#include "machine/devices/device_status.h"
#include "machine/memory/memory.h"
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
constexpr size_t VDP_RPU_PARAM_MEM_SIZE = 0x00400000u;
constexpr u32 VDP_RPU_RESOURCE_NONE = 0xffffffffu;
constexpr u32 VDP_RPU_FAULT_SENTINEL = 0xffffffffu;

constexpr u32 VDP_RPU_FEATURE_INSTANCED_ARRAYS = 1u << 0u;
constexpr u32 VDP_RPU_FEATURE_UINT_INDEX = 1u << 1u;
constexpr u32 VDP_RPU_FEATURE_DEPTH_TEXTURE = 1u << 2u;
constexpr u32 VDP_RPU_REQUIRED_FEATURES = VDP_RPU_FEATURE_INSTANCED_ARRAYS | VDP_RPU_FEATURE_UINT_INDEX;

constexpr u32 VDP_RPU_PACKET_KIND = 0x18000000u;
constexpr u32 VDP_RPU_OP_EXEC_PASS_LIST = 64u;
constexpr u32 VDP_RPU_OP_SEAL_FRAME = 65u;
constexpr u32 VDP_RPU_EXEC_PASS_LIST_WORDS = 2u;
constexpr u32 VDP_RPU_SEAL_FRAME_WORDS = 1u;

constexpr u32 VDP_RPU_CONSTANT_SOURCE_XF_Q16 = 0u;
constexpr u32 VDP_RPU_CONSTANT_SOURCE_LPU_RAW = 1u;
constexpr u32 VDP_RPU_CONSTANT_SOURCE_MFU_Q16 = 2u;
constexpr u32 VDP_RPU_CONSTANT_SOURCE_JTU_Q16 = 3u;
constexpr u32 VDP_RPU_CONSTANT_SOURCE_MASK = 0x00000003u;

constexpr u32 VDP_RPU_FRAME_IDLE = 0u;
constexpr u32 VDP_RPU_FRAME_OPEN = 1u;
using VdpRpuFrameBuildState = u32;

constexpr u32 VDP_RPU_SURFACE_FORMAT_RGBA8 = 0u;
constexpr u32 VDP_RPU_SURFACE_FORMAT_DEPTH16 = 1u;

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
constexpr u32 VDP_FAULT_RPU_FETCH_OOB = 0x0701u;
constexpr u32 VDP_FAULT_RPU_BAD_STREAM_LAYOUT = 0x0702U;
constexpr u32 VDP_FAULT_RPU_COMMAND_OVERFLOW = 0x0708U;
constexpr u32 VDP_FAULT_RPU_BAD_STATE = 0x0709U;

struct VdpRpuCommandBuffer {
	size_t passCount = 0U;
	size_t drawCount = 0U;
	size_t streamBindingCount = 0U;
	size_t constantBindingCount = 0U;
	size_t textureBindingCount = 0U;
	std::array<u32, VDP_RPU_PASS_CAPACITY> passFirstDraw{};
	std::array<u16, VDP_RPU_PASS_CAPACITY> passDrawCount{};
	std::array<u32, VDP_RPU_PASS_CAPACITY> passColorSurfaceDescAddr{};
	std::array<u32, VDP_RPU_PASS_CAPACITY> passDepthSurfaceDescAddr{};
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
	std::array<u32, VDP_RPU_DRAW_CAPACITY> drawIndexVramAddr{};
	std::array<u32, VDP_RPU_DRAW_CAPACITY> drawIndexCount{};
	std::array<u8, VDP_RPU_DRAW_CAPACITY> drawIndexType{};
	std::array<u32, VDP_RPU_DRAW_CAPACITY> drawFirstStreamBinding{};
	std::array<u8, VDP_RPU_DRAW_CAPACITY> drawStreamBindingCount{};
	std::array<u32, VDP_RPU_DRAW_CAPACITY> drawFirstConstantBinding{};
	std::array<u8, VDP_RPU_DRAW_CAPACITY> drawConstantBindingCount{};
	std::array<u32, VDP_RPU_DRAW_CAPACITY> drawFirstTextureBinding{};
	std::array<u8, VDP_RPU_DRAW_CAPACITY> drawTextureBindingCount{};
	std::array<u16, VDP_RPU_STREAM_BINDING_CAPACITY> streamLayoutId{};
	std::array<u8, VDP_RPU_STREAM_BINDING_CAPACITY> streamSlot{};
	std::array<u32, VDP_RPU_STREAM_BINDING_CAPACITY> streamVramAddr{};
	std::array<u32, VDP_RPU_STREAM_BINDING_CAPACITY> streamByteLength{};
	std::array<u8, VDP_RPU_STREAM_BINDING_CAPACITY> streamStepRate{};
	std::array<u8, VDP_RPU_CONSTANT_BINDING_CAPACITY> constantBindingSlot{};
	std::array<u32, VDP_RPU_CONSTANT_BINDING_CAPACITY> constantVramAddr{};
	std::array<u32, VDP_RPU_CONSTANT_BINDING_CAPACITY> constantByteLength{};
	std::array<u8, VDP_RPU_TEXTURE_BINDING_CAPACITY> textureSlot{};
	std::array<u32, VDP_RPU_TEXTURE_BINDING_CAPACITY> textureSurfaceDescAddr{};
};

struct VdpRpuFrameOutput {
	VdpRpuCommandBuffer commands{};
	std::array<u8, VDP_RPU_PARAM_MEM_SIZE>* vdpVram = nullptr;
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
	{.id=VDP_RPU_SHADER_V2_C4, .requiredFeatureMask=0U, .instanceMode=VDP_RPU_INSTANCE_MODE_NONE, .textureSlotCount=0U, .usesC0=0U, .lightingConstantSlot=VDP_RPU_RESOURCE_NONE, .jointConstantSlot=VDP_RPU_RESOURCE_NONE, .constantSlotCount=0U, .constantSlots={}},
	{.id=VDP_RPU_SHADER_V2_T2_C4, .requiredFeatureMask=0U, .instanceMode=VDP_RPU_INSTANCE_MODE_NONE, .textureSlotCount=1U, .usesC0=0U, .lightingConstantSlot=VDP_RPU_RESOURCE_NONE, .jointConstantSlot=VDP_RPU_RESOURCE_NONE, .constantSlotCount=0U, .constantSlots={}},
	{.id=VDP_RPU_SHADER_V3_C4_C0, .requiredFeatureMask=0U, .instanceMode=VDP_RPU_INSTANCE_MODE_NONE, .textureSlotCount=0U, .usesC0=1U, .lightingConstantSlot=VDP_RPU_RESOURCE_NONE, .jointConstantSlot=VDP_RPU_RESOURCE_NONE, .constantSlotCount=1U, .constantSlots={{{.slot=0U, .maxWords=32U, .vertexVisible=1U, .fragmentVisible=0U}}}},
	{.id=VDP_RPU_SHADER_V3_T2_C4_C0, .requiredFeatureMask=0U, .instanceMode=VDP_RPU_INSTANCE_MODE_NONE, .textureSlotCount=1U, .usesC0=1U, .lightingConstantSlot=VDP_RPU_RESOURCE_NONE, .jointConstantSlot=VDP_RPU_RESOURCE_NONE, .constantSlotCount=1U, .constantSlots={{{.slot=0U, .maxWords=32U, .vertexVisible=1U, .fragmentVisible=0U}}}},
	{.id=VDP_RPU_SHADER_V3_N3_T2_C4_C0_C1, .requiredFeatureMask=0U, .instanceMode=VDP_RPU_INSTANCE_MODE_NONE, .textureSlotCount=1U, .usesC0=1U, .lightingConstantSlot=1U, .jointConstantSlot=VDP_RPU_RESOURCE_NONE, .constantSlotCount=2U, .constantSlots={{{.slot=0U, .maxWords=32U, .vertexVisible=1U, .fragmentVisible=0U}, {.slot=1U, .maxWords=72U, .vertexVisible=0U, .fragmentVisible=1U}}}},
	{.id=VDP_RPU_SHADER_V3_N3_T2_C4_J4_W4_C0_C1, .requiredFeatureMask=0U, .instanceMode=VDP_RPU_INSTANCE_MODE_NONE, .textureSlotCount=1U, .usesC0=1U, .lightingConstantSlot=2U, .jointConstantSlot=1U, .constantSlotCount=3U, .constantSlots={{{.slot=0U, .maxWords=32U, .vertexVisible=1U, .fragmentVisible=0U}, {.slot=1U, .maxWords=384U, .vertexVisible=1U, .fragmentVisible=0U}, {.slot=2U, .maxWords=72U, .vertexVisible=0U, .fragmentVisible=1U}}}},
	{.id=VDP_RPU_SHADER_V2_T2_C4_I_AFFINE2, .requiredFeatureMask=VDP_RPU_FEATURE_INSTANCED_ARRAYS, .instanceMode=VDP_RPU_INSTANCE_MODE_AFFINE2, .textureSlotCount=1U, .usesC0=0U, .lightingConstantSlot=VDP_RPU_RESOURCE_NONE, .jointConstantSlot=VDP_RPU_RESOURCE_NONE, .constantSlotCount=0U, .constantSlots={}},
	{.id=VDP_RPU_SHADER_V3_C4_I_MAT4, .requiredFeatureMask=VDP_RPU_FEATURE_INSTANCED_ARRAYS, .instanceMode=VDP_RPU_INSTANCE_MODE_MAT4, .textureSlotCount=0U, .usesC0=0U, .lightingConstantSlot=VDP_RPU_RESOURCE_NONE, .jointConstantSlot=VDP_RPU_RESOURCE_NONE, .constantSlotCount=0U, .constantSlots={}},
}};

auto resolveVdpRpuStreamLayoutSpec(u32 layoutId) -> const VdpRpuStreamLayoutSpec&;
auto resolveVdpRpuShaderVariantSpec(u32 shaderVariant) -> const VdpRpuShaderVariantSpec&;


struct VdpRpuCommandBufferSaveState {
	size_t passCount = 0U;
	size_t drawCount = 0U;
	size_t streamBindingCount = 0U;
	size_t constantBindingCount = 0U;
	size_t textureBindingCount = 0U;
	std::vector<u32> passFirstDraw;
	std::vector<u16> passDrawCount;
	std::vector<u32> passColorSurfaceDescAddr;
	std::vector<u32> passDepthSurfaceDescAddr;
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
	std::vector<u32> drawIndexVramAddr;
	std::vector<u32> drawIndexCount;
	std::vector<u8> drawIndexType;
	std::vector<u32> drawFirstStreamBinding;
	std::vector<u8> drawStreamBindingCount;
	std::vector<u32> drawFirstConstantBinding;
	std::vector<u8> drawConstantBindingCount;
	std::vector<u32> drawFirstTextureBinding;
	std::vector<u8> drawTextureBindingCount;
	std::vector<u16> streamLayoutId;
	std::vector<u8> streamSlot;
	std::vector<u32> streamVramAddr;
	std::vector<u32> streamByteLength;
	std::vector<u8> streamStepRate;
	std::vector<u8> constantBindingSlot;
	std::vector<u32> constantVramAddr;
	std::vector<u32> constantByteLength;
	std::vector<u8> textureSlot;
	std::vector<u32> textureSurfaceDescAddr;
};

struct VdpRpuFrameSaveState {
	VdpRpuCommandBufferSaveState commands{};
};

struct VdpRpuSaveState {
	VdpRpuFrameBuildState buildState = VDP_RPU_FRAME_IDLE;
	std::vector<u8> vdpVram;
};

class VdpRpuUnit {
public:
	VdpRpuUnit(Memory& memory, DeviceStatusLatch& fault);

	std::array<u8, VDP_RPU_PARAM_MEM_SIZE> vdpVram{};
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
	bool lastPacketSealedFrame = false;

private:
	Memory& m_memory;
	DeviceStatusLatch& m_fault;
	VdpRpuFrameBuildState m_buildState = VDP_RPU_FRAME_IDLE;

	auto consumePacketPayloadFromMemory(VdpRpuFrameOutput& frame, u32 op, u32 cursor, u32 payloadWords) -> bool;
	auto consumePacketPayloadFromWords(VdpRpuFrameOutput& frame, const u32* words, u32 op, u32 cursor, u32 payloadWords) -> bool;
	auto acceptExecPassList(VdpRpuFrameOutput& frame, u32 opWord, u32 passDescAddr) -> bool;
	auto acceptSealFrame(VdpRpuFrameOutput& frame) -> bool;
	[[nodiscard]] auto checkVramRange(u32 addr, u32 size) -> bool;
};

auto createVdpRpuFrameOutput() -> std::unique_ptr<VdpRpuFrameOutput>;
void resetVdpRpuFrameOutput(VdpRpuFrameOutput& frame);
auto captureVdpRpuFrameState(const VdpRpuFrameOutput& frame) -> VdpRpuFrameSaveState;
void restoreVdpRpuFrameState(VdpRpuFrameOutput& frame, const VdpRpuFrameSaveState& state);

} // namespace bmsx
