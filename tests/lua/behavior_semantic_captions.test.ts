import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { uppercaseOutsideStrings } from '../../ide/common/text';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { NodeGraphLayoutEngine } from '../../ide/node/graph_layout';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { collectBehaviorRegistrations } from '../../ide/workbench/contrib/behavior_lens/registrations';
import { findVisibleRowIndex, prepareBehaviorLensLayout, rebuildBehaviorLensRows, selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { selectedBehaviorLensSourceRange, selectBehaviorLensRow } from '../../ide/workbench/contrib/behavior_lens/navigation';
import { buildStateMachineDetails, buildStateMachineSourceDetails } from '../../ide/workbench/contrib/behavior_lens/state_machine_details';
import { buildBehaviorInspection } from '../../ide/workbench/contrib/behavior_lens/inspection';
import { projectBehaviorTreeGraph } from '../../ide/workbench/contrib/behavior_lens/graph_projection';
import { layoutBehaviorTreeGraph } from '../../ide/workbench/contrib/behavior_lens/graph_geometry';
import { acceptBehaviorGraphSelection } from '../../ide/workbench/contrib/behavior_lens/graph_navigation';
import { acceptStateGraphSelection } from '../../ide/workbench/contrib/behavior_lens/state_graph_navigation';
import { layoutStateGraph } from '../../ide/workbench/contrib/behavior_lens/state_graph_projection';
import { stateMachineSourceRange } from '../../ide/workbench/contrib/behavior_lens/state_machine_selection';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { buildLuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { buildResourceLuaSemanticFixtureFile, createResourceModuleProjectFixture } from '../helpers/lua_semantic_project';

function fixture(t: TestContext, literal: string, useIdAliases = false, mixedFsmNames = false) {
	const idle = mixedFsmNames ? 'IdleState' : 'idle', active = mixedFsmNames ? 'ActiveState' : 'active';
	const source = `local trees<const> = require('cartlib/behaviour_tree/library')
local fsm<const> = require('cartlib/fsm/library')
${useIdAliases ? "local tree_id<const> = 'Fixture.Tree'\nlocal fsm_id<const> = 'Fixture.Fsm'\n" : ''}trees.register(${useIdAliases ? 'tree_id' : "'Fixture.Tree'"}, { root = { type = 'sequence',
	services = { { service = ${literal}, interval = policy.delay }, { service = services.scan } },
	decorators = { { type = ${literal}, key = 'KeepCaseKey', value = some.value }, { type = decorators.loop } },
} })
fsm.register(${useIdAliases ? 'fsm_id' : "'Fixture.Fsm'"}, { initial = '${idle}', states = {
	['${idle}'] = { ${mixedFsmNames ? "on = { ['Event.Hit'] = { go = '/ActiveState', emitter = emitters.active }, ['Event.Release'] = function() return '/ActiveState' end }, " : ''}input_event_handlers = {
		{ pattern = ${literal}, go = '/${active}', player_index = players.local_index, emitter = emitters.active },
		{ pattern = patterns.match, go = '/${active}' },
	} },
	['${active}'] = {},
} })`;
	const resource = { contextLabel: 'Fixture project', sourceFilePath: 'captions.lua',
		location: { kind: 'workspace' as const, path: 'captions.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0],
		path: 'captions.lua', source: { resid: 'captions', type: 'lua' as const } };
	const model = new EditorTextModel(resource, 'lua', source);
	const file = buildResourceLuaSemanticFixtureFile(source, resource);
	assert.equal(file.syntaxError, null);
	const snapshot = buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([file],
		['cartlib/behaviour_tree/library', 'cartlib/fsm/library']));
	const document = buildBehaviorSourceDocument(resource, snapshot);
	const view = createBehaviorLensViewState(document, model, 'outline', assert.fail);
	assert.ok(view.presentation.kind === 'outline');
	const outline = view.presentation;
	outline.collapsedRowKeys.clear(); rebuildBehaviorLensRows(view, outline);
	const registrations = collectBehaviorRegistrations(resource, new LuaSourceReader(snapshot)).registrations;
	t.after(() => { view.source.release(); model.dispose(); });
	return { source, model, document, view, outline, registrations };
}

const SPELLINGS = ["'MiXeD.Name'", '"MiXeD.Name"', '"\\x4d\\105XeD.Name"', '[=[MiXeD.Name]=]', '[==[\nMiXeD.Name]==]'];

test('equivalent Lua literal spellings yield decoded behavior captions without changing occurrence or navigation identity', t => {
	const first = fixture(t, SPELLINGS[0]);
	const keys = first.view.source.nodes.map(node => node.rowKey), anchors = first.registrations.map(registration => registration.anchor);
	for (const literal of SPELLINGS) {
		const f = fixture(t, literal);
		const named = f.view.source.nodes.filter(node => (node.kind === 'service' || node.kind === 'decorator' || node.kind === 'event') && node.preserveLabelCase);
		assert.deepEqual(named.map(node => node.kind), ['service', 'decorator', 'event']);
		assert.deepEqual(named.map(node => node.label), ['MiXeD.Name', 'MiXeD.Name', 'MiXeD.Name']);
		assert.deepEqual(f.view.source.nodes.map(node => node.rowKey), keys, 'display spelling cannot become occurrence identity');
		assert.deepEqual(f.registrations.map(registration => registration.anchor), anchors);
		assert.deepEqual(f.registrations.map(registration => registration.semanticId), ['Fixture.Tree', 'Fixture.Fsm']);
		for (const node of named) {
			const written = readLuaSourceRange(f.model.buffer, node.authoredRange);
			assert.ok(written.includes(literal), 'navigation retains the original literal token, not a reconstructed caption');
			selectBehaviorLensRow(f.view, f.outline, findVisibleRowIndex(f.outline, node.rowKey));
			assert.equal(readLuaSourceRange(f.model.buffer, selectedBehaviorLensSourceRange(f.view)!), written);
		}
		assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.dirty, false);
	}
});

for (const [literal, caption] of [["''", ''], ['"O\'Brien`Fx"', "O'Brien`Fx"], ["[=[O'Brien`Fx]=]", "O'Brien`Fx"]] as const) {
	test(`semantic behavior captions preserve their actual ${caption.length === 0 ? 'empty value' : 'internal quote and backtick'} without expression-format bleed`, t => {
		const previous = editorViewState.font;
		editorViewState.font = new EditorFont('tiny'); t.after(() => { editorViewState.font = previous; });
		const f = fixture(t, literal);
		prepareBehaviorLensLayout(f.view, { left: 0, top: 0, right: 1600, bottom: 1000 });
		const named = f.view.source.nodes.filter(node => (node.kind === 'service' || node.kind === 'decorator' || node.kind === 'event') && node.preserveLabelCase);
		assert.deepEqual(named.map(node => node.label), [caption, caption, caption]);
		for (const node of named) {
			const row = f.outline.rows[findVisibleRowIndex(f.outline, node.rowKey)];
			assert.ok(row.text.includes(caption));
			assert.ok(row.text.endsWith(uppercaseOutsideStrings(node.detail)), 'expression details are formatted independently of semantic apostrophes');
		}
		const event = named.find(node => node.kind === 'event')!;
		assert.equal(event.detail, "go='/active' | player=players.local_index | emitter=emitters.active");
		const state = f.view.source.nodes.find(node => node.kind === 'state' && node.label === 'idle')!;
		selectBehaviorLensRow(f.view, f.outline, findVisibleRowIndex(f.outline, state.rowKey));
		const details = buildStateMachineDetails(f.view);
		const binding = details.find(detail => detail.source.kind === 'state-outcome' && detail.source.rowKey === event.rowKey)!;
		const expression = buildStateMachineSourceDetails(f.view.stateMachines.references.get(event.rowKey)!).find(detail => detail.reference === binding.source)!;
		assert.ok(binding.label.includes(caption));
		assert.ok(binding.label.endsWith(uppercaseOutsideStrings(expression.label)), 'a literal-name quote cannot change the following expression caption');
		assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.dirty, false);
	});
}

