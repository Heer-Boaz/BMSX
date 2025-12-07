import { $ } from '../core/game';
import { Input } from '../input/input';
import { GamepadBinding, GamepadInputMapping, InputMap, KeyboardBinding, KeyboardInputMapping, PointerBinding, PointerInputMapping } from '../input/inputtypes';
import { LuaEnvironment } from '../lua/luaenvironment';
import { LuaError, LuaRuntimeError, LuaSyntaxError } from '../lua/luaerrors';
import { LuaInterpreter } from '../lua/luaruntime';
import { createLuaNativeFunction, extractErrorMessage } from '../lua/luavalue';
import { isLuaNativeValue, isLuaTable, LuaTable, LuaValue } from '../lua/luavalue';
import { arrayify } from '../utils/arrayify';
import { deep_clone } from '../utils/deep_clone';
import { VM_API_METHOD_METADATA } from './vm_api_metadata';
import { api, BmsxVMRuntime, VM_BUTTON_ACTIONS } from './vm_runtime';
import type { VMLuaBuiltinDescriptor } from './types';

export const DEFAULT_LUA_BUILTIN_FUNCTIONS: ReadonlyArray<VMLuaBuiltinDescriptor> = [
	{ name: 'assert', params: ['value', 'message?'], signature: 'assert(value [, message])' },
	{ name: 'error', params: ['message', 'level?'], signature: 'error(message [, level])' },
	{ name: 'getmetatable', params: ['object'], signature: 'getmetatable(object)' },
	{ name: 'ipairs', params: ['table'], signature: 'ipairs(t)' },
	{ name: 'next', params: ['table', 'index?'], signature: 'next(table [, index])' },
	{ name: 'pairs', params: ['table'], signature: 'pairs(t)' },
	{ name: 'pcall', params: ['func', 'arg...'], signature: 'pcall(f, ...)' },
	{ name: 'print', params: ['...'], signature: 'print(...)' },
	{ name: 'rawequal', params: ['v1', 'v2'], signature: 'rawequal(v1, v2)' },
	{ name: 'rawget', params: ['table', 'index'], signature: 'rawget(table, index)' },
	{ name: 'rawset', params: ['table', 'index', 'value'], signature: 'rawset(table, index, value)' },
	{ name: 'select', params: ['index', '...'], signature: 'select(index, ...)' },
	{ name: 'setmetatable', params: ['table', 'metatable'], signature: 'setmetatable(table, metatable)' },
	{ name: 'tonumber', params: ['value', 'base?'], signature: 'tonumber(value [, base])' },
	{ name: 'tostring', params: ['value'], signature: 'tostring(value)' },
	{ name: 'type', params: ['value'], signature: 'type(value)' },
	{ name: 'xpcall', params: ['func', 'msgh', 'arg...'], signature: 'xpcall(f, msgh, ...)' },
	{ name: 'require', params: ['moduleName'], signature: 'require(moduleName)' },
	{ name: 'table.concat', params: ['list', 'separator?', 'start?', 'end?'], signature: 'table.concat(list [, sep [, i [, j]]])' },
	{ name: 'table.insert', params: ['list', 'pos?', 'value'], signature: 'table.insert(list [, pos], value)' },
	{ name: 'table.pack', params: ['...'], signature: 'table.pack(...)' },
	{ name: 'table.remove', params: ['list', 'pos?'], signature: 'table.remove(list [, pos])' },
	{ name: 'table.sort', params: ['list', 'comp?'], signature: 'table.sort(list [, comp])' },
	{ name: 'table.unpack', params: ['list', 'i?', 'j?'], signature: 'table.unpack(list [, i [, j]])' },
	{ name: 'math.abs', params: ['x'], signature: 'math.abs(x)' },
	{ name: 'math.ceil', params: ['x'], signature: 'math.ceil(x)' },
	{ name: 'math.floor', params: ['x'], signature: 'math.floor(x)' },
	{ name: 'math.max', params: ['x', '...'], signature: 'math.max(x, ...)' },
	{ name: 'math.min', params: ['x', '...'], signature: 'math.min(x, ...)' },
	{ name: 'math.random', params: ['m?', 'n?'], signature: 'math.random([m [, n]])' },
	{ name: 'math.randomseed', params: ['seed?'], signature: 'math.randomseed([seed])' },
	{ name: 'math.sqrt', params: ['x'], signature: 'math.sqrt(x)' },
	{ name: 'string.byte', params: ['s', 'i?'], signature: 'string.byte(s [, i])' },
	{ name: 'string.char', params: ['...'], signature: 'string.char(...)' },
	{ name: 'string.find', params: ['s', 'pattern', 'init?'], signature: 'string.find(s, pattern [, init])' },
	{ name: 'string.format', params: ['format', '...'], signature: 'string.format(format, ...)' },
	{ name: 'string.len', params: ['s'], signature: 'string.len(s)' },
	{ name: 'string.lower', params: ['s'], signature: 'string.lower(s)' },
	{ name: 'string.sub', params: ['s', 'i', 'j?'], signature: 'string.sub(s, i [, j])' },
	{ name: 'string.upper', params: ['s'], signature: 'string.upper(s)' },
	{ name: 'os.date', params: ['format?', 'time?'], signature: 'os.date([format [, time]])' },
	{ name: 'os.difftime', params: ['t2', 't1?'], signature: 'os.difftime(t2 [, t1])' },
	{ name: 'os.time', params: ['table?'], signature: 'os.time([table])' },
];

