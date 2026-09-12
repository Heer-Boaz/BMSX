import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { ACTIONEFFECT_SOURCE } from '../../helpers/actioneffect_source_fixture';
import { chooseBehavior, revealLensOccurrence } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Independent source, real commands, value focus/draft history and workspace Save. */
export async function testStudioActionEffectEdit(test: StudioFixture): Promise<void> {
	const { ide, harness, frame, press, click, runPaletteCommand, clipboard, cycles, until } = test;
	console.info('STUDIO: ActionEffect authored value / draft / Save / Undo');
	harness.openLuaSource('cart.lua');
	const model = activeCodeEditor.model;
	const original = model.buffer.getText(), position = cycles(), media = ide.sources.currentBlua32Media;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: ACTIONEFFECT_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open ActionEffect');
	await chooseBehavior(test, 'EFFECT fixture.second', 'ACTIONEFFECTS');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'properties') throw new Error('Effect editing requires its property input.');
	const pane = ide.editor.editorPanes.activePane;
	if (!(pane instanceof BehaviorLensEditorPane)) throw new Error('Effect editing requires its contribution pane.');
	const editor = pane.propertyEdit, view = lens.view, properties = lens.view.presentation;
	const select = async (name: string) => {
		const definition = view.document.definitions[1];
		if (definition.behaviorKind !== 'action_effect') throw new Error('Expected the second effect.');
		const field = definition.body!.fields.find(field => field.kind !== 'unknown' && field.name === name)!;
		await revealLensOccurrence(test, view, field.source.rowKey);
		return field;
	};
	const open = async () => {
		await click(properties.actionBar.items.find(item => item.command === 'behaviorLens.editProperty')!.bounds, 6);
		check(editor.active && editor.control.field.focusTarget.hasFocus, 'effect: held Edit opens one real focused cell');
	};
	const paste = async (text: string) => {
		await press('ControlLeft', 'KeyA'); clipboard.text = text; await press('ControlLeft', 'KeyV');
	};
	await select('period_ms');
	let version = model.version;
	await open(); await paste('20 * 3');
	check(model.version === version && editor.control.pending, 'effect: typing is a draft, not source mutation');
	await press('ControlLeft', 'KeyZ'); check(editor.control.field.text === '20', 'effect: focused Undo uses local text history');
	await press('ControlLeft', 'ShiftLeft', 'KeyZ'); check(editor.control.field.text === '20 * 3', 'effect: focused Redo restores the draft');
	await press('Escape'); check(!editor.active && model.version === version, 'effect: Escape cancels without edits');
	await open(); await paste('clock.'); await press('Enter');
	check(editor.active && editor.control.error.length > 0 && model.version === version, 'effect: invalid Enter retains the cell and explains syntax');
	const saved = model.lastSavedSource;
	await press('ControlLeft', 'KeyS');
	check(editor.active && model.lastSavedSource === saved && model.version === version, 'effect: Save cannot capture an invalid draft');
	await paste('20\n*3');
	check(editor.control.field.text === 'clock.' && model.version === version, 'effect: multiline paste is rejected whole, never silently flattened');
	const expression = '20 * 3 --[[ A long authored comment stays exact while the value cell scrolls horizontally. ]]';
	await paste(expression); await frame();
	check(editor.control.viewport.start > 0, 'effect: long expression uses the shared glyph viewport');
	console.info('STUDIO: ActionEffect value cell ready for visual inspection');
	await press('ControlLeft', 'KeyS');
	const changed = ACTIONEFFECT_SOURCE.replace('period_ms = 20', 'period_ms = ' + expression);
	await until(() => !model.dirty, 'effect: Save captures the accepted value');
	check(!editor.active && model.version === version + 1 && model.lastSavedSource === changed && model.buffer.getText() === changed,
		'effect: Save commits once and persists exactly the accepted source');
	check(view.definitionRowKey === view.document.definitions[1].rowKey && view.source.nodesByRowKey.get(view.selection!.rowKey)!.label.startsWith('period_ms'),
		'effect: the source operation keeps the selected property in the chosen shared-definition use');
	await press('Enter');
	check(activeCodeEditor.model === model, 'effect: Source returns to the same edited text model');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === ACTIONEFFECT_SOURCE, 'effect: one code Undo restores the authored value and trivia');
	await test.clickTab(lens.id); await press('ControlLeft', 'ShiftLeft', 'KeyZ');
	check(model.buffer.getText() === changed, 'effect: graph/pane Redo shares document history');
	await press('ControlLeft', 'KeyZ');
	const tags = await select('blocked_tags');
	if (tags.kind !== 'list') throw new Error('Expected authored tags.');
	await revealLensOccurrence(test, view, tags.entries[0].node.rowKey);
	await runPaletteCommand('Behavior Lens: Edit Authored Property');
	check(editor.active, 'effect: palette opens the selected requirement value');
	await paste("'Changed Tag'"); await press('Enter');
	check(model.buffer.getText() === ACTIONEFFECT_SOURCE.replace("{ 'blocked' }", "{ 'Changed Tag' }")
		&& view.source.nodesByRowKey.get(view.selection!.rowKey)!.label === "'Changed Tag'", 'effect: tag editing preserves literal case and selects its written occurrence');
	await press('ControlLeft', 'KeyZ');
	await select('required_tags'); await open(); await paste("{ 'one', 'two' }");
	await press('Tab');
	check(!editor.active && model.buffer.getText() === ACTIONEFFECT_SOURCE.replace('required_tags = required', "required_tags = { 'one', 'two' }"),
		'effect: valid blur replaces the reference occurrence, not the shared initializer');
	await press('ControlLeft', 'KeyZ');
	const handler = await select('handler');
	await runPaletteCommand('Behavior Lens: Edit Authored Property');
	check(getActiveTab().kind === 'code_editor' && activeCodeEditor.model === model
		&& activeCodeEditor.view.cursorRow === handler.field.value.range.start.line - 1 && !editor.active,
		'effect: multiline code uses the full source editor, not a flattened cell');
	await press('AltLeft', 'ArrowLeft');
	await select('period_ms'); await open(); await paste('45');
	version = model.version;
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- invalidates draft' }]); await frame();
	check(!editor.active && !editor.control.pending && model.version === version + 1,
		'effect: another source revision cancels the draft without applying stale coordinates');
	await press('ControlLeft', 'KeyZ');
	harness.openLuaSource(model.resource.path); await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'effect: source history restores the original fixture resource');
	await press('ControlLeft', 'KeyS'); await until(() => !model.dirty, 'effect: restore saved original source');
	check(cycles() === position && ide.sources.currentBlua32Media === media, 'effect: authoring and Save never execute or replace the paused machine');
	console.info('STUDIO: ActionEffect authored value / draft / Save / Undo PASS');
}
