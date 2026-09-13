import { createBehaviorEditFixture } from '../helpers/behavior_edit_fixture';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { selectStateMachineSource } from '../../ide/workbench/contrib/behavior_lens/state_machine_selection';
import { beginStateMachineDrag, stateMachineConnectionEnds, type StateMachineRetargetDrop } from '../../ide/workbench/contrib/behavior_lens/state_machine_drag';
import { stateMachineRetargetImpacts } from '../../ide/workbench/contrib/behavior_lens/state_machine_review';
import { createWorkbenchGraphEdge, createWorkbenchGraphModel, createWorkbenchGraphNode } from '../../ide/workbench/ui/graph/model';
import type { StateGraphEdge, StateGraphSourceNode } from '../../ide/workbench/contrib/behavior_lens/state_graph_model';
import type { StateMachineSourceOutcome } from '../../ide/workbench/contrib/behavior_lens/state_machine_model';
import { FSM_RETARGET_SOURCE, FSM_RETARGET_IMPORTED_SOURCE, FSM_RETARGET_BRANCH_SOURCE, FSM_RETARGET_CALLBACK_SOURCE } from '../helpers/fsm_retarget_fixture';

/** Independent source proof plus fixed geometry isolates contribution admission from ELK/control tests. */
function fixture(t: TestContext, source = FSM_RETARGET_SOURCE, imports: Readonly<Record<string, string>> = {}) {
	const f = createBehaviorEditFixture(t, 'drag.lua', source, 'state-graph', 0, imports);
	const { view } = f;
	const document = view.document;
	const graph = view.presentation;
	assert.ok(graph.kind === 'state-graph');
	const font = editorViewState.font.renderFont();
	const nodes: StateGraphSourceNode[] = [];
	const bySource = new Map<string, StateGraphSourceNode>();
	for (const scope of view.stateMachines.scopes.values()) {
		const node: StateGraphSourceNode = { ...createWorkbenchGraphNode(font, scope.name ?? 'ROOT', nodes.length * 100, 20),
			role: 'source', source: view.source.nodesByRowKey.get(scope.rowKey)!, children: [] };
		nodes.push(node); bySource.set(scope.rowKey, node);
	}
	const edges: StateGraphEdge[] = [];
	const byOutcome = new Map<StateMachineSourceOutcome, StateGraphEdge>();
	for (const refs of view.stateMachines.references.values()) for (const reference of refs) {
		if (reference.kind !== 'state-outcome' || reference.outcome.target.kind !== 'path') continue;
		const origin = bySource.get(reference.transition.origin.rowKey)!;
		const target = bySource.get(reference.outcome.target.target)!;
		const edge = { ...createWorkbenchGraphEdge([origin.bounds.right, 24, target.bounds.left, 24], [], true),
			link: { source: origin, target, label: '', reference } };
		edges.push(edge); byOutcome.set(reference.outcome, edge);
	}
	graph.viewport.setModel({ ...createWorkbenchGraphModel(font, nodes, edges), nodesBySource: bySource, nodesByEntry: new Map(), edgesByOutcome: byOutcome, edgesByEntry: new Map() }, null);
	graph.viewport.layout(0, 0, 4096, 512);
	const definition = document.definitions[0]; assert.ok(definition.behaviorKind === 'state_machine');
	const branch = definition.scopes[0].children.get('left')!;
	const transition = definition.transitions.find(item => item.origin === branch.children.get('idle')! && item.slot.kind === 'update')!;
	const edge = byOutcome.get(transition.outcomes[1])!;
	graph.viewport.selection = edge;
	view.selection = selectStateMachineSource(edge.link.reference, view.source.models);
	const drops: Parameters<StateMachineRetargetDrop>[] = [];
	const begin = () => beginStateMachineDrag(view, { kind: 'connection', edge, end: 'target' }, (...drop) => drops.push(drop))!;
	const hover = (session: ReturnType<typeof begin>, name: string) => {
		const node = bySource.get(branch.children.get(name)!.rowKey)!;
		session.dragOver(node.bounds.left + 5, node.bounds.top + 3);
		return node;
	};
	return { ...f, graph, definition, transition, edge, begin, hover, drops };
}

test('FSM endpoint capability admits only selected actual path literals, never initial/alias/source ports', t => {
	const f = fixture(t);
	assert.equal(stateMachineConnectionEnds(f.view, f.edge), 'target');
	const alias = f.graph.viewport.model.edges.find(edge => edge.link.reference.kind === 'state-outcome' && edge.link.reference.transition.slot.source.label === 'aliased')!;
	f.graph.viewport.selection = alias;
	assert.equal(stateMachineConnectionEnds(f.view, alias), undefined);
	assert.equal(stateMachineConnectionEnds(f.view, f.edge), undefined, 'a formerly selected edge cannot keep capability');
	const entry = [...f.view.stateMachines.references.values()].flat().find(reference => reference.kind === 'state-entry')!;
	const initialEdge = { ...f.edge, link: { ...f.edge.link, reference: entry } };
	f.graph.viewport.selection = initialEdge;
	assert.equal(stateMachineConnectionEnds(f.view, initialEdge), undefined, 'initial edges are not generic transitions');
	f.graph.viewport.selection = f.edge;
	assert.equal(beginStateMachineDrag(f.view, { kind: 'connection', edge: f.edge, end: 'source' }, () => {}), undefined);
	assert.equal(beginStateMachineDrag(f.view, { kind: 'item', item: f.edge }, () => {}), undefined);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- edit\n' }]);
	assert.equal(stateMachineConnectionEnds(f.view, f.edge), undefined);
});

