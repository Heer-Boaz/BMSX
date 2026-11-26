#pragma once

#include <array>
#include <cstdint>

namespace bmsx {

// System BLua32 image extension. The descriptor lives in immutable RODATA
// and is not part of the cartridge-callable BIOS slot list.
constexpr uint32_t HEAP_SERVICE_IMAGE_FLAG = 1u << 1u;
constexpr uint32_t HEAP_SERVICE_IMAGE_ADDRESS_OFFSET = 92u;
constexpr uint32_t HEAP_SERVICE_IMAGE_HEADER_SIZE = 96u;

enum class HeapServiceOperation : uint32_t {
	Reset, SetFloor, Floor, Allocate, Free, ReserveBacking, ResizeBacking,
	Shrink, AllocationBytes, OccupiedBytes, IsObject, CreateTable, StringSweep, ObjectSweep, Trace, WeakClear, Remark,
	RootHead, RootBanks, CreateClosure, ReserveTableGrowth, ResizeTable, InterruptPrelude, Count,
};
using HeapServiceFunctions = std::array<uint32_t, static_cast<uint32_t>(HeapServiceOperation::Count)>;

constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET = 0u;
constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET = 4u;
constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET = 8u;
constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_SIZE = HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET
	+ 4u * static_cast<uint32_t>(HeapServiceOperation::Count);

// Private CPU runtime stack, inside the management reservation. These
// offsets are relative to its start; ordinary bus masters cannot see them.
constexpr uint32_t HEAP_SERVICE_THREAD_OFFSET = 0x800;
constexpr uint32_t HEAP_SERVICE_RESULT_OFFSET = 0x850;
constexpr uint32_t HEAP_SERVICE_EXEC_TARGET_OFFSET = 0x858;
constexpr uint32_t HEAP_SERVICE_EXEC_FLOOR_OFFSET = 0x85c;
constexpr uint32_t HEAP_SERVICE_EXEC_STAGE_OFFSET = 0x860;
constexpr uint32_t HEAP_SERVICE_EXEC_PC_OFFSET = 0x864;
constexpr uint32_t HEAP_SERVICE_EXEC_BUS_OFFSET = 0x868;
constexpr uint32_t HEAP_SERVICE_IRQ_FORWARD_OFFSET = 0x870;
// Cart lane (socket + 1) is the presence word. The vector word itself can
// fault and is not a sentinel.
enum class HeapServiceIrqForwardField : uint32_t { CartLane = 0, Vector = 4 };
constexpr uint32_t HEAP_SERVICE_FRAME_OFFSET = 0x880;
constexpr uint32_t HEAP_SERVICE_VALUE_OFFSET = 0x1000;
constexpr uint32_t HEAP_SERVICE_FRAME_COUNT = 16;
constexpr uint32_t HEAP_SERVICE_VALUE_COUNT = 384;

enum class HeapServiceExecStage : uint32_t { Idle, First, Retry };

constexpr uint32_t HEAP_SERVICE_RECORD_OFFSET = 0xf00;
enum class HeapServiceRecordField : uint32_t {
	Stage = 0, Destination = 4, ArraySize = 8, HashSize = 12, Prototype = 8, ExecutionDomain = 12,
	InstructionPc = 16, LastPc = 20, NextPc = 24, DirectRecovery = 28,
};
enum class HeapServiceRecordStage : uint32_t {
	Idle, Direct, Scheduled, RetryCurrent, RetryFresh, DirectRecovery, LogicalAssist, PhysicalAssist, DirectLogicalRecovery,
};

constexpr uint32_t HEAP_SERVICE_RECORD_CONTROL_OFFSET = 0xf30;
enum class HeapServiceRecordControlField : uint32_t {
	Budget = 0, EpochBefore = 4, Debt = 8, Pressure = 12, ReservationStage = 16, Kind = 20,
};

enum class HeapServiceRecordKind : uint32_t { Table, CanonicalClosure };

constexpr uint32_t HEAP_SERVICE_TABLE_GROWTH_OFFSET = 0xf50u;
enum class HeapServiceTableGrowthField : uint32_t {
	Stage = 0, Receiver = 4, ArraySlots = 8, HashSlots = 12, ExtraSlots = 16, ParkExtraSlots = 20,
	InstructionPc = 24, LastPc = 28, NextPc = 32, Budget = 36, Immediate = 40,
};
enum class HeapServiceTableGrowthStage : uint32_t { Idle, Scheduled, RetryCurrent, RetryFresh };

constexpr uint32_t HEAP_SERVICE_GC_OFFSET = 0xf20;
enum class HeapServiceGcField : uint32_t { Stage = 0, PrefixWork = 4, OccupiedBefore = 8, QuantumLimit = 12 };
enum class HeapServiceGcStage : uint32_t {
	Idle, FullStringSweep, AllocationRecoveryStringSweep, FullObjectSweep, AllocationRecoveryObjectSweep,
	FullTrace, MaintenanceTrace, FullWeakClear, MaintenanceWeakClear, FullRemark, MaintenanceRemark,
	FullRootHead, MaintenanceRootHead, FullRootBanks, MaintenanceRootBanks,
};

// Four Thread addresses followed by the seven root-bank descriptors.
constexpr uint32_t HEAP_SERVICE_ROOT_BANKS_OFFSET = 0x600;
constexpr uint32_t HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE = 16;
constexpr uint32_t HEAP_SERVICE_ROOT_BANK_SIZE = 16;
constexpr uint32_t HEAP_SERVICE_ROOT_BANKS_SIZE = HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE + 7u * HEAP_SERVICE_ROOT_BANK_SIZE;
enum class HeapServiceRootBankField : uint32_t { Count = 0, Payloads = 4, Tags = 8, Names = 12 };

// CPU-private load selectors for the existing non-RAM root storage. These
// logical planes do not occupy memory or participate in ordinary bus decode.
constexpr uint32_t HEAP_SERVICE_ROOT_PORT_BASE = 0x01000000;
constexpr uint32_t HEAP_SERVICE_ROOT_PORT_SHIFT = 22;
constexpr uint32_t HEAP_SERVICE_ROOT_PORT_STRIDE = 1u << HEAP_SERVICE_ROOT_PORT_SHIFT;
enum class HeapServiceRootPlane : uint32_t {
	SystemConstants, Cart0Constants, Cart1Constants, CompletionPayloads, CompletionTags, ConcatPayloads, ConcatTags, Count,
};
constexpr uint32_t HEAP_SERVICE_ROOT_PORT_BYTES = static_cast<uint32_t>(HeapServiceRootPlane::Count) << HEAP_SERVICE_ROOT_PORT_SHIFT;

// CPU-published head roots and the pinned static fault-ID word plane.
constexpr uint32_t HEAP_SERVICE_REMARK_HEAD_OFFSET = 0x680;
constexpr uint32_t HEAP_SERVICE_REMARK_FAULTS_OFFSET = 0x6c8;
enum class HeapServiceRemarkHeadField : uint32_t {
	PendingStringWork = 0, Mode = 4, Index = 8, NewIndex = 12, Length = 16, Error = 20, FaultIds = 24,
	StringIndexTag = 28, StringIndexWord = 32, ComparisonRemaining = 36, ComparisonLeft = 40, ComparisonRight = 44,
	HasPendingAssignment = 48, Receiver = 52, KeyTag = 56, KeyWord = 60, ValueTag = 64, ValueWord = 68,
};

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

constexpr uint32_t HEAP_SERVICE_TRACE_QUANTUM_OFFSET = 0x740;
enum class HeapServiceTraceField : uint32_t { Work = 0, Limit = 4, Atomic = 8, PendingStringWork = 12, MirrorPolicy = 16 };

constexpr uint32_t HEAP_SERVICE_TABLE_GROWTH_RESULT_OFFSET = 0x760;
enum class HeapServiceTableGrowthResultField : uint32_t { HashStorage = 0, ArrayStorage = 4 };
constexpr uint32_t HEAP_SERVICE_TABLE_RESIZE_CONTEXT_OFFSET = 0x768;
enum class HeapServiceTableResizeContextField : uint32_t {
	KeyTag = 0, KeyWord = 4, ValueTag = 8, ValueWord = 12, Previous = 16, Requested = 20, KeepHash = 24, HashBytes = 28,
};

// A private STORE selector, not a RAM latch or a mapped bus register.
// The low three bits select a projection; record notifications include the
// aligned record address, while root publication and release take no address.
constexpr uint32_t HEAP_SERVICE_GC_PROJECTION_OFFSET = 0x788;
constexpr uint32_t HEAP_SERVICE_GC_PROJECTION_MASK = 7;
enum class HeapServiceProjection : uint32_t {
	PublishRoots, RebindRelocatedThread, RetireCanonicalClosure, RetireThreadView, ObserveRetiredRecord, ReleaseStringWork,
};
constexpr uint32_t HEAP_SERVICE_GC_ARGUMENTS_OFFSET = 0x790;
enum class HeapServiceGcArgumentField : uint32_t { ModeKey = 0, NewIndexKey = 4, ActiveThread = 8, PendingTop = 12 };

} // namespace bmsx
