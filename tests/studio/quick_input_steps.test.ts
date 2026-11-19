import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { measureText } from '../../ide/editor/common/text/layout';
import { insertValue } from '../../ide/editor/ui/inline/text_field';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { api } from '../../ide/runtime/overlay_api';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController, type QuickInputOptions } from '../../ide/workbench/services/quick_input/controller';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import { createActualSourcePanes } from '../helpers/source_panes';

function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny') {
	configureFontVariant(font);
	const area = { left: 0, top: 0, right: 384, bottom: 288 };
	const menu = new ContextMenuController(inputFocus, pointerCapture, area);
	const picker = new QuickInputController(menu, undefined, undefined, { kind: 'workspace', bounds: area, scope: inputFocus.workbenchScope });
	const origin = inputFocus.createTarget(null, new InputFocusScope(Symbol('step source'), inputFocus.workbenchScope));
	t.after(origin.bindKeyboard(() => {})); origin.focus();
	const listeners = new Set<() => void>();
	const owner = {
		isDisposed: false,
		onWillDispose(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		dispose() { this.isDisposed = true; for (const listener of listeners) listener(); },
	};
	const items = [{ label: 'target', description: '', detail: '' }, { label: 'other', description: '', detail: '' }];
	let accepted = 0, backs = 0;
	const first = { index: 1, total: 2 };
	const firstStep = () => picker.pick('Choose target', '', () => new TextQuickPickProvider(items), () => secondStep(), undefined,
		{ owner, invocationOrigin: origin, step: first });
	const second = { index: 2, total: 2, back: () => { backs++; firstStep(); } };
	const secondStep = (options: QuickInputOptions = {}) => picker.pick('Choose placement', '', () => new TextQuickPickProvider(items), () => { accepted++; }, undefined,
		{ owner, invocationOrigin: origin, step: second, ...options });
	const pointer = (x: number, y: number, held = 0, down = 0, up = 0) => {
		const snapshot: PointerInputSnapshot = { viewportX: x, viewportY: y, pressedButtons: held, justPressedButtons: down,
			justReleasedButtons: up, modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true };
		if (!pointerCapture.dispatch(snapshot, false, 0, picker.pointerScope) && picker.visible) picker.handlePointer(snapshot, down !== 0);
	};
	const pressBack = () => {
		const back = picker.layout.back, x = (back.left + back.right) / 2, y = (back.top + back.bottom) / 2;
		pointer(x, y, PointerButton.Primary, PointerButton.Primary); return { x, y };
	};
	const key = (code: string, modifiers = KeyModifier.none) => { const event = new KeyInputEvent(code, modifiers); inputFocus.handleKeyboard(event); return event; };
	t.after(() => { picker.dispose(); menu.dispose(); pointerCapture.cancel(); pointerHover.clear(); inputFocus.setTarget(null); });
	return { picker, area, origin, owner, items, first, second, firstStep, secondStep, pointer, pressBack, key, accepted: () => accepted, backs: () => backs };
}

for (const font of ['tiny', 'msx'] as const) test(`${font} Back returns to the first step with a fresh query, not an accepted fake row`, t => {
	const f = fixture(t, font); f.firstStep();
	assert.equal(f.picker.step, f.first); f.picker.accept(); assert.equal(f.picker.step, f.second);
	assert.equal(f.picker.model.items.length, f.items.length);
	insertValue(f.picker.field, 'draft');
	const event = f.key('ArrowLeft', KeyModifier.alt);
	assert.equal(event.consumed, true); assert.equal(f.backs(), 1); assert.equal(f.accepted(), 0);
	assert.equal(f.picker.visible, true); assert.equal(f.picker.step, f.first); assert.equal(f.picker.field.text, '');
	assert.equal(f.picker.invocationOrigin, f.origin); assert.equal(inputFocus.admittedTarget, f.picker.field.focusTarget);
	assert.equal(f.picker.model.items.length, f.items.length);
});

test('the title back button commits only its matching physical primary release', t => {
	const f = fixture(t); f.secondStep(); const { x, y } = f.pressBack();
	assert.equal(pointerCapture.active, true); assert.equal(f.backs(), 0); assert.equal(f.accepted(), 0);
	f.pointer(x, y, PointerButton.Primary, 0, PointerButton.Secondary);
	assert.equal(f.backs(), 0); assert.equal(f.picker.step, f.second);
	f.pointer(x, y, 0, 0, PointerButton.Primary);
	assert.equal(f.backs(), 1); assert.equal(f.accepted(), 0); assert.equal(f.picker.step, f.first);
	assert.equal(pointerCapture.active, false);
});

