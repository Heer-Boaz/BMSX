import assert from 'node:assert/strict';
import test, { afterEach, type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { inputFocus } from '../../ide/input/focus';
import type { EditorInput } from '../../ide/workbench/common/editor_inputs';
import { BehaviorLensEditorPane } from '../../ide/workbench/contrib/behavior_lens/editor_pane';
import { acceptEffectPropertySelection } from '../../ide/workbench/contrib/behavior_lens/action_effect_properties';
import { acceptBehaviorGraphSelection } from '../../ide/workbench/contrib/behavior_lens/graph_navigation';
import { indexBehaviorTreeSource } from '../../ide/workbench/contrib/behavior_lens/behavior_tree_index';
import { BehaviorLensNavigationSelection } from '../../ide/workbench/contrib/behavior_lens/navigation_selection';
import { resolveBehaviorSourceBookmark } from '../../ide/workbench/contrib/behavior_lens/source_bookmark';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import { setWorkbenchTreeCollapsed } from '../../ide/workbench/ui/tree_view';
import { LuaTableFieldKind } from '../../toolchain/ts/lua/syntax/ast';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = `local effects=require('cartlib/actioneffects')
local shared = { period_ms = 40, required_tags = { 'alpha', 'beta' } }
effects.register_effect('first', shared)
effects.register_effect('second', shared)
return {}
`;
type Subject = 'selected' | 'definition';
type Placement = 'default' | 'side';

afterEach(() => { editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); });

function fixture(t: TestContext, pinned = true) {
	const f = createActualSourcePanes(t, false, [['effects.lua', SOURCE], ['callbacks.lua', "return { 'external' }"], ['cartlib/actioneffects.lua', 'return {}']]);
	const controller = f.editor.behaviorLens, registrations = controller.documents.registrations.getRegistrations(f.sources.systemContextId);
	const first = registrations.find(item => item.semanticId === 'first')!, second = registrations.find(item => item.semanticId === 'second')!;
	const input = controller.openDefinition(f.firstGroup, first, { pinned })!; f.update();
	const pane = f.firstGroup.panes.activePane!;
	assert.ok(pane instanceof BehaviorLensEditorPane && input.view.presentation.kind === 'properties');
	const properties = input.view.presentation, owner = input.view.selectionState;
	const tags = properties.tree.rows.findIndex(row => row.element.kind === 'property' && row.element.write?.field.kind === LuaTableFieldKind.IdentifierKey
		&& row.element.write.field.name === 'required_tags');
	assert.ok(tags >= 0); setWorkbenchTreeCollapsed(properties.tree, tags, false);
	const select = (tag: boolean) => {
		properties.tree.selectionIndex = properties.tree.rows.findIndex(row => row.element.kind === 'property' && row.element.write !== undefined
			&& (tag ? row.element.write.field.kind === LuaTableFieldKind.Array
				: row.element.write.field.kind === LuaTableFieldKind.IdentifierKey && row.element.write.field.name === 'period_ms'));
		assert.ok(properties.tree.selectionIndex >= 0);
		acceptEffectPropertySelection(input.view, properties, false);
	};
	select(true); pane.focus();
	const target = pane.commandTarget, model = input.workingCopy;
	const requests: Array<Promise<number | undefined> | undefined> = [], open = f.editor.navigation.openSource.bind(f.editor.navigation);
	t.mock.method(f.editor.navigation, 'openSource', (source, options) => { const result = open(source, options); requests.push(result); return result; });
	const invoke = (subject: Subject, placement: Placement, application = false) => {
		if (subject === 'selected' && application) f.editor.commands.execute(placement === 'side' ? 'editor.sourceToSide' : 'editor.source', target);
		else f.editor.navigation.openSource(f.firstGroup, { placement,
			source: subject === 'definition' ? controller.captureSourceLocation(input, subject) : undefined });
		return requests[requests.length - 1];
	};
	const draft = (text: string) => {
		f.editor.commands.execute('behaviorLens.editProperty', target);
		const field = inputFocus.admittedTarget!;
		assert.ok(field !== target && field.edit !== undefined && field.textInput !== undefined);
		assert.equal(field.textInput.replaceText(0, field.textInput.readText().text.length, text), true);
		return field;
	};
	return { ...f, controller, input, pane, properties, owner, model, target, second, select, invoke, draft, requests };
}

