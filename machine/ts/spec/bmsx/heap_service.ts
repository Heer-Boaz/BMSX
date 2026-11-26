// System BLua32 image extension. The descriptor lives in immutable RODATA
// and is not part of the cartridge-callable BIOS slot list.
export const HEAP_SERVICE_IMAGE_FLAG = 1 << 1;
export const HEAP_SERVICE_IMAGE_ADDRESS_OFFSET = 92;
export const HEAP_SERVICE_IMAGE_HEADER_SIZE = 96;

export const enum HeapServiceOperation {
	Reset, SetFloor, Floor, Allocate, Free, ReserveBacking, ResizeBacking,
	Shrink, AllocationBytes, OccupiedBytes, IsObject, CreateTable, StringSweep, ObjectSweep, Count,
}

export const HEAP_SERVICE_DESCRIPTOR_VERSION = 7;
export const HEAP_SERVICE_DESCRIPTOR_VERSION_OFFSET = 0;
export const HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET = 4;
export const HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET = 8;
export const HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET = 12;
export const HEAP_SERVICE_DESCRIPTOR_SIZE = HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET + 4 * HeapServiceOperation.Count;

// Private CPU runtime stack, inside the management reservation. These
// offsets are relative to its start; ordinary bus masters cannot see them.
export const HEAP_SERVICE_THREAD_OFFSET = 0x800;
export const HEAP_SERVICE_RESULT_OFFSET = 0x850;
export const HEAP_SERVICE_DEFERRED_PRESSURE_OFFSET = 0x854;
export const HEAP_SERVICE_EXEC_TARGET_OFFSET = 0x858;
export const HEAP_SERVICE_EXEC_FLOOR_OFFSET = 0x85c;
export const HEAP_SERVICE_EXEC_STAGE_OFFSET = 0x860;
export const HEAP_SERVICE_EXEC_PC_OFFSET = 0x864;
export const HEAP_SERVICE_EXEC_BUS_OFFSET = 0x868;
export const HEAP_SERVICE_FRAME_OFFSET = 0x880;
export const HEAP_SERVICE_VALUE_OFFSET = 0xc00;
export const HEAP_SERVICE_FRAME_COUNT = 16;
export const HEAP_SERVICE_VALUE_COUNT = 128;

export const enum HeapServiceExecStage { Idle, First, Retry }

export const HEAP_SERVICE_NEWT_OFFSET = 0xf00;
export const enum HeapServiceNewtField {
	Stage = 0, Destination = 4, ArraySize = 8, HashSize = 12,
	InstructionPc = 16, LastPc = 20, NextPc = 24, DirectRecovery = 28,
}
export const enum HeapServiceNewtStage { Idle, Direct, Scheduled, RetryCurrent, RetryFresh }

export const HEAP_SERVICE_GC_OFFSET = 0xf20;
export const enum HeapServiceGcField { Stage = 0, PrefixWork = 4, OccupiedBefore = 8, QuantumLimit = 12 }
export const enum HeapServiceGcStage { Idle, FullStringSweep, AllocationRecoveryStringSweep, FullObjectSweep, AllocationRecoveryObjectSweep }

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