const DEFAULT_LUA_BUILTIN_IDENTIFIER_EXTRAS = ['package', 'math.pi'];

export const DEFAULT_LUA_BUILTIN_NAMES: ReadonlyArray<string> = (() => {
	const names = new Set<string>();
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = DEFAULT_LUA_BUILTIN_FUNCTIONS[index].name;
		names.add(name);
		const dot = name.indexOf('.');
		if (dot !== -1) {
			names.add(name.slice(0, dot));
		}
	}
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_IDENTIFIER_EXTRAS.length; index += 1) {
		names.add(DEFAULT_LUA_BUILTIN_IDENTIFIER_EXTRAS[index]);
	}
	return Array.from(names);
})();

export function registerApiBuiltins(interpreter: LuaInterpreter): void {
	const runtime = BmsxVMRuntime.instance;
	runtime.apiFunctionNames.clear();

	const env = interpreter.globalEnvironment;
	const resolveButtonAction = (value: LuaValue, fnName: string): string => {
		if (typeof value !== 'number' || Number.isNaN(value)) {
			throw runtime.createApiRuntimeError(`${fnName}(button [, player]) expects a numeric button index.`);
		}
		const index = Math.trunc(value);
		if (index < 0 || index >= VM_BUTTON_ACTIONS.length) {
			throw runtime.createApiRuntimeError(`${fnName}(button [, player]) button index must be between 0 and ${VM_BUTTON_ACTIONS.length - 1}.`);
		}
		return VM_BUTTON_ACTIONS[index];
	};

	const resolvePlayerIndex = (value: LuaValue, fnName: string): number => {
		if (value === undefined || value === null) {
			throw runtime.createApiRuntimeError(`${fnName}(button [, player]) expects the optional player index to be numeric.`);
		}
		if (typeof value !== 'number' || Number.isNaN(value)) {
			throw runtime.createApiRuntimeError(`${fnName}(button [, player]) expects the optional player index to be numeric.`);
		}
		const normalized = Math.trunc(value);
		if (normalized < 0) {
			throw runtime.createApiRuntimeError(`${fnName}(button [, player]) player index cannot be negative.`);
		}
		return normalized + 1;
	};

	const registerButtonFunction = (fnName: 'btn' | 'btnp' | 'btnr', modifier: string) => {
		const native = createLuaNativeFunction(fnName, (args) => {
			if (args.length === 0) {
				throw runtime.createApiRuntimeError(`${fnName}(button [, player]) requires at least one argument.`);
			}
			const action = resolveButtonAction(args[0], fnName);
			const playerIndex = resolvePlayerIndex(args.length >= 2 ? args[1] : undefined, fnName);
			let hasBinding = false;
			try {
				const playerInput = Input.instance.getPlayerInput(playerIndex);
				const inputMap = playerInput.inputMap;
				if (inputMap) {
					const keyboardBindings = inputMap.keyboard?.[action];
					const gamepadBindings = inputMap.gamepad?.[action];
					const pointerBindings = inputMap.pointer?.[action];
					hasBinding = Boolean(
						(keyboardBindings && keyboardBindings.length > 0) ||
						(gamepadBindings && gamepadBindings.length > 0) ||
						(pointerBindings && pointerBindings.length > 0)
					);
				}
			} catch {
				hasBinding = false;
				throw runtime.createApiRuntimeError(`${fnName}(button [, player]) expects a valid input mapping to be defined.`);
			}
			if (!hasBinding) {
				return [false];
			}
			const actionDefinition = `${action}${modifier}`;
			try {
				const triggered = api.check_action_state(playerIndex, actionDefinition);
				return [triggered];
			} catch (error) {
				if (error instanceof Error && /unknown actions/i.test(error.message)) {
					throw runtime.createApiRuntimeError(`${fnName}(button [, player]) unknown action '${actionDefinition}'`);
				}
				throw error;
			}
		});
		registerLuaGlobal(env, fnName, native);
		registerLuaBuiltin({
			name: fnName,
			params: ['button', 'player?'],
			signature: `${fnName}(button [, player])`,
			parameterDescriptions: [
				'Button index (0=left,1=right,2=up,3=down,4=O,5=X).',
				'Optional player index (0-based).',
			],
		});
	};

	registerButtonFunction('btn', '[p]');
	registerButtonFunction('btnp', '[gp]');
	registerButtonFunction('btnr', '[jr]');

	const setInputMapNative = createLuaNativeFunction('set_input_map', (args) => {
		if (args.length === 0 || !isLuaTable(args[0])) {
			throw runtime.createApiRuntimeError('set_input_map(mapping [, player]) requires a table as the first argument.');
		}
		const mappingTable = args[0] as LuaTable;
		const targetPlayer = args.length >= 2
			? resolvePlayerIndex(args[1], 'set_input_map')
			: runtime.playerIndex;
		const moduleId = $.rompack.cart.chunk2lua[runtime.currentChunkName]?.resid ?? runtime.currentChunkName;
		const marshalCtx = runtime.ensureMarshalContext({ moduleId, path: [] });
		const mappingValue = runtime.luaJsBridge.luaValueToJs(mappingTable, marshalCtx);
		if (!mappingValue || typeof mappingValue !== 'object') {
			throw runtime.createApiRuntimeError('set_input_map(mapping [, player]) requires mapping to be a table.');
		}
		applyInputMappingFromLua(mappingValue as Record<string, unknown>, targetPlayer);
		return [];
	});
	registerLuaGlobal(env, 'set_input_map', setInputMapNative);
	registerLuaBuiltin({
		name: 'set_input_map',
		params: ['mapping', 'player?'],
		signature: 'set_input_map(mapping [, player])',
		description: 'Replaces the input bindings for the console player. The optional player argument is zero-based.',
	});

	const members = collectApiMembers();
	for (const { name, kind, descriptor } of members) {
		if (!descriptor) {
			continue;
		}
		if (kind === 'method') {
			switch (name) {
				case 'btn':
				case 'btnp':
				case 'btnr':
				case 'set_input_map':
					// Already registered above
					continue;
			}
			const callable = descriptor.value;
			if (typeof callable !== 'function') {
				throw runtime.createApiRuntimeError(`API method '${name}' is not callable.`);
			}
			const params = extractFunctionParameters(callable as (...args: unknown[]) => unknown);
			const apiMetadata = VM_API_METHOD_METADATA[name];
			const optionalSet: Set<string> = new Set();
			if (apiMetadata?.optionalParameters) {
				for (let index = 0; index < apiMetadata.optionalParameters.length; index += 1) {
					optionalSet.add(apiMetadata.optionalParameters[index]);
				}
			}
			const parameterDescriptionMap: Map<string, string> = new Map();
			if (apiMetadata?.parameters) {
				for (let index = 0; index < apiMetadata.parameters.length; index += 1) {
					const metadataParam = apiMetadata.parameters[index];
					if (!metadataParam || typeof metadataParam.name !== 'string') {
						throw runtime.createApiRuntimeError(`API method '${name}' has invalid parameter metadata.`);
					}
					if (metadataParam.optional) {
						optionalSet.add(metadataParam.name);
					}
					if (metadataParam.description !== undefined) {
						parameterDescriptionMap.set(metadataParam.name, metadataParam.description);
					}
				}
			}
			const optionalArray = optionalSet.size > 0 ? Array.from(optionalSet) : undefined;
			const parameterDescriptions = params.map(param => parameterDescriptionMap.get(param));
			const displayParams = params.map(param => (optionalSet.has(param) ? `${param}?` : param));
			const signature = displayParams.length > 0 ? `${name}(${displayParams.join(', ')})` : `${name}()`;
			const native = createLuaNativeFunction(`api.${name}`, (args) => {
				const moduleId = $.rompack.cart.chunk2lua[runtime.currentChunkName]?.resid ?? runtime.currentChunkName;
				const baseCtx = runtime.ensureMarshalContext({ moduleId, path: [] });
				const jsArgs = Array.from(args, (arg, index) => runtime.luaJsBridge.luaValueToJs(arg, runtime.extendMarshalContext(baseCtx, `arg${index}`)));
				try {
					const target = api as unknown as Record<string, unknown>;
					const method = target[name];
					if (typeof method !== 'function') {
						throw new Error(`Method '${name}' is not callable.`);
					}
					const result = (method as (...inner: unknown[]) => unknown).apply(api, jsArgs);
					return wrapResultValue(result);
				} catch (error) {
					if (isLuaScriptError(error)) {
						throw error;
					}
					const message = extractErrorMessage(error);
					throw runtime.createApiRuntimeError(`[api.${name}] ${message}`);
				}
			});
			registerLuaGlobal(env, name, native);
			registerLuaBuiltin({
				name,
				params,
				signature,
				optionalParams: optionalArray,
				parameterDescriptions,
				description: apiMetadata?.description,
			});
			continue;
		}

		if (descriptor.get) {
			const getter = descriptor.get;
			const native = createLuaNativeFunction(`api.${name}`, () => {
				try {
					const value = getter.call(api);
					return wrapResultValue(value);
				} catch (error) {
					if (isLuaScriptError(error)) {
						throw error;
					}
					const message = extractErrorMessage(error);
					throw runtime.createApiRuntimeError(`[api.${name}] ${message}`);
				}
			});
			registerLuaGlobal(env, name, native);
		}
	}

	exposeEngineObjects(env);
}

