import { KeyModifier } from '../../hosts/common/input/text';
import { KeyInputEvent } from '../../hosts/common/input/text';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { DEFAULT_FONT_VARIANT } from '../../machine/ts/render/shared/bmsx_font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { ActionPrompt } from '../../ide/workbench/contrib/modal/action_prompt';
import type { ActionPromptRequest } from '../../ide/workbench/contrib/modal/action_prompt_view';
import { api } from '../../ide/runtime/overlay_api';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';

const REQUEST: ActionPromptRequest = { title: 'Unsaved changes', message: 'Choose what happens to this source.',
	primary: 'Save', secondary: 'Discard', primaryEnabled: true, defaultChoice: 'primary' };

function fixture(t: TestContext) {
	const clock = new VirtualHeadlessClock();
	configureFontVariant(DEFAULT_FONT_VARIANT);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const input = new Input(clock, new HeadlessInputHub(), -1);
	const focus = new InputFocusService(), capture = new PointerCaptureService();
	const origin = focus.createTarget();
	origin.bindKeyboard(() => {});
	origin.focus();
	const prompt = new ActionPrompt(focus, capture, undefined, undefined, { scope: focus.workbenchScope, bounds: { left: 0, top: 0, right: editorViewState.viewportWidth, bottom: editorViewState.viewportHeight }, kind: 'workspace' });
	let pressId = 0;
	const frame = () => { clock.advance(20); input.pollInput(); };
	const key = (code: string, down: boolean) => {
		input.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now(), ++pressId);
		frame();
		focus.handleKeyboard(new KeyInputEvent(code, input.getPlayerInput(1).modifiers, false, down));
	};
	const press = (code: string) => { key(code, true); key(code, false); };
	const pointer = (index: number, pressed = 0, down = 0, up = 0) => {
		const bounds = index < 0 ? { left: 0, right: 1, top: 0, bottom: 1 } : prompt.view.buttons[index].bounds;
		const snapshot: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, valid: true, insideViewport: true,
			viewportX: (bounds.left + bounds.right) / 2, viewportY: (bounds.top + bounds.bottom) / 2,
			pressedButtons: pressed, justPressedButtons: down, justReleasedButtons: up };
		if (!capture.dispatch(snapshot, false, clock.now(), prompt.pointerScope)) prompt.handlePointer(snapshot);
	};
	t.after(() => { prompt.dispose(); input.dispose(); focus.setTarget(null); });
	return { prompt, focus, origin, capture, frame, key, press, pointer };
}

test('modal owns focus until Escape is released, then returns it to the invoking control', async t => {
	const f = fixture(t);
	const result = f.prompt.show(REQUEST);
	assert.equal(f.focus.target, f.prompt.focusTarget);
	f.key('Escape', true);
	for (let index = 0; index < 10; index++) f.frame();
	assert.equal(f.prompt.visible, true);
	f.focus.cancelInput();
	f.key('Escape', false);
	assert.equal(f.prompt.visible, true, 'host cancellation revokes the armed Escape without faking a release');
	f.press('Escape');
	assert.equal(await result, 'cancel');
	assert.equal(f.focus.target, f.origin);
});

test('prompt visibility is published before modal focus admission and before return to its invoker', async t => {
	configureFontVariant(DEFAULT_FONT_VARIANT);
	const focus = new InputFocusService(), capture = new PointerCaptureService(), surfaces = new WorkbenchSurfaceService();
	const bounds = { left: 0, top: 0, right: 384, bottom: 288 }, origin = focus.createTarget();
	origin.bindKeyboard(() => {});
	surfaces.attach({ role: 'content', captureScope: origin.scope.surfaceScope,
		isVisible: () => true, getBounds: () => bounds, getClip: () => bounds, draw() {} });
	const prompt = new ActionPrompt(focus, capture, () => surfaces.changed(), undefined,
		{ scope: focus.workbenchScope, bounds, kind: 'workspace' });
	surfaces.attach({ role: 'modal', blockedScope: null, presentationParent: null, captureScope: prompt.pointerScope,
		isVisible: () => prompt.visible, getBounds: () => prompt.view.bounds, getClip: () => bounds, draw() {} });
	const unbind = focus.bindScopeAdmission(scope => surfaces.isAdmitted(surfaces.findByScope(scope.surfaceScope)!));
	t.after(() => { unbind(); prompt.dispose(); surfaces.dispose(); focus.setTarget(null); });
	origin.focus();
	const decision = prompt.show(REQUEST);
	assert.ok(focus.target === prompt.focusTarget);
	prompt.close('cancel');
	assert.equal(await decision, 'cancel');
	assert.ok(focus.target === origin);
});

