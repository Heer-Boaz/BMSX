import assert from 'node:assert/strict';
import test from 'node:test';
import { InputChannel } from '../../hosts/common/input/channel';
import { Input } from '../../hosts/common/input/manager';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { createInputControllerSnapshot, InputControllerSampleContext } from '../../machine/ts/machine/devices/input/contracts';
import { GameInputControl } from '../../ide/workbench/contrib/game_view/game_input';
import { inputFocus } from '../../ide/input/focus';
import { createFrameRuntime } from '../helpers/frame_runtime';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { RuntimeTransport } from '../../ide/runtime/transport';
import { FrameBitmap } from '../../hosts/common/frame_bitmap';

test('focused physical recipients are exclusive; the primary supervisor and host keys remain independent', t => {
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	t.after(() => input.dispose());
	const first = new InputChannel(input), second = new InputChannel(input);
	const primarySample = createInputControllerSnapshot(), firstSample = createInputControllerSnapshot(), secondSample = createInputControllerSnapshot();
	input.inputButton('keyboard:0', 'KeyA', true, 1, 0, 1); input.pollInput();
	const usage = hidKeyUsageForCode('KeyA'), word = usage >>> 5, mask = 1 << (usage & 31);
	for (const selected of [input, first, second, null]) {
		input.guestInputRecipient = selected;
		input.sampleInputControllerSnapshot(primarySample, InputControllerSampleContext.Normal);
		first.sampleInputControllerSnapshot(firstSample); second.sampleInputControllerSnapshot(secondSample);
		assert.equal((primarySample.keyWords[word] & mask) !== 0, selected === input);
		assert.equal((firstSample.keyWords[word] & mask) !== 0, selected === first);
		assert.equal((secondSample.keyWords[word] & mask) !== 0, selected === second);
		input.sampleInputControllerSnapshot(primarySample, InputControllerSampleContext.Supervisor);
		assert.notEqual(primarySample.keyWords[word] & mask, 0);
		assert.equal(input.getPlayerInput(1).inputHandlers.keyboard!.getKeyState('KeyA').pressed, true);
	}
	input.setProgrammaticSupervisorRequestLine(true);
	assert.equal(input.supervisorRequestLineHigh(), true);
	assert.equal(first.supervisorRequestLineHigh(), false); assert.equal(second.supervisorRequestLineHigh(), false);
	input.guestInputRecipient = first;
	second.dispose(); assert.equal(input.guestInputRecipient, first, 'retiring another session cannot steal input');
	first.dispose(); assert.equal(input.guestInputRecipient, null);
	input.sampleInputControllerSnapshot(primarySample, InputControllerSampleContext.Normal);
	assert.equal(primarySample.keyWords[word] & mask, 0, 'a retired recipient does not fall back to the primary game');
});

test('a game viewport focus attachment names its recipient and retains one bounds binding across layouts', t => {
	const f = createRuntimeInspectionFixture(createFrameRuntime(), createScenarioTestSourceState([]));
	const input = f.input;
	const transport = new RuntimeTransport(f.runtime, f.execution, f.rewind, f.frameNavigation, () => true);
	t.after(() => { f.frameNavigation.dispose(); f.presenter.dispose(); });
	const channel = new InputChannel(input), parent = inputFocus.createTarget();
	const frames = new FrameBitmap();
	frames.publish(new Uint8Array(4), 1, 1, { presentationSequence: 0, cycles: 0, videoTick: 0 });
	const presentation = { kind: 'offscreen', frames } as const;
	const view = new GameInputControl(parent, channel, presentation, transport);
	t.after(() => { view.dispose(); frames.dispose(); channel.dispose(); inputFocus.setTarget(null); input.dispose(); });
	const bounds = { left: 1, top: 2, right: 100, bottom: 80 };
	view.setInput(bounds); view.focusTarget.focus();
	const binding = inputFocus.target!.guestInput!;
	assert.equal(binding.recipient, channel); assert.equal(binding.bounds, bounds);
	assert.equal(binding.presentation, presentation);
	for (let layout = 0; layout < 100; layout++) view.setInput(bounds);
	assert.equal(inputFocus.target!.guestInput, binding, 'idle/layout updates allocate no focus attachment');
	view.clearInput(); assert.equal(inputFocus.target, parent); assert.equal(view.focusTarget.guestInput, undefined);
	view.setInput(bounds); view.focusTarget.focus(); assert.equal(inputFocus.target!.guestInput, binding);
	view.dispose(); assert.equal(inputFocus.target, parent);
	inputFocus.setTarget(view.focusTarget); assert.equal(inputFocus.target, parent, 'retired viewports are not focus destinations');
});
