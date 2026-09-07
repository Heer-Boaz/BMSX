import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { editorViewState } from '../../../ide/editor/ui/view/state';
import { getCodeAreaBounds } from '../../../ide/editor/ui/view/view';
import { inputFocus } from '../../../ide/input/focus';
import { editorSearchState, lineJumpState } from '../../../ide/workbench/contrib/code_editor/find/widget_state';
import { symbolSearchState } from '../../../ide/workbench/contrib/code_editor/symbols/search/state';
import { createResourceState, resourceSearchState } from '../../../ide/workbench/contrib/resources/widget_state';
import { renameController } from '../../../ide/workbench/contrib/code_editor/rename/controller';
import { editorContextMenuState } from '../../../ide/workbench/contrib/context_menu/state';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { TOP_BAR_MENUS, type TopBarMenuItem } from '../../../ide/workbench/ui/top_bar/menu';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { GX_REGISTER_SOURCE_PATH } from '../../../toolchain/ts/rompack/generated_modules';
import { check, type StudioFixture } from './studio_fixture';

async function historyMenu(test: StudioFixture, command: 'undo' | 'redo'): Promise<void> {
	await test.click(editorChromeState.menuEntryBounds.edit);
	check(editorChromeState.openMenuId === 'edit', 'focus: real Edit menu opens');
	const item = TOP_BAR_MENUS.edit.items.find((entry): entry is TopBarMenuItem => entry.type === 'command' && entry.command === command)!;
	check(!item.disabled, `focus: ${command} menu reflects the focused control's history`);
	await test.click(item.bounds);
}

