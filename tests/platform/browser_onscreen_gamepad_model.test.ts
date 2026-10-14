import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserOnscreenGamepad, OnscreenActionBank, type OnscreenGamepadGeometry } from '../../hosts/browser/onscreen_gamepad';
import type { HostClock } from '../../hosts/common/clock';
import type { InputEventSink, InputSource } from '../../hosts/common/input/contracts';
import { Input } from '../../hosts/common/input/manager';
import { InputController } from '../../machine/ts/machine/devices/input/controller';
import { createInputControllerSnapshot, InputControllerSampleContext } from '../../machine/ts/machine/devices/input/contracts';
import type { SystemController } from '../../machine/ts/machine/devices/system/controller';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { INP_CTRL_ARM, IO_INP_CTRL, IO_INP_PADS, IO_INP_PAD_BUTTONS_OFFSET, IO_INP_PAD_LX_OFFSET, IO_INP_PAD_LY_OFFSET } from '../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import type { RoundedCircularArc } from '../../hosts/browser/touch_geometry';

const geometry: OnscreenGamepadGeometry = {
	padX: 100, padY: 100, padRadius: 50, padNeutralRadius: 9, stickTravelRadius: 24,
	faceX: 325, faceY: 100, faceRadius: 50,
	actions: [{ x: 300, y: 100, radius: 20, buttons: 1, bank: OnscreenActionBank.Face }, { x: 350, y: 100, radius: 20, buttons: 2, bank: OnscreenActionBank.Face }],
};

function shoulderArc(halfWidth: number): RoundedCircularArc {
	const radius = 100;
	const halfAngle = 0.3;
	return { centerX: 0, centerY: radius, radius, halfWidth,
		startX: -Math.sin(halfAngle), startY: -Math.cos(halfAngle), endX: Math.sin(halfAngle), endY: -Math.cos(halfAngle),
		quarterTurns: 0, startT: Math.tan((-Math.PI / 2 - halfAngle) / 2), endT: Math.tan((-Math.PI / 2 + halfAngle) / 2),
		left: -radius * Math.sin(halfAngle) - halfWidth, top: -halfWidth,
		right: radius * Math.sin(halfAngle) + halfWidth, bottom: radius * (1 - Math.cos(halfAngle)) + halfWidth };
}
const wideShoulder = shoulderArc(20);
const curvedShoulder = shoulderArc(18);

function createFixture() {
	let now = 0;
	const clock = { now: () => now } as HostClock;
	const pad = new BrowserOnscreenGamepad(clock);
	pad.setGeometry(geometry);
	const edges: Array<{ code: string; down: boolean; value: number; time: number; pressId: number }> = [];
	const axes: Array<{ code: string; x: number; y: number; time: number }> = [];
	const sink: InputEventSink = {
		inputButton(_device, code, down, value, time, pressId) { edges.push({ code, down, value, time, pressId }); },
		inputAxis2(_device, code, x, y, time) { axes.push({ code, x, y, time }); },
		inputAxis1() {}, cancelPointerButtons() {}, resetInput() {}, setSupervisorRequestLine() {}, connectInputDevice() {}, disconnectInputDevice() {},
	};
	const unsubscribe = pad.subscribe(sink);
	let views = 0;
	pad.subscribeView(() => { views += 1; });
	return { pad, edges, axes, unsubscribe, advance() { now += 1; }, views: () => views };
}

function createInputControllerFixture() {
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
	return { pad, input, snapshot, memory, sample() {
		input.pollInput();
		input.sampleInputControllerSnapshot(snapshot, InputControllerSampleContext.Normal);
		memory.writeMappedWord(IO_INP_CTRL, INP_CTRL_ARM);
		controller.onVblankEdge(++cycle);
	} };
}

test('wide rounded shoulders use the actual silhouette rather than a circular circumbound', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, faceX: 300, faceY: 100, faceRadius: 0,
		actions: [{ x: 300, y: 100, radius: 52, buttons: 0x10, bank: OnscreenActionBank.LeftShoulder, outline: wideShoulder }] });
	assert.equal(pad.beginContact(1, 348, 100, 0, 0, true), true, 'the long shoulder wing activates');
	assert.equal(pad.buttons, 0x10);
	pad.moveContact(1, 300, 150, 0, 0, true);
	assert.equal(pad.buttons, 0, 'empty space in the enclosing circle is not a button');
	pad.endContact(1);
	assert.equal(pad.beginContact(2, 347, 119, 0, 0, true), false,
		'empty space in the rounded AABB corner does not acquire');
});

test('one elliptical thumb bridges shoulder buttons and independent owners retain the same raw bits', () => {
	const { pad, edges } = createFixture();
	pad.setGeometry({ ...geometry, faceX: 300, faceY: 106, faceRadius: 100, actions: [
		{ x: 300, y: 80, radius: 52, buttons: 0x10, bank: OnscreenActionBank.LeftShoulder, outline: wideShoulder },
		{ x: 300, y: 132, radius: 52, buttons: 0x40, bank: OnscreenActionBank.LeftShoulder, outline: wideShoulder },
	] });
	pad.beginContact(1, 300, 106, 2, 6, true);
	assert.equal(pad.buttons, 0x50, 'inclusive finite edge contact reaches both LB and LT');
	pad.moveContact(1, 300, 80, 14, 3, true);
	assert.equal(pad.buttons, 0x10);
	pad.beginContact(2, 300, 132, 3, 14, true);
	assert.equal(pad.buttons, 0x50);
	pad.moveContact(1, 300, 106, 14, 14, true);
	assert.equal(pad.buttons, 0x50);
	pad.endContact(1);
	assert.equal(pad.buttons, 0x40, 'the second finger still contributes LT');
	pad.endContact(2);
	assert.equal(pad.buttons, 0);
	assert.deepEqual(edges.filter(edge => edge.code === 'lb').map(edge => edge.down), [true, false]);
	assert.deepEqual(edges.filter(edge => edge.code === 'lt').map(edge => edge.down), [true, false, true, false]);
});

test('pad and rounded shoulder acquisition compare actual surfaces, never the shoulder circumbound', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, actions: [
		{ x: 160, y: 70, radius: 52, buttons: 0x10, bank: OnscreenActionBank.LeftShoulder, outline: wideShoulder },
	] });
	pad.beginContact(1, 125, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x8010, 'directional acquisition also contributes the genuinely touched adjacent LB surface');
	pad.endContact(1);
	pad.beginContact(2, 154, 105, 16, 16, true);
	assert.equal(pad.buttons, 0x8010, 'the nearer pad acquires direction while the real footprint still reaches LB');
	pad.endContact(2);
	pad.beginContact(3, 125, 85, 14, 14, true);
	assert.equal(pad.buttons, 0x10, 'a direct rounded shoulder hit remains a button even over the pad');
	pad.moveContact(3, 300, 100, 0, 0, true);
	assert.equal(pad.buttons, 0, 'the same held finger remains a live button contact, not a captured pad');
});

