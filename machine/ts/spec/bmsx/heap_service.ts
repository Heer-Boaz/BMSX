// System BLua32 image extension. The descriptor lives in immutable RODATA
// and is not part of the cartridge-callable BIOS slot list.
export const HEAP_SERVICE_IMAGE_FLAG = 1 << 1;
export const HEAP_SERVICE_IMAGE_ADDRESS_OFFSET = 92;
export const HEAP_SERVICE_IMAGE_HEADER_SIZE = 96;

export const enum HeapServiceOperation {
	SetFloor,
	AllocateRecord, TableGrow, InterruptPrelude, StoppedFinalMark, CreateCoroutine, ReserveFrameSpace, StoreClosedUpvalue, CapturedClosure, Count,
}

export const HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET = 0;
export const HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET = 4;
export const HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET = 8;
export const HEAP_SERVICE_ENTRY_COUNT = HeapServiceOperation.Count;
export const HEAP_SERVICE_DESCRIPTOR_SIZE = HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET + 4 * HEAP_SERVICE_ENTRY_COUNT;

// Private CPU runtime stack, inside the management reservation. These
// offsets are relative to its start; ordinary bus masters cannot see them.
// A BIOS write posts a verified fixed descriptor ordinal plus one. Zero
// means no work to admit at the post-retirement boundary.
export const HEAP_SERVICE_FIXED_WORK_OFFSET = 0x7f0;
export const HEAP_SERVICE_THREAD_OFFSET = 0x800;
export const HEAP_SERVICE_RESULT_OFFSET = 0x850;
export const HEAP_SERVICE_EXEC_TARGET_OFFSET = 0x858;
export const HEAP_SERVICE_EXEC_FLOOR_OFFSET = 0x85c;
export const HEAP_SERVICE_EXEC_PENDING_OFFSET = 0x860;
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


// Pinned CLOSURE return frontier. The marked destination is the presence
// word; all admission/retry locals live only in the guest activation.
export const HEAP_SERVICE_CLOSURE_OFFSET = 0xf00;
export const enum HeapServiceClosureField {
	Destination = 0, InstructionPc = 4, LastPc = 8, NextPc = 12,
}

export const HEAP_SERVICE_CAPTURE_BINDING_OFFSET = 0x7b0;
export const enum HeapServiceCaptureBindingField { Prototype = 0, Domain = 4, BindingFlags = 8, Code = 12, Params = 16, Stack = 20, Flags = 24, Descriptor = 28, Count = 32 }
export const HEAP_SERVICE_CAPTURE_BUS_OFFSET = 0x7e8;
export const HEAP_SERVICE_CAPTURE_DESCRIPTOR_PORT = 0x03000000;

export const enum HeapServiceRecordKind { Table, CanonicalClosure, DynamicClosure }
export const enum HeapServiceRecordMode { Direct = 1, Scheduled, RetryCurrent, RetryFresh }

export const enum HeapServiceTableGrowthMode { Scheduled = 0, General = 1 }
export const enum HeapServiceTableGrowthStage { Idle, Scheduled, RetryCurrent, RetryFresh }

export const HEAP_SERVICE_BIOS_CALL_OFFSET = 0xf80;
// Opcode dispatch commits the ordinary Thread's successor before entering
// the pinned grant. Completion targets are slot indices or Protected indices.
export const enum HeapServiceBiosCallKind { Idle, Discard, Call, Protected }
export const enum HeapServiceBiosCallField {
	Kind = 0, InstructionPc = 4, LastPc = 8, Status = 12, Tag = 16, Word = 20,
	ResultBaseOrProtectedIndex = 24, ResultWord = 28,
}

// One pending ordinary VM transfer owns this scratch while backing is acquired.
export const HEAP_SERVICE_PREPARED_FRAME_OFFSET = 0x1800;

// BIOS-owned data in the unused tail of the physical management reservation.
export const HEAP_SERVICE_FIRMWARE_DATA_OFFSET = 0x1c00;
// Receiving window: raw placement in the live frame; Top=-1 leaves it untouched.
export const enum PreparedWindowField { Destination = 0, SourceSlot = 4, Copied = 8, Padded = 12, Capacity = 16, Top = 20 }

