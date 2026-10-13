import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import { distanceToControl } from './touch_gamepad_geometry_oracle';

const BUTTONS = [
	{ id: 'a_knop', bit: InputControllerGamepadButtonBit.A },
	{ id: 'b_knop', bit: InputControllerGamepadButtonBit.B },
	{ id: 'x_knop', bit: InputControllerGamepadButtonBit.X },
	{ id: 'y_knop', bit: InputControllerGamepadButtonBit.Y },
	{ id: 'lb_knop', bit: InputControllerGamepadButtonBit.LeftBumper },
	{ id: 'rb_knop', bit: InputControllerGamepadButtonBit.RightBumper },
	{ id: 'lt_knop', bit: InputControllerGamepadButtonBit.LeftTrigger },
	{ id: 'rt_knop', bit: InputControllerGamepadButtonBit.RightTrigger },
	{ id: 'select_knop', bit: InputControllerGamepadButtonBit.Select },
	{ id: 'start_knop', bit: InputControllerGamepadButtonBit.Start },
	{ id: 'ls_knop', bit: InputControllerGamepadButtonBit.LeftStick },
	{ id: 'rs_knop', bit: InputControllerGamepadButtonBit.RightStick },
] as const;

test('native touchscreen shoulders reach the existing gamepad ABI and host shortcut owners', async t => {
	const template = await readFile('gamebase.html', 'utf8');
	const controls = template.slice(template.indexOf('<div id="controller-viewport"'), template.indexOf('<div id="gameContainer">'));
	const css = await readFile('gamebase.css', 'utf8');
	const bundle = await build({
		stdin: {
			contents: `export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';
export { HOST_IDE_BUTTON } from './hosts/common/input/shortcuts';
export { HostOverlayMenu, HostMenuInput, HostMenuExecution } from './hosts/common/host_overlay_menu';
export { HostExecutionControl } from './hosts/common/execution_control';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';
export { Memory } from './machine/ts/machine/memory/memory';
export { InputController } from './machine/ts/machine/devices/input/controller';
export { PSX_MACHINE_SPEC } from './machine/ts/spec/bmsx/model';
export { INP_CTRL_ARM, IO_INP_CTRL, IO_INP_PADS, IO_INP_PAD_BUTTONS_OFFSET, IO_INP_PAD_LT_OFFSET, IO_INP_PAD_RT_OFFSET } from './machine/ts/spec/bmsx/io';`,
			resolveDir: process.cwd(),
		},
		bundle: true, platform: 'browser', format: 'iife', globalName: 'fixture', write: false,
		tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	for (const profile of [
		{ name: 'phone portrait', width: 393, height: 720 },
		{ name: 'phone landscape', width: 852, height: 393 },
	]) {
		await t.test(profile.name, async orientation => {
			const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, isMobile: true, hasTouch: true });
			orientation.after(() => page.close());
			const errors: string[] = [];
			page.on('pageerror', error => errors.push(error.message));
			await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div>`);
			await page.addScriptTag({ content: bundle.outputFiles[0].text });
			await page.evaluate(ids => {
				const api = (globalThis as any).fixture;
				const clock = new api.BrowserHostClock();
				const pad = new api.BrowserOnscreenGamepad(clock);
				const view = new api.BrowserOnscreenGamepadView(document, window, pad);
				const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
				const video = new api.BrowserVideoOutput(canvas, view, 'fit');
				video.refreshLayout();
				const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, pad, 'F2');
				const input = new api.Input(clock, hub, pad.gamepadIndex);
				const snapshot = api.createInputControllerSnapshot();
				const memory = new api.Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, api.PSX_MACHINE_SPEC.ramBytes);
				let supervisorEdges = 0;
				const controller = new api.InputController(memory, input, {
					supervisorContextActive() { return false; },
					requestSupervisorLineEdge() { supervisorEdges += 1; },
				});
				controller.reset();
				const execution = new api.HostExecutionControl({ mutePause() {} });
				const menu = new api.HostOverlayMenu({}, {}, input, {}, execution);
				let ideRequests = 0;
				let ideReleases = 0;
				// This proves the actual shortcut registry route, not a rendered Studio UI.
				input.getGlobalShortcutRegistry().registerControlShortcut(1, api.HOST_IDE_BUTTON,
					() => { ideRequests += 1; }, () => { ideReleases += 1; });
				const nativeEvents: Array<{ type: string; trusted: boolean; pointerType: string }> = [];
				for (const type of ['pointerdown', 'pointerup', 'pointercancel']) {
					window.addEventListener(type, event => {
						const pointer = event as PointerEvent;
						nativeEvents.push({ type, trusted: event.isTrusted, pointerType: pointer.pointerType });
					}, true);
				}
				let cycle = 0;
				(globalThis as any).shoulderTest = {
					menu,
					geometry() {
						return pad.geometry.actions.map(action => ({ x: action.x, y: action.y, radius: action.radius, buttons: action.buttons,
							outline: action.outline ? { ...action.outline } : undefined }));
					},
					poll() {
						input.pollInput();
						const menuInput = menu.tickInput();
						input.sampleInputControllerSnapshot(snapshot, 0);
						memory.writeMappedWord(api.IO_INP_CTRL, api.INP_CTRL_ARM);
						controller.onVblankEdge(++cycle);
						const common = input.getPlayerInput(1).inputHandlers.gamepad;
						return {
							model: pad.buttons, physical: common.physicalGamepadButtonsWord(), snapshot: snapshot.pads[0].buttons,
							axes: Array.from(snapshot.pads[0].axesQ16).slice(4),
							mmio: memory.readIoU32(api.IO_INP_PADS + api.IO_INP_PAD_BUTTONS_OFFSET),
							mmioAxes: [memory.readIoU32(api.IO_INP_PADS + api.IO_INP_PAD_LT_OFFSET), memory.readIoU32(api.IO_INP_PADS + api.IO_INP_PAD_RT_OFFSET)],
							pointer: snapshot.pointerButtons, supervisor: input.supervisorRequestLineHigh(), supervisorEdges,
							menuInput, menuExecution: menu.executionMode, ideRequests, ideReleases,
							visuals: ids.map(id => document.getElementById(id)!.getAttribute('data-touched')),
						};
					},
					finish() { video.dispose(); view.dispose(); input.dispose(); },
					nativeEvents,
				};
			}, BUTTONS.map(button => button.id));
			await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
			const points = await page.evaluate(bits => bits.map((bit, index) => {
				const shape = (globalThis as any).shoulderTest.geometry().find(action => action.buttons === 1 << bit);
				return { id: index + 1, x: shape.x, y: shape.y, radiusX: 14, radiusY: 14 };
			}), BUTTONS.map(button => button.bit));
			const cdp = await page.context().newCDPSession(page);
			let nativeContactCount = 0;
			const touch = async (type: 'touchStart' | 'touchEnd', touchPoints: typeof points) => {
				await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
				nativeContactCount = type === 'touchStart' ? touchPoints.length
					: touchPoints.length === 0 ? 0 : nativeContactCount - touchPoints.length;
			};
			const poll = () => page.evaluate(() => (globalThis as any).shoulderTest.poll());
			const point = (id: string) => points[BUTTONS.findIndex(button => button.id === id)];
			orientation.afterEach(async () => {
				if (nativeContactCount !== 0) await touch('touchEnd', []);
				await page.evaluate(() => (globalThis as any).shoulderTest.menu.dismiss());
				const state = await poll();
				assert.equal(state.model, 0, 'ending all native contacts clears the model');
				assert.equal(state.physical, 0, 'ending all native contacts clears the physical common word');
			});

			for (let index = 0; index < BUTTONS.length; index += 1) {
				const button = BUTTONS[index];
				await orientation.test(`${button.id} presses its own raw bit without substituting another control`, async () => {
					await touch('touchStart', [points[index]]);
					await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
					const state = await poll();
					const word = 1 << button.bit;
					assert.equal(state.model, word);
					assert.equal(state.physical, word);
					const routed = button.bit === InputControllerGamepadButtonBit.Select ? 0 : word;
					assert.equal(state.snapshot, routed, 'Select is the existing reserved host modifier; other controls reach the guest');
					assert.equal(state.mmio, routed);
					const axes = [button.bit === InputControllerGamepadButtonBit.LeftTrigger ? 0x10000 : 0,
						button.bit === InputControllerGamepadButtonBit.RightTrigger ? 0x10000 : 0];
					assert.deepEqual(state.axes, axes);
					assert.deepEqual(state.mmioAxes, axes);
					assert.deepEqual(state.visuals, BUTTONS.map((_, other) => other === index ? 'true' : 'false'));
					assert.equal(state.pointer, 0);
					assert.equal(state.supervisor, false);
					assert.equal(state.menuInput, 0);
				});
			}

			await orientation.test('one retained finger follows the real curved shoulder centerlines without a release', async () => {
				const shapes = await page.evaluate(() => (globalThis as any).shoulderTest.geometry());
				for (const id of ['lb_knop', 'rb_knop', 'lt_knop', 'rt_knop']) {
					const button = BUTTONS.find(button => button.id === id)!;
					const shape = shapes.find(shape => shape.buttons === 1 << button.bit);
					const arc = shape.outline;
					const start = Math.atan2(arc.startY, arc.startX);
					const sweep = (Math.atan2(arc.endY, arc.endX) - start + Math.PI * 2) % (Math.PI * 2);
					await touch('touchStart', [point(id)]);
					for (let step = 0; step <= 12; step += 1) {
						const angle = start + sweep * step / 12;
						const contact = { ...point(id), x: shape.x + arc.centerX + arc.radius * Math.cos(angle),
							y: shape.y + arc.centerY + arc.radius * Math.sin(angle) };
						await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [contact] });
						const state = await poll();
						assert.equal(state.model, shape.buttons, `${id} follows the bent band through its finite end caps`);
						assert.equal(state.physical, shape.buttons);
						assert.equal(state.snapshot, shape.buttons);
						assert.equal(state.mmio, shape.buttons);
					}
					await touch('touchEnd', []);
					assert.equal((await poll()).model, 0);
				}
			});

			await orientation.test('curved shoulder bands are not their broad-phase circumbound circles', async () => {
				const shapes = await page.evaluate(() => (globalThis as any).shoulderTest.geometry());
				for (const id of ['lb_knop', 'rb_knop', 'lt_knop', 'rt_knop']) {
					const button = BUTTONS.find(button => button.id === id)!;
					const shape = shapes.find(shape => shape.buttons === 1 << button.bit);
					assert.ok(shape.outline, `${id} owns an actual rounded outline`);
					let outside: { x: number; y: number } | undefined;
					for (let degrees = 0; degrees < 360 && outside === undefined; degrees += 10) {
						const angle = degrees * Math.PI / 180;
						const candidate = { x: shape.x + shape.radius * 0.8 * Math.cos(angle), y: shape.y + shape.radius * 0.8 * Math.sin(angle) };
						if (shapes.every(other => distanceToControl(other, candidate.x, candidate.y) > 3)) outside = candidate;
					}
					assert.ok(outside, `${id} exposes empty space inside its intentionally loose broad bound`);
					await touch('touchStart', [point(id)]);
					assert.equal((await poll()).model, shape.buttons);
					await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point(id), ...outside, radiusX: 1, radiusY: 1 }] });
					const empty = await poll();
					assert.equal(empty.model, 0, `${id} releases as the retained contact leaves its actual arched outline`);
					assert.equal(empty.physical, 0);
					assert.equal(empty.snapshot, 0);
					assert.equal(empty.mmio, 0);
					await touch('touchEnd', []);
				}
			});

			await orientation.test('one thumb bridges each shoulder pair without merging their independent raw bits', async () => {
				const shapes = await page.evaluate(() => (globalThis as any).shoulderTest.geometry());
				for (const [firstId, secondId, word] of [['lb_knop', 'lt_knop', 0x50], ['rb_knop', 'rt_knop', 0xa0]] as const) {
					const first = shapes.find(shape => shape.buttons === 1 << BUTTONS.find(button => button.id === firstId)!.bit);
					const second = shapes.find(shape => shape.buttons === 1 << BUTTONS.find(button => button.id === secondId)!.bit);
					let bridge: { x: number; y: number } | undefined;
					for (let row = -28; row <= 28 && bridge === undefined; row += 2) {
						for (let column = -28; column <= 28; column += 2) {
							const candidate = { x: (first.x + second.x) / 2 + column, y: (first.y + second.y) / 2 + row };
							const touched = shapes.reduce((mask, shape) => distanceToControl(shape, candidate.x, candidate.y) < 14 ? mask | shape.buttons : mask, 0);
							if (touched === word) { bridge = candidate; break; }
						}
					}
					assert.ok(bridge, `${firstId}/${secondId} have a reachable true-contact chord, not overlapping target rectangles`);
					await touch('touchStart', [{ ...point(firstId), ...bridge }]);
					const paired = await poll();
					assert.equal(paired.model, word);
					assert.equal(paired.physical, word);
					assert.equal(paired.snapshot, word);
					assert.equal(paired.mmio, word);
					assert.deepEqual(paired.axes, firstId === 'lb_knop' ? [0x10000, 0] : [0, 0x10000]);
					await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...point(secondId), id: point(firstId).id }] });
					assert.equal((await poll()).model, second.buttons, 'rolling across the pair releases only the bumper');
					await touch('touchEnd', []);
				}
			});

			await orientation.test('LT and RT retain independent full-travel axes and ICU bits in either release order', async () => {
				for (const released of ['lt_knop', 'rt_knop']) {
					await touch('touchStart', [point('lt_knop')]);
					assert.deepEqual((await poll()).axes, [0x10000, 0]);
					await touch('touchStart', [point('lt_knop'), point('rt_knop')]);
					const both = await poll();
					assert.equal(both.model, 0xc0);
					assert.equal(both.physical, 0xc0);
					assert.equal(both.snapshot, 0xc0);
					assert.equal(both.mmio, 0xc0);
					assert.deepEqual(both.axes, [0x10000, 0x10000]);
					assert.deepEqual(both.mmioAxes, [0x10000, 0x10000]);
					await touch('touchEnd', [point(released)]);
					const remaining = await poll();
					const word = released === 'lt_knop' ? 0x80 : 0x40;
					const axes = released === 'lt_knop' ? [0, 0x10000] : [0x10000, 0];
					assert.equal(remaining.model, word);
					assert.equal(remaining.physical, word);
					assert.equal(remaining.snapshot, word);
					assert.equal(remaining.mmio, word);
					assert.deepEqual(remaining.axes, axes);
					assert.deepEqual(remaining.mmioAxes, axes);
					await touch('touchEnd', []);
					assert.deepEqual((await poll()).mmioAxes, [0, 0]);
				}
			});

			await orientation.test('SELECT plus START opens and closes the real host-menu owner without leaking the chord', async () => {
				const contacts = [point('select_knop'), point('start_knop')];
				await touch('touchStart', contacts);
				const opened = await poll();
				assert.equal(opened.model, 0x300);
				assert.equal(opened.physical, 0x300);
				assert.equal(opened.menuInput, 1);
				assert.equal(opened.menuExecution, 1);
				assert.equal(opened.snapshot, 0);
				assert.equal(opened.mmio, 0);
				await touch('touchEnd', []);
				assert.equal((await poll()).menuInput, 1, 'lifting the opening chord does not close the menu');
				await touch('touchStart', contacts);
				const closed = await poll();
				assert.equal(closed.menuInput, 0);
				assert.equal(closed.menuExecution, 0);
				assert.equal(closed.snapshot, 0);
			});

			await orientation.test('SELECT plus LB drives the existing supervisor line and one ICU edge per physical chord', async () => {
				const before = await poll();
				await touch('touchStart', [point('select_knop')]);
				assert.equal((await poll()).supervisor, false);
				await touch('touchStart', [point('select_knop'), point('lb_knop')]);
				const held = await poll();
				assert.equal(held.model, 0x110);
				assert.equal(held.physical, 0x110);
				assert.equal(held.supervisor, true);
				assert.equal(held.supervisorEdges, before.supervisorEdges + 1);
				assert.equal(held.snapshot, 0);
				assert.equal(held.mmio, 0);
				assert.equal((await poll()).supervisorEdges, held.supervisorEdges, 'held polling does not retrigger the supervisor edge');
				await touch('touchEnd', [point('lb_knop')]);
				assert.equal((await poll()).supervisor, false);
			});

			await orientation.test('SELECT plus RB reaches the canonical Studio shortcut registry route independently of stick clicks', async () => {
				const before = await poll();
				await touch('touchStart', [point('select_knop'), point('rs_knop')]);
				assert.equal((await poll()).ideRequests, before.ideRequests, 'RS is not RB');
				await touch('touchEnd', [point('rs_knop')]);
				await poll();
				await touch('touchStart', [point('select_knop'), point('rb_knop')]);
				const held = await poll();
				assert.equal(held.model, 0x120);
				assert.equal(held.physical, 0x120);
				assert.equal(held.ideRequests, before.ideRequests + 1);
				assert.equal(held.snapshot, 0);
				assert.equal(held.mmio, 0);
				assert.equal((await poll()).ideRequests, held.ideRequests, 'held polling does not repeat the Studio toggle');
				await touch('touchEnd', [point('rb_knop')]);
				const released = await poll();
				assert.equal(released.ideReleases, before.ideReleases + 1);
				assert.equal(released.model, 0x100);
			});

			const nativeEvents = await page.evaluate(() => (globalThis as any).shoulderTest.nativeEvents);
			assert.ok(nativeEvents.length > 0);
			assert.ok(nativeEvents.every(event => event.trusted && event.pointerType === 'touch'), 'input originates in Chromium native dispatch, not synthetic DOM events');
			assert.deepEqual(errors, []);
			await page.evaluate(() => (globalThis as any).shoulderTest.finish());
		});
	}
});
