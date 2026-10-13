import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('native browser contacts reach the real common input and ICU without DOM-target feedback', async t => {
	const template = await readFile('gamebase.html', 'utf8');
	const controls = template.slice(template.indexOf('<div id="controller-viewport"'), template.indexOf('<div id="gameContainer">'));
	const bundle = await build({
		stdin: {
			contents: `export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';
export { Memory } from './machine/ts/machine/memory/memory';
export { InputController } from './machine/ts/machine/devices/input/controller';
export { PSX_MACHINE_SPEC } from './machine/ts/spec/bmsx/model';
export { INP_CTRL_ARM, IO_INP_CTRL, IO_INP_PADS, IO_INP_PAD_BUTTONS_OFFSET, IO_INP_POINTER_BUTTONS } from './machine/ts/spec/bmsx/io';`,
			resolveDir: process.cwd(),
		},
		bundle: true, platform: 'browser', format: 'iife', globalName: 'fixture', write: false,
		tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 852, height: 393 }, isMobile: true, hasTouch: true });
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile('gamebase.css', 'utf8')}</style><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas><div id="capture-other"></div></div><button id="outside-player" style="position:fixed;z-index:10;left:420px;top:20px;width:30px;height:20px">Outside</button>`);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => {
		const api = (globalThis as any).fixture;
		const clock = new api.BrowserHostClock();
		const pad = new api.BrowserOnscreenGamepad(clock);
		const view = new api.BrowserOnscreenGamepadView(document, window, pad);
		const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
		const video = new api.BrowserVideoOutput(canvas, view);
		video.refreshLayout();
		const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, pad, 'F2');
		const pointerEvents: Array<{ type: string; id: number; target: string; trusted: boolean }> = [];
		const nativeTouches: Array<{ type: string; player: boolean; prevented: boolean; trusted: boolean }> = [];
		for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'gotpointercapture', 'lostpointercapture']) {
			window.addEventListener(type, event => {
				const pointer = event as PointerEvent;
				pointerEvents.push({ type, id: pointer.pointerId, target: (pointer.target as Element).id, trusted: pointer.isTrusted });
			}, true);
		}
		for (const type of ['touchstart', 'touchmove', 'touchend']) {
			window.addEventListener(type, event => nativeTouches.push({
				type, player: !!(event.target as Element).closest('#player-surface'),
				prevented: event.defaultPrevented, trusted: event.isTrusted,
			}));
		}
		const edges: Array<{ device: string; code: string; down: boolean; pressId: number }> = [];
		let input = new api.Input(clock, hub, pad.gamepadIndex);
		const inputButton = input.inputButton;
		Object.defineProperty(input, 'inputButton', {
			value(device: string, code: string, down: boolean, value: number, time: number, pressId: number) {
				edges.push({ device, code, down, pressId });
				inputButton.call(input, device, code, down, value, time, pressId);
			},
		});
		const snapshot = api.createInputControllerSnapshot();
		const memory = new api.Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, api.PSX_MACHINE_SPEC.ramBytes);
		const supervisorPort = { supervisorContextActive() { return false; }, requestSupervisorLineEdge() {} };
		let controller = new api.InputController(memory, input, supervisorPort);
		controller.reset();
		let cycle = 0;
		(globalThis as any).touchTest = {
			pad, view, video, hub, edges, pointerEvents, nativeTouches,
			poll() {
				input.pollInput();
				input.sampleInputControllerSnapshot(snapshot, 0);
				memory.writeMappedWord(api.IO_INP_CTRL, api.INP_CTRL_ARM);
				controller.onVblankEdge(++cycle);
				const primary = input.getPlayerInput(1).inputHandlers.pointer.getButtonState('pointer_primary');
				return {
					buttons: pad.buttons, snapshot: snapshot.pads[0].buttons,
					mmio: memory.readIoU32(api.IO_INP_PADS + api.IO_INP_PAD_BUTTONS_OFFSET),
					pointer: snapshot.pointerButtons, pointerMmio: memory.readIoU32(api.IO_INP_POINTER_BUTTONS),
					position: [snapshot.pointerXQ16, snapshot.pointerYQ16],
					pointerState: { pressed: primary.pressed, justreleased: primary.justreleased, wasreleased: primary.wasreleased },
					padImage: document.querySelector('.d-pad-image[data-active="true"]')!.id,
					visuals: ['a_knop', 'b_knop', 'x_knop', 'y_knop'].map(id => document.getElementById(id)!.getAttribute('data-touched')),
					edges: edges.splice(0),
				};
			},
			disposeInput() { input.dispose(); },
			subscribeInput() {
				input = new api.Input(clock, hub, pad.gamepadIndex);
				controller = new api.InputController(memory, input, supervisorPort);
				controller.reset();
			},
		};
	});
	await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
	const cdp = await page.context().newCDPSession(page);
	const points = await page.evaluate(() => {
		const coordinates = { center(id: string, finger: number) {
			const rect = document.getElementById(id)!.getBoundingClientRect();
			return { id: finger, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		} };
		const base = document.getElementById('d-pad-svg')!.getBoundingClientRect();
		const a = document.getElementById('a_knop')!.getBoundingClientRect();
		const canvas = document.getElementById('gamescreen')!.getBoundingClientRect();
		const faceNeutral = coordinates.center('button-controls', 1);
		return {
			a: coordinates.center('a_knop', 1), b: coordinates.center('b_knop', 2), x: coordinates.center('x_knop', 3), y: coordinates.center('y_knop', 4),
			a2: { id: 5, x: a.left + a.width * 0.6, y: a.top + a.height * 0.5 },
			aEdge: { id: 1, x: a.left + a.width * 0.5, y: a.top + a.height * 0.025 },
			pad: coordinates.center('d-pad-svg', 6),
			left: { id: 6, x: base.left + base.width * 0.2, y: base.top + base.height * 0.5 },
			right: { id: 6, x: base.left + base.width * 0.8, y: base.top + base.height * 0.5 },
			up: { id: 6, x: base.left + base.width * 0.5, y: base.top + base.height * 0.2 },
			select: coordinates.center('select_knop', 11),
			faceNeutral,
			upRight: { id: 6, x: base.left + base.width * 0.64, y: base.top + base.height * 0.36, radiusX: 14, radiusY: 14 },
			canvas: { id: 7, x: canvas.left + canvas.width * 0.5, y: canvas.top + canvas.height * 0.5 },
			canvas2: { id: 8, x: canvas.left + canvas.width * 0.55, y: canvas.top + canvas.height * 0.5 },
			miss: { id: 9, x: 430, y: 5 },
		};
	});
	const poll = () => page.evaluate(() => (globalThis as any).touchTest.poll());
	const activeTouchIds = new Set<number>();
	const touch = async (type: 'touchStart' | 'touchEnd' | 'touchMove' | 'touchCancel', touchPoints: Array<{ id: number; x: number; y: number; force?: number; radiusX?: number; radiusY?: number }>) => {
		await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
		if (type === 'touchStart') for (const point of touchPoints) activeTouchIds.add(point.id);
		else if (type === 'touchCancel' || (type === 'touchEnd' && touchPoints.length === 0)) activeTouchIds.clear();
		else if (type === 'touchEnd') for (const point of touchPoints) activeTouchIds.delete(point.id);
	};
	t.afterEach(async () => {
		if (activeTouchIds.size !== 0) await touch('touchEnd', []);
		await poll();
	});
	const assertWord = async (word: number, pointer = 0) => {
		const state = await poll();
		assert.equal(state.buttons, word, 'model word');
		assert.equal(state.snapshot, word, 'real common-input snapshot');
		assert.equal(state.mmio, word, 'real armed ICU MMIO');
		assert.equal(state.pointer, pointer, 'canvas contribution');
		assert.equal(state.pointerMmio, pointer, 'real ICU pointer MMIO');
		return state;
	};

	await t.test('sequential A+B preserve either first-held button and either release order', async () => {
		for (const first of [points.a, points.b]) {
			const second = first === points.a ? points.b : points.a;
			for (const releaseFirst of [points.a, points.b]) {
				await touch('touchStart', [first]);
				await assertWord(first === points.a ? 1 : 2);
				await touch('touchStart', [first, second]);
				await assertWord(3);
				await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
				assert.deepEqual((await poll()).visuals.slice(0, 2), ['true', 'true']);
				await touch('touchEnd', [releaseFirst]);
				await assertWord(releaseFirst === points.a ? 2 : 1);
				await touch('touchEnd', []);
				await assertWord(0);
			}
		}
	});

	await t.test('action movement follows physical contact, not pressed artwork or its initial assignment', async () => {
		await touch('touchStart', [points.aEdge]);
		await assertWord(1);
		await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
		await touch('touchMove', [{ ...points.aEdge, y: points.aEdge.y + 0.1 }]);
		await assertWord(1);
		await touch('touchMove', [{ ...points.aEdge, y: points.aEdge.y + 0.2, force: 0 }]);
		await assertWord(1);
		await touch('touchMove', [{ ...points.aEdge, x: points.canvas.x, y: points.canvas.y }]);
		await assertWord(0);
		await touch('touchMove', [{ ...points.b, id: points.aEdge.id }]);
		await assertWord(2);
		await touch('touchMove', [points.a]);
		await assertWord(1);
		await touch('touchEnd', []);
		await assertWord(0);
	});

	await t.test('two native contacts on A aggregate until the last contact ends', async () => {
		await touch('touchStart', [points.a]);
		await poll();
		await touch('touchStart', [points.a, points.a2]);
		const added = await assertWord(1);
		assert.equal(added.edges.length, 0);
		await touch('touchEnd', [points.a]);
		const retained = await assertWord(1);
		assert.equal(retained.edges.length, 0);
		await touch('touchEnd', []);
		const released = await assertWord(0);
		assert.deepEqual(released.edges.map((edge: any) => [edge.code, edge.down]), [['a', false]]);
	});

	await t.test('a resting thumb on the face deck rolls into A and a measured circular footprint does not invent B', async () => {
		await touch('touchStart', [points.faceNeutral]);
		await assertWord(0);
		await touch('touchMove', [points.a]);
		await assertWord(1);
		await touch('touchMove', [{ ...points.a, x: points.a.x + 22, y: points.a.y - 22, radiusX: 14, radiusY: 14 }]);
		await assertWord(1, 0);
		await touch('touchMove', [{ ...points.a, x: (points.a.x + points.b.x) / 2, y: (points.a.y + points.b.y) / 2, radiusX: 14, radiusY: 14 }]);
		await assertWord(3, 0);
		await touch('touchEnd', []);
		await assertWord(0);
	});

	await t.test('a continuous outer D-pad arc has no diagonal gap and a held pad cannot press SELECT', async () => {
		const radius = points.right.x - points.pad.x;
		await touch('touchStart', [points.right]);
		let phase = 0;
		for (let step = 0; step <= 16; step += 1) {
			const angle = (step + 0.5) * Math.PI / 32;
			await touch('touchMove', [{ id: points.pad.id, x: points.pad.x + Math.cos(angle) * radius,
				y: points.pad.y - Math.sin(angle) * radius, radiusX: 14, radiusY: 14 }]);
			const word = (await poll()).buttons;
			assert.ok(word === 0x8000 || word === 0x9000 || word === 0x1000, 'every arc sample presses a cardinal or joined adjacent pair, never neutral or an opposite');
			const nextPhase = word === 0x8000 ? 0 : word === 0x9000 ? 1 : 2;
			assert.ok(nextPhase >= phase, 'the quarter arc cannot drop back into a previous pressure region');
			phase = nextPhase;
			await assertWord(word, 0);
		}
		assert.equal(phase, 2, 'the completed arc has reached UP');
		await touch('touchMove', [{ id: points.pad.id, x: points.select.x, y: points.select.y, radiusX: 14, radiusY: 14 }]);
		await assertWord(0x8000, 0);
		await touch('touchStart', [{ id: points.pad.id, x: points.select.x, y: points.select.y, radiusX: 14, radiusY: 14 }, points.select]);
		const state = await poll();
		assert.equal(state.buttons, 0x8100, 'an independent finger can press SELECT while the first still owns the rocker');
		await touch('touchEnd', []);
		await assertWord(0);
	});

	await t.test('digital D-pad capture supports immediate direction changes, rolling and re-entry', async () => {
		await touch('touchStart', [points.pad]);
		await assertWord(0);
		await touch('touchMove', [points.right]);
		await assertWord(0x8000);
		await touch('touchMove', [points.up]);
		await assertWord(0x1000, 0); // One native move, no center traversal or analog settling.
		await touch('touchMove', [points.upRight]);
		await assertWord(0x9000);
		await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
		assert.equal((await poll()).padImage, 'svgimg-d-pad-ru');
		await touch('touchMove', [{ ...points.pad, x: points.canvas.x, y: points.canvas.y }]);
		await assertWord(0x8000, 0); // A captured digital rocker keeps steering beyond its edge.
		await touch('touchMove', [points.left]);
		await assertWord(0x4000);
		await touch('touchEnd', []);
		await assertWord(0);
	});

	await t.test('D-pad and A+B+X+Y fingers remain independent while the captured rocker leaves its artwork', async () => {
		const active = [points.left];
		await touch('touchStart', active);
		await assertWord(0x4000);
		for (const action of [points.a, points.b, points.x, points.y]) {
			active.push(action);
			await touch('touchStart', active);
		}
		await assertWord(0x400f);
		active[0] = { ...points.left, x: points.canvas.x, y: points.pad.y };
		await touch('touchMove', active);
		await assertWord(0x800f);
		active[0] = points.pad;
		await touch('touchMove', active);
		await assertWord(0xf);
		active[0] = points.left;
		await touch('touchMove', active);
		await assertWord(0x400f);
		await touch('touchEnd', [points.left]);
		await assertWord(0xf);
		await touch('touchEnd', []);
		await assertWord(0);
	});

	await t.test('misses stay outside the controller and pad ownership cannot migrate into action buttons', async () => {
		await touch('touchStart', [points.miss]);
		await touch('touchMove', [{ ...points.miss, x: points.a.x, y: points.a.y }]);
		await assertWord(0);
		await touch('touchEnd', []);
		const second = { ...points.pad, id: 10 };
		await touch('touchStart', [points.left]);
		await touch('touchStart', [points.left, second]);
		await assertWord(0x4000);
		await touch('touchEnd', [points.left]);
		await assertWord(0);
		await touch('touchMove', [{ ...second, x: points.a.x, y: points.a.y }]);
		await assertWord(0x8000);
		await touch('touchEnd', []);
	});

	await t.test('capture transfer and pointerleave do not end the retained contact', async () => {
		await page.evaluate(() => { (globalThis as any).touchTest.pointerEvents.length = 0; });
		await touch('touchStart', [points.a]);
		await touch('touchMove', [{ ...points.a, x: points.a.x + 0.1 }]);
		await assertWord(1);
		await page.evaluate(() => {
			const probe = (globalThis as any).touchTest;
			const id = probe.pointerEvents.find((event: any) => event.type === 'pointerdown').id;
			document.getElementById('capture-other')!.setPointerCapture(id);
		});
		await touch('touchMove', [{ ...points.a, x: points.a.x + 0.2 }]);
		await assertWord(1);
		const lost = await page.evaluate(() => (globalThis as any).touchTest.pointerEvents.filter((event: any) => event.type === 'lostpointercapture'));
		assert.ok(lost.some((event: any) => event.target === 'player-surface' && event.trusted));
		await page.evaluate(() => {
			const id = (globalThis as any).touchTest.pointerEvents.find((event: any) => event.type === 'pointerdown').id;
			window.dispatchEvent(new PointerEvent('pointerleave', { pointerId: id, pointerType: 'touch' }));
			window.dispatchEvent(new MouseEvent('mouseout'));
		});
		await assertWord(1);
		await touch('touchEnd', []);
		await assertWord(0);
	});

	await t.test('native cancellation clears contacts and synthetic per-ID cancel preserves the other owner', async () => {
		await page.evaluate(() => { (globalThis as any).touchTest.pointerEvents.length = 0; });
		await touch('touchStart', [points.a]);
		await touch('touchStart', [points.a, points.b]);
		await assertWord(3);
		await page.evaluate(() => {
			const id = (globalThis as any).touchTest.pointerEvents.find((event: any) => event.type === 'pointerdown').id;
			window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, pointerType: 'touch' }));
		});
		await assertWord(2);
		await touch('touchCancel', []);
		await assertWord(0);
	});

	await t.test('canvas contacts aggregate independently of the controller and canvas hover remains pointer input', async () => {
		await touch('touchStart', [points.canvas]);
		await assertWord(0, 1);
		await touch('touchStart', [points.canvas, points.canvas2]);
		await assertWord(0, 1);
		await touch('touchStart', [points.canvas, points.canvas2, points.a]);
		await assertWord(1, 1);
		await touch('touchEnd', [points.canvas]);
		await assertWord(1, 1);
		await touch('touchEnd', [points.canvas2]);
		await assertWord(1, 0);
		await touch('touchEnd', []);
		await assertWord(0);
		await page.mouse.move(400, 100);
		const hover = await assertWord(0);
		assert.deepEqual(hover.position, [400 * 65536, 100 * 65536]);
	});

	await t.test('per-ID canvas cancellation preserves other owners and never produces a graph-drop release', async () => {
		await page.evaluate(() => { (globalThis as any).touchTest.pointerEvents.length = 0; });
		await touch('touchStart', [points.canvas]);
		await touch('touchStart', [points.canvas, points.canvas2]);
		await touch('touchStart', [points.canvas, points.canvas2, points.a]);
		const held = await assertWord(1, 1);
		await page.evaluate(() => {
			const id = (globalThis as any).touchTest.pointerEvents.filter((event: any) => event.type === 'pointerdown')[0].id;
			window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, pointerType: 'touch' }));
		});
		const firstCancelled = await assertWord(1, 1);
		assert.deepEqual(firstCancelled.pointerState, { pressed: true, justreleased: false, wasreleased: held.pointerState.wasreleased });
		assert.deepEqual(firstCancelled.position, held.position);
		await page.evaluate(() => {
			const id = (globalThis as any).touchTest.pointerEvents.filter((event: any) => event.type === 'pointerdown')[1].id;
			window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: id, pointerType: 'touch' }));
		});
		const lastCancelled = await assertWord(1, 0);
		assert.deepEqual(lastCancelled.pointerState, { pressed: false, justreleased: false, wasreleased: false });
		assert.deepEqual(lastCancelled.position, held.position);
		assert.ok(lastCancelled.edges.every((edge: any) => edge.device !== 'pointer:0'), 'cancel is not an ordinary button-up');
		await touch('touchCancel', []);
		await assertWord(0);
	});

	await t.test('native mouse chording gates a point contact while movement updates its live buttons', async () => {
		await page.mouse.move(points.a.x, points.a.y);
		await page.mouse.down({ button: 'right' });
		await assertWord(0);
		await page.mouse.down({ button: 'left' });
		await assertWord(1);
		await page.mouse.move(points.b.x, points.b.y);
		await assertWord(2);
		await page.mouse.up({ button: 'left' });
		await assertWord(0);
		await page.mouse.down({ button: 'left' });
		await assertWord(2);
		await page.mouse.up({ button: 'right' });
		await assertWord(2);
		await page.mouse.up({ button: 'left' });
		await assertWord(0);
		await page.mouse.move(points.b.x, points.b.y);
		await page.mouse.down({ button: 'left' });
		await page.mouse.down({ button: 'right' });
		await assertWord(2);
		await page.mouse.up({ button: 'left' });
		await assertWord(0);
		await page.mouse.up({ button: 'right' });
		await assertWord(0);
	});

	await t.test('native pen chording uses primary button edges, not pressure as release', async () => {
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', x: points.a.x, y: points.a.y, buttons: 0 });
		await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', x: points.a.x, y: points.a.y, button: 'right', buttons: 2, force: 0 });
		await assertWord(0);
		await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', x: points.a.x, y: points.a.y, button: 'left', buttons: 3, force: 0.5 });
		await assertWord(1);
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', pointerType: 'pen', x: points.b.x, y: points.b.y, buttons: 3, force: 0 });
		await assertWord(2);
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', x: points.b.x, y: points.b.y, button: 'left', buttons: 2, force: 0 });
		await assertWord(0);
		await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', pointerType: 'pen', x: points.b.x, y: points.b.y, button: 'left', buttons: 3, force: 0.5 });
		await assertWord(2);
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', x: points.b.x, y: points.b.y, button: 'right', buttons: 1, force: 0.5 });
		await assertWord(2);
		await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', pointerType: 'pen', x: points.b.x, y: points.b.y, button: 'left', buttons: 0, force: 0 });
		await assertWord(0);
	});

	await t.test('warm numerical contact movement performs no DOM hit tests, layout reads or unchanged presentation writes', async () => {
		await touch('touchStart', [points.a]);
		await assertWord(1);
		await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
		await page.evaluate(() => {
			const probe = (globalThis as any).touchTest;
			probe.warmReads = 0;
			probe.warmWrites = 0;
			probe.warmSpies = [
				{ target: Document.prototype, name: 'elementFromPoint' },
				{ target: Element.prototype, name: 'getBoundingClientRect' },
				{ target: SVGGraphicsElement.prototype, name: 'getScreenCTM' },
				{ target: Document.prototype, name: 'querySelector' },
				{ target: Document.prototype, name: 'querySelectorAll' },
				{ target: Element.prototype, name: 'querySelector' },
				{ target: Element.prototype, name: 'querySelectorAll' },
			];
			for (const spy of probe.warmSpies) {
				spy.original = Object.getOwnPropertyDescriptor(spy.target, spy.name);
				Object.defineProperty(spy.target, spy.name, {
					...spy.original,
					value(...args: any[]) {
						probe.warmReads += 1;
						return Reflect.apply(spy.original.value, this, args);
					},
				});
			}
			probe.warmObserver = new MutationObserver(records => { probe.warmWrites += records.length; });
			probe.warmObserver.observe(document.getElementById('button-controls'), { attributes: true, subtree: true });
			probe.warmObserver.observe(document.getElementById('d-pad-controls'), { attributes: true, subtree: true });
		});
		for (let move = 0; move < 24; move += 1) {
			await touch('touchMove', [{ ...points.a, x: points.a.x - move * 0.1, y: points.a.y - move * 0.025 }]);
		}
		const measured = await page.evaluate(() => {
			const probe = (globalThis as any).touchTest;
			probe.warmObserver.disconnect();
			for (const spy of probe.warmSpies) Object.defineProperty(spy.target, spy.name, spy.original);
			return { reads: probe.warmReads, writes: probe.warmWrites, buttons: probe.pad.buttons };
		});
		assert.deepEqual(measured, { reads: 0, writes: 0, buttons: 1 });
		await touch('touchEnd', []);
		await assertWord(0);
	});

	await t.test('focus gain and framebuffer fitting preserve contact geometry; real source lifecycle events cancel contacts', async () => {
		await touch('touchStart', [points.a]);
		await page.evaluate(() => {
			window.dispatchEvent(new Event('focus'));
			document.getElementById('outside-player')!.focus();
			(globalThis as any).touchTest.video.setDisplaySize(256, 192);
			(globalThis as any).touchTest.video.refreshLayout();
		});
		await assertWord(1);
		await touch('touchMove', [{ ...points.a, x: points.a.x + 0.1 }]);
		await assertWord(1);
		await page.evaluate(() => window.dispatchEvent(new Event('blur')));
		await assertWord(0);
		await touch('touchEnd', []);
		await page.evaluate(() => {
			(globalThis as any).touchTest.video.setDisplaySize(320, 240);
			(globalThis as any).touchTest.video.refreshLayout();
		});
		await touch('touchStart', [points.b]);
		await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
		await assertWord(0);
		await touch('touchEnd', []);
	});

	await t.test('whole-player gestures include misses without blocking outside-player touch defaults', async () => {
		await page.evaluate(() => { (globalThis as any).touchTest.nativeTouches.length = 0; });
		const scale = await page.evaluate(() => visualViewport!.scale);
		await touch('touchStart', [points.left]);
		await touch('touchStart', [points.left, points.b]);
		for (const distance of [8, 16, 8, 0]) {
			await touch('touchMove', [{ ...points.left, x: points.left.x - distance }, { ...points.b, x: points.b.x + distance }]);
			await assertWord(0x4002);
			assert.equal(await page.evaluate(() => visualViewport!.scale), scale);
		}
		await touch('touchEnd', []);
		await page.touchscreen.tap(points.miss.x, points.miss.y);
		const inside = await page.evaluate(() => (globalThis as any).touchTest.nativeTouches.splice(0));
		assert.ok(inside.length > 4);
		assert.ok(inside.every((event: any) => event.player && event.prevented && event.trusted));
		await page.touchscreen.tap(430, 30);
		const outside = await page.evaluate(() => (globalThis as any).touchTest.nativeTouches.splice(0));
		assert.deepEqual(outside.map((event: any) => [event.player, event.prevented, event.trusted]), [[false, false, true], [false, false, true]]);
		await poll();
	});

	await t.test('fast native taps publish every source edge without stretching guest samples', async () => {
		for (let tap = 0; tap < 3; tap += 1) await page.touchscreen.tap(points.b.x, points.b.y);
		const state = await assertWord(0);
		assert.deepEqual(state.edges.map((edge: any) => [edge.device, edge.code, edge.down]), [
			['gamepad:2147483646', 'b', true], ['gamepad:2147483646', 'b', false],
			['gamepad:2147483646', 'b', true], ['gamepad:2147483646', 'b', false],
			['gamepad:2147483646', 'b', true], ['gamepad:2147483646', 'b', false],
		]);
		for (let pair = 0; pair < 3; pair += 1) assert.equal(state.edges[pair * 2].pressId, state.edges[pair * 2 + 1].pressId);
		assert.equal(new Set(state.edges.filter((edge: any) => edge.down).map((edge: any) => edge.pressId)).size, 3);
	});

	await t.test('source unsubscribe cancels before disconnect, removes listeners and permits a fresh source lifetime', async () => {
		await touch('touchStart', [points.a]);
		await assertWord(1);
		await page.evaluate(() => (globalThis as any).touchTest.disposeInput());
		assert.equal(await page.evaluate(() => (globalThis as any).touchTest.pad.buttons), 0);
		await touch('touchEnd', []);
		await page.touchscreen.tap(points.b.x, points.b.y);
		assert.equal(await page.evaluate(() => (globalThis as any).touchTest.pad.buttons), 0);
		await page.evaluate(() => (globalThis as any).touchTest.subscribeInput());
		await touch('touchStart', [points.b]);
		await assertWord(2);
		await touch('touchEnd', []);
		await assertWord(0);
	});
	assert.deepEqual(errors, []);
});
