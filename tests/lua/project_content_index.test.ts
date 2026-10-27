import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { getOrCreateSemanticProject, resetSemanticProject, resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { resourceIdentityEquals, type RuntimeResource } from '../../ide/common/resource';
import { BehaviorRegistrationIndex } from '../../ide/workbench/contrib/behavior_lens/registration_index';
import { ProjectContentIndex } from '../../ide/workbench/contrib/resources/panel/content_index';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS, TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';

const contextId = TEST_CARTRIDGE_CONTEXT_IDS[0];
const modules = [
	'cartlib/world/scene_library', 'cartlib/behaviour_tree/library', 'cartlib/fsm/library', 'cartlib/actioneffects',
	'cartlib/progression', 'cartlib/input/actioneffect/actioneffect_component', 'cartlib/timeline/program',
	'cartlib/component/sprite_animation_component',
];

function fixture(files: Record<string, string>) {
	const sources = createScenarioTestSourceState([...modules.map(path => createScenarioTestSourceRecord(`${path}.lua`, 1, 'return {}')),
		...Object.entries(files).map(([path, source]) => createScenarioTestSourceRecord(path, 1, source))]);
	const models = new EditorTextModelService();
	const registrations = new BehaviorRegistrationIndex(models, sources.catalog);
	const index = new ProjectContentIndex(models, sources.catalog, registrations);
	const resource = (path: string): RuntimeResource => sources.catalog.resolveResource({ contextId, path })!;
	const model = (path: string) => resolveLuaTextFileModel(models, sources.catalog, resource(path));
	const dispose = () => { index.dispose(); models.clear(); resetSemanticProjects(models); sources.catalog.dispose(); };
	return { sources, models, registrations, index, resource, model, dispose };
}

test('project content discovers every existing authored kind without opening working copies', t => {
	const f = fixture({ 'main.lua': `
local scenes = require('cartlib/world/scene_library')
local trees = require('cartlib/behaviour_tree/library')
local machines = require('cartlib/fsm/library')
local effects = require('cartlib/actioneffects')
local progression = require('cartlib/progression')
local input = require('cartlib/input/actioneffect/actioneffect_component')
local timeline = require('cartlib/timeline/program')
scenes.register('Room Name', { objects = {} })
trees.register('tree', {})
machines.register('machine', {})
effects.register_effect('effect', {})
progression.compile_program({})
input.factory({ program = {} })
timeline.compile({ duration_frames = 4 })
` });
	t.after(f.dispose);
	assert.equal(f.index.sync(), true);
	const entries = f.index.entriesFor(f.resource('main.lua'));
	assert.deepEqual(new Set(entries.map(entry => entry.kind)), new Set(['scene', 'behavior_tree', 'state_machine', 'action_effect', 'progression', 'input', 'animation']));
	assert.equal(entries.find(entry => entry.kind === 'scene')!.label, 'Room Name');
	assert.ok(entries.every(entry => entry.ownerResource === f.resource('main.lua') && entry.browserResource === entry.ownerResource));
	assert.equal([...f.models.models].length, 0, 'discovery does not retain all workspace models');
	const behavior = entries.find(entry => entry.kind === 'state_machine')!;
	assert.equal(behavior.kind, 'state_machine');
	if (behavior.kind === 'state_machine') assert.equal(behavior.registration, f.registrations.getRegistrations(contextId).find(item => item.behaviorKind === 'state_machine'));
});

test('unchanged refresh returns before semantic queries and retains publication arrays', t => {
	const f = fixture({ 'main.lua': "local fsm=require('cartlib/fsm/library'); fsm.register('one', {})" });
	t.after(f.dispose);
	f.index.sync();
	const entries = f.index.entriesFor(f.resource('main.lua')), revision = f.index.revision;
	const project = getOrCreateSemanticProject(f.models, contextId);
	const snapshot = t.mock.method(project, 'getSnapshot');
	const resources = t.mock.method(f.sources.catalog.resourceByIdentity, Symbol.iterator);
	for (let frame = 0; frame < 1000; frame++) assert.equal(f.index.sync(), false);
	assert.equal(snapshot.mock.callCount(), 0); assert.equal(resources.mock.callCount(), 0);
	assert.equal(f.index.entriesFor(f.resource('main.lua')), entries);
	assert.equal(f.index.revision, revision);
});

test('a newly opened canonical model maps occurrence identity before the next sync', t => {
	const source = "local fsm=require('cartlib/fsm/library'); fsm.register('one', {}); fsm.register('one', {})";
	const f = fixture({ 'main.lua': source, 'other.lua': 'return false' });
	t.after(f.dispose);
	f.index.sync();
	const entries = f.index.entriesFor(f.resource('main.lua')), first = entries[0], second = entries[1];
	const model = f.model('main.lua'), start = second.range.start;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- before both\n' }]);
	assert.equal(second.range.start, start + '-- before both\n'.length);
	assert.equal(f.index.isCurrent(second), true);
	assert.equal(f.index.entriesFor(model.resource)[0], first);
	assert.equal(f.index.entriesFor(model.resource)[1], second);
	model.pushEditOperations([{ offset: first.range.start, deleteLength: 0, text: "fsm.register('one', {}); " }]);
	f.index.sync();
	assert.notEqual(f.index.entriesFor(model.resource)[0], first);
	assert.equal(f.index.entriesFor(model.resource)[1], first);
	assert.equal(f.index.entriesFor(model.resource)[2], second);
	const current = f.index.entriesFor(model.resource);
	f.model('other.lua').pushEditOperations([{ offset: 7, deleteLength: 5, text: 'true' }]);
	assert.equal(f.index.sync(), false, 'an unrelated semantic edit does not republish identical declaration facts');
	assert.equal(f.index.entriesFor(model.resource), current);
});

for (const mode of ['yaml', 'aem'] as const) test(`${mode} editor mode does not change canonical declaration ownership or tracking`, t => {
	const source = "local fsm=require('cartlib/fsm/library'); fsm.register('one', {})";
	const f = fixture({ 'main.lua': source });
	t.after(f.dispose);
	f.index.sync();
	const resource = f.resource('main.lua'), entry = f.index.entriesFor(resource)[0];
	const model = f.models.retain(resource, mode, source);
	const start = entry.range.start, prefix = '-- canonical source\n';
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
	assert.equal(entry.range.start, start + prefix.length, 'markers attach on source identity before the next refresh');
	assert.equal(f.index.isCurrent(entry), true);
	assert.equal(f.index.entriesFor(resource)[0], entry);
	model.pushEditOperations([{ offset: entry.range.start, deleteLength: entry.range.end - entry.range.start, text: '' }]);
	assert.equal(f.index.isCurrent(entry), false);
	assert.deepEqual(f.index.entriesFor(resource), []);
	model.undo(); f.index.sync();
	assert.notEqual(f.index.entriesFor(resource)[0], entry, 'restored source does not revive a retired capability');
});

test('complete replacement and deletion retire occurrences rather than selecting same-position namesakes', t => {
	const source = "local fsm=require('cartlib/fsm/library'); fsm.register('same', {}); fsm.register('same', {})";
	const f = fixture({ 'main.lua': source });
	t.after(f.dispose);
	f.index.sync();
	const first = f.index.entriesFor(f.resource('main.lua'))[0], second = f.index.entriesFor(f.resource('main.lua'))[1];
	const model = f.model('main.lua');
	const written = model.buffer.getTextRange(first.range.start, first.range.end);
	model.pushEditOperations([{ offset: first.range.start, deleteLength: first.range.end - first.range.start, text: written }]);
	assert.equal(f.index.isCurrent(first), false, 'equal replacement bytes do not revive retired occurrence identity');
	assert.notEqual(f.index.entriesFor(model.resource)[0], first);
	assert.equal(f.index.entriesFor(model.resource)[1], second);
	const replacement = f.index.entriesFor(model.resource)[0];
	model.pushEditOperations([{ offset: replacement.range.start, deleteLength: replacement.range.end - replacement.range.start, text: '' }]);
	assert.equal(f.index.isCurrent(replacement), false);
	assert.equal(f.index.entriesFor(model.resource)[0], second);
	model.undo(); f.index.sync();
	assert.equal(f.index.isCurrent(replacement), false, 'Undo restores source, not retired browser selection');
	assert.equal(f.index.entriesFor(model.resource)[1], second);
});

test('provider invalidation revokes unchanged consumers and does not resurrect retired entries on Undo', t => {
	const f = fixture({ 'bridge.lua': "return require('cartlib/fsm/library').register", 'main.lua': "local publish=require('bridge'); publish('machine', {})" });
	t.after(f.dispose);
	f.index.sync();
	const entry = f.index.entriesFor(f.resource('main.lua'))[0];
	const project = getOrCreateSemanticProject(f.models, contextId), file = project.getFileData(f.resource('main.lua'));
	const provider = f.model('bridge.lua');
	provider.pushEditOperations([{ offset: 0, deleteLength: provider.buffer.length, text: 'return replacement' }]);
	assert.equal(f.index.isCurrent(entry), false);
	assert.deepEqual(f.index.entriesFor(f.resource('main.lua')), []);
	assert.equal(project.getFileData(f.resource('main.lua')), file);
	provider.undo(); f.index.sync();
	assert.equal(f.index.entriesFor(f.resource('main.lua')).length, 1);
	assert.notEqual(f.index.entriesFor(f.resource('main.lua'))[0], entry);
});

test('animation keeps actual imported table ownership, consuming context, and separate raw exports', t => {
	const f = fixture({
		'alias.lua': "return require('frames')",
		'frames.lua': "return { frames = {'idle.1'}, frame_run = 2 }",
		'caller.lua': "local sprite=require('cartlib/component/sprite_animation_component'); sprite.factory(require('frames')); sprite.factory(require('frames'))",
		'second.lua': "local sprite=require('cartlib/component/sprite_animation_component'); sprite.factory(require('frames'))",
	});
	t.after(f.dispose);
	f.index.sync();
	assert.deepEqual(f.index.entriesFor(f.resource('alias.lua')), [], 'a reexport is not the authored table owner');
	const raw = f.index.entriesFor(f.resource('frames.lua'));
	const caller = f.index.entriesFor(f.resource('caller.lua'));
	assert.equal(raw.length, 1); assert.equal(caller.length, 1, 'one table/consumer pair per semantic context');
	assert.equal(f.index.entriesFor(f.resource('second.lua')).length, 1);
	assert.equal(caller[0].kind, 'animation');
	if (caller[0].kind !== 'animation' || raw[0].kind !== 'animation') return;
	assert.equal(caller[0].ownerResource, f.resource('frames.lua'));
	assert.equal(caller[0].browserResource, f.resource('caller.lua'));
	assert.ok(resourceIdentityEquals(caller[0].ownerResource, raw[0].ownerResource));
	assert.equal(caller[0].definition.table, raw[0].definition.table);
	assert.equal(raw[0].definition.consumer, undefined);
	assert.equal(caller[0].definition.consumer!.file, getOrCreateSemanticProject(f.models, contextId).getFileData(f.resource('caller.lua'))!.file);
	const frames = f.model('frames.lua'), entry = caller[0];
	frames.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- canonical table\n' }]);
	assert.equal(f.index.isCurrent(entry), true);
	assert.equal(f.index.entriesFor(f.resource('caller.lua'))[0], entry);
});

test('source replacement without canonical change mapping retires unprovable occurrence identities', t => {
	const f = fixture({ 'main.lua': "local fsm=require('cartlib/fsm/library'); fsm.register('one', {})" });
	t.after(f.dispose);
	f.index.sync();
	const entry = f.index.entriesFor(f.resource('main.lua'))[0];
	const project = getOrCreateSemanticProject(f.models, contextId);
	project.updateDocument(f.resource('main.lua'), "local fsm=require('cartlib/fsm/library'); fsm.register('two', {})");
	assert.equal(f.index.isCurrent(entry), false);
	assert.equal(f.index.entriesFor(f.resource('main.lua'))[0].label, 'FSM two');
});

test('a catalog topology publication removes declarations even without a source edit event', t => {
	const f = fixture({ 'main.lua': "local fsm=require('cartlib/fsm/library'); fsm.register('one', {})" });
	t.after(f.dispose);
	f.index.sync();
	const resource = f.resource('main.lua'), entry = f.index.entriesFor(resource)[0];
	const registry = f.sources.catalog.getContext(contextId).luaSources;
	const record = registry.path2lua[resource.path];
	registry.records.splice(registry.records.indexOf(record), 1);
	delete registry.path2lua[record.source_path]; delete registry.module2lua[record.module_path];
	f.sources.catalog.rebuildResources();
	assert.equal(f.index.isCurrent(entry), false);
	assert.deepEqual(f.index.entriesFor(resource), []);
});

test('equal caller paths and a shared imported table retain distinct project-context occurrences', t => {
	const f = fixture({ 'main.lua': "local timeline=require('cartlib/timeline/program'); local sprite=require('cartlib/component/sprite_animation_component'); timeline.compile(require('shared')); sprite.factory(require('shared'))" });
	t.after(f.dispose);
	const system = f.sources.catalog.getContext(TEST_SYSTEM_CONTEXT_ID);
	registerLuaSourceRecord(system.luaSources, createScenarioTestSourceRecord('shared.lua', 1, "return {frames={'one'},frame_run=2}", 'machine/bios/shared.lua'));
	const firstContext = f.sources.catalog.getContext(contextId);
	f.sources.catalog.admitContext({ ...firstContext,
		admission: { id: TEST_CARTRIDGE_CONTEXT_IDS[1], projectRoot: 'carts/second' } });
	f.index.sync();
	const shared = f.sources.catalog.resolveResource({ contextId: TEST_SYSTEM_CONTEXT_ID, path: 'shared.lua' })!;
	const raw = f.index.entriesFor(shared);
	assert.equal(raw.length, 3, 'one raw authored table projection for each discovering semantic context');
	assert.deepEqual(new Set(raw.map(entry => entry.projectContextId)), new Set([TEST_SYSTEM_CONTEXT_ID, ...TEST_CARTRIDGE_CONTEXT_IDS]));
	assert.ok(raw.every(entry => entry.ownerResource === shared && entry.browserResource === shared));
	const first = f.index.entriesFor(f.resource('main.lua'))[0];
	const secondResource = f.sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[1], path: 'main.lua' })!;
	const second = f.index.entriesFor(secondResource)[0];
	assert.equal(first.kind, 'animation'); assert.equal(second.kind, 'animation');
	assert.notEqual(first, second); assert.equal(first.ownerResource, second.ownerResource);
	assert.notEqual(first.browserResource, second.browserResource);
	assert.equal(first.projectContextId, contextId); assert.equal(second.projectContextId, TEST_CARTRIDGE_CONTEXT_IDS[1]);
	const model = resolveLuaTextFileModel(f.models, f.sources.catalog, shared);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- all consumers\n' }]);
	assert.equal(f.index.isCurrent(first), true); assert.equal(f.index.isCurrent(second), true);
	assert.equal(f.index.entriesFor(shared).length, 3);
});

