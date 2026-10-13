import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

interface TouchPoint {
	id: number;
	x: number;
	y: number;
	radiusX: number;
	radiusY: number;
}

/** Independent acceptance probes, including the outer-arc/round-contact failures
 * missed by the earlier selected center/diagonal samples. The browser is real
 * Chromium; this does not claim that CDP emulates UIKit or Safari. */
test('physical touch gamepad interactions survive adversarial native browser input', async t => {
	const template = await readFile('gamebase.html', 'utf8');
	const controls = template.slice(template.indexOf('<div id="d-pad-controls"'), template.indexOf('<div id="gameContainer">'));
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
export { INP_CTRL_ARM, IO_INP_CTRL, IO_INP_PADS, IO_INP_PAD_BUTTONS_OFFSET } from './machine/ts/spec/bmsx/io';`,
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
	await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile('gamebase.css', 'utf8')}</style><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div>`);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(() => {
		const api = (globalThis as any).fixture;
		const clock = new api.BrowserHostClock();
		const pad = new api.BrowserOnscreenGamepad(clock);
		const view = new api.BrowserOnscreenGamepadView(document, window, pad);
		const canvas = document.getElementById('gamescreen');
		const video = new api.BrowserVideoOutput(canvas, view);
		video.refreshLayout();
		const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, pad, 'F2');
		const input = new api.Input(clock, hub, pad.gamepadIndex);
		const snapshot = api.createInputControllerSnapshot();
		const memory = new api.Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, api.PSX_MACHINE_SPEC.ramBytes);
		const controller = new api.InputController(memory, input, {
			supervisorContextActive() { return false; }, requestSupervisorLineEdge() {},
		});
		controller.reset();
		const events: Array<{ type: string; width: number; height: number; trusted: boolean }> = [];
		for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
			window.addEventListener(type, event => {
				const pointer = event as PointerEvent;
				events.push({ type, width: pointer.width, height: pointer.height, trusted: pointer.isTrusted });
			}, true);
		}
		let cycle = 0;
		(globalThis as any).touchAcceptance = {
			poll() {
				input.pollInput();
				input.sampleInputControllerSnapshot(snapshot, 0);
				memory.writeMappedWord(api.IO_INP_CTRL, api.INP_CTRL_ARM);
				controller.onVblankEdge(++cycle);
				return { model: pad.buttons, common: input.getPlayerInput(1).inputHandlers.gamepad.physicalGamepadButtonsWord(),
					routed: snapshot.pads[0].buttons, mmio: memory.readIoU32(api.IO_INP_PADS + api.IO_INP_PAD_BUTTONS_OFFSET), pointer: snapshot.pointerButtons };
			},
			refreshLayout() { video.refreshLayout(); },
			takeEvents() { return events.splice(0); },
		};
	});
	const cdp = await page.context().newCDPSession(page);
	const poll = () => page.evaluate(() => (globalThis as any).touchAcceptance.poll());
	const takeEvents = () => page.evaluate(() => (globalThis as any).touchAcceptance.takeEvents());
	const measure = () => page.evaluate(() => {
		const pad = document.getElementById('d-pad-svg')!.getBoundingClientRect();
		const face = document.getElementById('action-buttons-svg')!.getBoundingClientRect();
		const actions = ['a_knop', 'b_knop', 'x_knop', 'y_knop', 'select_knop', 'start_knop', 'ls_knop', 'rs_knop'].map(id => {
			const rect = document.getElementById(id)!.getBoundingClientRect();
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: rect.width / 2 };
		});
		return { pad: { x: pad.left + pad.width / 2, y: pad.top + pad.height / 2, radius: pad.width / 2 },
			face: { x: face.left + face.width / 2, y: face.top + face.height / 2 }, actions };
	});
	const activeIds = new Set<number>();
	const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: TouchPoint[]) => {
		await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
		if (type === 'touchStart') for (const point of touchPoints) activeIds.add(point.id);
		else if (type === 'touchCancel' || type === 'touchEnd' && touchPoints.length === 0) activeIds.clear();
		else if (type === 'touchEnd') for (const point of touchPoints) activeIds.delete(point.id);
	};
	const assertWord = async (word: number, pointer = 0, message = '') => {
		// SELECT is the established host-control modifier and is intentionally
		// consumed at the common-input routing layer, not by the touch device.
		assert.deepEqual(await poll(), { model: word, common: word, routed: word & ~0x100, mmio: word & ~0x100, pointer }, message);
	};
	t.afterEach(async () => {
		if (activeIds.size !== 0) await touch('touchCancel', []);
		await assertWord(0);
		await page.setViewportSize({ width: 852, height: 393 });
		await page.evaluate(() => (globalThis as any).touchAcceptance.refreshLayout());
		await takeEvents();
	});

	await t.test('a round thumb does not fill the corners of its bounding rectangle', async () => {
		const { actions: [a, b] } = await measure();
		const onlyA = { id: 1, x: a.x + 22, y: a.y - 22, radiusX: 14, radiusY: 14 };
		assert.ok(Math.hypot(onlyA.x - b.x, onlyA.y - b.y) > b.radius + 14,
			'this circular contact physically cannot reach B');
		await touch('touchStart', [onlyA]);
		await assertWord(1);
		assert.deepEqual((await takeEvents()).map((event: any) => [event.type, event.width, event.height, event.trusted]),
			[['pointerdown', 28, 28, true]]);
		const between = { ...onlyA, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
		assert.ok(Math.hypot(between.x - a.x, between.y - a.y) < a.radius + 14);
		assert.ok(Math.hypot(between.x - b.x, between.y - b.y) < b.radius + 14);
		await touch('touchMove', [between]);
		await assertWord(3, 0, 'the same thumb reaches both adjacent buttons at their real midpoint');
		await touch('touchMove', [{ ...between, x: b.x, y: b.y }]);
		await assertWord(2);
	});

	await t.test('thin measured contact ellipses do not acquire artificial diagonal corners', async () => {
		const { actions: [a, b] } = await measure();
		for (const [dx, dy, radiusX, radiusY] of [[24, -25, 24, 4], [25, -24, 4, 24]]) {
			const contact = { id: 1, x: a.x + dx, y: a.y + dy, radiusX, radiusY };
			// The nearest boundary distance is independently evaluated by dense
			// ellipse sampling, not by the production collision implementation.
			let closest = Infinity;
			for (let angle = 0; angle < 3600; angle += 1) {
				const radians = angle * Math.PI / 1800;
				closest = Math.min(closest, Math.hypot(contact.x + radiusX * Math.cos(radians) - b.x,
					contact.y + radiusY * Math.sin(radians) - b.y));
			}
			assert.ok(closest > b.radius + 1, 'the ellipse misses B by more than sampling uncertainty');
			await touch('touchStart', [contact]);
			await assertWord(1);
			await touch('touchMove', [{ ...contact, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }]);
			await assertWord(3, 0, 'a real elongated contact can still press an adjacent pair');
			await touch('touchEnd', []);
			await assertWord(0);
		}
	});

	await t.test('a neutral face-bank touch can roll onto A without lifting or becoming canvas input', async () => {
		const { face, actions: [a] } = await measure();
		const contact = { id: 1, ...face, radiusX: 14, radiusY: 14 };
		await touch('touchStart', [contact]);
		await assertWord(0);
		await touch('touchMove', [{ ...contact, x: a.x, y: a.y }]);
		await assertWord(1);
	});

	await t.test('skin-only pickup reaches an action without making canvas contacts migrate into the deck', async () => {
		const { actions: [a] } = await measure();
		const outsideCenter = { id: 1, x: a.x, y: a.y + a.radius + 10, radiusX: 14, radiusY: 14 };
		await touch('touchStart', [outsideCenter]);
		await assertWord(1, 0, 'the skin estimate reaches A although its center is outside the whole deck');
		await touch('touchEnd', []);
		const canvasCenter = await page.evaluate(() => {
			const rect = document.getElementById('gamescreen')!.getBoundingClientRect();
			return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
		});
		const canvasContact = { id: 2, ...canvasCenter, radiusX: 14, radiusY: 14 };
		await touch('touchStart', [canvasContact]);
		await assertWord(0, 1);
		await touch('touchMove', [{ ...canvasContact, x: a.x, y: a.y }]);
		await assertWord(0, 1, 'an already captured canvas pointer stays canvas-owned when crossing the controls');
	});

	await t.test('a large centered thumb leaves the mechanical D-pad neutral', async () => {
		const { pad } = await measure();
		await touch('touchStart', [{ id: 1, x: pad.x, y: pad.y, radiusX: 30, radiusY: 30 }]);
		await assertWord(0);
	});

	await t.test('the entire outer D-pad roll has no gaps, opposites, or utility-button spill', async () => {
		for (const viewport of [{ width: 852, height: 393 }, { width: 393, height: 852 }, { width: 1366, height: 1024 }, { width: 1024, height: 1366 }]) {
			await page.setViewportSize(viewport);
			await page.evaluate(() => (globalThis as any).touchAcceptance.refreshLayout());
			const { pad } = await measure();
			for (const [radiusX, radiusY] of [[1, 1], [14, 14], [24, 4], [30, 30]]) {
				for (let degrees = 0; degrees <= 360; degrees += 10) {
					const angle = degrees * Math.PI / 180;
					const contact = { id: 1, x: pad.x + pad.radius * 0.8 * Math.cos(angle),
						y: pad.y - pad.radius * 0.8 * Math.sin(angle), radiusX, radiusY };
					await touch(degrees === 0 ? 'touchStart' : 'touchMove', [contact]);
					const state = await poll();
					const location = `${viewport.width}x${viewport.height}, ${degrees}deg, ${radiusX}x${radiusY} contact radii`;
					assert.equal(state.model & ~0xf000, 0, `no adjacent utility spill at ${location}`);
					assert.notEqual(state.model, 0, `no dead gap at ${location}`);
					assert.notEqual(state.model & 0x3000, 0x3000, `no one-thumb Up+Down at ${location}`);
					assert.notEqual(state.model & 0xc000, 0xc000, `no one-thumb Left+Right at ${location}`);
					assert.equal(state.common, state.model);
					assert.equal(state.routed, state.model);
					assert.equal(state.mmio, state.model);
					assert.equal(state.pointer, 0);
				}
				await touch('touchEnd', []);
				await assertWord(0);
			}
			const directions = [[1, 0, 0x8000], [1, -1, 0x9000], [0, -1, 0x1000], [-1, -1, 0x5000],
				[-1, 0, 0x4000], [-1, 1, 0x6000], [0, 1, 0x2000], [1, 1, 0xa000]];
			for (const [dx, dy, word] of directions) {
				const length = Math.hypot(dx, dy);
				await touch('touchStart', [{ id: 1, x: pad.x + dx / length * pad.radius * 0.8,
					y: pad.y + dy / length * pad.radius * 0.8, radiusX: 1, radiusY: 1 }]);
				await assertWord(word);
				await touch('touchEnd', []);
			}
		}
	});

	await t.test('small-player cardinal directions ignore microscopic axis jitter and thumb width', async () => {
		await page.setViewportSize({ width: 360, height: 210 });
		await page.evaluate(() => (globalThis as any).touchAcceptance.refreshLayout());
		const { pad } = await measure();
		for (const [dx, dy, word] of [[1, 0, 0x8000], [0, -1, 0x1000], [-1, 0, 0x4000], [0, 1, 0x2000]]) {
			for (const jitter of [-0.1, -0.01, 0, 0.01, 0.1]) {
				const contact = { id: 1, x: pad.x + dx * pad.radius * 0.55 + (dy === 0 ? 0 : jitter),
					y: pad.y + dy * pad.radius * 0.55 + (dx === 0 ? 0 : jitter), radiusX: 14, radiusY: 14 };
				await touch('touchStart', [contact]);
				await assertWord(word, 0, `cardinal ${dx},${dy} with ${jitter}px perpendicular jitter`);
				await touch('touchEnd', []);
			}
		}
	});

	await t.test('a thumb on the outer right pad edge cannot also press SELECT', async () => {
		const { pad } = await measure();
		await touch('touchStart', [{ id: 1, x: pad.x + pad.radius * 0.995, y: pad.y + 10, radiusX: 14, radiusY: 14 }]);
		await assertWord(0x8000);
	});

	await t.test('held contacts belong to a mechanical component, not whichever other control they cross', async () => {
		const { pad, actions: [a, , , , select] } = await measure();
		const padContact = { id: 1, x: pad.x + pad.radius * 0.8, y: pad.y, radiusX: 14, radiusY: 14 };
		await touch('touchStart', [padContact]);
		await assertWord(0x8000);
		await touch('touchMove', [{ ...padContact, x: select.x, y: select.y }]);
		await assertWord(0x8000, 0, 'the captured pad continues outside its disc without pressing SELECT');
		await touch('touchEnd', []);
		const faceContact = { id: 2, x: a.x, y: a.y, radiusX: 14, radiusY: 14 };
		await touch('touchStart', [faceContact]);
		await assertWord(1);
		await touch('touchMove', [{ ...faceContact, x: select.x, y: select.y }]);
		await assertWord(0, 0, 'leaving the face deck cannot migrate the thumb into a utility button');
		await touch('touchEnd', []);
	});

	await t.test('a direct utility press wins over a large thumb reaching the nearby pad', async () => {
		const { pad, actions: [, , , , select] } = await measure();
		const contact = { id: 1, x: select.x, y: select.y, radiusX: 40, radiusY: 40 };
		assert.ok(Math.hypot(select.x - pad.x, select.y - pad.y) < pad.radius + 40,
			'the measured skin area also reaches the pad');
		await touch('touchStart', [contact]);
		await assertWord(0x100, 0, 'only SELECT is pressed, even though the thumb area also touches the pad');
		await touch('touchMove', [{ ...contact, x: pad.x - pad.radius * 0.8, y: pad.y }]);
		await assertWord(0, 0, 'the retained utility contact does not become a directional contact');
	});

	await t.test('visible utility-button centers and inner edges beat another component\'s neutral deck', async () => {
		const { pad, face, actions } = await measure();
		for (const [index, word] of [[4, 0x100], [5, 0x200], [6, 0x400], [7, 0x800]]) {
			const utility = actions[index];
			const primary = index === 4 || index === 6 ? pad : face;
			const dx = primary.x - utility.x;
			const dy = primary.y - utility.y;
			const length = Math.hypot(dx, dy);
			for (const offset of [0, 22]) {
				const point = { id: 1, x: utility.x + dx / length * offset,
					y: utility.y + dy / length * offset, radiusX: 1, radiusY: 1 };
				assert.ok(Math.hypot(point.x - utility.x, point.y - utility.y) < utility.radius,
					'the point is inside the actual visible utility button');
				for (const button of actions.slice(0, 4)) {
					assert.ok(Math.hypot(point.x - button.x, point.y - button.y) > button.radius,
						'the expected utility point does not hit an actual face button');
				}
				await touch('touchStart', [point]);
				await assertWord(word, 0, `visible utility bit ${word.toString(16)}, ${offset}px toward its primary controls`);
				await touch('touchEnd', []);
			}
		}
	});

	await t.test('a native pen remains a point when sliding across the face deck gap', async () => {
		const { actions: [a, b] } = await measure();
		await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y,
			button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen' });
		try {
			await assertWord(1);
			await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2,
				button: 'left', buttons: 1, pointerType: 'pen' });
			await assertWord(0, 0, 'a point does not acquire the touch thumb estimate');
			await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y,
				button: 'left', buttons: 1, pointerType: 'pen' });
			await assertWord(2);
		} finally {
			await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y,
				button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen' });
		}
		await assertWord(0);
	});

	await t.test('independent fingers retain each button until its final contributing contact ends', async () => {
		const { actions: [a, b] } = await measure();
		const midpoint = { id: 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, radiusX: 14, radiusY: 14 };
		const aOnly = { id: 2, x: a.x, y: a.y, radiusX: 1, radiusY: 1 };
		for (const releaseBothFirst of [false, true]) {
			await touch('touchStart', [midpoint]);
			await assertWord(3);
			await touch('touchStart', [midpoint, aOnly]);
			await assertWord(3);
			await touch('touchEnd', [releaseBothFirst ? midpoint : aOnly]);
			await assertWord(releaseBothFirst ? 1 : 3);
			await touch('touchEnd', []);
			await assertWord(0);
		}
	});

	await t.test('the raw word keeps opposing directions from independent fingers without visual normalization', async () => {
		const { pad, actions } = await measure();
		const contacts: TouchPoint[] = [];
		for (const [index, [dx, dy]] of [[0, -1], [0, 1], [-1, 0], [1, 0]].entries()) {
			contacts.push({ id: index + 1, x: pad.x + dx * pad.radius * 0.8, y: pad.y + dy * pad.radius * 0.8, radiusX: 1, radiusY: 1 });
		}
		await touch('touchStart', contacts);
		await assertWord(0xf000);
		for (const [index, action] of actions.entries()) {
			contacts.push({ id: index + 5, x: action.x, y: action.y, radiusX: 1, radiusY: 1 });
			await touch('touchStart', contacts);
		}
		await assertWord(0xff0f);
		for (const contact of contacts.slice().reverse()) await touch('touchEnd', [contact]);
		await assertWord(0);
	});

	await t.test('browser layout changes cannot manufacture input edges before a new native pointer sample', async () => {
		const { actions: [a] } = await measure();
		const contact = { id: 1, x: a.x, y: a.y - 8, radiusX: 14, radiusY: 14 };
		await touch('touchStart', [contact]);
		await assertWord(1);
		await takeEvents();
		await page.setViewportSize({ width: 852, height: 320 });
		await page.evaluate(() => (globalThis as any).touchAcceptance.refreshLayout());
		assert.deepEqual(await takeEvents(), [], 'layout itself does not produce a native release event');
		await assertWord(1, 0, 'a visual-viewport update must not silently manufacture a release');
		await touch('touchMove', [{ ...contact, x: contact.x + 0.25 }]);
		await assertWord(0, 0, 'the next native sample applies the visibly admitted new layout');
		await touch('touchEnd', []);
		await assertWord(0);
	});

	assert.deepEqual(errors, []);
});
