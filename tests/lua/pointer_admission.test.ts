import assert from 'node:assert/strict';
import test from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { InputChannel } from '../../hosts/common/input/channel';
import { PointerButton, type PointerInputEvent } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { RemoteInput } from '../../hosts/common/input/remote';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';
import {
	createInputControllerSnapshot, InputControllerSampleContext,
	INP_POINTER_BUTTON_AUX, INP_POINTER_BUTTON_PRIMARY, INP_POINTER_BUTTON_SECONDARY,
} from '../../machine/ts/machine/devices/input/contracts';
import { encodeSignedFix16 } from '../../machine/ts/machine/common/numeric';

function occurrence(buttons: number, pressedButtons = 0, releasedButtons = 0, cancelledButtons = 0): PointerInputEvent {
	return { x: 500, y: 400, buttons, pressedButtons, releasedButtons, cancelledButtons,
		modifiers: KeyModifier.none, spaceDown: false, timestamp: 0 };
}

test('routed pointer recipients are independent of keyboard focus and physical sampled holds', t => {
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	const first = new InputChannel(input), second = new InputChannel(input);
	t.after(() => { first.dispose(); second.dispose(); input.dispose(); });
	input.setPointerAdmissionMode('routed');
	input.inputButton('keyboard:0', 'KeyA', true, 1, 0, 1);
	input.inputButton('pointer:0', 'pointer_primary', true, 1, 0, 2);
	input.inputAxis2('pointer:0', 'pointer_attachment_position', 900, 700, 0);
	input.inputAxis1('pointer:0', 'pointer_attachment_wheel', 8, 0);
	input.guestInputRecipient = second;
	first.pointerContribution.admit(occurrence(PointerButton.Secondary, PointerButton.Secondary), 12.5, 20.25);
	second.pointerContribution.admit(occurrence(0), 5, 6);
	input.pollInput();
	const primarySample = createInputControllerSnapshot(), firstSample = createInputControllerSnapshot(), secondSample = createInputControllerSnapshot();
	input.sampleInputControllerSnapshot(primarySample, InputControllerSampleContext.Normal);
	first.sampleInputControllerSnapshot(firstSample); second.sampleInputControllerSnapshot(secondSample);
	const usage = hidKeyUsageForCode('KeyA'), word = usage >>> 5, mask = 1 << (usage & 31);
	assert.equal(firstSample.pointerButtons, 1 << INP_POINTER_BUTTON_SECONDARY);
	assert.equal(firstSample.pointerXQ16, encodeSignedFix16(12.5));
	assert.equal(firstSample.pointerYQ16, encodeSignedFix16(20.25));
	assert.equal(firstSample.keyWords[word] & mask, 0);
	assert.notEqual(secondSample.keyWords[word] & mask, 0);
	assert.equal(secondSample.pointerButtons, 0, 'a sampled UI-held press never becomes an admitted guest press');
	assert.equal(secondSample.pointerXQ16, encodeSignedFix16(5));
	assert.equal(secondSample.pointerWheelQ16, 0);
	assert.equal(primarySample.pointerButtons, 0);
	input.guestInputRecipient = null;
	first.sampleInputControllerSnapshot(firstSample);
	assert.equal(firstSample.pointerButtons, 1 << INP_POINTER_BUTTON_SECONDARY, 'keyboard focus does not terminate an admitted pointer gesture');
	input.sampleInputControllerSnapshot(primarySample, InputControllerSampleContext.Supervisor);
	assert.equal(primarySample.pointerButtons, 1 << INP_POINTER_BUTTON_PRIMARY);
	assert.equal(primarySample.pointerXQ16, encodeSignedFix16(900));
	assert.notEqual(primarySample.keyWords[word] & mask, 0);
});

test('admission maps all UI button bits and cancellation never reimports a held physical level', t => {
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	t.after(() => input.dispose());
	input.setPointerAdmissionMode('routed');
	const snapshot = createInputControllerSnapshot();
	input.pointerContribution.admit(occurrence(31, 31), 1, 2);
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 31);
	input.pointerContribution.admit(occurrence(29, 0, PointerButton.Secondary), 2, 3);
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 31 & ~(1 << INP_POINTER_BUTTON_SECONDARY));
	input.pointerContribution.admit(occurrence(25, 0, 0, PointerButton.Auxiliary), 3, 4);
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 31 & ~((1 << INP_POINTER_BUTTON_SECONDARY) | (1 << INP_POINTER_BUTTON_AUX)));
	input.pointerContribution.cancel();
	input.pointerContribution.admit(occurrence(25), 4, 5);
	input.pollInput();
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 0);
	assert.equal(snapshot.pointerXQ16, encodeSignedFix16(4));
});

