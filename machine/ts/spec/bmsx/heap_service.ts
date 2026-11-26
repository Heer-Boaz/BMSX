import { BiosCall } from './bios';

// System BLua32 image extension. The descriptor lives in immutable RODATA
// and is not part of the cartridge-callable BIOS slot list.
export const HEAP_SERVICE_IMAGE_FLAG = 1 << 1;
export const HEAP_SERVICE_IMAGE_ADDRESS_OFFSET = 92;
export const HEAP_SERVICE_IMAGE_HEADER_SIZE = 96;

export const enum HeapServiceOperation {
	Reset, SetFloor, Floor, Allocate, Free, ReserveBacking, ResizeBacking,
	Shrink, AllocationBytes, OccupiedBytes, IsObject, StringSweep, ObjectSweep, Trace, WeakClear, Remark,
	RootHead, RootBanks, AllocateRecord, ReserveTableGrowth, ResizeTable, InterruptPrelude, FullCollection, Count,
}

export const HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET = 0;
export const HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET = 4;
export const HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET = 8;
export const HEAP_SERVICE_ENTRY_COUNT = HeapServiceOperation.Count + BiosCall.Count;
export const HEAP_SERVICE_DESCRIPTOR_SIZE = HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET + 4 * HEAP_SERVICE_ENTRY_COUNT;

// Private CPU runtime stack, inside the management reservation. These
// offsets are relative to its start; ordinary bus masters cannot see them.
export const HEAP_SERVICE_THREAD_OFFSET = 0x800;
export const HEAP_SERVICE_RESULT_OFFSET = 0x850;
export const HEAP_SERVICE_EXEC_TARGET_OFFSET = 0x858;
export const HEAP_SERVICE_EXEC_FLOOR_OFFSET = 0x85c;
export const HEAP_SERVICE_EXEC_STAGE_OFFSET = 0x860;
export const HEAP_SERVICE_EXEC_PC_OFFSET = 0x864;
export const HEAP_SERVICE_EXEC_BUS_OFFSET = 0x868;
export const HEAP_SERVICE_IRQ_FORWARD_OFFSET = 0x870;
// Cart lane (socket + 1) is the presence word. The vector word itself can
// fault and is not a sentinel.
export const enum HeapServiceIrqForwardField { CartLane = 0, Vector = 4 }
export const HEAP_SERVICE_FRAME_OFFSET = 0x880;
export const HEAP_SERVICE_VALUE_OFFSET = 0x1000;
export const HEAP_SERVICE_FRAME_COUNT = 16;
export const HEAP_SERVICE_VALUE_COUNT = 384;

export const enum HeapServiceExecStage { Idle, First, Retry }

// Pinned CLOSURE return frontier. The marked destination is the presence
// word; all admission/retry locals live only in the guest activation.
export const HEAP_SERVICE_CLOSURE_OFFSET = 0xf00;
export const enum HeapServiceClosureField {
	Destination = 0, InstructionPc = 4, LastPc = 8, NextPc = 12,
}

export const enum HeapServiceRecordKind { Table, CanonicalClosure, DynamicClosure }
export const enum HeapServiceRecordMode { Direct = 1, Scheduled, RetryCurrent, RetryFresh }

export const HEAP_SERVICE_TABLE_GROWTH_OFFSET = 0xf50;
export const enum HeapServiceTableGrowthField {
	Stage = 0, Receiver = 4, ArraySlots = 8, HashSlots = 12, ExtraSlots = 16, ParkExtraSlots = 20,
	InstructionPc = 24, LastPc = 28, NextPc = 32, Budget = 36, Immediate = 40,
}
export const enum HeapServiceTableGrowthStage { Idle, Scheduled, RetryCurrent, RetryFresh }

export const HEAP_SERVICE_BIOS_CALL_OFFSET = 0xf80;
export const enum HeapServiceBiosCallField {
	Destination = 0, InstructionPc = 4, LastPc = 8, Status = 12, Tag = 16, Word = 20,
}

export const HEAP_SERVICE_GC_OFFSET = 0xf20;
export const enum HeapServiceGcField { Stage = 0, PrefixWork = 4, OccupiedBefore = 8, QuantumLimit = 12 }
export const enum HeapServiceGcStage {
	Idle, FullStringSweep, AllocationRecoveryStringSweep, FullObjectSweep, AllocationRecoveryObjectSweep,
	FullTrace, MaintenanceTrace, FullWeakClear, MaintenanceWeakClear, FullRemark, MaintenanceRemark,
	FullRootHead, MaintenanceRootHead, FullRootBanks, MaintenanceRootBanks,
}

