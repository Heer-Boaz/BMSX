import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserOnscreenGamepad, type OnscreenGamepadGeometry } from '../../hosts/browser/onscreen_gamepad';
import type { HostClock } from '../../hosts/common/clock';
import type { InputEventSink, InputSource } from '../../hosts/common/input/contracts';
import { Input } from '../../hosts/common/input/manager';
import { InputController } from '../../machine/ts/machine/devices/input/controller';
import { createInputControllerSnapshot, InputControllerSampleContext } from '../../machine/ts/machine/devices/input/contracts';
import type { SystemController } from '../../machine/ts/machine/devices/system/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { INP_CTRL_ARM, IO_INP_CTRL, IO_INP_PADS, IO_INP_PAD_BUTTONS_OFFSET } from '../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';

const geometry: OnscreenGamepadGeometry = {
	stickX: 100, stickY: 100, stickRadius: 50, stickDeadzoneRadius: 10,
	actions: [{ x: 300, y: 100, radius: 20, buttons: 1 }, { x: 350, y: 100, radius: 20, buttons: 2 }],
};

function createFixture() {
	let now = 0;
	const clock = { now: () => now } as HostClock;
	const pad = new BrowserOnscreenGamepad(clock);
	pad.setGeometry(geometry);
	const edges: Array<{ code: string; down: boolean; value: number; time: number; pressId: number }> = [];
	const sink: InputEventSink = {
		inputButton(_device, code, down, value, time, pressId) { edges.push({ code, down, value, time, pressId }); },
		inputAxis1() {}, inputAxis2() {}, cancelPointerButtons() {}, resetInput() {}, setSupervisorRequestLine() {}, connectInputDevice() {}, disconnectInputDevice() {},
	};
	const unsubscribe = pad.subscribe(sink);
	let views = 0;
	pad.subscribeView(() => { views += 1; });
	return { pad, edges, unsubscribe, advance() { now += 1; }, views: () => views };
}

test('virtual controller action leases preserve A+B in either acquisition and release order', () => {
	for (const first of [1, 2]) {
		for (const releaseFirst of [1, 2]) {
			const { pad, edges } = createFixture();
			const second = first === 1 ? 2 : 1;
			assert.equal(pad.beginContact(first, first === 1 ? 300 : 350, 100, true), true);
			assert.equal(pad.buttons, first);
			assert.equal(pad.beginContact(second, second === 1 ? 300 : 350, 100, true), true);
			assert.equal(pad.buttons, 3);
			assert.equal(pad.moveContact(first, -1000, -1000, true), true);
			assert.equal(pad.buttons, 3);
			assert.equal(pad.endContact(releaseFirst), true);
			assert.equal(pad.buttons, 3 & ~releaseFirst);
			assert.equal(pad.endContact(releaseFirst === 1 ? 2 : 1), true);
			assert.equal(pad.buttons, 0);
			assert.equal(edges.length, 4);
			for (const code of ['a', 'b']) {
				const pair = edges.filter(edge => edge.code === code);
				assert.deepEqual(pair.map(edge => edge.down), [true, false]);
				assert.equal(pair[0].pressId, pair[1].pressId);
			}
		}
	}
});

test('button aggregation retains more than 255 owners and reuses ended contact storage', () => {
	const { pad, edges } = createFixture();
	for (let id = 0; id < 300; id += 1) pad.beginContact(id, 300, 100, true);
	assert.equal(pad.buttons, 1);
	assert.equal(edges.length, 1);
	for (let id = 0; id < 299; id += 1) {
		pad.endContact(id);
		assert.equal(pad.buttons, 1);
	}
	pad.endContact(299);
	assert.equal(pad.buttons, 0);
	assert.equal(edges.length, 2);
	for (let id = 300; id < 600; id += 1) pad.beginContact(id, 300, 100, true);
	pad.cancelContacts();
	assert.equal(pad.buttons, 0);
	assert.deepEqual(edges.map(edge => edge.down), [true, false, true, false]);
});

test('stick owner survives slot swaps, outside-area dragging, neutral and busy contact release', () => {
	const { pad } = createFixture();
	pad.beginContact(1, 300, 100, true);
	pad.beginContact(2, 350, 100, true);
	pad.beginContact(3, 60, 100, true);
	assert.equal(pad.buttons, 0x4003);
	pad.beginContact(4, 100, 60, true); // Occupied-stick lease cannot contribute or later promote.
	pad.endContact(2); // Swap the busy contact into B's slot.
	pad.endContact(1); // Swap the owning stick into A's slot.
	assert.equal(pad.buttons, 0x4000);
	pad.moveContact(3, 600, 100, true);
	assert.equal(pad.buttons, 0x8000);
	assert.equal(pad.stickX, 1);
	assert.equal(pad.stickY, 0);
	pad.moveContact(3, 100, 100, true);
	assert.equal(pad.buttons, 0);
	assert.equal(pad.stickActive, true);
	pad.moveContact(4, -1000, -1000, true);
	assert.equal(pad.buttons, 0);
	pad.endContact(3);
	assert.equal(pad.stickActive, false);
	pad.moveContact(4, 60, 100, true);
	assert.equal(pad.buttons, 0);
	pad.beginContact(5, 100, 60, true);
	assert.equal(pad.buttons, 0x1000);
	pad.endContact(4);
	assert.equal(pad.buttons, 0x1000);
	pad.endContact(5);
	assert.equal(pad.buttons, 0);
});

