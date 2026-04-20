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