export function registerLuaBuiltin(metadata: VMLuaBuiltinDescriptor): void {
	const runtime = BmsxVMRuntime.instance;
	const normalizedName = runtime.canonicalizeIdentifier(metadata.name.trim());
	if (normalizedName.length === 0) {
		throw new Error(`Invalid Lua builtin name for '${normalizedName}'.`);
	}
	const params: string[] = [];
	const optionalSet: Set<string> = new Set();
	const normalizedDescriptions: (string)[] = [];
	const sourceParams = Array.isArray(metadata.params) ? metadata.params : [];
	const sourceDescriptions = Array.isArray(metadata.parameterDescriptions) ? metadata.parameterDescriptions : [];
	for (let index = 0; index < sourceParams.length; index += 1) {
		const raw = sourceParams[index];
		const description = index < sourceDescriptions.length ? sourceDescriptions[index] : null;
		if (typeof raw !== 'string') {
			throw new Error(`Invalid Lua builtin parameter at index ${index} for '${normalizedName}'.`);
		}
		const trimmed = raw.trim();
		if (trimmed.length === 0) {
			throw new Error(`Invalid Lua builtin parameter at index ${index} for '${normalizedName}'.`);
		}
		if (trimmed === '...' || trimmed.endsWith('...')) {
			params.push(trimmed);
			normalizedDescriptions.push(description);
			continue;
		}
		if (trimmed.endsWith('?')) {
			const base = trimmed.slice(0, -1);
			if (base.length > 0) {
				params.push(base);
				normalizedDescriptions.push(description);
				optionalSet.add(base);
			}
			continue;
		}
		params.push(trimmed);
		normalizedDescriptions.push(description);
	}
	if (Array.isArray(metadata.optionalParams)) {
		for (let index = 0; index < metadata.optionalParams.length; index += 1) {
			const name = metadata.optionalParams[index];
			if (typeof name !== 'string' || name.length === 0) {
				throw new Error(`Invalid Lua optional parameter at index ${index} for '${normalizedName}'.`);
			}
			optionalSet.add(name);
		}
	}
	const signature = typeof metadata.signature === 'string' ? metadata.signature : normalizedName;
	const optionalParams = optionalSet.size > 0 ? Array.from(optionalSet) : undefined;
	const descriptor: VMLuaBuiltinDescriptor = {
		name: normalizedName,
		params,
		signature,
		optionalParams,
		parameterDescriptions: normalizedDescriptions,
		description: metadata.description,
	};
	runtime.luaBuiltinMetadata.set(normalizedName, descriptor);
}

