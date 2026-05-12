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

export type LuaHoverScope = 'global' | 'path';

export type LuaHoverValueState = 'value' | 'not_defined';

export type LuaDefinitionRange = {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
};

export type LuaDefinitionLocation = {
	path: string;
	range: LuaDefinitionRange;
};

export type LuaSymbolKind =
	| 'variable'
	| 'constant'
	| 'function'
	| 'table_field'
	| 'parameter'
	| 'assignment';

export type LuaSymbolEntry = {
	name: string;
	path: string;
	kind: LuaSymbolKind;
	location: LuaDefinitionLocation;
};

export type LuaBuiltinDescriptor = {
	name: string;
	params: string[];
	signature: string;
	optionalParams?: readonly string[];
	parameterDescriptions?: readonly (string)[];
	description?: string;
};

export type LuaHoverRequest = {
	expression: string;
	path: string;
	row: number;
	column: number;
};

export type LuaMemberCompletionRequest = {
	objectName?: string;
	prefix?: string;
	path: string;
	expression?: string;
	operator: '.' | ':';
};

export type LuaMemberCompletion = {
	name: string;
	kind: 'method' | 'property';
	detail: string;
	parameters: string[];
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

export type LuaHoverResult = {
	expression: string;
	lines: string[];
	valueType: string;
	scope: LuaHoverScope;
	state: LuaHoverValueState;
	isFunction: boolean;
	isLocalFunction: boolean;
	isBuiltin: boolean;
	definition?: LuaDefinitionLocation;
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
