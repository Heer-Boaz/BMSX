#pragma once

#include "common/primitives.h"

#include <cstddef>

namespace bmsx {

constexpr u32 ROM_TOC_MAGIC = 0x434f5442u;
constexpr u32 ROM_TOC_HEADER_SIZE = 48u;
constexpr u32 ROM_TOC_ENTRY_SIZE = 88u;
constexpr u32 ROM_TOC_INVALID_U32 = 0xffffffffu;

constexpr u32 ROM_TOC_OP_NONE = 0u;
constexpr u32 ROM_TOC_OP_DELETE = 1u;

constexpr u32 ROM_TOC_ASSET_TYPE_IMAGE = 1u;
constexpr u32 ROM_TOC_ASSET_TYPE_AUDIO = 2u;
constexpr u32 ROM_TOC_ASSET_TYPE_DATA = 3u;
constexpr u32 ROM_TOC_ASSET_TYPE_BIN = 4u;
constexpr u32 ROM_TOC_ASSET_TYPE_COLLISION_SHAPE = 5u;
constexpr u32 ROM_TOC_ASSET_TYPE_ROMLABEL = 6u;
constexpr u32 ROM_TOC_ASSET_TYPE_MODEL = 7u;
constexpr u32 ROM_TOC_ASSET_TYPE_AEM = 8u;
constexpr u32 ROM_TOC_ASSET_TYPE_LUA = 9u;
constexpr u32 ROM_TOC_ASSET_TYPE_CODE = 10u;
constexpr u32 ROM_TOC_ASSET_TYPE_TEXTURE = 11u;

constexpr size_t ROM_TOC_HEADER_MAGIC_OFFSET = 0u;
constexpr size_t ROM_TOC_HEADER_SIZE_OFFSET = 4u;
constexpr size_t ROM_TOC_HEADER_ENTRY_SIZE_OFFSET = 8u;
constexpr size_t ROM_TOC_HEADER_ENTRY_COUNT_OFFSET = 12u;
constexpr size_t ROM_TOC_HEADER_ENTRY_TABLE_OFFSET = 16u;
constexpr size_t ROM_TOC_HEADER_STRING_TABLE_OFFSET = 20u;
constexpr size_t ROM_TOC_HEADER_STRING_TABLE_LENGTH_OFFSET = 24u;
constexpr size_t ROM_TOC_HEADER_PROJECT_ROOT_OFFSET = 28u;
constexpr size_t ROM_TOC_HEADER_PROJECT_ROOT_LENGTH_OFFSET = 32u;
constexpr size_t ROM_TOC_HEADER_RESERVED_0_OFFSET = 36u;
constexpr size_t ROM_TOC_HEADER_RESERVED_1_OFFSET = 40u;
constexpr size_t ROM_TOC_HEADER_RESERVED_2_OFFSET = 44u;

constexpr size_t ROM_TOC_ENTRY_TOKEN_LO_OFFSET = 0u;
constexpr size_t ROM_TOC_ENTRY_TOKEN_HI_OFFSET = 4u;
constexpr size_t ROM_TOC_ENTRY_ASSET_TYPE_OFFSET = 8u;
constexpr size_t ROM_TOC_ENTRY_OPERATION_OFFSET = 12u;
constexpr size_t ROM_TOC_ENTRY_RESID_OFFSET = 16u;
constexpr size_t ROM_TOC_ENTRY_RESID_LENGTH_OFFSET = 20u;
constexpr size_t ROM_TOC_ENTRY_SOURCE_PATH_OFFSET = 24u;
constexpr size_t ROM_TOC_ENTRY_SOURCE_PATH_LENGTH_OFFSET = 28u;
constexpr size_t ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_OFFSET = 32u;
constexpr size_t ROM_TOC_ENTRY_NORMALIZED_SOURCE_PATH_LENGTH_OFFSET = 36u;
constexpr size_t ROM_TOC_ENTRY_DATA_START_OFFSET = 40u;
constexpr size_t ROM_TOC_ENTRY_DATA_END_OFFSET = 44u;
constexpr size_t ROM_TOC_ENTRY_COMPILED_START_OFFSET = 48u;
constexpr size_t ROM_TOC_ENTRY_COMPILED_END_OFFSET = 52u;
constexpr size_t ROM_TOC_ENTRY_METADATA_START_OFFSET = 56u;
constexpr size_t ROM_TOC_ENTRY_METADATA_END_OFFSET = 60u;
constexpr size_t ROM_TOC_ENTRY_MODEL_TEXTURE_START_OFFSET = 64u;
constexpr size_t ROM_TOC_ENTRY_MODEL_TEXTURE_END_OFFSET = 68u;
constexpr size_t ROM_TOC_ENTRY_COLLISION_BIN_START_OFFSET = 72u;
constexpr size_t ROM_TOC_ENTRY_COLLISION_BIN_END_OFFSET = 76u;
constexpr size_t ROM_TOC_ENTRY_UPDATE_TIMESTAMP_LO_OFFSET = 80u;
constexpr size_t ROM_TOC_ENTRY_UPDATE_TIMESTAMP_HI_OFFSET = 84u;

} // namespace bmsx
