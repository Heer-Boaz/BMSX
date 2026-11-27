import { IMAGE_STRING_RAM_ORDINAL } from '../../machine/ts/machine/cpu/execution_image';
import { isRamStringId, type StringId } from '../../machine/ts/machine/cpu/string_pool';
import type { Memory } from '../../machine/ts/machine/memory/memory';

// Locations in the linked BIOS's RAM, inspected by the differential fixtures.
// They are firmware data, not CPU-visible ports or a console ABI.
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

// Reference writer for comparing the compact binding emitted by firmware.
export function storeImageStringBinding(memory: Memory, base: number, count: number, slot: number, ramCount: number, id: StringId): number {
	const ram = +isRamStringId(id), right = count - 1 - (slot - ramCount);
	const dest = ram ? ramCount : right;
	const sourceAddress = base + 4 * slot;
	if (dest === slot) {
		memory.writeRamRecordWord(sourceAddress, id | ram);
	} else {
		const address = base + 4 * dest;
		const flag = dest < slot ? memory.readRamRecordWord(address) & IMAGE_STRING_RAM_ORDINAL : 0;
		memory.writeRamRecordWord(address, id | flag);
		const payload = (slot < ramCount || slot > right) ? memory.readRamRecordWord(sourceAddress) & ~IMAGE_STRING_RAM_ORDINAL : 0;
		memory.writeRamRecordWord(sourceAddress, payload | ram);
	}
	return ramCount + ram;
}
