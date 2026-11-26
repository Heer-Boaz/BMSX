// System BLua32 image extension. The descriptor lives in immutable RODATA
// and is not part of the cartridge-callable BIOS slot list.
export const HEAP_SERVICE_IMAGE_FLAG = 1 << 1;
export const HEAP_SERVICE_IMAGE_ADDRESS_OFFSET = 92;
export const HEAP_SERVICE_IMAGE_HEADER_SIZE = 96;

export const enum HeapServiceOperation {
	Reset, SetFloor, Floor, Allocate, Free, ReserveBacking, ResizeBacking,
	Shrink, AllocationBytes, OccupiedBytes, IsObject, Count,
}

export const HEAP_SERVICE_DESCRIPTOR_VERSION = 1;
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