test('symbolic attachment and input expressions remain source-oriented rather than being reclassified as literal names', t => {
	const f = fixture(t, "'Semantic.Name'");
	for (const expression of ['services.scan', 'decorators.loop', 'patterns.match']) {
		const node = f.view.source.nodes.find(node => node.label === expression)!;
		assert.ok(node !== undefined); assert.notEqual(node.preserveLabelCase, true);
		assert.ok(readLuaSourceRange(f.model.buffer, node.authoredRange).includes(expression));
	}
	assert.equal(f.model.buffer.getText(), f.source);
});

for (const aliases of [false, true]) test(`${aliases ? 'immutable ID aliases' : 'literal IDs'} preserve registration case in the actual definition header and BT root card`, t => {
	const previous = editorViewState.font;
	editorViewState.font = new EditorFont('tiny'); t.after(() => { editorViewState.font = previous; });
	const f = fixture(t, "'Semantic.Name'", aliases);
	assert.deepEqual(f.registrations.map(registration => registration.semanticId), ['Fixture.Tree', 'Fixture.Fsm']);
	assert.deepEqual(f.registrations.map(registration => readLuaSourceRange(f.model.buffer, registration.range)),
		aliases ? ['tree_id', 'fsm_id'] : ["'Fixture.Tree'", "'Fixture.Fsm'"]);
	for (const definition of f.document.definitions) {
		assert.equal(definition.preserveLabelCase, true);
		const registration = f.registrations.find(registration => registration.rowKey === definition.rowKey)!;
		assert.ok(definition.label.endsWith(registration.semanticId!));
		selectBehaviorLensDefinition(f.view, definition.rowKey);
		prepareBehaviorLensLayout(f.view, { left: 0, top: 0, right: 1600, bottom: 1000 });
		assert.equal(f.view.layout.headerText, definition.label);
		if (definition.behaviorKind === 'behavior_tree') {
			const graph = projectBehaviorTreeGraph(definition, new Font({ variant: 'tiny' }));
			assert.equal(graph.nodesBySource.get(definition.rowKey)!.lines[0], definition.label);
		}
	}
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.dirty, false);
});