for (const subject of ['selected', 'definition'] as const) for (const placement of ['default', 'side'] as const)
	test(`Behavior ${subject} ${placement} Source opens its exact canonical occurrence without source mutation`, async t => {
		const f = fixture(t), version = f.model.version;
		assert.ok(await f.invoke(subject, placement, subject === 'selected') !== undefined);
		const code = f.editor.editorParts.activeGroup.model.activeTab;
		assert.ok(code instanceof CodeEditorInput && code.workingCopy === f.model);
		assert.equal(captureCodeEditorView(code).cursor, SOURCE.indexOf(subject === 'selected' ? "'alpha'" : "effects.register_effect('first'"));
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.version, version); assert.equal(f.model.canUndo, false);
	});

for (const command of ['activate', 'back'] as const) test(`Behavior ${command} navigation supplies the requested semantic Source receipt`, async t => {
	const f = fixture(t);
	assert.equal(f.controller.executeNavigation(f.firstGroup, f.input, command), true);
	assert.ok(await f.requests[0] !== undefined);
	const code = f.editor.editorParts.activeGroup.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === f.model);
	assert.equal(captureCodeEditorView(code).cursor, SOURCE.indexOf(command === 'activate' ? "'alpha'" : "effects.register_effect('first'"));
});

for (const subject of ['selected', 'definition'] as const) for (const placement of ['default', 'side'] as const)
	test(`Behavior ${subject} ${placement} Source retains an accepted whole-value occurrence`, async t => {
		const f = fixture(t), intent = f.owner.selectionRevision, definition = f.owner.definitionRevision;
		const field = f.draft("'accepted much longer tag'");
		let changes = 0; t.after(f.model.onDidChangeContent(() => { changes++; }));
		assert.ok(await f.invoke(subject, placement, subject === 'selected') !== undefined);
		const code = f.editor.editorParts.activeGroup.model.activeTab;
		assert.ok(code instanceof CodeEditorInput && code.workingCopy === f.model);
		const text = SOURCE.replace("'alpha'", "'accepted much longer tag'");
		assert.equal(f.model.buffer.getText(), text); assert.equal(changes, 1); assert.equal(field.edit!.pending, false);
		assert.equal(f.owner.selectionRevision, intent); assert.equal(f.owner.definitionRevision, definition);
		assert.equal(captureCodeEditorView(code).cursor, text.indexOf(subject === 'selected' ? "'accepted much longer tag'" : "effects.register_effect('first'"));
		assert.ok(f.model.undo() !== null); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	});

