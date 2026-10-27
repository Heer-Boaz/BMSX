import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { ResourceIdentity } from '../../ide/common/resource';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorTextSelection } from '../../ide/editor/navigation/text_selection';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { InputInteraction } from '../../ide/input/interaction';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { RuntimeTransport } from '../../ide/runtime/transport';
import { BehaviorLensController } from '../../ide/workbench/contrib/behavior_lens/controller';
import { BehaviorLensEditorPane } from '../../ide/workbench/contrib/behavior_lens/editor_pane';
import { acceptEffectPropertySelection } from '../../ide/workbench/contrib/behavior_lens/action_effect_properties';
import { acceptBehaviorGraphSelection } from '../../ide/workbench/contrib/behavior_lens/graph_navigation';
import { selectBehaviorLensDefinition } from '../../ide/workbench/contrib/behavior_lens/layout';
import { selectedBehaviorLensSourceRange } from '../../ide/workbench/contrib/behavior_lens/navigation';
import { BehaviorLensNavigationSelection } from '../../ide/workbench/contrib/behavior_lens/navigation_selection';
import { BehaviorSourceDocuments } from '../../ide/workbench/contrib/behavior_lens/source_documents';
import { EditorNavigationController } from '../../ide/workbench/contrib/resources/navigation';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { createTestGroupPresentation } from '../helpers/editor_panes';
import { EditorGroupView } from '../../ide/workbench/services/editor/editor_group';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';
import { WorkbenchActionBarControl } from '../../ide/workbench/ui/action_bar_control';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { createTestRuntime, createTestRuntimeRomPayload, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';

const SOURCE = `local trees<const> = require('cartlib/behaviour_tree/library')
trees.register('explicit.tree', { root = { type = 'sequence', children = {
	{ type = 'wait', duration_ticks = 1 },
	{ type = 'wait', duration_ticks = 2 },
} } })
`;
const BOUNDS = { left: 0, top: 24, right: 384, bottom: 276 };

function fixture(t: TestContext, source = SOURCE) {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('trees.lua', 1, source),
		createScenarioTestSourceRecord('cartlib/behaviour_tree/library.lua', 1, ''),
		createScenarioTestSourceRecord('cartlib/actioneffects.lua', 1, ''),
	]);
	const menu = new ContextMenuController(inputFocus, pointerCapture), picker = new QuickInputController(menu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: { left: 0, top: 0, right: editorViewState.viewportWidth, bottom: editorViewState.viewportHeight }, kind: 'workspace' });
	const surfaces = new WorkbenchSurfaceService();
	const navigation = new EditorNavigationController(sources.catalog, null!, null!);
	const documents = new BehaviorSourceDocuments(editorTextModelService, sources.catalog);
	const controller = new BehaviorLensController(sources, navigation, documents,
		() => assert.fail('Behavior-tree views do not create an FSM layout worker'), null!, null!, null!);
	const unused = (): never => assert.fail('This owner regression only opens Behavior Lens views');
	const createGroup = () => {
		const group = new EditorGroupView({
			home: unused, play_session: unused, animation: unused, host_error: unused, build_log: unused,
			rom_inspector: unused, event_viewer: unused, gpu_debugger: unused, gte_debugger: unused,
			terminal: unused, conversation_observer: unused, assistant: unused, workspace_edit_review: unused,
			code_editor: unused, resource_view: unused, aem_editor: unused, lua_program: unused, actor_lab: unused,
			game_view: unused, cart_map: unused, scene_editor: unused, scenario_lab: unused,
			behavior_lens: owner => {

				return new BehaviorLensEditorPane(controller, null!, menu, surfaces, owner.paneSurface, owner.workArea, owner, owner.focusScope, picker);
			},
		}, { isEnabled: () => false, execute() {} }, unused, createTestGroupPresentation(surfaces, BOUNDS));
		group.panes.layout(BOUNDS);
		return group;
	};
	const first = createGroup(), second = createGroup();
	const registration = documents.registrations.getRegistrations(TEST_CARTRIDGE_CONTEXT_IDS[0])[0];
	assert.ok(registration);
	t.after(() => {
		picker.dispose(); menu.dispose(); first.dispose(); second.dispose(); surfaces.dispose();
		editorTextModelService.clear(); resetSemanticProjects(editorTextModelService); inputFocus.setTarget(null);
	});
	return { controller, documents, navigation, picker, first, second, registration };
}