test('actual FSM nodes, event and input edges, and inspector captions preserve semantic case and exact source outcomes', async t => {
	const previous = editorViewState.font;
	editorViewState.font = new EditorFont('tiny'); t.after(() => { editorViewState.font = previous; });
	const caption = "O'Brien`Fx", f = fixture(t, '"O\'Brien`Fx"', false, true);
	const definition = f.document.definitions.find(definition => definition.behaviorKind === 'state_machine')!;
	assert.ok(definition.behaviorKind === 'state_machine');
	prepareBehaviorLensLayout(f.view, { left: 0, top: 0, right: 1600, bottom: 1000 });
	const idle = f.view.source.nodes.find(node => node.kind === 'state' && node.label === 'IdleState')!;
	const events = ['Event.Hit', 'Event.Release'].map(label => f.view.source.nodes.find(node => node.kind === 'event' && node.label === label)!);
	for (const node of [idle, ...events]) {
		assert.equal(node.preserveLabelCase, true);
		assert.ok(f.outline.rows[findVisibleRowIndex(f.outline, node.rowKey)].text.includes(node.label));
	}
	const engine = new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs')));
	t.after(() => engine.dispose());
	const graph = await layoutStateGraph(definition, f.view.stateMachines.references, new Font({ variant: 'tiny' }), engine);
	assert.equal(graph.nodesBySource.get(definition.rowKey)!.lines[0], definition.label);
	assert.equal(graph.nodesBySource.get(idle.rowKey)!.lines[0], idle.label);
	for (const node of events) {
		const edge = graph.edges.find(edge => edge.link.reference.kind === 'state-outcome' && edge.link.reference.rowKey === node.rowKey)!;
		assert.equal(edge.link.label, node.label);
	}
	const event = f.view.source.nodes.find(node => node.kind === 'event' && node.label === caption)!;
	const edge = graph.edges.find(edge => edge.link.reference.kind === 'state-outcome' && edge.link.reference.rowKey === event.rowKey)!;
	assert.equal(edge.link.label, caption);
	assert.ok(edge.link.reference.kind === 'state-outcome');
	assert.ok(edge.link.reference.transition.slot.source === event);
	assert.equal(readLuaSourceRange(f.model.buffer, stateMachineSourceRange(edge.link.reference)), "'/ActiveState'");
	selectBehaviorLensDefinition(f.view, definition.rowKey);
	assert.ok(f.view.presentation.kind === 'state-graph');
	f.view.presentation.viewport.setModel(graph, graph.nodesBySource.get(idle.rowKey)!);
	acceptStateGraphSelection(f.view, f.view.presentation);
	const inspection = buildBehaviorInspection(f.view);
	for (const node of events) {
		const detail = buildStateMachineDetails(f.view).find(detail => detail.source.kind === 'state-outcome' && detail.source.rowKey === node.rowKey)!;
		assert.ok(detail.label.includes(node.label));
		const inspected = inspection.find(property => property.source?.stateSelection?.kind === 'state-outcome' && property.source.stateSelection.rowKey === node.rowKey)!;
		assert.equal(inspected.label, detail.label, 'the inspector consumes already-composed semantic event captions');
	}
	const property = inspection.find(property => property.source?.stateSelection?.kind === 'state-outcome'
		&& property.source.stateSelection.rowKey === event.rowKey)!;
	const expression = buildStateMachineSourceDetails(f.view.stateMachines.references.get(event.rowKey)!).find(detail => detail.reference === property.source!.stateSelection)!;
	assert.ok(property.label.includes(caption));
	assert.ok(property.label.endsWith(uppercaseOutsideStrings(expression.label)), 'the final inspector does not reformat a case-composed semantic caption');
	assert.equal(readLuaSourceRange(f.model.buffer, property.source!.range), "'/ActiveState'");
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.dirty, false);
});

