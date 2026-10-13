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
	padX: 100, padY: 100, padRadius: 50, padNeutralRadius: 9,
	buttonGroups: [{ x: 325, y: 100, radius: 50,
		actions: [{ x: 300, y: 100, radius: 20, buttons: 1 }, { x: 350, y: 100, radius: 20, buttons: 2 }],
	}],
};
const face = geometry.buttonGroups[0];

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

test('a single contact slides from A through A+B to B and releases outside finite buttons', () => {
	const { pad, edges } = createFixture();
	assert.equal(pad.beginContact(1, 300, 100, 14, 14, true), true);
	assert.equal(pad.buttons, 1);
	assert.equal(pad.moveContact(1, 325, 100, 14, 14, true), true);
	assert.equal(pad.buttons, 3, 'the thumb envelope intersects both adjacent buttons');
	assert.equal(pad.moveContact(1, 350, 100, 14, 14, true), true);
	assert.equal(pad.buttons, 2);
	assert.equal(pad.moveContact(1, -1000, -1000, 14, 14, true), true);
	assert.equal(pad.buttons, 0);
	assert.equal(pad.ownsContact(1), true, 'an empty contribution does not end controller ownership');
	pad.moveContact(1, 325, 100, 14, 14, true);
	assert.equal(pad.buttons, 3, 'the same held contact can return to buttons');
	pad.endContact(1);
	assert.equal(pad.buttons, 0);
	assert.equal(pad.ownsContact(1), false);
	for (const code of ['a', 'b']) {
		const pairs = edges.filter(edge => edge.code === code);
		assert.deepEqual(pairs.map(edge => edge.down), [true, false, true, false]);
		assert.equal(pairs[0].pressId, pairs[1].pressId);
		assert.equal(pairs[2].pressId, pairs[3].pressId);
		assert.notEqual(pairs[0].pressId, pairs[2].pressId);
	}
});

test('contact half-extents reach adjacent circles independently of a point coordinate', () => {
	const { pad } = createFixture();
	assert.equal(pad.beginContact(1, 325, 100, 0, 0, true), true, 'the neutral face deck owns a point in the button gap');
	assert.equal(pad.buttons, 0);
	pad.endContact(1);
	assert.equal(pad.beginContact(2, 325, 100, 8, 1, true), true);
	assert.equal(pad.buttons, 3);
	pad.moveContact(2, 325, 100, 0, 0, true);
	assert.equal(pad.buttons, 0, 'changing the footprint alone changes contributions');
	pad.moveContact(2, 325, 100, 8, 1, true);
	assert.equal(pad.buttons, 3);
});

test('elliptical skin contact respects curved boundaries and inclusive circle edges', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, buttonGroups: [{ ...face, actions: [face.actions[0]] }] });
	assert.equal(pad.beginContact(1, 330, 100, 10, 0, true), true, 'the contact reaches the circle at one edge');
	assert.equal(pad.buttons, 1);
	pad.moveContact(1, 329, 121, 10, 1, true);
	assert.equal(pad.buttons, 0, 'overlapping circle bounds does not hit a rounded corner');
	pad.moveContact(1, 329, 110, 10, 10, true);
	assert.equal(pad.buttons, 0, 'the filled contact bounding rectangle invents an intersection here');
	pad.moveContact(1, 328, 108, 10, 10, true);
	assert.equal(pad.buttons, 1);
});

test('all action intersections contribute, not only the nearest or initially touched button', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, buttonGroups: [{ ...face, y: 125, radius: 80, actions: [
		...face.actions,
		{ x: 300, y: 150, radius: 20, buttons: 4 },
		{ x: 350, y: 150, radius: 20, buttons: 8 },
	] }] });
	assert.equal(pad.beginContact(1, 325, 125, 14, 14, true), true);
	assert.equal(pad.buttons, 0, 'a 28px circular thumb does not reach these four circle corners');
	pad.moveContact(1, 325, 125, 16, 16, true);
	assert.equal(pad.buttons, 15);
	pad.moveContact(1, 300, 100, 14, 14, true);
	assert.equal(pad.buttons, 1);
	pad.endContact(1);
	assert.equal(pad.buttons, 0);
});