test('finite curved arc shoulders preserve live button contacts and actual-surface pad acquisition', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, actions: [
		geometry.actions[0],
		{ x: 160, y: 70, radius: 48, buttons: 0x10, bank: OnscreenActionBank.LeftShoulder, outline: curvedShoulder },
	] });
	pad.beginContact(1, 125, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x8010, 'the pad acquires direction and its footprint reaches the actual curved LB surface');
	pad.endContact(1);
	pad.beginContact(2, 154, 105, 18, 18, true);
	assert.equal(pad.buttons, 0x8010, 'the nearer pad acquires direction without excluding a true LB intersection');
	pad.endContact(2);
	pad.beginContact(3, 125, 85, 14, 14, true);
	assert.equal(pad.buttons, 0x10, 'the actual rounded end cap is a direct button surface');
	pad.moveContact(3, 300, 100, 14, 14, true);
	assert.equal(pad.buttons, 1, 'the finger glides to A without changing native ownership');
	pad.moveContact(3, 209, 74, 0, 0, true);
	assert.equal(pad.buttons, 0, 'the curved arc centerline does not extend beyond its finite end');
	pad.moveContact(3, 207, 74, 0, 0, true);
	assert.equal(pad.buttons, 0x10, 'the same held contact can re-enter the outer cap');
});

test('one thumb can chord curved arc shoulder rows while another finger contributes independently', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, faceX: 300, faceY: 104, faceRadius: 100, actions: [
		{ x: 300, y: 80, radius: 48, buttons: 0x10, bank: OnscreenActionBank.LeftShoulder, outline: curvedShoulder },
		{ x: 300, y: 128, radius: 48, buttons: 0x40, bank: OnscreenActionBank.LeftShoulder, outline: curvedShoulder },
	] });
	pad.beginContact(1, 300, 104, 2, 6, true);
	assert.equal(pad.buttons, 0x50);
	pad.beginContact(2, 345, 128, 2, 14, true);
	assert.equal(pad.buttons, 0x50, 'independent anisotropic finger reaches the other endpoint cap');
	pad.endContact(1);
	assert.equal(pad.buttons, 0x40);
	pad.endContact(2);
	assert.equal(pad.buttons, 0);
});

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
	pad.setGeometry({ ...geometry, actions: [geometry.actions[0]] });
	assert.equal(pad.beginContact(1, 330, 100, 10, 0, true), true, 'the contact reaches the circle at one edge');
	assert.equal(pad.buttons, 1);
	pad.moveContact(1, 329, 121, 10, 1, true);
	assert.equal(pad.buttons, 0, 'overlapping circle bounds does not hit a rounded corner');
	pad.moveContact(1, 329, 110, 10, 10, true);
	assert.equal(pad.buttons, 0, 'the filled contact bounding rectangle invents an intersection here');
	pad.moveContact(1, 328, 108, 10, 10, true);
	assert.equal(pad.buttons, 1);
});

test('all face-bank intersections contribute, not only the nearest or initially touched button', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, faceY: 125, faceRadius: 80, actions: [
		...geometry.actions,
		{ x: 300, y: 150, radius: 20, buttons: 4, bank: OnscreenActionBank.Face },
		{ x: 350, y: 150, radius: 20, buttons: 8, bank: OnscreenActionBank.Face },
	] });
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
	assert.equal(pad.buttons, 0, 'the contact center is neutral regardless of its footprint');
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
	assert.equal(pad.buttons, 0x8000, 'a modest thumb roll stays in the wider cardinal region');
	pad.moveContact(1, 125, 82, 14, 14, true);
	assert.equal(pad.buttons, 0x9000, 'the rocker enters the shared right/up region');
	pad.moveContact(1, 100, 65, 14, 14, true);
	assert.equal(pad.buttons, 0x1000);
});

test('digital pad gives every cardinal a 70-degree region while preserving deliberate diagonals', () => {
	const { pad, axes } = createFixture();
	pad.beginContact(1, 100, 100, 14, 14, true);
	const cardinals = [
		{ x: 1, y: 0, bits: 0x8000, clockwise: 0x2000, counterclockwise: 0x1000 },
		{ x: 0, y: 1, bits: 0x2000, clockwise: 0x4000, counterclockwise: 0x8000 },
		{ x: -1, y: 0, bits: 0x4000, clockwise: 0x1000, counterclockwise: 0x2000 },
		{ x: 0, y: -1, bits: 0x1000, clockwise: 0x8000, counterclockwise: 0x4000 },
	];
	for (const cardinal of cardinals) {
		for (const degrees of [-54, -45, -36, -34, -31, 0, 31, 34, 36, 45, 54]) {
			const radians = degrees * Math.PI / 180;
			const dx = 40 * (cardinal.x * Math.cos(radians) - cardinal.y * Math.sin(radians));
			const dy = 40 * (cardinal.y * Math.cos(radians) + cardinal.x * Math.sin(radians));
			const expected = cardinal.bits | (degrees < -35 ? cardinal.counterclockwise : degrees > 35 ? cardinal.clockwise : 0);
			pad.moveContact(1, 100 + dx, 100 + dy, 100, 100, true);
			assert.equal(pad.buttons, expected, `cardinal ${cardinal.bits} at ${degrees} degrees`);
		}
	}
	assert.deepEqual(axes, [], 'digital sector selection never synthesizes analog axes');
});

test('digital pad sector boundaries are inclusive diagonals in every quadrant and at every held radius', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, padX: 0, padY: 0 });
	pad.beginContact(1, 0, 0, 0, 0, true);
	for (const radius of [20, 40, 400]) {
		const boundary = radius * Math.tan(35 * Math.PI / 180);
		for (const sx of [-1, 1]) {
			for (const sy of [-1, 1]) {
				const horizontal = sx < 0 ? 0x4000 : 0x8000;
				const vertical = sy < 0 ? 0x1000 : 0x2000;
				for (const [dx, dy, expected] of [
					[radius, boundary - 0.001, horizontal],
					[radius, boundary, horizontal | vertical],
					[radius, boundary + 0.001, horizontal | vertical],
					[boundary - 0.001, radius, vertical],
					[boundary, radius, horizontal | vertical],
					[boundary + 0.001, radius, horizontal | vertical],
				]) {
					pad.moveContact(1, sx * dx, sy * dy, 0, 0, true);
					assert.equal(pad.buttons, expected, `boundary at ${sx * dx},${sy * dy}`);
					assert.equal(pad.ownsContact(1), true, 'sector selection does not change captured ownership outside the artwork');
				}
			}
		}
	}
});