test('stick sectors include all eight directions, neutral deadzone and diagonal equality', () => {
	const { pad } = createFixture();
	pad.beginContact(1, 100, 100, true);
	for (const [dx, dy, bits] of [
		[0, -40, 0x1000], [40, -40, 0x9000], [40, 0, 0x8000], [40, 40, 0xa000],
		[0, 40, 0x2000], [-40, 40, 0x6000], [-40, 0, 0x4000], [-40, -40, 0x5000],
		[10, 0, 0], [0, 10, 0], [0, 0, 0],
	]) {
		pad.moveContact(1, 100 + dx, 100 + dy, true);
		assert.equal(pad.buttons, bits, `direction ${dx},${dy}`);
		assert.ok(pad.stickX * pad.stickX + pad.stickY * pad.stickY <= 1 + 1e-12);
	}
	pad.moveContact(1, 140, 100 + 40 * (Math.SQRT2 - 1), true);
	assert.equal(pad.buttons, 0xa000);
});

test('inactive native leases gate contributions but preserve fixed assignments and stick ownership', () => {
	const { pad } = createFixture();
	pad.beginContact(1, 300, 100, false);
	assert.equal(pad.buttons, 0);
	pad.moveContact(1, 350, 100, true);
	assert.equal(pad.buttons, 1);
	pad.moveContact(1, 350, 100, false);
	assert.equal(pad.buttons, 0);
	pad.moveContact(1, 350, 100, true);
	assert.equal(pad.buttons, 1);
	pad.beginContact(2, 60, 100, false);
	pad.beginContact(3, 100, 60, true);
	assert.equal(pad.buttons, 1);
	pad.moveContact(2, 60, 100, true);
	assert.equal(pad.buttons, 0x4001);
	pad.endContact(2);
	pad.moveContact(3, 100, 60, true);
	assert.equal(pad.buttons, 1);
});

test('action overlap ORs bits, action wins over stick and a miss never acquires on movement', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, actions: [{ x: 100, y: 100, radius: 20, buttons: 1 }, { x: 100, y: 100, radius: 20, buttons: 2 }] });
	assert.equal(pad.beginContact(1, 100, 100, true), true);
	assert.equal(pad.buttons, 3);
	assert.equal(pad.stickActive, false);
	assert.equal(pad.beginContact(2, 600, 600, true), false);
	assert.equal(pad.moveContact(2, 100, 100, true), false);
	assert.equal(pad.endContact(2), false);
	assert.equal(pad.buttons, 3);
});

test('unchanged action movement is silent and layout replacement does not retarget retained leases', () => {
	const { pad, edges, views } = createFixture();
	pad.beginContact(1, 300, 100, true);
	const before = views();
	for (let move = 0; move < 10000; move += 1) pad.moveContact(1, -move, move, true);
	assert.equal(views(), before);
	assert.equal(edges.length, 1);
	pad.setGeometry({ ...geometry, actions: [{ x: 300, y: 100, radius: 20, buttons: 2 }] });
	pad.moveContact(1, 300, 100, true);
	assert.equal(pad.buttons, 1);
	pad.beginContact(2, 300, 100, true);
	assert.equal(pad.buttons, 3);
});

test('teardown publishes matching release while sink is live and fresh subscriptions have fresh press IDs', () => {
	const { pad, edges, unsubscribe } = createFixture();
	pad.beginContact(1, 300, 100, true);
	unsubscribe();
	assert.equal(pad.buttons, 0);
	assert.equal(edges[0].pressId, edges[1].pressId);
	const more: number[] = [];
	pad.subscribe({ inputButton(_device, _code, down, _value, _time, pressId) { if (down) more.push(pressId); } } as InputEventSink);
	pad.beginContact(2, 300, 100, true);
	assert.ok(more[0] > edges[0].pressId);
});

test('virtual device reaches real common input and armed ICU raw words without changing sample cadence', () => {
	const clock = { now: () => 0 } as HostClock;
	const pad = new BrowserOnscreenGamepad(clock);
	pad.setGeometry(geometry);
	const source: InputSource = { devices: () => [pad], subscribe: sink => pad.subscribe(sink) };
	const input = new Input(clock, source, pad.gamepadIndex);
	const snapshot = createInputControllerSnapshot();
	const memory = new Memory({ systemRom: new Uint8Array(), cartridgeSlots: [null, null] }, PSX_MACHINE_SPEC.ramBytes);
	const supervisorPort = { supervisorContextActive: () => false, requestSupervisorLineEdge() {} } as SystemController;
	const controller = new InputController(memory, input, supervisorPort);
	controller.reset();
	let cycle = 0;
	const sample = () => {
		input.pollInput();
		input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
		memory.writeMappedWord(IO_INP_CTRL, INP_CTRL_ARM);
		controller.onVblankEdge(++cycle);
		assert.equal(memory.readIoU32(IO_INP_PADS + IO_INP_PAD_BUTTONS_OFFSET), snapshot.pads[0].buttons);
		return snapshot.pads[0].buttons;
	};
	pad.beginContact(1, 300, 100, true);
	assert.equal(sample(), 1);
	pad.beginContact(2, 350, 100, true);
	assert.equal(sample(), 3);
	pad.beginContact(3, 60, 100, true);
	assert.equal(sample(), 0x4003);
	pad.cancelContacts();
	pad.beginContact(4, 300, 100, true);
	pad.endContact(4);
	assert.equal(sample(), 0, 'complete between-sample tap is not stretched into guest state');
	input.dispose();
});
