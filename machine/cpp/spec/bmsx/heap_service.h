#pragma once

#include <cstdint>

namespace bmsx {

// Private CPU runtime stack, inside the management reservation. These
// offsets are relative to its start; ordinary bus masters cannot see them.
constexpr uint32_t HEAP_SERVICE_THREAD_OFFSET = 0x800;
constexpr uint32_t HEAP_SERVICE_RESULT_OFFSET = 0x850;
constexpr uint32_t HEAP_SERVICE_FRAME_OFFSET = 0x880;
constexpr uint32_t HEAP_SERVICE_VALUE_OFFSET = 0xc00;
constexpr uint32_t HEAP_SERVICE_FRAME_COUNT = 16;
constexpr uint32_t HEAP_SERVICE_VALUE_COUNT = 128;

} // namespace bmsx