test('partial BT attachment membership preserves semantic captions through actual graph Details inspection', t => {
	const previous = editorViewState.font;
	editorViewState.font = new EditorFont('tiny'); t.after(() => { editorViewState.font = previous; });
	for (const [members, expression] of [
		['{ type = "MiXeD.Name" }, [computed] = make_decorator()', '[computed]'],
		['{ type = decorators.loop }, [7] = { type = "MiXeD.Name" }', 'decorators.loop'],
	] as const) {
		const source = `local trees<const> = require('cartlib/behaviour_tree/library')
trees.register('Partial.Tree', { root = { type = 'wait', decorators = { ${members} } } })`;
		const resource = { contextLabel: 'Fixture project', sourceFilePath: 'partial.lua',
			location: { kind: 'workspace' as const, path: 'partial.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0],
			path: 'partial.lua', source: { resid: 'partial', type: 'lua' as const } };
		const model = new EditorTextModel(resource, 'lua', source);
		const file = buildResourceLuaSemanticFixtureFile(source, resource);
		const document = buildBehaviorSourceDocument(resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([file],
			['cartlib/behaviour_tree/library'])));
		const view = createBehaviorLensViewState(document, model, 'graph', assert.fail);
		t.after(() => { view.source.release(); model.dispose(); });
		const definition = document.definitions[0];
		assert.ok(definition.behaviorKind === 'behavior_tree' && definition.root?.kind === 'node');
		const attachment = view.source.nodes.find(node => node.kind === 'decorator' && node.label === 'MiXeD.Name')!;
		const graph = layoutBehaviorTreeGraph(projectBehaviorTreeGraph(definition, new Font({ variant: 'tiny' })));
		const card = graph.nodesBySource.get(definition.root.rowKey)!;
		const caption = card.details.find(detail => detail.range === attachment.authoredRange)!;
		assert.equal(caption.label, 'MiXeD.Name'); assert.equal(caption.preserveLabelCase, true);
		assert.equal(readLuaSourceRange(model.buffer, caption.range), '{ type = "MiXeD.Name" }');
		const symbolic = card.details.find(detail => detail.label === expression)!;
		assert.notEqual(symbolic.preserveLabelCase, true, 'source expressions never inherit neighboring literal-name metadata');
		selectBehaviorLensDefinition(view, definition.rowKey);
		assert.ok(view.presentation.kind === 'graph');
		view.presentation.viewport.setModel(graph, card); acceptBehaviorGraphSelection(view, view.presentation);
		const inspection = buildBehaviorInspection(view);
		const named = inspection.find(property => property.source?.range === caption.range)!;
		assert.equal(named.label, `${uppercaseOutsideStrings(caption.detail)} / ${caption.label}`);
		assert.equal(readLuaSourceRange(model.buffer, named.source!.range), '{ type = "MiXeD.Name" }');
		const inspectedExpression = inspection.find(property => property.source?.range === symbolic.range)!;
		assert.ok(inspectedExpression.label.endsWith(uppercaseOutsideStrings(symbolic.label)));
		assert.equal(model.buffer.getText(), source); assert.equal(model.dirty, false);
	}
});
