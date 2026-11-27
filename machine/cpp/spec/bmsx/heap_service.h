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
	Shrink, AllocationBytes, OccupiedBytes, IsObject,
	AllocateRecord, TableGrow, InterruptPrelude, StoppedFinalMark, CreateCoroutine, ReserveFrameSpace, StoreClosedUpvalue, Count,
};
constexpr uint32_t HEAP_SERVICE_ENTRY_COUNT = static_cast<uint32_t>(HeapServiceOperation::Count);
using HeapServiceFunctions = std::array<uint32_t, HEAP_SERVICE_ENTRY_COUNT>;

constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET = 0u;
constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET = 4u;
constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET = 8u;
constexpr uint32_t HEAP_SERVICE_DESCRIPTOR_SIZE = HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET
	+ 4u * HEAP_SERVICE_ENTRY_COUNT;

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

// Pinned CLOSURE return frontier. The marked destination is the presence
// word; all admission/retry locals live only in the guest activation.
constexpr uint32_t HEAP_SERVICE_CLOSURE_OFFSET = 0xf00;
enum class HeapServiceClosureField : uint32_t {
	Destination = 0, InstructionPc = 4, LastPc = 8, NextPc = 12,
};

enum class HeapServiceRecordKind : uint32_t { Table, CanonicalClosure, DynamicClosure };
enum class HeapServiceRecordMode : uint32_t { Direct = 1, Scheduled, RetryCurrent, RetryFresh };

enum class HeapServiceTableGrowthMode : uint32_t { Scheduled = 0, General = 1 };
enum class HeapServiceTableGrowthStage : uint32_t { Idle, Scheduled, RetryCurrent, RetryFresh };

constexpr uint32_t HEAP_SERVICE_BIOS_CALL_OFFSET = 0xf80;
// Tagged firmware return frontier. The selected ordinary Thread and its
// successor PC are already committed by opcode dispatch, and remain selected
// through the pinned grant. Targets are slot indices or Protected indices.
enum class HeapServiceBiosCallKind : uint32_t { Idle, Discard, Call, Protected };
enum class HeapServiceBiosCallField : uint32_t {
	Kind = 0, InstructionPc = 4, LastPc = 8, Status = 12, Tag = 16, Word = 20,
	ResultBaseOrProtectedIndex = 24, ResultWord = 28,
};

// One pending ordinary VM transfer owns this scratch while backing is acquired.
constexpr uint32_t HEAP_SERVICE_PREPARED_FRAME_OFFSET = 0x1800;
// Entry: 56 bytes of canonical control words followed by the argument plan.
enum class PreparedFrameField : uint32_t { SourceSlot = 56, Supplied = 60, RelocateFormals = 64 };
// Receiving window: raw placement in the live frame; Top=-1 leaves it untouched.
enum class PreparedWindowField : uint32_t { Destination = 0, SourceSlot = 4, Copied = 8, Padded = 12, Capacity = 16, Top = 20 };

constexpr uint32_t HEAP_SERVICE_RESIDENT_OFFSET = 0xfa0;
enum class HeapServiceResidentField : uint32_t { IssuePc = 0, LastPc = 4, SourceBase = 8, SourceCount = 12, SourceCycles = 16, RunKind = 20 };

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
// A word load samples time to the next device deadline after paying the load.
constexpr uint32_t HEAP_SERVICE_REMAINING_DEVICE_CYCLES_ADDRESS = HEAP_SERVICE_ROOT_PORT_BASE + HEAP_SERVICE_ROOT_PORT_BYTES;
constexpr uint32_t HEAP_SERVICE_MANAGEMENT_ADDRESS = HEAP_SERVICE_REMAINING_DEVICE_CYCLES_ADDRESS + 4u;
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

// One reserved Value cell: the payload word, then its separate tag byte.
constexpr uint32_t HEAP_SERVICE_VALUE_CELL_OFFSET = 0x7a0u;
constexpr uint32_t HEAP_SERVICE_VALUE_CELL_TAG_OFFSET = 4u;
constexpr uint32_t HEAP_SERVICE_VALUE_CELL_SIZE = 8u;

} // namespace bmsx
