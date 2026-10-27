import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { resourceIdentityKey } from '../../ide/common/resource';
import { buildResourceLuaSemanticFixtureFile, createResourceModuleProjectFixture } from '../helpers/lua_semantic_project';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import { BehaviorSourceIndex } from '../../ide/workbench/contrib/behavior_lens/source_index';
import { BehaviorSourceDocuments } from '../../ide/workbench/contrib/behavior_lens/source_documents';
import { indexStateMachineSource } from '../../ide/workbench/contrib/behavior_lens/state_machine_index';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getOrCreateSemanticProject, resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import {
	registerLuaSourceRecord,
	type LuaSourceRecord,
	type LuaSourceRegistry,
} from '../../ide/runtime/source_registry';
import { BehaviorRegistrationIndex } from '../../ide/workbench/contrib/behavior_lens/registration_index';
import { buildBehaviorQuickPickItems } from '../../ide/workbench/contrib/behavior_lens/quick_access';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { QuickPickModel } from '../../ide/workbench/services/quick_input/model';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';

const API_MODULES = ['cartlib/fsm/library','cartlib/behaviour_tree/library','cartlib/actioneffects'];

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
		sourceKind: 'project', program_module: true,
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
	const admitted = projectRootPath === 'machine/bios' ? [...records, ...API_MODULES.map(module => luaSource(`${module}.lua`, ''))] : records;
	for (let index = 0; index < admitted.length; index += 1) {
		registerLuaSourceRecord(registry, admitted[index]);
	}
	return registry;
}

test('API-provider edits and Undo update the catalogue and open documents without rebinding their consumer', t => {
	const source = "local publish = require('bridge'); publish('one', { states = { idle = {} } }); publish('two', { states = {} })";
	const bridge = "return require('cartlib/fsm/library').register";
	const sources = createTestRuntimeSourceState(sourceRegistry('machine/bios', [luaSource('system.lua', '')]),
		[sourceRegistry('carts/fixture', [luaSource('actors.lua', source), luaSource('bridge.lua', bridge)]), null], 0);
	t.after(() => { editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); });
	const main = editorTextModelService.retain(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'actors.lua' })!, 'lua', source);
	const provider = editorTextModelService.retain(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'bridge.lua' })!, 'lua', bridge);
	const index = new BehaviorRegistrationIndex(editorTextModelService, sources.catalog);
	const documents = new BehaviorSourceDocuments(editorTextModelService, sources.catalog);
	assert.deepEqual(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0]).map(entry => entry.semanticId), ['one', 'two']);
	const document = documents.get(main);
	assert.equal(document.definitions.length, 2);
	const project = getOrCreateSemanticProject(editorTextModelService, TEST_CARTRIDGE_CONTEXT_IDS[0]);
	const analysis = project.getFileData(main.resource);
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: 'return replacement' }]);
	assert.deepEqual(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0]), []);
	assert.equal(documents.get(main).definitions.length, 0);
	assert.equal(project.getFileData(main.resource), analysis);
	assert.equal(main.dirty, false);
	provider.undo();
	assert.deepEqual(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0]).map(entry => entry.semanticId), ['one', 'two']);
	assert.deepEqual(documents.get(main).definitions.map(entry => entry.rowKey), document.definitions.map(entry => entry.rowKey));
	assert.equal(project.getFileData(main.resource), analysis);
	assert.equal(provider.dirty, false);
});

