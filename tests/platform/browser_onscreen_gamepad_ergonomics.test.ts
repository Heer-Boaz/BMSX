import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';

const actions = [
	{ id: 'a_knop', label: 'A', buttons: 1 << InputControllerGamepadButtonBit.A },
	{ id: 'b_knop', label: 'B', buttons: 1 << InputControllerGamepadButtonBit.B },
	{ id: 'x_knop', label: 'X', buttons: 1 << InputControllerGamepadButtonBit.X },
	{ id: 'y_knop', label: 'Y', buttons: 1 << InputControllerGamepadButtonBit.Y },
	{ id: 'select_knop', label: 'SELECT', buttons: 1 << InputControllerGamepadButtonBit.Select },
	{ id: 'start_knop', label: 'START', buttons: 1 << InputControllerGamepadButtonBit.Start },
	{ id: 'ls_knop', label: 'LS', buttons: 1 << InputControllerGamepadButtonBit.LeftStick },
	{ id: 'rs_knop', label: 'RS', buttons: 1 << InputControllerGamepadButtonBit.RightStick },
] as const;

// Insets are controlled fixture inputs, not measurements of a particular Safari version.
const profiles: readonly {
	name: string; width: number; height: number; insets: readonly number[]; screenshot: boolean;
	player?: { left: number; top: number; width: number; height: number };
	smallPlayer?: boolean;
}[] = [
	{ name: 'small-player-320', width: 320, height: 240, insets: [0, 0, 0, 0], screenshot: true, smallPlayer: true },
	{ name: 'small-player-319', width: 319, height: 239, insets: [0, 0, 0, 0], screenshot: false, smallPlayer: true },
	{ name: 'square-player', width: 430, height: 430, insets: [0, 0, 0, 0], screenshot: true, smallPlayer: true },
	{ name: 'small-landscape-width-boundary-below', width: 567, height: 239, insets: [0, 0, 0, 0], screenshot: false, smallPlayer: true },
	{ name: 'small-landscape-height-boundary-below', width: 568, height: 238, insets: [0, 0, 0, 0], screenshot: false, smallPlayer: true },
	{ name: 'small-wide-landscape-height-boundary-below', width: 852, height: 238, insets: [0, 0, 0, 0], screenshot: false, smallPlayer: true },
	{ name: 'compact-portrait', width: 320, height: 568, insets: [0, 0, 0, 0], screenshot: true },
	{ name: 'compact-landscape', width: 568, height: 320, insets: [0, 0, 0, 0], screenshot: true },
	{ name: 'phone14-portrait-safe', width: 390, height: 844, insets: [47, 0, 34, 0], screenshot: true },
	{ name: 'phone14-landscape-safe', width: 844, height: 390, insets: [0, 47, 21, 47], screenshot: true },
	{ name: 'portrait-stagger-width-boundary-below', width: 379, height: 844, insets: [47, 0, 34, 0], screenshot: true },
	{ name: 'portrait-stagger-width-boundary-at', width: 380, height: 844, insets: [47, 0, 34, 0], screenshot: true },
	{ name: 'phone-portrait', width: 393, height: 852, insets: [0, 0, 0, 0], screenshot: false },
	{ name: 'phone-landscape', width: 852, height: 393, insets: [0, 0, 0, 0], screenshot: false },
	{ name: 'large-portrait-safe', width: 430, height: 932, insets: [47, 0, 34, 0], screenshot: false },
	{ name: 'large-landscape-safe', width: 932, height: 430, insets: [0, 47, 21, 47], screenshot: false },
	{ name: 'browser-landscape-safe', width: 844, height: 320, insets: [0, 47, 21, 47], screenshot: true },
	{ name: 'browser-landscape-300-safe', width: 844, height: 300, insets: [0, 47, 21, 47], screenshot: true },
	{ name: 'browser-landscape-280-safe', width: 844, height: 280, insets: [0, 47, 21, 47], screenshot: true },
	{ name: 'short-landscape-640', width: 640, height: 240, insets: [0, 0, 0, 0], screenshot: true },
	{ name: 'short-landscape-568', width: 568, height: 239, insets: [0, 0, 0, 0], screenshot: true },
	{ name: 'short-landscape-852', width: 852, height: 239, insets: [0, 0, 0, 0], screenshot: true },
	{ name: 'landscape-height-profile-boundary-below', width: 852, height: 319, insets: [0, 0, 0, 0], screenshot: false },
	{ name: 'landscape-height-profile-boundary-at', width: 852, height: 320, insets: [0, 0, 0, 0], screenshot: false },
	{ name: 'tablet-landscape', width: 1024, height: 768, insets: [0, 0, 20, 0], screenshot: true },
	{ name: 'embedded-player-offset', width: 1024, height: 768, insets: [0, 0, 0, 0], screenshot: true,
		player: { left: 92, top: 40, width: 840, height: 650 } },
] as const;

