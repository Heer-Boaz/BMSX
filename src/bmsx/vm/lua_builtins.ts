import { $ } from '../core/engine_core';
import { InputMap } from '../input/inputtypes';
import { LuaEnvironment } from '../lua/luaenvironment';
import { LuaError, LuaRuntimeError, LuaSyntaxError } from '../lua/luaerrors';
import { LuaInterpreter, LuaNativeFunction } from '../lua/luaruntime';
import { extractErrorMessage, LuaFunctionValue, LuaNativeValue } from '../lua/luavalue';
import { isLuaTable, LuaTable, LuaValue } from '../lua/luavalue';
import { arrayify } from '../utils/arrayify';
import { VM_API_METHOD_METADATA } from './vm_api_metadata';
import { api, BmsxVMRuntime } from './vm_tooling_runtime';
import type { VMLuaBuiltinDescriptor } from './types';

export const ENGINE_LUA_BUILTIN_FUNCTIONS: ReadonlyArray<VMLuaBuiltinDescriptor> = [
	{ name: 'define_fsm', params: ['id', 'blueprint'], signature: 'define_fsm(id, blueprint)' },
	{ name: 'define_world_object', params: ['definition'], signature: 'define_world_object(definition)' },
	{ name: 'define_service', params: ['definition'], signature: 'define_service(definition)' },
	{ name: 'define_component', params: ['definition'], signature: 'define_component(definition)' },
	{ name: 'define_effect', params: ['definition', 'opts?'], signature: 'define_effect(definition [, opts])' },
	{ name: 'new_timeline', params: ['def'], signature: 'new_timeline(def)' },
	{ name: 'spawn_object', params: ['definition_id', 'addons?'], signature: 'spawn_object(definition_id [, addons])' },
	{ name: 'spawn_sprite', params: ['definition_id', 'addons?'], signature: 'spawn_sprite(definition_id [, addons])' },
	{ name: 'spawn_textobject', params: ['definition_id', 'addons?'], signature: 'spawn_textobject(definition_id [, addons])' },
	{ name: 'create_service', params: ['definition_id', 'addons?'], signature: 'create_service(definition_id [, addons])' },
	{ name: 'service', params: ['id'], signature: 'service(id)' },
	{ name: 'object', params: ['id'], signature: 'object(id)' },
	{ name: 'attach_component', params: ['object_or_id', 'component_or_type'], signature: 'attach_component(object_or_id, component_or_type)' },
	{ name: 'configure_ecs', params: ['nodes'], signature: 'configure_ecs(nodes)' },
	{ name: 'apply_default_pipeline', params: [], signature: 'apply_default_pipeline()' },
	{ name: 'register', params: ['value'], signature: 'register(value)' },
	{ name: 'deregister', params: ['id'], signature: 'deregister(id)' },
	{ name: 'grant_effect', params: ['object_id', 'effect_id'], signature: 'grant_effect(object_id, effect_id)' },
	{ name: 'trigger_effect', params: ['object_id', 'effect_id', 'options?'], signature: 'trigger_effect(object_id, effect_id [, options])' },
];

export const DEFAULT_LUA_BUILTIN_FUNCTIONS: ReadonlyArray<VMLuaBuiltinDescriptor> = [
	{ name: 'assert', params: ['value', 'message?'], signature: 'assert(value [, message])' },
	{ name: 'error', params: ['message', 'level?'], signature: 'error(message [, level])' },
	{ name: 'getmetatable', params: ['object'], signature: 'getmetatable(object)' },
	{ name: 'ipairs', params: ['table'], signature: 'ipairs(t)' },
	{ name: 'next', params: ['table', 'index?'], signature: 'next(table [, index])' },
	{ name: 'pairs', params: ['table'], signature: 'pairs(t)' },
	{ name: 'pcall', params: ['func', 'arg...'], signature: 'pcall(f, ...)' },
	{ name: 'print', params: ['...'], signature: 'print(...)' },
	{ name: 'peek', params: ['addr'], signature: 'peek(addr)' },
	{ name: 'poke', params: ['addr', 'value'], signature: 'poke(addr, value)' },
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
	...ENGINE_LUA_BUILTIN_FUNCTIONS,
	{ name: 'SYS_CART_PRESENT', params: [], signature: 'SYS_CART_PRESENT', description: 'System register address; reads as 1 when a cart is available.' },
	{ name: 'SYS_BOOT_CART', params: [], signature: 'SYS_BOOT_CART', description: 'System register address; write 1 to boot the cart.' },
];

