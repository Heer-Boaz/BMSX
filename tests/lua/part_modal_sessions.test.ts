import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { ActionPrompt } from '../../ide/workbench/contrib/modal/action_prompt';
import type { ActionPromptRequest } from '../../ide/workbench/contrib/modal/action_prompt_view';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { createHostOverlayFixture } from '../helpers/host_overlay';

const REQUEST: ActionPromptRequest = { title: 'Unsaved source', message: 'Choose the source operation.',
	primary: 'Save', secondary: 'Discard', primaryEnabled: true, defaultChoice: 'primary' };
const ITEMS = [{ label: 'Source', description: 'Authored definition', detail: '' }];

function fixture(t: TestContext) {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 800; editorViewState.viewportHeight = 400;
	const menu = new ContextMenuController(inputFocus, pointerCapture);
	const part = (left: number) => {
		const scope = new InputFocusScope(Symbol('part'), inputFocus.workbenchScope);
		const bounds = { left, top: 24, right: left + 320, bottom: 324 };
		const origin = inputFocus.createTarget(null, new InputFocusScope(scope.surfaceScope, scope));
		const presentation = { scope, bounds, kind: 'part' as const, reveal() {} };
		const quick = new QuickInputController(menu, undefined, undefined, presentation);
		const prompt = new ActionPrompt(inputFocus, pointerCapture, undefined, undefined, presentation);
		return { scope, bounds, origin, quick, prompt };
	};
	const first = part(24), second = part(424);
	t.after(() => {
		for (const owner of [first, second]) { owner.quick.dispose(); owner.prompt.dispose(); owner.scope.retireContext(); }
		menu.dispose(); pointerCapture.cancel(); inputFocus.setTarget(null);
	});
	return { first, second, menu };
}

test('two part pickers retain independent drafts and sessions while sibling focus and origin retirement remain local', t => {
	const { first, second } = fixture(t);
	first.origin.focus(); first.quick.input('', '', 'first draft', async value => value, () => {});
	second.origin.focus(); second.quick.input('', '', 'second draft', async value => value, () => {});
	assert.equal(first.quick.visible, true); assert.equal(second.quick.visible, true);
	assert.equal(first.quick.field.text, 'first draft'); assert.equal(second.quick.field.text, 'second draft');
	assert.ok(inputFocus.target === second.quick.field.focusTarget);
	assert.ok(first.quick.field.focusTarget.scope.commandParent === first.scope);
	first.origin.scope.retireContext();
	assert.equal(first.quick.visible, false); assert.equal(second.quick.visible, true);
	assert.ok(inputFocus.target === second.quick.field.focusTarget);
});

test('an unfocused local picker prepares once without stealing sibling focus or cancelling its captured gesture', t => {
	const { first, second } = fixture(t);
	second.origin.focus();
	let cancelled = 0, prepared = 0;
	const gesture = { handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { cancelled++; } };
	pointerCapture.capture(gesture, PointerButton.Primary, second.scope.surfaceScope);
	first.quick.pick('', '', origin => {
		assert.ok(origin === first.origin); prepared++;
		return new TextQuickPickProvider(ITEMS);
	}, () => {}, undefined, { invocationOrigin: first.origin, preserveFocus: true });
	assert.equal(first.quick.visible, true); assert.equal(prepared, 1);
	assert.equal(first.quick.model.list.rows.length, 1);
	assert.ok(inputFocus.target === second.origin);
	assert.equal(cancelled, 0); assert.equal(pointerCapture.active, true);
	const caret = first.quick.field.caretRect();
	assert.ok(caret.x >= first.bounds.left && caret.x + caret.width <= first.bounds.right);
	assert.ok(caret.y >= first.bounds.top && caret.y + caret.height <= first.bounds.bottom);
	first.scope.retireContext();
	assert.equal(first.quick.visible, false); assert.equal(cancelled, 0); assert.equal(pointerCapture.active, true);
	assert.ok(inputFocus.target === second.origin);
	pointerCapture.release(gesture);
});

