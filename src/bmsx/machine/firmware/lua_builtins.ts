import { $ } from '../../core/engine_core';
import { InputMap } from '../../input/inputtypes';
import { LuaEnvironment } from '../../lua/luaenvironment';
import { LuaError, LuaRuntimeError, LuaSyntaxError } from '../../lua/luaerrors';
import { LuaInterpreter, LuaNativeFunction } from '../../lua/luaruntime';
import { extractErrorMessage, isLuaCallSignal, LuaFunctionValue, LuaNativeValue, type LuaCallResult } from '../../lua/luavalue';
import { isLuaTable, LuaTable, LuaValue } from '../../lua/luavalue';
import { arrayify } from '../../utils/arrayify';
import { API_METHOD_METADATA } from './api_metadata';
import {
	DEFAULT_LUA_BUILTIN_FUNCTIONS,
	ENGINE_LUA_BUILTIN_FUNCTIONS,
} from './lua_builtin_descriptors';
import { extendMarshalContext } from './lua_js_bridge';
import { api, Runtime } from '../runtime/runtime';
import type { LuaBuiltinDescriptor } from '../runtime/types';

const FIRMWARE_LUA_GLOBAL_METHODS = new Set<string>();

export function registerApiBuiltins(interpreter: LuaInterpreter): void {
	const runtime = Runtime.instance;
	runtime.apiFunctionNames.clear();
	const runtimeError = (message: string): LuaRuntimeError => interpreter.runtimeError(message);

	const env = interpreter.globalEnvironment;
	const setInputMapNative = new LuaNativeFunction('set_input_map', (args) => {
		if (args.length === 0 || !isLuaTable(args[0])) {
			throw runtimeError('set_input_map(mapping [, player]) requires a table as the first argument.');
		}
			const mappingTable = args[0] as LuaTable;
			const targetPlayer = args.length >= 2
				? Number(args[1])
				: 1;
		const moduleId = $.lua_sources.path2lua[runtime.currentPath].source_path;
		const marshalCtx = { moduleId, path: [] };
		const mappingValue = runtime.luaJsBridge.convertFromLua(mappingTable, marshalCtx) as InputMap;
		if (!mappingValue || typeof mappingValue !== 'object') {
			throw runtimeError('set_input_map(mapping [, player]) requires mapping to be a table.');
		}
		for (const key of ['keyboard', 'gamepad', 'pointer']) {
			if (key in mappingValue) {
				const layer = mappingValue[key];
				if (layer !== undefined && layer !== null && typeof layer !== 'object') {
					throw runtimeError(`set_input_map(mapping [, player]) requires ${key} to be a table.`);
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
				throw runtimeError(`API method '${name}' is not callable.`);
			}
			const params = extractFunctionParameters(callable as (...args: unknown[]) => unknown);
			const apiMetadata = API_METHOD_METADATA[name];
			const optionalSet: Set<string> = new Set();
			const parameterDescriptionMap: Map<string, string> = new Map();
			if (apiMetadata?.parameters) {
				for (let index = 0; index < apiMetadata.parameters.length; index += 1) {
					const metadataParam = apiMetadata.parameters[index];
					if (!metadataParam || typeof metadataParam.name !== 'string') {
						throw runtimeError(`API method '${name}' has invalid parameter metadata.`);
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
			if (FIRMWARE_LUA_GLOBAL_METHODS.has(name)) {
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
			const native = new LuaNativeFunction(`api.${name}`, (args) => {
				const moduleId = $.lua_sources.path2lua[runtime.currentPath].source_path;
				const baseCtx = { moduleId, path: [] };
				const jsArgs = Array.from(args, (arg, index) => runtime.luaJsBridge.convertFromLua(arg, extendMarshalContext(baseCtx, `arg${index}`)));
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
					throw runtimeError(`[api.${name}] ${message}`);
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
					throw runtimeError(`[api.${name}] ${message}`);
				}
			});
			registerLuaGlobal(env, name, native);
		}
	}

	registerEngineBuiltins(interpreter);
	exposeEngineObjects(env);
}

function registerEngineBuiltins(interpreter: LuaInterpreter): void {
	const runtime = Runtime.instance;
	const env = interpreter.globalEnvironment;
	const requireName = runtime.canonicalizeIdentifier('require');
	const callEngineMember = (name: string, args: ReadonlyArray<LuaValue>): LuaCallResult => {
		const requireFn = interpreter.getGlobal(requireName) as LuaFunctionValue;
		const engineValue = requireFn.call(['engine']);
		if (isLuaCallSignal(engineValue)) {
			return engineValue;
		}
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

export function registerLuaBuiltin(metadata: LuaBuiltinDescriptor): void {
	const runtime = Runtime.instance;
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
	const descriptor: LuaBuiltinDescriptor = {
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
	const runtime = Runtime.instance;
	const key = runtime.canonicalizeIdentifier(name);
	env.set(key, value);
	runtime.apiFunctionNames.add(key);
}

function wrapResultValue(value: unknown): ReadonlyArray<LuaValue> {
	if (Array.isArray(value)) {
		if (value.every((entry) => isLuaValue(entry))) {
			return value as LuaValue[];
		}
		return value.map((entry) => Runtime.instance.luaJsBridge.toLua(entry));
	}
	if (value === undefined) {
		return [];
	}
	const luaValue = Runtime.instance.luaJsBridge.toLua(value);
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