for (const change of ['font', 'layout', 'replacement', 'source retirement', 'owner disposal', 'query', 'hide'] as const)
test(`a captured back button is cancelled by ${change}`, t => {
	const f = fixture(t); f.secondStep(); const { x, y } = f.pressBack();
	if (change === 'font') configureFontVariant('msx');
	if (change === 'layout') f.area.left += 8;
	if (change === 'replacement') f.secondStep({ step: { index: 2, total: 2, back: () => assert.fail('replacement gesture committed') } });
	if (change === 'source retirement') f.origin.scope.retireContext();
	if (change === 'owner disposal') f.owner.dispose();
	if (change === 'query') insertValue(f.picker.field, 'target');
	if (change === 'hide') f.picker.hide();
	f.picker.update(); assert.equal(pointerCapture.active, false);
	f.pointer(x, y, 0, 0, PointerButton.Primary);
	assert.equal(f.backs(), 0); assert.equal(f.accepted(), 0);
});

for (const release of ['outside', 'lost'] as const) test(`${release} pointer input never commits Back`, t => {
	const f = fixture(t); f.secondStep(); const { x, y } = f.pressBack();
	f.pointer(release === 'outside' ? f.picker.layout.back.right + 10 : x, y, 0, 0, release === 'lost' ? 0 : PointerButton.Primary);
	assert.equal(f.backs(), 0); assert.equal(f.accepted(), 0); assert.equal(f.picker.step, f.second);
});

for (const retirement of ['native', 'semantic', 'resource'] as const)
test(`the source lease blocks Back when its ${retirement} owner retires during focus return`, t => {
	const f = fixture(t), semantic = inputFocus.createTarget(null, new InputFocusScope(Symbol('semantic source'), inputFocus.workbenchScope));
	if (retirement === 'semantic') f.origin.commandContext = semantic;
	f.secondStep();
	t.after(f.origin.onDidFocus(() => {
		if (retirement === 'resource') f.owner.dispose();
		else (retirement === 'semantic' ? semantic : f.origin).scope.retireContext();
	}));
	f.key('ArrowLeft', KeyModifier.alt);
	assert.equal(f.backs(), 0); assert.equal(f.accepted(), 0); assert.equal(f.picker.visible, false);
});

for (const newer of ['foreground', 'picker'] as const) test(`focus-return observers keep their newer ${newer} instead of running Back`, t => {
	const f = fixture(t), foreground = inputFocus.createTarget(); f.secondStep();
	const step = { index: 1, total: 1 };
	const unbind = f.origin.onDidFocus(() => {
		unbind();
		if (newer === 'foreground') foreground.focus();
		else f.secondStep({ step });
	}); t.after(unbind);
	f.key('ArrowLeft', KeyModifier.alt);
	assert.equal(f.backs(), 0); assert.equal(f.accepted(), 0);
	if (newer === 'foreground') { assert.equal(f.picker.visible, false); assert.equal(inputFocus.admittedTarget, foreground); }
	else { assert.equal(f.picker.step, step); assert.equal(inputFocus.admittedTarget, f.picker.field.focusTarget); }
});

test('disposal callbacks retain source admission through the same Back handoff as pick acceptance', t => {
	const f = fixture(t); let back = 0;
	f.picker.pick('Step', '', () => new TextQuickPickProvider(f.items), () => assert.fail('not acceptance'), lifetime => {
		lifetime.add({ dispose: () => f.owner.dispose() });
	}, { owner: f.owner, step: { index: 2, total: 2, back: () => { back++; } } });
	f.key('ArrowLeft', KeyModifier.alt);
	assert.equal(back, 0); assert.equal(f.picker.visible, false);
});

test('Backspace edits the query and Escape closes the whole stepped presentation without Back', t => {
	const f = fixture(t); f.secondStep(); insertValue(f.picker.field, 'ab');
	f.key('Backspace'); assert.equal(f.picker.field.text, 'a'); assert.equal(f.picker.step, f.second); assert.equal(f.backs(), 0);
	f.key('Escape'); assert.equal(f.picker.visible, false); assert.equal(f.backs(), 0); assert.equal(f.accepted(), 0);
	assert.equal(inputFocus.admittedTarget, f.origin); assert.equal(f.picker.step, undefined);
});

