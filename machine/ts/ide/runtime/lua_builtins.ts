import { LuaEnvironment } from '../../lua/environment';
import { LuaInterpreter } from '../../lua/runtime';
import { createLuaTable, LuaValue } from '../../lua/value';
import { DEFAULT_LUA_BUILTIN_FUNCTIONS } from '../../lua/builtin_descriptors';
import type { LuaBuiltinDescriptor } from '../../lua/semantic_contracts';

export const luaInterpreterApiFunctionNames = new Set<string>();
export const luaBuiltinMetadata = new Map<string, LuaBuiltinDescriptor>();

export function registerLuaInterpreterBuiltins(interpreter: LuaInterpreter): void {
	luaInterpreterApiFunctionNames.clear();
	const env = interpreter.globalEnvironment;

	registerLuaGlobal(env, 'os', createLuaTable());
}

export function registerLuaBuiltin(metadata: LuaBuiltinDescriptor): void {
	const name = metadata.name.trim();
	if (name.length === 0) {
		throw new Error(`Invalid Lua builtin name for '${name}'.`);
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
			throw new Error(`Invalid Lua builtin parameter at index ${index} for '${name}'.`);
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
			const optionalName = metadata.optionalParams[index];
			if (typeof optionalName !== 'string' || optionalName.length === 0) {
				throw new Error(`Invalid Lua optional parameter at index ${index} for '${name}'.`);
			}
			optionalSet.add(optionalName);
		}
	}
	const signature = typeof metadata.signature === 'string' ? metadata.signature : name;
	const optionalParams = optionalSet.size > 0 ? Array.from(optionalSet) : undefined;
	const descriptor: LuaBuiltinDescriptor = {
		name,
		params,
		signature,
		optionalParams,
		parameterDescriptions: normalizedDescriptions,
		description: metadata.description,
	};
	luaBuiltinMetadata.set(name, descriptor);
}

export function seedDefaultLuaBuiltins(): void {
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		registerLuaBuiltin(DEFAULT_LUA_BUILTIN_FUNCTIONS[index]);
	}
}

export function registerLuaGlobal(env: LuaEnvironment, name: string, value: LuaValue): void {
	env.set(name, value);
	luaInterpreterApiFunctionNames.add(name);
}

export function getReservedLuaIdentifiers(): ReadonlySet<string> {
	return new Set<string>(luaInterpreterApiFunctionNames);
}
