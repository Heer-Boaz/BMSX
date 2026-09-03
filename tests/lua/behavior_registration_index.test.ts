import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import {
	registerLuaSourceRecord,
	type LuaSourceRecord,
	type LuaSourceRegistry,
} from '../../ide/runtime/source_registry';
import { resolveRuntimeResource } from '../../ide/runtime/sources';
import { BehaviorRegistrationIndex } from '../../ide/workbench/contrib/behavior_lens/registration_index';
import {
	clearCodeTabContexts,
	createLuaCodeTabContext,
	registerCodeTabContext,
} from '../../ide/workbench/ui/code_tab/contexts';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';

function luaSource(path: string, source: string): LuaSourceRecord {
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

function sourceRegistry(projectRootPath: string, records: readonly LuaSourceRecord[]): LuaSourceRegistry {
	const registry: LuaSourceRegistry = {
		records: [],
		path2lua: {},
		module2lua: {},
		entrySourcePath: records[0].source_path,
		projectRootPath,
		can_boot_from_source: true,
		revision: 0,
	};
	for (let index = 0; index < records.length; index += 1) {
		registerLuaSourceRecord(registry, records[index]);
	}
	return registry;
}

test('behavior registration index isolates domains and rebuilds on an authored document generation', (t) => {
	const slot0Path = 'slot0/effects.lua';
	const slot1Path = 'slot1/effects.lua';
	const slot0Source = [
		"local effects<const> = require('cartlib/actioneffects')",
		"effects.register_effect('shared', {})",
	].join('\n');
	const slot1Source = [
		"local effects<const> = require('cartlib/actioneffects')",
		'-- slot 1',
		"effects.register_effect('shared', {})",
	].join('\n');
	const sources = createTestRuntimeSourceState(
		sourceRegistry('machine/bios', [luaSource('system.lua', 'return true')]),
		[
			sourceRegistry('carts/slot0', [luaSource(slot0Path, slot0Source)]),
			sourceRegistry('carts/slot1', [luaSource(slot1Path, slot1Source)]),
		],
		0,
	);
	t.after(() => {
		clearCodeTabContexts();
		resetSemanticProjects();
	});
	const index = new BehaviorRegistrationIndex(sources);
	const slot0Initial = index.resolve(0, 'action_effect', 'shared');
	const slot1Initial = index.resolve(1, 'action_effect', 'shared');
	assert.equal(slot0Initial.length, 1);
	assert.equal(slot0Initial[0].resource.domain, 0);
	assert.equal(slot0Initial[0].range.start.line, 2);
	assert.equal(slot1Initial.length, 1);
	assert.equal(slot1Initial[0].resource.domain, 1);
	assert.equal(slot1Initial[0].range.start.line, 3);
	assert.strictEqual(index.resolve(0, 'action_effect', 'shared'), slot0Initial);
	assert.strictEqual(index.resolve(1, 'action_effect', 'shared'), slot1Initial);

	const resource = resolveRuntimeResource(sources, { domain: 0, path: slot0Path })!;
	const context = createLuaCodeTabContext(sources, resource);
	registerCodeTabContext(context);
	context.buffer.insert(0, '-- authored edit\n');
	const slot0Edited = index.resolve(0, 'action_effect', 'shared');
	assert.equal(slot0Edited.length, 1);
	assert.equal(slot0Edited[0].range.start.line, 3);
	assert.notStrictEqual(slot0Edited, slot0Initial);
	assert.strictEqual(index.resolve(1, 'action_effect', 'shared'), slot1Initial);

	context.buffer.insert(context.buffer.length, "\neffects.register_effect('shared', {})");
	const duplicates = index.resolve(0, 'action_effect', 'shared');
	assert.equal(duplicates.length, 2);
	assert.deepEqual(
		duplicates.map(candidate => candidate.range.start.line),
		[3, 4],
	);
});
