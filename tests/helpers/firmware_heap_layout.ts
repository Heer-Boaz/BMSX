import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';

// Locations in the linked BIOS's RAM, inspected by the differential fixtures.
// They are firmware data, not CPU-visible ports or a console ABI.
export const FIRMWARE_IMAGE_BACKINGS_OFFSET = 0x250;
export const FIRMWARE_IMAGE_BACKING_SIZE = 12;
export const FIRMWARE_IMAGE_BACKING_BYTES_OFFSET = 4;
export const FIRMWARE_IMAGE_BACKING_RAM_STRING_END_OFFSET = 8;

export function firmwareImageBackingOffset(management: number, domain: ExecutionDomainId): number {
	return management + FIRMWARE_IMAGE_BACKINGS_OFFSET + FIRMWARE_IMAGE_BACKING_SIZE * (domain + 1);
}

export const HEAP_GC_CONTROL_OFFSET = 0x344;
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