function extractFunctionParameters(fn: (...args: unknown[]) => unknown): string[] {
	const source = Function.prototype.toString.call(fn);
	const openIndex = source.indexOf('(');
	if (openIndex === -1) {
		return [];
	}
	let index = openIndex + 1;
	let depth = 1;
	let closeIndex = source.length;
	while (index < source.length) {
		const ch = source.charAt(index);
		if (ch === '(') {
			depth += 1;
		} else if (ch === ')') {
			depth -= 1;
			if (depth === 0) {
				closeIndex = index;
				break;
			}
		}
		index += 1;
	}
	if (depth !== 0 || closeIndex <= openIndex) {
		return [];
	}
	const slice = source.slice(openIndex + 1, closeIndex);
	const withoutBlockComments = slice.replace(/\/\*[\s\S]*?\*\//g, '');
	const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, '');
	const rawTokens = withoutLineComments.split(',');
	const names: string[] = [];
	for (let i = 0; i < rawTokens.length; i += 1) {
		const token = rawTokens[i].trim();
		if (token.length === 0) {
			continue;
		}
		names.push(sanitizeParameterName(token, i));
	}
	return names;
}

function sanitizeParameterName(token: string, index: number): string {
	let candidate = token.trim();
	if (candidate.length === 0) {
		return `arg${index + 1}`;
	}
	if (candidate.startsWith('...')) {
		return '...';
	}
	const equalsIndex = candidate.indexOf('=');
	if (equalsIndex >= 0) {
		candidate = candidate.slice(0, equalsIndex).trim();
	}
	const colonIndex = candidate.indexOf(':');
	if (colonIndex >= 0) {
		candidate = candidate.slice(0, colonIndex).trim();
	}
	const bracketIndex = Math.max(candidate.indexOf('{'), candidate.indexOf('['));
	if (bracketIndex !== -1) {
		return `arg${index + 1}`;
	}
	const sanitized = candidate.replace(/[^A-Za-z0-9_]/g, '');
	if (sanitized.length === 0) {
		return `arg${index + 1}`;
	}
	return sanitized;
}

