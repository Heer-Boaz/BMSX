import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('native pointer contact geometry reaches common input and armed ICU at the browser boundary', async t => {
	const bundle = await build({
		stdin: {
			contents: `export { BrowserOnscreenGamepad, OnscreenActionBank } from './hosts/browser/onscreen_gamepad';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';
export { Memory } from './machine/ts/machine/memory/memory';
export { InputController } from './machine/ts/machine/devices/input/controller';
export { PSX_MACHINE_SPEC } from './machine/ts/spec/bmsx/model';
export { INP_CTRL_ARM, IO_INP_CTRL, IO_INP_PADS, IO_INP_PAD_BUTTONS_OFFSET } from './machine/ts/spec/bmsx/io';`,
			resolveDir: process.cwd(),
		},
		bundle: true, platform: 'browser', format: 'iife', globalName: 'fixture', write: false,
		tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 600, height: 280 }, isMobile: true, hasTouch: true });
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0}#player-surface{position:fixed;inset:0;touch-action:none}canvas{width:600px;height:280px}</style><div id="player-surface"><canvas id="gamescreen" width="600" height="280"></canvas></div>');
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => {
		const api = (globalThis as any).fixture;
		const clock = new api.BrowserHostClock();
		const pad = new api.BrowserOnscreenGamepad(clock);
		pad.setGeometry({
			padX: 100, padY: 100, padRadius: 50, padNeutralRadius: 9, stickTravelRadius: 24,
			faceX: 325, faceY: 100, faceRadius: 50,
			actions: [{ x: 300, y: 100, radius: 20, buttons: 1, bank: api.OnscreenActionBank.Face }, { x: 350, y: 100, radius: 20, buttons: 2, bank: api.OnscreenActionBank.Face }],
		});
		const nativeEvents: Array<{ type: string; id: number; pointerType: string; width: number; height: number; x: number; y: number; trusted: boolean }> = [];
		for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
			window.addEventListener(type, event => {
				const pointer = event as PointerEvent;
				nativeEvents.push({ type, id: pointer.pointerId, pointerType: pointer.pointerType, width: pointer.width, height: pointer.height,
					x: pointer.clientX, y: pointer.clientY, trusted: pointer.isTrusted });
			}, true);
		}
		const calls: Array<{ kind: string; x: number; y: number; halfWidth: number; halfHeight: number; active: boolean }> = [];
		const begin = pad.beginContact;
		const move = pad.moveContact;
		pad.beginContact = function (id: number, x: number, y: number, halfWidth: number, halfHeight: number, active: boolean) {
			calls.push({ kind: 'begin', x, y, halfWidth, halfHeight, active });
			return begin.call(pad, id, x, y, halfWidth, halfHeight, active);
		};
		pad.moveContact = function (id: number, x: number, y: number, halfWidth: number, halfHeight: number, active: boolean) {
			calls.push({ kind: 'move', x, y, halfWidth, halfHeight, active });
			return move.call(pad, id, x, y, halfWidth, halfHeight, active);
		};
		const hub = new api.BrowserInputHub(document.getElementById('gamescreen'), document.getElementById('player-surface'), clock, pad, 'F2');
		const input = new api.Input(clock, hub, pad.gamepadIndex);
		const snapshot = api.createInputControllerSnapshot();
		const memory = new api.Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, api.PSX_MACHINE_SPEC.ramBytes);
		const controller = new api.InputController(memory, input, {
			supervisorContextActive() { return false; }, requestSupervisorLineEdge() {},
		});
		controller.reset();
		let cycle = 0;
		(globalThis as any).contactFixture = {
			poll() {
				input.pollInput();
				input.sampleInputControllerSnapshot(snapshot, 0);
				memory.writeMappedWord(api.IO_INP_CTRL, api.INP_CTRL_ARM);
				controller.onVblankEdge(++cycle);
				return { model: pad.buttons, common: snapshot.pads[0].buttons,
					mmio: memory.readIoU32(api.IO_INP_PADS + api.IO_INP_PAD_BUTTONS_OFFSET), pointer: snapshot.pointerButtons };
			},
			takeEvents() { return { native: nativeEvents.splice(0), calls: calls.splice(0) }; },
		};
	});
	const cdp = await page.context().newCDPSession(page);
	const poll = () => page.evaluate(() => (globalThis as any).contactFixture.poll());
	const takeEvents = () => page.evaluate(() => (globalThis as any).contactFixture.takeEvents());
	const activeTouchIds = new Set<number>();
	let activeMouse: 'mouse' | 'pen' | null = null;
	const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: Array<{ id: number; x: number; y: number; radiusX?: number; radiusY?: number }>) => {
		await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
		if (type === 'touchStart') for (const point of touchPoints) activeTouchIds.add(point.id);
		else if (type === 'touchCancel' || (type === 'touchEnd' && touchPoints.length === 0)) activeTouchIds.clear();
		else if (type === 'touchEnd') for (const point of touchPoints) activeTouchIds.delete(point.id);
	};
	const assertWord = async (word: number, pointer = 0) => {
		assert.deepEqual(await poll(), { model: word, common: word, mmio: word, pointer });
	};
	t.afterEach(async () => {
		if (activeTouchIds.size !== 0) await touch('touchCancel', []);
		if (activeMouse !== null) {
			await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 325, y: 100, button: 'left', buttons: 0, clickCount: 1, pointerType: activeMouse });
			activeMouse = null;
		}
		await assertWord(0);
		await takeEvents();
	});

	await t.test('a measured elliptical contact intersects two adjacent circular buttons', async () => {
		await touch('touchStart', [{ id: 1, x: 325, y: 100, radiusX: 12, radiusY: 8 }]);
		await assertWord(3);
		const events = await takeEvents();
		assert.deepEqual(events.native.map(event => [event.type, event.pointerType, event.width, event.height, event.trusted]),
			[['pointerdown', 'touch', 24, 16, true]]);
		assert.deepEqual(events.calls, [{ kind: 'begin', x: 325, y: 100, halfWidth: 12, halfHeight: 8, active: true }]);
	});

	await t.test('the normative unavailable 1x1 contact uses the authored fallback, not a supported-size minimum', async () => {
		await touch('touchStart', [{ id: 1, x: 325, y: 100, radiusX: 0.5, radiusY: 0.5 }]);
		await assertWord(3);
		const unavailable = await takeEvents();
		assert.deepEqual(unavailable.native.map(event => [event.width, event.height, event.trusted]), [[1, 1, true]]);
		assert.deepEqual(unavailable.calls, [{ kind: 'begin', x: 325, y: 100, halfWidth: 14, halfHeight: 14, active: true }]);
		await touch('touchEnd', []);
		await assertWord(0);
		await takeEvents();
		await touch('touchStart', [{ id: 2, x: 325, y: 100, radiusX: 1, radiusY: 1 }]);
		await assertWord(0, 0);
		const small = await takeEvents();
		assert.deepEqual(small.native.map(event => [event.width, event.height, event.trusted]), [[2, 2, true]]);
		assert.deepEqual(small.calls, [{ kind: 'begin', x: 325, y: 100, halfWidth: 1, halfHeight: 1, active: true }]);
	});

	await t.test('native movement updates measured contact extents and retained contributions', async () => {
		const point = { id: 1, x: 325, y: 100 };
		await touch('touchStart', [{ ...point, radiusX: 12, radiusY: 8 }]);
		await assertWord(3);
		await takeEvents();
		await touch('touchMove', [{ ...point, x: 326, radiusX: 1, radiusY: 1 }]);
		await assertWord(0);
		const small = await takeEvents();
		assert.ok(small.native.some(event => event.type === 'pointermove' && event.x === 326 && event.y === 100 && event.width === 2 && event.height === 2 && event.trusted));
		assert.deepEqual(small.calls, [{ kind: 'move', x: 326, y: 100, halfWidth: 1, halfHeight: 1, active: true }]);
		await touch('touchMove', [{ ...point, radiusX: 12, radiusY: 8 }]);
		await assertWord(3);
		assert.deepEqual((await takeEvents()).calls, [{ kind: 'move', x: 325, y: 100, halfWidth: 12, halfHeight: 8, active: true }]);
	});

	await t.test('synthetic geometry-only pointer updates exercise the same-coordinate owner contract', async () => {
		// CDP suppresses native touchMove when coordinates do not change, including
		// radius-only changes. The contact starts natively; these updates deliberately
		// test BMSX event handling rather than claim native hardware-event coverage.
		await touch('touchStart', [{ id: 1, x: 325, y: 100, radiusX: 12, radiusY: 8 }]);
		await assertWord(3);
		const id = (await takeEvents()).native.find(event => event.type === 'pointerdown').id;
		for (const [width, height, halfWidth, halfHeight, word] of [[2, 2, 1, 1, 0], [24, 16, 12, 8, 3]]) {
			await page.evaluate(({ id, width, height }) => {
				window.dispatchEvent(new PointerEvent('pointermove', {
					pointerId: id, pointerType: 'touch', clientX: 325, clientY: 100,
					width, height, buttons: 1, bubbles: true, cancelable: true,
				}));
			}, { id, width, height });
			await assertWord(word);
			const events = await takeEvents();
			assert.deepEqual(events.native.map(event => [event.type, event.x, event.y, event.width, event.height, event.trusted]),
				[['pointermove', 325, 100, width, height, false]]);
			assert.deepEqual(events.calls, [{ kind: 'move', x: 325, y: 100, halfWidth, halfHeight, active: true }]);
		}
	});

	await t.test('a single default-looking axis preserves the actual nonuniform contact instead of selecting the fallback', async () => {
		for (const [radiusX, radiusY, word, pointer] of [[0.5, 12, 0, 0], [12, 0.5, 3, 0]]) {
			await touch('touchStart', [{ id: 1, x: 325, y: 100, radiusX, radiusY }]);
			await assertWord(word, pointer);
			const events = await takeEvents();
			assert.deepEqual(events.native.map(event => [event.width, event.height, event.trusted]), [[radiusX * 2, radiusY * 2, true]]);
			assert.deepEqual(events.calls, [{ kind: 'begin', x: 325, y: 100, halfWidth: radiusX, halfHeight: radiusY, active: true }]);
			await touch('touchEnd', []);
			await assertWord(0);
			await takeEvents();
		}
	});

	await t.test('independent contacts retain overlapping bits through either release order', async () => {
		const a = { id: 1, x: 300, y: 100, radiusX: 3, radiusY: 3 };
		const both = { id: 2, x: 325, y: 100, radiusX: 12, radiusY: 8 };
		for (const firstRelease of [a, both]) {
			await touch('touchStart', [a]);
			await assertWord(1);
			await touch('touchStart', [a, both]);
			await assertWord(3);
			await touch('touchEnd', [firstRelease]);
			await assertWord(firstRelease === a ? 3 : 1);
			await touch('touchEnd', []);
			await assertWord(0);
		}
	});

	for (const pointerType of ['mouse', 'pen'] as const) {
		await t.test(`native ${pointerType} contact remains a point rather than an artificial thumb`, async () => {
			await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 325, y: 100, button: 'left', buttons: 1, clickCount: 1, pointerType });
			activeMouse = pointerType;
			await assertWord(0, 0);
			const events = await takeEvents();
			assert.ok(events.native.some(event => event.type === 'pointerdown' && event.pointerType === pointerType && event.trusted));
			assert.deepEqual(events.calls.filter(call => call.kind === 'begin'), [{ kind: 'begin', x: 325, y: 100, halfWidth: 0, halfHeight: 0, active: true }]);
			await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 325, y: 100, button: 'left', buttons: 0, clickCount: 1, pointerType });
			activeMouse = null;
			await assertWord(0);
		});
	}
	assert.deepEqual(errors, []);
});