test('part prompts survive sibling focus but disarm held confirmation before focus returns', async t => {
	const { first, second } = fixture(t);
	first.origin.focus(); const firstDecision = first.prompt.show(REQUEST);
	inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, true));
	second.origin.focus(); const secondDecision = second.prompt.show(REQUEST);
	assert.equal(first.prompt.visible, true); assert.equal(second.prompt.visible, true);
	first.prompt.focusTarget.focus();
	inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.equal(first.prompt.visible, true, 'a release from an earlier focus lifetime cannot confirm');
	inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, true));
	inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.equal(await firstDecision, 'primary'); assert.equal(second.prompt.visible, true);
	second.scope.retireContext();
	assert.equal(await secondDecision, 'cancel');
});

test('a scope-owned background prompt neither borrows sibling origin lifetime nor steals its focus or capture', async t => {
	const { first, second } = fixture(t);
	second.origin.focus();
	let cancelled = 0;
	const gesture = { handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { cancelled++; } };
	pointerCapture.capture(gesture, PointerButton.Primary, second.scope.surfaceScope);
	const decision = first.prompt.show(REQUEST, null);
	assert.ok(inputFocus.target === second.origin); assert.equal(first.prompt.invocationOrigin, null);
	assert.equal(cancelled, 0); assert.equal(pointerCapture.active, true);
	second.origin.scope.retireContext();
	assert.equal(first.prompt.visible, true, 'the requesting part owns this decision, not the currently focused sibling');
	first.scope.retireContext();
	assert.equal(await decision, 'cancel'); assert.equal(cancelled, 0);
	assert.ok(inputFocus.target === second.origin);
	pointerCapture.release(gesture);
});

test('translated retained modal geometry owns native caret, backdrop and dialog placement without idle remeasurement', t => {
	const { first } = fixture(t);
	first.origin.focus(); first.quick.input('', '', 'retained draft', async value => value, () => {});
	const field = { ...first.quick.layout.field }, caret = { ...first.quick.field.caretRect() };
	const measure = t.mock.method(editorViewState.font, 'advance');
	for (let frame = 0; frame < 1000; frame++) first.quick.update();
	assert.equal(measure.mock.callCount(), 0);
	first.bounds.left += 50; first.bounds.right += 50; first.bounds.top += 30; first.bounds.bottom += 30;
	first.quick.update();
	assert.equal(first.quick.layout.field.left, field.left + 50); assert.equal(first.quick.layout.field.top, field.top + 30);
	assert.equal(first.quick.field.caretRect().x, caret.x + 50); assert.equal(first.quick.field.caretRect().y, caret.y + 30);
	first.prompt.show(REQUEST);
	const dialog = first.prompt.view.bounds;
	assert.ok(dialog.left >= first.bounds.left && dialog.right <= first.bounds.right);
	assert.ok(dialog.top >= first.bounds.top && dialog.bottom <= first.bounds.bottom);
	const dialogLeft = dialog.left, dialogTop = dialog.top, measured = measure.mock.callCount();
	first.bounds.left += 10; first.bounds.right += 10; first.bounds.top += 20; first.bounds.bottom += 20;
	first.prompt.update();
	assert.equal(dialog.left, dialogLeft + 10); assert.equal(dialog.top, dialogTop + 20);
	assert.equal(measure.mock.callCount(), measured, 'moving the owning part does not remeasure unchanged prompt text');
	const backdrop = t.mock.method(api, 'fill_rect'), outline = t.mock.method(api, 'blit_rect');
	t.mock.method(api, 'blit_text_inline_with_font', () => {});
	backdrop.mock.mockImplementation(() => {}); outline.mock.mockImplementation(() => {});
	const overlay = createHostOverlayFixture(800, 400);
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	first.prompt.draw();
	overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
	assert.deepEqual(backdrop.mock.calls[0].arguments.slice(0, 4), [first.bounds.left, first.bounds.top, first.bounds.right, first.bounds.bottom]);
});

