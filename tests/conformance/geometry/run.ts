import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Machine } from '../../../machine/ts/machine/machine';
import { Memory } from '../../../machine/ts/machine/memory/memory';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { GEO_FAULT_CLIP_CAPACITY, GEO_STATUS_DONE, GEO_STATUS_ERROR } from '../../../machine/ts/machine/devices/geometry/contracts';
import { IO_GEO_STATUS, IRQ_GEO_ERROR } from '../../../machine/ts/spec/bmsx/io';
import { IO_GEO_DST1, IO_GEO_PROCESSED } from '../../../machine/ts/spec/bmsx/io';
import { cartridgeSlots } from '../../helpers/cartridge';
import { geometryVectors } from './vectors';

const command = process.argv.slice(2);
if (command.length === 0) {
	for (const args of [
		['-S', 'machine/cpp', '-B', 'build-cpp-tests', '-G', 'Ninja', '-DBMSX_BUILD_TESTS=ON'],
		['--build', 'build-cpp-tests', '--target', 'bmsx_geometry_conformance_runner', '--parallel', '4'],
	]) assert.equal(spawnSync('cmake', args, { stdio: 'inherit' }).status, 0);
	command.push('build-cpp-tests/bmsx_geometry_conformance_runner');
}
const directory = mkdtempSync(join(tmpdir(), 'bmsx-geometry-'));
const vectors = geometryVectors();
const path = join(directory, 'vectors.txt');
writeFileSync(path, vectors.map(v => [v.writes.length, ...v.writes.flat(), v.firstRecordPairs, v.pairCounterSeed, v.reads.length, ...v.reads].join(' ')).join('\n'));
const native = spawnSync(command[0], [...command.slice(1), path], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
assert.equal(native.status, 0, native.stderr);
const rows = native.stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
assert.equal(rows.length, vectors.length);
const memory = new Memory({ systemRom: new Uint8Array(), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
const machine = new Machine(memory, { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {} }, PSX_MACHINE_SPEC);
// Exercise the actual timer edges. A partial paid interval cannot commit a
// record or a completion; the phase edge itself may publish them.
function advanceGeometryEdge(): void {
	const scheduler = machine.scheduler, deadline = scheduler.nextDeadline();
	assert.ok(deadline >= scheduler.nowCycles && deadline < Number.MAX_SAFE_INTEGER, 'busy GEO must have a scheduled event');
	const delta = deadline - scheduler.nowCycles;
	if (delta > 0) {
		const status = memory.readMappedWord(IO_GEO_STATUS), processed = memory.readMappedWord(IO_GEO_PROCESSED);
		machine.advanceDevices(delta - 1);
		assert.equal(memory.readMappedWord(IO_GEO_STATUS), status, 'status is not published before the edge');
		assert.equal(memory.readMappedWord(IO_GEO_PROCESSED), processed, 'progress is not published before the edge');
		machine.advanceDevices(1);
	}
	while (scheduler.hasDueTimer()) machine.runDeviceService(scheduler.popDueTimer());
}
for (let i = 0; i < vectors.length; i++) {
	const v = vectors[i];
	machine.scheduler.reset();
	machine.resetDevices();
	machine.geometryController.setTiming(1, 1, 0);
	for (const [address, word] of v.writes) memory.writeMappedWord(address, word);
	const counterWords: number[] = [];
	if (v.firstRecordPairs !== 0) {
		machine.geometryController.setTiming(PSX_MACHINE_SPEC.cpuFreqHz, PSX_MACHINE_SPEC.geoWorkUnitsPerSec, 0);
	}
	if (v.pairCounterSeed !== 0) {
		const state = machine.geometryController.captureState();
		state.activeJob!.exactPairCount = v.pairCounterSeed;
		state.activeJob!.broadphasePairCount = v.pairCounterSeed;
		machine.geometryController.restoreState(state, machine.scheduler.nowCycles);
	}
	if (v.firstRecordPairs !== 0 || v.pairCounterSeed !== 0) {
		assert.equal(memory.readMappedWord(IO_GEO_PROCESSED), 0);
		while (memory.readMappedWord(IO_GEO_PROCESSED) === 0 && machine.geometryController.hasPendingWork()) advanceGeometryEdge();
		assert.equal(memory.readMappedWord(IO_GEO_PROCESSED), 1, `${v.name}: the first complete outer record is published`);
		if (v.firstRecordPairs !== 0) {
			counterWords.push(0, 1, memory.readMappedWord(memory.readMappedWord(IO_GEO_DST1)));
			assert.deepEqual(counterWords, [0, 1, v.firstRecordPairs], `${v.name}: every reached pair completes before outer progress`);
		} else {
			const progressed = machine.geometryController.captureState().activeJob!;
			counterWords.push(progressed.exactPairCount, progressed.broadphasePairCount);
			assert.deepEqual(counterWords, [(v.pairCounterSeed + 1) >>> 0, (v.pairCounterSeed + 1) >>> 0], `${v.name}: retained raw counters`);
		}
	}
	const clip = (machine.geometryController as unknown as {
		overlap2d: { writeClipVertex(buffer: Float64Array, index: number, x: number, y: number): void };
	}).overlap2d;
	const originalClipWrite = clip.writeClipVertex;
	let maxClipVertices = 0;
	if (v.clipCapacityBoundary !== 0) {
		clip.writeClipVertex = function(buffer, index, x, y) {
			maxClipVertices = Math.max(maxClipVertices, index + 1);
			originalClipWrite.call(this, buffer, index, x, y);
		};
	}
	while (machine.geometryController.hasPendingWork()) advanceGeometryEdge();
	clip.writeClipVertex = originalClipWrite;
	const expected = v.reads.map(address => memory.readMappedWord(address));
	if (v.clipCapacityBoundary !== 0) assert.equal(maxClipVertices, 128, `${v.name}: actual emitted workspace boundary`);
	if (v.clipCapacityBoundary === 129) {
		assert.deepEqual(expected.slice(0, 4), [GEO_STATUS_DONE | GEO_STATUS_ERROR, GEO_FAULT_CLIP_CAPACITY << 16, 0, IRQ_GEO_ERROR], v.name);
		assert.notDeepEqual(expected.slice(4, 13), Array(9).fill(0xdeadbeef), `${v.name}: earlier contact survives`);
		assert.deepEqual(expected.slice(13, 22), Array(9).fill(0xdeadbeef), `${v.name}: faulting contact is not written`);
		assert.deepEqual(expected.slice(22), [0, 0, 0, 0], `${v.name}: failing record does not refresh the summary`);
	} else {
		assert.equal(expected[0], GEO_STATUS_DONE, v.name);
	}
	assert.deepEqual(rows[i], [...counterWords, ...expected], `${v.name}: raw result/status words; evidence ${directory}`);
}
const compoundTie = rows[vectors.findIndex(vector => vector.name === 'overlap-compound-equal-depth')];
assert.deepEqual(compoundTie.slice(3, 12), rows[0].slice(3, 12), 'equal-depth compound contacts retain first A/B pieces and feature');
assert.equal(rows[0][12], 1, 'ordinary overlapping polygons publish a contact');
assert.equal(rows[1][12], 0, 'overlap excludes touching boundaries');
assert.equal(rows[5][3], 1, 'SAT publishes a hit');
assert.equal(rows[5][6], 3 * 65536, 'SAT depth stays Q16.16');
const completedClipPair = rows[vectors.findIndex(vector => vector.name === 'overlap-contact-before-clip-fault')];
const faultingClipPair = rows[vectors.findIndex(vector => vector.name === 'overlap-clip-129-after-contact')];
assert.deepEqual(faultingClipPair.slice(4, 13), completedClipPair.slice(4, 13),
	'all nine earlier contact words are unchanged when a later pair exceeds clipping capacity');
rmSync(directory, { recursive: true });
console.log(`GEO-PARITY:PASS (${vectors.length} RAM/MMIO vectors)`);