test('recipient wheel publication occurs once per host poll and sampling does not consume it', t => {
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	const first = new InputChannel(input), second = new InputChannel(input);
	t.after(() => { first.dispose(); second.dispose(); input.dispose(); });
	input.setPointerAdmissionMode('routed');
	first.pointerContribution.admit(occurrence(0), 12, 34);
	first.pointerContribution.admitWheel(13, 35, 0.5);
	second.pointerContribution.admitWheel(21, 43, -2);
	first.pointerContribution.admitWheel(14, 36, 0.25);
	input.pollInput();
	const snapshot = createInputControllerSnapshot();
	for (let read = 0; read < 3; read += 1) {
		first.sampleInputControllerSnapshot(snapshot);
		assert.equal(snapshot.pointerWheelQ16, encodeSignedFix16(0.75));
		assert.equal(snapshot.pointerXQ16, encodeSignedFix16(14));
		second.sampleInputControllerSnapshot(snapshot);
		assert.equal(snapshot.pointerWheelQ16, encodeSignedFix16(-2));
	}
	input.pollInput();
	first.sampleInputControllerSnapshot(snapshot);
	assert.equal(snapshot.pointerWheelQ16, 0);
	assert.equal(snapshot.pointerXQ16, encodeSignedFix16(14), 'an idle recipient retains its last admitted position');
	first.pointerContribution.admitWheel(15, 37, 1);
	first.pointerContribution.cancel();
	input.pollInput(); first.sampleInputControllerSnapshot(snapshot);
	assert.equal(snapshot.pointerWheelQ16, 0, 'cancelled pending wheel work is not published');
});

test('retiring a pointer recipient cancels its own contribution without stealing another recipient', t => {
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	const first = new InputChannel(input), second = new InputChannel(input);
	t.after(() => { second.dispose(); input.dispose(); });
	input.setPointerAdmissionMode('routed');
	input.guestInputRecipient = second;
	first.pointerContribution.admit(occurrence(1, 1), 1, 2);
	second.pointerContribution.admit(occurrence(4, 4), 3, 4);
	first.pointerContribution.admitWheel(1, 2, 3);
	first.dispose();
	assert.equal(input.guestInputRecipient, second);
	input.pollInput();
	const snapshot = createInputControllerSnapshot();
	first.sampleInputControllerSnapshot(snapshot);
	assert.equal(snapshot.pointerButtons, 0);
	assert.equal(snapshot.pointerWheelQ16, 0);
	second.sampleInputControllerSnapshot(snapshot);
	assert.equal(snapshot.pointerButtons, 1 << INP_POINTER_BUTTON_AUX);
});

test('leaving routed mode drains a Studio-held physical press before standalone input resumes', t => {
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	t.after(() => input.dispose());
	const remote = new RemoteInput(input, new VirtualHeadlessClock());
	const snapshot = createInputControllerSnapshot();
	input.setPointerAdmissionMode('routed');
	remote.apply([{ type: 'button', button: 'primary', down: true }]);
	input.pollInput();
	input.setPointerAdmissionMode('physical');
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 0);
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Supervisor);
	assert.equal(snapshot.pointerButtons, 1 << INP_POINTER_BUTTON_PRIMARY, 'admission does not rewrite physical history');
	remote.apply([{ type: 'button', button: 'secondary', down: true }]);
	input.pollInput(); input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 0, 'additional buttons still belong to the interrupted gesture');
	remote.apply([{ type: 'button', button: 'primary', down: false }, { type: 'button', button: 'primary', down: true }]);
	input.pollInput(); input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 0, 'the whole hold drains, not just its initiating button');
	remote.apply([{ type: 'button', button: 'secondary', down: false }, { type: 'button', button: 'primary', down: false },
		{ type: 'button', button: 'primary', down: true }]);
	input.pollInput(); input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 1 << INP_POINTER_BUTTON_PRIMARY);
});

test('leaving routed mode excludes old attachment wheel work but preserves subsequent player wheel and physical history', t => {
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	t.after(() => input.dispose());
	const snapshot = createInputControllerSnapshot();
	input.setPointerAdmissionMode('routed');
	input.inputAxis1('pointer:0', 'pointer_attachment_wheel', 2, 0);
	input.pollInput();
	input.inputAxis1('pointer:0', 'pointer_attachment_wheel', 3, 0);
	input.setPointerAdmissionMode('physical');
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerWheelQ16, 0, 'published Studio wheel is not replayed into the standalone player');
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Supervisor);
	assert.equal(snapshot.pointerWheelQ16, encodeSignedFix16(2));
	input.inputAxis1('pointer:0', 'pointer_attachment_wheel', 0.5, 0);
	input.pollInput(); input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerWheelQ16, encodeSignedFix16(0.5), 'only post-transition wheel is admitted');
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Supervisor);
	assert.equal(snapshot.pointerWheelQ16, encodeSignedFix16(3.5), 'physical producer history remains intact');
});

test('leaving routed mode cannot replay a previous sampled button after its physical release', t => {
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	t.after(() => input.dispose());
	input.setPointerAdmissionMode('routed');
	input.inputButton('pointer:0', 'pointer_primary', true, 1, 0, 1);
	input.pollInput();
	input.inputButton('pointer:0', 'pointer_primary', false, 0, 1, 1);
	input.setPointerAdmissionMode('physical');
	const snapshot = createInputControllerSnapshot();
	input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 0);
	input.inputButton('pointer:0', 'pointer_primary', true, 1, 2, 2);
	input.pollInput(); input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
	assert.equal(snapshot.pointerButtons, 1 << INP_POINTER_BUTTON_PRIMARY, 'a fresh post-transition press is eligible');
});