test('a real pointer press activates a background local field or prompt rather than leaving keyboard input in its sibling', t => {
	const { first, second } = fixture(t);
	second.origin.focus();
	first.quick.input('', '', 'background', async value => value, () => {}, undefined, { preserveFocus: true });
	const field = first.quick.layout.field;
	const pointer: PointerInputSnapshot = { valid: true, insideViewport: true, viewportX: field.left + 4, viewportY: field.top + 3,
		modifiers: KeyModifier.none, spaceDown: false,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	first.quick.handlePointer(pointer, true);
	assert.ok(inputFocus.target === first.quick.field.focusTarget);
	second.origin.focus(); first.prompt.show(REQUEST, null);
	const button = first.prompt.view.buttons[0].bounds;
	first.prompt.handlePointer({ ...pointer, viewportX: button.left + 3, viewportY: button.top + 3 });
	assert.ok(inputFocus.target === first.prompt.focusTarget);
});

test('an accepted local async submission still applies edits but captures preserve-focus before retiring its field', async t => {
	const { first, second } = fixture(t);
	const operation = Promise.withResolvers<string>();
	let accepted = '', preserveFocus: boolean | undefined;
	first.origin.focus();
	first.quick.input('', '', 'canonical edit', () => operation.promise, (value, preserve) => {
		accepted = value; preserveFocus = preserve;
	});
	const submission = first.quick.accept();
	second.origin.focus();
	operation.resolve('applied canonical edit'); await submission;
	assert.equal(accepted, 'applied canonical edit'); assert.equal(preserveFocus, true);
	assert.equal(first.quick.visible, false);
	assert.ok(inputFocus.target === second.origin);
});

test('publishing a background part picker leaves a sibling popup family and its focus intact', t => {
	const { first, second, menu } = fixture(t);
	second.origin.focus();
	menu.show(450, 40, [{ type: 'command', command: 'copy' }], { isEnabled: () => true, execute() {} });
	first.quick.pick('', '', () => new TextQuickPickProvider(ITEMS), () => {}, undefined, { invocationOrigin: first.origin, preserveFocus: true });
	assert.equal(first.quick.visible, true); assert.equal(menu.visible, true);
	assert.ok(inputFocus.target === menu.focusTarget);
	first.scope.retireContext();
	assert.equal(menu.visible, true); assert.ok(inputFocus.target === menu.focusTarget);
});

for (const kind of ['pick', 'input'] as const) for (const retirement of ['origin', 'destination'] as const) {
	test(`a foreground cross-part ${kind} retains its invoker and both ${retirement} retirement boundaries`, t => {
		const { first, second } = fixture(t);
		const show = () => {
			if (kind === 'pick') first.quick.pick('', '', origin => {
				assert.ok(origin === second.origin);
				return new TextQuickPickProvider(ITEMS);
			}, () => {});
			else first.quick.input('', '', 'draft', async value => value, () => {});
		};
		second.origin.focus(); show();
		assert.ok(inputFocus.target === first.quick.field.focusTarget);
		assert.ok(first.quick.invocationOrigin === second.origin);
		assert.ok(first.quick.field.focusTarget.scope.interactionOrigin === second.origin.scope);
		first.quick.hide();
		assert.ok(inputFocus.target === second.origin, 'Cancel returns to the actual cross-part invoker');
		show();
		(retirement === 'origin' ? second.origin.scope : first.scope).retireContext();
		assert.equal(first.quick.visible, false);
		assert.ok(inputFocus.target !== first.quick.field.focusTarget);
	});
}

test('a background local decision body admits native keyboard reading without arming a response, while wheel and scrollbar stay non-focusing', async t => {
	const { first, second } = fixture(t);
	first.bounds.bottom = first.bounds.top + 58;
	second.origin.focus();
	const decision = first.prompt.show({ ...REQUEST, message: 'authoring/scenes/retained-source-identity/'.repeat(35) }, second.origin);
	const body = first.prompt.view.body;
	assert.ok(inputFocus.target === second.origin);
	const pointer: PointerInputSnapshot = { valid: true, insideViewport: true, viewportX: body.bounds.left + 1, viewportY: body.bounds.top + 1,
		modifiers: KeyModifier.none, spaceDown: false, pressedButtons: PointerButton.Primary,
		justPressedButtons: PointerButton.Primary, justReleasedButtons: PointerButton.Primary };
	first.prompt.handleWheel({ ...pointer, deltaX: 0, deltaY: 1 });
	assert.ok(body.scrollTop > 0 && inputFocus.target === second.origin);
	const track = body.scrollbar.getTrack();
	const scrollbarPress = { ...pointer, viewportX: (track.left + track.right) / 2, viewportY: (track.top + track.bottom) / 2,
		justReleasedButtons: 0 };
	first.prompt.handlePointer(scrollbarPress);
	assert.equal(pointerCapture.active, true); assert.ok(inputFocus.target === second.origin);
	pointerCapture.dispatch({ ...scrollbarPress, pressedButtons: 0, justPressedButtons: 0, justReleasedButtons: PointerButton.Primary },
		false, 0, first.prompt.pointerScope);
	for (const invalid of [{ ...pointer, valid: false }, { ...pointer, insideViewport: false }, { ...pointer, viewportX: first.bounds.left - 1 }])
		first.prompt.handlePointer(invalid);
	assert.ok(inputFocus.target === second.origin);
	first.prompt.handlePointer(pointer);
	assert.ok(inputFocus.target === first.prompt.focusTarget);
	assert.equal(pointerCapture.active, false); assert.equal(first.prompt.visible, true);
	for (const down of [true, false]) inputFocus.handleKeyboard(new KeyInputEvent('Home', KeyModifier.none, false, down));
	assert.equal(body.scrollTop, 0);
	for (const down of [true, false]) inputFocus.handleKeyboard(new KeyInputEvent('End', KeyModifier.none, false, down));
	assert.equal(body.scrollTop, body.scrollbar.getMaximumScroll());
	for (const down of [true, false]) inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none, false, down));
	assert.equal(await decision, 'cancel'); assert.ok(inputFocus.target === second.origin);
});

