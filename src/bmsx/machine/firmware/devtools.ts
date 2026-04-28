import { createNativeFunction, Table } from '../cpu/cpu';
import { createLuaTable, type LuaTable } from '../../lua/value';
import { LuaNativeFunction, type LuaInterpreter } from '../../lua/runtime';
import type { ResourceDescriptor } from '../../rompack/resource';
import { Runtime } from '../runtime/runtime';
import type { LuaSourceRecord, LuaSourceRegistry } from '../program/sources';
import { StringValue } from '../memory/string/pool';
import { getWorkspaceCachedSource } from '../../ide/workspace/cache';
import { buildDirtyFilePath, hasWorkspaceStorage } from '../../ide/workbench/workspace/io';

function matchesLuaPathAlias(path: string, alias: string): boolean {
	if (path === alias) {
		return true;
	}
	if (path.length <= alias.length) {
		return false;
	}
	const offset = path.length - alias.length;
	return path.endsWith(alias) && path[offset - 1] === '/';
}

function listRuntimeLuaRegistries(): LuaSourceRegistry[] {
	const runtime = Runtime.instance;
	const registries: LuaSourceRegistry[] = [];
	const active = runtime.activeLuaSources;
	if (active !== null) {
		registries.push(active);
	}
	if (runtime.engineLuaSources !== null && runtime.engineLuaSources !== active) {
		registries.push(runtime.engineLuaSources);
	}
	return registries;
}

function resolveLuaSourceRecordByPath(registry: LuaSourceRegistry, path: string): LuaSourceRecord | null {
	const direct = registry.path2lua[path];
	if (direct !== undefined) {
		return direct;
	}
	let resolved: LuaSourceRecord | null = null;
	const entries = Object.values(registry.path2lua);
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (!matchesLuaPathAlias(entry.source_path, path)) {
			continue;
		}
		if (resolved !== null && resolved.source_path !== entry.source_path) {
			throw new Error(`[devtools.get_lua_resource_source] Ambiguous lua path '${path}'.`);
		}
		resolved = entry;
	}
	return resolved;
}

function summarizeLuaPaths(limit: number): string {
	const values: string[] = [];
	const seen = new Set<string>();
	const registries = listRuntimeLuaRegistries();
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

function resolveRuntimeLuaSourceRecord(path: string): LuaSourceRecord | null {
	const registries = listRuntimeLuaRegistries();
	for (let index = 0; index < registries.length; index += 1) {
		const resolved = resolveLuaSourceRecordByPath(registries[index], path);
		if (resolved !== null) {
			return resolved;
		}
	}
	return null;
}

export function listRuntimeLuaResources(): ResourceDescriptor[] {
	const descriptors: ResourceDescriptor[] = [];
	const seen = new Set<string>();
	const registries = listRuntimeLuaRegistries();
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

export function getRuntimeLuaEntryPath(): string {
	const runtime = Runtime.instance;
	const registry = runtime.activeLuaSources;
	const entryPath = registry.entry_path;
	const record = resolveLuaSourceRecordByPath(registry, entryPath);
	return record ? record.source_path : entryPath;
}

export function getRuntimeLuaResourceSource(path: string): string {
	const record = resolveRuntimeLuaSourceRecord(path);
	if (record === null) {
		throw new Error(`[devtools.get_lua_resource_source] Missing Lua resource for path '${path}'. Available: ${summarizeLuaPaths(16)}`);
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

function buildRuntimeResourceDescriptorTable(descriptor: ResourceDescriptor): Table {
	const runtime = Runtime.instance;
	const table = new Table(0, 3);
	table.set(runtime.luaKey('path'), runtime.internString(descriptor.path));
	table.set(runtime.luaKey('type'), runtime.internString(descriptor.type));
	if (descriptor.asset_id !== undefined) {
		table.set(runtime.luaKey('asset_id'), runtime.internString(descriptor.asset_id));
	}
	return table;
}

export function createRuntimeDevtoolsTable(): Table {
	const runtime = Runtime.instance;
	const listLuaResourcesFn = createNativeFunction('devtools.list_lua_resources', (_args, out) => {
		const descriptors = listRuntimeLuaResources();
		const table = new Table(0, descriptors.length);
		for (let index = 0; index < descriptors.length; index += 1) {
			table.set(index + 1, buildRuntimeResourceDescriptorTable(descriptors[index]));
		}
		out.push(table);
	});
	const getLuaEntryPathFn = createNativeFunction('devtools.get_lua_entry_path', (_args, out) => {
		out.push(runtime.internString(getRuntimeLuaEntryPath()));
	});
	const getLuaResourceSourceFn = createNativeFunction('devtools.get_lua_resource_source', (args, out) => {
		const path = args[0];
		if (!(path instanceof StringValue)) {
			throw runtime.createApiRuntimeError(`[devtools.get_lua_resource_source] path must be a string.`);
		}
		out.push(runtime.internString(getRuntimeLuaResourceSource(path.text)));
	});
	const table = new Table(0, 3);
	table.set(runtime.luaKey('list_lua_resources'), listLuaResourcesFn);
	table.set(runtime.luaKey('get_lua_entry_path'), getLuaEntryPathFn);
	table.set(runtime.luaKey('get_lua_resource_source'), getLuaResourceSourceFn);
	return table;
}

export function createInterpreterDevtoolsTable(interpreter: LuaInterpreter): LuaTable {
	const runtime = Runtime.instance;
	const table = createLuaTable();
	table.set('list_lua_resources', new LuaNativeFunction('devtools.list_lua_resources', () => {
		return [runtime.luaJsBridge.toLua(listRuntimeLuaResources())];
	}));
	table.set('get_lua_entry_path', new LuaNativeFunction('devtools.get_lua_entry_path', () => {
		return [runtime.luaJsBridge.toLua(getRuntimeLuaEntryPath())];
	}));
	table.set('get_lua_resource_source', new LuaNativeFunction('devtools.get_lua_resource_source', (args) => {
		const path = args[0];
		if (typeof path !== 'string') {
			throw interpreter.runtimeError('[devtools.get_lua_resource_source] path must be a string.');
		}
		return [runtime.luaJsBridge.toLua(getRuntimeLuaResourceSource(path))];
	}));
	return table;
}