export function seedDefaultLuaBuiltins(): void {
	BmsxVMRuntime.instance.luaBuiltinMetadata.clear();
	const defaults = DEFAULT_LUA_BUILTIN_FUNCTIONS;
	for (let i = 0; i < defaults.length; i += 1) {
		registerLuaBuiltin(defaults[i]);
	}
}

export function registerLuaGlobal(env: LuaEnvironment, name: string, value: LuaValue): void {
	const runtime = BmsxVMRuntime.instance;
	const key = runtime.canonicalizeIdentifier(name);
	env.set(key, value);
	runtime.apiFunctionNames.add(key);
}

function wrapResultValue(value: unknown): ReadonlyArray<LuaValue> {
	if (Array.isArray(value)) {
		if (value.every((entry) => isLuaValue(entry))) {
			return value as LuaValue[];
		}
		return value.map((entry) => BmsxVMRuntime.instance.luaJsBridge.jsToLua(entry));
	}
	if (value === undefined) {
		return [];
	}
	const luaValue = BmsxVMRuntime.instance.luaJsBridge.jsToLua(value);
	return [luaValue];
}

function isLuaValue(value: unknown): value is LuaValue {
	if (value === null) {
		return true;
	}
	if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
		return true;
	}
	if (isLuaTable(value)) {
		return true;
	}
	if (isLuaNativeValue(value)) {
		return true;
	}
	if (value && typeof value === 'object' && 'call' in (value as Record<string, unknown>)) {
		const candidate = value as { call?: unknown };
		return typeof candidate.call === 'function';
	}
	return false;
}

