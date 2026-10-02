import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import type { PointerSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import { DEFAULT_FONT_VARIANT } from '../../machine/ts/render/shared/bmsx_font';
import { InputFocusService } from '../../ide/input/focus';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { ActionPrompt } from '../../ide/workbench/contrib/modal/action_prompt';

function fixture(t: TestContext) {
	const clock = new VirtualHeadlessClock();
	configureFontVariant(clock, DEFAULT_FONT_VARIANT, 'lua');
	const input = new Input(clock, new HeadlessInputHub(), -1);
	const focus = new InputFocusService(), capture = new PointerCaptureService();
	const origin = focus.createTarget();
	origin.bindKeyboard(() => {});
	origin.focus();
	const prompt = new ActionPrompt(focus, capture);
	let pressId = 0;
	const frame = () => { clock.advance(20); input.pollInput(); focus.handleKeyboard(input.getPlayerInput(1)); };
	const key = (code: string, down: boolean) => {
		input.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now(), ++pressId);
		frame();
	};
	const press = (code: string) => { key(code, true); key(code, false); };
	const pointer = (index: number, pressed = 0, down = 0, up = 0) => {
		const bounds = index < 0 ? { left: 0, right: 1, top: 0, bottom: 1 } : prompt.view.buttons[index].bounds;
		const snapshot: PointerSnapshot = { valid: true, insideViewport: true,
			viewportX: (bounds.left + bounds.right) / 2, viewportY: (bounds.top + bounds.bottom) / 2,
			pressedButtons: pressed, justPressedButtons: down, justReleasedButtons: up };
		if (!capture.dispatch(snapshot, false, clock.now(), prompt.pointerScope)) prompt.handlePointer(snapshot);
	};
	t.after(() => { prompt.dispose(); input.dispose(); focus.setTarget(null); });
	return { prompt, focus, origin, capture, frame, key, press, pointer };
}

test('modal owns focus until Escape is released, then returns it to the invoking control', async t => {
	const f = fixture(t);
	const result = f.prompt.show('reboot');
	assert.equal(f.focus.target, f.prompt.focusTarget);
	f.key('Escape', true);
	for (let index = 0; index < 10; index++) f.frame();
	assert.equal(f.prompt.visible, true);
	f.key('Escape', false);
	assert.equal(await result, 'cancel');
	assert.equal(f.focus.target, f.origin);
});

test('Escape cancellation survives a modifier change before its release', async t => {
	const f = fixture(t);
	const result = f.prompt.show('reboot');
	f.key('Escape', true);
	f.key('ControlLeft', true);
	f.key('Escape', false);
	assert.equal(await result, 'cancel');
	assert.equal(f.focus.target, f.origin);
});

test('Tab and arrows keep focus in the dialog; confirmation is paired to a physical key release', async t => {
	const f = fixture(t);
	for (const key of ['Enter', 'NumpadEnter', 'Space']) {
		const result = f.prompt.show('hot-resume');
		f.press('Tab');
		f.press('ArrowRight');
		f.press('ArrowLeft');
		assert.equal(f.focus.target, f.prompt.focusTarget);
		f.key(key, true);
		for (let index = 0; index < 10; index++) f.frame();
		assert.equal(f.prompt.visible, true);
		f.key(key, false);
		assert.equal(await result, 'continue');
	}
	const result = f.prompt.show('reboot');
	f.key('ShiftLeft', true); f.press('Tab'); f.key('ShiftLeft', false);
	f.press('Enter');
	assert.equal(await result, 'cancel');
});

test('pointer release outside or lost capture does not confirm; matching and coalesced clicks do', async t => {
	const f = fixture(t);
	const result = f.prompt.show('run');
	f.pointer(0, 1, 1); f.pointer(-1, 0, 0, 1);
	assert.equal(f.prompt.visible, true);
	f.pointer(0, 1, 1); f.capture.cancel(); f.pointer(0, 0, 0, 1);
	assert.equal(f.prompt.visible, true);
	f.pointer(0, 1, 1); f.pointer(0);
	assert.equal(f.prompt.visible, true);
	f.pointer(0, 1, 1);
	assert.equal(f.prompt.visible, true);
	f.pointer(0, 0, 0, 1);
	assert.equal(await result, 'save-continue');
	assert.equal(f.capture.active, false);
	const cancel = f.prompt.show('reboot');
	f.pointer(2, 0, 1, 1);
	assert.equal(await cancel, 'cancel');
});

test('replacement, focus departure and disposal settle the old decision without reclaiming focus', async t => {
	const f = fixture(t);
	const first = f.prompt.show('reboot');
	f.key('Enter', true);
	const second = f.prompt.show('hot-resume');
	assert.equal(await first, 'cancel');
	f.key('Enter', false);
	assert.equal(f.prompt.visible, true);
	const destination = f.focus.createTarget();
	destination.focus();
	assert.equal(await second, 'cancel');
	assert.equal(f.focus.target, destination);
	const final = f.prompt.show('close');
	f.prompt.dispose();
	assert.equal(await final, 'cancel');
	assert.equal(f.focus.target, destination);
});