// Four Thread addresses followed by the seven root-bank descriptors.
export const HEAP_SERVICE_ROOT_BANKS_OFFSET = 0x600;
export const HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE = 16;
export const HEAP_SERVICE_ROOT_BANK_SIZE = 16;
export const HEAP_SERVICE_ROOT_BANKS_SIZE = HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE + 7 * HEAP_SERVICE_ROOT_BANK_SIZE;
export const enum HeapServiceRootBankField { Count = 0, Payloads = 4, Tags = 8, Names = 12 }

// CPU-private load selectors for the existing non-RAM root storage. These
// logical planes do not occupy memory or participate in ordinary bus decode.
export const HEAP_SERVICE_ROOT_PORT_BASE = 0x01000000;
export const HEAP_SERVICE_ROOT_PORT_SHIFT = 22;
export const HEAP_SERVICE_ROOT_PORT_STRIDE = 1 << HEAP_SERVICE_ROOT_PORT_SHIFT;
export const enum HeapServiceRootPlane {
	SystemConstants, Cart0Constants, Cart1Constants, CompletionPayloads, CompletionTags, ConcatPayloads, ConcatTags, Count,
}
export const HEAP_SERVICE_ROOT_PORT_BYTES = HeapServiceRootPlane.Count << HEAP_SERVICE_ROOT_PORT_SHIFT;
// A word load samples the current instruction grant after paying the load.
export const HEAP_SERVICE_REMAINING_GRANT_ADDRESS = HEAP_SERVICE_ROOT_PORT_BASE + HEAP_SERVICE_ROOT_PORT_BYTES;

// CPU-published head roots borrowed by a single remark quantum. Static
// fault identifiers are a separate pinned word plane, populated at boot.
export const HEAP_SERVICE_REMARK_HEAD_OFFSET = 0x680;
export const HEAP_SERVICE_REMARK_FAULTS_OFFSET = 0x6c8;
export const enum HeapServiceRemarkHeadField {
	PendingStringWork = 0, Mode = 4, Index = 8, NewIndex = 12, Length = 16, Error = 20, FaultIds = 24,
	StringIndexTag = 28, StringIndexWord = 32, ComparisonRemaining = 36, ComparisonLeft = 40, ComparisonRight = 44,
	HasPendingAssignment = 48, Receiver = 52, KeyTag = 56, KeyWord = 60, ValueTag = 64, ValueWord = 68,
}

// Locals of the original object sweep quantum, retained across derived-view
// notifications. Object count and cursor are not committed at such a handoff.
// The originating mirror's release and shrink policies last through the
// remainder of this quantum, including an Object-to-String handoff.
export const HEAP_SERVICE_OBJECT_SWEEP_OFFSET = 0x700;
export const enum HeapServiceObjectSweepField {
	Link = 0, Work = 4, Removed = 8, Deferred = 12, Allowance = 16, MirrorPolicy = 20,
	Action = 24, Header = 28, Next = 32,
	ValueBlock = 36, ValueCapacity = 40, FrameBlock = 44, FrameCapacity = 48,
	ProtectedBlock = 52, ProtectedCapacity = 56,
}
export const enum HeapServiceObjectSweepAction { None, RebindRelocatedThread, RetireCanonicalClosure, RetireThreadView, ObserveRetiredRecord }

export const HEAP_SERVICE_TRACE_QUANTUM_OFFSET = 0x740;
export const enum HeapServiceTraceField { Work = 0, Limit = 4, Atomic = 8, PendingStringWork = 12, MirrorPolicy = 16 }

export const HEAP_SERVICE_TABLE_GROWTH_RESULT_OFFSET = 0x760;
export const enum HeapServiceTableGrowthResultField { HashStorage = 0, ArrayStorage = 4 }
export const HEAP_SERVICE_TABLE_RESIZE_CONTEXT_OFFSET = 0x768;
export const enum HeapServiceTableResizeContextField {
	KeyTag = 0, KeyWord = 4, ValueTag = 8, ValueWord = 12, Previous = 16, Requested = 20, KeepHash = 24, HashBytes = 28,
}

// A private STORE selector, not a RAM latch or a mapped bus register.
// The low three bits select a projection; record notifications include the
// aligned record address, while root publication and release take no address.
export const HEAP_SERVICE_GC_PROJECTION_OFFSET = 0x788;
export const HEAP_SERVICE_GC_PROJECTION_MASK = 7;
export const enum HeapServiceProjection {
	PublishRoots, RebindRelocatedThread, RetireCanonicalClosure, RetireThreadView, ObserveRetiredRecord, ReleaseStringWork,
}
export const HEAP_SERVICE_GC_ARGUMENTS_OFFSET = 0x790;
export const enum HeapServiceGcArgumentField { ModeKey = 0, NewIndexKey = 4, ActiveThread = 8, PendingTop = 12 }
