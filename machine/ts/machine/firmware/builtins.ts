import { LuaEnvironment } from '../../lua/environment';
import { LuaInterpreter, LuaNativeFunction } from '../../lua/runtime';
import { isLuaCallSignal, LuaFunctionValue, type LuaCallResult } from '../../lua/value';
import { LuaTable, LuaValue } from '../../lua/value';
import { createInterpreterDevtoolsTable } from './devtools';
import {
	DEFAULT_LUA_BUILTIN_FUNCTIONS,
	SYSTEM_LUA_BUILTIN_FUNCTIONS,
} from './builtin_descriptors';
import type { Runtime } from '../runtime/runtime';
import type { LuaBuiltinDescriptor } from '../../lua/semantic_contracts';

export function registerFirmwareBuiltins(runtime: Runtime, interpreter: LuaInterpreter): void {
	runtime.apiFunctionNames.clear();

	const env = interpreter.globalEnvironment;
	registerLuaGlobal(runtime, env, 'devtools', createInterpreterDevtoolsTable(runtime, interpreter));

	registerSystemBuiltins(runtime, interpreter);
}

function registerSystemBuiltins(runtime: Runtime, interpreter: LuaInterpreter): void {
	const env = interpreter.globalEnvironment;
	const callSystemMember = (name: string, args: ReadonlyArray<LuaValue>): LuaCallResult => {
		const requireFn = interpreter.getGlobal('require') as LuaFunctionValue;
		const systemValue = requireFn.call(['system']);
		if (isLuaCallSignal(systemValue)) {
			return systemValue;
		}
		const systemTable = systemValue[0] as LuaTable;
		return (systemTable.get(name) as LuaFunctionValue).call(args);
	};
	for (let index = 0; index < SYSTEM_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = SYSTEM_LUA_BUILTIN_FUNCTIONS[index].name;
		const native = new LuaNativeFunction(name, (args) => callSystemMember(name, args));
		registerLuaGlobal(runtime, env, name, native);
	}
}

export function registerLuaBuiltin(runtime: Runtime, metadata: LuaBuiltinDescriptor): void {
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
	runtime.luaBuiltinMetadata.set(name, descriptor);
}

export function seedDefaultLuaBuiltins(runtime: Runtime): void {
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		registerLuaBuiltin(runtime, DEFAULT_LUA_BUILTIN_FUNCTIONS[index]);
	}
}

export function registerLuaGlobal(runtime: Runtime, env: LuaEnvironment, name: string, value: LuaValue): void {
	env.set(name, value);
	runtime.apiFunctionNames.add(name);
}
