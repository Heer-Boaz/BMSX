import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('canvas pointer events own field focus and caret before text input, independently of host frames', async t => {
	const fixture = String.raw`import { BrowserInputHub } from './hosts/browser/input';
import { BrowserHostClock } from './hosts/browser/timing';
import { BrowserTextInput } from './hosts/browser/text_input';
import { DisplayGeometry } from './hosts/common/display_geometry';
import { inputFocus } from './ide/input/focus';
import { TextField } from './ide/editor/ui/inline/text_field_model';
import { SingleLineFieldViewport } from './ide/editor/ui/inline/single_line_viewport';
import { EditorFont } from './ide/editor/ui/view/font';
import { applyInlineFieldEditing, applyInlineFieldPointer, setFieldText } from './ide/editor/ui/inline/text_field';
export function start() {
	const canvas = document.querySelector('canvas')!;
	const fields = [new TextField(), new TextField()];
	setFieldText(fields[0], 'alpha'); setFieldText(fields[1], 'beta');
	const metrics = { advanceChar: () => 8, spaceAdvance: 8, tabSpaces: 4 }, font = new EditorFont('msx');
	const views = fields.map((field, index) => {
		const view = new SingleLineFieldViewport();
		view.layout(field, { left: index * 200 - 3, top: 0, right: (index + 1) * 200, bottom: 20 }, metrics, font);
		return view;
	});
	for (const field of fields) field.focusTarget.bindKeyboard(event => applyInlineFieldEditing(event, field));
	const host = {
		get textTarget() { return inputFocus.target?.textInput; },
		onDidChangeTarget: listener => inputFocus.onDidChangeTarget(listener),
		dispatchKey(event) { inputFocus.handleKeyboard(event); return event.consumed; },
		cancelPointerInput() {},
		cancelInput() { inputFocus.cancelInput(); },
	};
	const clock = new BrowserHostClock();
	const hub = new BrowserInputHub(canvas, canvas, clock, undefined, 'ScrollLock');
	const deviceButtons = [], deviceCancellations = [];
	hub.subscribe({ inputButton(device, code, pressed) { if (device === 'pointer:0') deviceButtons.push({ code, pressed }); },
		inputAxis1() {}, inputAxis2() {}, capturePhysicalKeyHold() {},
		setSupervisorRequestLine() {}, resetInput() {}, cancelPointerButtons(device, buttons) { deviceCancellations.push(buttons); } });
	const geometry = new DisplayGeometry(), bounds = canvas.getBoundingClientRect();
	geometry.update(bounds.left, bounds.top, bounds.width, bounds.height, canvas.width, canvas.height);
	const text = new BrowserTextInput(canvas, geometry, host);
	hub.setNativeKeyHandler(text.handleKey);
	const events = [];
	let pointerId = 0;
	window.addEventListener('pointerdown', event => { pointerId = event.pointerId; }, { capture: true });
	const focusAtReturn = [];
	hub.setNativePointerHandler(event => {
		events.push({ ...event });
		const index = event.x < 200 ? 0 : 1;
		const field = fields[index];
		if ((event.pressedButtons & 1) !== 0) field.focusTarget.focus();
		if (field.focusTarget.hasFocus) {
			applyInlineFieldPointer(field, { metrics,
				textLeft: views[index].textLeft, pointerX: event.x, justPressed: (event.pressedButtons & 1) !== 0,
				pointerPressed: (event.buttons & 1) !== 0, doubleClickInterval: 250 });
			inputFocus.notifyTargetChanged();
		}
		focusAtReturn.push(document.activeElement?.tagName);
	});
	fields[0].focusTarget.focus();
	globalThis.pointerFixture = {
		state: () => ({ texts: fields.map(field => field.text), events: events.splice(0), focusAtReturn: focusAtReturn.splice(0),
			deviceButtons: deviceButtons.splice(0), deviceCancellations: deviceCancellations.splice(0) }),
		releaseCapture: () => canvas.releasePointerCapture(pointerId),
	};
}`;
	const bundle = await build({ stdin: { contents: fixture, resolveDir: process.cwd(), loader: 'ts' }, bundle: true,
		platform: 'browser', format: 'iife', globalName: 'fixture', write: false, tsconfig: 'tsconfig.base.json' });
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 400, height: 200 }, hasTouch: true, isMobile: true });
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{width:400px;height:200px;touch-action:none}</style><canvas width="400" height="200"></canvas>');
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => (globalThis as any).fixture.start());
	const state = () => page.evaluate(() => (globalThis as any).pointerFixture.state());
	await state();
	await page.mouse.click(216, 60);
	await page.keyboard.type('Z');
	assert.deepEqual((await state()).texts, ['alpha', 'beZta']);
	await page.mouse.click(8, 60);
	await page.keyboard.type('Q');
	const mouse = await state();
	assert.deepEqual(mouse.texts, ['aQlpha', 'beZta']);
	assert.ok(mouse.focusAtReturn.every((tag: string) => tag === 'TEXTAREA'), 'native focus is acquired in the pointer callback');
	await page.touchscreen.tap(224, 60);
	await page.keyboard.type('T');
	const touch = await state();
	assert.deepEqual(touch.texts, ['aQlpha', 'beZTta']);
	assert.ok(touch.focusAtReturn.every((tag: string) => tag === 'TEXTAREA'));
	await page.mouse.move(350, 140);
	const hover = await state();
	assert.ok(hover.events.some((event: { x: number; y: number; buttons: number }) => event.x === 350 && event.y === 140 && event.buttons === 0));
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: 80, y: 60 }, { id: 2, x: 100, y: 60 }] });
	const down = await state();
	const contacts = down.events.filter((event: { pressedButtons: number }) => event.pressedButtons === 1);
	assert.equal(contacts.length, 2, 'the UI receives each contact, not the guest device aggregate');
	assert.notEqual(contacts[0].pointerId, contacts[1].pointerId);
	assert.ok(contacts.every((event: { pointerType: string }) => event.pointerType === 'touch'));
	assert.equal(down.deviceButtons.length, 1, 'the physical guest pointer still aggregates contact buttons');
	assert.equal(down.deviceButtons[0].pressed, true);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
	const cancelled = await state();
	const cancellations = cancelled.events.filter((event: { cancelledButtons: number }) => event.cancelledButtons === 1);
	assert.deepEqual(cancellations.map((event: { pointerId: number }) => event.pointerId).sort(),
		contacts.map((event: { pointerId: number }) => event.pointerId).sort());
	assert.deepEqual(cancelled.deviceCancellations, [1]);
	assert.deepEqual(cancelled.deviceButtons, [], 'guest cancellation does not manufacture a release');
	assert.ok(cancelled.events.every((event: { releasedButtons: number }) => event.releasedButtons === 0), 'cancellation is never a drop');
	// Lose a real DOM capture while the physical mouse remains down. A later
	// window move/up must not manufacture the successful release we did not get.
	await page.mouse.move(80, 60);
	await page.mouse.down();
	await page.mouse.move(81, 60); // Process the browser's pending capture before losing it.
	await state();
	await page.evaluate(() => (globalThis as any).pointerFixture.releaseCapture());
	await page.mouse.move(100, 60);
	const lost = await state();
	assert.equal(lost.events.filter((event: { cancelledButtons: number }) => event.cancelledButtons === 1).length, 1);
	assert.ok(lost.events.every((event: { releasedButtons: number }) => event.releasedButtons === 0));
	await page.mouse.up();
	assert.ok((await state()).events.every((event: { releasedButtons: number }) => event.releasedButtons === 0),
		'the release after capture loss cannot finish the cancelled gesture');
	await page.mouse.click(80, 60);
	const fresh = await state();
	assert.equal(fresh.events.filter((event: { pressedButtons: number }) => event.pressedButtons === 1).length, 1);
	assert.equal(fresh.events.filter((event: { releasedButtons: number }) => event.releasedButtons === 1).length, 1);
	assert.ok(fresh.events.every((event: { cancelledButtons: number }) => event.cancelledButtons === 0),
		'the normal pointerup-generated lostcapture cannot cancel an already completed contact');
	assert.deepEqual(errors, []);
});