export function isLuaScriptError(error: unknown): error is LuaError | LuaRuntimeError | LuaSyntaxError {
	return error instanceof LuaError || error instanceof LuaRuntimeError || error instanceof LuaSyntaxError;
}

function exposeEngineObjects(env: LuaEnvironment): void {
	const rompackView = buildLuaRompackView();
	const entries: Array<[string, unknown]> = [
		['world', $.world],
		['game', $],
		['$', $],
		['registry', $.registry],
		['events', $.event_emitter],
		['rompack', rompackView],
	];
	for (const [name, object] of entries) {
		if (object === undefined || object === null) {
			continue;
		}
		const luaValue = BmsxVMRuntime.instance.luaJsBridge.jsToLua(object);
		registerLuaGlobal(env, name, luaValue);
	}
}

function buildLuaRompackView() {
	const rompack = $.rompack;
	return {
		img: serializeRomAssetMap(rompack.img),
		audio: serializeRomAssetMap(rompack.audio),
		model: serializeRomAssetMap(rompack.model),
		data: cloneRompackDataMap(rompack.data),
		audioevents: rompack.audioevents ? deep_clone(rompack.audioevents) : {},
		lua: Object.fromEntries(Object.entries(rompack.cart.path2lua).map(([path, asset]) => [path, { ...asset }])),
		code: rompack.code,
		canonicalization: rompack.canonicalization,
	};
}

function serializeRomAssetMap(source: Record<string, any>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	if (!source) {
		return result;
	}
	for (const [id, asset] of Object.entries(source)) {
		if (!asset) {
			continue;
		}
		result[id] = extractRomAssetFields(asset);
	}
	return result;
}

function cloneRompackDataMap(source: Record<string, unknown>): Record<string, unknown> {
	if (!source) {
		return {};
	}
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(source)) {
		result[key] = deep_clone(value);
	}
	return result;
}

function extractRomAssetFields(source: Record<string, any>): Record<string, unknown> {
	const entry: Record<string, unknown> = {};
	for (const key of Object.getOwnPropertyNames(source)) {
		switch (key) { // TODO: Still relevant?
			case 'buffer':
			case 'texture_buffer':
			case '_imgbin':
			case '_imgbinYFlipped':
			case 'imgbin':
			case 'imgbinYFlipped':
				continue;
		}
		const descriptor = Object.getOwnPropertyDescriptor(source, key);
		if (descriptor && typeof descriptor.get === 'function') {
			continue;
		}
		const value = source[key];
		if (value === undefined) {
			continue;
		}
		if (value === null || typeof value !== 'object') {
			entry[key] = value;
			continue;
		}
		entry[key] = deep_clone(value as Record<string, unknown>);
	}
	return entry;
}

function applyInputMappingFromLua(mapping: Record<string, unknown>, playerIndex: number): void {
	const keyboardLayer = convertLuaInputLayer(mapping['keyboard'], 'keyboard') as KeyboardInputMapping;
	const gamepadLayer = convertLuaInputLayer(mapping['gamepad'], 'gamepad') as GamepadInputMapping;
	const pointerLayer = convertLuaInputLayer(mapping['pointer'], 'pointer') as PointerInputMapping;

	const existing = Input.instance.getPlayerInput(playerIndex).inputMap;
	const next: InputMap = {
		keyboard: keyboardLayer ?? existing?.keyboard ?? {},
		gamepad: gamepadLayer ?? existing?.gamepad ?? {},
		pointer: pointerLayer ?? existing?.pointer ?? Input.clonePointerMapping(),
	};
	$.set_inputmap(playerIndex, next);
}