test('Escape cancellation survives a modifier change before its release', async t => {
	const f = fixture(t);
	const result = f.prompt.show(REQUEST);
	f.key('Escape', true);
	f.key('ControlLeft', true);
	f.key('Escape', false);
	assert.equal(await result, 'cancel');
	assert.equal(f.focus.target, f.origin);
});

test('Tab and arrows keep focus in the dialog; confirmation is paired to a physical key release', async t => {
	const f = fixture(t);
	for (const key of ['Enter', 'NumpadEnter', 'Space']) {
		const result = f.prompt.show(REQUEST);
		f.press('Tab');
		f.press('ArrowRight');
		f.press('ArrowLeft');
		assert.equal(f.focus.target, f.prompt.focusTarget);
		f.key(key, true);
		for (let index = 0; index < 10; index++) f.frame();
		assert.equal(f.prompt.visible, true);
		f.key(key, false);
		assert.equal(await result, 'secondary');
	}
	const result = f.prompt.show(REQUEST);
	f.key('ShiftLeft', true); f.press('Tab'); f.key('ShiftLeft', false);
	f.press('Enter');
	assert.equal(await result, 'cancel');
});

test('pointer release outside or lost capture does not confirm; matching and coalesced clicks do', async t => {
	const f = fixture(t);
	const result = f.prompt.show(REQUEST);
	f.pointer(0, 1, 1); f.pointer(-1, 0, 0, 1);
	assert.equal(f.prompt.visible, true);
	f.pointer(0, 1, 1); f.capture.cancel(); f.pointer(0, 0, 0, 1);
	assert.equal(f.prompt.visible, true);
	f.pointer(0, 1, 1); f.pointer(0);
	assert.equal(f.prompt.visible, true);
	f.pointer(0, 1, 1);
	assert.equal(f.prompt.visible, true);
	f.pointer(0, 0, 0, 1);
	assert.equal(await result, 'primary');
	assert.equal(f.capture.active, false);
	const cancel = f.prompt.show(REQUEST);
	f.pointer(2, 0, 1, 1);
	assert.equal(await cancel, 'cancel');
});

test('replacement, focus departure and disposal settle the old decision without reclaiming focus', async t => {
	const f = fixture(t);
	const first = f.prompt.show(REQUEST);
	f.key('Enter', true);
	const second = f.prompt.show({ ...REQUEST, message: 'A different pending decision.' });
	assert.equal(await first, 'cancel');
	f.key('Enter', false);
	assert.equal(f.prompt.visible, true);
	const destination = f.focus.createTarget();
	destination.focus();
	assert.equal(await second, 'cancel');
	assert.equal(f.focus.target, destination);
	const final = f.prompt.show(REQUEST);
	f.prompt.dispose();
	assert.equal(await final, 'cancel');
	assert.equal(f.focus.target, destination);
});

for (const defaultChoice of ['primary', 'secondary', 'cancel'] as const) test(`Enter accepts the request's explicit ${defaultChoice} default`, async t => {
	const f = fixture(t), result = f.prompt.show({ ...REQUEST, defaultChoice });
	f.press('Enter');
	assert.equal(await result, defaultChoice);
});

test('disabled primary cannot confirm and keyboard traversal skips it in both directions', async t => {
	const f = fixture(t), request: ActionPromptRequest = { ...REQUEST, primaryEnabled: false, defaultChoice: 'cancel' };
	const result = f.prompt.show(request);
	f.pointer(0, 0, 1, 1);
	f.prompt.close('primary');
	assert.equal(f.prompt.visible, true);
	f.press('Tab');
	f.key('ShiftLeft', true); f.press('Tab'); f.key('ShiftLeft', false);
	f.press('Enter');
	assert.equal(await result, 'cancel');
	const next = f.prompt.show(request);
	f.press('ArrowRight'); f.press('Space');
	assert.equal(await next, 'secondary');
});