test('a local response press cannot accept after its native focus request was redirected by the departing control', async t => {
	const { first, second } = fixture(t), replacement = inputFocus.createTarget(null, second.scope);
	second.origin.focus();
	const decision = first.prompt.show(REQUEST, null);
	let cancelled = 0;
	const newerGesture = { handleCapturedPointer() {}, releaseCapturedPointer() {}, cancelPointer() { cancelled++; } };
	const unbind = second.origin.onDidBlur(next => {
		if (next !== first.prompt.focusTarget) return;
		unbind(); replacement.focus(); pointerCapture.capture(newerGesture, PointerButton.Primary, second.scope.surfaceScope);
	});
	t.after(unbind);
	const button = first.prompt.view.buttons[0].bounds;
	try {
		first.prompt.handlePointer({ valid: true, insideViewport: true, viewportX: (button.left + button.right) / 2,
			viewportY: (button.top + button.bottom) / 2,
			pressedButtons: 0, justPressedButtons: PointerButton.Primary, justReleasedButtons: PointerButton.Primary });
		assert.ok(inputFocus.target === replacement);
		assert.equal(first.prompt.visible, true, 'the still-live request is not permission to bypass refused native focus');
		assert.equal(cancelled, 0); assert.equal(pointerCapture.active, true);
	} finally { pointerCapture.release(newerGesture); first.prompt.close('cancel', false); }
	assert.equal(await decision, 'cancel');
});

test('a refused older body focus request does not cancel a newer physical response gesture admitted during blur', async t => {
	const { first, second } = fixture(t), replacement = inputFocus.createTarget(null, second.scope);
	second.origin.focus(); const decision = first.prompt.show(REQUEST, null);
	const button = first.prompt.view.buttons[0].bounds;
	const response: PointerInputSnapshot = { valid: true, insideViewport: true, viewportX: (button.left + button.right) / 2,
		viewportY: (button.top + button.bottom) / 2, modifiers: KeyModifier.none, spaceDown: false,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0 };
	const unbind = second.origin.onDidBlur(next => {
		if (next !== first.prompt.focusTarget) return;
		unbind(); replacement.focus(); first.prompt.handlePointer(response);
	});
	t.after(unbind);
	try {
		const body = first.prompt.view.body.bounds;
		first.prompt.handlePointer({ ...response, viewportX: body.left + 1, viewportY: body.top + 1 });
		assert.ok(inputFocus.target === first.prompt.focusTarget);
		assert.equal(first.prompt.visible, true); assert.equal(pointerCapture.active, true);
		assert.equal(pointerCapture.dispatch({ ...response, pressedButtons: 0, justPressedButtons: 0,
			justReleasedButtons: PointerButton.Primary }, false, 0, first.prompt.pointerScope), true);
		assert.equal(await decision, 'primary');
	} finally { first.prompt.close('cancel', false); }
});
