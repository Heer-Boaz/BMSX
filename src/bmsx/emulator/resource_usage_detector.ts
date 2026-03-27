import type { CPU, Value } from './cpu';
import type { Memory } from './memory';
import {
	IO_REGION_SIZE,
	STRING_HANDLE_COUNT,
	STRING_HANDLE_ENTRY_SIZE,
} from './memory_map';
import type { StringHandleTable } from './string_memory';
import type { VDP } from './vdp';

export class ResourceUsageDetector {
	private static readonly RAM_REFRESH_INTERVAL_TICKS = 60;
	private static readonly VRAM_REFRESH_INTERVAL_TICKS = 15;

	private ramUsedBytes = 0;
	private vramUsedBytes = 0;
	private lastRamSampleTick = -1;
	private lastVramSampleTick = -1;
	private wasVisibleLastTick = false;

	constructor(
		private readonly cpu: CPU,
		private readonly memory: Memory,
		private readonly stringHandles: StringHandleTable,
		private readonly vdp: VDP,
		private readonly collectRoots: (out: Value[]) => void,
	) {
		this.reset();
	}

	public reset(): void {
		this.ramUsedBytes = this.computeBaseRamUsedBytes();
		this.vramUsedBytes = this.vdp.getTrackedUsedVramBytes();
		this.lastRamSampleTick = -1;
		this.lastVramSampleTick = -1;
		this.wasVisibleLastTick = false;
	}

	public refresh(lastTickSequence: number, visible: boolean): void {
		if (!visible) {
			this.wasVisibleLastTick = false;
			return;
		}
		if (!this.wasVisibleLastTick) {
			this.wasVisibleLastTick = true;
			this.lastRamSampleTick = lastTickSequence;
			this.lastVramSampleTick = -1;
		}
		if (
			this.lastVramSampleTick < 0
			|| (lastTickSequence - this.lastVramSampleTick) >= ResourceUsageDetector.VRAM_REFRESH_INTERVAL_TICKS
		) {
			this.vramUsedBytes = this.vdp.getTrackedUsedVramBytes();
			this.lastVramSampleTick = lastTickSequence;
		}
		if ((lastTickSequence - this.lastRamSampleTick) < ResourceUsageDetector.RAM_REFRESH_INTERVAL_TICKS) {
			return;
		}
		this.ramUsedBytes = this.computeTrackedRamUsedBytes();
		this.lastRamSampleTick = lastTickSequence;
	}

	public getRamUsedBytes(): number {
		return this.ramUsedBytes;
	}

	public getVramUsedBytes(): number {
		return this.vramUsedBytes;
	}

	public getVramTotalBytes(): number {
		return this.vdp.getTrackedTotalVramBytes();
	}

	private computeBaseRamUsedBytes(): number {
		return IO_REGION_SIZE
			+ (STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE)
			+ this.stringHandles.usedHeapBytes()
			+ this.memory.getUsedAssetTableBytes()
			+ this.memory.getUsedAssetDataBytes();
	}

	private computeTrackedRamUsedBytes(): number {
		const extraRoots: Value[] = [];
		this.collectRoots(extraRoots);
		return this.computeBaseRamUsedBytes() + this.cpu.getTrackedHeapBytes(extraRoots);
	}
}
