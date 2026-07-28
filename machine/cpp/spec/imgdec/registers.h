#pragma once

#include "common/primitives.h"

#include <cstddef>

namespace bmsx {

constexpr u32 IMGDEC_CONTROL_START = 1u << 0u;

constexpr u32 IMGDEC_STATUS_BUSY = 1u << 0u;
constexpr u32 IMGDEC_STATUS_DONE = 1u << 1u;
constexpr u32 IMGDEC_STATUS_INPUT_REQUEST = 1u << 2u;
constexpr u32 IMGDEC_STATUS_OUTPUT_REQUEST = 1u << 3u;
constexpr u32 IMGDEC_STATUS_FORMAT_FAULT = 1u << 4u;

constexpr size_t IMGDEC_INPUT_FIFO_WORD_CAPACITY = 32u;
constexpr size_t IMGDEC_OUTPUT_FIFO_WORD_CAPACITY = 64u;
constexpr u32 IMGDEC_DMA_BLOCK_WORDS = 16u;

} // namespace bmsx