test('an explicitly disabled primary default does not arm confirmation and can be left by ordinary navigation', async t => {
	const f = fixture(t), result = f.prompt.show({ ...REQUEST, primaryEnabled: false });
	f.press('Enter');
	assert.equal(f.prompt.visible, true);
	f.press('ArrowLeft'); f.press('Enter');
	assert.equal(await result, 'cancel');
});

test('operation cancellation matches its live request and cannot restore a stale invocation', async t => {
	const f = fixture(t), first: ActionPromptRequest = { ...REQUEST }, second: ActionPromptRequest = { ...REQUEST };
	const old = f.prompt.show(first), current = f.prompt.show(second);
	assert.equal(await old, 'cancel');
	f.prompt.cancel(first);
	assert.equal(f.prompt.visible, true);
	assert.equal(f.focus.target, f.prompt.focusTarget);
	f.prompt.cancel(second);
	assert.equal(await current, 'cancel');
	assert.equal(f.focus.target, null, 'owner retirement does not refocus its captured input');
	const pending = f.prompt.show(first), sibling = f.focus.createTarget();
	sibling.focus();
	assert.equal(await pending, 'cancel');
	f.prompt.cancel(first);
	assert.equal(f.focus.target, sibling);
});

for (const variant of ['tiny', 'msx'] as const) test(`${variant} prompt layout wraps request content and stacks buttons within the viewport only when invalidated`, async t => {
	const f = fixture(t);
	configureFontVariant(variant);
	editorViewState.viewportWidth = 96; editorViewState.viewportHeight = 400;
	Object.assign(f.prompt.presentation.bounds, { right: 96, bottom: 400 });
	const overlay = createHostOverlayFixture(384, 400);
	const text = t.mock.method(api, 'blit_text_inline_with_font');
	const measurement = t.mock.method(editorViewState.font, 'measureTextRange');
	const request: ActionPromptRequest = { ...REQUEST, title: 'Project source context '.repeat(3),
		message: `res/library/${'nested/'.repeat(80)}shared.lua` };
	const result = f.prompt.show(request), measured = measurement.mock.callCount();
	for (let frame = 0; frame < 10; frame++) f.prompt.update();
	assert.equal(measurement.mock.callCount(), measured, 'unchanged retained content has no repeated layout measurement');
	for (const width of [96, 384]) {
		editorViewState.viewportWidth = width; Object.assign(f.prompt.presentation.bounds, { right: width }); f.prompt.update();
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
		text.mock.resetCalls(); f.prompt.draw(); overlay.renderer.endFrame(); overlay.queue.consumeOverlayFrame();
		assert.ok(f.prompt.view.bounds.left >= 0 && f.prompt.view.bounds.right <= width);
		assert.ok(f.prompt.view.bounds.top >= 0 && f.prompt.view.bounds.bottom <= editorViewState.viewportHeight);
		// This is the focused wrapping contract: no rendered line escapes the laid-out dialog.
		for (const call of text.mock.calls) {
			const [line, x, y, , , font] = call.arguments;
			assert.ok(x >= f.prompt.view.bounds.left && x + font.measure(line) <= f.prompt.view.bounds.right);
			assert.ok(y >= f.prompt.view.bounds.top && y + font.lineHeight <= f.prompt.view.bounds.bottom);
		}
		const [primary, secondary, cancel] = f.prompt.view.buttons;
		if (width === 96) assert.ok(primary.bounds.bottom <= secondary.bounds.top && secondary.bounds.bottom <= cancel.bounds.top);
		else assert.equal(primary.bounds.top, cancel.bounds.top);
	}
	assert.ok(measurement.mock.callCount() > measured, 'viewport publication invalidates wrapped geometry');
	f.prompt.close(); assert.equal(await result, 'cancel');
});