for (const subject of ['selected', 'definition'] as const) test(`Behavior ${subject} Source vetoes an invalid value draft without focus or topology changes`, async t => {
	const f = fixture(t), field = f.draft('('), generation = f.firstGroup.panes.openGeneration;
	assert.equal(await f.invoke(subject, 'side', subject === 'selected'), undefined);
	assert.equal(inputFocus.admittedTarget, field); assert.equal(field.edit!.pending, true);
	assert.equal(f.firstGroup.model.activeTab, f.input); assert.equal(f.firstGroup.panes.openGeneration, generation);
	assert.equal(f.firstPart.groups.length, 1); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('Behavior source receipt survives mapped source reparse but not A to B to A selection', async t => {
	const f = fixture(t), request = f.controller.captureSourceLocation(f.input), revision = f.owner.selectionRevision;
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- mapped source\n' }]);
	const location = await request.readLocation();
	assert.ok(request.isCurrent!() && location?.selection !== undefined);
	assert.equal(f.owner.selectionRevision, revision);
	assert.equal(location.model.buffer.offsetAt(location.selection.row, location.selection.startColumn), f.model.buffer.getText().indexOf("'alpha'"));
	f.input.updatePresentation(f.input.view.layout.font!.renderFont());
	f.select(false); f.select(true);
	assert.equal(request.isCurrent!(), false); assert.equal(await request.readLocation(), undefined);
});

test('Behavior selected retarget during accepted draft cancels Source before query without revoking definition Source', async t => {
	const f = fixture(t), definition = f.controller.captureSourceLocation(f.input, 'definition');
	f.draft("'accepted much longer tag'");
	const read = t.mock.method(f.controller, 'getSourceLocation');
	const unbind = f.model.onDidChangeContent(() => { unbind(); f.controller.updateView(f.input); f.input.updatePresentation(f.input.view.layout.font!.renderFont()); f.select(false); });
	t.after(unbind);
	assert.equal(await f.invoke('selected', 'side', true), undefined);
	assert.equal(read.mock.callCount(), 0); assert.equal(definition.isCurrent!(), true);
	assert.equal(f.firstPart.groups.length, 1); assert.equal(f.firstGroup.model.activeTab, f.input);
});

test('Behavior typed field continuation cannot consume a newer selection created before source writes', async t => {
	const f = fixture(t), old = f.controller.captureSourceLocation(f.input);
	f.draft("'accepted much longer tag'");
	let newer: ReturnType<typeof f.controller.captureSourceLocation> | undefined;
	const unbind = f.model.onWillChangeContent(() => { unbind(); f.select(false); newer = f.controller.captureSourceLocation(f.input); });
	t.after(unbind);
	assert.equal(await f.invoke('selected', 'side', true), undefined);
	assert.equal(old.isCurrent!(), false); assert.ok(newer !== undefined && newer.isCurrent!());
	const location = await newer.readLocation(); assert.ok(location?.selection !== undefined);
	assert.equal(location.model.buffer.offsetAt(location.selection.row, location.selection.startColumn), f.model.buffer.getText().indexOf('period_ms'));
});

test('Behavior Source rejects callback retargeting during the semantic source query', async t => {
	const f = fixture(t), read = f.controller.getSourceLocation.bind(f.controller);
	t.mock.method(f.controller, 'getSourceLocation', (input, subject) => { f.select(false); return read(input, subject); });
	assert.equal(await f.invoke('selected', 'side', true), undefined);
	assert.equal(f.firstPart.groups.length, 1); assert.equal(f.firstGroup.model.activeTab, f.input); assert.equal(f.model.buffer.getText(), SOURCE);
});

test('Behavior source acquisition cannot overwrite a newer reentrant correspondence and selection', async t => {
	const f = fixture(t), request = f.controller.captureSourceLocation(f.input);
	const tracking = t.mock.method(f.model, 'trackRanges');
	assert.equal(editorTextModelService.get({ contextId: f.sources.systemContextId, path: 'callbacks.lua' }), undefined);
	let admitted = false;
	const unbind = editorTextModelService.onDidAddModel(model => {
		if (model.resource.path !== 'callbacks.lua') return;
		unbind(); admitted = true;
		f.controller.updateView(f.input); f.input.updatePresentation(f.input.view.layout.font!.renderFont()); f.select(false);
	});
	t.after(unbind);
	f.model.pushEditOperations([{ offset: SOURCE.indexOf('period_ms'), deleteLength: 0, text: "blocked_tags = require('callbacks'), " }]);
	const requested = await request.readLocation();
	assert.equal(admitted, true); assert.ok(requested === undefined);
	assert.equal(tracking.mock.callCount(), 1, 'reentrant model admission constructs and tracks this source index only once');
	const location = f.controller.getSourceLocation(f.input); assert.ok(location?.selection !== undefined);
	assert.equal(f.model.buffer.offsetAt(location.selection.row, location.selection.startColumn), f.model.buffer.getText().indexOf('period_ms'));
	const copy = f.input.createView!(); t.after(() => copy.dispose());
	assert.equal(copy.view.source, f.input.view.source, 'reentrant admission retains the shared source-index owner');
});

for (const retire of ['selection', 'reattach', 'dispose'] as const) test(`Behavior Source cannot admit after ${retire} while its real text editor resolves`, async t => {
	const f = fixture(t, retire !== 'dispose'), ready = Promise.withResolvers<EditorInput>();
	const resolve = f.editor.resourceEditors.resolveEditorInput.bind(f.editor.resourceEditors);
	let candidate: CodeEditorInput | undefined;
	t.mock.method(f.editor.resourceEditors, 'resolveEditorInput', (resource, editorId) => {
		const input = resolve(resource, editorId); assert.ok(input instanceof CodeEditorInput); candidate = input; return ready.promise;
	});
	const pending = f.invoke('selected', 'side', true); assert.ok(candidate !== undefined);
	if (retire === 'selection') f.select(false);
	else {
		f.controller.openDefinition(f.firstGroup, f.second, { pinned: retire !== 'dispose', preserveFocus: true });
		if (retire === 'reattach') f.firstGroup.activate(f.input.id);
	}
	ready.resolve(candidate); assert.equal(await pending, undefined);
	const side = f.firstPart.groups.find(group => group !== f.firstGroup)!;
	assert.equal(side.model.activeTab, null); assert.equal(f.pane.inspector.visible, false);
	if (retire === 'dispose') assert.equal(f.owner.available, false);
	assert.equal(f.model.buffer.getText(), SOURCE);
});

for (const key of ['4', 'slot']) for (const role of ['node', 'tree-edge'] as const)
	test(`Behavior ${role} Source distinguishes its written occurrence from ${key === '4' ? 'sparse' : 'unknown'} membership projection`, async t => {
		const source = `local trees=require('cartlib/behaviour_tree/library')
local child = { type = 'wait', duration_ticks = 1 }
trees.register('membership', { root = { type = 'sequence', children = { child } } })
`;
		const f = createActualSourcePanes(t, false, [['tree.lua', source], ['cartlib/behaviour_tree/library.lua', 'return {}']]);
		const controller = f.editor.behaviorLens, registration = controller.documents.registrations.getRegistrations(f.sources.systemContextId)[0];
		const input = controller.openDefinition(f.firstGroup, registration)!; f.update();
		assert.ok(input.view.presentation.kind === 'graph');
		const graph = input.view.presentation, definition = input.view.document.definitions[0];
		assert.ok(definition.behaviorKind === 'behavior_tree' && definition.root?.kind === 'node');
		const branch = definition.root.branches[0]; assert.ok(branch.role === 'children');
		const child = branch.entries[0].node;
		graph.viewport.selection = role === 'node' ? graph.viewport.model.nodesBySource.get(child.rowKey)!
			: graph.viewport.model.edgesBySource.get(child.rowKey)!;
		acceptBehaviorGraphSelection(input.view, graph); f.firstGroup.panes.activePane!.focus();
		const request = controller.captureSourceLocation(input), model = input.workingCopy;
		const offset = source.indexOf('children = { child') + 'children = { child'.length;
		model.pushEditOperations([{ offset, deleteLength: 0, text: `, [${key}] = child` }]);
		f.update();
		assert.equal(graph.viewport.selection, null);
		assert.equal(request.isCurrent!(), role === 'node');
		if (role === 'tree-edge') {
			assert.equal(input.view.selectionState.selected, null);
			assert.equal(await f.editor.navigation.openSource(f.firstGroup, { placement: 'side', source: request }), undefined);
			assert.equal(f.firstPart.groups.length, 1);
		} else {
			const selected = input.view.selectionState.selected!;
			assert.equal(selected.kind, 'node');
			assert.equal(graph.viewport.model.nodesBySource.has(selected.rowKey), false, 'the graph suppresses unknown ordered membership, not written source');
			const location = await request.readLocation(); assert.ok(location?.selection !== undefined);
			const canonical = model.buffer.getText().indexOf('children = { child') + 'children = { '.length;
			assert.equal(model.buffer.offsetAt(location.selection.row, location.selection.startColumn), canonical);
			assert.ok(await f.editor.navigation.openSource(f.firstGroup, { placement: 'side', source: request }) !== undefined);
			const code = f.editor.editorParts.activeGroup.model.activeTab;
			assert.ok(code instanceof CodeEditorInput && code.workingCopy === model);
			assert.equal(captureCodeEditorView(code).cursor, canonical);
		}
	});

for (const key of ['4', 'slot']) test(`Behavior nested local edge Source survives ${key === '4' ? 'sparse' : 'unknown'} ancestor membership`, async t => {
	const source = `local trees=require('cartlib/behaviour_tree/library')
local leaf = { type = 'wait', duration_ticks = 1 }
local branch = { type = 'sequence', children = { leaf } }
trees.register('membership', { root = { type = 'sequence', children = { branch } } })
`;
	const f = createActualSourcePanes(t, false, [['tree.lua', source], ['cartlib/behaviour_tree/library.lua', 'return {}']]);
	const controller = f.editor.behaviorLens, registration = controller.documents.registrations.getRegistrations(f.sources.systemContextId)[0];
	const input = controller.openDefinition(f.firstGroup, registration)!; f.update();
	assert.ok(input.view.presentation.kind === 'graph');
	const graph = input.view.presentation, root = graph.viewport.model.nodes[0].children[0], nested = root.children[0].children[0];
	graph.viewport.selection = graph.viewport.model.edgesBySource.get(nested.source.rowKey)!;
	acceptBehaviorGraphSelection(input.view, graph); f.firstGroup.panes.activePane!.focus();
	const request = controller.captureSourceLocation(input), model = input.workingCopy;
	model.pushEditOperations([{ offset: source.indexOf('children = { branch') + 'children = { branch'.length,
		deleteLength: 0, text: `, [${key}] = branch` }]);
	f.update();
	assert.equal(graph.viewport.selection, null);
	assert.equal(request.isCurrent!(), true);
	const selected = input.view.selectionState.selected!; assert.equal(selected.kind, 'tree-edge');
	assert.equal(graph.viewport.model.edgesBySource.has(selected.rowKey), false);
	const definition = input.view.document.definitions[0]; assert.ok(definition.behaviorKind === 'behavior_tree');
	const proof = indexBehaviorTreeSource(definition);
	assert.equal(proof.edges.has(selected.rowKey), true, 'the particular local parent/child relationship remains authored');
	assert.equal(proof.members.has(selected.rowKey), false, 'unknown ancestor membership still withholds structural authoring admission');
	assert.ok(await f.editor.navigation.openSource(f.firstGroup, { placement: 'side', source: request }) !== undefined);
	const code = f.editor.editorParts.activeGroup.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === model);
	assert.equal(captureCodeEditorView(code).cursor, model.buffer.getText().indexOf('children = { leaf') + 'children = { '.length);
});

test('Behavior membership-field Source survives removal of its diagnostic marker geometry', async t => {
	const source = `local trees=require('cartlib/behaviour_tree/library')
local child = { type = 'wait' }
trees.register('membership', { root = { type = 'sequence', children = { child, [4] = child } } })
`;
	const f = createActualSourcePanes(t, false, [['tree.lua', source], ['cartlib/behaviour_tree/library.lua', 'return {}']]);
	const controller = f.editor.behaviorLens, registration = controller.documents.registrations.getRegistrations(f.sources.systemContextId)[0];
	const input = controller.openDefinition(f.firstGroup, registration)!; f.update();
	assert.ok(input.view.presentation.kind === 'graph');
	const graph = input.view.presentation, definition = input.view.document.definitions[0];
	assert.ok(definition.behaviorKind === 'behavior_tree' && definition.root?.kind === 'node');
	const branch = definition.root.branches[0]; assert.ok(branch.role === 'children');
	graph.viewport.selection = graph.viewport.model.edgesBySource.get(branch.source.rowKey)!;
	assert.ok(graph.viewport.selection !== undefined);
	acceptBehaviorGraphSelection(input.view, graph); f.firstGroup.panes.activePane!.focus();
	const request = controller.captureSourceLocation(input), model = input.workingCopy;
	model.pushEditOperations([{ offset: source.indexOf(', [4] = child'), deleteLength: ', [4] = child'.length, text: '' }]);
	f.update();
	assert.equal(graph.viewport.selection, null); assert.equal(request.isCurrent!(), true);
	const selected = input.view.selectionState.selected!; assert.equal(selected.kind, 'tree-edge');
	assert.equal(graph.viewport.model.edgesBySource.has(selected.rowKey), false);
	const current = input.view.document.definitions[0]; assert.ok(current.behaviorKind === 'behavior_tree');
	const proof = indexBehaviorTreeSource(current);
	assert.equal(proof.edges.has(selected.rowKey), true); assert.equal(proof.members.has(selected.rowKey), false);
	assert.ok(await f.editor.navigation.openSource(f.firstGroup, { placement: 'side', source: request }) !== undefined);
	const code = f.editor.editorParts.activeGroup.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === model);
	assert.equal(captureCodeEditorView(code).cursor, model.buffer.getText().indexOf('children = ') + 'children = '.length);
});

