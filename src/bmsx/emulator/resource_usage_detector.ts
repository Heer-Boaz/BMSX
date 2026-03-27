import { getTrackedLuaHeapBytes } from './lua_heap_usage';
import type { Memory } from './memory';
import {
	IO_REGION_SIZE,
	STRING_HANDLE_COUNT,
	STRING_HANDLE_ENTRY_SIZE,
} from './memory_map';
import type { StringHandleTable } from './string_memory';
import type { VDP } from './vdp';

export class ResourceUsageDetector {
	constructor(
		private readonly memory: Memory,
		private readonly stringHandles: StringHandleTable,
		private readonly vdp: VDP,
	) {
	}

	public getRamUsedBytes(): number {
		return this.computeTrackedRamUsedBytes();
	}

	public getVramUsedBytes(): number {
		return this.vdp.getTrackedUsedVramBytes();
	}

	public getVramTotalBytes(): number {
		return this.vdp.getTrackedTotalVramBytes();
	}

	public getBaseRamUsedBytes(): number {
		return IO_REGION_SIZE
			+ (STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE)
			+ this.stringHandles.usedHeapBytes()
			+ this.memory.getUsedAssetTableBytes()
			+ this.memory.getUsedAssetDataBytes();
	}

	private computeTrackedRamUsedBytes(): number {
		return this.getBaseRamUsedBytes() + getTrackedLuaHeapBytes();
	}
}
