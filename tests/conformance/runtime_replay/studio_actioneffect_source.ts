import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import type { BehaviorLensEditorPane } from '../../../ide/workbench/contrib/behavior_lens/editor_pane';
import { inputFocus } from '../../../ide/input/focus';
import { WHEEL_SCROLL_STEP } from '../../../ide/common/constants';
import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { ACTIONEFFECT_PARTIAL_SOURCE, ACTIONEFFECT_SOURCE } from '../../helpers/actioneffect_source_fixture';
import { chooseBehavior, revealLensOccurrence } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Same canonical fixture as the compiled cartlib oracle, edited only in the paused source model. */
export async function testStudioActionEffectSource(test: StudioFixture): Promise<void> {
	const { ide, harness, input, clock, click, frame, press, runPaletteCommand, cycles } = test;
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
	let lens = getActiveTab();
	if (lens.kind !== 'behavior_lens') throw new Error('ActionEffect source: expected the actual lens input');
	let view = lens.view;
	let properties = view.presentation;
	if (properties.kind !== 'properties') throw new Error('ActionEffects must open the concrete property inspector');
	const second = view.document.definitions[1];
	if (second.behaviorKind !== 'action_effect') throw new Error('ActionEffect source: expected the second fixture registration');
	check(view.definitionRowKey === second.rowKey && second.body!.fields.length === 12,
		'ActionEffect source: picker selects the second effect, not its file or shared initializer');
	for (let index = 0; index < second.body!.fields.length; index += 1) {
		check(second.body!.fields[index].source === second.children[index], 'ActionEffect source: typed fields and property inspector share one source occurrence');
	}
	const blocked = second.body!.fields.find(field => field.kind === 'list' && field.name === 'blocked_tags')!;
	if (blocked.kind !== 'list') throw new Error('ActionEffect source: authored blocked-tag list required');
	const blockedRow = properties.nodesBySource.get(blocked.source.rowKey)!, tag = blocked.entries[0].node;
	const tagRow = properties.nodesBySource.get(tag.rowKey)!;
	check(blockedRow.element.value === '1 VALUE' && tagRow.element.label === '' && tagRow.element.value === "'blocked'"
		&& tagRow.element.displayValueLeft < properties.tree.layout.valueLeft, 'ActionEffect: one full-width tag value, no duplicate constructor or ordinal label');
	await revealLensOccurrence(test, view, tag.rowKey);
	const version = model.version;
	await runPaletteCommand('Behavior Lens: Open Source Details');
	const inspector = (ide.editor.editorPanes.activePane as BehaviorLensEditorPane).inspector;
	check(inspector.visible && inspector.model.rows[0].element.label.includes('BLOCKED TAGS') && inspector.model.rows[0].element.value === "'blocked'",
		'ActionEffect: full requirement inspection retains its field role and exact value');
	await click(inspector.actionBar.items[0].bounds, 6);
	check(getActiveTab() === code && activeCodeEditor.view.cursorRow === tag.authoredRange.start.line - 1 && model.version === version,
		'ActionEffect: held inspector Source opens the individual tag without editing');
	await press('AltLeft', 'ArrowLeft');
	check(getActiveTab() === lens, 'ActionEffect: normal Back returns to the same retained properties');
	const handler = second.body!.fields.find(field => field.kind === 'value' && field.name === 'handler')!;
	check(properties.nodesBySource.get(handler.source.rowKey)!.element.value === 'function(owner, payload)', 'ActionEffect: inline handler identifies its actual parameters');
	await revealLensOccurrence(test, view, handler.source.rowKey);
	await runPaletteCommand('Behavior Lens: Open Source Details');
	check(inspector.model.rows[0].element.value.includes('OWNER.LAST_PAYLOAD = PAYLOAD'), 'ActionEffect: complete handler body is inspectable, not a function placeholder');
	await press('Escape');
	check(model.version === version && cycles() === position, 'ActionEffect: property inspection changes neither source nor paused guest time');
	await press('Home');
	const grant = properties.tree.roots[0];
	test.setKey('Enter', true);
	for (let index = 0; index < 6; index += 1) await frame();
	test.setKey('Enter', false); await frame();
	check(grant.collapsed && view.selection === null && getActiveTab() === lens, 'ActionEffect controls: held Enter folds once without opening fake group source');
	await press('Enter');
	const groupBounds = { left: properties.tree.layout.valueLeft, right: properties.tree.layout.contentRight,
		top: properties.tree.layout.contentTop, bottom: properties.tree.layout.contentTop + properties.tree.layout.rowHeight };
	await click(groupBounds); await click(groupBounds);
	check(grant.collapsed && properties.collapsedGroups.has('grant'), 'ActionEffect controls: group double-click folds its retained children');
	const focus = inputFocus.target;
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	await press('ArrowRight');
	check(grant.collapsed, 'ActionEffect controls: palette arrows cannot operate the hidden property tree');
	await press('Escape');
	check(inputFocus.target === focus, 'ActionEffect controls: palette cancellation restores property focus');
	input.connectInputDevice({ id: 'gamepad:0', kind: 'gamepad', gamepadIndex: 0, label: 'PROPERTY CONFORMANCE PAD',
		vibrationInitialization: null, supportsVibration: false, setVibration() {} });
	await frame();
	let padPressId = 81000;
	for (const button of ['right', 'down', 'left']) {
		input.inputButton('gamepad:0', button, true, 1, clock.now() + 1, ++padPressId); await frame();
		input.inputButton('gamepad:0', button, false, 0, clock.now() + 1, ++padPressId); await frame();
	}
	check(!grant.collapsed && properties.tree.rows[properties.tree.selectionIndex] === grant,
		'ActionEffect controls: controller expands, enters a property and returns to its actual group');
	input.inputButton('gamepad:0', 'a', true, 1, clock.now() + 1, ++padPressId);
	for (let index = 0; index < 6; index += 1) await frame();
	input.inputButton('gamepad:0', 'a', false, 0, clock.now() + 1, ++padPressId); await frame();
	check(grant.collapsed && getActiveTab() === lens, 'ActionEffect controls: held controller A folds once');
	input.disconnectInputDevice('gamepad:0');
	await press('ArrowRight');
	const period = second.body!.fields.find(field => field.kind === 'value' && field.name === 'period_ms')!;
	await revealLensOccurrence(test, view, period.source.rowKey);
	console.info('STUDIO: ActionEffect complete properties ready for visual inspection');
	let tree = properties.tree;
	const propertyTop = tree.layout.contentTop + (tree.selectionIndex - tree.scroll) * tree.layout.rowHeight;
	const propertyBounds = { left: tree.layout.valueLeft, right: tree.layout.contentRight, top: propertyTop, bottom: propertyTop + tree.layout.rowHeight };
	await click(propertyBounds);
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	await press('Escape');
	await click(propertyBounds, 6);
	check(getActiveTab() === lens, 'ActionEffect controls: palette focus interrupts a property double-click sequence');
	await click(propertyBounds, 6);
	const row = ACTIONEFFECT_SOURCE.split('\n').findIndex(line => line.includes('period_ms = 20'));
	check(getActiveTab() === code && activeCodeEditor.view.cursorRow === row && !hasSelection(),
		'ActionEffect controls: held property double-click opens its exact source without a code drag');
	await test.clickTab(lens.id);
	await click(properties.actionBar.items[0].bounds, 6);
	check(getActiveTab() === code && activeCodeEditor.view.cursorRow === row && !hasSelection(),
		'ActionEffect source: held Source click opens the selected field without dragging code');
	await test.clickTab(lens.id);
	await click(propertyBounds, 1, 'pointer_secondary');
	check(ide.editor.contextMenu.visible && view.selection?.rowKey === period.source.rowKey,
		'ActionEffect context: right click targets the property without expanding or activating it');
	await press('Home'); await press('Enter');
	check(getActiveTab() === code && activeCodeEditor.view.cursorRow === row && !hasSelection(),
		'ActionEffect context: shared menu opens exact field source without editing');
	const oldDocument = view.document;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- 🐉 effect source\n' }]);
	const offset = model.buffer.getText().indexOf('period_ms = 20') + 'period_ms = '.length;
	model.pushEditOperations([{ offset, deleteLength: 2, text: '35' }]);
	await frame();
	check(view.document === oldDocument, 'ActionEffect source: hidden edits map source correspondence without projecting per frame');
	await test.clickTab(lens.id);
	const current = view.document.definitions[1];
	if (current.behaviorKind !== 'action_effect') throw new Error('ActionEffect source: current definition must be an effect');
	const changed = current.body!.fields.find(field => field.kind === 'value' && field.name === 'period_ms')!;
	check(current !== second && view.definitionRowKey === current.rowKey && view.selection!.rowKey === changed.source.rowKey
		&& changed.source.label === 'period_ms = 35', 'ActionEffect source: activation refreshes the field within the selected registration');
	const retained = view.document;
	const rows = properties.tree.rows;
	for (let index = 0; index < 30; index += 1) await frame();
	check(view.document === retained && properties.tree.rows === rows && lens.graphLayout.state.kind === 'idle',
		'ActionEffect source: idle frames reuse source and property storage and never request a graph layout');
	await click(properties.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.view.cursorRow === row + 1 && !hasSelection(), 'ActionEffect source: navigation follows UTF-16 source edits');
	await press('ControlLeft', 'KeyZ');
	await test.clickTab(lens.id);
	check(view.source.nodesByRowKey.get(view.selection!.rowKey)!.label === 'period_ms = 20'
		&& view.definitionRowKey === view.document.definitions[1].rowKey, 'ActionEffect source: ordinary Undo restores the value in the same effect occurrence');
	await click(properties.actionBar.items[0].bounds);
	await press('ControlLeft', 'KeyZ');
	await runPaletteCommand('Behavior Lens: Open ActionEffect');
	await chooseBehavior(test, 'EFFECT fixture.first', 'ACTIONEFFECTS');
	const chosen2 = getActiveTab();
	if (chosen2.kind !== 'behavior_lens' || chosen2.view.presentation.kind !== 'properties') throw new Error('ActionEffect: selected definition input missing');
	check(chosen2 !== lens && chosen2.workingCopy === model, 'ActionEffect: distinct definition input shares the text owner');
	lens = chosen2; view = lens.view; properties = chosen2.view.presentation; tree = properties.tree;
	check(getActiveTab() === lens && view.definitionRowKey === view.document.definitions[0].rowKey,
		'ActionEffect source: both registrations remain independently selectable with their own retained inputs');
	await click(properties.actionBar.items[0].bounds);
	check(activeCodeEditor.view.cursorRow === ACTIONEFFECT_SOURCE.split('\n').findIndex(line => line.startsWith("effects.register_effect('fixture.first'")),
		'ActionEffect source: definition Source opens its registration use, not the shared constructor');
	model.pushEditOperations([{ offset: model.buffer.getText().indexOf("{ 'ready' }"), deleteLength: "{ 'ready' }".length,
		text: "{ 'ready', 'aim', 'armed', 'visible', 'grounded', 'moving', 'awake' }" }]);
	await test.clickTab(lens.id);
	await press('Home');
	check(tree.rows.length > tree.layout.visibleRowCount, 'ActionEffect controls: authored requirements exceed the actual property viewport');
	test.movePointer({ left: 200, right: 202, top: tree.layout.contentTop + 4, bottom: tree.layout.contentTop + 6 });
	await frame();
	input.inputAxis1('pointer:0', 'pointer_wheel', WHEEL_SCROLL_STEP * 2, clock.now());
	await frame();
	check(tree.scroll > 0, 'ActionEffect controls: physical wheel scrolls the property list');
	await press('End');
	check(tree.selectionIndex === tree.rows.length - 1 && tree.scroll === tree.rows.length - tree.layout.visibleRowCount,
		'ActionEffect controls: End reveals the final source property at native font size');
	await press('Home');
	check(tree.scroll === 0, 'ActionEffect controls: Home reveals the first group');
	await click(properties.actionBar.items[0].bounds);
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === ACTIONEFFECT_SOURCE, 'ActionEffect controls: ordinary source Undo removes the scroll fixture');
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: ACTIONEFFECT_PARTIAL_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open ActionEffect');
	await chooseBehavior(test, 'EFFECT fixture.partial', 'ACTIONEFFECTS');
	const chosen3 = getActiveTab();
	if (chosen3.kind !== 'behavior_lens' || chosen3.view.presentation.kind !== 'properties') throw new Error('ActionEffect: selected definition input missing');
	check(chosen3 !== lens && chosen3.workingCopy === model, 'ActionEffect: distinct definition input shares the text owner');
	lens = chosen3; view = lens.view; properties = chosen3.view.presentation; tree = properties.tree;
	const partial = view.document.definitions[0];
	if (partial.behaviorKind !== 'action_effect') throw new Error('ActionEffect source: expected partial fixture');
	const unknown = partial.body!.fields[1];
	check(unknown.kind === 'unknown' && unknown.source.resolution === 'unresolved', 'ActionEffect source: computed field remains an explicit source occurrence');
	await revealLensOccurrence(test, view, unknown.source.rowKey);
	console.info('STUDIO: ActionEffect partial source ready for visual inspection');
	await click(properties.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.view.cursorRow === 4 && activeCodeEditor.view.cursorColumn === 1 && !hasSelection(),
		'ActionEffect source: unknown-field Source navigates to its computed Lua key');
	await test.clickTab(lens.id);
	const required = partial.body!.fields[2];
	if (required.kind !== 'list') throw new Error('ActionEffect source: expected authored requirement list');
	await revealLensOccurrence(test, view, required.entries[1].node.rowKey);
	await click(properties.actionBar.items[0].bounds, 6);
	check(activeCodeEditor.view.cursorRow === 1 && activeCodeEditor.view.cursorColumn === ACTIONEFFECT_PARTIAL_SOURCE.split('\n')[1].indexOf("'fourth'") && !hasSelection(),
		'ActionEffect source: requirement entry opens its initializer expression, not the effect field or a guessed dense index');
	await press('ControlLeft', 'KeyZ');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original, 'ActionEffect source: ordinary Undo removes both standalone source fixtures');
	check(cycles() === position && ide.sources.currentBlua32Media === media,
		'ActionEffect source: analysis, source gestures and Undo neither execute Lua nor install media in the paused machine');
}