test('FSM drag publishes exact shared evidence only at drop and retains the candidate during movement', t => {
	const f = fixture(t);
	const session = f.begin();
	f.hover(session, 'active'); assert.equal(session.feedback.accepted, false, 'unchanged target is not a mutation');
	const node = f.hover(session, 'other'); assert.equal(session.feedback.accepted, true);
	assert.equal(f.model.version, 1); assert.equal(f.drops.length, 0);
	// The operation retains one proof result; repeat movement inside the same target must reuse it.
	session.drop(); const first = f.drops[0];
	session.dragOver(node.bounds.left + 7, node.bounds.top + 4); session.drop();
	assert.equal(f.drops[1][1], first[1]);
	assert.equal(first[0].outcome, f.transition.outcomes[1]);
	assert.equal(first[1].text, '../other'); assert.equal(first[1].uses.length, 3);
	const impacts = stateMachineRetargetImpacts(f.view, first[1]);
	assert.equal(impacts.length, 3);
	assert.notEqual(impacts[0].label, impacts[1].label);
	assert.ok(impacts.every(item => item.value.endsWith('other') && item.description.includes('DYNAMIC CALLS ARE NOT ENUMERATED')));
	assert.ok(impacts.every(item => item.description.includes('return drag.lua:') && item.description.includes('RECOGNIZED IN drag.lua')));
	session.dragOver(4095, 500); assert.equal(session.feedback.accepted, false);
	assert.equal(f.model.dirty, false, 'admission and review data never edit source');
});

test('unresolved shared consumers reject drops; source changes and readonly invalidate the whole gesture', t => {
	const incomplete = fixture(t, FSM_RETARGET_SOURCE.replace("machines.register('fixture.two', { initial = 'left', states = { left = branch } })", "machines.register('fixture.two', { initial = 'left', states = { left = { states = { idle = { update = callback }, active = {} } } } })"));
	const session = incomplete.begin(); incomplete.hover(session, 'other');
	assert.equal(session.feedback.accepted, false);
	const changed = fixture(t); const stale = changed.begin();
	changed.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- modified\n' }]);
	assert.equal(stale.isCurrent(), false);
	const f = fixture(t); const gesture = f.begin();
	f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } });
	assert.equal(gesture.isCurrent(), false);
	assert.equal(stateMachineConnectionEnds(f.view, f.edge), undefined);
});

test('imported callback drag admission checks the actual return owner and invalidates on every represented source', t => {
	const imports = { 'branch.lua': FSM_RETARGET_BRANCH_SOURCE, 'callback.lua': FSM_RETARGET_CALLBACK_SOURCE };
	for (const path of ['drag.lua', 'branch.lua', 'callback.lua']) {
		const f = fixture(t, FSM_RETARGET_IMPORTED_SOURCE, imports);
		const owner = f.models.get('callback.lua')!;
		f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } });
		assert.equal(stateMachineConnectionEnds(f.view, f.edge), 'target', 'a read-only anchor is not the write target');
		const session = f.begin(); f.hover(session, 'other');
		assert.equal(session.feedback.accepted, true);
		session.drop(); assert.equal(f.drops[0][1].literal.range.path, owner.resource.path);
		assert.equal(f.drops[0][1].uses.length, 3);
		assert.ok(stateMachineRetargetImpacts(f.view, f.drops[0][1]).every(item => item.description.includes('return callback.lua:')
			&& item.description.includes('RECOGNIZED IN drag.lua')), 'review distinguishes write-file coordinates from registration coverage');
		const affected = f.models.get(path)!;
		affected.refreshResource({ ...affected.resource, source: { ...affected.resource.source, generated: false } });
		affected.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dependency edit\n' }]);
		assert.equal(session.isCurrent(), false, path);
		assert.equal(stateMachineConnectionEnds(f.view, f.edge), undefined, path);
	}
	const f = fixture(t, FSM_RETARGET_IMPORTED_SOURCE, imports);
	const session = f.begin(), owner = f.models.get('callback.lua')!;
	owner.refreshResource({ ...owner.resource, source: { ...owner.resource.source, generated: true } });
	assert.equal(session.isCurrent(), false);
	assert.equal(stateMachineConnectionEnds(f.view, f.edge), undefined);
	assert.equal(f.begin(), undefined, 'a writable anchor does not override a read-only provider');
});
