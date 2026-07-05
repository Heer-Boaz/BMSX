import { RAM_SIZE } from './map';

type LuaHeapUsageHooks = {
	context: unknown;
	getBaseRamUsedBytes(context: unknown): number;
	collectTrackedHeapBytes(context: unknown): number;
};

const MIN_COLLECTION_BYTES = 1024 * 1024;
const DEFAULT_LUA_HEAP_USAGE_CONTEXT = 0;

let trackedLuaHeapBytes = 0;
let nextCollectionBytes = MIN_COLLECTION_BYTES;
let pendingLuaHeapCollection = false;
let luaHeapUsageHooks: LuaHeapUsageHooks = {
	context: DEFAULT_LUA_HEAP_USAGE_CONTEXT,
	getBaseRamUsedBytes: zeroBaseRamUsedBytes,
	collectTrackedHeapBytes: zeroTrackedHeapBytes,
};

function zeroBaseRamUsedBytes(_context: unknown): number {
	return 0;
}

function zeroTrackedHeapBytes(_context: unknown): number {
	return trackedLuaHeapBytes;
}

export function configureLuaHeapUsage<TContext>(
	context: TContext,
	getBaseRamUsedBytes: (context: TContext) => number,
	collectTrackedHeapBytes: (context: TContext) => number,
): void {
	luaHeapUsageHooks = {
		context,
		getBaseRamUsedBytes: getBaseRamUsedBytes as (context: unknown) => number,
		collectTrackedHeapBytes: collectTrackedHeapBytes as (context: unknown) => number,
	};
}

export function resetLuaHeapUsageHooks(): void {
	luaHeapUsageHooks = {
		context: DEFAULT_LUA_HEAP_USAGE_CONTEXT,
		getBaseRamUsedBytes: zeroBaseRamUsedBytes,
		collectTrackedHeapBytes: zeroTrackedHeapBytes,
	};
}

export function resetTrackedLuaHeapBytes(): void {
	trackedLuaHeapBytes = 0;
	nextCollectionBytes = MIN_COLLECTION_BYTES;
	pendingLuaHeapCollection = false;
}

export function addTrackedLuaHeapBytes(delta: number): void {
	trackedLuaHeapBytes += delta;
	if (trackedLuaHeapBytes < 0) {
		throw new Error('[LuaHeapUsage] Tracked heap bytes underflow.');
	}
	if (delta > 0) {
		requestLuaHeapCollectionIfNeeded();
	}
}

export function getTrackedLuaHeapBytes(): number {
	return trackedLuaHeapBytes;
}

export function enforceLuaHeapBudget(): void {
	const totalRamUsedBytes = luaHeapUsageHooks.getBaseRamUsedBytes(luaHeapUsageHooks.context) + trackedLuaHeapBytes;
	if (!pendingLuaHeapCollection && totalRamUsedBytes < RAM_SIZE) {
		return;
	}
	collectTrackedLuaHeapBytes();
}

export function collectTrackedLuaHeapBytes(): void {
	pendingLuaHeapCollection = false;
	trackedLuaHeapBytes = luaHeapUsageHooks.collectTrackedHeapBytes(luaHeapUsageHooks.context);
	nextCollectionBytes = Math.max(MIN_COLLECTION_BYTES, trackedLuaHeapBytes * 2);
	const totalRamUsedBytes = luaHeapUsageHooks.getBaseRamUsedBytes(luaHeapUsageHooks.context) + trackedLuaHeapBytes;
	if (totalRamUsedBytes >= RAM_SIZE) {
		throw new Error(`[LuaHeap] Out of heap memory (${totalRamUsedBytes} >= ${RAM_SIZE}).`);
	}
}

function requestLuaHeapCollectionIfNeeded(): void {
	const totalRamUsedBytes = luaHeapUsageHooks.getBaseRamUsedBytes(luaHeapUsageHooks.context) + trackedLuaHeapBytes;
	if (trackedLuaHeapBytes <= nextCollectionBytes && totalRamUsedBytes < RAM_SIZE) {
		return;
	}
	pendingLuaHeapCollection = true;
}
