import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { editorChromeState } from '../../../ide/workbench/ui/chrome_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { ACTIONEFFECT_PARTIAL_SOURCE, ACTIONEFFECT_SOURCE } from '../../helpers/actioneffect_source_fixture';
import { behaviorOutline, chooseBehavior, revealLensOccurrence } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Same canonical fixture as the compiled cartlib oracle, edited only in the paused source model. */
export async function testStudioActionEffectSource(test: StudioFixture): Promise<void> {
	const { ide, harness, click, frame, press, runPaletteCommand, cycles } = test;
	console.info('STUDIO: ActionEffect typed properties and requirements retain actual source occurrences');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: ACTIONEFFECT_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open ActionEffect');
	await chooseBehavior(test, 'EFFECT fixture.second', 'ACTIONEFFECTS');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens') throw new Error('ActionEffect source: expected the actual lens input');
	const view = lens.view;
	const outline = behaviorOutline(view);
	const second = view.document.definitions[1];
	if (second.behaviorKind !== 'action_effect') throw new Error('ActionEffect source: expected the second fixture registration');
	check(view.definitionRowKey === second.rowKey && second.body!.fields.length === 12,
		'ActionEffect source: picker selects the second effect, not its file or shared initializer');
	for (let index = 0; index < second.body!.fields.length; index += 1) {
		check(second.body!.fields[index].source === second.children[index], 'ActionEffect source: typed fields and visible outline share one source occurrence');
	}
	const period = second.body!.fields.find(field => field.kind === 'value' && field.name === 'period_ms')!;
	await revealLensOccurrence(test, view, period.source.rowKey);
	await click(outline.actionBar.items[0].bounds, 6);
	const row = ACTIONEFFECT_SOURCE.split('\n').findIndex(line => line.includes('period_ms = 20'));
	check(getActiveTab() === code && activeCodeEditor.view.cursorRow === row && !hasSelection(),
		'ActionEffect source: held Source click opens the selected field without dragging code');
	const oldDocument = view.document;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- 🐉 effect source\n' }]);
	const offset = model.buffer.getText().indexOf('period_ms = 20') + 'period_ms = '.length;
	model.pushEditOperations([{ offset, deleteLength: 2, text: '35' }]);
	await frame();
	check(view.document === oldDocument, 'ActionEffect source: hidden edits map source correspondence without projecting per frame');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	const current = view.document.definitions[1];
	if (current.behaviorKind !== 'action_effect') throw new Error('ActionEffect source: current definition must be an effect');
	const changed = current.body!.fields.find(field => field.kind === 'value' && field.name === 'period_ms')!;
	check(current !== second && view.definitionRowKey === current.rowKey && view.selection!.rowKey === changed.source.rowKey
		&& changed.source.label === 'period_ms = 35', 'ActionEffect source: activation refreshes the field within the selected registration');
	const retained = view.document;
	const rows = outline.rows;
	for (let index = 0; index < 30; index += 1) await frame();
	check(view.document === retained && outline.rows === rows && lens.graphLayout.state.kind === 'idle',
		'ActionEffect source: idle frames reuse source and outline storage and never request a graph layout');
	await click(outline.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.view.cursorRow === row + 1 && !hasSelection(), 'ActionEffect source: navigation follows UTF-16 source edits');
	await press('ControlLeft', 'KeyZ');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	check(view.nodesByRowKey.get(view.selection!.rowKey)!.label === 'period_ms = 20'
		&& view.definitionRowKey === view.document.definitions[1].rowKey, 'ActionEffect source: ordinary Undo restores the value in the same effect occurrence');
	await click(outline.actionBar.items[0].bounds);
	await press('ControlLeft', 'KeyZ');
	await runPaletteCommand('Behavior Lens: Open ActionEffect');
	await chooseBehavior(test, 'EFFECT fixture.first', 'ACTIONEFFECTS');
	check(getActiveTab() === lens && view.definitionRowKey === view.document.definitions[0].rowKey,
		'ActionEffect source: both registrations remain independently selectable in the same retained input');
	await click(outline.actionBar.items[0].bounds);
	check(activeCodeEditor.view.cursorRow === ACTIONEFFECT_SOURCE.split('\n').findIndex(line => line.startsWith("effects.register_effect('fixture.first'")),
		'ActionEffect source: definition Source opens its registration use, not the shared constructor');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: ACTIONEFFECT_PARTIAL_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open ActionEffect');
	await chooseBehavior(test, 'EFFECT fixture.partial', 'ACTIONEFFECTS');
	const partial = view.document.definitions[0];
	if (partial.behaviorKind !== 'action_effect') throw new Error('ActionEffect source: expected partial fixture');
	const unknown = partial.body!.fields[1];
	check(unknown.kind === 'unknown' && unknown.source.resolution === 'unresolved', 'ActionEffect source: computed field remains an explicit source occurrence');
	await revealLensOccurrence(test, view, unknown.source.rowKey);
	console.info('STUDIO: ActionEffect partial source ready for visual inspection');
	await click(outline.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.view.cursorRow === 4 && activeCodeEditor.view.cursorColumn === 1 && !hasSelection(),
		'ActionEffect source: unknown-field Source navigates to its computed Lua key');
	await click(editorChromeState.tabButtonBounds.get(lens.id)!);
	const required = partial.body!.fields[2];
	if (required.kind !== 'list') throw new Error('ActionEffect source: expected authored requirement list');
	await revealLensOccurrence(test, view, required.entries[1].node.rowKey);
	await click(outline.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.view.cursorRow === 1 && activeCodeEditor.view.cursorColumn === ACTIONEFFECT_PARTIAL_SOURCE.split('\n')[1].indexOf("'fourth'") && !hasSelection(),
		'ActionEffect source: requirement entry opens its initializer expression, not the effect field or a guessed dense index');
	await press('ControlLeft', 'KeyZ');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'ActionEffect source: ordinary Undo removes both standalone source fixtures');
	check(cycles() === position && ide.sources.currentBlua32Media === media,
		'ActionEffect source: analysis, source gestures and Undo neither execute Lua nor install media in the paused machine');
}