/** Arrange real source views; every edit, history action, rename opening and tab switch below uses physical input. */
export async function testStudioFocus(test: StudioFixture): Promise<void> {
	const { ide, harness, press, click, frame, until, setKey, input, cycles } = test;
	console.info('STUDIO: focus-owned commands and control history');
	harness.openLuaSource(GX_REGISTER_SOURCE_PATH);
	const readonlyTab = getActiveTab();
	const readonlyModel = harness.getActiveEditorDocument().model;
	check(readonlyModel.readOnly, 'focus: real generated GX source is read-only');
	harness.openLuaSource('title_screen.lua');
	const titleTab = getActiveTab();
	const model = harness.getActiveEditorDocument().model;
	const original = model.buffer.getText();
	const position = cycles();
	await press('ControlLeft', 'End');
	for (const key of ['Minus', 'Minus', 'KeyF', 'KeyO', 'KeyC', 'KeyU', 'KeyS']) await press(key);
	const edited = original + '--focus';
	check(model.buffer.getText() === edited, 'focus: physical code typing creates actual document history');
	await press('ControlLeft', 'KeyF');
	const field = editorSearchState.field;
	check(inputFocus.target === field.focusTarget, 'focus: Find owns keyboard input, not merely a pane-local flag');
	for (const key of ['KeyW', 'KeyO', 'KeyR', 'KeyL', 'KeyD']) await press(key);
	check(field.text === 'world' && editorSearchState.query === 'world', 'focus: real Find input updates its query');
	await press('ControlLeft', 'KeyZ');
	check(field.text === 'worl' && editorSearchState.query === 'worl' && model.buffer.getText() === edited,
		'focus: field Undo publishes query change without document Undo');
	await historyMenu(test, 'undo');
	check(field.text === 'wor' && inputFocus.target === field.focusTarget, 'focus: pointer menu keeps the invoking field target');
	await historyMenu(test, 'redo');
	await press('ControlLeft', 'KeyY');
	check(field.text === 'world', 'focus: pointer and keyboard Redo share field history');
	await press('ControlLeft', 'KeyA');
	await press('ControlLeft', 'KeyC');
	await press('ControlLeft', 'KeyX');
	check(field.text === '' && editorSearchState.query === '', 'focus: Cut changes the field through its content event');
	await press('ControlLeft', 'KeyV');
	check(field.text === 'world', 'focus: Paste uses the clipboard service cache');
	await press('ControlLeft', 'KeyZ');
	check(field.text === '', 'focus: one Undo removes the complete paste');
	await press('ControlLeft', 'KeyZ');
	check(field.text === 'world', 'focus: the next Undo restores the cut selection');
	await press('ControlLeft', 'KeyS');
	await until(() => !model.dirty, 'focus: Save while Find has focus persists the document');
	check(model.lastSavedSource === edited && field.focusTarget.hasFocus && field.text === 'world',
		'focus: saving a document neither commits a search query as source nor steals its input focus');
	setKey('ControlLeft', true);
	setKey('KeyZ', true);
	await frame();
	check(input.getPlayerInput(1).inputHandlers.keyboard.getKeyState('KeyZ').consumed, 'focus: history key is consumed by its field target');
	for (let index = 0; index < 100; index += 1) await frame();
	check(field.text === '' && !field.canUndo && model.buffer.getText() === edited,
		'focus: held Undo repeats and stops at empty field history, never falling through to the document');
	setKey('KeyZ', false);
	setKey('ControlLeft', false);
	await frame();
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === edited, 'focus: another Undo on empty field history remains local');
	await press('Escape');
	check(activeCodeEditor.focusTarget.hasFocus, 'focus: closing Find restores code text focus');
	await press('KeyX');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === edited, 'focus: typing after a focus detour is a new document undo group');
	await historyMenu(test, 'undo');
	check(model.buffer.getText() === original, 'focus: document Undo becomes the target only after leaving the field');
	await press('ControlLeft', 'KeyS');
	await until(() => !model.dirty, 'focus: restore the original source through physical Save');
	for (const prompt of [
		{ keys: ['ControlLeft', 'KeyL'], field: lineJumpState.field, value: () => lineJumpState.value },
		{ keys: ['ControlLeft', 'ShiftLeft', 'KeyO'], field: symbolSearchState.field, value: () => symbolSearchState.query },
		{ keys: ['ControlLeft', 'Comma'], field: resourceSearchState.field, value: () => resourceSearchState.query },
		{ keys: ['ControlLeft', 'KeyN'], field: createResourceState.field, value: () => createResourceState.path },
	]) {
		await press(...prompt.keys);
		check(prompt.field.focusTarget.hasFocus, `focus: ${prompt.keys.join('+')} binds the concrete prompt target`);
		await press('ControlLeft', 'KeyA');
		await press('Backspace');
		await press('Digit1');
		await press('Digit2');
		await press('ControlLeft', 'KeyZ');
		check(prompt.field.text === '1' && prompt.value() === '1' && model.buffer.getText() === original,
			'focus: quick-input history publishes to its own query/path owner, never to source');
		await press('Escape');
		check(activeCodeEditor.focusTarget.hasFocus, 'focus: quick-input dismissal restores the concrete code target');
	}

	// Open the existing Rename command through the actual source context menu.
	await press('ControlLeft', 'Home');
	const bounds = getCodeAreaBounds();
	const x = bounds.textLeft + editorViewState.font.measure('local c');
	const y = bounds.codeTop + editorViewState.lineHeight / 2;
	await click({ left: x, right: x + 1, top: y, bottom: y + 1 }, 1, 'pointer_secondary');
	check(editorContextMenuState.visible, 'focus: secondary pointer opens the actual source context menu');
	const renameIndex = editorContextMenuState.entries.findIndex(entry => entry.action === 'rename');
	check(renameIndex >= 0, 'focus: Rename is contributed for the actual local identifier');
	await click(editorContextMenuState.itemBounds[renameIndex]);
	check(renameController.isActive(), 'focus: Rename control receives focus from the real context command');
	const renameField = renameController.getField();
	const originalName = renameField.text;
	await press('ControlLeft', 'KeyV');
	check(renameField.text === 'world', 'focus: Rename selects its input on focus and shares clipboard ownership with Find');
	await press('ControlLeft', 'KeyZ');
	check(renameField.text === originalName, 'focus: pasted Rename draft has one local history entry');
	await press('KeyA');
	await press('ControlLeft', 'KeyZ');
	check(renameField.text === originalName && model.buffer.getText() === original, 'focus: Rename Undo is draft history, not source history');
	await press('ControlLeft', 'KeyY');
	check(renameField.text === 'a' && model.buffer.getText() === original, 'focus: Rename Redo does not implicitly accept the refactor');
	let blurOnOldInput = false;
	const unbind = renameField.focusTarget.onDidBlur(() => {
		blurOnOldInput = getActiveTab() === titleTab && activeCodeEditor.model === model;
	});
	await click(editorChromeState.tabButtonBounds.get(readonlyTab.id)!);
	unbind();
	check(blurOnOldInput && !renameController.isVisible() && activeCodeEditor.model === readonlyModel,
		'focus: tab switch notifies the departing control before changing the resource; unfinished Rename is dismissed');
	const generated = readonlyModel.buffer.getText();
	await press('KeyQ');
	await press('ControlLeft', 'KeyZ');
	await click(editorChromeState.menuEntryBounds.edit);
	check(TOP_BAR_MENUS.edit.items.every(item => item.type !== 'command' || item.disabled), 'focus: generated document history commands are disabled');
	await click(editorChromeState.menuEntryBounds.edit);
	check(readonlyModel.buffer.getText() === generated && model.buffer.getText() === original, 'focus: readonly input never targets the previously editable document');
	await press('ControlLeft', 'KeyF');
	await press('KeyX');
	await press('KeyY');
	await press('ControlLeft', 'KeyZ');
	check(field.text === 'x' && readonlyModel.buffer.getText() === generated, 'focus: Find remains editable over a readonly document');
	await press('Escape');
	await click(editorChromeState.tabButtonBounds.get(titleTab.id)!);
	check(activeCodeEditor.focusTarget.hasFocus && activeCodeEditor.model === model && cycles() === position,
		'focus: returning to code restores its owner without executing the paused machine');
	// Leave an empty query for subsequent independent source-application workflows.
	await press('ControlLeft', 'KeyF');
	await press('ControlLeft', 'KeyA');
	await press('Backspace');
	await press('Escape');

	await click(editorChromeState.menuEntryBounds.view);
	const scenarioLabItem = TOP_BAR_MENUS.view.items.find((entry): entry is TopBarMenuItem => entry.type === 'command' && entry.command === 'scenarioLab')!;
	await click(scenarioLabItem.bounds);
	check(getActiveTab().kind === 'scenario_lab' && !activeCodeEditor.focusTarget.hasFocus && model.canRedo,
		'focus: real non-code view takes input ownership while the source retains redoable history');
	const viewTarget = inputFocus.target;
	await press('ControlLeft', 'KeyY');
	check(model.buffer.getText() === original && inputFocus.getCommand('redo') === undefined,
		'focus: a view without a text command does not redirect it to the last code editor');
	await press('ControlLeft', 'KeyB');
	check(inputFocus.target === ide.editor.resourcePanel.focusTarget, 'focus: Resources takes concrete panel focus');
	await press('ControlLeft', 'KeyY');
	await press('Escape');
	check(inputFocus.target === viewTarget && model.buffer.getText() === original,
		'focus: closing Resources restores the actual non-code pane, not the old code editor');
	await click(editorChromeState.tabButtonBounds.get(titleTab.id)!);
	check(activeCodeEditor.focusTarget.hasFocus && cycles() === position, 'focus: input tests leave the paused machine unchanged');
}

/** Final fault-gated screenshot shows the real tiny-font field and its Edit menu. */
export async function presentStudioFocus(test: StudioFixture): Promise<void> {
	await test.press('ControlLeft', 'KeyF');
	await test.press('ControlLeft', 'KeyA');
	for (const key of ['KeyP', 'KeyO', 'KeyS']) await test.press(key);
	await test.click(editorChromeState.menuEntryBounds.edit);
	check(editorSearchState.field.focusTarget.hasFocus && editorChromeState.openMenuId === 'edit', 'focus: final menu preserves the real input target');
	await test.frame();
}
