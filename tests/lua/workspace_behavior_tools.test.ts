import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorTextModelService, editorTextModelService } from '../../ide/editor/model/model_service';
import { BehaviorSourceDocuments } from '../../ide/workbench/contrib/behavior_lens/source_documents';
import { indexStateMachineSource } from '../../ide/workbench/contrib/behavior_lens/state_machine_index';
import { indexBehaviorTreeMembers } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_index';
import { indexActionEffectWrites } from '../../ide/workbench/contrib/behavior_lens/action_effect_index';
import { WorkspaceSourceTools } from '../../ide/workbench/services/assistant/source_tools';
import { ResourceDiagnosticsService } from '../../ide/workbench/services/diagnostics/resource_diagnostics';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { createTestRuntime, createTestRuntimeRomPayload } from '../helpers/runtime_sources';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { BT_ORDER_SOURCE } from '../helpers/behavior_order_fixture';
import { TextFileSaveService } from '../../ide/workbench/services/working_copy/text_file_save';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';

function fixture(t: TestContext, files: Record<string, string>, generated: string[] = []) {
	const records = Object.entries(files).map(([path, source]) => ({ ...createScenarioTestSourceRecord(path, 1, source), generated: generated.includes(path) }));
	const sources = createScenarioTestSourceState(records), models = new EditorTextModelService();
	const documents = new BehaviorSourceDocuments(models, sources), connection = new AbortController();
	const runtime = createTestRuntime(createTestRuntimeRomPayload());
	const tooling = new RuntimeLuaTooling(sources, new SuspendedGuestSession(runtime));
	const diagnostics = new ResourceDiagnosticsService(models, tooling, new VirtualHeadlessClock());
	const storage = { getItem: () => null, setItem: () => assert.fail('not Save'), removeItem: () => assert.fail('not Delete') };
	const { tasks, presenter } = createRuntimeInspectionFixture(runtime, sources, tooling.suspendedGuest);
	const saves = new TextFileSaveService(models, storage, new VirtualHeadlessClock(), sources, tooling, runtime, tasks);
	t.after(async () => { await saves.shutdown(); presenter.dispose(); });
	const tools = () => {
		const result = new WorkspaceSourceTools(models, sources, storage, diagnostics, connection.signal, documents, saves);
		t.after(() => result.dispose()); return result;
	};
	t.after(() => { connection.abort(); diagnostics.dispose(); models.clear(); });
	return { models, sources, documents, runtime, connection, tools };
}

async function list(tools: WorkspaceSourceTools) {
	const result = await tools.execute('studio_list_behaviors', {});
	assert.ok(result.kind === 'behaviors'); return result.data;
}
async function read(tools: WorkspaceSourceTools, behavior: string) {
	const result = await tools.execute('studio_read_behavior', { behavior });
	assert.ok(result.kind === 'behavior'); return result.data;
}

