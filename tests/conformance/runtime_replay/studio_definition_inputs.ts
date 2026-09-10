import { NAVIGATION_SOURCE } from '../../fixtures/studio/navigation';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { editorTabGroup } from '../../../ide/workbench/ui/tab/group_model';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { SCROLLBAR_WIDTH, WHEEL_SCROLL_STEP } from '../../../ide/common/constants';
import { inputFocus } from '../../../ide/input/focus';
import { pointerCapture } from '../../../ide/input/pointer/capture';
import { closeTab, getActiveTab } from '../../../ide/workbench/ui/tabs';
import { navigationState } from '../../../ide/navigation/navigation_history';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Independent definitions through real Save, palette, pointer, source and history owners. */
export async function testStudioDefinitionInputs(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, runPaletteCommand } = test;
	console.info('STUDIO A04: definition identity, group preview, Keep Open and shared model lifetime');
	const initialTabs = new Set(editorTabGroup.tabs);
	const cycles = test.cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua');
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	const source = NAVIGATION_SOURCE + "\nmachines.register('navigation.same', states)\nmachines.register('navigation.same', states)\n";
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: source }]);
	await runPaletteCommand('File: Save');
	await test.until(() => !model.dirty, 'A04: ordinary Save establishes the fixture working-copy baseline');
	await runPaletteCommand('Behavior Lens: Open'); await chooseBehavior(test, 'FSM navigation.fsm.one');
	const first = getActiveTab();
	if (first.kind !== 'behavior_lens' || first.view.presentation.kind !== 'state-graph') throw new Error('A04: first FSM input missing');
	await first.graphLayout.settled; await frame(); await press('Home'); await press('ArrowDown');
	const selection = first.view.selection!.rowKey;
	const topology = first.view.document;
	const index = first.view.stateMachines;
	await runPaletteCommand('Behavior Lens: Open'); await chooseBehavior(test, 'FSM navigation.fsm.two');
	const second = getActiveTab();
	if (second.kind !== 'behavior_lens') throw new Error('A04: second FSM input missing');
	check(second !== first && first.title === 'FSM navigation.fsm.one' && second.title === 'FSM navigation.fsm.two', 'A04: definitions have distinct inputs and meaningful titles');
	check(first.workingCopy === second.workingCopy && first.workingCopy === model
		&& first.view.document === second.view.document && first.view.stateMachines === second.view.stateMachines && first.view.source === second.view.source,
		'A04: two views share one text model, immutable topology and FSM index');
	const count = editorTabGroup.tabs.length;
	await runPaletteCommand('Behavior Lens: Open'); await chooseBehavior(test, 'FSM navigation.fsm.one');
	check(getActiveTab() === first && first.view.selection!.rowKey === selection && editorTabGroup.tabs.length === count,
		'A04: reopening keeps the exact input, selection and tab count');
	check(first.view.document === topology && first.view.stateMachines === index, 'A04: reopening does not rebuild unchanged source generations');

	await runPaletteCommand('Behavior Lens: Preview Definition'); await chooseBehavior(test, 'BT navigation.tree.one');
	const preview = getActiveTab();
	if (preview.kind !== 'behavior_lens') throw new Error('A04: preview missing');
	check(editorTabGroup.previewTab === preview && editorTabGroup.getLabel(preview).startsWith('PREVIEW:'), 'A04: preview is explicit and visible');
	await click(preview.view.presentation.actionBar.items[0].bounds); await press('AltLeft', 'ArrowLeft');
	check(getActiveTab() === preview && editorTabGroup.previewTab === preview && !model.dirty, 'A04: Source and Back retain a clean preview without editing');
	const previewIndex = editorTabGroup.indexOf(preview);
	await runPaletteCommand('Behavior Lens: Preview Definition'); await chooseBehavior(test, 'BT navigation.tree.two');
	const tree = getActiveTab();
	if (tree.kind !== 'behavior_lens') throw new Error('A04: replacement preview missing');
	check(editorTabGroup.previewTab === tree && editorTabGroup.indexOf(tree) === previewIndex && !editorTabGroup.tabs.includes(preview),
		'A04: a preview replaces only the old clean preview at its tab position');
	check(navigationState.back.every(entry => !entry.isDisposed && (entry.target.kind !== 'input' || entry.target.input !== preview)), 'A04: Back cannot resurrect a replaced preview');
	await runPaletteCommand('Editor: Keep Open');
	check(editorTabGroup.previewTab === null && !editorTabGroup.getLabel(tree).startsWith('PREVIEW:'), 'A04: the shared Keep Open command promotes the input');
	await runPaletteCommand('Behavior Lens: Preview Definition'); await chooseBehavior(test, 'EFFECT navigation.effect');
	const effect = getActiveTab();
	if (effect.kind !== 'behavior_lens') throw new Error('A04: effect input missing');
	await test.clickTab(effect.id); await test.clickTab(effect.id);
	check(editorTabGroup.previewTab === null, 'A04: double-clicking the tab keeps it open without changing the tiny font');
	await runPaletteCommand('Behavior Lens: Preview Definition'); await chooseBehavior(test, 'BT navigation.tree.one');
	const edited = getActiveTab();
	if (edited.kind !== 'behavior_lens') throw new Error('A04: editable preview missing');
	await press('Home'); await press('ArrowDown'); await press('ArrowDown');
	await runPaletteCommand('Behavior Lens: Duplicate BT Child');
	check(editorTabGroup.previewTab === null && model.dirty, 'A04: a real visual source edit promotes the shared working-copy preview');
	await runPaletteCommand('Behavior Lens: Open'); await chooseBehavior(test, 'FSM navigation.fsm.two');
	await runPaletteCommand('Edit: Undo');
	check(getActiveTab() === second && second.view.definitionRowKey === topology.definitions[1].rowKey,
		'A04: document Undo from a sibling view does not retarget it to the edited BT');
	check(model.buffer.getText() === source && !model.dirty && editorTabGroup.previewTab === null,
		'A04: Undo restores exact bytes but does not unpin the view');

	const bar = editorChromeState.tabScrollbar;
	const focus = inputFocus.target;
	const version = model.version;
	check(bar.isVisible() && editorViewState.tabBarTotalHeight === editorViewState.tabBarHeight + SCROLLBAR_WIDTH,
		'A04: independent definition tabs use one bounded row, not the entire editor viewport');
	test.movePointer(editorChromeState.tabBarBounds); await frame();
	test.input.inputAxis1('pointer:0', 'pointer_wheel', -100 * WHEEL_SCROLL_STEP, test.clock.now()); await frame();
	for (let index = 0; index < 8; index += 1) await frame();
	check(bar.getScroll() === 0 && getActiveTab() === second && inputFocus.target === focus,
		'A04: physical wheel scroll persists without switching editors or stealing focus');
	await test.clickTab(second.id);
	const point = (x: number, y: number) => ({ left: x, right: x, top: y, bottom: y });
	test.movePointer(bar.getThumb()!); await frame();
	test.setPointerButton('pointer_primary', true); await frame();
	check(pointerCapture.active, 'A04: the actual horizontal thumb owns pointer capture');
	test.movePointer(point(1, editorChromeState.tabBarBounds.top + 2)); await frame();
	check(bar.getScroll() === 0 && getActiveTab() === second, 'A04: captured thumb works outside its track without switching tabs');
	await press('Escape');
	check(!pointerCapture.active, 'A04: Escape ends the thumb gesture');
	test.setPointerButton('pointer_primary', false); await frame();

	for (const cancel of [true, false]) {
		await test.clickTab(second.id);
		const bounds = editorChromeState.tabButtonBounds.get(second.id)!;
		const y = bounds.top + 2;
		test.movePointer(point(bounds.left + 10, y)); await frame();
		test.setPointerButton('pointer_primary', true); await frame();
		const order = [...editorTabGroup.tabs];
		const from = editorTabGroup.indexOf(second);
		test.movePointer(point(1, y));
		for (let index = 0; index < 30; index += 1) await frame();
		check(pointerCapture.active && editorChromeState.tabDragState!.targetIndex >= 0
			&& order.every((input, index) => input === editorTabGroup.tabs[index]), 'A04: captured tab drag previews an insertion without reordering yet');
		if (cancel) await press('Escape');
		test.setPointerButton('pointer_primary', false); await frame();
		check(!pointerCapture.active && editorChromeState.tabDragState === null, 'A04: tab release/cancel ends capture');
		check(cancel ? order.every((input, index) => input === editorTabGroup.tabs[index]) : editorTabGroup.indexOf(second) < from,
			'A04: only an accepted drop changes tab order');
	}
	check(model.version === version && !model.dirty, 'A04: tab wheel/thumb/drag never edits the shared source');

	const duplicates = [];
	for (let occurrence = 0; occurrence < 2; occurrence += 1) {
		await runPaletteCommand('Behavior Lens: Open'); test.clipboard.text = 'FSM navigation.same'; await press('ControlLeft', 'KeyV');
		check(ide.editor.quickInput.model.list.rows.length === 2, 'A04: equal authored ids stay separate choices');
		if (occurrence === 1) await press('ArrowDown');
		await press('Enter');
		duplicates.push(getActiveTab());
	}
	check(duplicates[0] !== duplicates[1] && duplicates[0].title === duplicates[1].title
		&& editorTabGroup.getLabel(duplicates[0]) !== editorTabGroup.getLabel(duplicates[1]), 'A04: equal titles in one source have distinct source descriptions');
	check([...editorTextModelService.models].filter(candidate => candidate.resource.domain === model.resource.domain && candidate.resource.path === model.resource.path).length === 1,
		'A04: every open definition and source editor uses the same resource-owned text model');

	const duplicate = getActiveTab();
	if (duplicate.kind !== 'behavior_lens') throw new Error('A04: active duplicate missing');
	await click(duplicate.view.presentation.actionBar.items[0].bounds);
	const prefix = '-- 🐉 preceding source\n';
	await press('ControlLeft', 'Home'); test.clipboard.text = prefix; await press('ControlLeft', 'KeyV');
	const beforeRename = model.buffer.getText();
	const renameOffset = beforeRename.indexOf('navigation.fsm.one');
	model.pushEditOperations([{ offset: renameOffset, deleteLength: 'navigation.fsm.one'.length, text: 'navigation.renamed' }]);
	await runPaletteCommand('Behavior Lens: Open'); await chooseBehavior(test, 'FSM navigation.renamed');
	check(getActiveTab() === first && first.title === 'FSM navigation.renamed', 'A04: prefix insertion and authored id rename retain the registration input');
	const definitionKey = first.view.definitionRowKey!;
	const span = first.view.source.ranges.get(definitionKey)!;
	model.pushEditOperations([{ offset: span.start, deleteLength: span.end - span.start, text: '' }]);
	await frame();
	check(first.view.definitionRowKey === null && first.title.endsWith('(removed)'), 'A04: deleting a registration makes its own view unavailable, not a namesake');
	await runPaletteCommand('Edit: Undo');
	await runPaletteCommand('Behavior Lens: Open'); await chooseBehavior(test, 'FSM navigation.renamed');
	check(getActiveTab() !== first, 'A04: opening newly inserted source does not reuse the deleted occurrence');
	check(test.cycles() === cycles && ide.sources.currentBlua32Media === media, 'A04: all authoring flows leave machine cycles and installed media untouched');

	harness.openLuaSource('cart.lua');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: original }]);
	await runPaletteCommand('File: Save'); await test.until(() => !model.dirty, 'A04: restore authored source through ordinary Save');
	for (const input of [...editorTabGroup.tabs]) if (!initialTabs.has(input) && input.kind === 'behavior_lens') closeTab(ide.editor.editorPanes, ide.sources, input.id);
	harness.openLuaSource('cart.lua'); await frame();
	console.info('STUDIO A04: definition/preview/dirty/Undo/source/close workflows passed');
}
