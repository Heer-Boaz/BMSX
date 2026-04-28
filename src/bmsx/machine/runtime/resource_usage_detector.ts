import { getTrackedLuaHeapBytes } from '../memory/lua_heap_usage';
import {
	IO_REGION_SIZE,
	STRING_HANDLE_COUNT,
	STRING_HANDLE_ENTRY_SIZE,
} from '../memory/map';
import type { StringHandleTable } from '../memory/string/memory';
import type { VDP } from '../devices/vdp/vdp';

export class ResourceUsageDetector {
	constructor(
		private readonly stringHandles: StringHandleTable,
		private readonly vdp: VDP,
	) {
	}

	// disable-next-line single_line_method_pattern -- public RAM usage accessor hides the tracked-memory accounting details.
	public getRamUsedBytes(): number {
		return this.computeTrackedRamUsedBytes();
	}

	public getVramUsedBytes(): number {
		return this.vdp.trackedUsedVramBytes;
	}

	public getVramTotalBytes(): number {
		return this.vdp.trackedTotalVramBytes;
	}

	public getBaseRamUsedBytes(): number {
		return IO_REGION_SIZE
			+ (STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE)
			+ this.stringHandles.usedHeapBytes();
	}

	private computeTrackedRamUsedBytes(): number {
		return this.getBaseRamUsedBytes() + getTrackedLuaHeapBytes();
	}
}