test('wider cardinal sectors preserve opposing contributors as raw sampled direction bits', () => {
	const fixture = createInputControllerFixture();
	const { pad, snapshot, memory, input } = fixture;
	pad.beginContact(1, 60, 80, 14, 14, true);
	pad.beginContact(2, 140, 120, 14, 14, true);
	fixture.sample();
	assert.equal(pad.buttons, 0xc000, 'independent oblique cardinal contacts retain left and right');
	assert.equal(snapshot.pads[0].buttons, 0xc000);
	assert.equal(memory.readIoU32(IO_INP_PADS + IO_INP_PAD_BUTTONS_OFFSET), 0xc000);
	pad.moveContact(1, 60, 60, 14, 14, true);
	pad.moveContact(2, 140, 140, 14, 14, true);
	fixture.sample();
	assert.equal(snapshot.pads[0].buttons, 0xf000, 'deliberate opposing diagonals remain representable without normalization');
	assert.equal(memory.readIoU32(IO_INP_PADS + IO_INP_PAD_BUTTONS_OFFSET), 0xf000);
	pad.endContact(1);
	fixture.sample();
	assert.equal(snapshot.pads[0].buttons, 0xa000);
	pad.endContact(2);
	fixture.sample();
	assert.equal(snapshot.pads[0].buttons, 0);
	input.dispose();
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

test('directional capture stays separate from live button contacts', () => {
	const { pad } = createFixture();
	pad.beginContact(1, 300, 100, 14, 14, true);
	pad.moveContact(1, 140, 100, 14, 14, true);
	assert.equal(pad.buttons, 0, 'a live button contact does not turn into a directional gesture');
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

test('directional capture cannot press secondary switches and independent button fingers remain live', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, actions: [{ x: 180, y: 100, radius: 20, buttons: 0x100, bank: OnscreenActionBank.LeftUtility }] });
	pad.beginContact(1, 145, 100, 30, 30, true);
	assert.equal(pad.buttons, 0x8000);
	pad.beginContact(2, 180, 100, 40, 40, true);
	assert.equal(pad.buttons, 0x8100, 'a separate finger directly on the switch remains independent despite a broad footprint');
	pad.endContact(1);
	assert.equal(pad.buttons, 0x100);
});

const directionalShoulderGeometry: OnscreenGamepadGeometry = { ...geometry, actions: [
	...geometry.actions,
	{ x: 100, y: 20, radius: 15, buttons: 0x10, bank: OnscreenActionBank.LeftShoulder },
	{ x: 60, y: 30, radius: 15, buttons: 0x40, bank: OnscreenActionBank.LeftShoulder },
] };

test('one rolling digital thumb combines actual neighboring shoulders in either acquisition order', () => {
	const { pad, edges } = createFixture();
	pad.setGeometry(directionalShoulderGeometry);
	pad.beginContact(1, 100, 60, 14, 14, true);
	assert.equal(pad.buttons, 0x1000);
	pad.moveContact(1, 100, 45, 14, 14, true);
	assert.equal(pad.buttons, 0x1010, 'the same native footprint now bridges Up and LB');
	pad.moveContact(1, 100, 20, 14, 14, true);
	assert.equal(pad.buttons, 0x10, 'rolling completely onto a real shoulder relinquishes direction');
	pad.moveContact(1, 100, -200, 14, 14, true);
	assert.equal(pad.buttons, 0x1000, 'ordinary outside dragging preserves the acquired directional gesture');
	pad.moveContact(1, 100, 45, 14, 14, true);
	assert.equal(pad.buttons, 0x1010);
	pad.endContact(1);
	assert.equal(pad.buttons, 0);
	pad.beginContact(2, 100, 20, 14, 14, true);
	assert.equal(pad.buttons, 0x10);
	pad.moveContact(2, 100, 40, 14, 14, true);
	assert.equal(pad.buttons, 0x10, 'footprint-only grazing retains the nearer shoulder, without inventing Up');
	pad.moveContact(2, 100, 45, 14, 14, true);
	assert.equal(pad.buttons, 0x1010, 'crossing the actual nearest-surface partition acquires Up immediately');
	pad.moveContact(2, 75, 75, 14, 14, true);
	assert.equal(pad.buttons, 0x5000, 'ordinary cardinal and diagonal classification is unchanged after acquisition');
	pad.endContact(2);
	assert.equal(pad.buttons, 0);
	for (const code of ['up', 'lb']) {
		const events = edges.filter(edge => edge.code === code);
		for (let index = 0; index < events.length; index += 2) {
			assert.equal(events[index].down, true);
			assert.equal(events[index + 1].down, false);
			assert.equal(events[index].pressId, events[index + 1].pressId);
		}
	}
});

test('a broad digital thumb can contribute direction plus both neighboring LB and LT, but never unrelated banks', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, actions: [
		{ x: 100, y: 20, radius: 15, buttons: 0x10, bank: OnscreenActionBank.LeftShoulder },
		{ x: 100, y: 10, radius: 15, buttons: 0x40, bank: OnscreenActionBank.LeftShoulder },
		{ x: 125, y: 20, radius: 15, buttons: 0x100, bank: OnscreenActionBank.LeftUtility },
		{ x: 125, y: 25, radius: 15, buttons: 0x20, bank: OnscreenActionBank.RightShoulder },
		{ x: 125, y: 30, radius: 15, buttons: 8, bank: OnscreenActionBank.Face },
	] });
	pad.beginContact(1, 100, 50, 30, 30, true);
	assert.equal(pad.buttons, 0x1050, 'one directional contributor touches Up, LB and LT, not utility, RB or Y');
	pad.moveContact(1, 100, 50, 14, 14, true);
	assert.equal(pad.buttons, 0x1000, 'reducing the actual contact area removes both shoulder contributions');
	pad.moveContact(1, 100, 50, 30, 30, true);
	assert.equal(pad.buttons, 0x1050);
	pad.cancelContacts();
	assert.equal(pad.buttons, 0);
	assert.equal(pad.ownsContact(1), false);
	pad.beginContact(2, 100, 20, 30, 30, true);
	assert.equal(pad.buttons, 0x50, 'direct shoulder acquisition stays shoulder-only despite a footprint touching the pad');
	pad.endContact(2);
});

test('a live face finger only gains directional eligibility after deliberately entering the left shoulder bank', () => {
	const { pad } = createFixture();
	pad.setGeometry(directionalShoulderGeometry);
	pad.beginContact(1, 300, 100, 14, 14, true);
	pad.moveContact(1, 100, 60, 14, 14, true);
	assert.equal(pad.buttons, 0, 'ordinary face-to-pad travel remains a button gesture');
	pad.moveContact(1, 100, 20, 14, 14, true);
	assert.equal(pad.buttons, 0x10);
	pad.moveContact(1, 100, 45, 14, 14, true);
	assert.equal(pad.buttons, 0x1010, 'the actual left-hand shoulder acquisition permits a deliberate directional roll');
	pad.endContact(1);
});