const DEFAULT_LUA_BUILTIN_IDENTIFIER_EXTRAS = ['package', 'math.pi', 'SYS_CART_PRESENT', 'SYS_BOOT_CART'];

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
	const setInputMapNative = new LuaNativeFunction('set_input_map', (args) => {
		if (args.length === 0 || !isLuaTable(args[0])) {
			throw runtime.createApiRuntimeError('set_input_map(mapping [, player]) requires a table as the first argument.');
		}
		const mappingTable = args[0] as LuaTable;
		const targetPlayer = args.length >= 2
			? Number(args[1])
			: runtime.playerIndex;
		const moduleId = $.luaSources.path2lua[runtime.currentPath].source_path;
		const marshalCtx = { moduleId, path: [] };
		const mappingValue = runtime.luaJsBridge.convertFromLua(mappingTable, marshalCtx) as InputMap;
		if (!mappingValue || typeof mappingValue !== 'object') {
			throw runtime.createApiRuntimeError('set_input_map(mapping [, player]) requires mapping to be a table.');
		}
		for (const key of ['keyboard', 'gamepad', 'pointer']) {
			if (key in mappingValue) {
				const layer = mappingValue[key];
				if (layer !== undefined && layer !== null && typeof layer !== 'object') {
					throw runtime.createApiRuntimeError(`set_input_map(mapping [, player]) requires ${key} to be a table.`);
				}
				// Apply the layer mapping to the player input
				for (const [_action, bindings] of Object.entries(layer)) {
					layer.bindings = arrayify(bindings);
				}
			}
		}

		$.set_inputmap(targetPlayer, mappingValue as InputMap);
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
			const callable = descriptor.value;
			if (typeof callable !== 'function') {
				throw runtime.createApiRuntimeError(`API method '${name}' is not callable.`);
			}
			const params = extractFunctionParameters(callable as (...args: unknown[]) => unknown);
			const apiMetadata = VM_API_METHOD_METADATA[name];
			const optionalSet: Set<string> = new Set();
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
			const returnTypeSuffix = apiMetadata?.returnType && apiMetadata.returnType !== 'void'
				? ` -> ${apiMetadata.returnType}`
				: '';
			const signature = displayParams.length > 0
				? `${name}(${displayParams.join(', ')})${returnTypeSuffix}`
				: `${name}()${returnTypeSuffix}`;
			const native = new LuaNativeFunction(`api.${name}`, (args) => {
				const moduleId = $.luaSources.path2lua[runtime.currentPath].source_path;
				const baseCtx = { moduleId, path: [] };
				const jsArgs = Array.from(args, (arg, index) => runtime.luaJsBridge.convertFromLua(arg, runtime.extendMarshalContext(baseCtx, `arg${index}`)));
				try {
					const target = api;
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
			const native = new LuaNativeFunction(`api.${name}`, () => {
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

	registerEngineBuiltins(interpreter);
	exposeEngineObjects(env);
}

function registerEngineBuiltins(interpreter: LuaInterpreter): void {
	const runtime = BmsxVMRuntime.instance;
	const env = interpreter.globalEnvironment;
	const requireName = runtime.canonicalizeIdentifier('require');
	const callEngineMember = (name: string, args: ReadonlyArray<LuaValue>): ReadonlyArray<LuaValue> => {
		const requireFn = interpreter.getGlobal(requireName) as LuaFunctionValue;
		const engineValue = requireFn.call(['engine']);
		const engineTable = engineValue[0] as LuaTable;
		const member = engineTable.get(runtime.canonicalizeIdentifier(name)) as LuaFunctionValue;
		return member.call(args);
	};
	for (let index = 0; index < ENGINE_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = ENGINE_LUA_BUILTIN_FUNCTIONS[index].name;
		const native = new LuaNativeFunction(name, (args) => callEngineMember(name, args));
		registerLuaGlobal(env, name, native);
	}
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
		if (typeof raw !== 'string' || raw.trim().length === 0) {
			throw new Error(`Invalid Lua builtin parameter at index ${index} for '${normalizedName}'.`);
		}
		if (raw === '...' || raw.endsWith('...')) {
			params.push(raw);
			normalizedDescriptions.push(description);
			continue;
		}
		if (raw.endsWith('?')) {
			const base = raw.slice(0, -1);
			if (base.length > 0) {
				params.push(base);
				normalizedDescriptions.push(description);
				optionalSet.add(base);
			}
			continue;
		}
		params.push(raw);
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
	DEFAULT_LUA_BUILTIN_FUNCTIONS.forEach(registerLuaBuiltin);
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
		return value.map((entry) => BmsxVMRuntime.instance.luaJsBridge.toLua(entry));
	}
	if (value === undefined) {
		return [];
	}
	const luaValue = BmsxVMRuntime.instance.luaJsBridge.toLua(value);
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
	if (value instanceof LuaNativeValue) {
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
	const entries: Array<[string, any]> = [
		['$', $],
	];
	for (const [name, object] of entries) {
		registerLuaGlobal(env, name, new LuaNativeValue(object));
	}
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