test('semantic tools use the supplied unsaved workspace and shared generation without panes, parsing repeats or AST transport', async t => {
	const source = `local fsm<const> = require('cartlib/fsm/library')
fsm.register('one', {initial='idle',states={idle={},active={}}})
fsm.register('one', {states={other={}}})
fsm.register(unknown_id(), make_definition())`;
	const f = fixture(t, { 'cart.lua': source });
	const model = f.models.retain(f.sources.luaResources[0], 'lua', source);
	model.pushEditOperations([{ offset: source.indexOf("'one'"), deleteLength: 5, text: "'dirty'" }]);
	const tools = f.tools(), catalog = await list(tools);
	assert.deepEqual(catalog.map(item => item.semanticId), ['dirty', 'one', null]);
	assert.equal(new Set(catalog.map(item => item.behavior)).size, 3);
	assert.deepEqual(Object.keys(catalog[0].resource).sort(), ['domain', 'path']);
	assert.equal(editorTextModelService.get(model.identity), undefined);
	const data = await read(tools, catalog[0].behavior), document = f.documents.get(model);
	assert.equal(data.syntaxComplete, true);
	assert.deepEqual(data.sources, [{ domain: 0, path: 'cart.lua', version: model.version, readOnly: false }]);
	assert.equal(data.nodes[0].label, document.definitions[0].label);
	assert.equal(data.nodes.filter(node => node.actions.includes('fsm.set_initial')).length, 1);
	assert.equal(data.entries[0].target.kind, 'state');
	const parser = t.mock.method(LuaParser.prototype, 'parseChunkWithRecovery');
	for (let i = 0; i < 20; i++) {
		assert.equal(await list(tools), catalog); assert.equal(await read(tools, catalog[0].behavior), data);
		assert.equal(f.documents.get(model), document);
	}
	assert.equal(parser.mock.callCount(), 0);
	assert.equal(model.lastSavedSource, source); assert.equal(model.dirty, true);
	assert.equal(JSON.stringify(data).includes('callSite'), false);
	const dynamic = await read(tools, catalog[2].behavior);
	assert.ok(dynamic.nodes.some(node => node.resolution === 'unresolved'));
	assert.ok(dynamic.nodes.every(node => node.actions.length === 0));
});

test('FSM proposal edits the imported actual parent, keeps shared occurrences, source proof and one ordinary Undo', async t => {
	const source = `local fsm<const> = require('cartlib/fsm/library')
local body<const> = require('body')
fsm.register('shared',body)
fsm.register('shared',body)`;
	const body = `-- 🐉 exact imported definition\r\nreturn {initial = ( --[[intent]] 'idle'), states = {
idle={on={go='../active'}}, active={update=function() return '../idle' end}
}}`;
	const f = fixture(t, { 'cart.lua': source, 'body.lua': body }), tools = f.tools();
	const documents = t.mock.method(f.documents, 'get');
	const catalog = await list(tools), data = await read(tools, catalog[1].behavior);
	const state = data.nodes.find(node => node.kind === 'state' && node.actions.includes('fsm.set_initial'))!;
	assert.equal(state.authoredRange.path, 'body.lua');
	assert.equal(data.transitions.length, 2);
	for (const transition of data.transitions) {
		assert.ok(data.nodes.some(node => node.node === transition.origin));
		assert.ok(data.nodes.some(node => node.node === transition.node));
		for (const outcome of transition.outcomes) {
			assert.equal(outcome.target.kind, 'path');
			const target = outcome.target;
			if (target.kind === 'path') assert.ok(data.nodes.some(node => node.node === target.target));
			assert.equal(outcome.range.path, 'body.lua');
		}
	}
	const main = f.models.get({ domain: 0, path: 'cart.lua' })!, owner = f.models.get({ domain: 0, path: 'body.lua' })!;
	assert.equal(f.documents.get(main), documents.mock.calls[0].result, 'retaining imported models preserves the shared semantic generation');
	const result = await tools.execute('studio_propose_fsm_initial', { state: state.node });
	assert.ok(result.kind === 'proposal'); t.after(() => result.proposal.dispose());
	assert.equal(result.proposal.files[0].model, owner); assert.equal(owner.buffer.getText(), body);
	tools.dispose(); result.proposal.apply();
	assert.equal(owner.buffer.getText(), body.replace("'idle'),", "'active'),"));
	assert.equal(main.buffer.getText(), source); assert.equal(main.dirty, false); assert.equal(owner.lastSavedSource, body);
	const changed = f.documents.get(main);
	assert.equal([...indexStateMachineSource(changed).initialTargets.values()].filter(target => target.name === 'idle').length, 2);
	owner.undo(); assert.equal(owner.buffer.getText(), body); assert.equal(owner.canUndo, false);
	owner.redo(); assert.equal(owner.buffer.getText(), body.replace("'idle'),", "'active'),"));
	await assert.rejects(tools.execute('studio_read_behavior', { behavior: catalog[0].behavior }), /proposed/);
});

