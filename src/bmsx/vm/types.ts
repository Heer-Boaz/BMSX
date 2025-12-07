import type { LuaFunctionValue } from '../lua/value';
import type { CanonicalizationType, Viewport } from '../rompack/rompack';
import { LuaEntrySnapshot } from './lua_js_bridge';

export const enum BmsxVMPointerButton {
	Primary = 0,
	Secondary = 1,
	Auxiliary = 2,
	Back = 3,
	Forward = 4,
}

export type VMPointerVector = {
	x: number;
	y: number;
	valid: boolean;
};

export type VMPointerViewport = {
	x: number;
	y: number;
	valid: boolean;
	inside: boolean;
};

export type VMPointerWheel = {
	value: number;
	valid: boolean;
};

export type VMResourceDescriptor = {
	path: string;
	type: string;
	asset_id?: string;
};

export type VMLuaResourceCreationRequest = {
	path: string;
	contents: string;
};

export type VMLuaHoverScope = 'global' | 'chunk';

export type VMLuaHoverValueState = 'value' | 'not_defined';

export type VMLuaDefinitionRange = {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
};

export type VMLuaDefinitionLocation = {
	path: string;
	chunkName: string;
	asset_id?: string;
	range: VMLuaDefinitionRange;
};

export type VMLuaSymbolKind =
	| 'variable'
	| 'function'
	| 'table_field'
	| 'parameter'
	| 'assignment';

export type VMLuaSymbolEntry = {
	name: string;
	path: string;
	kind: VMLuaSymbolKind;
	location: VMLuaDefinitionLocation;
};

export type VMLuaBuiltinDescriptor = {
	name: string;
	params: string[];
	signature: string;
	optionalParams?: readonly string[];
	parameterDescriptions?: readonly (string)[];
	description?: string;
};

export type VMLuaHoverRequest = {
	expression: string;
	chunkName: string;
	row: number;
	column: number;
	asset_id?: string;
};

export type VMLuaMemberCompletionRequest = {
	chunkName: string;
	expression: string;
	operator: '.' | ':';
	asset_id?: string;
};

export type VMLuaMemberCompletion = {
	name: string;
	kind: 'method' | 'property';
	detail: string;
	parameters: string[];
};

export type VMLuaHoverResult = {
	expression: string;
	lines: string[];
	valueType: string;
	scope: VMLuaHoverScope;
	state: VMLuaHoverValueState;
	isFunction: boolean;
	isLocalFunction: boolean;
	isBuiltin: boolean;
	definition?: VMLuaDefinitionLocation;
};

export type BmsxVMRuntimeOptions = {
	playerIndex: number;
	canonicalization?: CanonicalizationType;
	viewport: Viewport;
};

export type BmsxVMState = {
	luaRuntimeFailed: boolean;
	luaChunkName: string;
	storage?: { namespace: string; entries: Array<{ index: number; value: number; }>; };
	luaGlobals?: LuaEntrySnapshot;
	luaLocals?: LuaEntrySnapshot;
	luaRandomSeed?: number;
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