test('directional-shoulder counts retain independent fingers in either release order and through a contact-slot swap', () => {
	for (const chordFirst of [false, true]) {
		const { pad, edges } = createFixture();
		pad.setGeometry(directionalShoulderGeometry);
		pad.beginContact(9, 300, 100, 0, 0, false);
		pad.beginContact(1, 100, 45, 14, 14, true);
		pad.beginContact(2, 100, 20, 14, 14, true);
		pad.beginContact(3, 100, 60, 14, 14, true);
		assert.equal(pad.buttons, 0x1010);
		pad.endContact(9);
		pad.endContact(chordFirst ? 1 : 2);
		assert.equal(pad.buttons, 0x1010, 'aggregate Up and LB still have actual independent owners');
		pad.endContact(chordFirst ? 2 : 1);
		assert.equal(pad.buttons, 0x1000, 'only the independent Up owner remains');
		pad.moveContact(3, 60, 100, 14, 14, true);
		assert.equal(pad.buttons, 0x4000, 'swapped directional ownership and contact sample remain correct');
		pad.endContact(3);
		assert.equal(pad.buttons, 0);
		assert.deepEqual(edges.filter(edge => edge.code === 'lb').map(edge => edge.down), [true, false]);
	}
});

test('layout resamples live digital shoulder contributions without inventing a shoulder-first directional lease', () => {
	const { pad } = createFixture();
	pad.setGeometry(directionalShoulderGeometry);
	pad.beginContact(1, 100, 45, 14, 14, true);
	assert.equal(pad.buttons, 0x1010);
	pad.setGeometry(geometry);
	assert.equal(pad.buttons, 0x1000, 'removing the adjacent shoulder removes only its current contribution');
	pad.setGeometry(directionalShoulderGeometry);
	assert.equal(pad.buttons, 0x1010, 'the retained footprint sees the restored authored surface');
	pad.endContact(1);
	pad.beginContact(2, 100, 20, 14, 14, true);
	pad.setGeometry({ ...geometry, padY: 50 });
	assert.equal(pad.buttons, 0, 'a layout write does not promote an existing shoulder finger into a captured direction');
	pad.moveContact(2, 100, 21, 14, 14, true);
	assert.equal(pad.buttons, 0x1000, 'a genuine subsequent move deliberately acquires the relocated directional unit');
	pad.endContact(2);
});

test('analog stick leases remain exclusive and switching modes releases the whole acquired digital gesture only', () => {
	const { pad } = createFixture();
	pad.setGeometry(directionalShoulderGeometry);
	pad.beginContact(1, 100, 45, 14, 14, true);
	pad.beginContact(2, 100, 20, 14, 14, true);
	assert.equal(pad.buttons, 0x1010);
	pad.setDirectionalMode('stick');
	assert.equal(pad.buttons, 0x10, 'the independent shoulder source survives digital-gesture suppression');
	pad.moveContact(1, 100, 45, 30, 30, true);
	assert.equal(pad.buttons, 0x10);
	pad.moveContact(2, 100, 45, 14, 14, true);
	assert.equal(pad.buttons, 0x10, 'a shoulder finger does not acquire analog ownership while sliding');
	assert.equal(pad.stickActive, false);
	pad.endContact(1);
	pad.endContact(2);
	pad.beginContact(3, 100, 45, 14, 14, true);
	assert.equal(pad.stickActive, true);
	assert.equal(pad.buttons, 0, 'the analog-owned footprint cannot contribute LB');
	pad.moveContact(3, 100, 20, 14, 14, true);
	assert.equal(pad.buttons, 0);
	assert.equal(pad.stickY, -1);
	pad.endContact(3);
	assert.equal(pad.stickActive, false);
});

test('one-contact directional shoulder chords reach ordinary common snapshots and armed ICU words', () => {
	const { pad, input, snapshot, memory, sample } = createInputControllerFixture();
	pad.setGeometry(directionalShoulderGeometry);
	const assertWord = (word: number) => {
		sample();
		assert.equal(pad.buttons, word);
		assert.equal(input.getPlayerInput(1).inputHandlers.gamepad.physicalGamepadButtonsWord(), word);
		assert.equal(snapshot.pads[0].buttons, word);
		assert.equal(memory.readIoU32(IO_INP_PADS + IO_INP_PAD_BUTTONS_OFFSET), word);
		assert.deepEqual([...snapshot.pads[0].axesQ16].slice(0, 2), [0, 0]);
	};
	pad.beginContact(1, 100, 45, 14, 14, true);
	assertWord(0x1010);
	pad.moveContact(1, 65, 49, 14, 14, true);
	assertWord(0x1040);
	pad.moveContact(1, 63, 49, 14, 14, true);
	assertWord(0x5040);
	pad.endContact(1);
	assertWord(0);
	input.dispose();
});

test('button-bank eligibility follows the nearest true surface while gliding without per-button capture', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, actions: [
		...geometry.actions,
		{ x: 400, y: 100, radius: 20, buttons: 0x100, bank: OnscreenActionBank.LeftUtility },
	] });
	pad.beginContact(1, 400, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x100);
	pad.moveContact(1, 375, 100, 14, 14, true);
	assert.equal(pad.buttons, 2, 'equal true distances use authored order rather than combining unrelated banks');
	pad.moveContact(1, 376, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x100, 'moving one pixel toward the utility switches banks immediately, without hysteresis');
	pad.moveContact(1, 350, 100, 14, 14, true);
	assert.equal(pad.buttons, 2);
	pad.moveContact(1, 300, 100, 14, 14, true);
	assert.equal(pad.buttons, 1, 'sliding from an auxiliary switch to A needs no new down');
	pad.beginContact(2, 300, 100, 0, 0, true);
	pad.moveContact(1, 400, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x101, 'the independent A contributor survives the first contact returning to the switch');
	pad.endContact(1);
	assert.equal(pad.buttons, 1);
	pad.endContact(2);
	assert.equal(pad.buttons, 0);
});

