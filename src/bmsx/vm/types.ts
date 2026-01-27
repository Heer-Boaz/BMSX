import type { LuaFunctionValue } from '../lua/luavalue';
import type { asset_id, CanonicalizationType, Viewport } from '../rompack/rompack';
import type { SkyboxImageIds } from '../render/shared/render_types';
import type { VmMemory } from './vm_memory';
import { LuaEntrySnapshot } from './lua_js_bridge';

export type VMResourceDescriptor = {
	path: string;
	type: string;
	asset_id?: asset_id;
	readOnly?: boolean;
};

export type VMLuaResourceCreationRequest = {
	path: string;
	contents: string;
};

export type VMLuaHoverScope = 'global' | 'path';

export type VMLuaHoverValueState = 'value' | 'not_defined';

export type VMLuaDefinitionRange = {
	startLine: number;
	startColumn: number;
	endLine: number;
	endColumn: number;
};

export type VMLuaDefinitionLocation = {
	path: string;
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

export type VMLuaMemberCompletion = {
	name: string;
	kind: 'method' | 'property';
	detail: string;
	parameters: string[];
};

export type VmSymbolKind =
	| 'function'
	| 'table'
	| 'constant';

export type VmSymbolEntry = {
	name: string;
	kind: VmSymbolKind;
	valueType: string;
	origin: string;
	module?: string;
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
	memory: VmMemory;
	cpuMhz: number;
	cycleBudgetPerFrame: number;
};

export type BmsxVMState = {
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