test('shared Behavior Lens operations and pane commands consume their concrete view, not the later active group', t => {
	const f = fixture(t);
	const first = f.controller.openDefinition(f.first, f.registration);
	const second = f.controller.openDefinition(f.second, f.registration);
	assert.notEqual(first, second);
	assert.equal(first.workingCopy, second.workingCopy);
	assert.equal(first.view.document, second.view.document, 'topology remains shared by its source generation');
	assert.equal(f.controller.openDefinition(f.first, f.registration), first, 'matching is local to the destination group');
	f.controller.updateView(first); f.controller.updateView(second);
	assert.ok(first.view.presentation.kind === 'graph');
	first.view.presentation.viewport.selection = first.view.presentation.viewport.model.nodes[0].children[0].children[0];
	acceptBehaviorGraphSelection(first.view, first.view.presentation);
	assert.equal(f.controller.canEditSelectedChild(first), true);
	assert.equal(f.controller.canEditSelectedChild(second), false, 'the sibling still selects its definition root');
	const siblingSelection = second.view.selection;
	f.first.panes.activePane!.focus();
	const firstTarget = inputFocus.target!;
	f.second.panes.activePane!.focus();
	const secondTarget = inputFocus.target!;
	const source = selectedBehaviorLensSourceRange(first.view)!;
	const opened: { group: EditorGroupView; resource: ResourceIdentity; selection: EditorTextSelection | undefined }[] = [];
	t.mock.method(f.navigation, 'focusChunkSource', (group, resource, selection) => {
		opened.push({ group, resource, selection });
		return Promise.resolve(1);
	});
	firstTarget.getCommand('behaviorLens.source')!.run();
	assert.deepEqual(opened, [{ group: f.first, resource: first.workingCopy.resource,
		selection: { row: source.start.line - 1, startColumn: source.start.column - 1, endColumn: source.start.column - 1 } }]);
	assert.equal(inputFocus.target, secondTarget, 'the shared Source operation does not focus another pane itself');
	const remove = firstTarget.getCommand('behaviorLens.removeChild')!;
	assert.equal(remove.isEnabled(), true);
	assert.equal(firstTarget.commandContext.getCommand('behaviorLens.removeChild'), undefined,
		'graph editing is not a keyboard capability of its pane chrome');
	assert.equal(secondTarget.getCommand('behaviorLens.removeChild')!.isEnabled(), false);
	remove.run();
	assert.equal(inputFocus.target, firstTarget, 'the invoking pane owns focus for its mutation');
	f.controller.updateView(second);
	assert.equal(first.view.selection, null, 'removed source does not adopt its former neighbour');
	assert.deepEqual(second.view.selection, siblingSelection);
	assert.equal(first.workingCopy.dirty, true);
	assert.equal(first.workingCopy.canUndo, true);
	assert.equal(first.workingCopy.buffer.getText().includes('duration_ticks = 1'), false);
	assert.equal(first.workingCopy.buffer.getText().includes('duration_ticks = 2'), true);
	second.workingCopy.undo();
	assert.equal(first.workingCopy.buffer.getText(), SOURCE, 'both views retain the canonical document history');
});

for (const command of ['behaviorLens.removeChild', 'behaviorLens.inspectRuntimeTree'] as const) test(`${command} cannot act on a reusable pane replacement installed by focus`, t => {
	const f = fixture(t);
	const first = f.controller.openDefinition(f.first, f.registration);
	f.controller.openDefinition(f.second, f.registration);
	assert.ok(first.view.presentation.kind === 'graph');
	first.view.presentation.viewport.selection = first.view.presentation.viewport.model.nodes[0].children[0].children[0];
	acceptBehaviorGraphSelection(first.view, first.view.presentation);
	const replacement = f.controller.createInput(first.workingCopy, 'graph');
	selectBehaviorLensDefinition(replacement.view, replacement.view.document.definitions[0].rowKey);
	f.first.panes.activePane!.focus();
	const pane = f.first.panes.activePane, target = inputFocus.target!;
	const action = target.getCommand(command)!;
	assert.equal(action.isEnabled(), true);
	f.second.panes.activePane!.focus();
	const unbind = target.onDidFocus(() => {
		unbind();
		f.first.openEditor(replacement);
		assert.ok(replacement.view.presentation.kind === 'graph');
		replacement.view.presentation.viewport.selection = replacement.view.presentation.viewport.model.nodes[0].children[0].children[1];
		acceptBehaviorGraphSelection(replacement.view, replacement.view.presentation);
	});
	t.after(unbind);
	const inspections = t.mock.method(f.controller, 'inspectRuntimeTree', () => {});
	const version = first.workingCopy.version;
	action.run();
	assert.equal(f.first.panes.activePane, pane, 'the same concrete pane was rebound');
	assert.equal(pane!.input, replacement);
	assert.equal(first.workingCopy.version, version);
	assert.equal(first.workingCopy.buffer.getText(), SOURCE);
	assert.equal(inspections.mock.callCount(), 0, 'replacement focus does not authorize runtime inspection either');
});