test('shoulder footprints cannot press Y, while independent fingers and live cross-bank glides remain physical contributions', () => {
	const { pad, edges } = createFixture();
	const bankGeometry: OnscreenGamepadGeometry = { ...geometry, faceX: 300, faceY: 130, faceRadius: 50, actions: [
		{ x: 300, y: 130, radius: 20, buttons: 8, bank: OnscreenActionBank.Face },
		{ x: 300, y: 80, radius: 52, buttons: 0x20, bank: OnscreenActionBank.RightShoulder, outline: wideShoulder },
	] };
	pad.setGeometry(bankGeometry);
	for (const [halfWidth, halfHeight] of [[14, 14], [20, 28], [28, 20]]) {
		pad.beginContact(1, 300, 99, halfWidth, halfHeight, true);
		assert.equal(pad.buttons, 0x20, 'a direct shoulder hit wins despite the same footprint reaching Y');
		pad.beginContact(2, 300, 111, halfWidth, halfHeight, true);
		assert.equal(pad.buttons, 0x28, 'another finger directly on Y is never suppressed by a held shoulder');
		pad.moveContact(1, 300, 111, halfWidth, halfHeight, true);
		assert.equal(pad.buttons, 8, 'the first finger glides across banks without lifting or keeping its initial RB');
		pad.moveContact(1, 300, 99, halfWidth, halfHeight, true);
		assert.equal(pad.buttons, 0x28, 'returning to the shoulder does not erase the independent Y contributor');
		pad.endContact(2);
		assert.equal(pad.buttons, 0x20);
		pad.setGeometry({ ...bankGeometry, actions: bankGeometry.actions.map(action => ({ ...action, y: action.y + 100 })) });
		assert.equal(pad.buttons, 0, 'layout resamples the retained footprint, not a captured bank or stale contribution');
		pad.moveContact(1, 300, 199, halfWidth, halfHeight, true);
		assert.equal(pad.buttons, 0x20);
		pad.endContact(1);
		assert.equal(pad.buttons, 0);
		pad.setGeometry(bankGeometry);
	}
	assert.deepEqual(edges.filter(edge => edge.code === 'y').map(edge => edge.down),
		[true, false, true, false, true, false], 'Y has only genuine independent-finger edges');
});

test('bank arbitration reaches common input and armed ICU without changing frame sampling or global button masks', () => {
	const { pad, input, snapshot, memory, sample } = createInputControllerFixture();
	pad.setGeometry({ ...geometry, actions: [
		{ x: 300, y: 130, radius: 20, buttons: 8, bank: OnscreenActionBank.Face },
		{ x: 300, y: 80, radius: 52, buttons: 0x20, bank: OnscreenActionBank.RightShoulder, outline: wideShoulder },
	] });
	const sampleWord = (word: number) => {
		sample();
		assert.equal(pad.buttons, word);
		assert.equal(input.getPlayerInput(1).inputHandlers.gamepad.physicalGamepadButtonsWord(), word);
		assert.equal(snapshot.pads[0].buttons, word);
		assert.equal(memory.readIoU32(IO_INP_PADS + IO_INP_PAD_BUTTONS_OFFSET), word);
	};
	pad.beginContact(1, 300, 99, 20, 28, true);
	sampleWord(0x20);
	pad.beginContact(2, 300, 111, 28, 20, true);
	sampleWord(0x28);
	pad.endContact(1);
	sampleWord(8);
	pad.endContact(2);
	sampleWord(0);
});

test('bank pickup uses true finite arc distances, never its circumbound or neutral acquisition envelope', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, faceX: 300, faceY: 100, faceRadius: 100, actions: [
		{ x: 300, y: 80, radius: 52, buttons: 0x20, bank: OnscreenActionBank.RightShoulder, outline: wideShoulder },
		{ x: 300, y: 130, radius: 20, buttons: 8, bank: OnscreenActionBank.Face },
	] });
	pad.beginContact(1, 300, 104, 14, 14, true);
	assert.equal(pad.buttons, 0x20, 'outside both solids, the curved shoulder edge is nearer than Y');
	pad.moveContact(1, 300, 106, 14, 14, true);
	assert.equal(pad.buttons, 8, 'Y becomes nearer even though the center is inside the shoulder circumbound');
	pad.moveContact(1, 300, 111, 2, 28, true);
	assert.equal(pad.buttons, 8, 'a direct Y center wins despite the long measured footprint still reaching the arc');
	pad.endContact(1);
	pad.beginContact(2, 300, 106, 14, 14, true);
	assert.equal(pad.buttons, 8, 'fresh acquisition and retained movement use the same bank policy');
	pad.endContact(2);
});

test('bank candidate storage is reserved by geometry and retains every authored surface without a contact-time index-word limit', () => {
	const { pad } = createFixture();
	const actions = Array.from({ length: 34 }, (_, index) => ({ x: 1000 + index, y: 1000, radius: 0,
		buttons: 1, bank: OnscreenActionBank.Face }));
	// This near horizontal point misses a zero-width vertical contact. It must
	// never alias the distant shoulder's index and enter the distance competition.
	actions[0] = { x: 301, y: 100, radius: 0, buttons: 8, bank: OnscreenActionBank.Face };
	actions[32] = { x: 300, y: 120, radius: 0, buttons: 0x20, bank: OnscreenActionBank.RightShoulder };
	actions[33] = { x: 300, y: 125, radius: 0, buttons: 8, bank: OnscreenActionBank.Face };
	pad.setGeometry({ ...geometry, actions });
	const storage = Reflect.get(pad, 'sampledActions');
	assert.equal(storage.length, 34);
	pad.beginContact(1, 300, 100, 0, 28, true);
	assert.equal(pad.buttons, 0x20, 'only true footprint hits compete, including indices beyond one register word');
	pad.moveContact(1, 300, 101, 0, 28, true);
	assert.equal(pad.buttons, 0x20);
	pad.setGeometry(geometry);
	assert.equal(pad.buttons, 1);
	assert.equal(Reflect.get(pad, 'sampledActions'), storage, 'smaller layouts retain the high-water scratch storage');
	assert.equal(storage.length, 34);
	pad.endContact(1);
	assert.equal(pad.buttons, 0);
});

test('actual button contact is not intercepted by the invisible neutral face envelope', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, actions: [
		geometry.actions[0],
		{ x: 390, y: 100, radius: 20, buttons: 0x100, bank: OnscreenActionBank.LeftUtility },
	] });
	pad.beginContact(1, 365, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x100, 'the footprint presses the switch although its center is on the neutral face area');
	pad.moveContact(1, 300, 100, 14, 14, true);
	assert.equal(pad.buttons, 1);
});