test('independent contacts preserve A+B in either acquisition and release order', () => {
	for (const first of [1, 2]) {
		for (const releaseFirst of [1, 2]) {
			const { pad, edges } = createFixture();
			const second = first === 1 ? 2 : 1;
			assert.equal(pad.beginContact(first, first === 1 ? 300 : 350, 100, 0, 0, true), true);
			assert.equal(pad.buttons, first);
			assert.equal(pad.beginContact(second, second === 1 ? 300 : 350, 100, 0, 0, true), true);
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

test('overlapping fingers retain each aggregate button until its last contributing contact leaves', () => {
	const { pad, edges } = createFixture();
	pad.beginContact(1, 325, 100, 14, 14, true);
	pad.beginContact(2, 300, 100, 0, 0, true);
	assert.equal(pad.buttons, 3);
	assert.equal(edges.length, 2);
	pad.moveContact(1, 350, 100, 14, 14, true);
	assert.equal(pad.buttons, 3, 'A remains contributed by the other finger');
	assert.equal(edges.length, 2);
	pad.endContact(2);
	assert.equal(pad.buttons, 2);
	pad.beginContact(3, 350, 100, 0, 0, true);
	pad.endContact(1);
	assert.equal(pad.buttons, 2, 'B remains contributed by the third finger');
	pad.endContact(3);
	assert.equal(pad.buttons, 0);
	assert.deepEqual(edges.map(edge => [edge.code, edge.down]), [['a', true], ['b', true], ['a', false], ['b', false]]);
});

test('digital pad owns its neutral center and changes immediately through every cardinal and diagonal', () => {
	const { pad } = createFixture();
	assert.equal(pad.beginContact(1, 100, 100, 14, 14, true), true);
	assert.equal(pad.buttons, 0, 'the neutral gap is wider than the thumb envelope');
	assert.equal(pad.ownsContact(1), true);
	for (const [dx, dy, bits] of [
		[0, -40, 0x1000], [25, -25, 0x9000], [40, 0, 0x8000], [25, 25, 0xa000],
		[0, 40, 0x2000], [-25, 25, 0x6000], [-40, 0, 0x4000], [-25, -25, 0x5000],
		[0, 0, 0],
	]) {
		pad.moveContact(1, 100 + dx, 100 + dy, 14, 14, true);
		assert.equal(pad.buttons, bits, `direction at ${dx},${dy}`);
	}
	pad.endContact(1);
	assert.equal(pad.buttons, 0);
});

test('rolling contact crosses overlapping digital direction regions without traversing the center', () => {
	const { pad } = createFixture();
	pad.beginContact(1, 135, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x8000);
	pad.moveContact(1, 125, 95, 14, 14, true);
	assert.equal(pad.buttons, 0x8000);
	pad.moveContact(1, 125, 89, 14, 14, true);
	assert.equal(pad.buttons, 0x9000, 'the rocker enters the shared right/up region');
	pad.moveContact(1, 100, 65, 14, 14, true);
	assert.equal(pad.buttons, 0x1000);
});

test('rapid digital direction jumps have no intermediate analog or neutral state', () => {
	const { pad, edges, advance } = createFixture();
	pad.beginContact(1, 60, 100, 0, 0, true);
	advance();
	pad.moveContact(1, 140, 100, 0, 0, true);
	assert.equal(pad.buttons, 0x8000);
	assert.deepEqual(edges.map(edge => [edge.code, edge.down, edge.time]), [
		['left', true, 0], ['left', false, 1], ['right', true, 1],
	]);
	pad.moveContact(1, 100, 60, 0, 0, true);
	assert.equal(pad.buttons, 0x1000);
});

test('multiple directional contacts contribute independently and survive contact-slot swaps', () => {
	const { pad } = createFixture();
	pad.beginContact(1, 300, 100, 0, 0, true);
	pad.beginContact(2, 100, 60, 0, 0, true);
	pad.beginContact(3, 140, 100, 0, 0, true);
	pad.beginContact(4, 100, 60, 0, 0, true);
	assert.equal(pad.buttons, 0x9001);
	pad.endContact(1); // Move the second upward contributor into the first slot.
	pad.endContact(2);
	assert.equal(pad.buttons, 0x9000);
	pad.moveContact(4, 100, 140, 0, 0, true);
	assert.equal(pad.buttons, 0xa000);
	pad.endContact(3);
	assert.equal(pad.buttons, 0x2000);
	pad.endContact(4);
	assert.equal(pad.buttons, 0);
});

test('a contact rolls within its physical component without spilling into another deck', () => {
	const { pad } = createFixture();
	pad.beginContact(1, 300, 100, 14, 14, true);
	pad.moveContact(1, 140, 100, 14, 14, true);
	assert.equal(pad.buttons, 0, 'a face-deck contact does not turn into a pad contact');
	pad.moveContact(1, 600, 100, 14, 14, true);
	assert.equal(pad.buttons, 0);
	assert.equal(pad.ownsContact(1), true);
	pad.moveContact(1, 350, 100, 14, 14, true);
	assert.equal(pad.buttons, 2);
	pad.moveContact(1, 100, 100, 14, 14, true);
	assert.equal(pad.buttons, 0);
	assert.equal(pad.ownsContact(1), true);
	pad.endContact(1);
	pad.beginContact(2, 140, 100, 14, 14, true);
	pad.moveContact(2, 350, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x8000, 'a held rocker continues outside without pressing a face button');
	pad.moveContact(2, 100, 60, 14, 14, true);
	assert.equal(pad.buttons, 0x1000, 'outside capture does not freeze its direction');
});

test('skin spill cannot press a secondary switch while a pad contact keeps its component lease', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, buttonGroups: [{ x: 180, y: 100, radius: 20,
		actions: [{ x: 180, y: 100, radius: 20, buttons: 0x100 }] }] });
	pad.beginContact(1, 145, 100, 30, 30, true);
	assert.equal(pad.buttons, 0x8000);
	pad.beginContact(2, 180, 100, 40, 40, true);
	assert.equal(pad.buttons, 0x8100, 'a separate finger directly on the switch remains independent despite a broad footprint');
	pad.endContact(1);
	assert.equal(pad.buttons, 0x100);
});

test('a miss never acquires on movement and an ended contact cannot be revived', () => {
	const { pad } = createFixture();
	assert.equal(pad.beginContact(1, 600, 600, 14, 14, true), false);
	assert.equal(pad.ownsContact(1), false);
	assert.equal(pad.moveContact(1, 300, 100, 14, 14, true), false);
	assert.equal(pad.endContact(1), false);
	pad.beginContact(2, 300, 100, 14, 14, true);
	pad.endContact(2);
	assert.equal(pad.moveContact(2, 350, 100, 14, 14, true), false);
	assert.equal(pad.buttons, 0);
});

test('inactive contacts retain the controller route but activation uses their current contact sample', () => {
	const { pad } = createFixture();
	assert.equal(pad.beginContact(1, 300, 100, 14, 14, false), true);
	assert.equal(pad.buttons, 0);
	assert.equal(pad.ownsContact(1), true);
	pad.moveContact(1, 350, 100, 14, 14, true);
	assert.equal(pad.buttons, 2);
	pad.moveContact(1, 60, 100, 14, 14, false);
	assert.equal(pad.buttons, 0);
	pad.moveContact(1, 60, 100, 14, 14, true);
	assert.equal(pad.buttons, 0, 'activation does not migrate the face contact to a different component');
	pad.beginContact(2, 100, 100, 14, 14, false);
	pad.moveContact(2, 60, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x4000);
	pad.moveContact(1, 60, 100, 14, 14, false);
	pad.moveContact(2, 60, 100, 14, 14, false);
	pad.setGeometry(geometry);
	assert.equal(pad.buttons, 0, 'layout does not activate an inactive contact');
});

test('layout admission is silent and the next physical sample uses its new geometry', () => {
	const { pad } = createFixture();
	pad.beginContact(1, 325, 100, 14, 14, true);
	assert.equal(pad.buttons, 3);
	pad.setGeometry({ ...geometry, buttonGroups: [{ ...face, actions: [{ x: 339, y: 100, radius: 0, buttons: 4 }] }] });
	assert.equal(pad.buttons, 3, 'layout is not a contact event');
	pad.moveContact(1, 325, 100, 14, 14, true);
	assert.equal(pad.buttons, 4, 'a new sample applies the updated geometry even at identical coordinates');
	pad.setGeometry({ ...geometry, buttonGroups: [{ ...face, actions: [{ x: 340, y: 100, radius: 0, buttons: 4 }] }] });
	assert.equal(pad.buttons, 4);
	pad.moveContact(1, 325, 100, 14, 14, true);
	assert.equal(pad.buttons, 0, 'a native sample outside the moved button releases its contribution');
	assert.equal(pad.ownsContact(1), true);
	pad.setGeometry(geometry);
	assert.equal(pad.buttons, 0);
	pad.moveContact(1, 325, 100, 14, 14, true);
	assert.equal(pad.buttons, 3);
});

test('contact-slot removal retains the swapped component and geometry revision', () => {
	const { pad } = createFixture();
	pad.beginContact(1, 300, 100, 0, 0, false);
	pad.beginContact(2, 325, 100, 14, 6, true);
	pad.endContact(1);
	pad.setGeometry({ ...geometry, buttonGroups: [{ ...face, actions: [{ x: 332, y: 103, radius: 0, buttons: 4 }] }] });
	assert.equal(pad.buttons, 3);
	pad.moveContact(2, 325, 100, 14, 6, true);
	assert.equal(pad.buttons, 4, 'coordinates, both half-extents and activation follow the swapped ID');
	assert.equal(pad.ownsContact(2), true);
	pad.endContact(2);
	assert.equal(pad.buttons, 0);
});

test('layout admission publishes no edges and release still uses each retained contribution', () => {
	const { pad, edges, views } = createFixture();
	pad.beginContact(1, 300, 100, 0, 0, true);
	pad.beginContact(2, 350, 100, 0, 0, true);
	const before = views();
	pad.setGeometry({ ...geometry, buttonGroups: [{ ...face, actions: [
		{ x: 300, y: 100, radius: 20, buttons: 2 },
		{ x: 350, y: 100, radius: 20, buttons: 1 },
	] }] });
	assert.equal(pad.buttons, 3);
	assert.equal(edges.length, 2, 'temporary zero counts are not published');
	assert.equal(views(), before);
	pad.endContact(1);
	assert.equal(pad.buttons, 2, 'without a new native sample, B remains the second finger\'s held contribution');
	pad.endContact(2);
	assert.equal(pad.buttons, 0);
	for (const code of ['a', 'b']) {
		const pair = edges.filter(edge => edge.code === code);
		assert.deepEqual(pair.map(edge => edge.down), [true, false]);
		assert.equal(pair[0].pressId, pair[1].pressId);
	}
});

test('unchanged numerical contact movement and geometry are silent', () => {
	const { pad, edges, views } = createFixture();
	pad.beginContact(1, 300, 100, 14, 14, true);
	const before = views();
	for (let move = 0; move < 10000; move += 1) pad.moveContact(1, 300 + move % 5, 100, 14, 14, true);
	pad.setGeometry(geometry);
	assert.equal(views(), before);
	assert.equal(edges.length, 1);
	assert.equal(pad.buttons, 1);
});

test('identical contact samples skip geometry work while changed samples and layout update their contributions', () => {
	const { pad } = createFixture();
	const contactButtons = Reflect.get(pad, 'contactButtons');
	let hits = 0;
	Object.defineProperty(pad, 'contactButtons', {
		value(group: number, x: number, y: number, halfWidth: number, halfHeight: number) {
			hits += 1;
			return contactButtons.call(pad, group, x, y, halfWidth, halfHeight);
		},
	});
	pad.beginContact(1, 300, 100, 14, 14, true);
	assert.equal(hits, 1);
	for (let move = 0; move < 10000; move += 1) pad.moveContact(1, 300, 100, 14, 14, true);
	assert.equal(hits, 1, 'an identical active sample is already represented');
	pad.moveContact(1, 301, 100, 14, 14, true);
	pad.moveContact(1, 301, 100, 15, 14, true);
	pad.moveContact(1, 301, 100, 15, 13, true);
	assert.equal(hits, 4, 'position and either half-extent change the contact sample');
	pad.moveContact(1, 301, 100, 15, 13, false);
	assert.equal(pad.buttons, 0, 'inactive contact releases without unnecessary geometry work');
	pad.moveContact(1, 301, 100, 15, 13, true);
	assert.equal(pad.buttons, 1);
	assert.equal(hits, 5, 'reactivating uses the retained current sample');
	pad.setGeometry({ ...geometry, buttonGroups: [{ ...face, actions: [{ x: 301, y: 100, radius: 20, buttons: 4 }] }] });
	assert.equal(pad.buttons, 1);
	assert.equal(hits, 5, 'layout does not replay a stationary contact');
	pad.moveContact(1, 301, 100, 15, 13, true);
	assert.equal(pad.buttons, 4);
	assert.equal(hits, 6, 'the next native sample sees the new geometry revision');
});

test('button aggregation retains more than 255 owners and reuses ended contact sample storage', () => {
	const { pad, edges } = createFixture();
	const arrays = ['contactIds', 'contactGroups', 'contactGeometryVersions', 'contactX', 'contactY', 'contactHalfWidths', 'contactHalfHeights', 'contactActive', 'contactContributions']
		.map(name => ({ name, array: Reflect.get(pad, name) as Array<number | boolean> }));
	for (let id = 0; id < 300; id += 1) pad.beginContact(id, 300, 100, 14, 14, true);
	assert.equal(pad.buttons, 1);
	assert.equal(edges.length, 1);
	for (let id = 0; id < 299; id += 1) {
		pad.endContact(id);
		assert.equal(pad.buttons, 1);
	}
	pad.endContact(299);
	assert.equal(pad.buttons, 0);
	assert.equal(edges.length, 2);
	for (const retained of arrays) {
		assert.equal(Reflect.get(pad, retained.name), retained.array);
		assert.equal(retained.array.length, 300, 'ending contacts retains high-water storage');
	}
	for (let id = 300; id < 600; id += 1) pad.beginContact(id, 350, 100, 8, 6, true);
	assert.equal(pad.buttons, 2);
	pad.cancelContacts();
	assert.equal(pad.buttons, 0);
	assert.deepEqual(edges.map(edge => edge.down), [true, false, true, false]);
	for (const retained of arrays) {
		assert.equal(Reflect.get(pad, retained.name), retained.array);
		assert.equal(retained.array.length, 300, 'another equal-size contact population reuses storage');
	}
});

test('teardown publishes matching releases while sink is live and fresh subscriptions have fresh press IDs', () => {
	const { pad, edges, unsubscribe } = createFixture();
	pad.beginContact(1, 325, 100, 14, 14, true);
	unsubscribe();
	assert.equal(pad.buttons, 0);
	assert.equal(pad.ownsContact(1), false);
	for (const code of ['a', 'b']) {
		const pair = edges.filter(edge => edge.code === code);
		assert.equal(pair[0].pressId, pair[1].pressId);
	}
	const more: number[] = [];
	pad.subscribe({ inputButton(_device, _code, down, _value, _time, pressId) { if (down) more.push(pressId); } } as InputEventSink);
	pad.beginContact(2, 300, 100, 14, 14, true);
	assert.ok(more[0] > edges[1].pressId);
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
		assert.deepEqual([...snapshot.pads[0].axesQ16], [0, 0, 0, 0, 0, 0], 'digital controls publish no analog axes');
		return snapshot.pads[0].buttons;
	};
	pad.beginContact(1, 300, 100, 14, 14, true);
	assert.equal(sample(), 1);
	pad.moveContact(1, 325, 100, 14, 14, true);
	assert.equal(sample(), 3, 'one contact reaches both buttons in the ordinary sampled raw word');
	pad.beginContact(2, 75, 75, 14, 14, true);
	assert.equal(sample(), 0x5003);
	pad.moveContact(1, 350, 100, 14, 14, true);
	assert.equal(sample(), 0x5002);
	pad.endContact(2);
	assert.equal(sample(), 2);
	pad.endContact(1);
	assert.equal(sample(), 0);
	pad.beginContact(3, 300, 100, 14, 14, true);
	pad.endContact(3);
	assert.equal(sample(), 0, 'complete between-sample tap is not stretched into guest state');
	input.dispose();
});
