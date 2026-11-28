// Locations in the linked BIOS's RAM, inspected by the differential fixtures.
// They are firmware data, not CPU-visible ports or a console ABI.
export const IMAGE_RAM_STRING_END_OFFSET = 12;
export const GC_ROOT_BANKS_OFFSET = 0x600;
export const GC_ROOT_BANKS_HEADER_SIZE = 16;
export const GC_ROOT_BANK_SIZE = 16;
export const GC_ROOT_BANKS_SIZE = GC_ROOT_BANKS_HEADER_SIZE + GC_ROOT_BANK_SIZE;
export const enum GcRootBankField { Count = 0, Payloads = 4, Tags = 8 }
export const GC_DIAGNOSTIC_FAULTS_OFFSET = 0x6c8;
export const GC_TRACE_CONTEXT_OFFSET = 0x740;
export const enum GcTraceContextField { Work = 0, Limit = 4, Atomic = 8, PendingStringWork = 12, MirrorPolicy = 16 }
export const GC_WORKSPACE_END = 0x800;
export const FIRMWARE_DATA_OFFSET = 0x1c00;
