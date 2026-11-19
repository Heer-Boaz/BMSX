import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { insertValue } from '../../ide/editor/ui/inline/text_field';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController, type QuickPickOptions } from '../../ide/workbench/services/quick_input/controller';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';

type Choice = { id: number; label: string; description: string; detail: string };
const REJECTION = 'Blocked';

function fixture(t: TestContext, options: QuickPickOptions<Choice> = {}) {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const area = { left: 0, top: 0, right: 384, bottom: 288 };
	const menu = new ContextMenuController(inputFocus, pointerCapture, area);
	const picker = new QuickInputController(menu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: area, kind: 'workspace' });
	const origin = inputFocus.createTarget(null, new InputFocusScope(Symbol('validation origin'), inputFocus.workbenchScope));
	origin.focus();
	const choices: Choice[] = [{ id: 1, label: 'first', description: '', detail: '' }, { id: 2, label: 'second', description: '', detail: '' }];
	const provider = new TextQuickPickProvider(choices);
	const accepted: { item: Choice; modifiers: KeyModifier }[] = [];
	let retirements = 0;
	picker.pick('Choose', '', () => provider, (item, modifiers) => { accepted.push({ item, modifiers }); },
		lifetime => lifetime.add({ dispose: () => { retirements++; } }), options);
	const key = (code: string, modifiers = KeyModifier.none) => inputFocus.handleKeyboard(new KeyInputEvent(code, modifiers));
	const pointer = (index: number, pressed: boolean, modifiers = KeyModifier.none) => {
		const model = picker.model, bounds = model.viewport.bounds;
		const snapshot: PointerInputSnapshot = { valid: true, insideViewport: true,
			viewportX: bounds.left + 2, viewportY: model.rowTop(index) + 2,
			pressedButtons: pressed ? PointerButton.Primary : 0,
			justPressedButtons: pressed ? PointerButton.Primary : 0,
			justReleasedButtons: pressed ? 0 : PointerButton.Primary, modifiers, spaceDown: false };
		if (!pointerCapture.dispatch(snapshot, false, 0, picker.pointerScope)) picker.handlePointer(snapshot, pressed);
	};
	t.after(() => { picker.dispose(); menu.dispose(); pointerCapture.cancel(); inputFocus.setTarget(null); });
	return { picker, origin, choices, provider, accepted, key, pointer, area, retirements: () => retirements };
}

for (const code of ['Enter', 'NumpadEnter'] as const) test(`${code} veto retains the chosen input and its owner until acceptance`, t => {
	const attempts: { item: Choice; modifiers: KeyModifier }[] = [];
	const f = fixture(t, { validateSelection: (item, modifiers) => {
		attempts.push({ item, modifiers }); return modifiers === KeyModifier.alt ? undefined : REJECTION;
	} });
	insertValue(f.picker.field, 'first'); f.picker.update();
	const rows = f.picker.model.list.rows, selected = rows[f.picker.model.list.selectionIndex];
	f.key(code);
	assert.equal(f.picker.visible, true); assert.equal(f.picker.field.text, 'first');
	assert.equal(f.picker.model.list.rows, rows); assert.equal(f.picker.model.list.rows[f.picker.model.list.selectionIndex], selected);
	assert.equal(inputFocus.admittedTarget, f.picker.field.focusTarget); assert.equal(f.retirements(), 0); assert.equal(f.accepted.length, 0);
	// The validation explanation is caller-supplied data and is presented with the choices.
	assert.equal(f.picker.message, REJECTION); assert.deepEqual(f.picker.layout.messageLines, [REJECTION]);
	assert.ok(f.picker.layout.renderRows.length > 0);
	f.key(code, KeyModifier.alt);
	assert.equal(f.picker.visible, false); assert.equal(f.retirements(), 1); assert.equal(inputFocus.admittedTarget, f.origin);
	assert.deepEqual(attempts, [{ item: f.choices[0], modifiers: KeyModifier.none }, { item: f.choices[0], modifiers: KeyModifier.alt }]);
	assert.deepEqual(f.accepted, [{ item: f.choices[0], modifiers: KeyModifier.alt }]);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} draws validation feedback without replacing picker results`, t => {
	const f = fixture(t, { validateSelection: () => REJECTION });
	configureFontVariant(font); f.picker.update(); f.key('Enter');
	for (const method of ['pushClipRect', 'popClipRect', 'fill_rect', 'fill_rect_color', 'blit_rect', 'blit_text_inline_span_with_font'] as const)
		t.mock.method(api, method, () => {});
	const text = t.mock.method(api, 'blit_text_inline_with_font', () => {});
	f.picker.draw();
	// The caller-supplied diagnostic is data, not an incidental UI label.
	assert.ok(text.mock.calls.some(call => call.arguments[0] === REJECTION));
	assert.ok(f.picker.layout.renderRows.length > 0); assert.equal(f.picker.visible, true);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} retains both validation and choices when a long diagnostic needs truncation`, t => {
	const f = fixture(t, { validateSelection: () => 'A long diagnostic which must remain visible while the selectable list remains usable. '.repeat(10) });
	configureFontVariant(font); f.area.right = 196; f.area.bottom = 150; f.picker.update(); f.key('Enter');
	assert.ok(f.picker.layout.messageLines.length > 0); assert.ok(f.picker.layout.renderRows.length > 0);
	assert.ok(f.picker.layout.messageLines.at(-1)!.endsWith('…'), 'the focused wrapping contract uses one truncation glyph');
	f.key('ArrowDown'); f.picker.update();
	assert.equal(f.picker.message, ''); assert.equal(f.picker.model.list.selectionIndex, 1);
});

