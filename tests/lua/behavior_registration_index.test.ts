import { BehaviorSourceIndex } from '../../ide/workbench/contrib/behavior_lens/source_index';
import { BehaviorSourceDocuments } from '../../ide/workbench/contrib/behavior_lens/source_documents';
import { indexStateMachineSource } from '../../ide/workbench/contrib/behavior_lens/state_machine_index';
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
import { buildBehaviorQuickPickItems } from '../../ide/workbench/contrib/behavior_lens/quick_access';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { QuickPickModel } from '../../ide/workbench/services/quick_input/model';
import {
	clearCodeEditorInputs,
	createLuaCodeTabContext,
	registerCodeTabContext,
} from '../../ide/workbench/ui/code_tab/contexts';
import { editorTextModelService } from '../../ide/editor/model/model_service';
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

test('behavior picks preserve registration occurrences, kinds, domains and unresolved authored ids', (t) => {
	const path = 'actors.lua';
	const source = [
		"local fsm<const> = require('cartlib/fsm/library')",
		"local bt<const> = require('cartlib/behaviour_tree/library')",
		"local id<const> = 'shared'",
		'local blueprint<const> = { states = { idle = {} } }',
		'fsm.register(id, blueprint)',
		'fsm.register(id, blueprint)',
		"bt.register(id, { root = { type = 'task' } })",
		'fsm.register(build_id(), {})',
		'fsm.register(',
	].join('\n');
	const slot1 = "local fsm<const> = require('cartlib/fsm/library')\nfsm.register('shared', {})";
	const sources = createTestRuntimeSourceState(
		sourceRegistry('machine/bios', [luaSource('system.lua', 'return true')]),
		[
			sourceRegistry('carts/game', [luaSource(path, source), luaSource('other.lua', 'return true')]),
			sourceRegistry('carts/extension', [luaSource(path, slot1)]),
		],
		0,
	);
	t.after(() => {
		clearCodeEditorInputs();
		editorTextModelService.clear();
		resetSemanticProjects();
	});
	const index = new BehaviorRegistrationIndex(sources);
	const registrations = index.getRegistrations(0);
	const definitionKeys = buildBehaviorSourceDocument({ domain: 0, path }, buildLuaFileSemanticData(source, path))
		.definitions.map(node => node.rowKey);
	assert.deepEqual(registrations.map(registration => registration.rowKey), definitionKeys);
	assert.equal(new Set(definitionKeys).size, 5);
	assert.deepEqual(registrations.map(registration => registration.semanticId), ['shared', 'shared', 'shared', null, null]);
	assert.deepEqual(index.resolve(0, 'state_machine', 'shared'), registrations.slice(0, 2));
	assert.deepEqual(index.resolve(0, 'behavior_tree', 'shared'), [registrations[2]]);
	assert.deepEqual(index.resolve(0, 'state_machine', 'build_id()'), []);
	assert.strictEqual(index.getRegistrations(0), registrations);
	const items = buildBehaviorQuickPickItems(sources, index);
	assert.equal(items.length, 6);
	assert.equal(items[0].label, 'BT shared', 'picks sort by behavior label, not source-file or registration order');
	assert.ok(items.every(item => item.description === path));
	const firstFsm = items.find(item => item.registration === registrations[0])!;
	const secondFsm = items.find(item => item.registration === registrations[1])!;
	const slot1Fsm = items.find(item => item.registration.resource.domain === 1)!;
	assert.notEqual(firstFsm.detail, secondFsm.detail);
	assert.notEqual(firstFsm.detail, slot1Fsm.detail);
	const picker = new QuickPickModel();
	picker.setItems(items);
	picker.filter('FSM shared');
	assert.equal(picker.list.rows.length, 3);
	picker.filter('BT shared');
	assert.equal(picker.list.rows.length, 1);
	assert.strictEqual(picker.list.rows[0].item, items[0]);
	assert.equal(slot1Fsm.detail, 'SLOT 1 / 2:14');
	picker.filter('actors.lua 2:14');
	assert.equal(picker.list.rows.length, 1);
	assert.strictEqual(picker.list.rows[0].item, slot1Fsm);
	picker.filter('not_a_behavior');
	assert.equal(picker.list.selectionIndex, -1);

	const other = editorTextModelService.retain(resolveRuntimeResource(sources, { domain: 0, path: 'other.lua' })!, 'lua', 'return true');
	other.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unrelated\n' }]);
	assert.notStrictEqual(index.getRegistrations(0), registrations);
	assert.strictEqual(index.getRegistrations(0)[0], registrations[0], 'unchanged file retains its shallow registration objects');
	const model = editorTextModelService.retain(resolveRuntimeResource(sources, { domain: 0, path })!, 'lua', source);
	model.pushEditOperations([{ offset: source.indexOf("'shared'"), deleteLength: 8, text: "'renamed'" }]);
	assert.equal(index.getRegistrations(0)[0].label, 'FSM renamed');
	assert.deepEqual(index.resolve(0, 'state_machine', 'shared'), []);
	assert.equal(index.resolve(1, 'state_machine', 'shared').length, 1);
	resetSemanticProjects();
	assert.equal(index.getRegistrations(0)[0].label, 'FSM renamed', 'a new semantic project still consumes dirty retained models');
	model.undo();
	assert.equal(index.getRegistrations(0)[0].label, 'FSM shared');
});

