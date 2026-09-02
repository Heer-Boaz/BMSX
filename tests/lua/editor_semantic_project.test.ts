import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorLuaSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/project';
import type { LuaSourceRecord, LuaSourceRegistry } from '../../ide/runtime/source_registry';
import type { RuntimeSourceState } from '../../ide/runtime/sources';

function sourceRecord(path: string, source: string): LuaSourceRecord {
	return {
		resid: path,
		type: 'lua',
		src: source,
		base_src: source,
		base_update_timestamp: 0,
		source_path: path,
		normalized_source_path: path,
		module_path: path.slice(0, -4),
		update_timestamp: 0,
		generated: false,
		program_module: true,
	};
}

function sourceRegistry(entries: ReadonlyArray<readonly [string, string]>): LuaSourceRegistry {
	const records = new Array<LuaSourceRecord>(entries.length);
	const path2lua: Record<string, LuaSourceRecord> = {};
	const module2lua: Record<string, LuaSourceRecord> = {};
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const record = sourceRecord(entry[0], entry[1]);
		records[index] = record;
		path2lua[record.source_path] = record;
		module2lua[record.module_path] = record;
	}
	return {
		records,
		path2lua,
		module2lua,
		entrySourcePath: records[0].source_path,
		projectRootPath: '',
		can_boot_from_source: records.length > 0,
		revision: 1,
	};
}

function runtimeSources(system: LuaSourceRegistry, cartridge: LuaSourceRegistry | null): RuntimeSourceState {
	return {
		systemLuaSources: system,
		cartridgeSlots: [
			cartridge === null ? null : { luaSources: cartridge },
			null,
		],
	} as RuntimeSourceState;
}

test('editor semantic project retains its immutable snapshot while source generations are unchanged', () => {
	const system = sourceRegistry([['system.lua', 'system_value = 1']]);
	const sources = runtimeSources(system, null);
	const project = new EditorLuaSemanticProject(-1);
	project.synchronizeRuntimeSources(sources);
	const snapshot = project.getSnapshot();

	project.synchronizeRuntimeSources(sources);

	assert.equal(project.getSnapshot(), snapshot);
});

test('editor document source remains authoritative across a newer runtime registry generation', () => {
	const system = sourceRegistry([['system.lua', 'system_value = 1']]);
	const cartridge = sourceRegistry([['entry.lua', 'return "rom"']]);
	const sources = runtimeSources(system, cartridge);
	const project = new EditorLuaSemanticProject(0);
	project.synchronizeRuntimeSources(sources);
	project.updateDocument('entry.lua', 'return "editor"');

	cartridge.records[0].src = 'return "new rom"';
	cartridge.revision += 1;
	project.synchronizeRuntimeSources(sources);

	assert.equal(project.getFileData('entry.lua')?.source, 'return "editor"');
});

test('editor semantic project removes files that disappear from a replaced runtime registry', () => {
	const system = sourceRegistry([['system.lua', 'system_value = 1']]);
	const sources = runtimeSources(system, sourceRegistry([
		['entry.lua', 'return "entry"'],
		['removed.lua', 'return "removed"'],
	]));
	const project = new EditorLuaSemanticProject(0);
	project.synchronizeRuntimeSources(sources);
	assert.ok(project.getFileData('removed.lua'));

	sources.cartridgeSlots[0] = {
		luaSources: sourceRegistry([['entry.lua', 'return "replacement"']]),
	} as RuntimeSourceState['cartridgeSlots'][0];
	project.synchronizeRuntimeSources(sources);

	assert.equal(project.getFileData('removed.lua'), undefined);
});

test('cartridge semantic projects prefer cartridge modules while retaining system-only modules', () => {
	const system = sourceRegistry([
		['shared.lua', 'return "system"'],
		['system_only.lua', 'return "system only"'],
	]);
	const cartridge = sourceRegistry([['shared.lua', 'return "cartridge"']]);
	const sources = runtimeSources(system, cartridge);
	const project = new EditorLuaSemanticProject(0);
	project.synchronizeRuntimeSources(sources);

	assert.equal(project.getFileData('shared.lua')?.source, 'return "cartridge"');
	assert.equal(project.getFileData('system_only.lua')?.source, 'return "system only"');
});