test('input-box Back retires an outstanding submission without accepting its later completion', async t => {
	const f = fixture(t); let complete!: (value: string) => void;
	f.picker.input('Step', '', '', () => new Promise<string>(resolve => { complete = resolve; }), () => assert.fail('retired operation accepted'), undefined,
		{ owner: f.owner, step: f.second });
	const pending = f.picker.accept(); assert.equal(f.picker.busy, true);
	f.key('ArrowLeft', KeyModifier.alt); assert.equal(f.picker.step, f.first); assert.equal(f.backs(), 1);
	complete('done'); await pending; assert.equal(f.picker.step, f.first); assert.equal(f.accepted(), 0);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} title layout reserves measured space for step progress and the shared back glyph`, t => {
	const f = fixture(t, font); f.area.right = 150; f.secondStep();
	const { layout } = f.picker;
	// The progress bytes and nonoverlap are the explicit title-layout contract.
	assert.equal(layout.stepText, '2/2');
	assert.ok(layout.titleLeft >= layout.back.right + 4); assert.ok(layout.back.bottom < layout.field.top);
	assert.ok(layout.titleLeft + measureText(f.picker.titleText) <= layout.stepLeft - 4);
	assert.ok(layout.stepLeft + measureText(layout.stepText) <= layout.bounds.right - 4);
	const revision = layout.revision, rows = f.picker.model.list.rows, step = f.picker.step;
	const measure = t.mock.method(editorViewState.font, 'advance', () => assert.fail('idle title measurement'));
	for (let frame = 0; frame < 100; frame++) f.picker.update();
	measure.mock.restore(); assert.equal(layout.revision, revision); assert.equal(f.picker.model.list.rows, rows); assert.equal(f.picker.step, step);
	const stepLeft = layout.stepLeft, backLeft = layout.back.left;
	f.area.left += 20; f.area.right += 20; f.picker.update();
	assert.equal(layout.stepLeft, stepLeft + 20); assert.equal(layout.back.left, backLeft + 20);
	for (const method of ['fill_rect', 'fill_rect_color', 'blit_rect', 'pushClipRect', 'popClipRect', 'blit_text_inline_span_with_font'] as const)
		t.mock.method(api, method, () => {});
	const text = t.mock.method(api, 'blit_text_inline_with_font', () => {});
	f.picker.draw();
	const progress = text.mock.calls.find(call => call.arguments[0] === layout.stepText)!;
	assert.ok(progress !== undefined); assert.equal(progress.arguments[5], editorViewState.font.renderFont());
});

test('ordinary no-step pickers keep row acceptance and do not install a global Back shortcut', t => {
	const f = fixture(t); let accepted = 0;
	f.picker.pick('Ordinary', '', () => new TextQuickPickProvider(f.items), () => { accepted++; });
	assert.equal(f.picker.step, undefined); assert.equal(f.picker.layout.back.left, f.picker.layout.back.right);
	f.key('ArrowLeft', KeyModifier.alt); assert.equal(f.picker.visible, true); assert.equal(f.backs(), 0);
	f.key('Enter'); assert.equal(accepted, 1); assert.equal(f.picker.visible, false);
	const event = f.key('ArrowLeft', KeyModifier.alt); assert.equal(event.consumed, false); assert.equal(f.backs(), 0);
});

for (const owner of ['workspace', 'part'] as const) test(`${owner} QuickInput Back owns Alt+Left through the full CartEditor command route`, t => {
	const f = createActualSourcePanes(t), picker = owner === 'workspace' ? f.editor.quickInput : f.firstPart.quickInput;
	f.first.focus(); const origin = inputFocus.admittedTarget;
	const items = [{ label: 'target', description: '', detail: '' }], first = { index: 1, total: 2 };
	let backs = 0, accepted = 0;
	const openFirst = () => picker.pick('Target', '', () => new TextQuickPickProvider(items), () => { accepted++; }, undefined,
		{ step: first, invocationOrigin: origin });
	picker.pick('Placement', '', () => new TextQuickPickProvider(items), () => { accepted++; }, undefined,
		{ step: { index: 2, total: 2, back: () => { backs++; openFirst(); } }, invocationOrigin: origin });
	assert.equal(picker.field.focusTarget.getCommand('navigateBack')!.isEnabled(), true);
	insertValue(picker.field, 'draft'); f.key('ArrowLeft', KeyModifier.alt);
	assert.equal(backs, 1); assert.equal(accepted, 0); assert.equal(picker.step, first); assert.equal(picker.field.text, '');
	assert.equal(picker.field.focusTarget.getCommand('navigateBack'), undefined);
	assert.equal(picker.invocationOrigin, origin); assert.equal(inputFocus.admittedTarget, picker.field.focusTarget);
	f.key('Escape'); assert.equal(picker.visible, false); assert.equal(inputFocus.admittedTarget, origin);
});

test('replacing and retiring stepped QuickInput removes only its own Back capability, not Source navigation', t => {
	const f = createActualSourcePanes(t), picker = f.editor.quickInput;
	f.first.focus(); let navigations = 0, backs = 0;
	f.first.code.focusTarget.registerCommand('navigateBack', { isEnabled: () => true, run: () => { navigations++; } });
	t.after(() => f.first.code.focusTarget.unregisterCommand('navigateBack'));
	const items = [{ label: 'target', description: '', detail: '' }];
	picker.pick('Step', '', () => new TextQuickPickProvider(items), () => {}, undefined,
		{ step: { index: 2, total: 2, back: () => { backs++; } } });
	assert.ok(picker.field.focusTarget.getCommand('navigateBack') !== undefined);
	picker.pick('Ordinary', '', () => new TextQuickPickProvider(items), () => {});
	assert.equal(picker.field.focusTarget.getCommand('navigateBack'), undefined);
	picker.hide(); f.key('ArrowLeft', KeyModifier.alt);
	assert.equal(navigations, 1); assert.equal(backs, 0);
});
