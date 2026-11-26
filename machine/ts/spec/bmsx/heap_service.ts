// Private CPU runtime stack, inside the management reservation. These
// offsets are relative to its start; ordinary bus masters cannot see them.
export const HEAP_SERVICE_THREAD_OFFSET = 0x800;
export const HEAP_SERVICE_RESULT_OFFSET = 0x850;
export const HEAP_SERVICE_FRAME_OFFSET = 0x880;
export const HEAP_SERVICE_VALUE_OFFSET = 0xc00;
export const HEAP_SERVICE_FRAME_COUNT = 16;
export const HEAP_SERVICE_VALUE_COUNT = 128;
