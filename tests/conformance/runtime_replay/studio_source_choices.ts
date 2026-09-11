import { SOURCE_CHOICES_DEFINITIONS, SOURCE_CHOICES_USAGE } from '../../fixtures/studio/source_choices';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { referenceState } from '../../../ide/editor/contrib/references/state';
import { editorTextModelService } from '../../../ide/editor/model/model_service';
import { inputFocus } from '../../../ide/input/focus';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { check, type StudioFixture } from './studio_fixture';

/** Independent Lua source, real file Save and shared physical popup/navigation routes. */
export async function testStudioSourceChoices(test: StudioFixture): Promise<void> {
	const { ide, harness, press, frame, runPaletteCommand } = test;
	const picker = ide.editor.quickInput;
	console.info('STUDIO A06: symbols, definitions and references share Quick Input');
	harness.openLuaSource('cart.lua');
	await frame();
	await press('ControlLeft', 'ShiftLeft', 'KeyO');
	check(picker.visible && inputFocus.target === picker.field.focusTarget,
		'A06: physical document-symbol command opens the shared picker, not the old inline widget');
	await press('Escape');
	const definitions = activeCodeEditor.model;
	const originalDefinitions = definitions.buffer.getText();
	definitions.pushEditOperations([{ offset: 0, deleteLength: definitions.buffer.length, text: SOURCE_CHOICES_DEFINITIONS }]);
	await runPaletteCommand('File: Save'); await test.until(() => !definitions.dirty, 'A06: save independent definition source');
	harness.openLuaSource('title_screen.lua');
	const usage = activeCodeEditor.model;
	const originalUsage = usage.buffer.getText();
	usage.pushEditOperations([{ offset: 0, deleteLength: usage.buffer.length, text: SOURCE_CHOICES_USAGE }]);
	await runPaletteCommand('File: Save'); await test.until(() => !usage.dirty, 'A06: save independent usage source');
	const cycles = test.cycles();
	const media = ide.sources.currentBlua32Media;
	const usageVersion = usage.version, definitionVersion = definitions.version;

	await press('ControlLeft', 'ShiftLeft', 'KeyO');
	test.clipboard.text = 'SHADOW'; await press('ControlLeft', 'KeyV');
	check(picker.model.list.rows.length === 1 && picker.model.list.rows[0].item.label === 'shadow',
		'A06: document symbol matching folds the user query without changing Lua identifiers');
	await press('Enter');
	check(activeCodeEditor.model === usage && activeCodeEditor.view.cursorRow === 1 && activeCodeEditor.view.cursorColumn === 15,
		'A06: accepting a symbol synchronously reveals its actual declaration');

	await press('AltLeft', 'Comma');
	test.clipboard.text = 'SOURCE_CHOICE_BEACON'; await press('ControlLeft', 'KeyV');
	check(picker.visible && picker.model.list.rows.length === 1 && picker.model.list.rows[0].item.description === 'cart.lua',
		'A06: workspace symbols distinguish the global declaration from same-named local parameters');
	const row = picker.model.viewport.bounds;
	test.movePointer({ left: row.left, right: row.right, top: picker.model.rowTop(0), bottom: picker.model.rowTop(0) + picker.model.rowHeight });
	await frame(); test.setPointerButton('pointer_primary', true); await frame();
	check(picker.visible && activeCodeEditor.model === usage, 'A06: symbol press does not navigate before release');
	test.setPointerButton('pointer_primary', false); await frame();
	check(activeCodeEditor.model === definitions && activeCodeEditor.view.cursorRow === 0 && activeCodeEditor.view.cursorColumn === 0,
		'A06: symbol release navigates across files without retargeting its domain');
	await press('AltLeft', 'ArrowLeft');
	check(activeCodeEditor.model === usage && activeCodeEditor.view.cursorRow === 1, 'A06: Back returns to the source choice origin');

	await press('ControlLeft', 'End'); await press('ArrowUp'); await press('Home');
	for (let index = 0; index < 7; index += 1) await press('ArrowRight');
	await runPaletteCommand('Go: Go to References');
	check(picker.visible && picker.model.list.rows.length === 4 && picker.model.list.selectionIndex === 3
		&& picker.model.list.rows[3].item.label === 'return source_choice_beacon',
		'A06: workspace reference selection uses path and cursor, not the current-file index');
	check(referenceState.getMatches().length === 2 && referenceState.getActiveIndex() === 1,
		'A06: file-local highlight state remains separate from workspace selection');
	await press('ControlLeft', 'Home'); await press('Enter');
	check(activeCodeEditor.model === definitions && activeCodeEditor.view.cursorRow === 0 && referenceState.getMatches().length === 0,
		'A06: reference accept reveals the chosen declaration and ends temporary highlights');
	await press('AltLeft', 'ArrowLeft');
	check(activeCodeEditor.model === usage && activeCodeEditor.view.cursorRow === 5 && activeCodeEditor.view.cursorColumn === 7,
		'A06: reference navigation preserves its exact origin for Back');

	await press('ArrowUp'); await press('End'); await press('ArrowLeft');
	await press('F12');
	check(picker.visible && picker.model.list.rows.length === 2 && picker.title.startsWith('DEFINITIONS:'),
		'A06: a factory with two authored member origins opens the shared definition chooser');
	await press('ArrowDown'); await press('Enter');
	check(activeCodeEditor.model === definitions && activeCodeEditor.view.cursorRow === 3 && activeCodeEditor.view.cursorColumn === 10,
		'A06: selected factory member source, not a synthetic symbol row, determines navigation');
	check(!definitions.dirty && !usage.dirty && definitions.version === definitionVersion && usage.version === usageVersion,
		'A06: symbol, reference and ambiguous-definition navigation did not edit either document');
	await press('AltLeft', 'ArrowLeft');
	check(activeCodeEditor.model === usage && activeCodeEditor.view.cursorRow === 4, 'A06: multi-definition Back restores the usage');

	await press('ControlLeft', 'ShiftLeft', 'KeyO');
	test.clipboard.text = 'no source choice'; await press('ControlLeft', 'KeyV'); await press('Enter');
	check(picker.visible && picker.model.list.selectionIndex === -1 && !usage.dirty, 'A06: an empty choice does not invent a destination');
	await press('Escape');
	await press('ControlLeft', 'End'); test.clipboard.text = '-- source choice edit'; await press('ControlLeft', 'KeyV');
	await press('ControlLeft', 'ShiftLeft', 'KeyO'); await press('KeyS'); await press('KeyH'); await press('ControlLeft', 'KeyZ');
	check(picker.field.text === 's' && usage.dirty, 'A06: query Undo does not consume source Undo');
	await press('Escape'); await press('ControlLeft', 'KeyZ');
	check(usage.buffer.getText() === SOURCE_CHOICES_USAGE && !usage.dirty, 'A06: document Undo remains available after source choices close');

	await press('AltLeft', 'Comma');
	definitions.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- source generation\n' }]);
	check(!picker.visible && inputFocus.target === activeCodeEditor.focusTarget, 'A06: an edited imported/source candidate retires stale locations');
	await press('ControlLeft', 'Comma'); // New file chooser must survive the expired source listener.
	definitions.undo();
	check(picker.visible, 'A06: the expired source generation cannot close a newer file picker');
	await press('Escape');
	check(editorTextModelService.get(usage.resource) === usage && getActiveTab().kind === 'code_editor',
		'A06: choosing sources retains the same working copy and ordinary editor pane');
	check(test.cycles() === cycles && ide.sources.currentBlua32Media === media, 'A06: source choices never run or replace guest media');

	harness.openLuaSource('cart.lua');
	definitions.pushEditOperations([{ offset: 0, deleteLength: definitions.buffer.length, text: originalDefinitions }]);
	await runPaletteCommand('File: Save'); await test.until(() => !definitions.dirty, 'A06: restore definition source via ordinary Save');
	harness.openLuaSource('title_screen.lua');
	usage.pushEditOperations([{ offset: 0, deleteLength: usage.buffer.length, text: originalUsage }]);
	await runPaletteCommand('File: Save'); await test.until(() => !usage.dirty, 'A06: restore usage source via ordinary Save');
}
