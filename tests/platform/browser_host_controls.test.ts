import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expandBrowserKeyboardTemplate } from '../../scripts/products/browser_keyboard';

// Production precedent: Lemuroid gives its menu distinct artwork and an ID,
// rather than requiring a shoulder chord. BMSX deliberately routes its icons
// straight to host commands. These checks exercise the browser contact owner;
// they do not claim UIKit behavior or physical comfort.
// https://github.com/Swordfish90/Lemuroid/blob/93e321d08f3dc0776bb0545da975d2cd7cd1f78f/lemuroid-touchinput/src/main/java/com/swordfish/touchinput/radial/layouts/shared/Controls.kt#L96-L104
test('browser host buttons retain independent native contact leases without injecting guest input', async t => {
	const template = expandBrowserKeyboardTemplate(await readFile('gamebase.html', 'utf8'));
	const controls = template.slice(template.indexOf('<div id="controller-viewport"'), template.indexOf('<div id="gameContainer">'));
	const bundle = await build({
		stdin: { contents: `export { BrowserHostControls } from './hosts/browser/host_controls';
export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { BrowserOnscreenKeyboard } from './hosts/browser/onscreen_keyboard';
export { BROWSER_KEYBOARD_PAGES } from './hosts/browser/onscreen_keyboard_layout';
export { OnScreenKeyboard } from './hosts/common/input/on_screen_keyboard';
export { Input } from './hosts/common/input/manager';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';
export { Memory } from './machine/ts/machine/memory/memory';
export { InputController } from './machine/ts/machine/devices/input/controller';
export { PSX_MACHINE_SPEC } from './machine/ts/spec/bmsx/model';
export { INP_CTRL_ARM, IO_INP_CTRL, IO_INP_PADS, IO_INP_PAD_BUTTONS_OFFSET, IO_INP_POINTER_BUTTONS } from './machine/ts/spec/bmsx/io';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', target: 'es2022', format: 'iife', globalName: 'hostFixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile('gamebase.css', 'utf8')}</style><body class="game-started"><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div></body>`);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => {
		const api = (globalThis as any).hostFixture;
		const clock = new api.BrowserHostClock();
		const pad = new api.BrowserOnscreenGamepad(clock);
		const view = new api.BrowserOnscreenGamepadView(document, window, pad);
		const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
		const video = new api.BrowserVideoOutput(canvas, view, 'fit');
		video.refreshLayout();
		const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, pad, 'F2');
		const actions = { keyboard: 0, menu: 0 };
		let host = new api.BrowserHostControls(document, () => { actions.keyboard += 1; }, () => { actions.menu += 1; });
		hub.setHostControls(host);
		const native: Array<{ type: string; id: number; trusted: boolean }> = [];
		const routed: Array<{ type: string; route: string; before: number; after: number; completed: boolean; trusted: boolean }> = [];
		const trace = { commonGamepad: null,
			pointerRouted(event: PointerEvent, route: string, before: number, after: number, _commonBefore: number, _commonAfter: number, completed: boolean) {
				routed.push({ type: event.type, route, before, after, completed, trusted: event.isTrusted });
			}, inputReset() {} };
		hub.setTraceObserver(trace);
		// Observe before the owning hub can stop propagation.
		for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(type, event => {
			const pointer = event as PointerEvent;
			native.push({ type, id: pointer.pointerId, trusted: pointer.isTrusted });
		}, { capture: true, passive: true });
		let input = new api.Input(clock, hub, pad.gamepadIndex);
		trace.commonGamepad = input.getPlayerInput(1).inputHandlers.gamepad;
		let keyboard = new api.OnScreenKeyboard(input, api.BROWSER_KEYBOARD_PAGES);
		hub.setOnscreenKeyboard(new api.BrowserOnscreenKeyboard(document, keyboard, () => keyboard.close()));
		const snapshot = api.createInputControllerSnapshot();
		const memory = new api.Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, api.PSX_MACHINE_SPEC.ramBytes);
		const supervisor = { supervisorContextActive() { return false; }, requestSupervisorLineEdge() {} };
		let controller = new api.InputController(memory, input, supervisor);
		controller.reset();
		let cycle = 0;
		(globalThis as any).hostProbe = {
			host, hub, pad, native, routed,
			poll() {
				input.pollInput();
				input.sampleInputControllerSnapshot(snapshot, 0);
				memory.writeMappedWord(api.IO_INP_CTRL, api.INP_CTRL_ARM);
				controller.onVblankEdge(++cycle);
				return { model: pad.buttons, common: input.getPlayerInput(1).inputHandlers.gamepad.physicalGamepadButtonsWord(),
					sampled: snapshot.pads[0].buttons, mmio: memory.readIoU32(api.IO_INP_PADS + api.IO_INP_PAD_BUTTONS_OFFSET),
					pointer: snapshot.pointerButtons, pointerMmio: memory.readIoU32(api.IO_INP_POINTER_BUTTONS),
					keys: Array.from(snapshot.keyWords), actions: { ...actions },
					pressed: ['host-keyboard-control', 'host-menu-control'].map(id => document.getElementById(id)!.getAttribute('aria-pressed')) };
			},
			points() {
				const center = { at(id: string) { const rect = document.getElementById(id)!.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; } };
				return { keyboard: center.at('host-keyboard-control'), menu: center.at('host-menu-control'), a: center.at('a_knop'),
					pad: { x: pad.geometry.padX + pad.geometry.padRadius * 0.7, y: pad.geometry.padY }, canvas: center.at('gamescreen') };
			},
			refresh() { video.refreshLayout(); },
			disposeView() { view.dispose(); },
			setKeyboardVisible(visible: boolean) { if (visible) keyboard.open(); else keyboard.close(); },
			disposeInput() { input.dispose(); },
			resubscribe() {
				host = new api.BrowserHostControls(document, () => { actions.keyboard += 1; }, () => { actions.menu += 1; });
				hub.setHostControls(host);
				input = new api.Input(clock, hub, pad.gamepadIndex);
				trace.commonGamepad = input.getPlayerInput(1).inputHandlers.gamepad;
				keyboard = new api.OnScreenKeyboard(input, api.BROWSER_KEYBOARD_PAGES);
				hub.setOnscreenKeyboard(new api.BrowserOnscreenKeyboard(document, keyboard, () => keyboard.close()));
				controller = new api.InputController(memory, input, supervisor); controller.reset();
			},
		};
	});
	const cdp = await page.context().newCDPSession(page);
	type Point = { id: number; x: number; y: number };
	const activeTouchIds = new Set<number>();
	const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: Point[]) => {
		await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(point => ({ ...point, radiusX: 14, radiusY: 14 })) });
		if (type === 'touchStart') for (const point of points) activeTouchIds.add(point.id);
		else if (type === 'touchCancel' || (type === 'touchEnd' && points.length === 0)) activeTouchIds.clear();
		else if (type === 'touchEnd') for (const point of points) activeTouchIds.delete(point.id);
	};
	const poll = () => page.evaluate(() => (globalThis as any).hostProbe.poll());
	const assertGuest = async (word = 0, pointer = 0) => {
		const state = await poll();
		assert.deepEqual([state.model, state.common, state.sampled, state.mmio], Array(4).fill(word), 'host actions never manufacture a guest controller chord');
		assert.deepEqual([state.pointer, state.pointerMmio], [pointer, pointer], 'host contacts never become canvas clicks');
		assert.ok(state.keys.every((value: number) => value === 0), 'host actions never synthesize guest keyboard keys');
		return state;
	};
	let points = await page.evaluate(() => (globalThis as any).hostProbe.points());
	t.afterEach(async () => { if (activeTouchIds.size !== 0) await touch('touchEnd', []); await poll(); });

	await t.test('each native release invokes exactly one action with visible independent acknowledgement', async () => {
		for (const [index, action] of ['keyboard', 'menu'].entries()) {
			const before = await assertGuest();
			const contact = { id: index + 1, ...points[action] };
			await touch('touchStart', [contact]);
			const held = await assertGuest();
			assert.deepEqual(held.actions, before.actions, 'down only owns and acknowledges the contact');
			assert.equal(held.pressed[index], 'true');
			for (let frame = 0; frame < 3; frame += 1) assert.deepEqual((await assertGuest()).actions, before.actions);
			await touch('touchEnd', []);
			const released = await assertGuest();
			assert.equal(released.actions[action], before.actions[action] + 1);
			assert.deepEqual(released.pressed, ['false', 'false']);
		}
	});

	await t.test('host, held gameplay and second host contacts remain separate native leases', async () => {
		const a = { id: 1, ...points.a }, keyboard = { id: 2, ...points.keyboard }, menu = { id: 3, ...points.menu };
		const before = await assertGuest();
		await touch('touchStart', [a]); await assertGuest(1);
		await touch('touchStart', [a, keyboard]); await assertGuest(1);
		await touch('touchStart', [a, keyboard, menu]);
		assert.deepEqual((await assertGuest(1)).pressed, ['true', 'true']);
		await touch('touchEnd', [keyboard]);
		const first = await assertGuest(1);
		assert.equal(first.actions.keyboard, before.actions.keyboard + 1);
		assert.equal(first.actions.menu, before.actions.menu);
		assert.deepEqual(first.pressed, ['false', 'true']);
		await touch('touchEnd', [menu]);
		assert.equal((await assertGuest(1)).actions.menu, before.actions.menu + 1);
		await touch('touchEnd', []); await assertGuest();
	});

	await t.test('two overlapping fingers on one host button form only one activation group', async () => {
		const before = await assertGuest();
		const first = { id: 1, ...points.keyboard }, second = { id: 2, x: points.keyboard.x + 4, y: points.keyboard.y };
		await touch('touchStart', [first]); await assertGuest();
		await touch('touchStart', [first, second]); await assertGuest();
		await touch('touchEnd', [first]);
		const partial = await assertGuest();
		assert.equal(partial.actions.keyboard, before.actions.keyboard + 1);
		assert.equal(partial.pressed[0], 'true', 'the surviving inside lease retains acknowledgement');
		await touch('touchEnd', []);
		const complete = await assertGuest();
		assert.equal(complete.actions.keyboard, before.actions.keyboard + 1, 'last up cannot toggle the host feature back');
		assert.equal(complete.pressed[0], 'false');
		await touch('touchStart', [first]); await touch('touchEnd', []);
		assert.equal((await assertGuest()).actions.keyboard, before.actions.keyboard + 2, 'a later independent tap is not suppressed');
	});

	await t.test('original host lease survives movement across the other icon, gamepad, and canvas without retargeting', async () => {
		const before = await assertGuest();
		const contact = { id: 1, ...points.keyboard };
		await touch('touchStart', [contact]); await assertGuest();
		for (const destination of [points.menu, points.a, points.pad, points.canvas]) {
			Object.assign(contact, destination);
			await touch('touchMove', [contact]);
			const moved = await assertGuest();
			assert.deepEqual(moved.actions, before.actions);
			assert.deepEqual(moved.pressed, ['false', 'false']);
		}
		await touch('touchEnd', []);
		assert.deepEqual((await assertGuest()).actions, before.actions, 'release outside the original button is not an activation');
		await touch('touchStart', [{ id: 2, ...points.keyboard }]);
		await touch('touchMove', [{ id: 2, ...points.menu }]); await assertGuest();
		await touch('touchMove', [{ id: 2, ...points.keyboard }]);
		assert.equal((await assertGuest()).pressed[0], 'true');
		await touch('touchEnd', []);
		assert.equal((await assertGuest()).actions.keyboard, before.actions.keyboard + 1, 'rolling back into the original target remains a valid release');
	});

	await t.test('native cancel, focus loss, pagehide and teardown clear feedback without invoking actions', async () => {
		for (const reset of ['cancel', 'blur', 'pagehide', 'teardown']) {
			const before = await assertGuest();
			await touch('touchStart', [{ id: 1, ...points.menu }]);
			assert.equal((await assertGuest()).pressed[1], 'true');
			if (reset === 'cancel') {
				const id = await page.evaluate(() => (globalThis as any).hostProbe.native.at(-1).id);
				await touch('touchCancel', []);
				// CDP cancellation acknowledges its request independently of renderer
				// delivery. Synchronize with the actual native producer, not a delay.
				await page.waitForFunction(id => (globalThis as any).hostProbe.native.some((event: { type: string; id: number }) =>
					event.type === 'pointercancel' && event.id === id), id);
			}
			else await page.evaluate(reason => {
				if (reason === 'teardown') (globalThis as any).hostProbe.disposeInput();
				else window.dispatchEvent(new Event(reason));
			}, reset);
			if (reset === 'teardown') await page.evaluate(() => (globalThis as any).hostProbe.resubscribe());
			const cleared = await assertGuest();
			assert.deepEqual(cleared.actions, before.actions);
			assert.deepEqual(cleared.pressed, ['false', 'false'], `${reset} clears both host acknowledgements`);
			if (activeTouchIds.size !== 0) await touch('touchEnd', []);
			assert.deepEqual((await assertGuest()).actions, before.actions, 'a stale up cannot reactivate a reset lease');
		}
	});

	await t.test('a held gamepad or canvas contact cannot acquire a host action by sliding', async () => {
		const before = await assertGuest();
		const gamepad = { id: 1, ...points.a };
		await touch('touchStart', [gamepad]); await assertGuest(1);
		Object.assign(gamepad, points.menu);
		await touch('touchMove', [gamepad]); await assertGuest();
		await touch('touchEnd', []);
		assert.deepEqual((await assertGuest()).actions, before.actions);
		const canvas = { id: 2, ...points.canvas };
		await touch('touchStart', [canvas]); await assertGuest(0, 1);
		Object.assign(canvas, points.keyboard);
		await touch('touchMove', [canvas]); await assertGuest(0, 1);
		await touch('touchEnd', []);
		assert.deepEqual((await assertGuest()).actions, before.actions);
	});

	await t.test('host lease ownership precedes foreground admission without leaking a synthetic key', async () => {
		const before = await assertGuest();
		await page.evaluate(() => (globalThis as any).hostProbe.hub.setForegroundPointerCapture(() => true));
		await touch('touchStart', [{ id: 1, ...points.menu }]); await assertGuest();
		await touch('touchEnd', []);
		assert.equal((await assertGuest()).actions.menu, before.actions.menu + 1);
		await page.evaluate(() => (globalThis as any).hostProbe.hub.setForegroundPointerCapture(() => false));
	});

	await t.test('keyboard foreground hides a held host icon without allowing its late release to request another overlay', async () => {
		for (const closeBeforeRelease of [false, true]) {
			const before = await assertGuest();
			await touch('touchStart', [{ id: 1, ...points.menu }]);
			assert.equal((await assertGuest()).pressed[1], 'true');
			await page.evaluate(() => (globalThis as any).hostProbe.setKeyboardVisible(true));
			if (closeBeforeRelease) {
				await touch('touchMove', [{ id: 1, x: points.menu.x + 2, y: points.menu.y }]); await assertGuest();
				await page.evaluate(() => (globalThis as any).hostProbe.setKeyboardVisible(false));
			}
			await touch('touchEnd', []);
			assert.deepEqual((await assertGuest()).actions, before.actions, 'a hidden or already-disarmed host lease cannot switch the current keyboard overlay');
			await page.evaluate(() => (globalThis as any).hostProbe.setKeyboardVisible(false));
			await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
		}
	});

	await t.test('a hidden original button cannot turn a release at the origin into a host activation', async () => {
		const before = await assertGuest();
		await touch('touchStart', [{ id: 1, ...points.menu }]);
		assert.equal((await assertGuest()).pressed[1], 'true');
		await page.locator('#host-menu-control').evaluate(element => { (element as HTMLButtonElement).hidden = true; });
		await touch('touchMove', [{ id: 1, x: 0, y: 0 }]); await assertGuest();
		await touch('touchEnd', []);
		assert.deepEqual((await assertGuest()).actions, before.actions, 'a zero-sized hidden target is not an actual button surface');
		await page.locator('#host-menu-control').evaluate(element => { (element as HTMLButtonElement).hidden = false; });
	});

	await t.test('native mouse release and browser click are one action; accessibility activation remains available', async () => {
		const before = await assertGuest();
		await page.mouse.click(points.menu.x, points.menu.y);
		assert.equal((await assertGuest()).actions.menu, before.actions.menu + 1, 'the follow-on native click cannot duplicate pointer release');
		await page.locator('#host-keyboard-control').evaluate(element => (element as HTMLButtonElement).click());
		const activated = await assertGuest();
		assert.equal(activated.actions.keyboard, before.actions.keyboard + 1, 'detail-zero activation uses the semantic button route');
		assert.equal(activated.actions.menu, before.actions.menu + 1);
	});

	await t.test('relayout during a held host contact tests the current button surface on release', async () => {
		const before = await assertGuest();
		await touch('touchStart', [{ id: 1, ...points.menu }]); await assertGuest();
		await page.setViewportSize({ width: 852, height: 393 });
		await page.evaluate(() => (globalThis as any).hostProbe.refresh());
		await touch('touchEnd', []);
		assert.deepEqual((await assertGuest()).actions, before.actions, 'release at the old portrait location cannot activate a moved landscape button');
		points = await page.evaluate(() => (globalThis as any).hostProbe.points());
		await touch('touchStart', [{ id: 2, ...points.menu }]); await touch('touchEnd', []);
		assert.equal((await assertGuest()).actions.menu, before.actions.menu + 1);
	});

	await t.test('real gamepad-view teardown makes an already captured host release inert', async () => {
		const before = await assertGuest();
		await touch('touchStart', [{ id: 1, ...points.menu }]);
		assert.equal((await assertGuest()).pressed[1], 'true');
		await page.evaluate(() => (globalThis as any).hostProbe.disposeView());
		assert.equal(await page.locator('#host-menu-control').evaluate(element => (element as HTMLButtonElement).hidden), true);
		await touch('touchMove', [{ id: 1, x: 0, y: 0 }]); await assertGuest();
		await touch('touchEnd', []);
		const released = await assertGuest();
		assert.deepEqual(released.actions, before.actions, 'a late native up cannot invoke a command belonging to a disposed controller view');
		assert.deepEqual(released.pressed, ['false', 'false']);
	});

	assert.deepEqual(errors, []);
	const native = await page.evaluate(() => (globalThis as any).hostProbe.native);
	assert.ok(native.length >= 50 && native.every((event: { trusted: boolean }) => event.trusted), 'contact behavior is exercised with trusted browser delivery, not hand-authored pointer events');
	const hostRoutes = await page.evaluate(() => (globalThis as any).hostProbe.routed.filter((event: { route: string }) => event.route === 'host'));
	assert.ok(hostRoutes.length >= 30 && hostRoutes.every((event: { before: number; after: number; completed: boolean; trusted: boolean }) =>
		event.before === event.after && event.completed && event.trusted), 'diagnostics classify actual host-owned events explicitly without reporting a guest controller mutation');
});
