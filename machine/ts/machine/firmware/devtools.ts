import { createLuaTable, type LuaTable } from '../../lua/value';
import { LuaNativeFunction, type LuaInterpreter } from '../../lua/runtime';
import type { ResourceDescriptor } from '../../rompack/tooling/resource';
import type { Runtime } from '../runtime/runtime';
import { resolveLuaSourceRecord } from '../program/sources';

function summarizeLuaPaths(runtime: Runtime, limit: number): string {
	const values: string[] = [];
	const seen = new Set<string>();
	for (let registryIndex = 0; registryIndex < runtime.luaSourceSearchRegistries.length; registryIndex += 1) {
		const registry = runtime.luaSourceSearchRegistries[registryIndex];
		for (let index = 0; index < registry.records.length; index += 1) {
			const path = registry.records[index].source_path;
			if (seen.has(path)) {
				continue;
			}
			seen.add(path);
			values.push(path);
			if (values.length >= limit) {
				return values.join(', ');
			}
		}
	}
	return values.join(', ');
}

export function listRuntimeLuaResources(runtime: Runtime): ResourceDescriptor[] {
	const descriptors: ResourceDescriptor[] = [];
	const seen = new Set<string>();
	for (let registryIndex = 0; registryIndex < runtime.luaSourceSearchRegistries.length; registryIndex += 1) {
		const registry = runtime.luaSourceSearchRegistries[registryIndex];
		for (let index = 0; index < registry.records.length; index += 1) {
			const entry = registry.records[index];
			if (seen.has(entry.source_path)) {
				continue;
			}
			seen.add(entry.source_path);
			descriptors.push({
				path: entry.source_path,
				type: 'lua',
				asset_id: entry.resid,
			});
		}
	}
	return descriptors;
}

export function getRuntimeLuaEntryPath(runtime: Runtime): string {
	const registry = runtime.activeLuaSources;
	const entryPath = registry.entry_path;
	const record = resolveLuaSourceRecord(registry, entryPath);
	return record ? record.source_path : entryPath;
}

export function getRuntimeLuaResourceSource(runtime: Runtime, path: string): string {
	const match = runtime.resolveLuaSource(path);
	if (match) {
		return match.record.src;
	}
	throw new Error(`[devtools.get_lua_resource_source] Missing Lua resource for path '${path}'. Available: ${summarizeLuaPaths(runtime, 16)}`);
}

export function createInterpreterDevtoolsTable(runtime: Runtime, interpreter: LuaInterpreter): LuaTable {
	const table = createLuaTable();
	table.set('list_lua_resources', new LuaNativeFunction('devtools.list_lua_resources', () => {
		return [runtime.luaJsBridge.toLua(listRuntimeLuaResources(runtime))];
	}));
	table.set('get_lua_entry_path', new LuaNativeFunction('devtools.get_lua_entry_path', () => {
		return [runtime.luaJsBridge.toLua(getRuntimeLuaEntryPath(runtime))];
	}));
	table.set('get_lua_resource_source', new LuaNativeFunction('devtools.get_lua_resource_source', (args) => {
		const path = args[0];
		if (typeof path !== 'string') {
			throw interpreter.runtimeError('[devtools.get_lua_resource_source] path must be a string.');
		}
		return [runtime.luaJsBridge.toLua(getRuntimeLuaResourceSource(runtime, path))];
	}));
	return table;
}
