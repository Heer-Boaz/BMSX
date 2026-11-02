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
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';

function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny') {
	configureFontVariant(font); editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const area = { left: 0, top: 0, right: 384, bottom: 288 };
	const menu = new ContextMenuController(inputFocus, pointerCapture, area);
	let onVisibility: (() => void) | undefined;
	const picker = new QuickInputController(menu, () => onVisibility?.(), undefined, { scope: inputFocus.workbenchScope, bounds: area, kind: 'workspace' });
	const origin = inputFocus.createTarget(null, new InputFocusScope(Symbol('origin'), inputFocus.workbenchScope)); origin.focus();
	let checked = false, accepted = 0, retired = 0;
	let onChange: ((checked: boolean) => void) | undefined;
	const choices = [{ label: 'first', description: '', detail: '' }, { label: 'second', description: '', detail: '' }];
	picker.pick('Pick', '', () => new TextQuickPickProvider(choices), () => { accepted++; }, lifetime => lifetime.add({ dispose: () => { retired++; } }), {
		toggle: { label: 'Policy', checked: false, onDidChange: value => { checked = value; onChange?.(value); } },
		validateSelection: (_item, modifiers) => checked && modifiers !== KeyModifier.alt ? undefined : 'Unavailable',
	});
	const key = (code: string, down = true) => inputFocus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, down));
	const pointer = (pressed: boolean) => {
		const bounds = picker.layout.toggle;
		const snapshot: PointerInputSnapshot = { valid: true, insideViewport: true, viewportX: bounds.left + 2, viewportY: bounds.top + 2,
			pressedButtons: pressed ? PointerButton.Primary : 0, justPressedButtons: pressed ? PointerButton.Primary : 0,
			justReleasedButtons: pressed ? 0 : PointerButton.Primary, modifiers: KeyModifier.none, spaceDown: false };
		if (!pointerCapture.dispatch(snapshot, false, 0, picker.pointerScope)) picker.handlePointer(snapshot, pressed);
	};
	t.after(() => { picker.dispose(); menu.dispose(); pointerCapture.cancel(); inputFocus.setTarget(null); });
	return { picker, origin, key, pointer, checked: () => checked, accepted: () => accepted, retired: () => retired,
		onChange: (f: (value: boolean) => void) => { onChange = f; }, onVisibility: (f: () => void) => { onVisibility = f; } };
}

for (const font of ['tiny', 'msx'] as const) test(`${font}: keyboard policy change retains query, choice, focus and owner`, t => {
	const f = fixture(t, font); insertValue(f.picker.field, 'first'); f.picker.update();
	const choice = f.picker.model.list.rows[f.picker.model.list.selectionIndex]; f.key('Enter');
	assert.ok(f.picker.message); assert.equal(inputFocus.moveFocus(false), true);
	assert.equal(inputFocus.target, f.picker.toggle!.focusTarget);
	f.key('Space'); f.key('Space', false);
	assert.equal(f.checked(), true); assert.equal(f.picker.message, ''); assert.equal(f.picker.field.text, 'first');
	assert.equal(f.picker.model.list.rows[f.picker.model.list.selectionIndex], choice); assert.equal(f.retired(), 0);
	assert.equal(inputFocus.moveFocus(true), true); assert.equal(inputFocus.target, f.picker.field.focusTarget);
	f.key('Enter'); assert.equal(f.accepted(), 1); assert.equal(f.retired(), 1); assert.equal(inputFocus.target, f.origin);
});

test('pointer activation selects policy without retiring the picker', t => {
	const f = fixture(t); f.key('Enter'); f.pointer(true); assert.equal(f.checked(), false);
	f.pointer(false); assert.equal(f.checked(), true); assert.equal(f.picker.message, '');
	assert.equal(inputFocus.target, f.picker.toggle!.focusTarget); assert.equal(f.picker.visible, true);
	assert.equal(inputFocus.moveFocus(false), true); f.key('Enter'); assert.equal(f.accepted(), 1);
});