test('directional pickup compares actual surfaces before neutral face geometry', () => {
	const { pad } = createFixture();
	pad.setGeometry({ ...geometry, faceX: 180, faceRadius: 100,
		actions: [{ x: 180, y: 100, radius: 20, buttons: 0x100, bank: OnscreenActionBank.LeftUtility }] });
	pad.beginContact(1, 154, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x8000, 'the nearer pad edge wins despite the neutral face envelope');
	pad.endContact(1);
	pad.beginContact(2, 156, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x100, 'the nearer switch edge wins an area-only pickup');
	pad.endContact(2);
	pad.beginContact(3, 145, 100, 30, 30, true);
	assert.equal(pad.buttons, 0x8000, 'a point directly on the pad retains its directional purpose');
	pad.endContact(3);
	pad.setGeometry({ ...geometry, actions: [{ x: 140, y: 100, radius: 10, buttons: 0x100, bank: OnscreenActionBank.LeftUtility }] });
	pad.beginContact(4, 140, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x100, 'a direct visible button hit takes priority over overlapping pad artwork');
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
	assert.equal(pad.buttons, 0, 'activation does not turn a button contact into a directional gesture');
	pad.beginContact(2, 100, 100, 14, 14, false);
	pad.moveContact(2, 60, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x4000);
	pad.moveContact(1, 60, 100, 14, 14, false);
	pad.moveContact(2, 60, 100, 14, 14, false);
	pad.setGeometry(geometry);
	assert.equal(pad.buttons, 0, 'layout does not activate an inactive contact');
});

test('layout changes immediately resample retained contact geometry', () => {
	const { pad } = createFixture();
	pad.beginContact(1, 325, 100, 14, 14, true);
	assert.equal(pad.buttons, 3);
	pad.setGeometry({ ...geometry, actions: [{ x: 339, y: 100, radius: 0, buttons: 4, bank: OnscreenActionBank.Face }] });
	assert.equal(pad.buttons, 4, 'current layout is authoritative for retained samples');
	pad.moveContact(1, 325, 100, 14, 14, true);
	assert.equal(pad.buttons, 4, 'the identical sample was already resampled');
	pad.setGeometry({ ...geometry, actions: [{ x: 340, y: 100, radius: 0, buttons: 4, bank: OnscreenActionBank.Face }] });
	assert.equal(pad.buttons, 0, 'moving geometry away releases the retained contribution immediately');
	pad.moveContact(1, 325, 100, 14, 14, true);
	assert.equal(pad.buttons, 0, 'a native sample outside the moved button releases its contribution');
	assert.equal(pad.ownsContact(1), true);
	pad.setGeometry(geometry);
	assert.equal(pad.buttons, 3, 'moving geometry back admits the retained contact again');
	pad.moveContact(1, 325, 100, 14, 14, true);
	assert.equal(pad.buttons, 3);
});

test('contact-slot removal retains the swapped purpose and contact sample', () => {
	const { pad } = createFixture();
	pad.beginContact(1, 300, 100, 0, 0, false);
	pad.beginContact(2, 325, 100, 14, 6, true);
	pad.endContact(1);
	pad.setGeometry({ ...geometry, actions: [{ x: 332, y: 103, radius: 0, buttons: 4, bank: OnscreenActionBank.Face }] });
	assert.equal(pad.buttons, 4, 'layout resamples the contact copied into the removed slot');
	pad.moveContact(2, 325, 100, 14, 6, true);
	assert.equal(pad.buttons, 4, 'coordinates, both half-extents and activation follow the swapped ID');
	assert.equal(pad.ownsContact(2), true);
	pad.endContact(2);
	assert.equal(pad.buttons, 0);
});

test('layout resampling publishes only final aggregate edges and releases current contributions', () => {
	const { pad, edges, views } = createFixture();
	pad.beginContact(1, 300, 100, 0, 0, true);
	pad.beginContact(2, 350, 100, 0, 0, true);
	const before = views();
	pad.setGeometry({ ...geometry, actions: [
		{ x: 300, y: 100, radius: 20, buttons: 2, bank: OnscreenActionBank.Face },
		{ x: 350, y: 100, radius: 20, buttons: 1, bank: OnscreenActionBank.Face },
	] });
	assert.equal(pad.buttons, 3);
	assert.equal(edges.length, 2, 'temporary zero counts are not published');
	assert.equal(views(), before);
	pad.endContact(1);
	assert.equal(pad.buttons, 1, 'the second contact contributes A after geometry resampling');
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
		value(purpose: number, x: number, y: number, halfWidth: number, halfHeight: number, acquirePad: boolean) {
			hits += 1;
			return contactButtons.call(pad, purpose, x, y, halfWidth, halfHeight, acquirePad);
		},
	});
	pad.beginContact(1, 300, 100, 14, 14, true);
	assert.equal(hits, 0, 'acquisition reuses its computed button intersections');
	for (let move = 0; move < 10000; move += 1) pad.moveContact(1, 300, 100, 14, 14, true);
	assert.equal(hits, 0, 'an identical active sample is already represented');
	pad.moveContact(1, 301, 100, 14, 14, true);
	pad.moveContact(1, 301, 100, 15, 14, true);
	pad.moveContact(1, 301, 100, 15, 13, true);
	assert.equal(hits, 3, 'position and either half-extent change the contact sample');
	pad.moveContact(1, 301, 100, 15, 13, false);
	assert.equal(pad.buttons, 0, 'inactive contact releases without unnecessary geometry work');
	pad.moveContact(1, 301, 100, 15, 13, true);
	assert.equal(pad.buttons, 1);
	assert.equal(hits, 4, 'reactivating uses the retained current sample');
	pad.setGeometry({ ...geometry, actions: [{ x: 301, y: 100, radius: 20, buttons: 4, bank: OnscreenActionBank.Face }] });
	assert.equal(pad.buttons, 4);
	assert.equal(hits, 5, 'layout resamples the retained contact exactly once');
	pad.moveContact(1, 301, 100, 15, 13, true);
	assert.equal(pad.buttons, 4);
	assert.equal(hits, 5, 'the identical native sample needs no repeated geometry work');
});

