import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { EditorCommandId } from '../../ide/common/commands';
import { NodeGraphLayoutEngine } from '../../ide/node/graph_layout';
import { BehaviorLensEditorPane } from '../../ide/workbench/contrib/behavior_lens/editor_pane';
import { acceptBehaviorGraphSelection } from '../../ide/workbench/contrib/behavior_lens/graph_navigation';
import { acceptStateGraphSelection } from '../../ide/workbench/contrib/behavior_lens/state_graph_navigation';
import { createActualSourcePanes } from '../helpers/source_panes';

const TREE = `local trees = require('cartlib/behaviour_tree/library')
trees.register('tree', { root = { type = 'sequence', children = { { type = 'wait', duration_ticks = 1 } } } })`;
const MACHINE = `local machines = require('cartlib/fsm/library')
machines.register('machine', { initial = 'idle', states = { idle = { on = { next = 'active' } }, active = {} } })`;
const EFFECT = `local effects = require('cartlib/actioneffects')
effects.register_effect('effect', { cooldown_ms = 10 })`;

async function fixture(t: TestContext, source: string) {
	const f = createActualSourcePanes(t, false, [
		['behavior.lua', source], ['cartlib/behaviour_tree/library.lua', 'return {}'],
		['cartlib/fsm/library.lua', 'return {}'], ['cartlib/actioneffects.lua', 'return {}'],
	], () => new NodeGraphLayoutEngine(new Worker(resolve('ide/node/graph_layout_worker.cjs'))));
	f.editor.setFontVariant('tiny');
	const registration = f.editor.behaviorLens.documents.registrations.getRegistrations(f.sources.systemContextId)
		.find(registration => registration.resource.path === 'behavior.lua')!;
	const input = f.editor.behaviorLens.openDefinition(f.firstGroup, registration)!;
	f.update(); await input.graphLayout.settled; f.update();
	const pane = f.firstGroup.panes.activePane;
	assert.ok(pane instanceof BehaviorLensEditorPane);
	pane.focus();
	return { ...f, input, pane };
}

function accept(f: Awaited<ReturnType<typeof fixture>>, command: EditorCommandId): void {
	const menu = f.editor.contextMenu;
	const index = menu.model.rows.findIndex(row => row.command === command);
	assert.ok(index >= 0 && menu.model.rows[index].enabled);
	menu.model.selectedIndex = index; menu.accept(); f.update();
}

for (const kind of ['node', 'edge', 'background'] as const) test(`BT ${kind} native context menu admits its graph camera actions`, async t => {
	const f = await fixture(t, TREE), presentation = f.input.view.presentation;
	assert.ok(presentation.kind === 'graph');
	const viewport = presentation.viewport;
	viewport.selection = kind === 'background' ? null : kind === 'node' ? viewport.model.nodes[0] : viewport.model.edges[0];
	acceptBehaviorGraphSelection(f.input.view, presentation);
	const selected = viewport.selection, model = viewport.model, source = f.input.workingCopy.buffer.getText();
	viewport.setZoom(2); viewport.pan(7, 11);
	f.key('ContextMenu'); assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.editor.contextMenu.model.rows.some(row => row.command === 'graph.frameSelection' && row.enabled), selected !== null);
	accept(f, 'graph.fit');
	assert.equal(viewport.cameraMode, 'fit');
	if (selected !== null) {
		f.key('ContextMenu'); accept(f, 'graph.frameSelection');
		assert.equal(viewport.cameraMode, 'manual');
	}
	assert.equal(viewport.model, model); assert.equal(viewport.selection, selected);
	assert.equal(f.input.workingCopy.buffer.getText(), source);
});

for (const kind of ['state', 'edge', 'entry', 'background'] as const) test(`FSM ${kind} native context menu admits its graph camera actions`, async t => {
	const f = await fixture(t, MACHINE), presentation = f.input.view.presentation;
	assert.ok(presentation.kind === 'state-graph');
	const viewport = presentation.viewport;
	viewport.selection = kind === 'background' ? null : kind === 'state'
		? viewport.model.nodes.find(node => node.role === 'source')! : kind === 'entry'
		? viewport.model.nodes.find(node => node.role === 'entry')! : viewport.model.edges[0];
	assert.equal(viewport.selection === null, kind === 'background');
	acceptStateGraphSelection(f.input.view, presentation);
	const selected = viewport.selection, model = viewport.model;
	viewport.setZoom(2); viewport.pan(7, 11);
	f.key('ContextMenu'); assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.editor.contextMenu.model.rows.some(row => row.command === 'graph.frameSelection' && row.enabled), selected !== null);
	accept(f, 'graph.fit');
	assert.equal(viewport.cameraMode, 'fit');
	if (selected !== null) {
		f.key('ContextMenu'); accept(f, 'graph.frameSelection');
		assert.equal(viewport.cameraMode, 'manual');
	}
	assert.equal(viewport.model, model); assert.equal(viewport.selection, selected);
});

test('a non-graph property background keeps its native editing menu without graph camera actions', async t => {
	const f = await fixture(t, EFFECT), presentation = f.input.view.presentation;
	assert.ok(presentation.kind === 'properties');
	f.input.view.selectionState.select(null); f.update();
	f.key('ContextMenu'); assert.equal(f.editor.contextMenu.visible, true);
	assert.equal(f.editor.contextMenu.model.rows.some(row => row.command === 'graph.fit' || row.command === 'graph.frameSelection'), false);
});
