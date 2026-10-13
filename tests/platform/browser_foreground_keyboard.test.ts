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
		{ name: 'phone landscape', width: 852, height: 393, sourceHeight: 212, fit: 'fit' },
		{ name: 'phone portrait', width: 393, height: 852, sourceHeight: 212, fit: 'fit' },
		{ name: 'tablet landscape', width: 1024, height: 768, sourceHeight: 212, fit: 'fit' },
		{ name: 'phone landscape overscan 256x192', width: 852, height: 393, sourceHeight: 192, fit: 'overscan' },
	]) {
		await t.test(profile.name, async orientation => {
			const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
			orientation.after(() => page.close());
			const errors: string[] = [];
			page.on('pageerror', error => errors.push(error.message));
			await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body class="game-started"><div id="player-surface">${controls}<canvas id="gamescreen" width="256" height="${profile.sourceHeight}" style="display:block"></canvas></div></body>`);
			await page.addScriptTag({ content: bundle.outputFiles[0].text });
			assert.deepEqual(errors, []);
			await page.evaluate(({ sourceHeight, fit }) => {
				const api = (globalThis as any).fixture;
				const clock = new api.BrowserHostClock();
				const pad = new api.BrowserOnscreenGamepad(clock);
				const view = new api.BrowserOnscreenGamepadView(document, window, pad);
				const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
				const video = new api.BrowserVideoOutput(canvas, view, fit);
				video.refreshLayout();
				const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, pad, 'F2');
				// Observe source delivery before the owning hub can stop propagation.
				const native: Array<{ type: string; id: number; trusted: boolean }> = [];
				for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(type, event => {
					const pointer = event as PointerEvent;
					native.push({ type, id: pointer.pointerId, trusted: pointer.isTrusted });
				}, { capture: true, passive: true });
				const input = new api.Input(clock, hub, pad.gamepadIndex);
				const backend = new api.HeadlessGPUBackend(256, sourceHeight, api.PSX_MACHINE_SPEC.gxGpuVramBytes);
				const presenter = new api.VideoPresenter(video, backend, 256, sourceHeight);
				presenter.default_font = new api.Font();
				const menu = new api.HostOverlayMenu(presenter, {}, input, {}, new api.HostExecutionControl({ mutePause() {} }));
				menu.setKeyboardVisibilityListener(view.setKeyboardVisible);
				let admissionCalls = 0;
				hub.setForegroundPointerCapture((x: number, y: number) => { admissionCalls += 1; return menu.capturesPointer(x, y); });
				const snapshot = api.createInputControllerSnapshot();
				const memory = new api.Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, api.PSX_MACHINE_SPEC.ramBytes);
				const controller = new api.InputController(memory, input, { supervisorContextActive() { return false; }, requestSupervisorLineEdge() {} });
				controller.reset();
				const display = {
					client(x: number, y: number) { const rect = canvas.getBoundingClientRect(); return { x: rect.left + x * rect.width / 256, y: rect.top + y * rect.height / sourceHeight }; },
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
					keyMmio(code: string) { const usage = api.hidKeyUsageForCode(code); return (memory.readIoU32(api.IO_INP_KEYS + (usage >>> 5) * 4) & (1 << (usage & 31))) !== 0; },
					centers() { return { select: { id: 1, ...display.center('select_knop') }, x: { id: 2, ...display.center('x_knop') } }; },
					positions() {
						const keyboard = menu.keyboard;
						const panel = keyboard.panelRect.area;
						const keys = { point(label: string, lowerRight = false) { const index = keyboard.keyGlyphs.findIndex((glyph: any) => glyph.items === label); const area = keyboard.keyRects[index].area; return display.client(lowerRight ? area.right - 2 : area.left + 2, lowerRight ? area.bottom - 2 : area.top + 2); } };
						const lb = pad.geometry.actions.find((action: any) => action.buttons === (1 << 4));
						const outsideLb = { x: lb.x + lb.outline.centerX + lb.outline.radius * lb.outline.startX, y: lb.y + lb.outline.centerY + lb.outline.radius * lb.outline.startY };
						return { controllerButtons: ['a_knop', 'b_knop', 'x_knop', 'y_knop', 'ls_knop', 'rs_knop', 'select_knop', 'start_knop', 'lb_knop', 'rb_knop', 'lt_knop', 'rt_knop'].map(id => ({ id, ...display.center(id + '_text') })), select: display.center('select_knop'), x: display.center('x_knop'), q: keys.point('q'), w: keys.point('w'), keyAndFaceOverlap: keys.point('>', true), outsideLb,
							nonInteractive: display.client(panel.left + 1, panel.top + 1), panelOutside: display.client(panel.left - 1, panel.top + 1), padRight: { x: pad.geometry.padX + pad.geometry.padRadius * 0.7, y: pad.geometry.padY } };
					},
				};
			}, profile);
			const cdp = await page.context().newCDPSession(page);
			const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', points: Array<{ id: number; x: number; y: number }>) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(point => ({ ...point, radiusX: 1, radiusY: 1 })) });
			const poll = async () => { await page.evaluate(() => (globalThis as any).keyboardTouch.poll()); return page.evaluate(() => (globalThis as any).keyboardTouch.poll()); };
			const artworkAt = (points: Array<{ x: number; y: number }>) => page.evaluate(({ points, buttons }) => {
				let word = 0;
				for (const [id, bit] of Object.entries(buttons)) {
					const shape = document.getElementById(id) as unknown as SVGGeometryElement;
					const inverse = shape.getScreenCTM()!.inverse();
					for (const point of points) {
						if (shape.isPointInFill(new DOMPoint(point.x, point.y).matrixTransform(inverse))) word |= 1 << bit;
					}
				}
				const pad = document.getElementById('d-pad-svg')!.getBoundingClientRect();
				const face = document.getElementById('action-buttons-svg')!.getBoundingClientRect();
				return { word, padLeft: pad.left, faceRight: face.right };
			}, { points, buttons: CONTROLLER_BUTTONS });
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
			if (profile.fit === 'overscan') {
				const overlap = { id: id++, ...positions.keyAndFaceOverlap };
				assert.equal((await artworkAt([overlap])).word, 1 << InputControllerGamepadButtonBit.X,
					'the actual top-docked ArrowRight key still genuinely overlaps the physical X rim in this authored source target');
				assert.equal(await page.evaluate(point => (globalThis as any).keyboardTouch.menu.capturesPointer(point.x, point.y), overlap), true);
				await touch('touchStart', [overlap]);
				const pressed = await poll();
				assert.equal(pressed.model, 0); assert.equal(pressed.physical, 0);
				assert.equal(pressed.controllerLeases, 0); assert.equal(pressed.pointerHeld, true);
				assert.equal(pressed.sampledPad, 0); assert.equal(pressed.padMmio, 0);
				assert.equal(await page.evaluate(() => (globalThis as any).keyboardTouch.keyPressed('ArrowRight')), true,
					'the true foreground key owns the overlapping native contact instead of the background X button');
				assert.equal(await page.evaluate(() => (globalThis as any).keyboardTouch.keyMmio('ArrowRight')), true);
				await touch('touchEnd', [overlap]); await poll();
				assert.equal(await page.evaluate(() => (globalThis as any).keyboardTouch.keyPressed('ArrowRight')), false);
				assert.equal(await page.evaluate(() => (globalThis as any).keyboardTouch.keyMmio('ArrowRight')), false);
			}
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
			// A keyboard-context hand reflow may remove a held button contribution,
			// but it cannot cancel that finger or claim an existing canvas lease.
			await toggle();
			centers = await page.evaluate(() => (globalThis as any).keyboardTouch.centers());
			const openingSelect = centers.select;
			await touch('touchStart', [openingSelect]); await poll();
			const openingNative = await page.evaluate(() => (globalThis as any).keyboardTouch.native.at(-1));
			assert.equal(openingNative.type, 'pointerdown');
			await touch('touchStart', [openingSelect, centers.x]); await poll();
			await touch('touchEnd', [centers.x]); await poll();
			const qPoint = { id: id++, ...positions.q };
			await touch('touchStart', [openingSelect, qPoint]);
			let held = await poll();
			assert.equal(held.model, (await artworkAt([openingSelect])).word, 'the old held coordinate follows actual post-reflow button surfaces');
			assert.equal(held.physical, held.model);
			assert.equal(held.controllerLeases, 1, 'losing coverage does not end the original Select contact lease');
			assert.equal(held.q, true); assert.equal(held.qMmio, true); assert.equal(held.pointerHeld, true);
			await touch('touchEnd', [openingSelect]);
			held = await poll();
			const openingUp = await page.evaluate(() => (globalThis as any).keyboardTouch.native.at(-1));
			assert.equal(openingUp.type, 'pointerup'); assert.equal(openingUp.id, openingNative.id, 'the original Select finger ends through its actual native up');
			assert.equal(held.controllerLeases, 0); assert.equal(held.model, 0);
			assert.equal(held.q, true); assert.equal(held.qMmio, true); assert.equal(held.pointerHeld, true);
			centers = await page.evaluate(() => (globalThis as any).keyboardTouch.centers());
			const closingSelect = { ...centers.select, id: id++ };
			const closingX = { ...centers.x, id: id++ };
			await touch('touchStart', [qPoint, closingSelect]);
			held = await poll();
			assert.equal(held.model, SELECT); assert.equal(held.controllerLeases, 1);
			assert.equal(held.q, true); assert.equal(held.qMmio, true);
			await touch('touchStart', [qPoint, closingSelect, closingX]);
			held = await poll();
			assert.equal(held.model, (await artworkAt([closingSelect, closingX])).word, 'closing resamples the existing fingers against actual gameplay artwork');
			assert.equal(held.physical, held.model);
			assert.equal(held.controllerLeases, 2, 'closing reflows art but never steals the actual controller leases'); assert.equal(held.q, false, 'closing releases generated keys immediately, not browser contacts');
			assert.equal(held.qMmio, false);
			assert.equal(held.pointerHeld, true);
			assert.equal(held.sampledPad, 0, 'closing host UI cannot leak a held action into gameplay after reflow');
			assert.equal(held.padMmio, 0, 'the armed ICU likewise sees no unintended action');
			await touch('touchEnd', [closingX]); await poll();
			await touch('touchEnd', [closingSelect]);
			const controlsUp = await poll();
			assert.equal(controlsUp.controllerLeases, 0); assert.equal(controlsUp.model, 0); assert.equal(controlsUp.physical, 0);
			const admissionCalls = held.admissionCalls;
			await touch('touchMove', [{ ...qPoint, ...positions.outsideLb }]);
			const moved = await poll();
			assert.equal(moved.model, 0, 'a retained canvas lease cannot become a shoulder after the keyboard closes');
			assert.equal(moved.pointerHeld, true); assert.equal(moved.q, false);
			assert.equal(moved.admissionCalls, admissionCalls, 'foreground admission is never queried on move or release');
			await touch('touchEnd', [qPoint]);
			const allUp = await poll();
			assert.equal(allUp.model, 0); assert.equal(allUp.physical, 0); assert.equal(allUp.controllerLeases, 0); assert.equal(allUp.pointerHeld, false);
			assert.equal(allUp.sampledPad, 0); assert.equal(allUp.padMmio, 0);
			assert.equal(await page.evaluate(point => (globalThis as any).keyboardTouch.menu.capturesPointer(point.x, point.y), positions.q), false, 'closed keyboard has no foreground claim');
			const closedQ = { id: id++, ...positions.q };
			const artwork = await artworkAt([closedQ]);
			await touch('touchStart', [closedQ]);
			const closed = await poll();
			assert.equal(closed.model, artwork.word, 'without foreground keyboard focus the native contact follows the actual SVG button silhouettes');
			if (profile.name === 'phone landscape') {
				assert.equal(artwork.word & LB, 0, 'the phone shoulder no longer extends inward into the former Q point');
				assert.ok(artwork.padLeft <= 20 && artwork.faceRight >= profile.width - 20, 'phone primaries remain edge anchored rather than pushed inward');
			}
			await touch('touchEnd', [closedQ]); await poll();
			if (profile.fit === 'overscan') {
				const formerKey = { id: id++, ...positions.keyAndFaceOverlap };
				assert.equal((await artworkAt([formerKey])).word, 1 << InputControllerGamepadButtonBit.X,
					'the former ArrowRight coordinate also lies in the genuine gameplay X silhouette after context reflow');
				await touch('touchStart', [formerKey]);
				const gameplayX = await poll();
				assert.deepEqual([gameplayX.model, gameplayX.physical, gameplayX.sampledPad, gameplayX.padMmio], [4, 4, 4, 4],
					'closing foreground focus restores fresh native gamepad acquisition at the same formerly overlapping key coordinate');
				await touch('touchEnd', [formerKey]); await poll();
			}
			const gameplayA = { ...await page.evaluate(() => (globalThis as any).keyboardTouch.positions().controllerButtons.find((point: { id: string }) => point.id === 'a_knop')), id: id++ };
			await touch('touchStart', [gameplayA]);
			const gameplay = await poll();
			assert.deepEqual([gameplay.model, gameplay.physical, gameplay.sampledPad, gameplay.padMmio], [1, 1, 1, 1], 'fresh gameplay input reaches the armed ICU after all actual native releases');
			await touch('touchEnd', [gameplayA]);
			const gameplayUp = await poll();
			assert.deepEqual([gameplayUp.model, gameplayUp.physical, gameplayUp.sampledPad, gameplayUp.padMmio], [0, 0, 0, 0]);
			assert.ok((await page.evaluate(() => (globalThis as any).keyboardTouch.native)).every((event: { trusted: boolean; type: string }) => event.trusted && event.type !== 'pointercancel'), 'context reflow never fabricates native cancellation');
			assert.deepEqual(errors, []);
		});
	}
});
