import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { create_rect_bounds } from '../../machine/ts/common/rect';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { InputFocusService } from '../../ide/input/focus';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { PointerCaptureService } from '../../ide/input/pointer/capture';
import { WorkbenchScrollViewport } from '../../ide/workbench/ui/scroll_viewport';
import { WorkbenchScrollControl } from '../../ide/workbench/ui/scroll_control';

const PRIMARY = PointerButton.Primary;

test('retiring a focused scroll attachment cannot erase a new input admitted by its blur observer', t => {
	const f = fixture(t), next = new WorkbenchScrollViewport();
	next.layout(20, 30, 123, 130, 800);
	f.control.focusTarget.focus();
	const unbind = f.control.focusTarget.onDidBlur(() => f.control.setInput(next));
	t.after(unbind);
	f.control.clearInput();
	assert.equal(f.control.handleWheel({ valid: true, insideViewport: true, viewportX: 40, viewportY: 50 }, 30), true);
	assert.equal(next.scrollTop, 30);
	assert.equal(f.view.scrollTop, 0);
});

function fixture(t: TestContext) {
	const view = new WorkbenchScrollViewport();
	view.layout(20, 30, 123, 130, 400);
	const focus = new InputFocusService();
	const capture = new PointerCaptureService();
	const parent = focus.createTarget(); parent.bindKeyboard(() => {}); parent.focus();
	const control = new WorkbenchScrollControl(focus, capture, parent);
	control.setInput(view); control.lineStep = 10;
	const pointer = (x: number, y: number, held = 0, down = 0, up = 0, blocked = false) => {
		const event: PointerInputSnapshot = { modifiers: KeyModifier.none, spaceDown: false, viewportX: x, viewportY: y, valid: true, insideViewport: true,
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
	const draft = { pending: true, commit() { commits += 1; this.pending = false; return true; }, cancel() { this.pending = false; } };
	f.parent.edit = draft;
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

test('user scrolling suspends following before capture, while programmatic reveal does not', t => {
	const f = fixture(t);
	let following = true, gestures = 0;
	f.control.onWillScroll = () => { following = false; gestures += 1; };
	const update = () => {
		if (following) f.view.scrollbar.reveal(390, 400, 0);
	};
	update();
	assert.equal(f.view.scrollTop, 300);
	assert.equal(gestures, 0);
	f.pointer(121, 120, PRIMARY, PRIMARY);
	assert.equal(following, false, 'grabbing the thumb suspends following before any pointer movement');
	assert.equal(f.view.scrollTop, 300);
	assert.equal(f.focus.target, f.parent);
	f.pointer(121, 45, PRIMARY);
	update();
	assert.equal(f.view.scrollTop, 0, 'the next content update does not undo captured scrolling');
	f.pointer(121, 45, 0, 0, PRIMARY);
	assert.equal(gestures, 1, 'capture movement and release do not start another gesture');
	following = true;
	update();
	f.pointer(121, 65, 0, PRIMARY, PRIMARY);
	update();
	assert.equal(f.view.scrollTop, 90, 'a coalesced track click also leaves follow mode');
	assert.equal(f.capture.active, false);
	assert.equal(gestures, 2);
	following = true;
	f.view.layout(20, 30, 123, 130, 50);
	f.pointer(121, 65, PRIMARY, PRIMARY);
	assert.equal(following, true, 'a hidden thumb is not a scroll gesture');
	assert.equal(gestures, 2);
});

test('scroll intent belongs to the admitted viewport, including wheel over its track', t => {
	const f = fixture(t);
	let gestures = 0;
	f.control.onWillScroll = () => { gestures += 1; };
	f.control.handleWheel(f.pointer(40, 50), 0);
	assert.equal(gestures, 0);
	assert.equal(f.control.handleWheel(f.pointer(10, 50), 40), false);
	assert.equal(gestures, 0);
	assert.equal(f.control.handleWheel(f.pointer(121, 50), 40), true);
	assert.equal(f.view.scrollTop, 40);
	assert.equal(gestures, 1);
	f.pointer(40, 50, PRIMARY, PRIMARY);
	assert.equal(gestures, 1, 'background focus is not a scroll gesture');
	f.view.layout(20, 30, 123, 130, 500);
	f.view.scrollbar.setScroll(100);
	f.view.scrollbar.reveal(390, 400, 0);
	assert.equal(gestures, 1, 'range refinement and owner-driven positioning are not user input');
});

test('virtual height refinement retains the gesture, its sensitivity and the corrected reading anchor', t => {
	const f = fixture(t);
	f.pointer(121, 35, PRIMARY, PRIMARY); f.pointer(121, 55, PRIMARY);
	const scroll = f.view.scrollTop;
	f.view.layout(20, 30, 123, 130, 800); f.view.scrollbar.setScroll(scroll + 10);
	assert.equal(f.capture.active, true);
	f.pointer(121, 55, PRIMARY); assert.equal(f.view.scrollTop, scroll + 10, 'a stationary pointer does not overwrite layout correction');
	f.pointer(121, 65, PRIMARY); assert.equal(f.view.scrollTop, 120, 'sensitivity is the captured 300/75, not the refined content ratio');
	f.pointer(121, 65, 0, 0, PRIMARY); assert.equal(f.capture.active, false);
});

test('geometry change, blocking, lost input, cancel and detach end capture without rollback', t => {
	const f = fixture(t);
	for (const cancel of [
		() => f.capture.cancel(),
		() => f.pointer(121, 70, PRIMARY, 0, 0, true),
		() => f.pointer(121, 70),
		() => { f.view.layout(20, 31, 123, 131, 400); },
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
	let gestures = 0;
	f.control.onWillScroll = () => { gestures += 1; };
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
			clock.advance(20); input.pollInput(); f.focus.handleKeyboard(new KeyInputEvent(code, input.getPlayerInput(1).modifiers, false, down));
		}
	};
	press('PageDown'); assert.equal(f.view.scrollTop, 140);
	press('ArrowUp'); assert.equal(f.view.scrollTop, 130);
	press('End'); assert.equal(f.view.scrollTop, 300);
	press('Home'); assert.equal(f.view.scrollTop, 0);
	assert.equal(gestures, 5, 'one admitted wheel and four keyboard scrolls');
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

test('absolute keyboard targets are admitted before unchanged pixels, while relative gestures carry no edge', t => {
	const f = fixture(t), intents: Array<'start' | 'end' | undefined> = [], pixels: number[] = [];
	f.control.onWillScroll = edge => { intents.push(edge); pixels.push(f.view.scrollTop); };
	f.control.focusTarget.focus();
	const press = (code: string) => {
		f.focus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none));
		f.focus.handleKeyboard(new KeyInputEvent(code, KeyModifier.none, false, false));
	};
	f.view.layout(20, 30, 123, 130, 50);
	press('Home'); press('End');
	assert.deepEqual(intents, ['start', 'end']); assert.deepEqual(pixels, [0, 0]);
	f.control.handleWheel(f.pointer(40, 50), 0);
	assert.equal(intents.length, 2, 'zero wheel delta cannot replace an absolute target');
	f.control.handleWheel(f.pointer(40, 50), 10);
	assert.equal(intents[2], undefined); assert.equal(intents.length, 3);
	f.view.layout(20, 30, 123, 30, 400);
	press('End'); press('Home');
	assert.deepEqual(intents.slice(3), ['end', 'start']); assert.deepEqual(pixels.slice(3), [0, 400]);
	f.view.layout(20, 30, 123, 130, 400);
	press('PageDown'); press('ArrowUp');
	f.pointer(121, 35, PRIMARY, PRIMARY); f.pointer(121, 35, 0, 0, PRIMARY);
	assert.deepEqual(intents.slice(5), [undefined, undefined, undefined]);
});