test('the shared Behavior picker retains its requested group when focus returns elsewhere at acceptance', t => {
	const f = fixture(t), sibling = f.controller.openDefinition(f.second, f.registration);
	f.controller.open(f.first, f.picker, 'behavior_tree');
	assert.equal(f.picker.visible, true);
	t.after(f.picker.field.focusTarget.onDidBlur(() => f.second.panes.activePane!.focus()));
	f.picker.accept();
	assert.ok(f.first.model.activeTab?.kind === 'behavior_lens');
	assert.notEqual(f.first.model.activeTab, sibling);
	assert.equal(f.first.model.activeTab.workingCopy, sibling.workingCopy);
	assert.equal(f.second.model.activeTab, sibling);
});

test('Behavior picker destination retirement does not couple unrelated sibling groups', t => {
	const f = fixture(t);
	f.controller.openDefinition(f.first, f.registration);
	f.controller.openDefinition(f.second, f.registration);
	f.first.panes.activePane!.focus();
	f.controller.open(f.first, f.picker, 'behavior_tree');
	f.second.dispose();
	assert.equal(f.picker.visible, true, 'a sibling group cannot revoke this picker');
	f.first.dispose();
	assert.equal(f.picker.visible, false);
	assert.equal(f.first.model.tabs.length, 0);
});

test('Behavior picker also retires with its invoking group when that differs from the destination', t => {
	const f = fixture(t);
	f.controller.openDefinition(f.second, f.registration);
	f.controller.open(f.first, f.picker, 'behavior_tree');
	assert.equal(f.picker.visible, true);
	f.second.dispose();
	assert.equal(f.picker.visible, false, 'destination admission does not replace the invoking attachment lifetime');
	assert.equal(f.first.model.tabs.length, 0);
});

test('Behavior destination retirement during invoking-control blur cancels before picker preparation', t => {
	const f = fixture(t);
	f.controller.openDefinition(f.first, f.registration);
	const origin = inputFocus.target!;
	t.after(origin.onDidBlur(next => { if (next === f.picker.field.focusTarget) f.first.dispose(); }));
	f.controller.open(f.first, f.picker, 'behavior_tree');
	assert.equal(f.picker.visible, false);
	assert.equal(f.first.model.tabs.length, 0);
});

test('Behavior layout consumes each group client rectangle and shared refresh or navigation cannot replace it', t => {
	const f = fixture(t);
	const first = f.controller.openDefinition(f.first, f.registration);
	const second = f.controller.openDefinition(f.second, f.registration);
	const firstBounds = { left: 10, top: 30, right: 190, bottom: 250 };
	const secondBounds = { left: 200, top: 50, right: 380, bottom: 270 };
	f.first.panes.layout(firstBounds); f.second.panes.layout(secondBounds);
	f.controller.updateView(first); f.controller.updateView(second);
	f.controller.executeNavigation(f.first, first, 'down');
	// Exact rectangles are the layout-owner contract, not a visual-position assertion.
	for (const [input, bounds] of [[first, firstBounds], [second, secondBounds]] as const) {
		const layout = input.view.layout;
		assert.deepEqual({ left: layout.left, top: layout.top, right: layout.right, bottom: layout.bottom }, bounds);
	}
});

