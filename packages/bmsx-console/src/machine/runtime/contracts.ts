import type { LuaFunctionValue } from '../../lua/value';
import type { CartManifest, MachineManifest, Viewport } from '../../rompack/format';
import type { Memory } from '../memory/memory';
import type { LuaEntrySnapshot } from './host/native_bridge';
import type { RuntimeMachineState } from './machine_state';
import type { RuntimeSaveMachineState } from './save_machine_state';
import type { RuntimeSaveState } from './save_state';

export type { LuaEntrySnapshot };
export type {
	RuntimeMachineState,
	RuntimeSaveMachineState,
	RuntimeSaveState,
};

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
	activeMachineManifest: MachineManifest;
	cartManifest: CartManifest | null;
	cartProjectRootPath: string | null;
	ufpsScaled: number;
	cpuHz: number;
	cycleBudgetPerFrame: number;
	vblankCycles: number;
	vdpWorkUnitsPerSec?: number;
	geoWorkUnitsPerSec?: number;
};

export type RuntimeResumeSnapshot = {
	luaRuntimeFailed: boolean;
	luaPath: string;
	luaGlobals?: LuaEntrySnapshot;
	luaLocals?: LuaEntrySnapshot;
	luaRandomSeed?: number;
	luaProgramCounter?: number;
	machineState: RuntimeMachineState;
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
