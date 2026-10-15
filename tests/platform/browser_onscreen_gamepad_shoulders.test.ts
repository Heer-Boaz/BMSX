import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import { controlContainsPoint, distanceToControl, roundContactBankWord } from './touch_gamepad_geometry_oracle';

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
export { INP_CTRL_ARM, IO_INP_CTRL, IO_INP_PADS, IO_INP_PAD_BUTTONS_OFFSET, IO_INP_PAD_LX_OFFSET, IO_INP_PAD_LY_OFFSET, IO_INP_PAD_LT_OFFSET, IO_INP_PAD_RT_OFFSET } from './machine/ts/spec/bmsx/io';`,
			resolveDir: process.cwd(),
		},
		bundle: true, platform: 'browser', format: 'iife', globalName: 'fixture', write: false,
		tsconfig: 'tsconfig.base.json',
	});
	const browser = await chromium.launch();
	t.after(() => browser.close());
	for (const profile of [
		{ name: 'phone portrait', width: 393, height: 720, insets: [0, 0, 0, 0] },
		{ name: 'phone portrait safe', width: 393, height: 852, insets: [47, 0, 34, 0] },
		{ name: 'phone landscape', width: 852, height: 393, insets: [0, 0, 0, 0] },
		{ name: 'compact portrait', width: 320, height: 568, insets: [0, 0, 0, 0] },
		{ name: 'compact overlay', width: 320, height: 240, insets: [0, 0, 0, 0] },
		{ name: 'tablet portrait', width: 768, height: 1024, insets: [0, 0, 0, 0] },
		{ name: 'tablet landscape', width: 1024, height: 768, insets: [0, 0, 0, 0] },
	]) {
		await t.test(profile.name, async orientation => {
			const page = await browser.newPage({ viewport: { width: profile.width, height: profile.height }, isMobile: true, hasTouch: true });
			orientation.after(() => page.close());
			const errors: string[] = [];
			page.on('pageerror', error => errors.push(error.message));
			await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div>`);
			await page.locator('#player-surface').evaluate((element, insets) => {
				(element as HTMLElement).style.padding = insets.map(value => `${value}px`).join(' ');
			}, profile.insets);
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
				const nativeEvents: Array<{ type: string; id: number; trusted: boolean; pointerType: string; width: number; height: number; x: number; y: number }> = [];
				// Observe the native producer before Input subscribes: the controller
				// deliberately stops propagation of owned pointer moves.
				for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
					window.addEventListener(type, event => {
						const pointer = event as PointerEvent;
						nativeEvents.push({ type, id: pointer.pointerId, trusted: event.isTrusted, pointerType: pointer.pointerType, width: pointer.width, height: pointer.height, x: pointer.clientX, y: pointer.clientY });
					}, true);
				}
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
				let cycle = 0;
				(globalThis as any).shoulderTest = {
					menu,
					setDirectionalMode(mode) { pad.setDirectionalMode(mode); },
					ownsContact(id) { return pad.ownsContact(id); },
					layoutProfile() { return view.layoutProfile; },
					directionalGeometry() {
						return { x: pad.geometry.padX, y: pad.geometry.padY, radius: pad.geometry.padRadius };
					},
					geometry() {
						return pad.geometry.actions.map(action => ({ x: action.x, y: action.y, radius: action.radius, buttons: action.buttons,
							bank: action.bank, outline: action.outline ? { ...action.outline } : undefined }));
					},
					refreshLayout() { video.refreshLayout(); },
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
							stickActive: pad.stickActive, stickAxes: Array.from(snapshot.pads[0].axesQ16).slice(0, 2),
							mmioStickAxes: [memory.readIoU32(api.IO_INP_PADS + api.IO_INP_PAD_LX_OFFSET), memory.readIoU32(api.IO_INP_PADS + api.IO_INP_PAD_LY_OFFSET)],
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
			const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', touchPoints: typeof points) => {
				await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
				if (type === 'touchStart') nativeContactCount = touchPoints.length;
				else if (type === 'touchEnd') nativeContactCount = touchPoints.length === 0 ? 0 : nativeContactCount - touchPoints.length;
				else if (type === 'touchCancel') nativeContactCount = 0;
			};
			const poll = () => page.evaluate(() => (globalThis as any).shoulderTest.poll());
			const point = (id: string) => points[BUTTONS.findIndex(button => button.id === id)];
			orientation.afterEach(async () => {
				if (nativeContactCount !== 0) await touch('touchEnd', []);
				await page.evaluate(() => {
					const fixture = (globalThis as any).shoulderTest;
					fixture.menu.dismiss(); fixture.setDirectionalMode('dpad');
				});
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

			await orientation.test('a native retained L-stick cannot press shoulders or faces while its owner drags over them', async () => {
				const padShape = await page.evaluate(() => (globalThis as any).shoulderTest.directionalGeometry());
				await page.evaluate(() => (globalThis as any).shoulderTest.setDirectionalMode('stick'));
				await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
				assert.equal(await page.locator('#left-stick-artwork').getAttribute('visibility'), 'visible');
				assert.equal(await page.locator('#d-pad-artwork').getAttribute('visibility'), 'hidden');
				const finger = { id: 91, x: padShape.x, y: padShape.y, radiusX: 14, radiusY: 14 };
				await touch('touchStart', [finger]);
				const neutral = await poll();
				assert.deepEqual([neutral.model, neutral.physical, neutral.snapshot, neutral.mmio, neutral.pointer], [0, 0, 0, 0, 0]);
				assert.equal(neutral.stickActive, true);
				assert.deepEqual(neutral.stickAxes, [0, 0]);
				const owner = await page.evaluate(() => (globalThis as any).shoulderTest.nativeEvents.at(-1).id);
				for (const target of [...points.slice(0, 8), { x: -40, y: padShape.y }, { x: profile.width + 40, y: padShape.y }]) {
					finger.x = target.x; finger.y = target.y;
					await touch('touchMove', [finger]);
					const moved = await poll();
					assert.deepEqual([moved.model, moved.physical, moved.snapshot, moved.mmio, moved.pointer], [0, 0, 0, 0, 0],
						'captured analog motion never becomes button gliding, even over an actual button silhouette');
					assert.equal(moved.stickActive, true);
					assert.ok(moved.stickAxes.some(axis => axis !== 0));
					assert.deepEqual(moved.mmioStickAxes, moved.stickAxes);
					assert.equal(await page.evaluate(id => (globalThis as any).shoulderTest.ownsContact(id), owner), true);
				}
				const heldAxes = (await poll()).stickAxes;
				await touch('touchStart', [finger, point('lb_knop')]);
				const independent = await poll();
				assert.deepEqual([independent.model, independent.physical, independent.snapshot, independent.mmio], [0x10, 0x10, 0x10, 0x10]);
				assert.deepEqual(independent.stickAxes, heldAxes, 'a second shoulder finger cannot steal the captured analog owner');
				await touch('touchEnd', [point('lb_knop')]);
				const releasedShoulder = await poll();
				assert.equal(releasedShoulder.model, 0);
				assert.deepEqual(releasedShoulder.stickAxes, heldAxes);
				await touch('touchCancel', []);
				const cancelled = await poll();
				assert.equal(cancelled.stickActive, false);
				assert.deepEqual(cancelled.stickAxes, [0, 0]);
				assert.deepEqual(cancelled.mmioStickAxes, [0, 0]);
				finger.x = padShape.x + padShape.radius * 0.4; finger.y = padShape.y;
				await touch('touchStart', [finger]);
				const shortTravel = await poll();
				assert.ok(shortTravel.stickAxes[0] >= 0x8000 && shortTravel.stickAxes[0] < 0x10000,
					'a short 40%-radius thumb movement crosses the existing digital axis threshold without needing the old long throw');
				assert.equal(shortTravel.model, 0, 'host digital interpretation does not manufacture raw D-pad bits');
				await touch('touchEnd', []);
				assert.deepEqual((await poll()).stickAxes, [0, 0]);
				await page.evaluate(() => (globalThis as any).shoulderTest.setDirectionalMode('dpad'));
			});

			await orientation.test('one trusted rolling thumb bridges the digital D-pad and both actual neighboring shoulders', async () => {
				const padShape = await page.evaluate(() => (globalThis as any).shoulderTest.directionalGeometry());
				const phonePortrait = await page.evaluate(() => (globalThis as any).shoulderTest.layoutProfile() === 'phone-portrait');
				const shapes = await page.evaluate(() => (globalThis as any).shoulderTest.geometry());
				const assertWord = async (word: number, message: string) => {
					const state = await poll();
					assert.deepEqual([state.model, state.physical, state.snapshot, state.mmio], Array(4).fill(word), message);
					assert.equal(state.pointer, 0, 'the genuine native contact remains controller-owned');
					assert.deepEqual(state.axes, [(word & 0x40) !== 0 ? 0x10000 : 0, (word & 0x80) !== 0 ? 0x10000 : 0]);
				};
				for (const id of ['lb_knop', 'lt_knop']) {
					const own = BUTTONS.find(button => button.id === id)!;
					const shoulderWord = 1 << own.bit;
					const shape = shapes.find(action => action.buttons === shoulderWord);
					const arc = shape.outline;
					const cx = shape.x + arc.centerX;
					const cy = shape.y + arc.centerY;
					const start = Math.atan2(arc.startY, arc.startX);
					const sweep = (Math.atan2(arc.endY, arc.endX) - start + Math.PI * 2) % (Math.PI * 2);
					const desired = (Math.atan2(padShape.y - cy, padShape.x - cx) - start + Math.PI * 2) % (Math.PI * 2);
					let coreX: number;
					let coreY: number;
					let probeAngle: number;
					if (desired <= sweep) {
						probeAngle = start + desired;
						coreX = cx + arc.radius * Math.cos(start + desired);
						coreY = cy + arc.radius * Math.sin(start + desired);
					} else {
						const sx = cx + arc.radius * arc.startX;
						const sy = cy + arc.radius * arc.startY;
						const ex = cx + arc.radius * arc.endX;
						const ey = cy + arc.radius * arc.endY;
						const useStart = Math.hypot(padShape.x - sx, padShape.y - sy) <= Math.hypot(padShape.x - ex, padShape.y - ey);
						coreX = useStart ? sx : ex;
						coreY = useStart ? sy : ey;
						const inward = Math.min(Math.PI / 180, sweep / 4);
						probeAngle = start + (useStart ? inward : sweep - inward);
					}
					const nearestGap = Math.hypot(coreX - padShape.x, coreY - padShape.y) - arc.halfWidth - padShape.radius;
					assert.ok(nearestGap > 0 && nearestGap < 28, `${profile.name} ${id} has a genuinely usable 28px contact bridge, not invisible hit inflation`);
					if (phonePortrait) assert.ok(Math.abs(nearestGap - 18) < 0.0001,
						`${profile.name} ${id} leaves an actual 18px portrait clearance outside the unchanged pad disk`);
					// Test the physical corridor just inside a finite cap, not exactly on
					// a directional sector seam. Boundary classification is tested separately;
					// floating atan2 and slope comparisons need not round a seam identically.
					coreX = cx + arc.radius * Math.cos(probeAngle);
					coreY = cy + arc.radius * Math.sin(probeAngle);
					const distance = Math.hypot(coreX - padShape.x, coreY - padShape.y);
					const ux = (coreX - padShape.x) / distance;
					const uy = (coreY - padShape.y) / distance;
					const gap = distance - arc.halfWidth - padShape.radius;
					assert.ok(gap > 0 && gap < 28, 'the actual chosen interior-cap corridor remains a physical 28px bridge');
					const assertDirection = async (shoulders: number, message: string) => {
						const native = await page.evaluate(() => (globalThis as any).shoulderTest.nativeEvents.at(-1));
						// Consume the browser's actual floating client coordinates. A closest
						// arc ray can lie exactly on a sector seam; native coordinate rounding
						// is part of the producer, not a reason to freeze a mathematical ray.
						const degrees = (Math.atan2(native.y - padShape.y, native.x - padShape.x) * 180 / Math.PI + 360) % 360;
						const direction = degrees < 35 || degrees > 325 ? 0x8000
							: degrees <= 55 ? 0xa000 : degrees < 125 ? 0x2000 : degrees <= 145 ? 0x6000
								: degrees < 215 ? 0x4000 : degrees <= 235 ? 0x5000 : degrees < 305 ? 0x1000 : 0x9000;
						if (phonePortrait) {
							assert.equal(direction & 0x1000, 0x1000, 'upper phone shoulder corridors are reached by rolling UP');
							assert.equal(direction & 0x2000, 0, 'the upper fan cannot require a DOWN shoulder chord');
						}
						await assertWord(direction | shoulders, message);
					};
					for (const [radiusX, radiusY] of [[14, 14], [0.5, 0.5], [20, 28], [28, 20]]) {
						const contact = { id: 1, x: padShape.x + ux * padShape.radius * 0.3,
							y: padShape.y + uy * padShape.radius * 0.3, radiusX, radiusY };
						await touch('touchStart', [contact]);
						await assertDirection(0, 'direction-first acquisition retains the existing digital sectors');
						// Five positions across a real corridor, not a single grazing point.
						for (const offset of [0.3, 0.4, 0.5, 0.6, 0.7]) {
							contact.x = padShape.x + ux * (padShape.radius + gap * offset);
							contact.y = padShape.y + uy * (padShape.radius + gap * offset);
							await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [contact] });
							await assertDirection(shoulderWord, `${id} rolling contact reaches direction and shoulder through the true corridor`);
						}
						contact.x = coreX;
						contact.y = coreY;
						await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [contact] });
						await assertWord(shoulderWord, 'fully rolling onto the shoulder releases direction, not the retained native contact');
						await touch('touchEnd', []);
						await assertWord(0, 'up releases the entire one-thumb contribution');
						await touch('touchStart', [contact]);
						await assertWord(shoulderWord, 'shoulder-first down cannot invent directional presses');
						contact.x = padShape.x + ux * (padShape.radius + gap * 0.65);
						contact.y = padShape.y + uy * (padShape.radius + gap * 0.65);
						await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [contact] });
						await assertWord(shoulderWord, 'area-only grazing keeps the center-nearest shoulder ownership');
						contact.x = padShape.x + ux * (padShape.radius + gap * 0.35);
						contact.y = padShape.y + uy * (padShape.radius + gap * 0.35);
						await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [contact] });
						await assertDirection(shoulderWord, 'deliberate partition crossing acquires the digital rocker without lifting');
						await touch('touchEnd', []);
						await assertWord(0, 'all hardware contributions release together');
					}
				}
			});

			await orientation.test('ordinary 28px and browser-estimated thumbs can roll around the D-pad rim without pressing a shoulder', async rim => {
				const padShape = await page.evaluate(() => (globalThis as any).shoulderTest.directionalGeometry());
				const shapes = await page.evaluate(() => (globalThis as any).shoulderTest.geometry());
				const minimumGap = Math.min(...shapes.filter(shape => (shape.buttons & 0x50) !== 0)
					.map(shape => distanceToControl(shape, padShape.x, padShape.y) - padShape.radius));
				if (minimumGap <= 14) {
					rim.skip('compact embedded players scale the physical gap below a full 28px thumb radius; the deliberate chord and exact geometry remain tested');
					return;
				}
				for (const radius of [14, 0.5]) {
					const contact = { id: 1, x: padShape.x, y: padShape.y, radiusX: radius, radiusY: radius };
					await touch('touchStart', [contact]);
					assert.equal((await poll()).model, 0);
					for (let step = 0; step < 24; step += 1) {
						const angle = (13 + step * 15) * Math.PI / 180;
						contact.x = padShape.x + padShape.radius * Math.cos(angle);
						contact.y = padShape.y + padShape.radius * Math.sin(angle);
						await touch('touchMove', [contact]);
						const state = await poll();
						assert.notEqual(state.model & 0xf000, 0, 'sliding around the entire acquisition rim keeps an immediate digital direction');
						assert.equal(state.model & ~0xf000, 0, 'a full 28px contact at the D-pad rim does not graze either shoulder');
						assert.deepEqual([state.physical, state.snapshot, state.mmio], Array(3).fill(state.model));
						assert.deepEqual(state.axes, [0, 0]);
						assert.equal(state.pointer, 0);
					}
					await touch('touchEnd', []);
					assert.equal((await poll()).model, 0);
				}
			});

			await orientation.test('neighboring face and shoulder silhouettes isolate estimated and measured thumb footprints across banks', async () => {
				const shapes = await page.evaluate(() => (globalThis as any).shoulderTest.geometry());
				for (const id of ['lb_knop', 'rb_knop', 'lt_knop', 'rt_knop']) {
					const button = BUTTONS.find(button => button.id === id)!;
					const shape = shapes.find(shape => shape.buttons === 1 << button.bit);
					const arc = shape.outline;
					const centerX = shape.x + arc.centerX;
					const centerY = shape.y + arc.centerY;
					const start = Math.atan2(arc.startY, arc.startX);
					const sweep = (Math.atan2(arc.endY, arc.endX) - start + Math.PI * 2) % (Math.PI * 2);
					const surfacePoints: Array<{ x: number; y: number }> = [];
					for (let step = 0; step <= 12; step += 1) {
						for (const radial of [-0.999, 0, 0.999]) {
							const angle = start + sweep * step / 12;
							const radius = arc.radius + radial * arc.halfWidth;
							surfacePoints.push({ x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) });
						}
					}
					// Round caps are part of the genuine silhouette, not just the arc
					// centerline. Include their outside wings and nearly painted edges.
					for (const [dx, dy] of [[arc.startX, arc.startY], [arc.endX, arc.endY]]) {
						for (let step = 0; step < 8; step += 1) {
							const angle = Math.PI * step / 4;
							surfacePoints.push({ x: centerX + arc.radius * dx + arc.halfWidth * 0.999 * Math.cos(angle),
								y: centerY + arc.radius * dy + arc.halfWidth * 0.999 * Math.sin(angle) });
						}
					}
					const bankMask = id === 'lb_knop' || id === 'lt_knop' ? 0x50 : 0xa0;
					for (const [radiusX, radiusY] of [[14, 14], [20, 28], [28, 20]]) {
						for (const [index, surface] of surfacePoints.entries()) {
							assert.ok(controlContainsPoint(shape, surface.x, surface.y), `${id} sample ${index} is inside the actual finite silhouette`);
							const contact = { ...point(id), ...surface, radiusX, radiusY };
							await touch('touchStart', [contact]);
							const entered = await poll();
							assert.notEqual(entered.model & shape.buttons, 0, `${id} direct surface entry is never intercepted by another bank`);
							assert.equal(entered.model & ~bankMask, 0, `${id} ${radiusX * 2}x${radiusY * 2} footprint cannot invent face/direction/utility contributions`);
							assert.deepEqual([entered.physical, entered.snapshot, entered.mmio], [entered.model, entered.model, entered.model]);
							const axes = [(entered.model & 0x40) !== 0 ? 0x10000 : 0, (entered.model & 0x80) !== 0 ? 0x10000 : 0];
							assert.deepEqual(entered.axes, axes);
							assert.deepEqual(entered.mmioAxes, axes);
							assert.equal(entered.pointer, 0);
							await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...contact, x: shape.x, y: shape.y }] });
							const moved = await poll();
							assert.notEqual(moved.model & shape.buttons, 0);
							assert.equal(moved.model & ~bankMask, 0, 'live centerline motion retains only the selected bank');
							assert.deepEqual([moved.physical, moved.snapshot, moved.mmio], [moved.model, moved.model, moved.model]);
							await touch('touchEnd', []);
							const ended = await poll();
							assert.deepEqual([ended.model, ended.physical, ended.snapshot, ended.mmio], [0, 0, 0, 0]);
						}
					}
				}
				const faceId = 'y_knop';
				const face = shapes.find(shape => shape.buttons === 8);
				for (const [radiusX, radiusY] of [[14, 14], [20, 28], [28, 20]]) {
					for (let step = 0; step < 16; step += 1) {
						const angle = step * Math.PI / 8;
						const contact = { ...point(faceId), x: face.x + Math.cos(angle) * face.radius * 0.999,
							y: face.y + Math.sin(angle) * face.radius * 0.999, radiusX, radiusY };
						assert.ok(controlContainsPoint(face, contact.x, contact.y));
						await touch('touchStart', [contact]);
						const entered = await poll();
						assert.notEqual(entered.model & face.buttons, 0, 'the adjacent face keeps its own edge contacts');
						assert.equal(entered.model & ~0x0f, 0,
							`${faceId} ${radiusX * 2}x${radiusY * 2} contact cannot acquire the neighboring shoulder or utility bank`);
						assert.deepEqual([entered.physical, entered.snapshot, entered.mmio], Array(3).fill(entered.model));
						await touch('touchEnd', []);
						assert.equal((await poll()).mmio, 0);
					}
				}

			});

			await orientation.test('independent adjacent face and RB contacts survive cross-bank slides, viewport relayout and either release order', async () => {
				const faceId = 'y_knop';
				const faceWord = 8;
				for (const releaseShoulderFirst of [false, true]) {
					const rb = point('rb_knop');
					const face = point(faceId);
					await touch('touchStart', [rb]);
					assert.equal((await poll()).model, 0x20);
					await touch('touchStart', [rb, face]);
					const both = await poll();
					assert.deepEqual([both.model, both.physical, both.snapshot, both.mmio], Array(4).fill(0x20 | faceWord));
					await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...rb, x: face.x, y: face.y }, face] });
					assert.equal((await poll()).model, faceWord, 'the first native pointer deliberately enters the face bank without lifting');
					await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [rb, face] });
					assert.equal((await poll()).model, 0x20 | faceWord);
					await page.setViewportSize({ width: profile.width + 18, height: profile.height });
					await page.evaluate(() => (globalThis as any).shoulderTest.refreshLayout());
					const resizedShapes = await page.evaluate(() => (globalThis as any).shoulderTest.geometry());
					const rbWord = roundContactBankWord(resizedShapes, rb.x, rb.y, 14);
					const resizedFaceWord = roundContactBankWord(resizedShapes, face.x, face.y, 14);
					const resized = await poll();
					assert.deepEqual([resized.model, resized.physical, resized.snapshot, resized.mmio], Array(4).fill(rbWord | resizedFaceWord),
						'relayout resamples the two real retained contacts using new surfaces, not synthetic releases or captured banks');
					await touch('touchEnd', [releaseShoulderFirst ? rb : face]);
					const remainingWord = releaseShoulderFirst ? resizedFaceWord : rbWord;
					const remaining = await poll();
					assert.deepEqual([remaining.model, remaining.physical, remaining.snapshot, remaining.mmio], Array(4).fill(remainingWord));
					await touch('touchEnd', []);
					assert.equal((await poll()).mmio, 0);
					await page.setViewportSize({ width: profile.width, height: profile.height });
					await page.evaluate(() => (globalThis as any).shoulderTest.refreshLayout());
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
					let bridge: { x: number; y: number };
					let closestCaps = Infinity;
					for (const [ax, ay] of [[first.outline.startX, first.outline.startY], [first.outline.endX, first.outline.endY]]) {
						for (const [bx, by] of [[second.outline.startX, second.outline.startY], [second.outline.endX, second.outline.endY]]) {
							const a = { x: first.x + first.outline.centerX + first.outline.radius * ax,
								y: first.y + first.outline.centerY + first.outline.radius * ay };
							const b = { x: second.x + second.outline.centerX + second.outline.radius * bx,
								y: second.y + second.outline.centerY + second.outline.radius * by };
							const distance = Math.hypot(a.x - b.x, a.y - b.y);
							if (distance < closestCaps) {
								closestCaps = distance;
								bridge = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
							}
						}
					}
					assert.ok(distanceToControl(first, bridge.x, bridge.y) < 14 && distanceToControl(second, bridge.x, bridge.y) < 14,
						`${firstId}/${secondId} share a real 28px thumb corridor between their finite caps, not overlapping target rectangles`);
					assert.equal(roundContactBankWord(shapes, bridge.x, bridge.y, 14), word);

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

			await orientation.test('frontend host requests use the existing frame-boundary menu and keyboard transitions without synthetic input', async () => {
				assert.equal((await poll()).menuExecution, 0);
				assert.equal(await page.evaluate(() => {
					const menu = (globalThis as any).shoulderTest.menu;
					menu.requestToggleKeyboard();
					return menu.keyboard.visible;
				}), false, 'native callbacks only queue the host request, not an out-of-frame keyboard transition');
				const openedKeyboard = await poll();
				assert.equal(await page.evaluate(() => (globalThis as any).shoulderTest.menu.keyboard.visible), true);
				assert.deepEqual([openedKeyboard.model, openedKeyboard.physical, openedKeyboard.snapshot, openedKeyboard.mmio], [0, 0, 0, 0]);
				for (let frame = 0; frame < 3; frame += 1) {
					await poll();
					assert.equal(await page.evaluate(() => (globalThis as any).shoulderTest.menu.keyboard.visible), true, 'an already consumed host request does not repeat each frame');
				}
				await page.evaluate(() => (globalThis as any).shoulderTest.menu.requestToggleKeyboard());
				await poll();
				assert.equal(await page.evaluate(() => (globalThis as any).shoulderTest.menu.keyboard.visible), false);
				assert.equal(await page.evaluate(() => {
					const menu = (globalThis as any).shoulderTest.menu;
					menu.requestToggleMenu();
					return menu.executionMode;
				}), 0, 'menu presentation also remains owned by the next input tick');
				const openedMenu = await poll();
				assert.equal(openedMenu.menuInput, 1); assert.equal(openedMenu.menuExecution, 1);
				assert.deepEqual([openedMenu.model, openedMenu.physical, openedMenu.snapshot, openedMenu.mmio], [0, 0, 0, 0]);
				await page.evaluate(() => (globalThis as any).shoulderTest.menu.requestToggleMenu());
				assert.equal((await poll()).menuExecution, 0);
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
			for (const [width, height] of [[1, 1], [28, 28], [40, 56], [56, 40]]) {
				assert.ok(nativeEvents.some(event => event.type === 'pointerdown' && event.width === width && event.height === height),
					`${width}x${height} contact geometry genuinely arrives from the native browser boundary`);
			}
			assert.deepEqual(errors, []);
			await page.evaluate(() => (globalThis as any).shoulderTest.finish());
		});
	}
});
