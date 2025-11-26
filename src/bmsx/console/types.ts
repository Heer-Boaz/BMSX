import type { vec2, CanonicalizationType } from '../rompack/rompack';
import type { BmsxConsoleApi } from './api';

export type IdeThemeVariant = string;

export interface BmsxConsoleMetadata {
	title: string;
	version: string;
	persistentId: string;
	ideTheme?: IdeThemeVariant;
}

export type BmsxConsoleLuaProgramEntryPoints = {
	init?: string;
	update?: string;
	draw?: string;
};

export type BmsxConsoleLuaProgram = {
	readonly chunkName?: string;
	readonly asset_id: string;
	readonly source: string;
	readonly overrideSource?: string;
	readonly entry?: BmsxConsoleLuaProgramEntryPoints;
	readonly main: boolean;
};

export interface BmsxConsoleCartridge {
	readonly meta: BmsxConsoleMetadata;
	init(api: BmsxConsoleApi): void;
	update(api: BmsxConsoleApi, deltaSeconds: number): void;
	draw(api: BmsxConsoleApi): void;
	captureState?(api: BmsxConsoleApi): unknown;
	restoreState?(api: BmsxConsoleApi, state: unknown): void;
	readonly luaProgram?: BmsxConsoleLuaProgram;
}

export const enum BmsxConsoleButton {
	Left = 0,
	Right = 1,
	Up = 2,
	Down = 3,
	ActionO = 4,
	ActionX = 5,
}

export const BmsxConsoleButtonCount: number = 6;

export const enum BmsxConsolePointerButton {
	Primary = 0,
	Secondary = 1,
	Auxiliary = 2,
	Back = 3,
	Forward = 4,
}

export const BmsxConsolePointerButtonCount: number = 5;

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

export type ConsoleViewport = {
	width: number;
	height: number;
};

export type ConsoleModuleOptions = {
	playerIndex: number;
	viewport: ConsoleViewport;
	moduleId: string;
	canonicalization?: CanonicalizationType;
};

export type Vector2 = vec2;

export type ConsoleResourceDescriptor = {
	path: string;
	type: string;
	asset_id: string;
};

export type ConsoleLuaResourceCreationRequest = {
	path: string;
	asset_id?: string | null;
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
	chunkName: string;
	asset_id: string | null;
	path?: string | null;
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
	parameterDescriptions?: readonly (string | null)[];
	description?: string | null;
};

export type ConsoleLuaHoverRequest = {
	asset_id: string | null;
	expression: string;
	chunkName: string | null;
	row: number;
	column: number;
};

export type ConsoleLuaMemberCompletionRequest = {
	asset_id: string | null;
	chunkName: string | null;
	expression: string;
	operator: '.' | ':';
};

export type ConsoleLuaMemberCompletion = {
	name: string;
	kind: 'method' | 'property';
	detail: string | null;
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
	definition?: ConsoleLuaDefinitionLocation | null;
};
