import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { Browser } from 'playwright';
import { afterTest } from './test_cleanup';

/** One real page, gameplay input owner and native contact lifetime per profile. */
export async function openBrowserErgonomicsPage(t: TestContext, browser: Browser, html: string, script: string, actionIds: string[]) {
	const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
	const errors: string[] = [];
	page.on('pageerror', error => errors.push(error.message));
	afterTest(t, () => page.close());
	await page.setContent(html);
	await page.addScriptTag({ content: script });
	await page.evaluate(actionIds => {
		const api = (globalThis as any).ergonomicsFixture;
		const clock = new api.BrowserHostClock();
		const model = new api.BrowserOnscreenGamepad(clock);
		const view = new api.BrowserOnscreenGamepadView(document, window, model);
		const canvas = document.getElementById('gamescreen') as HTMLCanvasElement;
		const video = new api.BrowserVideoOutput(canvas, view, 'fit');
		video.refreshLayout();
		const hub = new api.BrowserInputHub(canvas, document.getElementById('player-surface'), clock, model, 'F2');
		hub.setHostControls(new api.BrowserHostControls(document, () => {}, () => {}));
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
			geometryRevision() { return model.geometryRevision; },
			measureDeck(width: number, height: number) { return view.measurePortraitDeckHeight(width, height); },
			poll() {
				input.pollInput();
				input.sampleInputControllerSnapshot(snapshot, 0);
				return { buttons: model.buttons, physicalButtons: input.getPlayerInput(1).inputHandlers.gamepad.physicalGamepadButtonsWord(), sampledButtons: snapshot.pads[0].buttons };
			},
			measure() {
				const read = {
					target(id: string, index: number) {
						const element = document.getElementById(id) as unknown as SVGGraphicsElement;
						const bounds = element.getBoundingClientRect();
						const bezel = element.previousElementSibling as SVGGraphicsElement;
						const geometry = model.geometry.actions[index];
						const bezelBounds = bezel.getBoundingClientRect();
						const scale = element.getScreenCTM()!.a;
						const edge = Number.parseFloat(getComputedStyle(bezel).strokeWidth) * scale / 2;
						const style = getComputedStyle(element);
						const transform = element.getScreenCTM()!;
						return {
							id, x: geometry.x, y: geometry.y, radius: geometry.radius, bank: geometry.bank, buttons: geometry.buttons,
							outline: geometry.outline ? { ...geometry.outline } : undefined,
							tag: element.tagName,
							transform: { a: transform.a, d: transform.d, e: transform.e, f: transform.f },
							bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
							painted: { left: bezelBounds.left - edge, top: bezelBounds.top - edge, right: bezelBounds.right + edge, bottom: bezelBounds.bottom + edge },
							presentation: { fill: style.fill, stroke: style.stroke, touched: element.getAttribute('data-touched') },
						};
					},
				};
				const padBounds = document.getElementById('d-pad-svg')!.getBoundingClientRect();
				const padBezel = document.querySelector('#d-pad-artwork .control-bezel') as SVGGraphicsElement;
				const padBezelBounds = padBezel.getBoundingClientRect();
				const padEdge = Number.parseFloat(getComputedStyle(padBezel).strokeWidth) * padBezel.getScreenCTM()!.a / 2;

				const pad = { id: 'd-pad-svg', x: padBounds.left + padBounds.width / 2,
					y: padBounds.top + padBounds.height / 2, radius: padBounds.width / 2,
					bounds: { left: padBounds.left, top: padBounds.top, width: padBounds.width, height: padBounds.height },
					painted: { left: padBezelBounds.left - padEdge, top: padBezelBounds.top - padEdge,
						right: padBezelBounds.right + padEdge, bottom: padBezelBounds.bottom + padEdge },
				};
				return {
					targets: [pad, ...actionIds.map((id, index) => read.target(id, index))],
					hosts: ['host-keyboard-control', 'host-menu-control'].map(id => {
						const element = document.getElementById(id)!;
						const bounds = element.getBoundingClientRect();
						return { id, x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2,
							radius: bounds.width / 2, hidden: element.hidden, label: element.getAttribute('aria-label'),
							background: getComputedStyle(element).backgroundColor,
							bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height } };
					}),
					layoutProfile: view.layoutProfile,
					deckTop: view.portraitDeckTop,
					canvas: (() => { const rect = canvas.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; })(),
					padDirections: ['u', 'r', 'd', 'l'].map(direction => document.getElementById(`d-pad-${direction}`)!.getAttribute('data-touched')),
					labels: actionIds.map(id => {
						const label = document.getElementById(id + '_text')!;
						const bounds = label.getBoundingClientRect();
						const style = getComputedStyle(label);
						return { text: label.textContent, visibility: style.visibility, opacity: style.opacity, fill: style.fill,
							left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height,
							stroke: style.stroke, strokeWidth: Number.parseFloat(style.strokeWidth) * (label as unknown as SVGGraphicsElement).getScreenCTM()!.a,
							strokeLinejoin: style.strokeLinejoin, paintOrder: style.paintOrder };
					}),
					groups: ['d-pad-controls', 'button-controls', 'select-controls', 'start-controls', 'ls-controls', 'rs-controls', 'lb-controls', 'rb-controls', 'lt-controls', 'rt-controls'].map(id => {
						const element = document.getElementById(id)!;
						const bounds = element.getBoundingClientRect();
						return { id, hidden: element.hidden, pointerEvents: getComputedStyle(element).pointerEvents,
							bounds: { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height } };
					}),
				};
			},
			fills(samples: Array<{ id: string; x: number; y: number }>) {
				return samples.map(sample => {
					const shape = document.getElementById(sample.id) as unknown as SVGGeometryElement;
					const local = new DOMPoint(sample.x, sample.y).matrixTransform(shape.getScreenCTM()!.inverse());
					return shape.isPointInFill(local);
				});
			},
			background(kind: string) {
				const context = canvas.getContext('2d')!;
				const player = document.getElementById('player-surface')!;
				const plain = kind === 'white' ? '#ffffff' : kind === 'glyph-mask' ? '#ff00ff' : '#101010';
				player.style.background = kind === 'bright'
					? 'repeating-conic-gradient(#ede6bb 0% 25%, #7eabc5 0% 50%) 0 0 / 56px 56px'
					: plain;
				context.fillStyle = kind === 'bright' ? '#d8dfb9' : plain;
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
	}, actionIds);
	await page.evaluate(() => document.fonts.ready);
	const cdp = await page.context().newCDPSession(page);
	const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: Array<{ id: number; x: number; y: number; radiusX?: number; radiusY?: number }>) =>
		cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
	const settle = () => page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
	const measure = () => page.evaluate(() => (globalThis as any).ergonomicsProbe.measure());
	const poll = () => page.evaluate(() => (globalThis as any).ergonomicsProbe.poll());
	const finish = async (): Promise<number> => {
		const pointerEvents = await page.evaluate(() => {
			const probe = (globalThis as any).ergonomicsProbe;
			probe.dispose();
			return probe.pointerEvents;
		});
		assert.ok(pointerEvents.every((event: any) => event.trusted), 'browser integration uses real native contact delivery');
		assert.deepEqual(errors, []);
		return pointerEvents.length;
	};
	return { page, touch, settle, measure, poll, finish };
}