test('behavior picks preserve registration occurrences, kinds, domains and unresolved authored ids', (t) => {
	const path = 'actors.lua';
	const source = [
		"local fsm = require('cartlib/fsm/library')",
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
		editorTextModelService.clear();
		resetSemanticProjects(editorTextModelService);
	});
	const index = new BehaviorRegistrationIndex(editorTextModelService, sources.catalog);
	const registrations = index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0]);
	const definitionKeys = buildBehaviorSourceDocument({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path }, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: path })], API_MODULES)))
		.definitions.map(node => node.rowKey);
	assert.deepEqual(registrations.map(registration => registration.rowKey), definitionKeys);
	assert.equal(new Set(definitionKeys).size, 5);
	assert.deepEqual(registrations.map(registration => registration.semanticId), ['shared', 'shared', 'shared', null, null]);
	assert.deepEqual(index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[0], 'state_machine', 'shared'), registrations.slice(0, 2));
	assert.deepEqual(index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[0], 'behavior_tree', 'shared'), [registrations[2]]);
	assert.deepEqual(index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[0], 'state_machine', 'build_id()'), []);
	assert.strictEqual(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0]), registrations);
	const items = buildBehaviorQuickPickItems(sources.catalog, index);
	assert.equal(items.length, 6);
	assert.ok(items.every(item => item.description === path));
	const firstFsm = items.find(item => item.registration === registrations[0])!;
	const secondFsm = items.find(item => item.registration === registrations[1])!;
	const slot1Fsm = items.find(item => item.registration.resource.contextId === TEST_CARTRIDGE_CONTEXT_IDS[1])!;
	assert.notEqual(firstFsm.detail, secondFsm.detail);
	assert.notEqual(firstFsm.detail, slot1Fsm.detail);
	const picker = new QuickPickModel();
	picker.setInput(new TextQuickPickProvider(items));
	picker.filter('FSM shared');
	assert.equal(picker.list.rows.length, 3);
	picker.filter('BT shared');
	assert.equal(picker.list.rows.length, 1);
	assert.strictEqual(picker.list.rows[0].item, items[0]);
	picker.filter('actors.lua 2:14');
	assert.equal(picker.list.rows.length, 1);
	assert.strictEqual(picker.list.rows[0].item, slot1Fsm);
	picker.filter('not_a_behavior');
	assert.equal(picker.list.selectionIndex, -1);

	const other = editorTextModelService.retain(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'other.lua' })!, 'lua', 'return true');
	other.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- unrelated\n' }]);
	assert.notStrictEqual(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0]), registrations);
	assert.notStrictEqual(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0])[0], registrations[0], 'workspace source queries include dependencies outside the registering file');
	const model = editorTextModelService.retain(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path })!, 'lua', source);
	model.pushEditOperations([{ offset: source.indexOf("'shared'"), deleteLength: 8, text: "'renamed'" }]);
	assert.equal(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0])[0].semanticId, 'renamed');
	assert.deepEqual(index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[0], 'state_machine', 'shared'), []);
	assert.equal(index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[1], 'state_machine', 'shared').length, 1);
	resetSemanticProjects(editorTextModelService);
	assert.equal(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0])[0].semanticId, 'renamed', 'a new semantic project still consumes dirty retained models');
	model.undo();
	assert.equal(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0])[0].semanticId, 'shared');
	// Finish the deliberately incomplete call, then introduce a real binding write.
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: ")\nfsm = replacement\n" }]);
	assert.deepEqual(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0]).map(registration => registration.behaviorKind), ['behavior_tree']);
	model.undo();
	assert.deepEqual(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0]).map(registration => registration.semanticId), ['shared', 'shared', 'shared', null, null]);
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
		editorTextModelService.clear();
		resetSemanticProjects(editorTextModelService);
	});
	const index = new BehaviorRegistrationIndex(editorTextModelService, sources.catalog);
	const player = index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[0], 'state_machine', 'player');
	const enemy = index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[0], 'state_machine', 'enemy');
	assert.equal(player.length, 1);
	assert.equal(enemy.length, 1);
	assert.deepEqual(player[0].resource, enemy[0].resource);
	assert.equal(player[0].range.start.line, 2);
	assert.equal(enemy[0].range.start.line, 3);
	assert.strictEqual(index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[0], 'state_machine', 'player'), player);
	assert.strictEqual(index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[0], 'state_machine', 'enemy'), enemy);
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
		editorTextModelService.clear();
		resetSemanticProjects(editorTextModelService);
	});
	const index = new BehaviorRegistrationIndex(editorTextModelService, sources.catalog);
	const all = buildBehaviorQuickPickItems(sources.catalog, index);
	assert.equal(all.length, 5);
	for (const kind of ['action_effect', 'state_machine', 'behavior_tree'] as const) {
		const picks = buildBehaviorQuickPickItems(sources.catalog, index, kind);
		assert.deepEqual(picks.map(pick => pick.registration),
			all.filter(pick => pick.registration.behaviorKind === kind).map(pick => pick.registration));
		assert.equal(picks.length, kind === 'action_effect' ? 3 : 1);
		const query = new QuickPickModel();
		query.setInput(new TextQuickPickProvider(picks));
		query.filter('EFFECT shared');
		assert.equal(query.list.rows.length, kind === 'action_effect' ? 2 : 1);
		query.filter('');
		assert.equal(query.list.rows.length, picks.length, 'clearing text cannot escape the requested behavior kind');
	}
	const effects = buildBehaviorQuickPickItems(sources.catalog, index, 'action_effect');
	assert.notEqual(effects[0].registration.rowKey, effects[1].registration.rowKey);
	assert.ok(effects.some(pick => pick.registration.semanticId === null), 'dynamic ids remain available in the typed choice');
	const model = editorTextModelService.retain(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path })!, 'lua', source);
	model.pushEditOperations([{ offset: 0, deleteLength: source.length, text: 'return true' }]);
	assert.equal(buildBehaviorQuickPickItems(sources.catalog, index, 'action_effect').length, 0, 'no file or other-kind fallback after removing authored effects');
	model.undo();
	assert.equal(buildBehaviorQuickPickItems(sources.catalog, index, 'action_effect').length, 3);
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
		editorTextModelService.clear();
		resetSemanticProjects(editorTextModelService);
	});
	const index = new BehaviorRegistrationIndex(editorTextModelService, sources.catalog);
	const slot0Initial = index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[0], 'action_effect', 'shared');
	const slot1Initial = index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[1], 'action_effect', 'shared');
	assert.equal(slot0Initial.length, 1);
	assert.equal(slot0Initial[0].resource.contextId, TEST_CARTRIDGE_CONTEXT_IDS[0]);
	assert.equal(slot0Initial[0].range.start.line, 2);
	assert.equal(slot1Initial.length, 1);
	assert.equal(slot1Initial[0].resource.contextId, TEST_CARTRIDGE_CONTEXT_IDS[1]);
	assert.equal(slot1Initial[0].range.start.line, 3);
	assert.strictEqual(index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[0], 'action_effect', 'shared'), slot0Initial);
	assert.strictEqual(index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[1], 'action_effect', 'shared'), slot1Initial);

	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: slot0Path })!;
	const model = resolveLuaTextFileModel(editorTextModelService, sources.catalog, resource);
	model.pushEditOperations([{
		offset: 0,
		deleteLength: 0,
		text: '-- authored edit\n',
	}]);
	const slot0Edited = index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[0], 'action_effect', 'shared');
	assert.equal(slot0Edited.length, 1);
	assert.equal(slot0Edited[0].range.start.line, 3);
	assert.notStrictEqual(slot0Edited, slot0Initial);
	assert.strictEqual(index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[1], 'action_effect', 'shared'), slot1Initial);

	model.pushEditOperations([{
		offset: model.buffer.length,
		deleteLength: 0,
		text: "\neffects.register_effect('shared', {})",
	}]);
	const duplicates = index.resolve(TEST_CARTRIDGE_CONTEXT_IDS[0], 'action_effect', 'shared');
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
	t.after(() => { editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); });
	const model = editorTextModelService.retain(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path })!, 'lua', source);
	const documents = new BehaviorSourceDocuments(editorTextModelService, sources.catalog);
	const first = documents.get(model);
	const fsm = indexStateMachineSource(first);
	const positions = BehaviorSourceIndex.acquire(first, model, assert.fail);
	t.after(() => positions.release());
	const originalStart = positions.ranges.get(first.definitions[1].rowKey)!.start;
	for (let request = 0; request < 1000; request += 1) {
		assert.equal(documents.get(model), first);
		assert.equal(indexStateMachineSource(first), fsm);
		const acquired = BehaviorSourceIndex.acquire(first, model, assert.fail);
		assert.equal(acquired, positions);
		acquired.release();
	}
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved\n' }]);
	assert.equal(positions.ranges.get(first.definitions[1].rowKey)!.start, originalStart + '-- moved\n'.length, 'the model maps shared ranges without a view forwarding its content event');
	const second = documents.get(model);
	assert.notEqual(second, first); assert.equal(documents.get(model), second);
	assert.notEqual(indexStateMachineSource(second), fsm);
	assert.equal(second.definitions[1].occurrenceRange.start.line, first.definitions[1].occurrenceRange.start.line + 1);
	assert.deepEqual(Object.keys(second.files[0]).sort(), ['file', 'revision'], 'source proofs do not pin complete binder tables');
	resetSemanticProjects(editorTextModelService);
	const replacement = documents.get(model);
	assert.notEqual(replacement.files[0].revision, second.files[0].revision, 'binder revisions do not collide after resetting the project');
	const generation = getOrCreateSemanticProject(editorTextModelService, TEST_CARTRIDGE_CONTEXT_IDS[0]).getSnapshot();
	resetSemanticProjects(editorTextModelService);
	assert.notEqual(documents.get(model), replacement, 'equal workspace version numbers cannot reuse another project generation');
	assert.equal(getOrCreateSemanticProject(editorTextModelService, TEST_CARTRIDGE_CONTEXT_IDS[0]).getSnapshot().version, generation.version);
});