test('Behavior bookmark restoration admits an exact surviving node but cannot restore its unproved child edge', async t => {
	const source = `local trees=require('cartlib/behaviour_tree/library')
local child = { type = 'wait' }
trees.register('membership', { root = { type = 'sequence', children = { child } } })
`;
	const f = createActualSourcePanes(t, false, [['tree.lua', source], ['cartlib/behaviour_tree/library.lua', 'return {}']]);
	const controller = f.editor.behaviorLens, registration = controller.documents.registrations.getRegistrations(f.sources.systemContextId)[0];
	const input = controller.openDefinition(f.firstGroup, registration)!; f.update();
	assert.ok(input.view.presentation.kind === 'graph');
	const graph = input.view.presentation, child = graph.viewport.model.nodes[0].children[0].children[0];
	graph.viewport.selection = graph.viewport.model.edgesBySource.get(child.source.rowKey)!;
	acceptBehaviorGraphSelection(input.view, graph);
	const edge = new BehaviorLensNavigationSelection(input); t.after(() => edge.dispose());
	graph.viewport.selection = child; acceptBehaviorGraphSelection(input.view, graph);
	const node = new BehaviorLensNavigationSelection(input); t.after(() => node.dispose());
	input.workingCopy.pushEditOperations([{ offset: source.indexOf('children = { child') + 'children = { child'.length,
		deleteLength: 0, text: ', [slot] = child' }]);
	f.update();
	assert.ok(resolveBehaviorSourceBookmark(node.snapshot.selected!, input.view) !== undefined);
	assert.equal(resolveBehaviorSourceBookmark(edge.snapshot.selected!, input.view), undefined);
	edge.restore(input); assert.equal(input.view.selectionState.selected, null);
	node.restore(input); assert.equal(input.view.selectionState.selected!.kind, 'node');
	const request = controller.captureSourceLocation(input), location = await request.readLocation();
	assert.ok(location?.selection !== undefined);
	assert.equal(input.workingCopy.buffer.offsetAt(location.selection.row, location.selection.startColumn),
		input.workingCopy.buffer.getText().indexOf('children = { child') + 'children = { '.length);
});