test('pointer veto consumes release modifiers, not the earlier press modifiers', t => {
	const attempts: KeyModifier[] = [];
	const f = fixture(t, { validateSelection: (_item, modifiers) => { attempts.push(modifiers); return modifiers === KeyModifier.alt ? undefined : REJECTION; } });
	f.pointer(0, true, KeyModifier.alt); f.pointer(0, false);
	assert.equal(f.picker.visible, true); assert.equal(f.accepted.length, 0); assert.equal(f.picker.message, REJECTION);
	f.pointer(0, true); f.pointer(0, false, KeyModifier.alt);
	assert.deepEqual(attempts, [KeyModifier.none, KeyModifier.alt]);
	assert.deepEqual(f.accepted, [{ item: f.choices[0], modifiers: KeyModifier.alt }]);
});

test('changing selection by pointer after a veto accepts the row under the original captured press', t => {
	const f = fixture(t, { validateSelection: item => item.id === 1 ? REJECTION : undefined });
	f.key('Enter'); assert.equal(f.picker.message, REJECTION);
	f.pointer(1, true); assert.equal(f.picker.visible, true);
	f.picker.update(); // Normal repaint/layout while the pointer is still held.
	f.pointer(1, false);
	assert.deepEqual(f.accepted, [{ item: f.choices[1], modifiers: KeyModifier.none }]);
	assert.equal(f.picker.visible, false); assert.equal(f.retirements(), 1);
});

for (const second of [REJECTION, 'A longer explanation for the newly selected choice'] as const)
	test('cancelling an earlier held pointer cannot erase a later validation publication', t => {
		const f = fixture(t, { validateSelection: item => item.id === 1 ? REJECTION : second });
		f.key('Enter'); assert.equal(f.picker.message, REJECTION);
		f.pointer(1, true);
		f.key('Enter'); assert.equal(f.picker.message, second);
		pointerCapture.cancel();
		assert.equal(f.picker.message, second); assert.equal(f.picker.visible, true);
		assert.equal(f.accepted.length, 0); assert.equal(f.retirements(), 0);
	});

for (const change of ['query', 'arrow', 'home', 'provider'] as const) test(`${change} change retires the stale validation result`, t => {
	const f = fixture(t, { validateSelection: () => REJECTION });
	f.key('Enter'); assert.equal(f.picker.message, REJECTION);
	if (change === 'query') insertValue(f.picker.field, 's');
	else if (change === 'arrow') f.key('ArrowDown');
	else if (change === 'home') f.key('End', KeyModifier.ctrl);
	else { f.choices[0].detail = 'updated'; f.provider.refresh(); }
	f.picker.update(); assert.equal(f.picker.message, ''); assert.equal(f.picker.visible, true);
	assert.equal(f.accepted.length, 0); assert.equal(f.retirements(), 0);
});

for (const change of ['replacement', 'hide', 'origin', 'selection', 'query', 'provider', 'focus'] as const)
	test(`a reentrant ${change} during validation cannot hand off the stale choice`, t => {
		let transition: () => void = () => {};
		const f = fixture(t, { validateSelection: () => { transition(); return undefined; } });
		let replacementAccepts = 0;
		if (change === 'replacement') transition = () => f.picker.pick('New', '', () => f.provider, () => { replacementAccepts++; });
		else if (change === 'hide') transition = () => f.picker.hide();
		else if (change === 'origin') transition = () => f.origin.scope.retireContext();
		else if (change === 'selection') transition = () => { f.picker.model.list.selectionIndex = 1; };
		else if (change === 'query') transition = () => insertValue(f.picker.field, 'second');
		else if (change === 'provider') transition = () => { f.choices[0].detail = 'updated'; f.provider.refresh(); };
		else transition = () => inputFocus.createTarget().focus();
		f.picker.accept();
		assert.equal(f.accepted.length, 0); assert.equal(replacementAccepts, 0);
		if (change === 'replacement' || change === 'selection' || change === 'query' || change === 'provider')
			assert.equal(f.picker.visible, true);
		else assert.equal(f.picker.visible, false);
	});

test('Escape after a veto retires the original owner without accepting', t => {
	const f = fixture(t, { validateSelection: () => REJECTION });
	f.key('Enter'); f.key('Escape');
	assert.equal(f.picker.visible, false); assert.equal(f.retirements(), 1); assert.equal(f.accepted.length, 0);
	assert.equal(inputFocus.admittedTarget, f.origin);
});