test('an added module export refreshes cached behavior ids and topology without editing the registration', t => {
	const path = 'main.lua';
	const source = "local fsm<const> = require('cartlib/fsm/library'); fsm.register(require('id'), require('definition'))";
	const initial = 'local unpublished = {}';
	const sources = createTestRuntimeSourceState(sourceRegistry('machine/bios', [luaSource('system.lua', 'return true')]),
		[sourceRegistry('carts/fixture', [luaSource(path, source), luaSource('id.lua', initial), luaSource('definition.lua', initial)]), null], 0);
	t.after(() => { editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); });
	const main = editorTextModelService.retain(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path })!, 'lua', source);
	const id = editorTextModelService.retain(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'id.lua' })!, 'lua', initial);
	const provider = editorTextModelService.retain(sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'definition.lua' })!, 'lua', initial);
	const documents = new BehaviorSourceDocuments(editorTextModelService, sources.catalog), index = new BehaviorRegistrationIndex(editorTextModelService, sources.catalog);
	const before = documents.get(main);
	assert.equal(before.definitions[0].resolution, 'unresolved');
	assert.equal(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0])[0].semanticId, null);
	id.pushEditOperations([{ offset: id.buffer.length, deleteLength: 0, text: "\nreturn 'new.export'" }]);
	provider.pushEditOperations([{ offset: provider.buffer.length, deleteLength: 0, text: "\nreturn { initial = 'idle', states = { idle = {} } }" }]);
	const after = documents.get(main);
	assert.notEqual(after, before);
	assert.equal(after.definitions[0].resolution, 'complete');
	assert.equal(after.definitions[0].authoredRange.path, resourceIdentityKey({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'definition.lua' }));
	assert.equal(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0])[0].semanticId, 'new.export');
	assert.equal(main.version, 1);
	id.undo(); provider.undo();
	assert.equal(index.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0])[0].semanticId, null);
	assert.equal(documents.get(main).definitions[0].resolution, 'unresolved');
});
