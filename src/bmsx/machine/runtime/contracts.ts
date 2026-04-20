import type { LuaFunctionValue } from '../../lua/value';
import type { Viewport } from '../../rompack/format';
import type { MachineState } from '../machine';
import type { Memory } from '../memory/memory';

export type LuaSnapshotObjects = Record<number, unknown>;
export type LuaSnapshotGraph = { root: unknown; objects: LuaSnapshotObjects };
export type LuaEntrySnapshot = Record<string, unknown> | LuaSnapshotGraph;

export type SymbolKind =
	| 'function'
	| 'table'
	| 'constant';

export type SymbolEntry = {
	name: string;
	kind: SymbolKind;
	valueType: string;
	origin: string;
	module?: string;
};

export type RuntimeOptions = {
	playerIndex: number;
	viewport: Viewport;
	memory: Memory;
	ufpsScaled: number;
	cpuHz: number;
	cycleBudgetPerFrame: number;
	vblankCycles: number;
	vdpWorkUnitsPerSec?: number;
	geoWorkUnitsPerSec?: number;
};

export type RuntimeState = {
	luaRuntimeFailed: boolean;
	luaPath: string;
	storage?: { namespace: string; entries: Array<{ index: number; value: number; }>; };
	luaGlobals?: LuaEntrySnapshot;
	luaLocals?: LuaEntrySnapshot;
	luaRandomSeed?: number;
	luaProgramCounter?: number;
	machine: MachineState;
	cyclesIntoFrame: number;
};

export type LuaMarshalContext = {
	moduleId: string;
	path: string[];
};

export type LuaFunctionRedirectRecord = {
	key: string;
	moduleId: string;
	path: ReadonlyArray<string>;
	current: LuaFunctionValue;
	redirect: LuaFunctionValue;
};