test('Behavior presentation acknowledges a source generation consumed by its controller once, while navigation restore retains its viewport', t => {
	const f = fixture(t), input = f.controller.openDefinition(f.first, f.registration);
	const pane = f.first.panes.activePane!;
	assert.ok(input.view.presentation.kind === 'graph');
	const graph = input.view.presentation, viewport = graph.viewport;
	viewport.selection = viewport.model.nodes[0].children[0].children[0];
	acceptBehaviorGraphSelection(input.view, graph);
	const revealed = t.mock.method(viewport, 'reveal');
	// This fixture exercises the pane's source/presentation update, not command-bar availability.
	t.mock.method(WorkbenchActionBarControl.prototype, 'update', () => {});
	const previous = input.view.source;
	input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- controller consumed this edit\n' }]);
	f.controller.updateView(input);
	assert.notEqual(input.view.source, previous);
	assert.equal(input.view.source.isCurrent, true);
	assert.equal(revealed.mock.callCount(), 0, 'semantic refresh does not arrange or reveal a view');
	pane.update(0);
	assert.equal(revealed.mock.callCount(), 1, 'the actual presentation completes the newly consumed generation');
	pane.update(0); pane.update(0);
	assert.equal(revealed.mock.callCount(), 1, 'stationary frames do not keep revealing the selection');
	viewport.scrollX = 47; viewport.scrollY = 29;
	const selection = new BehaviorLensNavigationSelection(input);
	t.after(() => selection.dispose());
	input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- navigation generation\n' }]);
	f.controller.updateView(input);
	pane.setOptions(undefined, selection);
	pane.update(0);
	assert.equal(revealed.mock.callCount(), 1, 'explicit navigation acknowledges its source without an automatic reveal');
	assert.equal(viewport.scrollX, 47);
	assert.equal(viewport.scrollY, 29);
});

test('effect property presentation reveals a refreshed selection once even when semantic refresh preceded its frame', t => {
	const source = `local effects<const> = require('cartlib/actioneffects')
effects.register_effect('explicit.effect', {
	required_tags = { ${Array.from({ length: 40 }, (_, index) => `'tag_${index}'`).join(', ')} },
	cooldown_ms = 10,
})
`;
	const f = fixture(t, source), input = f.controller.openDefinition(f.first, f.registration);
	const pane = f.first.panes.activePane!;
	assert.ok(input.view.presentation.kind === 'properties');
	const properties = input.view.presentation, tree = properties.tree;
	tree.selectionIndex = tree.rows.length - 1;
	acceptEffectPropertySelection(input.view, properties, false);
	assert.ok(tree.selectionIndex >= tree.layout.visibleRowCount);
	tree.scroll = 0;
	t.mock.method(WorkbenchActionBarControl.prototype, 'update', () => {});
	input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- property apply refresh\n' }]);
	f.controller.updateView(input);
	pane.update(0);
	assert.ok(tree.scroll > 0 && tree.selectionIndex >= tree.scroll
		&& tree.selectionIndex < tree.scroll + tree.layout.visibleRowCount, 'source completion reveals the retained property selection');
	tree.scroll = 0;
	pane.update(0); pane.update(0);
	assert.equal(tree.scroll, 0, 'manual reading position survives stationary presentation frames');
	const selection = new BehaviorLensNavigationSelection(input);
	t.after(() => selection.dispose());
	input.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- restored property viewport\n' }]);
	f.controller.updateView(input);
	pane.setOptions(undefined, selection);
	pane.update(0);
	assert.equal(tree.scroll, 0, 'explicit navigation restores its viewport rather than forcing the selected property onscreen');
});


test('authored Behavior graph controls do not acquire a runtime command subject from an open runtime inspector', t => {
	const f = fixture(t), input = f.controller.openDefinition(f.first, f.registration);
	f.first.panes.activePane!.focus();
	const graph = inputFocus.target!, pane = f.first.panes.activePane as BehaviorLensEditorPane;
	const transport = new RuntimeTransport(createTestRuntime(createTestRuntimeRomPayload()), null!, null!, null!, () => true);
	const interaction = new InputInteraction(transport);
	pane.inspector.show({ title: '', items: [], interaction, canOpenSource: () => false, openSource() {} }, false);
	assert.equal(pane.inspector.visible, true);
	assert.ok(pane.inspector.focusTarget.scope.runtime!.interaction === interaction);
	assert.ok(pane.inspector.focusTarget.scope.runtime!.target === pane.inspector.focusTarget);
	assert.equal(pane.inspector.focusTarget.scope.interactionOwner!.interaction, interaction);
	graph.focus();
	for (const command of ['pause', 'stepFrame', 'stepFrameBack'] as const) {
		assert.equal(graph.getCommand(command), undefined);
		assert.equal(graph.commandContext.getCommand(command), undefined);
		assert.ok(pane.inspector.focusTarget.getCommand(command));
	}
	assert.equal(graph.scope.interactionOwner!.interaction!.transport, null);
	assert.equal(graph.scope.runtimeOwner, undefined);
	assert.equal(input.runtimeInspection, undefined);
});
