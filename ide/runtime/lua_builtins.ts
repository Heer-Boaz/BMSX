import { DEFAULT_LUA_BUILTIN_FUNCTIONS } from '../../toolchain/ts/lua/builtin_descriptors';
import type { LuaBuiltinDescriptor } from '../../toolchain/ts/lua/semantic_contracts';

const builtinMetadataByName = new Map<string, LuaBuiltinDescriptor>();
export const luaBuiltinMetadata: ReadonlyMap<string, LuaBuiltinDescriptor> = builtinMetadataByName;
let retainedBuiltinDescriptors: readonly LuaBuiltinDescriptor[] | null = null;

export function registerLuaBuiltin(metadata: LuaBuiltinDescriptor): void {
	const name = metadata.name.trim();
	if (name.length === 0) {
		throw new Error(`Invalid Lua builtin name for '${name}'.`);
	}
	const params: string[] = [];
	const optionalSet: Set<string> = new Set();
	const normalizedDescriptions: (string | undefined)[] = [];
	const sourceParams = Array.isArray(metadata.params) ? metadata.params : [];
	const sourceDescriptions = Array.isArray(metadata.parameterDescriptions) ? metadata.parameterDescriptions : [];
	for (let index = 0; index < sourceParams.length; index += 1) {
		const raw = sourceParams[index];
		const description = index < sourceDescriptions.length ? sourceDescriptions[index] : undefined;
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
	builtinMetadataByName.set(name, descriptor);
	retainedBuiltinDescriptors = null;
}

export function seedDefaultLuaBuiltins(): void {
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		registerLuaBuiltin(DEFAULT_LUA_BUILTIN_FUNCTIONS[index]);
	}
}

export function listLuaBuiltinDescriptors(): readonly LuaBuiltinDescriptor[] {
	if (retainedBuiltinDescriptors !== null) {
		return retainedBuiltinDescriptors;
	}
	const descriptors = new Map<string, LuaBuiltinDescriptor>();
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const descriptor = DEFAULT_LUA_BUILTIN_FUNCTIONS[index];
		descriptors.set(descriptor.name, {
			name: descriptor.name,
			params: descriptor.params.slice(),
			signature: descriptor.signature,
			optionalParams: descriptor.optionalParams?.slice(),
			parameterDescriptions: descriptor.parameterDescriptions?.slice(),
			description: descriptor.description,
		});
	}
	for (const metadata of builtinMetadataByName.values()) {
		const optionalParams = metadata.optionalParams;
		const optionalSet = optionalParams && optionalParams.length > 0
			? new Set(optionalParams)
			: undefined;
		const params = optionalSet
			? metadata.params.map(param => optionalSet.has(param) ? `${param}?` : param)
			: metadata.params.slice();
		descriptors.set(metadata.name, {
			name: metadata.name,
			params,
			signature: metadata.signature,
			optionalParams,
			parameterDescriptions: metadata.parameterDescriptions?.slice(),
			description: metadata.description,
		});
	}
	const result = Array.from(descriptors.values());
	result.sort((left, right) => left.name.localeCompare(right.name));
	retainedBuiltinDescriptors = result;
	return result;
}