test('behavior registration index resolves separate FSM ids in the same Lua document', (t) => {
	const path = 'actors.lua';
	const source = [
		"local fsm<const> = require('cartlib/fsm/library')",
		"fsm.register('player', { states = { idle = {} } })",
		"fsm.register('enemy', { states = { idle = {} } })",
	].join('\n');
	const sources = createTestRuntimeSourceState(
		sourceRegistry('machine/bios', [luaSource('system.lua', 'return true')]),
		[sourceRegistry('carts/game', [luaSource(path, source)]), null],
		0,
	);
	t.after(() => {
		clearCodeEditorInputs();
		editorTextModelService.clear();
		resetSemanticProjects();
	});
	const index = new BehaviorRegistrationIndex(sources);
	const player = index.resolve(0, 'state_machine', 'player');
	const enemy = index.resolve(0, 'state_machine', 'enemy');
	assert.equal(player.length, 1);
	assert.equal(enemy.length, 1);
	assert.deepEqual(player[0].resource, enemy[0].resource);
	assert.equal(player[0].range.start.line, 2);
	assert.equal(enemy[0].range.start.line, 3);
	assert.strictEqual(index.resolve(0, 'state_machine', 'player'), player);
	assert.strictEqual(index.resolve(0, 'state_machine', 'enemy'), enemy);
});

