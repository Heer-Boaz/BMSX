import { asStringId, createNativeFunction, Table, valueIsString } from '../cpu/cpu';
import { createLuaTable, type LuaTable } from '../../lua/value';
import { LuaNativeFunction, type LuaInterpreter } from '../../lua/runtime';
import type { ResourceDescriptor } from '../../rompack/tooling/resource';
import type { Runtime } from '../runtime/runtime';
import type { LuaSourceRecord, LuaSourceRegistry } from '../program/sources';
import { getWorkspaceCachedSource } from '../../ide/workspace/cache';
import { buildDirtyFilePath, hasWorkspaceStorage } from '../../ide/workbench/workspace/io';

function listRuntimeLuaRegistries(runtime: Runtime): LuaSourceRegistry[] {
	const registries: LuaSourceRegistry[] = [];
	const active = runtime.activeLuaSources;
	if (active !== null) {
		registries.push(active);
	}
	if (runtime.systemLuaSources !== null && runtime.systemLuaSources !== active) {
		registries.push(runtime.systemLuaSources);
	}
	return registries;
}

function resolveLuaSourceRecordByPath(registry: LuaSourceRegistry, path: string): LuaSourceRecord {
	const direct = registry.path2lua[path];
	if (direct !== undefined) {
		return direct;
	}
	return registry.module2lua[path];
}

function summarizeLuaPaths(runtime: Runtime, limit: number): string {
	const values: string[] = [];
	const seen = new Set<string>();
	const registries = listRuntimeLuaRegistries(runtime);
	for (let registryIndex = 0; registryIndex < registries.length; registryIndex += 1) {
		const registry = registries[registryIndex];
		const entries = Object.values(registry.path2lua);
		for (let index = 0; index < entries.length; index += 1) {
			const path = entries[index].source_path;
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

function resolveRuntimeLuaSourceRecord(runtime: Runtime, path: string): LuaSourceRecord | null {
	const registries = listRuntimeLuaRegistries(runtime);
	for (let index = 0; index < registries.length; index += 1) {
		const resolved = resolveLuaSourceRecordByPath(registries[index], path);
		if (resolved !== null) {
			return resolved;
		}
	}
	return null;
}

export function listRuntimeLuaResources(runtime: Runtime): ResourceDescriptor[] {
	const descriptors: ResourceDescriptor[] = [];
	const seen = new Set<string>();
	const registries = listRuntimeLuaRegistries(runtime);
	for (let registryIndex = 0; registryIndex < registries.length; registryIndex += 1) {
		const registry = registries[registryIndex];
		const entries = Object.values(registry.path2lua);
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
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
	const record = resolveLuaSourceRecordByPath(registry, entryPath);
	return record ? record.source_path : entryPath;
}

export function getRuntimeLuaResourceSource(runtime: Runtime, path: string): string {
	const record = resolveRuntimeLuaSourceRecord(runtime, path);
	if (record === null) {
		throw new Error(`[devtools.get_lua_resource_source] Missing Lua resource for path '${path}'. Available: ${summarizeLuaPaths(runtime, 16)}`);
	}
	const cached = getWorkspaceCachedSource(record.source_path);
	if (cached !== null) {
		return cached;
	}
	if (hasWorkspaceStorage()) {
		const dirty = getWorkspaceCachedSource(buildDirtyFilePath(record.source_path));
		if (dirty !== null) {
			return dirty;
		}
	}
	return record.src;
}

function buildRuntimeResourceDescriptorTable(runtime: Runtime, descriptor: ResourceDescriptor): Table {
	const table = new Table(0, 3);
	table.set(runtime.internString('path'), runtime.internString(descriptor.path));
	table.set(runtime.internString('type'), runtime.internString(descriptor.type));
	if (descriptor.asset_id !== undefined) {
		table.set(runtime.internString('asset_id'), runtime.internString(descriptor.asset_id));
	}
	return table;
}

export function createRuntimeDevtoolsTable(runtime: Runtime): Table {
	const listLuaResourcesFn = createNativeFunction('devtools.list_lua_resources', (_args, out) => {
		const descriptors = listRuntimeLuaResources(runtime);
		const table = new Table(0, descriptors.length);
		for (let index = 0; index < descriptors.length; index += 1) {
			table.set(index + 1, buildRuntimeResourceDescriptorTable(runtime, descriptors[index]));
		}
		out.push(table);
	});
	const getLuaEntryPathFn = createNativeFunction('devtools.get_lua_entry_path', (_args, out) => {
		out.push(runtime.internString(getRuntimeLuaEntryPath(runtime)));
	});
	const getLuaResourceSourceFn = createNativeFunction('devtools.get_lua_resource_source', (args, out) => {
		const path = args[0];
		if (!valueIsString(path)) {
			throw runtime.createApiRuntimeError(`[devtools.get_lua_resource_source] path must be a string.`);
		}
		out.push(runtime.internString(getRuntimeLuaResourceSource(runtime, runtime.machine.cpu.stringPool.toString(asStringId(path)))));
	});
	const table = new Table(0, 3);
	table.set(runtime.internString('list_lua_resources'), listLuaResourcesFn);
	table.set(runtime.internString('get_lua_entry_path'), getLuaEntryPathFn);
	table.set(runtime.internString('get_lua_resource_source'), getLuaResourceSourceFn);
	return table;
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
