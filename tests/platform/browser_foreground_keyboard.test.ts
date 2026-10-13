import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';

const SELECT = 1 << 8;
const LB = 1 << 4;
const CONTROLLER_BUTTONS = { a_knop: InputControllerGamepadButtonBit.A, b_knop: InputControllerGamepadButtonBit.B, x_knop: InputControllerGamepadButtonBit.X, y_knop: InputControllerGamepadButtonBit.Y, ls_knop: InputControllerGamepadButtonBit.LeftStick, rs_knop: InputControllerGamepadButtonBit.RightStick, select_knop: InputControllerGamepadButtonBit.Select, start_knop: InputControllerGamepadButtonBit.Start, lb_knop: InputControllerGamepadButtonBit.LeftBumper, rb_knop: InputControllerGamepadButtonBit.RightBumper, lt_knop: InputControllerGamepadButtonBit.LeftTrigger, rt_knop: InputControllerGamepadButtonBit.RightTrigger };
const KEYBOARD_COMMANDS = { a_knop: 'KeyW', b_knop: 'Space', x_knop: 'Backspace', start_knop: 'Enter', lb_knop: 'ArrowLeft', rb_knop: 'ArrowRight', lt_knop: 'Home', rt_knop: 'End' };

test('foreground keyboard acquires overlapping contacts before the touch gamepad without changing existing leases', async t => {
	const template = await readFile('gamebase.html', 'utf8');
	const controls = template.slice(template.indexOf('<div id="controller-viewport"'), template.indexOf('<div id="gameContainer">'));
	const css = await readFile('gamebase.css', 'utf8');
	const bundle = await build({
		stdin: { contents: `
export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';
export { HostOverlayMenu } from './hosts/common/host_overlay_menu';
export { HostExecutionControl } from './hosts/common/execution_control';
export { VideoPresenter } from './machine/ts/render/video_presenter';
export { HeadlessGPUBackend } from './machine/ts/render/headless/backend';
export { Font } from './machine/ts/render/shared/bmsx_font';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';
export { Memory } from './machine/ts/machine/memory/memory';
export { InputController } from './machine/ts/machine/devices/input/controller';
export { PSX_MACHINE_SPEC } from './machine/ts/spec/bmsx/model';
export { IO_INP_CTRL, INP_CTRL_ARM, IO_INP_PADS, IO_INP_PAD_BUTTONS_OFFSET, IO_INP_KEYS } from './machine/ts/spec/bmsx/io';
export { hidKeyUsageForCode } from './hosts/common/input/hid_keys';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', target: 'es2022', format: 'iife', globalName: 'fixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	for (const profile of [
		{ name: 'phone landscape', width: 852, height: 393 },
		{ name: 'phone portrait', width: 393, height: 852 },
		{ name: 'tablet landscape', width: 1024, height: 768 },
	]) {
		await t.test(profile.name, async orientation => {
			const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, isMobile: true, hasTouch: true });
			orientation.after(() => page.close());
			const errors: string[] = [];
			page.on('pageerror', error => errors.push(error.message));
			await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="game-started"><div id="player-surface">${controls}<canvas id="gamescreen" width="256" height="212" style="display:block"></canvas></div></body>`);
			await page.addScriptTag({ content: bundle.outputFiles[0].text });
			assert.deepEqual(errors, []);
			await page.evaluate(() => {
				const api = (globalThis as any).fixture;
				const clock = new api.BrowserHostClock();
				const pad = new api.BrowserOnscreenGamepad(clock);
				const view = new api.BrowserOnscreenGamepadView(document, window, pad);
				const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
				const video = new api.BrowserVideoOutput(canvas, view);
				video.refreshLayout();
				const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, pad, 'F2');
				const input = new api.Input(clock, hub, pad.gamepadIndex);
				const backend = new api.HeadlessGPUBackend(256, 212, api.PSX_MACHINE_SPEC.gxGpuVramBytes);
				const presenter = new api.VideoPresenter(video, backend, 256, 212);
				presenter.default_font = new api.Font();
				const menu = new api.HostOverlayMenu(presenter, {}, input, {}, new api.HostExecutionControl({ mutePause() {} }));
				menu.setKeyboardVisibilityListener(view.setKeyboardVisible);
				let admissionCalls = 0;
				hub.setForegroundPointerCapture((x: number, y: number) => { admissionCalls += 1; return menu.capturesPointer(x, y); });
				const snapshot = api.createInputControllerSnapshot();
				const memory = new api.Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, api.PSX_MACHINE_SPEC.ramBytes);
				const controller = new api.InputController(memory, input, { supervisorContextActive() { return false; }, requestSupervisorLineEdge() {} });
				controller.reset();
				const native: Array<{ type: string; id: number; trusted: boolean }> = [];
				for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(type, event => {
					const pointer = event as PointerEvent;
					native.push({ type, id: pointer.pointerId, trusted: pointer.isTrusted });
				}, { capture: true, passive: true });
				const display = {
					client(x: number, y: number) { const rect = canvas.getBoundingClientRect(); return { x: rect.left + x * rect.width / 256, y: rect.top + y * rect.height / 212 }; },
					center(id: string) { const r = document.getElementById(id)!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
				};
				let cycle = 0;
				(globalThis as any).keyboardTouch = {
					menu, native,
					poll() {
						input.pollInput();
						menu.tickInput();
						menu.queueFrameOverlayCommands(60);
						input.sampleInputControllerSnapshot(snapshot, 0);
						memory.writeMappedWord(api.IO_INP_CTRL, api.INP_CTRL_ARM);
						controller.onVblankEdge(++cycle);
						const keys = {
							pressed(code: string) { const usage = api.hidKeyUsageForCode(code); return (snapshot.keyWords[usage >>> 5] & (1 << (usage & 31))) !== 0; },
							mmio(code: string) { const usage = api.hidKeyUsageForCode(code); return (memory.readIoU32(api.IO_INP_KEYS + (usage >>> 5) * 4) & (1 << (usage & 31))) !== 0; },
						};
						return { model: pad.buttons, sampledPad: snapshot.pads[0].buttons, padMmio: memory.readIoU32(api.IO_INP_PADS + api.IO_INP_PAD_BUTTONS_OFFSET), controllerLeases: pad.contactCount, physical: input.getPlayerInput(1).inputHandlers.gamepad.physicalGamepadButtonsWord(),
							pointerHeld: input.getPlayerInput(1).inputHandlers.pointer.getButtonState('pointer_primary').pressed,
							q: keys.pressed('KeyQ'), w: keys.pressed('KeyW'), qMmio: keys.mmio('KeyQ'), wMmio: keys.mmio('KeyW'), admissionCalls };
					},
					keyPressed(code: string) { const usage = api.hidKeyUsageForCode(code); return (snapshot.keyWords[usage >>> 5] & (1 << (usage & 31))) !== 0; },
					centers() { return { select: { id: 1, ...display.center('select_knop') }, x: { id: 2, ...display.center('x_knop') } }; },
					positions() {
						const keyboard = menu.keyboard;
						const panel = keyboard.panelRect.area;
						const keys = { point(label: string) { const index = keyboard.keyGlyphs.findIndex((glyph: any) => glyph.items === label); const area = keyboard.keyRects[index].area; return display.client(area.left + 2, area.top + 2); } };
						const lb = pad.geometry.actions.find((action: any) => action.buttons === (1 << 4));
						const outsideLb = { x: lb.x + lb.outline.centerX + lb.outline.radius * lb.outline.startX, y: lb.y + lb.outline.centerY + lb.outline.radius * lb.outline.startY };
						return { controllerButtons: ['a_knop', 'b_knop', 'x_knop', 'y_knop', 'ls_knop', 'rs_knop', 'select_knop', 'start_knop', 'lb_knop', 'rb_knop', 'lt_knop', 'rt_knop'].map(id => ({ id, ...display.center(id + '_text') })), select: display.center('select_knop'), x: display.center('x_knop'), q: keys.point('q'), w: keys.point('w'), outsideLb,
							nonInteractive: display.client(panel.left + 1, panel.top + 1), panelOutside: display.client(panel.left - 1, panel.top + 1), padRight: { x: pad.geometry.padX + pad.geometry.padRadius * 0.7, y: pad.geometry.padY } };
					},
				};
			});
			const cdp = await page.context().newCDPSession(page);
			const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Array<{ id: number; x: number; y: number }>) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(point => ({ ...point, radiusX: 1, radiusY: 1 })) });
			const poll = async () => { await page.evaluate(() => (globalThis as any).keyboardTouch.poll()); return page.evaluate(() => (globalThis as any).keyboardTouch.poll()); };
			let centers = await page.evaluate(() => (globalThis as any).keyboardTouch.centers());
			const toggle = async () => {
				centers = await page.evaluate(() => (globalThis as any).keyboardTouch.centers());
				await touch('touchStart', [centers.select]); await poll();
				await touch('touchStart', [centers.select, centers.x]); await poll();
				await touch('touchEnd', [centers.x]); await poll();
				await touch('touchEnd', [centers.select]); await poll();
			};
			await poll(); await toggle();
			const positions = await page.evaluate(() => (globalThis as any).keyboardTouch.positions());
			assert.equal(await page.evaluate(point => (globalThis as any).keyboardTouch.menu.capturesPointer(point.x, point.y), positions.nonInteractive), false, 'keyboard title and panel padding do not capture gamepad input');
			assert.equal(await page.evaluate(point => (globalThis as any).keyboardTouch.menu.capturesPointer(point.x, point.y), positions.panelOutside), false);
			assert.equal(await page.evaluate(point => (globalThis as any).keyboardTouch.menu.capturesPointer(point.x, point.y), positions.outsideLb), false, 'outside-panel shoulder remains a gamepad target');
			assert.equal(await page.evaluate(point => (globalThis as any).keyboardTouch.menu.capturesPointer(point.x, point.y), positions.q), true);
			for (const point of positions.controllerButtons) assert.equal(await page.evaluate(point => (globalThis as any).keyboardTouch.menu.capturesPointer(point.x, point.y), point), false, `${point.id} binding remains reachable while keyboard is visible`);
			let id = 10;
			for (const key of ['q', 'w'] as const) for (const first of ['keyboard', 'gamepad'] as const) {
				const keyPoint = { id: id++, ...positions[key] }, lbPoint = { id: id++, ...positions.outsideLb };
				const down = first === 'keyboard' ? keyPoint : lbPoint;
				await touch('touchStart', [down]); await poll();
				await touch('touchStart', [keyPoint, lbPoint]);
				const both = await poll();
				assert.equal(both.model, LB); assert.equal(both.physical, LB);
				assert.equal(both[key], true); assert.equal(both[key === 'q' ? 'qMmio' : 'wMmio'], true);
				assert.equal(both.pointerHeld, true);
				await touch('touchEnd', [lbPoint]);
				const retained = await poll();
				assert.equal(retained.model, 0); assert.equal(retained[key], true, 'gamepad up cannot release the foreground keyboard source');
				await touch('touchEnd', [keyPoint]);
				const released = await poll();
				assert.equal(released[key], false); assert.equal(released[key === 'q' ? 'qMmio' : 'wMmio'], false);
				assert.equal(released.pointerHeld, false); assert.equal(released.model, 0);
			}
			for (const point of positions.controllerButtons) {
				const contact = { id: id++, x: point.x, y: point.y };
				await touch('touchStart', [contact]);
				const pressed = await poll();
				assert.equal(pressed.model, 1 << CONTROLLER_BUTTONS[point.id], `${point.id} native binding remains independently usable`);
				assert.equal(pressed.physical, pressed.model);
				const code = KEYBOARD_COMMANDS[point.id];
				if (code !== undefined) assert.equal(await page.evaluate(code => (globalThis as any).keyboardTouch.keyPressed(code), code), true);
				await touch('touchEnd', [contact]);
				const released = await poll();
				assert.equal(released.model, 0);
				if (code !== undefined) assert.equal(await page.evaluate(code => (globalThis as any).keyboardTouch.keyPressed(code), code), false);
			}
			const padRight = { id: id++, ...positions.padRight };
			await touch('touchStart', [padRight]);
			assert.equal((await poll()).model, 1 << InputControllerGamepadButtonBit.Right, 'digital D-pad navigation remains available outside keyboard keys');
			await touch('touchEnd', [padRight]); await poll();
			// Keep the Select lease from opening, and keep a canvas keyboard lease
			// through closing. Neither owner may claim the other's existing contact.
			await toggle();
			centers = await page.evaluate(() => (globalThis as any).keyboardTouch.centers());
			await touch('touchStart', [centers.select]); await poll();
			await touch('touchStart', [centers.select, centers.x]); await poll();
			await touch('touchEnd', [centers.x]); await poll();
			const qPoint = { id: id++, ...positions.q };
			await touch('touchStart', [centers.select, qPoint]);
			let held = await poll();
			assert.equal(held.model, SELECT); assert.equal(held.q, true);
			centers = await page.evaluate(() => (globalThis as any).keyboardTouch.centers());
			await touch('touchStart', [centers.select, qPoint, centers.x]);
			held = await poll();
			assert.equal(held.model & SELECT, SELECT); assert.equal(held.controllerLeases, 2, 'closing reflows art but never steals the actual controller leases'); assert.equal(held.q, false, 'closing releases generated keys immediately, not browser contacts');
			assert.equal(held.pointerHeld, true);
			assert.equal(held.sampledPad, 0, 'closing host UI cannot leak a held action into gameplay after reflow');
			assert.equal(held.padMmio, 0, 'the armed ICU likewise sees no unintended action');
			await touch('touchEnd', [centers.x]); await poll();
			await touch('touchEnd', [centers.select]); await poll();
			const admissionCalls = held.admissionCalls;
			await touch('touchMove', [{ ...qPoint, ...positions.outsideLb }]);
			const moved = await poll();
			assert.equal(moved.model, 0, 'a retained canvas lease cannot become a shoulder after the keyboard closes');
			assert.equal(moved.pointerHeld, true); assert.equal(moved.q, false);
			assert.equal(moved.admissionCalls, admissionCalls, 'foreground admission is never queried on move or release');
			await touch('touchEnd', [qPoint]);
			const allUp = await poll();
			assert.equal(allUp.model, 0); assert.equal(allUp.pointerHeld, false);
			assert.equal(await page.evaluate(point => (globalThis as any).keyboardTouch.menu.capturesPointer(point.x, point.y), positions.q), false, 'closed keyboard has no foreground claim');
			const closedQ = { id: id++, ...positions.q };
			await touch('touchStart', [closedQ]);
			const closed = await poll();
			if (profile.width > profile.height) assert.equal(closed.model & LB, LB, 'the regression key point really overlaps the shoulder in landscape');
			await touch('touchEnd', [closedQ]); await poll();
			assert.ok((await page.evaluate(() => (globalThis as any).keyboardTouch.native)).every((event: { trusted: boolean }) => event.trusted));
			assert.deepEqual(errors, []);
		});
	}
});