test('kind-specific behavior picks select producer kinds, not names, files or query prefixes', (t) => {
	const path = 'behaviors.lua';
	const source = [
		"local fsm<const> = require('cartlib/fsm/library')",
		"local bt<const> = require('cartlib/behaviour_tree/library')",
		"local effects<const> = require('cartlib/actioneffects')",
		"fsm.register('EFFECT shared', {})",
		"bt.register('EFFECT shared', {})",
		"effects.register_effect('EFFECT shared', {})",
		"effects.register_effect('EFFECT shared', {})",
		'effects.register_effect(compute_id(), {})',
	].join('\n');
	const sources = createTestRuntimeSourceState(
		sourceRegistry('machine/bios', [luaSource('system.lua', 'return true')]),
		[sourceRegistry('carts/game', [luaSource(path, source)]), null],
		0,
	);
	t.after(() => {
		clearCodeEditorInputs();
		editorTextModelService.clear();
		resetSemanticProjects();
	});
	const index = new BehaviorRegistrationIndex(sources);
	const all = buildBehaviorQuickPickItems(sources, index);
	assert.equal(all.length, 5);
	for (const kind of ['action_effect', 'state_machine', 'behavior_tree'] as const) {
		const picks = buildBehaviorQuickPickItems(sources, index, kind);
		assert.deepEqual(picks.map(pick => pick.registration),
			all.filter(pick => pick.registration.behaviorKind === kind).map(pick => pick.registration));
		assert.equal(picks.length, kind === 'action_effect' ? 3 : 1);
		const query = new QuickPickModel();
		query.setItems(picks);
		query.filter('EFFECT shared');
		assert.equal(query.list.rows.length, kind === 'action_effect' ? 2 : 1);
		query.filter('');
		assert.equal(query.list.rows.length, picks.length, 'clearing text cannot escape the requested behavior kind');
	}
	const effects = buildBehaviorQuickPickItems(sources, index, 'action_effect');
	assert.notEqual(effects[0].registration.rowKey, effects[1].registration.rowKey);
	assert.ok(effects.some(pick => pick.registration.semanticId === null), 'dynamic ids remain available in the typed choice');
	const model = editorTextModelService.retain(resolveRuntimeResource(sources, { domain: 0, path })!, 'lua', source);
	model.pushEditOperations([{ offset: 0, deleteLength: source.length, text: 'return true' }]);
	assert.equal(buildBehaviorQuickPickItems(sources, index, 'action_effect').length, 0, 'no file or other-kind fallback after removing authored effects');
	model.undo();
	assert.equal(buildBehaviorQuickPickItems(sources, index, 'action_effect').length, 3);
});

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
		clearCodeEditorInputs();
		editorTextModelService.clear();
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
	context.model.pushEditOperations([{
		offset: 0,
		deleteLength: 0,
		text: '-- authored edit\n',
	}]);
	const slot0Edited = index.resolve(0, 'action_effect', 'shared');
	assert.equal(slot0Edited.length, 1);
	assert.equal(slot0Edited[0].range.start.line, 3);
	assert.notStrictEqual(slot0Edited, slot0Initial);
	assert.strictEqual(index.resolve(1, 'action_effect', 'shared'), slot1Initial);

	context.model.pushEditOperations([{
		offset: context.model.buffer.length,
		deleteLength: 0,
		text: "\neffects.register_effect('shared', {})",
	}]);
	const duplicates = index.resolve(0, 'action_effect', 'shared');
	assert.equal(duplicates.length, 2);
	assert.deepEqual(
		duplicates.map(candidate => candidate.range.start.line),
		[3, 4],
	);
});

test('definition views share one lazy source generation and immutable FSM index per working copy', t => {
	const path = 'definitions.lua';
	const source = "local fsm<const> = require('cartlib/fsm/library')\n" +
		"fsm.register('first', { states = { idle = {} } })\nfsm.register('second', { states = { idle = {} } })";
	const sources = createTestRuntimeSourceState(sourceRegistry('machine/bios', [luaSource('system.lua', 'return true')]),
		[sourceRegistry('carts/fixture', [luaSource(path, source)]), null], 0);
	t.after(() => { editorTextModelService.clear(); resetSemanticProjects(); });
	const model = editorTextModelService.retain(resolveRuntimeResource(sources, { domain: 0, path })!, 'lua', source);
	const documents = new BehaviorSourceDocuments(sources);
	const first = documents.get(model);
	const fsm = indexStateMachineSource(first);
	const positions = BehaviorSourceIndex.acquire(first, model);
	t.after(() => positions.release());
	const originalStart = positions.ranges.get(first.definitions[1].rowKey)!.start;
	for (let request = 0; request < 1000; request += 1) {
		assert.equal(documents.get(model), first);
		assert.equal(indexStateMachineSource(first), fsm);
		const acquired = BehaviorSourceIndex.acquire(first, model);
		assert.equal(acquired, positions);
		acquired.release();
	}
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved\n' }]);
	assert.equal(positions.ranges.get(first.definitions[1].rowKey)!.start, originalStart + '-- moved\n'.length, 'the model maps shared ranges without a view forwarding its content event');
	const second = documents.get(model);
	assert.notEqual(second, first); assert.equal(documents.get(model), second);
	assert.notEqual(indexStateMachineSource(second), fsm);
	assert.equal(second.definitions[1].occurrenceRange.start.line, first.definitions[1].occurrenceRange.start.line + 1);
});
