import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_FRAME_OFFSET, CPU_FIXED_VALUE_COUNT, CPU_FIXED_VALUE_OFFSET } from './memory_map';

// System BLua32 image extension. The descriptor lives in immutable RODATA
// and is not part of the cartridge-callable BIOS slot list.
export const HEAP_SERVICE_IMAGE_FLAG = 1 << 1;
export const HEAP_SERVICE_IMAGE_ADDRESS_OFFSET = 92;
export const HEAP_SERVICE_IMAGE_HEADER_SIZE = 96;

export const enum HeapServiceOperation {
	AllocateRecord, TableGrow, StoppedFinalMark, CapturedClosure, Count,
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
export const HEAP_SERVICE_FRAME_OFFSET = CPU_FIXED_FRAME_OFFSET;
export const HEAP_SERVICE_VALUE_OFFSET = CPU_FIXED_VALUE_OFFSET;
export const HEAP_SERVICE_FRAME_COUNT = CPU_FIXED_FRAME_COUNT;
export const HEAP_SERVICE_VALUE_COUNT = CPU_FIXED_VALUE_COUNT;


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
export const enum HeapServiceBiosCallKind { Idle, Discard, Call }
export const enum HeapServiceBiosCallField {
	Kind = 0, InstructionPc = 4, LastPc = 8, Status = 12, Tag = 16, Word = 20,
	ResultBase = 24, ResultWord = 28,
}

// BIOS-owned data in the unused tail of the physical management reservation.
export const HEAP_SERVICE_FIRMWARE_DATA_OFFSET = 0x1c00;
// Receiving window: raw placement in the live frame; Top=-1 leaves it untouched.

export const HEAP_SERVICE_RESIDENT_OFFSET = 0xfa0;
export const enum HeapServiceResidentField { IssuePc = 0, LastPc = 4, SourceBase = 8, SourceCount = 12, SourceCycles = 16, RunKind = 20 }

// Four Thread addresses followed by the two transient operand-bank descriptors.
export const HEAP_SERVICE_ROOT_BANKS_OFFSET = 0x600;
export const HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE = 16;
export const HEAP_SERVICE_ROOT_BANK_SIZE = 16;
export const HEAP_SERVICE_ROOT_BANKS_SIZE = HEAP_SERVICE_ROOT_BANKS_HEADER_SIZE + HEAP_SERVICE_ROOT_BANK_SIZE;
export const enum HeapServiceRootBankField { Count = 0, Payloads = 4, Tags = 8 }

// CPU-private load selectors for the existing non-RAM root storage. These
// logical planes do not occupy memory or participate in ordinary bus decode.
export const HEAP_SERVICE_ROOT_PORT_BASE = 0x01c00000;
export const HEAP_SERVICE_ROOT_PORT_SHIFT = 22;
export const HEAP_SERVICE_ROOT_PORT_STRIDE = 1 << HEAP_SERVICE_ROOT_PORT_SHIFT;
export const enum HeapServiceRootPlane {
	CompletionPayloads, CompletionTags, Count,
}
export const HEAP_SERVICE_ROOT_PORT_BYTES = HeapServiceRootPlane.Count << HEAP_SERVICE_ROOT_PORT_SHIFT;
// A word load samples time to the next device deadline after paying the load.
export const HEAP_SERVICE_REMAINING_DEVICE_CYCLES_ADDRESS = 0x02c00000;
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

export const HEAP_SERVICE_TRACE_QUANTUM_OFFSET = 0x740;
export const enum HeapServiceTraceField { Work = 0, Limit = 4, Atomic = 8, PendingStringWork = 12, MirrorPolicy = 16 }

// A private CPU-root publication strobe, not a RAM latch or mapped register.
export const HEAP_SERVICE_GC_PROJECTION_OFFSET = 0x788;
export const enum HeapServiceProjection {
	PublishRoots = 0,
}