test('button aggregation retains more than 255 owners and reuses ended contact sample storage', () => {
	const { pad, edges } = createFixture();
	const arrays = ['contactIds', 'contactPurposes', 'contactX', 'contactY', 'contactHalfWidths', 'contactHalfHeights', 'contactActive', 'contactContributions']
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
	const fixture = createInputControllerFixture();
	const { pad, input, snapshot, memory } = fixture;
	const sample = () => {
		fixture.sample();
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

test('switchable fixed-base L-stick publishes true axes, a radial neutral zone and a bounded circular range', () => {
	const { pad, edges, axes, views, advance } = createFixture();
	assert.equal(pad.directionalMode, 'dpad');
	pad.setDirectionalMode('stick');
	assert.equal(pad.directionalMode, 'stick');
	assert.equal(views(), 1, 'a mode-only change notifies the passive view');
	pad.setDirectionalMode('stick');
	assert.equal(views(), 1, 'the same authored mode does not schedule more work');
	pad.beginContact(1, 100, 100, 14, 14, true);
	assert.equal(pad.stickActive, true);
	assert.equal(views(), 2, 'a held neutral stick still updates its active feedback');
	assert.equal(axes.length, 0);
	pad.moveContact(1, 109, 100, 14, 14, true);
	assert.equal(pad.stickX, 0);
	assert.equal(axes.length, 0, 'the neutral radius is inclusive');
	advance();
	pad.moveContact(1, 116.5, 100, 14, 14, true);
	assert.equal(pad.stickX, 0.5);
	assert.equal(pad.stickY, 0);
	assert.deepEqual(axes.at(-1), { code: 'ls', x: 0.5, y: 0, time: 1 });
	pad.moveContact(1, 124, 100, 14, 14, true);
	assert.equal(pad.stickX, 1, 'full-scale follows the authored travel, not the wider acquisition disc');
	pad.moveContact(1, 600, 100, 14, 14, true);
	assert.equal(pad.stickX, 1, 'captured motion beyond the artwork saturates without ending ownership');
	assert.equal(pad.ownsContact(1), true);
	pad.moveContact(1, 600, 600, 14, 14, true);
	assert.ok(Math.abs(pad.stickX - Math.SQRT1_2) < 1e-15);
	assert.ok(Math.abs(pad.stickY - Math.SQRT1_2) < 1e-15);
	assert.equal(pad.buttons, 0, 'an analog stick never invents digital pad or stick-click bits');
	assert.equal(edges.length, 0);
	pad.endContact(1);
	assert.deepEqual(axes.at(-1), { code: 'ls', x: 0, y: 0, time: 1 });
	assert.equal(pad.stickActive, false);
});

test('one stick owner survives contact-slot swaps, other pad fingers do not steal or auto-promote, and actions remain independent', () => {
	const { pad, axes } = createFixture();
	pad.setDirectionalMode('stick');
	pad.beginContact(1, 300, 100, 0, 0, true);
	pad.beginContact(2, 325, 100, 14, 14, true);
	pad.beginContact(3, 150, 100, 0, 0, true);
	pad.beginContact(4, 100, 50, 0, 0, true);
	assert.equal(pad.buttons, 3);
	assert.equal(pad.stickX, 1);
	assert.equal(pad.stickY, 0);
	pad.moveContact(4, 50, 100, 14, 14, true);
	assert.equal(pad.stickX, 1, 'a second directional finger cannot overwrite the owner');
	pad.endContact(2); // Copy the held secondary pad into slot 1.
	pad.endContact(1); // Copy the primary stick owner into slot 0.
	assert.equal(pad.buttons, 0);
	pad.moveContact(3, 100, 50, 14, 14, true);
	assert.equal(pad.stickX, 0);
	assert.equal(pad.stickY, -1, 'the swapped source lease still owns the stick');
	pad.endContact(3);
	assert.equal(pad.stickActive, false);
	assert.equal(pad.stickX, 0);
	assert.equal(pad.stickY, 0);
	const before = axes.length;
	pad.moveContact(4, 150, 100, 14, 14, true);
	assert.equal(axes.length, before, 'a previously occupied finger is not promoted on movement');
	assert.equal(pad.ownsContact(4), true, 'its route remains owned until its own release');
	pad.beginContact(5, 116.5, 100, 14, 14, true);
	assert.equal(pad.stickX, 0.5, 'a fresh down can acquire the free physical unit');
	pad.endContact(4);
	assert.equal(pad.stickX, 0.5, 'ending an unrelated retained pointer cannot release the owner');
	pad.endContact(5);
});

test('mode changes release only directional contributions and require new pad gestures in either mode', () => {
	const { pad, edges, axes } = createFixture();
	pad.beginContact(1, 140, 100, 14, 14, true);
	pad.beginContact(2, 100, 60, 14, 14, true);
	pad.beginContact(3, 325, 100, 14, 14, true);
	assert.equal(pad.buttons, 0x9003);
	pad.setDirectionalMode('stick');
	assert.equal(pad.buttons, 3, 'the action-thumb chord survives a directional-unit replacement');
	assert.deepEqual(edges.filter(edge => !edge.down).map(edge => edge.code), ['up', 'right']);
	pad.moveContact(1, 150, 100, 14, 14, true);
	pad.moveContact(2, 100, 50, 14, 14, true);
	assert.equal(pad.stickActive, false);
	assert.equal(axes.length, 0, 'existing pad pointers are retained but do not rearm the replacement');
	pad.moveContact(3, 350, 100, 14, 14, true);
	assert.equal(pad.buttons, 2, 'the same action finger retains its live nonexclusive route');
	pad.beginContact(4, 150, 100, 0, 0, true);
	assert.equal(pad.stickX, 1);
	pad.setDirectionalMode('dpad');
	assert.equal(pad.buttons, 2);
	assert.equal(pad.stickActive, false);
	assert.deepEqual(axes.map(axis => [axis.x, axis.y]), [[1, 0], [0, 0]]);
	pad.moveContact(4, 50, 100, 14, 14, true);
	assert.equal(pad.buttons, 2, 'the old analog pointer does not become a held digital direction');
	pad.setGeometry(geometry);
	assert.equal(pad.buttons, 2, 'resizing cannot reactivate suppressed leases');
	pad.beginContact(5, 100, 60, 14, 14, true);
	assert.equal(pad.buttons, 0x1002, 'a fresh down uses the currently selected digital pad');
	for (const id of [2, 1, 4, 3, 5]) pad.endContact(id);
	assert.equal(pad.buttons, 0);
});

test('stick geometry resampling, active transitions and cancellation publish only changed numerical state', () => {
	const { pad, axes, views, unsubscribe } = createFixture();
	pad.setDirectionalMode('stick');
	pad.beginContact(1, 116.5, 100, 14, 14, true);
	const before = views();
	for (let move = 0; move < 10000; move += 1) pad.moveContact(1, 116.5, 100, 14, 14, true);
	pad.setGeometry(geometry);
	assert.equal(views(), before);
	assert.equal(axes.length, 1);
	pad.setGeometry({ ...geometry, padX: 107.5 });
	assert.equal(pad.stickX, 0);
	assert.equal(pad.stickActive, true, 'a geometry edit does not lose the captured active source');
	assert.equal(axes.length, 2);
	pad.setGeometry(geometry);
	assert.equal(pad.stickX, 0.5, 'layout resamples the retained coordinates without a fresh native move');
	pad.moveContact(1, 116.5, 100, 14, 14, false);
	assert.equal(pad.stickActive, false);
	assert.equal(pad.stickX, 0);
	pad.moveContact(1, 116.5, 100, 14, 14, true);
	assert.equal(pad.stickX, 0.5);
	pad.beginContact(2, 300, 100, 14, 14, true);
	unsubscribe();
	assert.equal(pad.buttons, 0);
	assert.equal(pad.stickActive, false);
	assert.deepEqual(axes.at(-1), { code: 'ls', x: 0, y: 0, time: 0 });
	assert.equal(pad.ownsContact(1), false);
	assert.equal(pad.ownsContact(2), false);
});

test('true L-stick axes use the common encoder and the existing armed ICU cadence independently of digital actions', () => {
	const fixture = createInputControllerFixture();
	const { pad, input, snapshot, memory } = fixture;
	const sample = (buttons: number, x: number, y: number) => {
		fixture.sample();
		assert.equal(snapshot.pads[0].buttons, buttons);
		assert.deepEqual([...snapshot.pads[0].axesQ16], [x, y, 0, 0, 0, 0]);
		assert.equal(memory.readIoU32(IO_INP_PADS + IO_INP_PAD_BUTTONS_OFFSET), buttons);
		assert.equal(memory.readIoU32(IO_INP_PADS + IO_INP_PAD_LX_OFFSET), x);
		assert.equal(memory.readIoU32(IO_INP_PADS + IO_INP_PAD_LY_OFFSET), y);
	};
	pad.setDirectionalMode('stick');
	pad.beginContact(1, 116.5, 100, 14, 14, true);
	pad.beginContact(2, 325, 100, 14, 14, true);
	sample(3, 0x8000, 0);
	pad.moveContact(1, 83.5, 100, 14, 14, true);
	sample(3, 0xffff8000, 0);
	pad.moveContact(1, 100, 116.5, 14, 14, true);
	sample(3, 0, 0x8000);
	pad.moveContact(1, 100, 83.5, 14, 14, true);
	sample(3, 0, 0xffff8000);
	pad.setDirectionalMode('dpad');
	sample(3, 0, 0);
	pad.beginContact(3, 140, 100, 14, 14, true);
	sample(0x8003, 0, 0);
	pad.cancelContacts();
	sample(0, 0, 0);
	input.dispose();
});


test('stick acquisition, neutral and full-scale travel are independent authored dimensions', () => {
	const { pad, axes } = createFixture();
	pad.setDirectionalMode('stick');
	pad.beginContact(1, 100, 100, 14, 14, true);
	for (const [x, expected] of [[109, 0], [110.5, 0.1], [116.5, 0.5], [124, 1], [150, 1], [83.5, -0.5], [76, -1]]) {
		pad.moveContact(1, x, 100, 14, 14, true);
		assert.equal(pad.stickX, expected, `authored travel response at x=${x}`);
		assert.equal(pad.stickY, 0);
		assert.equal(pad.buttons, 0);
	}
	pad.moveContact(1, 116.5, 100, 14, 14, true);
	pad.setGeometry({ ...geometry, stickTravelRadius: 39 });
	assert.equal(pad.stickX, 0.25, 'a layout change resamples travel without changing the acquisition or neutral discs');
	pad.setGeometry(geometry);
	assert.equal(pad.stickX, 0.5);
	pad.endContact(1);
	pad.beginContact(2, 145, 100, 0, 0, true);
	assert.equal(pad.stickX, 1, 'a fresh down outside the tip travel still acquires the full directional unit');
	assert.equal(pad.ownsContact(2), true);
	pad.endContact(2);
	assert.deepEqual(axes.at(-1), { code: 'ls', x: 0, y: 0, time: 0 });
});

test('retained stick travel over curved shoulders, triggers and every other bank never contributes button bits', () => {
	const { pad, input, snapshot, memory, sample } = createInputControllerFixture();
	const curvedGeometry: OnscreenGamepadGeometry = { ...geometry, actions: [
		...geometry.actions,
		{ x: 100, y: 25, radius: 52, buttons: 0x10, bank: OnscreenActionBank.LeftShoulder, outline: wideShoulder },
		{ x: 25, y: 100, radius: 20, buttons: 0x40, bank: OnscreenActionBank.LeftShoulder },
		{ x: 300, y: 25, radius: 52, buttons: 0x20, bank: OnscreenActionBank.RightShoulder, outline: wideShoulder },
		{ x: 375, y: 100, radius: 20, buttons: 0x80, bank: OnscreenActionBank.RightShoulder },
		{ x: 100, y: 200, radius: 20, buttons: 0x100, bank: OnscreenActionBank.LeftUtility },
		{ x: 300, y: 200, radius: 20, buttons: 0x200, bank: OnscreenActionBank.RightUtility },
	] };
	pad.setGeometry(curvedGeometry);
	pad.setDirectionalMode('stick');
	pad.beginContact(1, 100, 100, 14, 14, true);
	for (const [x, y] of [[100, 25], [25, 100], [300, 25], [375, 100], [300, 100], [350, 100],
		[100, 200], [300, 200], [100, -1000], [-1000, 100]]) {
		pad.moveContact(1, x, y, 28, 28, true);
		sample();
		assert.equal(pad.ownsContact(1), true, `retained stick at ${x},${y}`);
		assert.equal(pad.stickActive, true);
		assert.equal(pad.buttons, 0);
		assert.equal(snapshot.pads[0].buttons, 0);
		assert.equal(memory.readIoU32(IO_INP_PADS + IO_INP_PAD_BUTTONS_OFFSET), 0);
	}
	pad.moveContact(1, 100, 25, 28, 28, true);
	pad.setGeometry({ ...curvedGeometry, padX: 101 });
	assert.equal(pad.buttons, 0, 'layout resampling cannot turn the retained stick into a shoulder contact');
	pad.setGeometry(curvedGeometry);
	pad.beginContact(2, 100, 25, 14, 14, true);
	for (const [x, y, word] of [[100, 25, 0x10], [25, 100, 0x40], [300, 100, 1]]) {
		pad.moveContact(2, x, y, 14, 14, true);
		sample();
		assert.equal(pad.buttons, word, 'an independent finger retains ordinary button-bank gliding');
		assert.equal(snapshot.pads[0].buttons, word);
		assert.equal(memory.readIoU32(IO_INP_PADS + IO_INP_PAD_BUTTONS_OFFSET), word);
		assert.equal(memory.readIoU32(IO_INP_PADS + IO_INP_PAD_LY_OFFSET), 0xffff0000, 'the original contact remains the stick owner');
	}
	pad.endContact(2);
	sample();
	assert.equal(snapshot.pads[0].buttons, 0, 'the stick footprint cannot keep the independently released button held');
	pad.cancelContacts();
	sample();
	assert.equal(pad.ownsContact(1), false);
	assert.equal(snapshot.pads[0].buttons, 0);
	assert.deepEqual([...snapshot.pads[0].axesQ16], [0, 0, 0, 0, 0, 0]);
	input.dispose();
});
