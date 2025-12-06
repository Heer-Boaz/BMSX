import type { LuaFunctionValue } from '../lua/value';
import type { CanonicalizationType, Viewport } from '../rompack/rompack';
import { LuaEntrySnapshot } from './lua_js_bridge';

export const enum BmsxConsolePointerButton {
	Primary = 0,
	Secondary = 1,
	Auxiliary = 2,
	Back = 3,
	Forward = 4,
}

export type ConsolePointerVector = {
	x: number;
	y: number;
	valid: boolean;
};

export type ConsolePointerViewport = {
	x: number;
	y: number;
	valid: boolean;
	inside: boolean;
};

export type ConsolePointerWheel = {
	value: number;
	valid: boolean;
};

export type ConsoleResourceDescriptor = {
	path: string;
	type: string;
	asset_id?: string;
};

export type ConsoleLuaResourceCreationRequest = {
	path: string;
	contents: string;
};

export type ConsoleLuaHoverScope = 'global' | 'chunk';

export type ConsoleLuaHoverValueState = 'value' | 'not_defined';

export type ConsoleLuaDefinitionRange = {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
};

export type ConsoleLuaDefinitionLocation = {
	path: string;
	chunkName: string;
	asset_id?: string;
	range: ConsoleLuaDefinitionRange;
};

export type ConsoleLuaSymbolKind =
	| 'variable'
	| 'function'
	| 'table_field'
	| 'parameter'
	| 'assignment';

export type ConsoleLuaSymbolEntry = {
	name: string;
	path: string;
	kind: ConsoleLuaSymbolKind;
	location: ConsoleLuaDefinitionLocation;
};

export type ConsoleLuaBuiltinDescriptor = {
	name: string;
	params: string[];
	signature: string;
	optionalParams?: readonly string[];
	parameterDescriptions?: readonly (string)[];
	description?: string;
};

export type ConsoleLuaHoverRequest = {
	expression: string;
	chunkName: string;
	row: number;
	column: number;
	asset_id?: string;
};

export type ConsoleLuaMemberCompletionRequest = {
	chunkName: string;
	expression: string;
	operator: '.' | ':';
	asset_id?: string;
};

export type ConsoleLuaMemberCompletion = {
	name: string;
	kind: 'method' | 'property';
	detail: string;
	parameters: string[];
};

export type ConsoleLuaHoverResult = {
	expression: string;
	lines: string[];
	valueType: string;
	scope: ConsoleLuaHoverScope;
	state: ConsoleLuaHoverValueState;
	isFunction: boolean;
	isLocalFunction: boolean;
	isBuiltin: boolean;
	definition?: ConsoleLuaDefinitionLocation;
};

export type BmsxConsoleRuntimeOptions = {
	playerIndex: number;
	canonicalization?: CanonicalizationType;
	viewport: Viewport;
};

export type BmsxConsoleState = {
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
