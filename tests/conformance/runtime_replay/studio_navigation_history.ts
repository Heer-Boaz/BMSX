import { editorTabGroup } from '../../../ide/workbench/ui/tab/group_model';
import { NAVIGATION_SOURCE } from '../../fixtures/studio/navigation';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { closeTab, getActiveTab } from '../../../ide/workbench/ui/tabs';
import { selectedBehaviorLensSourceRange } from '../../../ide/workbench/contrib/behavior_lens/navigation';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { chooseBehavior, revealLensOccurrence } from './studio_behavior_picker';
import { openSceneEditor, selectMember } from './studio_scene_source';
import { check, type StudioFixture } from './studio_fixture';

/** The actual shared keybinding/palette, panes, source model and FSM worker. */
export async function testStudioNavigationHistory(test: StudioFixture): Promise<void> {
	const { ide, harness, press, frame, click, runPaletteCommand } = test;
	console.info('STUDIO A03: diagram -> Source -> definition -> Back -> Back -> Forward');
	const initialTabs = new Set(editorTabGroup.tabs);
	const cycles = test.cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua'); // Workspace transport only; all assertions use the independent fixture.
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: NAVIGATION_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM navigation.fsm.one', 'STATE MACHINES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'state-graph') throw new Error('A03: FSM pane missing');
	await lens.graphLayout.settled; await frame();
	const view = lens.view;
	const graph = lens.view.presentation;
	const modelGraph = graph.viewport.model;
	const returns = modelGraph.edges.filter(edge => edge.link.reference.kind === 'state-outcome'
		&& edge.link.reference.outcome.proof.kind === 'return');
	check(returns.length === 2, 'A03: two equal return values remain distinct source evidence');
	await press('Home');
	const edgeIndex = modelGraph.nodes.length + modelGraph.edges.indexOf(returns[1]);
	for (let index = 0; index < edgeIndex; index += 1) await press('ArrowDown');
	const source = selectedBehaviorLensSourceRange(view)!;
	check(model.buffer.getTextRange(model.buffer.offsetAt(source.start.line - 1, source.start.column - 1),
		model.buffer.offsetAt(source.end.line - 1, source.end.column)) === 'return next_path', 'A03: exact second return selected');
	await press('ArrowRight'); await press('ArrowRight');
	const scrollX = graph.viewport.scrollX;
	const scrollY = graph.viewport.scrollY;
	const version = model.version;
	const dirty = model.dirty;
	await click(graph.actionBar.items[0].bounds, 5);
	check(getActiveTab().kind === 'code_editor' && activeCodeEditor.view.cursorRow === source.start.line - 1 && !hasSelection(),
		'A03: Source opens the selected proof without changing or selecting text');
	for (let index = 0; index < 'return '.length; index += 1) await press('ArrowRight');
	await press('F12');
	const expected = { row: 0, column: 0 };
	model.buffer.positionAt(NAVIGATION_SOURCE.indexOf('next_path<const>'), expected);
	check(activeCodeEditor.view.cursorRow === expected.row && activeCodeEditor.view.cursorColumn === expected.column,
		'A03: Go to Definition resolves the canonical Lua constant');
	check(model.version === version && model.dirty === dirty, 'A03: the whole forward navigation leaves text/dirty/version untouched');
	const prefix = '-- 🐉 navigation prefix\n';
	await press('ControlLeft', 'Home'); test.clipboard.text = prefix; await press('ControlLeft', 'KeyV');
	const editedVersion = model.version;
	await press('AltLeft', 'ArrowLeft');
	check(getActiveTab().kind === 'code_editor' && activeCodeEditor.view.cursorRow === source.start.line
		&& activeCodeEditor.view.cursorColumn === source.start.column - 1 + 'return '.length, 'A03: Back restores the mapped source-use cursor');
	await press('AltLeft', 'ArrowLeft');
	check(getActiveTab() === lens, 'A03: the second Back returns to the concrete visual input');
	await lens.graphLayout.settled; await frame();
	check(view.definitionRowKey === view.document.definitions[0].rowKey && view.selection?.kind === 'state-outcome'
		&& selectedBehaviorLensSourceRange(view)!.start.line === source.start.line + 1,
		'A03: the mapped registration and second return survive source reprojection');
	check(graph.viewport.scrollX === scrollX && graph.viewport.scrollY === scrollY,
		'A03: asynchronous geometry publication preserves the saved viewport instead of running initial reveal');
	await press('AltLeft', 'ArrowRight');
	check(getActiveTab().kind === 'code_editor' && activeCodeEditor.view.cursorRow === source.start.line,
		'A03: Forward is a workbench binding, including from a graph');
	check(model.version === editedVersion && model.buffer.getText() === prefix + NAVIGATION_SOURCE,
		'A03: history restoration does not apply an undo snapshot or lose source edits');
	await runPaletteCommand('Go: Back');
	check(getActiveTab() === lens, 'A03: palette and shortcut share the navigation owner');
	await runPaletteCommand('Behavior Lens: Open State Machine (FSM)');
	await chooseBehavior(test, 'FSM navigation.fsm.two', 'STATE MACHINES');
	await press('AltLeft', 'ArrowLeft');
	check(getActiveTab() === lens && view.definitionRowKey === view.document.definitions[0].rowKey && view.selection?.kind === 'state-outcome',
		'A03/A04: Back from another definition restores the original input and its exact selection');
	await lens.graphLayout.settled; await frame();
	check(graph.viewport.scrollX === scrollX && graph.viewport.scrollY === scrollY, 'A03: repeated definition switching keeps the saved viewport');

	console.info('STUDIO A03/A04: FSM history, mapped returns, async viewport and definition inputs passed');
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT navigation.tree.one', 'BEHAVIOR TREES');
	const treeInput = getActiveTab();
	if (treeInput.kind !== 'behavior_lens') throw new Error('A04: BT input missing');
	const treeView = treeInput.view;
	if (treeView.presentation.kind !== 'graph') throw new Error('A03: BT presentation missing');
	const tree = treeView.presentation;
	await press('Home'); await press('ArrowDown'); await press('ArrowDown'); await press('ArrowRight');
	const occurrence = treeView.selection!.rowKey;
	const treeSource = selectedBehaviorLensSourceRange(treeView)!;
	await click(tree.actionBar.items[0].bounds);
	await press('AltLeft', 'ArrowLeft');
	check(getActiveTab() === treeInput && treeView.selection!.rowKey === occurrence && treeView.presentation.kind === 'graph', 'A03: Back restores the second shared BT occurrence');
	await runPaletteCommand('Behavior Lens: Open ActionEffect');
	await chooseBehavior(test, 'EFFECT navigation.effect', 'ACTIONEFFECTS');
	const effectInput = getActiveTab();
	if (effectInput.kind !== 'behavior_lens' || effectInput.view.presentation.kind !== 'properties') throw new Error('A03: effect properties missing');
	const effect = effectInput.view.document.definitions.find(definition => definition.behaviorKind === 'action_effect')!;
	if (effect.behaviorKind !== 'action_effect') throw new Error('A03: effect definition missing');
	const period = effect.body!.fields.find(field => field.kind === 'value' && field.name === 'period_ms')!.source;
	await revealLensOccurrence(test, effectInput.view, period.rowKey);
	await click(effectInput.view.presentation.actionBar.items[0].bounds);
	await press('AltLeft', 'ArrowLeft');
	check(getActiveTab() === effectInput && effectInput.view.presentation.kind === 'properties' && effectInput.view.selection!.rowKey === period.rowKey,
		'A03: ActionEffect Source returns to its exact authored property');
	// Cross-kind restoration must rebind reusable graph/property controls, not just change their data.
	await press('AltLeft', 'ArrowLeft');
	check(treeView.presentation.kind === 'graph' && treeView.selection!.rowKey === occurrence
		&& selectedBehaviorLensSourceRange(treeView)!.start.line === treeSource.start.line, 'A03: Back across presentation kinds restores the BT');
	await press('ArrowLeft');
	check(treeView.selection!.rowKey !== occurrence, 'A03: the restored graph receives physical keyboard navigation');
	await press('Home'); await press('ArrowDown'); await press('ArrowDown');
	const removedSource = selectedBehaviorLensSourceRange(treeView)!;
	const removedOffset = model.buffer.offsetAt(removedSource.start.line - 1, removedSource.start.column - 1);
	check(model.buffer.getTextRange(removedOffset, removedOffset + 4) === 'leaf', 'A03: choose the second shared leaf occurrence');
	await click(treeView.presentation.actionBar.items[0].bounds);
	model.pushEditOperations([{ offset: removedOffset, deleteLength: 4, text: '' }]);
	await press('AltLeft', 'ArrowLeft');
	check(getActiveTab() === treeInput && treeView.selection === null && treeView.presentation.viewport.selection === null,
		'A03: a deleted history occurrence cannot select the remaining identical leaf');
	await press('AltLeft', 'ArrowRight');
	await press('ControlLeft', 'KeyZ');
	await press('AltLeft', 'ArrowLeft');
	check(treeView.selection === null && model.buffer.getText() === prefix + NAVIGATION_SOURCE,
		'A03: Undo restores source bytes, not a deleted navigation selection');

	await click(treeView.presentation.actionBar.items[0].bounds);
	const scene = await openSceneEditor(test);
	await selectMember(test, scene, 1);
	const member = scene.selectionRange.start;
	await click(scene.actionBar.items[0].bounds);
	await press('AltLeft', 'ArrowLeft');
	check(getActiveTab() === scene && scene.selectionRange.start === member && scene.properties[0].value === 44,
		'A03: Scene Source restores member identity and bound properties');
	await press('AltLeft', 'ArrowRight');
	check(getActiveTab().kind === 'code_editor' && activeCodeEditor.model === model, 'A03: Scene Forward returns to the shared source model');
	// A closed text input remains a registered resource destination, not a disposed input.
	await press('ControlLeft', 'KeyW');
	await runPaletteCommand('Go: Back');
	check(getActiveTab().kind === 'code_editor' && activeCodeEditor.model === model, 'A03: Back reopens a closed text resource through its registered editor');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: original }]);
	await frame();
	await runPaletteCommand('Scenario Lab: Open');
	const scenario = getActiveTab();
	if (scenario.kind !== 'scenario_lab') throw new Error('A03: Scenario Lab missing');
	// Catalog membership is the source owner; no scenario name/path/ordinal is assumed.
	const testIndex = scenario.view.testPane.rows.findIndex(row => row.kind === 'test');
	check(testIndex >= 0, 'A03: actual scenario catalog has a source destination');
	await press('Home');
	for (let index = 0; index < testIndex; index += 1) await press('ArrowDown');
	const testId = scenario.view.testPane.selectedNodeId;
	await press('Enter');
	check(getActiveTab().kind === 'code_editor', 'A03: Scenario test opens its source without running');
	await press('AltLeft', 'ArrowLeft');
	check(getActiveTab() === scenario && scenario.view.testPane.selectedNodeId === testId && scenario.view.focus === 'tests',
		'A03: Scenario source returns to its exact test selection');
	check(test.cycles() === cycles && ide.sources.currentBlua32Media === media, 'A03: all history routes preserve the paused machine and installed media');
	for (const input of [...editorTabGroup.tabs]) if (!initialTabs.has(input) && input.kind === 'behavior_lens') closeTab(ide.editor.editorPanes, ide.sources, input.id);
	harness.openLuaSource('cart.lua'); await frame();
	console.info('STUDIO A03: shared history routes passed');
}
