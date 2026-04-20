import { RAM_SIZE } from './map';

type LuaHeapUsageHooks = {
	getBaseRamUsedBytes(): number;
	collectTrackedHeapBytes(): number;
};

const MIN_COLLECTION_BYTES = 1024 * 1024;

let trackedLuaHeapBytes = 0;
let nextCollectionBytes = MIN_COLLECTION_BYTES;
let luaHeapUsageHooks: LuaHeapUsageHooks | null = null;

export function configureLuaHeapUsage(hooks: LuaHeapUsageHooks): void {
	luaHeapUsageHooks = hooks;
}

export function resetTrackedLuaHeapBytes(): void {
	trackedLuaHeapBytes = 0;
	nextCollectionBytes = MIN_COLLECTION_BYTES;
}

export function addTrackedLuaHeapBytes(delta: number): void {
	trackedLuaHeapBytes += delta;
	if (trackedLuaHeapBytes < 0) {
		throw new Error('[LuaHeapUsage] Tracked heap bytes underflow.');
	}
	if (delta > 0) {
		collectIfHeapPressureExceeded();
	}
}

export function getTrackedLuaHeapBytes(): number {
	return trackedLuaHeapBytes;
}

export function enforceLuaHeapBudget(): void {
	if (luaHeapUsageHooks === null) {
		return;
	}
	collectIfHeapPressureExceeded();
}

export function collectTrackedLuaHeapBytes(): void {
	if (luaHeapUsageHooks === null) {
		return;
	}
	trackedLuaHeapBytes = luaHeapUsageHooks.collectTrackedHeapBytes();
	nextCollectionBytes = Math.max(MIN_COLLECTION_BYTES, trackedLuaHeapBytes * 2);
	const totalRamUsedBytes = luaHeapUsageHooks.getBaseRamUsedBytes() + trackedLuaHeapBytes;
	if (totalRamUsedBytes >= RAM_SIZE) {
		throw new Error(`[LuaHeap] Out of heap memory (${totalRamUsedBytes} >= ${RAM_SIZE}).`);
	}
}

function collectIfHeapPressureExceeded(): void {
	if (luaHeapUsageHooks === null) {
		return;
	}
	const totalRamUsedBytes = luaHeapUsageHooks.getBaseRamUsedBytes() + trackedLuaHeapBytes;
	if (trackedLuaHeapBytes <= nextCollectionBytes && totalRamUsedBytes < RAM_SIZE) {
		return;
	}
	collectTrackedLuaHeapBytes();
}
