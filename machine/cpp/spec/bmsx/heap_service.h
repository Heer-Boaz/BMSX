#pragma once

#include <cstdint>

namespace bmsx {

// System BLua32 image extension. The descriptor lives in immutable RODATA
// and is not part of the cartridge-callable BIOS slot list.
constexpr uint32_t HEAP_SERVICE_IMAGE_FLAG = 1u << 1u;
constexpr uint32_t HEAP_SERVICE_IMAGE_ADDRESS_OFFSET = 92u;
constexpr uint32_t HEAP_SERVICE_IMAGE_HEADER_SIZE = 96u;

enum class HeapServiceOperation : uint32_t {
	Reset, SetFloor, Floor, Allocate, Free, ReserveBacking, ResizeBacking,
	Shrink, AllocationBytes, OccupiedBytes, IsObject, ReserveRecord, StringSweep, ObjectSweep, Count,
};

constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_VERSION = 6u;
constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_VERSION_OFFSET = 0u;
constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET = 4u;
constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET = 8u;
constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET = 12u;
constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_SIZE = HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET
	+ 4u * static_cast<uint32_t>(HeapServiceOperation::Count);

// Private CPU runtime stack, inside the management reservation. These
// offsets are relative to its start; ordinary bus masters cannot see them.
constexpr uint32_t HEAP_SERVICE_THREAD_OFFSET = 0x800;
constexpr uint32_t HEAP_SERVICE_RESULT_OFFSET = 0x850;
constexpr uint32_t HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET = 0x854;
constexpr uint32_t HEAP_SERVICE_EXEC_TARGET_OFFSET = 0x858;
constexpr uint32_t HEAP_SERVICE_EXEC_FLOOR_OFFSET = 0x85c;
constexpr uint32_t HEAP_SERVICE_EXEC_STAGE_OFFSET = 0x860;
constexpr uint32_t HEAP_SERVICE_EXEC_PC_OFFSET = 0x864;
constexpr uint32_t HEAP_SERVICE_EXEC_BUS_OFFSET = 0x868;
constexpr uint32_t HEAP_SERVICE_FRAME_OFFSET = 0x880;
constexpr uint32_t HEAP_SERVICE_VALUE_OFFSET = 0xc00;
constexpr uint32_t HEAP_SERVICE_FRAME_COUNT = 16;
constexpr uint32_t HEAP_SERVICE_VALUE_COUNT = 128;

enum class HeapServiceExecStage : uint32_t { Idle, First, Retry };

constexpr uint32_t HEAP_SERVICE_NEWT_OFFSET = 0xf00;
enum class HeapServiceNewtField : uint32_t {
	Stage = 0, Destination = 4, ArraySize = 8, HashSize = 12,
	InstructionPc = 16, LastPc = 20, NextPc = 24, DirectRecovery = 28,
};
enum class HeapServiceNewtStage : uint32_t { Idle, Direct, Scheduled, RetryCurrent, RetryFresh };

constexpr uint32_t HEAP_SERVICE_GC_OFFSET = 0xf20;
enum class HeapServiceGcField : uint32_t { Stage = 0, PrefixWork = 4, OccupiedBefore = 8, QuantumLimit = 12 };
enum class HeapServiceGcStage : uint32_t { Idle, FullStringSweep, AllocationRecoveryStringSweep, FullObjectSweep, AllocationRecoveryObjectSweep };

// Locals of the original object sweep quantum, retained across derived-view
// notifications. Object count and cursor are not committed at such a handoff.
// The originating mirror's release and shrink policies last through the
// remainder of this quantum, including an Object-to-String handoff.
constexpr uint32_t HEAP_SERVICE_OBJECT_SWEEP_OFFSET = 0x700;
enum class HeapServiceObjectSweepField : uint32_t {
	Link = 0, Work = 4, Removed = 8, Deferred = 12, Allowance = 16, MirrorPolicy = 20,
	Action = 24, Header = 28, Next = 32,
	ValueBlock = 36, ValueCapacity = 40, FrameBlock = 44, FrameCapacity = 48,
	ProtectedBlock = 52, ProtectedCapacity = 56,
};
enum class HeapServiceObjectSweepAction : uint32_t { None, RebindRelocatedThread, RetireCanonicalClosure, RetireThreadView, ObserveRetiredRecord };

} // namespace bmsx