test('missing FSM initial is inserted from proven membership, while unknown, generated and recovered sources never gain write rights', async t => {
	const register = (body: string) => `local fsm<const> = require('cartlib/fsm/library'); fsm.register('fixture',${body})`;
	const f = fixture(t, { 'cart.lua': register('{states={a={}, b={}}}') }), tools = f.tools();
	const data = await read(tools, (await list(tools))[0].behavior), node = data.nodes.find(node => node.kind === 'state')!;
	const result = await tools.execute('studio_propose_fsm_initial', { state: node.node }); assert.ok(result.kind === 'proposal');
	result.proposal.apply(); assert.match(f.models.get({ domain: 0, path: 'cart.lua' })!.buffer.getText(), /initial = 'a'/);
	for (const source of [register('{initial=choose(),states={a={}}}'), register('{states={[key]={},a={}}}'), register('{states={a={}}}') + '\nlocal broken =']) {
		const g = fixture(t, { 'cart.lua': source }), next = g.tools();
		assert.ok((await read(next, (await list(next))[0].behavior)).nodes.every(node => node.actions.length === 0));
	}
	const generated = fixture(t, { 'cart.lua': register('{states={a={}}}') }, ['cart.lua']), next = generated.tools();
	const generatedData = await read(next, (await list(next))[0].behavior);
	assert.equal(generatedData.sources[0].readOnly, true);
	assert.ok(generatedData.nodes.every(node => node.actions.length === 0));
});

for (const operation of ['remove', 'duplicate', 'move_up', 'move_down'] as const) test(`BT ${operation} uses the graph's exact indexed source member and keeps ordinary history`, async t => {
	const f = fixture(t, { 'tree.lua': BT_ORDER_SOURCE }), tools = f.tools();
	const data = await read(tools, (await list(tools))[0].behavior);
	const line = BT_ORDER_SOURCE.slice(0, BT_ORDER_SOURCE.indexOf('nested;')).split('\n').length;
	const node = data.nodes.find(node => node.actions.includes(`bt.${operation}`) && node.occurrenceRange.start.line === line)!;
	assert.ok(node);
	const model = f.models.get({ domain: 0, path: 'tree.lua' })!, document = f.documents.get(model), definition = document.definitions[0];
	assert.ok(definition.behaviorKind === 'behavior_tree');
	const members = indexBehaviorTreeMembers(definition);
	assert.equal(indexBehaviorTreeMembers(definition), members);
	const result = await tools.execute('studio_propose_bt_child_edit', { child: node.node, operation });
	assert.ok(result.kind === 'proposal');
	assert.equal(model.buffer.getText(), BT_ORDER_SOURCE); result.proposal.apply();
	assert.notEqual(model.buffer.getText(), BT_ORDER_SOURCE);
	assert.ok(model.buffer.getText().includes('local leaf'));
	assert.equal(f.documents.get(model).syntaxComplete, true);
	model.undo(); assert.equal(model.buffer.getText(), BT_ORDER_SOURCE); assert.equal(model.canUndo, false);
	model.redo(); assert.notEqual(model.buffer.getText(), BT_ORDER_SOURCE);
});