test('Escape from policy retires the picker and returns to the origin', t => {
	const f = fixture(t); inputFocus.moveFocus(false); f.key('Escape');
	assert.equal(f.picker.visible, false); assert.equal(f.retired(), 1); assert.equal(f.accepted(), 0); assert.equal(inputFocus.target, f.origin);
});

test('a policy callback can replace the picker without the old control mutating the replacement', t => {
	const f = fixture(t); const provider = new TextQuickPickProvider([{ label: 'new', description: '', detail: '' }]);
	f.onChange(() => f.picker.pick('new', '', () => provider, () => {}));
	inputFocus.moveFocus(false); f.key('Space'); f.key('Space', false);
	assert.equal(f.picker.visible, true); assert.equal(f.picker.toggle, undefined); assert.equal(f.retired(), 1);
	assert.equal(inputFocus.target, f.picker.field.focusTarget); assert.equal(f.picker.model.list.rows.length, 1);
});

test('a policy callback can retire its picker', t => {
	const f = fixture(t); f.onChange(() => f.picker.hide()); inputFocus.moveFocus(false); f.key('Space'); f.key('Space', false);
	assert.equal(f.picker.visible, false); assert.equal(f.retired(), 1); assert.equal(inputFocus.target, f.origin);
});

test('a policy callback may publish a new validation without having it cleared by the previous toggle', t => {
	const f = fixture(t); f.key('Enter');
	f.onChange(() => { f.picker.accept(KeyModifier.alt); });
	inputFocus.moveFocus(false); f.key('Space'); f.key('Space', false);
	assert.equal(f.picker.visible, true); assert.ok(f.picker.message); assert.equal(f.accepted(), 0);
});

test('replacement from a policy callback retains the invoking origin', t => {
	const f = fixture(t); let nextOrigin = f.picker.toggle!.focusTarget;
	const provider = new TextQuickPickProvider([{ label: 'next', description: '', detail: '' }]);
	f.onChange(() => {
		f.picker.pick('replacement', '', origin => { nextOrigin = origin!; return provider; }, () => {});
	});
	inputFocus.moveFocus(false); f.key('Space'); f.key('Space', false);
	assert.equal(nextOrigin, f.origin); assert.equal(inputFocus.target, f.picker.field.focusTarget);
});

test('replacement from retirement notification retains the invoking origin, not the retiring focused toggle', t => {
	const f = fixture(t); let nextOrigin = f.picker.toggle!.focusTarget, replaced = false;
	const provider = new TextQuickPickProvider([{ label: 'next', description: '', detail: '' }]);
	f.onVisibility(() => {
		if (f.picker.visible || replaced) return;
		replaced = true;
		f.picker.pick('replacement', '', origin => { nextOrigin = origin!; return provider; }, () => {});
	});
	inputFocus.moveFocus(false); f.key('Escape');
	assert.equal(nextOrigin, f.origin); assert.equal(inputFocus.target, f.picker.field.focusTarget);
	f.key('Escape'); assert.equal(inputFocus.target, f.origin);
});

for (const owner of ['workspace', 'part'] as const) for (const font of ['tiny', 'msx'] as const)
	test(`${owner} ${font}: actual keyboard routing reaches the policy and returns to the same query`, async t => {
		const { createActualSourcePanes } = await import('../helpers/source_panes');
		const f = createActualSourcePanes(t), picker = owner === 'workspace' ? f.editor.quickInput : f.firstPart.quickInput;
		configureFontVariant(font); f.first.focus(); const origin = inputFocus.admittedTarget;
		let policy = false, accepted = 0;
		picker.pick('Pick', '', () => new TextQuickPickProvider([{ label: 'first', description: '', detail: '' }]), () => { accepted++; }, undefined,
			{ toggle: { label: 'Policy', checked: false, onDidChange: value => { policy = value; } }, validateSelection: () => policy ? undefined : 'Unavailable' });
		insertValue(picker.field, 'first'); f.key('Enter'); f.key('Tab');
		assert.equal(inputFocus.admittedTarget, picker.toggle!.focusTarget); f.key('Space');
		assert.equal(policy, true); assert.equal(picker.message, ''); assert.equal(picker.field.text, 'first');
		f.key('Tab', KeyModifier.shift); assert.equal(inputFocus.admittedTarget, picker.field.focusTarget);
		f.key('Enter'); assert.equal(accepted, 1); assert.equal(inputFocus.admittedTarget, origin);
	});

