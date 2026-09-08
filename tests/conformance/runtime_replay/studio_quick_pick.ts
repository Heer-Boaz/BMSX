import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { editorSearchState } from '../../../ide/workbench/contrib/code_editor/find/widget_state';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { TOP_BAR_MENUS, type TopBarMenuItem } from '../../../ide/workbench/ui/top_bar/menu';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { inputFocus } from '../../../ide/input/focus';
import { SceneEditorPane } from '../../../ide/workbench/contrib/scene_editor/editor_pane';
import { WHEEL_SCROLL_STEP } from '../../../ide/common/constants';
import { check, type StudioFixture } from './studio_fixture';
import { openSceneEditor, selectMember } from './studio_scene_source';

/** No direct picker calls: physical workbench shortcut, pointer, clipboard and navigation. */
export async function testStudioQuickPick(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, until, input, clock, clipboard, cycles, setPointerButton } = test;
	console.info('STUDIO: workbench-owned quick input from real non-code panes');
	harness.openLuaSource('scenes/root.lua');
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	const position = cycles();
	const scene = await openSceneEditor(test);
	await selectMember(test, scene, 2);
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof SceneEditorPane)) throw new Error('quick pick: actual Scene Editor required');
	const x = pane.controls[0];
	const picker = ide.editor.quickInput;
	await click(scene.properties[0].bounds);
	const codeTop = editorViewState.codeAreaTop;
	await press('ControlLeft', 'Comma');
	check(picker.visible && picker.field.focusTarget.hasFocus && getActiveTab() === scene,
		'quick pick: workbench search does not activate a hidden code editor');
	check(editorViewState.codeAreaTop === codeTop && picker.layout.bounds.right === editorViewState.viewportWidth - 8,
		'quick pick: overlay has its own viewport, not a code inline bar');
	for (const code of ['KeyR', 'KeyO', 'KeyO', 'KeyT']) await press(code);
	await press('ControlLeft', 'KeyZ');
	check(picker.field.text === 'roo' && model.buffer.getText() === original, 'quick pick: query Undo does not reach scene history');
	await press('ControlLeft', 'KeyY');
	check(picker.field.text === 'root' && picker.model.list.rows[0].item.label === 'scenes/root.lua', 'quick pick: retained matches follow field Redo');
	await press('Escape');
	check(!picker.visible && inputFocus.target === x.field.focusTarget, 'quick pick: Escape restores the exact invoking property');

	await press('Digit7');
	check(x.pending, 'quick pick: real property draft exists before navigation');
	await press('ControlLeft', 'Comma');
	check(!x.pending && scene.properties[0].value === 7, 'quick pick: the property owner commits valid blur, not the picker');
	await press('Escape');
	await press('Enter');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'quick pick: committed property remains one ordinary document Undo');
	await click(scene.properties[0].bounds);
	await press('Minus');
	await press('ControlLeft', 'Comma');
	check(!x.pending && model.buffer.getText() === original, 'quick pick: invalid property blur follows its existing cancel policy');
	await press('Escape');
	check(inputFocus.target === x.field.focusTarget, 'quick pick: cancelled draft still has a concrete return control');

	await press('ControlLeft', 'Comma');
	clipboard.text = 'long_query_'.repeat(100) + '\r\n\tend';
	await press('ControlLeft', 'KeyV');
	check(picker.field.text === 'long_query_'.repeat(100) + 'end' && picker.field.lines.length === 1,
		'quick pick: long external paste is not length-capped and remains a single-line query');
	check(picker.textViewport.start > 0 && picker.textViewport.end === picker.field.text.length,
		'quick pick: caret reveals the end of the full query');
	await press('Home');
	check(picker.textViewport.start === 0 && picker.field.cursorColumn === 0, 'quick pick: Home moves the text caret, not the item selection');
	await press('End');
	await press('Enter');
	check(picker.visible && picker.model.list.selectionIndex === -1 && getActiveTab() === scene,
		'quick pick: Enter with no matches neither closes nor navigates to invented source');
	await press('ControlLeft', 'KeyA');
	await press('Backspace');
	const outlineScroll = scene.outline.scroll;
	input.inputAxis1('pointer:0', 'pointer_wheel', WHEEL_SCROLL_STEP * 3, clock.now());
	await frame();
	await frame();
	check(picker.model.list.scroll > 0 && scene.outline.scroll === outlineScroll, 'quick pick: wheel scrolls only the popup list');
	await press('PageDown');
	check(picker.model.list.selectionIndex >= picker.model.list.scroll, 'quick pick: keyboard selection is revealed after wheel scrolling');
	await click(editorChromeState.menuEntryBounds.view, 8);
	check(!picker.visible && editorChromeState.openMenuId === null && inputFocus.target === x.field.focusTarget,
		'quick pick: one outside held click cancels without clicking through into the View menu');

	await click(editorChromeState.menuEntryBounds.view);
	const scenarioItem = TOP_BAR_MENUS.view.items.find((item): item is TopBarMenuItem => item.type === 'command' && item.command === 'scenarioLab')!;
	await click(scenarioItem.bounds);
	const scenario = getActiveTab();
	check(scenario.kind === 'scenario_lab', 'quick pick: actual Scenario Lab is active');
	const scenarioFocus = inputFocus.target;
	await press('ControlLeft', 'Comma');
	check(picker.visible && getActiveTab() === scenario, 'quick pick: file search is visible without leaving Scenario Lab');
	await press('Escape');
	check(inputFocus.target === scenarioFocus, 'quick pick: Scenario Lab regains its own focus');
	await press('ControlLeft', 'Comma');
	for (const code of ['KeyR', 'KeyO', 'KeyO', 'KeyT']) await press(code);
	await press('Enter');
	await until(() => getActiveTab().kind === 'code_editor' && activeCodeEditor.model === model,
		'quick pick: Scenario Lab selection opens the exact retained root document through normal navigation');

	// A lower code widget must not consume the popup's Escape.
	await press('ControlLeft', 'KeyF');
	const findTarget = inputFocus.target;
	await press('ControlLeft', 'Comma');
	await press('Escape');
	check(editorSearchState.visible && inputFocus.target === findTarget, 'quick pick: Escape dismisses the topmost input, not Find behind it');
	await press('Escape');
	await openSceneEditor(test);
	await press('ControlLeft', 'Comma');
	await press('ControlRight', 'ShiftRight');
	check(!ide.editor.isActive && !picker.visible, 'quick pick: IDE deactivation closes the transient input through blur');
	await press('ControlRight', 'ShiftRight');
	check(ide.editor.isActive && getActiveTab() === scene && !picker.visible, 'quick pick: IDE reopen restores the scene, not an orphaned popup');
	await press('ControlLeft', 'Comma');
	for (const code of ['KeyR', 'KeyO', 'KeyO', 'KeyT']) await press(code);
	const layout = picker.model.list.layout;
	await click({ left: layout.contentLeft, right: layout.contentRight,
		top: layout.contentTop, bottom: layout.contentTop + layout.rowHeight }, 8);
	await until(() => getActiveTab().kind === 'code_editor' && activeCodeEditor.model === model,
		'quick pick: held pointer acceptance opens once through the resource owner');
	check(!picker.visible && model.buffer.getText() === original && cycles() === position,
		'quick pick: the complete input loop preserves source and paused execution');

	// Open the popup while a real lower scrollbar still captures a held mouse press.
	const thumb = editorViewState.scrollbars.codeVertical.getThumb();
	check(thumb !== null, 'quick pick: the real root source exposes a vertical scrollbar');
	await click(thumb);
	setPointerButton('pointer_primary', true);
	await frame();
	check(editorViewState.scrollbarController.hasActiveDrag(), 'quick pick: real scrollbar drag is active before opening');
	await press('ControlLeft', 'Comma');
	check(picker.visible && !editorViewState.scrollbarController.hasActiveDrag(), 'quick pick: exclusive input ends the lower pointer capture');
	const scroll = activeCodeEditor.view.scrollRow;
	setPointerButton('pointer_primary', false);
	await frame();
	await press('Escape');
	check(!editorViewState.scrollbarController.hasActiveDrag() && activeCodeEditor.view.scrollRow === scroll,
		'quick pick: release and dismissal do not revive a stale drag');
}

/** Final backend screenshot: actual workbench picker above the already-proven scene view. */
export async function presentWorkbenchQuickPick(test: StudioFixture): Promise<void> {
	await test.press('ControlLeft', 'Comma');
	for (const code of ['KeyS', 'KeyC', 'KeyE', 'KeyN', 'KeyE']) await test.press(code);
	check(test.ide.editor.quickInput.visible && getActiveTab().kind === 'scene_editor', 'quick pick: final overlay remains independent of the visual pane');
	await test.frame();
}
