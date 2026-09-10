import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { create_rect_bounds } from '../../machine/ts/common/rect';
import type { PointerSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerButton } from '../../ide/input/pointer/buttons';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { WorkbenchScrollViewport } from '../../ide/workbench/ui/scroll_viewport';
import { WorkbenchScrollControl } from '../../ide/workbench/ui/scroll_control';

const PRIMARY = PointerButton.Primary;

function fixture(t: TestContext) {
	const view = new WorkbenchScrollViewport();
	view.layout(20, 30, 123, 130, 400);
	const focus = new InputFocusService();
	const capture = new PointerCaptureService();
	const parent = focus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	const control = new WorkbenchScrollControl(focus, capture, parent);
	control.setInput(view); control.lineStep = 10;
	const pointer = (x: number, y: number, held = 0, down = 0, up = 0, blocked = false) => {
		const event: PointerSnapshot = { viewportX: x, viewportY: y, valid: true, insideViewport: true,
			pressedButtons: held, justPressedButtons: down, justReleasedButtons: up };
		if (!capture.dispatch(event, blocked, 0) && !blocked) control.handlePointer(event);
		return event;
	};
	t.after(() => control.dispose());
	return { view, focus, capture, parent, control, pointer };
}

test('viewport projection, minimal reveal and range stay at the retained axis owner', t => {
	const { view } = fixture(t);
	const content = { left: 4, top: 220, right: 80, bottom: 234 };
	const screen = create_rect_bounds();
	view.scrollbar.reveal(content.top, content.bottom, 2);
	assert.equal(view.scrollTop, 136);
	view.project(content, screen);
	assert.deepEqual(screen, { left: 24, top: 114, right: 100, bottom: 128 });
	view.scrollbar.reveal(210, 215, 2); assert.equal(view.scrollTop, 136);
	view.scrollbar.reveal(20, 140, 2); assert.equal(view.scrollTop, 18, 'oversized child lead-aligns');
	const thumb = view.scrollbar.getThumb();
	const revision = view.revision;
	for (let i = 0; i < 100; i += 1) view.layout(20, 30, 123, 130, 400);
	assert.equal(view.revision, revision); assert.equal(view.scrollbar.getThumb(), thumb);
	view.scrollbar.setScroll(999); assert.equal(view.scrollTop, 300);
	view.layout(20, 30, 123, 130, 50);
	assert.equal(view.scrollTop, 0); assert.equal(view.scrollbar.isVisible(), false);
	assert.equal(view.bounds.right, 120, 'fitting content retains its reserved track width');
	view.layout(20, 30, 123, 30, 400);
	assert.equal(view.height, 0); assert.equal(view.scrollbar.isVisible(), false);
	view.layout(20, 30, 21, 50, 400);
	view.layout(20, 30, 22, 50, 400);
	assert.equal(view.scrollbar.getTrack().right, 22, 'track geometry also changes in a sub-track-width viewport');
});

test('thumb capture travels outside its track without focusing or accepting a draft', t => {
	const f = fixture(t);
	let commits = 0;
	f.parent.edit = { pending: true, commit: () => { commits += 1; return true; } };
	f.parent.onDidBlur(() => f.parent.edit!.commit());
	f.pointer(121, 35, PRIMARY, PRIMARY);
	assert.equal(f.capture.active, true); assert.equal(f.focus.target, f.parent);
	f.pointer(40, 90, PRIMARY); assert.equal(f.view.scrollTop, 220);
	f.pointer(40, 110, 0, 0, PRIMARY); assert.equal(f.view.scrollTop, 300);
	assert.equal(f.capture.active, false); assert.equal(commits, 0);
	const atEnd = f.view.scrollTop;
	f.pointer(121, 30); assert.equal(f.view.scrollTop, atEnd);
	f.pointer(121, 65, PRIMARY, PRIMARY);
	assert.equal(f.view.scrollTop, 90, 'track click centers the thumb before dragging');
	f.pointer(121, 65, 0, 0, PRIMARY);
});

test('geometry change, blocking, lost input, cancel and detach end capture without rollback', t => {
	const f = fixture(t);
	for (const cancel of [
		() => f.capture.cancel(),
		() => f.pointer(121, 70, PRIMARY, 0, 0, true),
		() => f.pointer(121, 70),
		() => { f.view.layout(20, 31, 123, 131, 400); f.control.update(); },
		() => f.control.clearInput(),
		() => f.control.setInput(new WorkbenchScrollViewport()),
	]) {
		f.view.layout(20, 30, 123, 130, 400); f.view.scrollbar.setScroll(0); f.control.setInput(f.view);
		f.pointer(121, 35, PRIMARY, PRIMARY); f.pointer(121, 60, PRIMARY);
		const scroll = f.view.scrollTop;
		cancel(); assert.equal(f.capture.active, false); assert.equal(f.view.scrollTop, scroll);
	}
});

test('wheel routes only inside this viewport and leaves focused values alone', t => {
	const f = fixture(t);
	assert.equal(f.control.handleWheel(f.pointer(40, 50), 40), true);
	assert.equal(f.view.scrollTop, 40); assert.equal(f.focus.target, f.parent);
	assert.equal(f.control.handleWheel(f.pointer(10, 50), 40), false);
	assert.equal(f.view.scrollTop, 40);
	f.pointer(40, 50, PRIMARY, PRIMARY);
	assert.equal(f.focus.target, f.control.focusTarget, 'background is a separate scroll-area focus target');
	const clock = new VirtualHeadlessClock(); const input = new Input(clock, new HeadlessInputHub(), -1);
	let pressId = 0;
	const press = (code: string) => {
		for (const down of [true, false]) {
			input.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now(), ++pressId);
			clock.advance(20); input.pollInput(); f.focus.handleKeyboard(input.getPlayerInput(1));
		}
	};
	press('PageDown'); assert.equal(f.view.scrollTop, 140);
	press('ArrowUp'); assert.equal(f.view.scrollTop, 130);
	press('End'); assert.equal(f.view.scrollTop, 300);
	press('Home'); assert.equal(f.view.scrollTop, 0);
});

test('a coalesced track click completes immediately; empty/clipped areas never focus or capture', t => {
	const f = fixture(t);
	f.pointer(121, 65, 0, PRIMARY, PRIMARY);
	assert.equal(f.view.scrollTop, 90); assert.equal(f.capture.active, false);
	assert.equal(f.focus.target, f.parent);
	f.view.layout(20, 30, 123, 30, 400);
	f.pointer(40, 30, PRIMARY, PRIMARY);
	assert.equal(f.focus.target, f.parent); assert.equal(f.capture.active, false);
	f.view.layout(20, 30, 123, 130, 400);
	f.pointer(40, 29, PRIMARY, PRIMARY);
	assert.equal(f.focus.target, f.parent); assert.equal(f.capture.active, false);
});