for (const owner of ['workspace', 'part'] as const) for (const font of ['tiny', 'msx'] as const) for (const source of ['focus', 'hover'] as const)
	test(`${owner} ${font}: ${source} discloses the clipped policy label through the feedback surface`, async t => {
		const { createActualSourcePanes } = await import('../helpers/source_panes');
		const { api } = await import('../../ide/runtime/overlay_api');
		const f = createActualSourcePanes(t), picker = owner === 'workspace' ? f.editor.quickInput : f.firstPart.quickInput;
		configureFontVariant(font); f.first.focus(); const label = 'Z'.repeat(220);
		picker.pick('Pick', '', () => new TextQuickPickProvider([{ label: 'first', description: '', detail: '' }]), () => {}, undefined,
			{ toggle: { label, checked: false, onDidChange: () => {} } });
		if (source === 'focus') f.key('Tab');
		else {
			const bounds = picker.layout.toggle;
			f.editor.dispatchPointer({ x: bounds.left + 2, y: bounds.top + 2, buttons: 0, pressedButtons: 0, releasedButtons: 0,
				cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
			f.update();
		}
		assert.ok(picker.toggle!.tooltipItem);
		const text = t.mock.method(api, 'blit_text_inline_with_font'); f.paint();
		const drawn = text.mock.calls.map(call => call.arguments[0]).filter(value => typeof value === 'string' && /^Z+$/.test(value)).join('');
		assert.ok(drawn.includes(label));
	});

for (const owner of ['workspace', 'part'] as const) test(`${owner}: routed pointer activation leaves the policy focusable and disclosed`, async t => {
	const { createActualSourcePanes } = await import('../helpers/source_panes');
	const f = createActualSourcePanes(t), picker = owner === 'workspace' ? f.editor.quickInput : f.firstPart.quickInput;
	f.first.focus(); let policy = false;
	picker.pick('Pick', '', () => new TextQuickPickProvider([{ label: 'first', description: '', detail: '' }]), () => {}, undefined,
		{ toggle: { label: 'Z'.repeat(220), checked: false, onDidChange: checked => { policy = checked; } } });
	const bounds = picker.layout.toggle;
	const event = (down: number, up: number) => ({ x: bounds.left + 2, y: bounds.top + 2, buttons: down, pressedButtons: down,
		releasedButtons: up, cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: 1 });
	f.editor.dispatchPointer(event(PointerButton.Primary, 0)); f.editor.dispatchPointer(event(0, PointerButton.Primary)); f.update();
	assert.equal(policy, true); assert.equal(inputFocus.admittedTarget, picker.toggle!.focusTarget); assert.ok(picker.toggle!.tooltipItem);
	assert.equal(picker.visible, true); f.key('Escape'); assert.equal(picker.visible, false);
});

for (const owner of ['workspace', 'part'] as const) test(`${owner}: Back remains available while the policy has focus`, async t => {
	const { createActualSourcePanes } = await import('../helpers/source_panes');
	const f = createActualSourcePanes(t), picker = owner === 'workspace' ? f.editor.quickInput : f.firstPart.quickInput;
	f.first.focus(); const origin = inputFocus.admittedTarget; let backs = 0;
	picker.pick('Pick', '', () => new TextQuickPickProvider([{ label: 'first', description: '', detail: '' }]), () => {}, undefined,
		{ toggle: { label: 'Policy', checked: false, onDidChange: () => {} }, step: { index: 2, total: 2, back: () => { backs++; } } });
	f.key('Tab'); assert.equal(inputFocus.admittedTarget, picker.toggle!.focusTarget);
	f.key('ArrowLeft', KeyModifier.alt); assert.equal(backs, 1); assert.equal(picker.visible, false); assert.equal(inputFocus.admittedTarget, origin);
});
