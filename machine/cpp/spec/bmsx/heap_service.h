#pragma once

#include "memory_map.h"

#include <cstdint>


namespace bmsx {

// Private CPU runtime stack, inside the management reservation. These
// offsets are relative to its start; ordinary bus masters cannot see them.
constexpr uint32_t HEAP_SERVICE_THREAD_OFFSET = 0x800;
constexpr uint32_t HEAP_SERVICE_RESULT_OFFSET = 0x850;
constexpr uint32_t HEAP_SERVICE_FRAME_OFFSET = CPU_FIXED_FRAME_OFFSET;
constexpr uint32_t HEAP_SERVICE_VALUE_OFFSET = CPU_FIXED_VALUE_OFFSET;
constexpr uint32_t HEAP_SERVICE_FRAME_COUNT = CPU_FIXED_FRAME_COUNT;
constexpr uint32_t HEAP_SERVICE_VALUE_COUNT = CPU_FIXED_VALUE_COUNT;


// BIOS-owned data in the unused tail of the physical management reservation.
constexpr uint32_t HEAP_SERVICE_FIRMWARE_DATA_OFFSET = 0x1c00;
// Receiving window: raw placement in the live frame; Top=-1 leaves it untouched.

constexpr uint32_t HEAP_SERVICE_RESIDENT_OFFSET = 0xfa0;
enum class HeapServiceResidentField : uint32_t { IssuePc = 0, LastPc = 4, SourceBase = 8, SourceCount = 12, SourceCycles = 16, RunKind = 20 };

// Four Thread addresses followed by the two transient operand-bank descriptors.
constexpr uint32_t HEAP_SERVICE_ROOT_BANKS_OFFSET = 0x600;
constexpr uint32_t HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE = 16;
constexpr uint32_t HEAP_SERVICE_ROOT_BANK_SIZE = 16;
constexpr uint32_t HEAP_SERVICE_ROOT_BANKS_SIZE = HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE + HEAP_SERVICE_ROOT_BANK_SIZE;
enum class HeapServiceRootBankField : uint32_t { Count = 0, Payloads = 4, Tags = 8 };

// CPU-private load selectors for the existing non-RAM root storage. These
// logical planes do not occupy memory or participate in ordinary bus decode.
constexpr uint32_t HEAP_SERVICE_ROOT_PORT_BASE = 0x01c00000;
constexpr uint32_t HEAP_SERVICE_ROOT_PORT_SHIFT = 22;
constexpr uint32_t HEAP_SERVICE_ROOT_PORT_STRIDE = 1u << HEAP_SERVICE_ROOT_PORT_SHIFT;
enum class HeapServiceRootPlane : uint32_t {
	CompletionPayloads, CompletionTags, Count,
};
constexpr uint32_t HEAP_SERVICE_ROOT_PORT_BYTES = static_cast<uint32_t>(HeapServiceRootPlane::Count) << HEAP_SERVICE_ROOT_PORT_SHIFT;
constexpr uint32_t HEAP_SERVICE_MANAGEMENT_ADDRESS = 0x02c00004u;
constexpr uint32_t HEAP_SERVICE_CALL_CYCLES_ADDRESS = HEAP_SERVICE_MANAGEMENT_ADDRESS + 4u;
constexpr uint32_t HEAP_SERVICE_CALL_RUN_KIND_ADDRESS = HEAP_SERVICE_MANAGEMENT_ADDRESS + 8u;
constexpr uint32_t HEAP_SERVICE_CALL_FAULT_ADDRESS = HEAP_SERVICE_MANAGEMENT_ADDRESS + 12u;
constexpr uint32_t HEAP_SERVICE_RESULT_FAULT = 0xffffffffu;

// CPU-published head roots and the pinned static fault-ID word plane.
constexpr uint32_t HEAP_SERVICE_REMARK_HEAD_OFFSET = 0x680;
constexpr uint32_t HEAP_SERVICE_REMARK_FAULTS_OFFSET = 0x6c8;
enum class HeapServiceRemarkHeadField : uint32_t {
	PendingStringWork = 0, Mode = 4, Index = 8, NewIndex = 12, Length = 16, Error = 20, FaultIds = 24,
	StringIndexTag = 28, StringIndexWord = 32, ComparisonRemaining = 36, ComparisonLeft = 40, ComparisonRight = 44,
};

constexpr uint32_t HEAP_SERVICE_TRACE_QUANTUM_OFFSET = 0x740;
enum class HeapServiceTraceField : uint32_t { Work = 0, Limit = 4, Atomic = 8, PendingStringWork = 12, MirrorPolicy = 16 };

// A private CPU-root publication strobe, not a RAM latch or mapped register.
constexpr uint32_t HEAP_SERVICE_GC_PROJECTION_OFFSET = 0x788;
enum class HeapServiceProjection : uint32_t {
	PublishRoots = 0,
};

} // namespace bmsx
