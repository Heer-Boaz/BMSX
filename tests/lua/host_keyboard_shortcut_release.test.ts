import assert from 'node:assert/strict';
import test from 'node:test';
import { HostMenuInput, HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import { Input } from '../../hosts/common/input/manager';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { createInputControllerSnapshot, InputControllerGamepadButtonBit } from '../../machine/ts/machine/devices/input/contracts';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostRewind } from '../../hosts/common/rewind';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { HostOverlayQueue } from '../../machine/ts/render/host_overlay/overlay_queue';
import type { GlyphRenderSubmission } from '../../machine/ts/render/shared/submissions';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import { createHostFrameFixture } from '../helpers/host_frame';

const SELECT = 1 << InputControllerGamepadButtonBit.Select;
const X = 1 << InputControllerGamepadButtonBit.X;
const A = 1 << InputControllerGamepadButtonBit.A;

for (const hostHz of [60, 120]) {
	for (const releaseOrder of ['x-first', 'select-first', 'simultaneous'] as const) {
		test(`Select+X keyboard close retains real source lifetime with ${releaseOrder} releases at ${hostHz} Hz`, t => {
			const clock = new VirtualHeadlessClock();
			const device = { id: 'gamepad:0', kind: 'gamepad' as const, gamepadIndex: 0, label: 'PAD',
				vibrationInitialization: null, supportsVibration: false, setVibration() {} };
			const input = new Input(clock, { devices: () => [device], subscribe: () => () => {} }, device.gamepadIndex);
			t.after(() => input.dispose());
			const queue = new HostOverlayQueue();
			const presenter = { viewportSize: { x: 256, y: 212 },
		visibleViewportBounds: { left: 0, top: 0, right: 256, bottom: 212 },
				default_font: { lineHeight: 8, measure: (text: string) => text.length * 6 },
				hostOverlayQueue: queue } as VideoPresenter;
			const menu = new HostOverlayMenu(presenter, {} as Runtime, input, {} as HostRewind, createHostFrameFixture().execution);
			const visibilityChanges: boolean[] = [];
			let visible = menu.keyboard.visible;
			t.after(menu.keyboard.subscribe(() => {
				if (visible === menu.keyboard.visible) return;
				visible = menu.keyboard.visible;
				visibilityChanges.push(visible);
			}));
			const gamepad = input.getPlayerInput(1).inputHandlers.gamepad!;
			const snapshot = createInputControllerSnapshot();
			let pressId = 0;
			const pressIds = { select: 0, x: 0, a: 0 };
			const button = (code: keyof typeof pressIds, down: boolean) => {
				if (down) pressIds[code] = ++pressId;
				input.inputButton(device.id, code, down, down ? 1 : 0, clock.now() + 1, pressIds[code]);
			};
			const tick = () => {
				clock.advance(1000 / hostHz);
				input.pollInput();
				const state = menu.tickInput();
				input.sampleInputControllerSnapshot(snapshot, 0);
				return state;
			};
			const keyboardVisible = () => {
				menu.queueFrameOverlayCommands(60);
				if (!queue.hasPendingHostMenuFrame()) return false;
				const frame = queue.consumeHostMenuFrame();
				for (let index = 0; index < frame.commandCount; index += 1) {
					if (frame.commandKinds[index] === Host2DKind.Glyphs && (frame.commandRefs[index] as GlyphRenderSubmission).items === 'BKSP') return true;
				}
				return false;
			};
			const physical = (word: number) => {
				assert.equal(gamepad.physicalGamepadButtonsWord(), word);
				assert.equal(gamepad.getButtonState('select').pressed, (word & SELECT) !== 0);
				assert.equal(gamepad.getButtonState('x').pressed, (word & X) !== 0);
				assert.equal(snapshot.pads[0].buttons & (SELECT | X), 0, 'host shortcut consumes the routed word, not real physical lifetime');
			};
			tick();
			for (const open of [true, false]) {
				button('select', true);
				tick();
				physical(SELECT);
				button('x', true);
				assert.equal(tick(), HostMenuInput.Inactive, 'the keyboard is a live overlay, not a paused core-options menu');
				physical(SELECT | X);
				assert.equal(keyboardVisible(), open);
				for (let frame = 0; frame < hostHz / 4; frame += 1) {
					tick();
					physical(SELECT | X);
					assert.equal(keyboardVisible(), open, 'a held opening/closing chord cannot retrigger the page');
				}
				if (releaseOrder !== 'simultaneous') {
					button(releaseOrder === 'x-first' ? 'x' : 'select', false);
					tick();
					physical(releaseOrder === 'x-first' ? SELECT : X);
					assert.equal(keyboardVisible(), open);
					for (let frame = 0; frame < hostHz / 4; frame += 1) {
						tick();
						physical(releaseOrder === 'x-first' ? SELECT : X);
					}
				}
				if (releaseOrder !== 'select-first') button('select', false);
				if (releaseOrder !== 'x-first') button('x', false);
				for (let frame = 0; frame < hostHz / 4; frame += 1) {
					tick();
					physical(0);
					assert.equal(keyboardVisible(), open);
				}
			}
			assert.deepEqual(visibilityChanges, [true, false], 'the keyboard owner publishes actual visibility transitions');
			button('a', true);
			tick();
			assert.equal(gamepad.physicalGamepadButtonsWord(), A);
			assert.equal(snapshot.pads[0].buttons, A, 'fresh gameplay input is not stuck under a released Select modifier');
			button('a', false);
			tick();
			assert.equal(snapshot.pads[0].buttons, 0);
		});
	}
}