test('model-service clear rebinds current semantic projects and disposal retires subscriptions', t => {
	const f = fixture({ 'main.lua': "local fsm=require('cartlib/fsm/library'); fsm.register('one', {})" });
	t.after(f.dispose);
	f.index.sync();
	const entry = f.index.entriesFor(f.resource('main.lua'))[0];
	const oldProject = getOrCreateSemanticProject(f.models, contextId);
	f.models.clear();
	const disposed = t.mock.method(oldProject, 'getSnapshot', () => { throw new Error('disposed semantic project consumed'); });
	assert.equal(f.index.sync(), true);
	assert.equal(disposed.mock.callCount(), 0);
	assert.notEqual(getOrCreateSemanticProject(f.models, contextId), oldProject);
	assert.equal(f.index.isCurrent(entry), false);
	const current = f.index.entriesFor(f.resource('main.lua'))[0];
	f.index.dispose();
	const span = { ...current.range };
	f.model('main.lua').pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- after disposal\n' }]);
	assert.deepEqual(current.range, span, 'index releases canonical marker tracking');
	assert.equal(f.index.sync(), false); assert.equal(f.index.isCurrent(current), false);
});

for (const reset of ['single', 'all'] as const) test(`${reset} semantic project reset retires warmed entries and rebinds replacement invalidation`, t => {
	const f = fixture({ 'main.lua': "local fsm=require('cartlib/fsm/library'); fsm.register('one', {})" });
	t.after(f.dispose);
	const model = f.model('main.lua');
	f.index.sync();
	const entry = f.index.entriesFor(model.resource)[0], previous = getOrCreateSemanticProject(f.models, contextId);
	if (reset === 'single') resetSemanticProject(f.models, contextId);
	else resetSemanticProjects(f.models);
	const disposedSnapshot = t.mock.method(previous, 'getSnapshot', () => assert.fail('a reset project cannot provide current declarations'));
	assert.equal(f.index.sync(), true);
	assert.equal(f.index.isCurrent(entry), false);
	const current = f.index.entriesFor(model.resource)[0];
	assert.notEqual(current, entry);
	const replacement = getOrCreateSemanticProject(f.models, contextId);
	assert.notEqual(replacement, previous);
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: 'return replacement' }]);
	assert.equal(f.index.isCurrent(current), false, 'source invalidation belongs to the replacement project after reset');
	assert.deepEqual(f.index.entriesFor(model.resource), []);
	assert.equal(disposedSnapshot.mock.callCount(), 0);
	const snapshot = t.mock.method(replacement, 'getSnapshot');
	for (let frame = 0; frame < 1000; frame++) assert.equal(f.index.sync(), false);
	assert.equal(snapshot.mock.callCount(), 0, 'lifecycle rebinding retains constant-time warmed synchronization');
});