export const HEAP_SERVICE_RESIDENT_OFFSET = 0xfa0;
export const enum HeapServiceResidentField { IssuePc = 0, LastPc = 4, SourceBase = 8, SourceCount = 12, SourceCycles = 16, RunKind = 20 }

// Four Thread addresses followed by the seven root-bank descriptors.
export const HEAP_SERVICE_ROOT_BANKS_OFFSET = 0x600;
export const HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE = 16;
export const HEAP_SERVICE_ROOT_BANK_SIZE = 16;
export const HEAP_SERVICE_ROOT_BANKS_SIZE = HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE + 7 * HEAP_SERVICE_ROOT_BANK_SIZE;
export const enum HeapServiceRootBankField { Count = 0, Payloads = 4, Tags = 8, Names = 12 }

// CPU-private load selectors for the existing non-RAM root storage. These
// logical planes do not occupy memory or participate in ordinary bus decode.
export const HEAP_SERVICE_ROOT_PORT_BASE = 0x01c00000;
export const HEAP_SERVICE_ROOT_PORT_SHIFT = 22;
export const HEAP_SERVICE_ROOT_PORT_STRIDE = 1 << HEAP_SERVICE_ROOT_PORT_SHIFT;
export const enum HeapServiceRootPlane {
	CompletionPayloads, CompletionTags, ConcatPayloads, ConcatTags, Count,
}
export const HEAP_SERVICE_ROOT_PORT_BYTES = HeapServiceRootPlane.Count << HEAP_SERVICE_ROOT_PORT_SHIFT;
// A word load samples time to the next device deadline after paying the load.
export const HEAP_SERVICE_REMAINING_DEVICE_CYCLES_ADDRESS = HEAP_SERVICE_ROOT_PORT_BASE + HEAP_SERVICE_ROOT_PORT_BYTES;
export const HEAP_SERVICE_MANAGEMENT_ADDRESS = HEAP_SERVICE_REMAINING_DEVICE_CYCLES_ADDRESS + 4;
export const HEAP_SERVICE_CALL_CYCLES_ADDRESS = HEAP_SERVICE_MANAGEMENT_ADDRESS + 4;
export const HEAP_SERVICE_CALL_RUN_KIND_ADDRESS = HEAP_SERVICE_MANAGEMENT_ADDRESS + 8;
export const HEAP_SERVICE_CALL_FAULT_ADDRESS = HEAP_SERVICE_MANAGEMENT_ADDRESS + 12;
export const HEAP_SERVICE_RESULT_FAULT = 0xffffffff;

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
}
export const enum HeapServiceObjectSweepAction { None = 0, RetireCanonicalClosure = 2, ObserveRetiredRecord = 4 }

export const HEAP_SERVICE_TRACE_QUANTUM_OFFSET = 0x740;
export const enum HeapServiceTraceField { Work = 0, Limit = 4, Atomic = 8, PendingStringWork = 12, MirrorPolicy = 16 }

// A private STORE selector, not a RAM latch or a mapped bus register.
// The low three bits select a projection; record notifications include the
// aligned record address, while root publication and release take no address.
export const HEAP_SERVICE_GC_PROJECTION_OFFSET = 0x788;
export const HEAP_SERVICE_GC_PROJECTION_MASK = 7;
export const enum HeapServiceProjection {
	PublishRoots = 0, RetireCanonicalClosure = 2, ObserveRetiredRecord = 4, ReleaseStringWork = 5,
}
export const HEAP_SERVICE_GC_ARGUMENTS_OFFSET = 0x790;
export const enum HeapServiceGcArgumentField { ModeKey = 0, NewIndexKey = 4, ActiveThread = 8, PendingTop = 12 }

// One reserved Value cell: the payload word, then its separate tag byte.
export const HEAP_SERVICE_VALUE_CELL_OFFSET = 0x7a0;
export const HEAP_SERVICE_VALUE_CELL_TAG_OFFSET = 4;
export const HEAP_SERVICE_VALUE_CELL_SIZE = 8;