function convertLuaInputLayer(value: unknown, kind: 'keyboard' | 'gamepad' | 'pointer'): KeyboardInputMapping | GamepadInputMapping | PointerInputMapping {
	if (value === undefined || value === null) {
		return undefined;
	}
	if (typeof value !== 'object') {
		throw BmsxVMRuntime.instance.createApiRuntimeError(`set_input_map: ${kind} mapping must be a table.`);
	}
	const result: Record<string, Array<KeyboardBinding | GamepadBinding | PointerBinding>> = {};
	for (const [action, rawBindings] of Object.entries(value as Record<string, unknown>)) {
		if (!action || typeof action !== 'string') {
			continue;
		}
		const entries = normalizeBindingList(kind, action, rawBindings);
		if (entries.length === 0) {
			continue;
		}
		result[action] = entries as Array<KeyboardBinding | GamepadBinding | PointerBinding>;
	}
	return result as KeyboardInputMapping | GamepadInputMapping | PointerInputMapping;
}

function normalizeBindingList(kind: 'keyboard' | 'gamepad' | 'pointer', action: string, rawBindings: unknown): Array<KeyboardBinding | GamepadBinding | PointerBinding> {
	const items = arrayify(rawBindings);
	const normalized: Array<KeyboardBinding | GamepadBinding | PointerBinding> = [];
	for (const item of items) {
		if (item === undefined || item === null) {
			throw BmsxVMRuntime.instance.createApiRuntimeError(`set_input_map: ${kind} binding for action '${action}' cannot be nil.`);
		}
		if (typeof item === 'string') {
			if (item.length === 0) {
				throw BmsxVMRuntime.instance.createApiRuntimeError(`set_input_map: ${kind} binding for action '${action}' cannot be an empty string.`);
			}
			normalized.push(item);
			continue;
		}
		if (typeof item === 'object') {
			const record = item as Record<string, unknown>;
			const idValue = record.id;
			if (typeof idValue !== 'string' || idValue.length === 0) {
				throw BmsxVMRuntime.instance.createApiRuntimeError(`set_input_map: ${kind} binding for action '${action}' must provide a non-empty string id.`);
			}
			const binding: { id: string; scale?: number; invert?: boolean } = { id: idValue };
			if ('scale' in record && record.scale !== undefined && record.scale !== null) {
				const scale = Number(record.scale);
				if (!Number.isFinite(scale)) {
					throw BmsxVMRuntime.instance.createApiRuntimeError(`set_input_map: ${kind} binding for action '${action}' has an invalid scale value.`);
				}
				binding.scale = scale;
			}
			if ('invert' in record && record.invert !== undefined && record.invert !== null) {
				binding.invert = Boolean(record.invert);
			}
			normalized.push(binding as KeyboardBinding | GamepadBinding | PointerBinding);
			continue;
		}
		throw BmsxVMRuntime.instance.createApiRuntimeError(`set_input_map: ${kind} binding for action '${action}' must be a string or a table with an 'id' field.`);
	}
	return normalized;
}

function collectApiMembers(): Array<{ name: string; kind: 'method' | 'getter'; descriptor: PropertyDescriptor }> {
	const map = new Map<string, { kind: 'method' | 'getter'; descriptor: PropertyDescriptor }>();
	let prototype: object = Object.getPrototypeOf(api);
	while (prototype && prototype !== Object.prototype) {
		for (const name of Object.getOwnPropertyNames(prototype)) {
			if (name === 'constructor') continue;
			const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
			if (!descriptor || map.has(name)) continue;
			if (typeof descriptor.value === 'function') {
				map.set(name, { kind: 'method', descriptor });
			}
			else if (descriptor.get) {
				map.set(name, { kind: 'getter', descriptor });
			}
		}
		prototype = Object.getPrototypeOf(prototype);
	}
	return Array.from(map.entries(), ([name, value]) => ({ name, kind: value.kind, descriptor: value.descriptor }));
}