test('ActionEffect expression edit replaces the written field, not its initializer, and uses the ordinary parser boundary', async t => {
	const source = `local effects<const> = require('cartlib/actioneffects')
local duration<const> = 10
effects.register_effect('fx', {cooldown_ms=(--[[keep]] duration), required_tags={'live'}, handler=invoke})`;
	const f = fixture(t, { 'effect.lua': source }), tools = f.tools();
	const data = await read(tools, (await list(tools))[0].behavior);
	const property = data.nodes.find(node => node.write?.expression.includes('duration'))!;
	assert.ok(property.actions.includes('effect.set_value'));
	const model = f.models.get({ domain: 0, path: 'effect.lua' })!, definition = f.documents.get(model).definitions[0];
	assert.ok(definition.behaviorKind === 'action_effect');
	const writes = indexActionEffectWrites(definition);
	assert.equal(writes, indexActionEffectWrites(definition));
	for (const expression of ['1; hacked()', '2 -- swallow comma', '', 'function(']) {
		await assert.rejects(tools.execute('studio_propose_effect_value', { property: property.node, expression }));
		assert.equal(model.buffer.getText(), source); assert.equal(model.canUndo, false);
	}
	const write = [...writes.values()].find(write => readLuaSourceRange(model.buffer, write.file.chunk.locations.range(write.field.value.span)).includes('duration'))!;
	const result = await tools.execute('studio_propose_effect_value', { property: property.node, expression: '-7.5' });
	assert.ok(result.kind === 'proposal'); result.proposal.apply();
	assert.ok(model.buffer.getText().includes('local duration<const> = 10'));
	assert.equal(model.buffer.getText(), source.replace('duration), required', '-7.5), required'));
	assert.equal(write.file.file, 'effect.lua');
	model.undo(); assert.equal(model.buffer.getText(), source);
});

test('foreign, unadmitted and expired semantic references cannot be refreshed or mutate the working copy', async t => {
	const f = fixture(t, { 'cart.lua': "local fsm<const> = require('cartlib/fsm/library'); fsm.register('f',{states={a={},b={}}})", 'other.lua': 'return 1' });
	const tools = f.tools(), catalog = await list(tools), data = await read(tools, catalog[0].behavior), other = f.tools();
	const node = data.nodes.find(node => node.actions.includes('fsm.set_initial'))!;
	await assert.rejects(other.execute('studio_read_behavior', { behavior: catalog[0].behavior }), /does not belong/);
	await assert.rejects(other.execute('studio_propose_fsm_initial', { state: node.node }), /does not belong/);
	await assert.rejects(tools.execute('studio_propose_fsm_initial', { state: data.root }), /does not admit/);
	await assert.rejects(tools.execute('studio_propose_bt_child_edit', { child: node.node, operation: 'remove' }), /does not admit/);
	await assert.rejects(tools.execute('studio_propose_bt_child_edit', { child: node.node, operation: 'execute' }), /listed operation/);
	await assert.rejects(tools.execute('studio_read_behavior', { behavior: catalog[0].behavior, surprise: true }));
	const resource = f.sources.luaResources.find(resource => resource.path === 'other.lua')!, dependency = f.models.retain(resource, 'lua', 'return 1');
	dependency.pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]);
	await assert.rejects(tools.execute('studio_propose_fsm_initial', { state: node.node }), /Source changed/);
	dependency.undo();
	await assert.rejects(tools.execute('studio_read_behavior', { behavior: catalog[0].behavior }), /Source changed/);
	assert.equal(f.models.get({ domain: 0, path: 'cart.lua' })!.canUndo, false);
});

test('semantic proposals share disconnect and dependency-change retirement with textual reviews', async t => {
	for (const disconnect of [true, false]) {
		const f = fixture(t, { 'cart.lua': "local fsm<const> = require('cartlib/fsm/library'); fsm.register('f',{states={a={}}})", 'other.lua': 'return 1' });
		const tools = f.tools(), data = await read(tools, (await list(tools))[0].behavior);
		const result = await tools.execute('studio_propose_fsm_initial', { state: data.nodes.find(node => node.actions.length !== 0)!.node });
		assert.ok(result.kind === 'proposal');
		if (disconnect) f.connection.abort();
		else f.models.retain(f.sources.luaResources.find(resource => resource.path === 'other.lua')!, 'lua', 'return 1').pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]);
		assert.equal(result.proposal.state, 'stale'); assert.throws(() => result.proposal.apply(), /stale/);
		assert.equal(f.models.get({ domain: 0, path: 'cart.lua' })!.canUndo, false);
	}
});
