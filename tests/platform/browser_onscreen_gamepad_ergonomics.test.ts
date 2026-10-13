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
	{ name: 'tablet-portrait', width: 768, height: 1024, insets: [24, 0, 20, 0], screenshot: true },
	{ name: 'tablet-landscape', width: 1024, height: 768, insets: [0, 0, 20, 0], screenshot: true },
	{ name: 'embedded-player-offset', width: 1024, height: 768, insets: [0, 0, 0, 0], screenshot: true,
		player: { left: 92, top: 40, width: 840, height: 650 } },
] as const;

// Geometry and native desktop input contracts, not proof of hand comfort or iPhone multitouch.
test('generic gamepad places equal faces and secondary controls in authored hand groups', async t => {
	const template = await readFile('gamebase.html', 'utf8');
	let controls = template.slice(template.indexOf('<div id="controller-viewport"'), template.indexOf('<div id="gameContainer">'));
	for (const name of ['neutral', 'u', 'ru', 'r', 'rd', 'd', 'ld', 'l', 'lu']) {
		const bytes = await readFile(`rom/d-pad-${name}.png`);
		controls = controls.replace(`@@DPAD_${name.toUpperCase()}@@`, `data:image/png;base64,${bytes.toString('base64')}`);
	}
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
				return { buttons: model.buttons, physicalButtons: input.getPlayerInput(1).inputHandlers.gamepad.physicalGamepadButtonsWord(), sampledButtons: snapshot.pads[0].buttons };
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
				const padBounds = document.getElementById('d-pad-svg')!.getBoundingClientRect();

				const pad = { id: 'd-pad-svg', x: padBounds.left + padBounds.width / 2,
					y: padBounds.top + padBounds.height / 2, radius: padBounds.width / 2,
					bounds: { left: padBounds.left, top: padBounds.top, width: padBounds.width, height: padBounds.height },
					painted: { left: padBounds.left, top: padBounds.top, right: padBounds.right, bottom: padBounds.bottom },
				};
				return {
					circles: [pad, ...actionIds.map(id => read.circle(id))],
					padImage: document.querySelector('.d-pad-image[data-active="true"]')!.id,
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
	const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Array<{ id: number; x: number; y: number; radiusX?: number; radiusY?: number }>) => {
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
	const evidence: Array<{ profile: string; safe: unknown; geometry: unknown; minimumControlGap: number;
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
			assert.ok(Math.abs(circles[0].bounds.width - 180 * scale) < 0.0001, 'pad follows the same authored CSS-client scale as the face group');
			const utilityDiameter = 52 * (profile.smallPlayer ? scale : 1);
			for (const circle of circles.slice(5)) assert.ok(Math.abs(circle.bounds.width - utilityDiameter) < 0.0001,
				`${circle.id} follows the authored secondary scale, including the whole compact hand group`);
			const pad = circles[0];
			const faceCenter = { x: (circles[1].x + circles[4].x) / 2, y: (circles[1].y + circles[4].y) / 2 };
			const landscape = safe.right - safe.left >= safe.bottom - safe.top;
			const secondaryOffsets: Array<{ id: string; x: number; y: number }> = [];
			for (const index of [5, 6, 7, 8]) {
				const circle = circles[index];
				const primary = index === 5 || index === 7 ? pad : faceCenter;
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
				assert.ok(Math.abs(pad.y - faceCenter.y - faceLift * scale) < coordinateTolerance,
					'portrait uses an authored stagger, not incremental collision packing');
				assert.ok(Math.abs(circles[5].x - pad.x) < coordinateTolerance);
				assert.ok(Math.abs(circles[5].y - (pad.y - pad.radius - utilityDiameter / 2 - 12 * scale)) < coordinateTolerance,
					'left portrait secondary row is immediately above the left primary dial');
				assert.ok(Math.abs(circles[6].y - (faceCenter.y - 104 * scale - utilityDiameter / 2 - 12 * scale)) < coordinateTolerance,
					'right portrait secondary row is immediately above the right primary dial');
			}
			const approvedPadCenters: Record<string, readonly number[]> = {
				'phone14-portrait-safe': [114, 688], 'phone14-landscape-safe': [169, 247],
				'browser-landscape-safe': [157, 189], 'browser-landscape-300-safe': [157, 169],
				'browser-landscape-280-safe': [157, 149],
			};
			if (profile.name in approvedPadCenters) {
				assert.ok(Math.abs(pad.x - approvedPadCenters[profile.name][0]) < 0.0001);
				assert.ok(Math.abs(pad.y - approvedPadCenters[profile.name][1]) < 0.0001,
					'approved phone pad placement is unchanged');
			}
			const gaps: number[] = [];
			const minimumGap = profile.smallPlayer ? 8 * scale : 8;
			const paintClearance = 12 * (profile.smallPlayer ? scale : 1);
			for (let index = 0; index < circles.length; index += 1) {
				const circle = circles[index];
				assert.ok(Math.abs(circle.bounds.width - circle.bounds.height) < 0.0001, `${circle.id} keeps uniform CSS-client scaling`);
				assert.ok(circle.painted.left >= safe.left + paintClearance - 0.0001, `${circle.id} left paint clearance`);
				assert.ok(circle.painted.top >= safe.top + paintClearance - 0.0001, `${circle.id} top paint clearance`);
				assert.ok(circle.painted.right <= safe.right - paintClearance + 0.0001, `${circle.id} right paint clearance`);
				assert.ok(circle.painted.bottom <= safe.bottom - paintClearance + 0.0001, `${circle.id} bottom paint clearance`);
				for (let other = index + 1; other < circles.length; other += 1) {
					const next = circles[other];
					const gap = Math.hypot(circle.x - next.x, circle.y - next.y) - circle.radius - next.radius;
					gaps.push(gap);
					assert.ok(gap >= minimumGap - 0.0001, `${circle.id}/${next.id} primary and button geometry retain their authored separation`);
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
			const padCenter = { id: 6, x: circles[0].x, y: circles[0].y };
			await touch('touchStart', [padCenter]);
			assert.deepEqual(await poll(), { buttons: 0, physicalButtons: 0, sampledButtons: 0 },
				'neutral center acquires a controller lease without pressing a direction');
			const travel = pad.radius * 0.7;
			const diagonalTravel = travel / Math.SQRT2;
			const masks = { up: 1 << InputControllerGamepadButtonBit.Up, right: 1 << InputControllerGamepadButtonBit.Right,
				down: 1 << InputControllerGamepadButtonBit.Down, left: 1 << InputControllerGamepadButtonBit.Left };
			const rolls = [
				{ x: pad.x + travel, y: pad.y, mask: masks.right, image: 'r' },
				{ x: pad.x + diagonalTravel, y: pad.y - diagonalTravel, mask: masks.up | masks.right, image: 'ru' },
				{ x: pad.x, y: pad.y - travel, mask: masks.up, image: 'u' },
				{ x: pad.x - diagonalTravel, y: pad.y - diagonalTravel, mask: masks.up | masks.left, image: 'lu' },
				{ x: pad.x - travel, y: pad.y, mask: masks.left, image: 'l' },
				{ x: pad.x - diagonalTravel, y: pad.y + diagonalTravel, mask: masks.down | masks.left, image: 'ld' },
				{ x: pad.x, y: pad.y + travel, mask: masks.down, image: 'd' },
				{ x: pad.x + diagonalTravel, y: pad.y + diagonalTravel, mask: masks.down | masks.right, image: 'rd' },
				{ x: pad.x + travel, y: pad.y, mask: masks.right, image: 'r' },
			];
			for (const roll of rolls) {
				await touch('touchMove', [{ ...padCenter, x: roll.x, y: roll.y, radiusX: 14, radiusY: 14 }]);
				assert.deepEqual(await poll(), { buttons: roll.mask, physicalButtons: roll.mask, sampledButtons: roll.mask },
					'digital rolling updates immediately without a center excursion or finger lift');
				await settle();
				const rolled = await measure();
				assert.equal(rolled.padImage, `svgimg-d-pad-${roll.image}`);
				assert.deepEqual(rolled.circles[0].bounds, resting.circles[0].bounds, 'artwork state changes never move the digital rocker frame');
			}
			await touch('touchEnd', []);
			evidence.push({ profile: profile.name, safe, geometry: resting, minimumControlGap: Math.min(...gaps), secondaryOffsets });
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
				assert.deepEqual(await poll(), { buttons: actions[index].buttons, physicalButtons: actions[index].buttons, sampledButtons }, `${actions[index].label} native center has its own exact physical bit`);
				await settle();
				const pressed = await measure();
				assert.equal(pressed.circles[index + 1].presentation.touched, 'true');
				assert.notEqual(pressed.circles[index + 1].presentation.fill, circle.presentation.fill);
				assert.deepEqual(pressed.circles.map((entry: any) => entry.bounds), circles.map((entry: any) => entry.bounds), 'press rendering never moves a target');
				await touch('touchEnd', []);
				assert.equal((await poll()).sampledButtons, 0);
				await settle();
			}
			const thumb = { id: 1, x: circles[1].x, y: circles[1].y, radiusX: 14, radiusY: 14 };
			await touch('touchStart', [thumb]);
			assert.equal((await poll()).sampledButtons, 1);
			const bridge = { ...thumb, x: (circles[1].x + circles[2].x) / 2, y: (circles[1].y + circles[2].y) / 2 };
			await touch('touchMove', [bridge]);
			assert.equal((await poll()).sampledButtons, 3, 'one reported thumb footprint bridges adjacent A and B');
			await settle();
			assert.deepEqual((await measure()).circles.slice(1, 3).map((circle: any) => circle.presentation.touched), ['true', 'true']);
			const directionThumb = { id: 2, x: rolls[1].x, y: rolls[1].y, radiusX: 14, radiusY: 14 };
			await touch('touchStart', [bridge, directionThumb]);
			assert.equal((await poll()).sampledButtons, 3 | masks.up | masks.right, 'a second thumb independently rolls a diagonal while the first presses two faces');
			await touch('touchEnd', [directionThumb]);
			assert.equal((await poll()).sampledButtons, 3, 'lifting the directional thumb leaves both face contributions held');
			await touch('touchMove', [{ ...thumb, x: circles[2].x, y: circles[2].y }]);
			assert.equal((await poll()).sampledButtons, 2, 'rolling onto B releases A without releasing the thumb');
			await touch('touchEnd', []);
			assert.equal((await poll()).sampledButtons, 0);
			await page.evaluate(() => (globalThis as any).ergonomicsProbe.background('bright'));
			if (profile.screenshot) await page.screenshot({ path: `${evidenceDirectory}/${profile.name}-bright-rest.png` });
			if (profile.name === 'phone14-portrait-safe' || profile.name === 'phone14-landscape-safe' || profile.name === 'tablet-portrait' || profile.name === 'tablet-landscape') {
				for (const background of ['dark', 'bright']) {
					await page.evaluate(kind => (globalThis as any).ergonomicsProbe.background(kind), background);
					for (const [name, roll] of [['up-right', rolls[1]], ['down-left', rolls[5]]] as const) {
						await touch('touchStart', [{ id: 1, x: roll.x, y: roll.y, radiusX: 14, radiusY: 14 }]);
						assert.equal((await poll()).sampledButtons, roll.mask);
						await settle();
						await page.screenshot({ path: `${evidenceDirectory}/${profile.name}-${background}-${name}.png` });
						await touch('touchEnd', []);
						await settle();
					}
					await touch('touchStart', [bridge]);
					await settle();
					await page.screenshot({ path: `${evidenceDirectory}/${profile.name}-${background}-thumb-chord.png` });
					await touch('touchEnd', []);
					await settle();
					const base = circles[0];
					const a = { id: 1, x: circles[1].x, y: circles[1].y };
					const b = { id: 2, x: circles[2].x, y: circles[2].y };
					const pad = { id: 3, x: base.x - base.radius * 0.7, y: base.y };
					await touch('touchStart', [a]);
					await touch('touchStart', [a, b]);
					await touch('touchStart', [a, b, pad]);
					assert.equal((await poll()).sampledButtons, 0x4003);
					await settle();
					const paired = await measure();
					assert.deepEqual(paired.circles.slice(1, 3).map((circle: any) => circle.presentation.touched), ['true', 'true']);
					assert.equal(paired.padImage, 'svgimg-d-pad-l');
					assert.notEqual(paired.circles[1].presentation.fill, circles[1].presentation.fill);
					assert.notEqual(paired.circles[2].presentation.stroke, circles[2].presentation.stroke);
					await page.screenshot({ path: `${evidenceDirectory}/${profile.name}-${background}-paired.png` });
					const scale = await page.evaluate(() => visualViewport!.scale);
					await touch('touchMove', [a, b, { ...pad, x: -40 }]);
					assert.equal((await poll()).sampledButtons, 0x4003, 'an acquired rocker continues steering when the thumb leaves its artwork');
					assert.equal(await page.evaluate(() => (globalThis as any).ergonomicsProbe.model.ownsContact((globalThis as any).ergonomicsProbe.pointerEvents.filter((event: any) => event.type === 'pointerdown').at(-1).id)), true, 'controller retains the native lease for reentry');
					assert.equal(await page.evaluate(() => visualViewport!.scale), scale);
					await settle();
					const dragged = await measure();
					assert.equal(dragged.padImage, 'svgimg-d-pad-l', 'the static pressed artwork remains LEFT beyond the pad boundary');
					assert.deepEqual(dragged.circles.map((circle: any) => circle.bounds), circles.map((circle: any) => circle.bounds));
					await touch('touchMove', [a, b, pad]);
					assert.equal((await poll()).sampledButtons, 0x4003, 'reentry restores the held contact contribution');
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
	await t.test('true player-frame resize resamples held contacts before any subsequent native jitter', async () => {
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
		const finger = { id: 1, x: initial.circles[1].x, y: initial.circles[1].y, radiusX: 14, radiusY: 14 };
		await touch('touchStart', [finger]);
		const expected = [{ id: 'select_knop', x: 128, y: 10 }, { id: 'start_knop', x: -140, y: 20 },
			{ id: 'ls_knop', x: 100, y: -80 }, { id: 'rs_knop', x: -100, y: -70 }];
		for (const [height, held] of [[341, 1], [340, 1], [320, 0], [300, 0], [280, 0], [390, 1]]) {
			await page.setViewportSize({ width: 844, height });
			await page.evaluate(height => {
				document.getElementById('player-surface')!.style.height = `${height}px`;
				(globalThis as any).ergonomicsProbe.video.refreshLayout();
			}, height);
			await settle();
			const current = await measure();
			const pad = current.circles[0];
			const faceCenter = { x: (current.circles[1].x + current.circles[4].x) / 2,
				y: (current.circles[1].y + current.circles[4].y) / 2 };
			for (let index = 0; index < expected.length; index += 1) {
				const circle = current.circles[index + 5];
				const primary = index === 0 || index === 2 ? pad : faceCenter;
				assert.equal(circle.id, expected[index].id);
				assert.ok(Math.abs(circle.x - primary.x - expected[index].x) < 1 / 32);
				assert.ok(Math.abs(circle.y - primary.y - expected[index].y) < 1 / 32,
					`${circle.id} remains attached to its own hand at ${height}px browser height`);
			}
			const word = await poll();
			assert.equal(word.buttons, held, `true document/player-frame geometry immediately applies at ${height}px height`);
			assert.equal(word.physicalButtons, word.buttons);
			assert.equal(word.sampledButtons, word.buttons);
			assert.equal(await page.evaluate(() => (globalThis as any).ergonomicsProbe.model.ownsContact((globalThis as any).ergonomicsProbe.pointerEvents.filter((event: any) => event.type === 'pointerdown').at(-1).id)), true,
				'true layout changes contributions, not the retained contact identity');
			assert.equal(current.circles[1].presentation.touched, (word.buttons & 1) !== 0 ? 'true' : 'false');
			finger.x += 1;
			await touch('touchMove', [finger]);
			assert.equal((await poll()).sampledButtons, held, 'one-pixel native jitter does not reveal an edge deferred by layout');
			await page.screenshot({ path: `${evidenceDirectory}/player-resize-${height}-held.png` });
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