// Geometry and native desktop input contracts, not proof of hand comfort or iPhone multitouch.
test('generic gamepad places equal faces and secondary controls in authored hand groups', async t => {
	const template = await readFile('gamebase.html', 'utf8');
	const controls = template.slice(template.indexOf('<div id="d-pad-controls"'), template.indexOf('<div id="gameContainer">'));
	const bundle = await build({
		stdin: { contents: `export { BrowserOnscreenGamepad } from './hosts/browser/onscreen_gamepad';
export { BrowserOnscreenGamepadView } from './hosts/browser/onscreen_gamepad_view';
export { BrowserVideoOutput } from './hosts/browser/video_output';
export { BrowserInputHub } from './hosts/browser/input';
export { BrowserHostClock } from './hosts/browser/timing';
export { Input } from './hosts/common/input/manager';
export { createInputControllerSnapshot } from './machine/ts/machine/devices/input/contracts';`, resolveDir: process.cwd() },
		bundle: true, platform: 'browser', format: 'iife', globalName: 'ergonomicsFixture', write: false, tsconfig: 'tsconfig.base.json',
	});
	const evidenceDirectory = '.bmsx/hosting/hand-group-gamepad-evidence';
	await mkdir(evidenceDirectory, { recursive: true });
	const browser = await chromium.launch();
	t.after(() => browser.close());
	const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	await page.setContent(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${await readFile('gamebase.css', 'utf8')}</style><body class="game-started"><div id="player-surface">${controls}<canvas id="gamescreen" width="320" height="240" style="display:block"></canvas></div></body>`);
	await page.addScriptTag({ content: bundle.outputFiles[0].text });
	await page.evaluate(actionIds => {
		const api = (globalThis as any).ergonomicsFixture;
		const clock = new api.BrowserHostClock();
		const model = new api.BrowserOnscreenGamepad(clock);
		const view = new api.BrowserOnscreenGamepadView(document, window, model);
		const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
		const video = new api.BrowserVideoOutput(canvas, view);
		video.refreshLayout();
		const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, model, 'F2');
		const pointerEvents: Array<{ type: string; id: number; trusted: boolean }> = [];
		for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
			window.addEventListener(type, event => {
				const pointer = event as PointerEvent;
				pointerEvents.push({ type, id: pointer.pointerId, trusted: pointer.isTrusted });
			}, true);
		}
		const input = new api.Input(clock, hub, model.gamepadIndex);
		const snapshot = api.createInputControllerSnapshot();
		(globalThis as any).ergonomicsProbe = {
			video, model, pointerEvents,
			poll() {
				input.pollInput();
				input.sampleInputControllerSnapshot(snapshot, 0);
				return { buttons: model.buttons, physicalButtons: input.getPlayerInput(1).inputHandlers.gamepad.physicalGamepadButtonsWord(), sampledButtons: snapshot.pads[0].buttons, stickActive: model.stickActive };
			},
			measure() {
				const read = {
					circle(id: string) {
						const circle = document.getElementById(id) as unknown as SVGCircleElement;
						const bounds = circle.getBoundingClientRect();
						const bezel = circle.previousElementSibling as SVGCircleElement;
						const bezelBounds = bezel.getBoundingClientRect();
						const scale = bounds.width / (circle.r.baseVal.value * 2);
						const edge = Number.parseFloat(getComputedStyle(bezel).strokeWidth) * scale / 2;
						const style = getComputedStyle(circle);
						return {
							id, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2, radius: bounds.width / 2,
							bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
							painted: { left: bezelBounds.left - edge, top: bezelBounds.top - edge, right: bezelBounds.right + edge, bottom: bezelBounds.bottom + edge },
							presentation: { fill: style.fill, stroke: style.stroke, touched: circle.getAttribute('data-touched') },
						};
					},
				};
				const tipBounds = document.getElementById('d-pad-tip')!.getBoundingClientRect();
				return {
					circles: ['d-pad-base', ...actionIds].map(id => read.circle(id)),
					labels: actionIds.map(id => {
						const label = document.getElementById(id + '_text')!;
						const bounds = label.getBoundingClientRect();
						const style = getComputedStyle(label);
						return { text: label.textContent, visibility: style.visibility, opacity: style.opacity, fill: style.fill,
							left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
					}),
					groups: ['d-pad-controls', 'button-controls', 'select-controls', 'start-controls', 'ls-controls', 'rs-controls'].map(id => {
						const element = document.getElementById(id)!;
						const bounds = element.getBoundingClientRect();
						return { id, hidden: element.hidden, pointerEvents: getComputedStyle(element).pointerEvents,
							bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } };
					}),
					tip: { x: tipBounds.left + tipBounds.width / 2, y: tipBounds.top + tipBounds.height / 2, radius: tipBounds.width / 2 },
				};
			},
			background(kind: string) {
				const context = canvas.getContext('2d')!;
				const player = document.getElementById('player-surface')!;
				player.style.background = kind === 'bright'
					? 'repeating-conic-gradient(#ede6bb 0% 25%, #7eabc5 0% 50%) 0 0 / 56px 56px'
					: '#101010';
				context.fillStyle = kind === 'bright' ? '#d8dfb9' : '#101010';
				context.fillRect(0, 0, 320, 240);
				if (kind === 'bright') {
					for (let y = 0; y < 240; y += 24) {
						for (let x = 0; x < 320; x += 32) {
							context.fillStyle = (x + y) % 3 === 0 ? '#51768e' : '#af874f';
							context.fillRect(x + 3, y + 3, 20, 14);
						}
					}
				}
			},
			dispose() { input.dispose(); video.dispose(); },
		};
	}, actions.map(action => action.id));
	await page.evaluate(() => document.fonts.ready);
	const cdp = await page.context().newCDPSession(page);
	let touchActive = false;
	const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Array<{ id: number; x: number; y: number }>) => {
		await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
		if (type === 'touchStart') touchActive = true;
		else if (type === 'touchEnd' && touchPoints.length === 0) touchActive = false;
	};
	const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
	const measure = () => page.evaluate(() => (globalThis as any).ergonomicsProbe.measure());
	const poll = () => page.evaluate(() => (globalThis as any).ergonomicsProbe.poll());
	t.afterEach(async () => {
		if (touchActive) await touch('touchEnd', []);
		await settle();
	});
	const evidence: Array<{ profile: string; safe: unknown; geometry: unknown; minimumContactGap: number;
		secondaryOffsets: Array<{ id: string; x: number; y: number }> }> = [];
	for (const profile of profiles) {
		await t.test(profile.name, async () => {
			const player = profile.player ?? { left: 0, top: 0, width: profile.width, height: profile.height };
			await page.setViewportSize({ width: profile.width, height: profile.height });
			await page.evaluate(({ insets, player }) => {
				const style = document.getElementById('player-surface')!.style;
				style.left = `${player.left}px`;
				style.top = `${player.top}px`;
				style.right = 'auto';
				style.bottom = 'auto';
				style.width = `${player.width}px`;
				style.height = `${player.height}px`;
				style.padding = insets.map(value => `${value}px`).join(' ');
				(globalThis as any).ergonomicsProbe.video.setDisplaySize(320, 240);
				(globalThis as any).ergonomicsProbe.video.refreshLayout();
				(globalThis as any).ergonomicsProbe.background('dark');
			}, { insets: [...profile.insets], player });
			await settle();
			const resting = await measure();
			if (profile.screenshot) await page.screenshot({ path: `${evidenceDirectory}/${profile.name}-dark-rest.png` });
			const safe = { left: player.left + profile.insets[3], top: player.top + profile.insets[0],
				right: player.left + player.width - profile.insets[1], bottom: player.top + player.height - profile.insets[2] };
			const circles = resting.circles;
			const faceDiameter = circles[1].bounds.width;
			const scale = profile.smallPlayer ? Math.min(1, player.width / 568, player.height / 239) : Math.min(1.1, Math.max(1, Math.min(safe.right - safe.left, safe.bottom - safe.top) / 390));
			// CSS left/top are resolved on the browser's subpixel layout grid;
			// transformed SVG sizes remain precise, positions can differ by 1/64 px.
			const coordinateTolerance = 1 / 32;
			assert.ok(Math.abs(faceDiameter - 80 * scale) < 0.0001, profile.smallPlayer ? 'explicit smaller-player profile fits equally scaled face targets' : 'phone face targets are 80-88 CSS px, not accessibility-minimum-sized targets');
			for (const circle of circles.slice(1, 5)) {
				assert.ok(Math.abs(circle.bounds.width - faceDiameter) < 0.0001, `${circle.id} has the same target diameter as every other face button`);
				assert.equal(circle.presentation.fill, circles[1].presentation.fill, 'face buttons have no primary/secondary visual hierarchy');
				assert.equal(circle.presentation.stroke, circles[1].presentation.stroke);
			}
			assert.ok(Math.abs(circles[0].bounds.width - 180 * scale) < 0.0001, 'stick follows the same authored CSS-client scale as the face group');
			const utilityDiameter = 52 * (profile.smallPlayer ? scale : 1);
			for (const circle of circles.slice(5)) assert.ok(Math.abs(circle.bounds.width - utilityDiameter) < 0.0001,
				`${circle.id} follows the authored secondary scale, including the whole compact hand group`);
			const stick = circles[0];
			const faceCenter = { x: (circles[1].x + circles[4].x) / 2, y: (circles[1].y + circles[4].y) / 2 };
			const landscape = safe.right - safe.left >= safe.bottom - safe.top;
			const secondaryOffsets: Array<{ id: string; x: number; y: number }> = [];
			for (const index of [5, 6, 7, 8]) {
				const circle = circles[index];
				const primary = index === 5 || index === 7 ? stick : faceCenter;
				const dx = circle.x - primary.x;
				const dy = circle.y - primary.y;
				assert.ok(Math.hypot(dx, dy) <= (landscape ? 144 : 168) * scale + 0.0001,
					`${circle.id} stays inside its authored hand's local reach envelope, not a viewport-top or central bank`);
				secondaryOffsets.push({ id: circle.id, x: dx / scale, y: dy / scale });
			}
			assert.ok(circles[7].x < circles[5].x && circles[6].x < circles[8].x,
				'left LS/SELECT and right START/RS remain separate authored hand groups');
			if (landscape) {
				const expected = [{ id: 'select_knop', x: 128, y: 10 }, { id: 'start_knop', x: -140, y: 20 },
					{ id: 'ls_knop', x: 100, y: -80 }, { id: 'rs_knop', x: -100, y: -70 }];
				for (let index = 0; index < expected.length; index += 1) {
					assert.equal(secondaryOffsets[index].id, expected[index].id);
					assert.ok(Math.abs(secondaryOffsets[index].x - expected[index].x) < coordinateTolerance / scale);
					assert.ok(Math.abs(secondaryOffsets[index].y - expected[index].y) < coordinateTolerance / scale,
						'landscape secondary arcs follow their primary dials at every browser-chrome height');
				}
			} else {
				const faceLift = safe.right - safe.left < 380 ? 208 : 144;
				assert.ok(Math.abs(stick.y - faceCenter.y - faceLift * scale) < coordinateTolerance,
					'portrait uses an authored stagger, not incremental collision packing');
				assert.ok(Math.abs(circles[5].x - stick.x) < coordinateTolerance);
				assert.ok(Math.abs(circles[5].y - (stick.y - stick.radius - utilityDiameter / 2 - 12 * scale)) < coordinateTolerance,
					'left portrait secondary row is immediately above the left primary dial');
				assert.ok(Math.abs(circles[6].y - (faceCenter.y - 104 * scale - utilityDiameter / 2 - 12 * scale)) < coordinateTolerance,
					'right portrait secondary row is immediately above the right primary dial');
			}
			const approvedStickCenters: Record<string, readonly number[]> = {
				'phone14-portrait-safe': [114, 688], 'phone14-landscape-safe': [169, 247],
				'browser-landscape-safe': [157, 189], 'browser-landscape-300-safe': [157, 169],
				'browser-landscape-280-safe': [157, 149],
			};
			if (profile.name in approvedStickCenters) {
				assert.ok(Math.abs(stick.x - approvedStickCenters[profile.name][0]) < 0.0001);
				assert.ok(Math.abs(stick.y - approvedStickCenters[profile.name][1]) < 0.0001,
					'approved phone stick placement is unchanged');
			}
			const gaps: number[] = [];
			const minimumGap = profile.smallPlayer ? 8 * scale : 8;
			const paintClearance = 12 * (profile.smallPlayer ? scale : 1);
			for (let index = 0; index < circles.length; index += 1) {
				const circle = circles[index];
				assert.ok(Math.abs(circle.bounds.width - circle.bounds.height) < 0.0001, `${circle.id} stays circular`);
				assert.ok(circle.painted.left >= safe.left + paintClearance - 0.0001, `${circle.id} left paint clearance`);
				assert.ok(circle.painted.top >= safe.top + paintClearance - 0.0001, `${circle.id} top paint clearance`);
				assert.ok(circle.painted.right <= safe.right - paintClearance + 0.0001, `${circle.id} right paint clearance`);
				assert.ok(circle.painted.bottom <= safe.bottom - paintClearance + 0.0001, `${circle.id} bottom paint clearance`);
				for (let other = index + 1; other < circles.length; other += 1) {
					const next = circles[other];
					const gap = Math.hypot(circle.x - next.x, circle.y - next.y) - circle.radius - next.radius;
					gaps.push(gap);
					assert.ok(gap >= minimumGap - 0.0001, `${circle.id}/${next.id} contact regions retain their profile's separation`);
				}
			}
			for (const group of resting.groups) {
				assert.equal(group.hidden, false, `${group.id} is visible`);
				assert.equal(group.pointerEvents, 'none', `${group.id} remains passive artwork`);
			}
			for (let index = 0; index < actions.length; index += 1) {
				const label = resting.labels[index];
				assert.equal(label.text, actions[index].label);
				assert.equal(label.visibility, 'visible');
				assert.ok(Number(label.opacity) > 0 && label.width > 0 && label.height > 0, `${actions[index].label} label is painted`);
				const circle = circles[index + 1];
				for (const x of [label.left, label.right]) {
					for (const y of [label.top, label.bottom]) {
						assert.ok(Math.hypot(x - circle.x, y - circle.y) < circle.radius, `${actions[index].label} painted text fits inside its contact circle`);
					}
				}
			}
			const stickCenter = { id: 6, x: circles[0].x, y: circles[0].y };
			await touch('touchStart', [stickCenter]);
			assert.deepEqual(await poll(), { buttons: 0, physicalButtons: 0, sampledButtons: 0, stickActive: true }, 'stick center acquires a stick lease, never an overlapping action');
			await touch('touchMove', [{ ...stickCenter, x: stickCenter.x + circles[0].radius * 0.7 }]);
			const rightWord = 1 << InputControllerGamepadButtonBit.Right;
			assert.deepEqual(await poll(), { buttons: rightWord, physicalButtons: rightWord, sampledButtons: rightWord, stickActive: true });
			await touch('touchEnd', []);
			evidence.push({ profile: profile.name, safe, geometry: resting, minimumContactGap: Math.min(...gaps), secondaryOffsets });
			for (const framebufferWidth of [256, 321, 257, 320]) {
				await page.evaluate(width => {
					(globalThis as any).ergonomicsProbe.video.setDisplaySize(width, 240);
					(globalThis as any).ergonomicsProbe.video.refreshLayout();
				}, framebufferWidth);
				const changed = await measure();
				assert.deepEqual(changed.groups, resting.groups, `framebuffer ${framebufferWidth} does not change any control group`);
				assert.deepEqual(changed.circles.map((circle: any) => circle.bounds), circles.map((circle: any) => circle.bounds));
			}
			for (let index = 0; index < actions.length; index += 1) {
				const circle = circles[index + 1];
				await touch('touchStart', [{ id: 1, x: circle.x, y: circle.y }]);
				// SELECT remains the existing host-control modifier; contact geometry does not change routing policy.
				const sampledButtons = actions[index].id === 'select_knop' ? 0 : actions[index].buttons;
				assert.deepEqual(await poll(), { buttons: actions[index].buttons, physicalButtons: actions[index].buttons, sampledButtons, stickActive: false }, `${actions[index].label} native center has its own exact physical bit`);
				await settle();
				const pressed = await measure();
				assert.equal(pressed.circles[index + 1].presentation.touched, 'true');
				assert.notEqual(pressed.circles[index + 1].presentation.fill, circle.presentation.fill);
				assert.deepEqual(pressed.circles.map((entry: any) => entry.bounds), circles.map((entry: any) => entry.bounds), 'press rendering never moves a target');
				await touch('touchEnd', []);
				assert.equal((await poll()).sampledButtons, 0);
				await settle();
			}
			await page.evaluate(() => (globalThis as any).ergonomicsProbe.background('bright'));
			if (profile.screenshot) await page.screenshot({ path: `${evidenceDirectory}/${profile.name}-bright-rest.png` });
			if (profile.name === 'phone14-portrait-safe' || profile.name === 'phone14-landscape-safe') {
				for (const background of ['dark', 'bright']) {
					await page.evaluate(kind => (globalThis as any).ergonomicsProbe.background(kind), background);
					const base = circles[0];
					const a = { id: 1, x: circles[1].x, y: circles[1].y };
					const b = { id: 2, x: circles[2].x, y: circles[2].y };
					const stick = { id: 3, x: base.x - base.radius * 0.7, y: base.y };
					await touch('touchStart', [a]);
					await touch('touchStart', [a, b]);
					await touch('touchStart', [a, b, stick]);
					assert.equal((await poll()).sampledButtons, 0x4003);
					await settle();
					const paired = await measure();
					assert.deepEqual(paired.circles.slice(0, 3).map((circle: any) => circle.presentation.touched), ['true', 'true', 'true']);
					assert.notEqual(paired.circles[1].presentation.fill, circles[1].presentation.fill);
					assert.notEqual(paired.circles[2].presentation.stroke, circles[2].presentation.stroke);
					await page.screenshot({ path: `${evidenceDirectory}/${profile.name}-${background}-paired.png` });
					const scale = await page.evaluate(() => visualViewport!.scale);
					await touch('touchMove', [a, b, { ...stick, x: -40 }]);
					assert.equal((await poll()).sampledButtons, 0x4003, 'stick contact survives outside the whole player');
					assert.equal(await page.evaluate(() => visualViewport!.scale), scale);
					await settle();
					const dragged = await measure();
					assert.ok(Math.hypot(dragged.tip.x - base.x, dragged.tip.y - base.y) + dragged.tip.radius < base.radius, 'visible tip remains clamped inside the base');
					assert.deepEqual(dragged.circles.map((circle: any) => circle.bounds), circles.map((circle: any) => circle.bounds));
					await touch('touchEnd', [a]);
					assert.equal((await poll()).sampledButtons, 0x4002);
					await settle();
					const released = await measure();
					assert.deepEqual(released.circles.slice(1, 3).map((circle: any) => circle.presentation.touched), ['false', 'true']);
					await touch('touchEnd', []);
					assert.equal((await poll()).sampledButtons, 0);
					await settle();
				}
			}
		});
	}
	await t.test('live browser-chrome height changes retain local groups and held action', async () => {
		await page.setViewportSize({ width: 844, height: 390 });
		await page.evaluate(() => {
			const style = document.getElementById('player-surface')!.style;
			style.left = '0px';
			style.top = '0px';
			style.width = '844px';
			style.height = '390px';
			style.padding = '0px 47px 21px 47px';
			(globalThis as any).ergonomicsProbe.video.setDisplaySize(320, 240);
			(globalThis as any).ergonomicsProbe.video.refreshLayout();
		});
		await settle();
		const initial = await measure();
		await touch('touchStart', [{ id: 1, x: initial.circles[1].x, y: initial.circles[1].y }]);
		const expected = [{ id: 'select_knop', x: 128, y: 10 }, { id: 'start_knop', x: -140, y: 20 },
			{ id: 'ls_knop', x: 100, y: -80 }, { id: 'rs_knop', x: -100, y: -70 }];
		for (const height of [341, 340, 320, 300, 280, 390]) {
			await page.setViewportSize({ width: 844, height });
			await page.evaluate(height => {
				document.getElementById('player-surface')!.style.height = `${height}px`;
				(globalThis as any).ergonomicsProbe.video.refreshLayout();
			}, height);
			await settle();
			const current = await measure();
			const stick = current.circles[0];
			const faceCenter = { x: (current.circles[1].x + current.circles[4].x) / 2,
				y: (current.circles[1].y + current.circles[4].y) / 2 };
			for (let index = 0; index < expected.length; index += 1) {
				const circle = current.circles[index + 5];
				const primary = index === 0 || index === 2 ? stick : faceCenter;
				assert.equal(circle.id, expected[index].id);
				assert.ok(Math.abs(circle.x - primary.x - expected[index].x) < 1 / 32);
				assert.ok(Math.abs(circle.y - primary.y - expected[index].y) < 1 / 32,
					`${circle.id} remains attached to its own hand at ${height}px browser height`);
			}
			assert.deepEqual(await poll(), { buttons: 1, physicalButtons: 1, sampledButtons: 1, stickActive: false },
				'layout publication does not release the held action');
			assert.equal(current.circles[1].presentation.touched, 'true');
			await page.screenshot({ path: `${evidenceDirectory}/chrome-transition-${height}-held.png` });
		}
		await touch('touchEnd', []);
		assert.equal((await poll()).sampledButtons, 0);
		await settle();
	});
	const pointerEvents = await page.evaluate(() => (globalThis as any).ergonomicsProbe.pointerEvents);
	assert.ok(pointerEvents.length > 160);
	assert.ok(pointerEvents.every((event: any) => event.trusted), 'browser integration uses real native contact delivery');
	assert.deepEqual(errors, []);
	await writeFile(`${evidenceDirectory}/geometry.json`, JSON.stringify(evidence, null, 2));
	await page.evaluate(() => (globalThis as any).ergonomicsProbe.dispose());
});
