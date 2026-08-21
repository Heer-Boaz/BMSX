import assert from 'node:assert/strict';
import test from 'node:test';

import type { HostClock } from '../../hosts/common/clock';
import { HostMenuInput, HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import type { InputSource } from '../../hosts/common/input/contracts';
import { Input } from '../../hosts/common/input/manager';
import { createInputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';

function createInput(): { input: Input; setTime(time: number): void } {
	let currentTime = 0;
	const clock = {
		now: () => currentTime,
	} as HostClock;
	const source: InputSource = {
		devices: () => [],
		subscribe: () => () => {},
	};
	return {
		input: new Input(clock, source, -1),
		setTime: time => { currentTime = time; },
	};
}

function keyWordContains(words: Uint32Array, code: string): boolean {
	const usage = hidKeyUsageForCode(code);
	return (words[usage >>> 5] & (1 << (usage & 31))) !== 0;
}

test('mapped host chords consume their physical keys from later host and guest owners', () => {
	const { input, setTime } = createInput();
	let chordCount = 0;
	let releaseCount = 0;
	const dispose = input.getGlobalShortcutRegistry().registerControlChord(
		1,
		['select', 'rb'],
		() => { chordCount += 1; },
		() => { releaseCount += 1; },
	);

	setTime(10);
	input.inputButton('keyboard:0', 'Backspace', true, 1, 10, 1);
	input.inputButton('keyboard:0', 'ShiftRight', true, 1, 10, 2);
	input.pollInput();

	const keyboard = input.getPlayerInput(1).inputHandlers.keyboard!;
	assert.equal(chordCount, 1);
	assert.equal(keyboard.getButtonState('select').consumed, true);
	assert.equal(keyboard.getButtonState('rb').consumed, true);
	assert.equal(keyboard.getKeyState('Backspace').consumed, true);
	assert.equal(keyboard.getKeyState('ShiftRight').consumed, true);

	const snapshot = createInputControllerSnapshot();
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyWordContains(snapshot.keyWords, 'Backspace'), false);
	assert.equal(keyWordContains(snapshot.keyWords, 'ShiftRight'), false);

	setTime(20);
	input.inputButton('keyboard:0', 'Backspace', false, 0, 20, 1);
	input.inputButton('keyboard:0', 'ShiftRight', false, 0, 20, 2);
	input.pollInput();
	assert.equal(releaseCount, 1);
	assert.equal(input.getPlayerInput(1).getRawButtonState('Backspace', 'keyboard').consumed, false);

	setTime(30);
	input.inputButton('keyboard:0', 'Backspace', true, 1, 30, 3);
	input.pollInput();
	input.sampleInputControllerSnapshot(snapshot);
	assert.equal(keyWordContains(snapshot.keyWords, 'Backspace'), true);
	assert.equal(keyWordContains(snapshot.keyWords, 'ShiftRight'), false);
	assert.equal(keyboard.getKeyState('Backspace').consumed, false);

	dispose();
	input.dispose();
});

test('host key repeat survives frame-local key consumption', () => {
	const { input, setTime } = createInput();
	const player = input.getPlayerInput(1);
	const keyboard = player.inputHandlers.keyboard!;

	input.inputButton('keyboard:0', 'KeyZ', true, 1, 0, 1);
	input.pollInput();
	assert.equal(player.buttonRepeatEdge('KeyZ', 'keyboard'), true);
	keyboard.consumeKey('KeyZ');

	for (let frame = 1; frame < 15; frame += 1) {
		setTime(frame * (1000 / 60));
		input.pollInput();
		assert.equal(player.buttonRepeatEdge('KeyZ', 'keyboard'), false);
		keyboard.consumeKey('KeyZ');
	}
	setTime(15 * (1000 / 60));
	input.pollInput();
	assert.equal(player.buttonRepeatEdge('KeyZ', 'keyboard'), true);
	input.dispose();
});

test('quick menu accepts navigation after consuming its opening frame', () => {
	const { input, setTime } = createInput();
	const presenter = {
		show_resource_usage_gizmo: false,
	} as VideoPresenter;
	const menu = new HostOverlayMenu(presenter, {} as Runtime, input);

	setTime(10);
	input.inputButton('keyboard:0', 'Enter', true, 1, 10, 1);
	input.inputButton('keyboard:0', 'Backspace', true, 1, 10, 2);
	input.pollInput();
	assert.equal(menu.tickInput(), HostMenuInput.Active);

	setTime(20);
	input.inputButton('keyboard:0', 'Enter', false, 0, 20, 1);
	input.inputButton('keyboard:0', 'Backspace', false, 0, 20, 2);
	input.pollInput();
	assert.equal(menu.tickInput(), HostMenuInput.Active);

	setTime(30);
	input.inputButton('keyboard:0', 'ArrowRight', true, 1, 30, 3);
	input.pollInput();
	assert.equal(menu.tickInput(), HostMenuInput.Active);
	assert.equal(presenter.show_resource_usage_gizmo, true);
	input.dispose();
});
