import type { LuaFunctionValue } from '../lua/luavalue';
import type { asset_id, CanonicalizationType, Viewport } from '../rompack/rompack';
import type { SkyboxImageIds } from '../render/shared/render_types';
import type { Memory } from './memory';
import { LuaEntrySnapshot } from './lua_js_bridge';

export type ResourceDescriptor = {
	path: string;
	type: string;
	asset_id?: asset_id;
	readOnly?: boolean;
};

export type LuaResourceCreationRequest = {
	path: string;
	contents: string;
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
	canonicalization?: CanonicalizationType;
	viewport: Viewport;
	memory: Memory;
	cpuHz: number;
	cycleBudgetPerFrame: number;
	vblankCycles: number;
	vdpWorkUnitsPerSec: number;
};

export type RuntimeState = {
	luaRuntimeFailed: boolean;
	luaPath: string;
	storage?: { namespace: string; entries: Array<{ index: number; value: number; }>; };
	luaGlobals?: LuaEntrySnapshot;
	luaLocals?: LuaEntrySnapshot;
	luaRandomSeed?: number;
	luaProgramCounter?: number;
	assetMemory?: Uint8Array;
	atlasSlots?: { primary: number | null; secondary: number | null };
	skyboxFaceIds?: SkyboxImageIds | null;
	vdpDitherType?: number;
	cyclesIntoFrame: number;
	vblankPendingClear: boolean;
	vblankClearOnIrqEnd: boolean;
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
