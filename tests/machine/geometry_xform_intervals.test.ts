import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeometryXform2Phase, GeometryXform2Unit } from '../../machine/ts/machine/devices/geometry/xform2';
import type { GeometryJobState } from '../../machine/ts/machine/devices/geometry/job';
import * as geo from '../../machine/ts/machine/devices/geometry/contracts';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { Machine } from '../../machine/ts/machine/machine';
import { DEVICE_SERVICE_GEO } from '../../machine/ts/machine/scheduler/device';
import * as io from '../../machine/ts/spec/bmsx/io';
import { cartridgeSlots } from '../helpers/cartridge';

// Public fixture RAM for GEO operands and results.
const GEO_BUFFERS = DYNAMIC_RAM_BASE + 0x10000;

function fixture(count = 2) {
	const memory = new Memory({ systemRom: new Uint8Array(), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const record = GEO_BUFFERS, vertices = record + 0x100, matrix = record + 0x1000, bounds = record + 0x2000;
	const job: GeometryJobState = { cmd: 0, src0: record, src1: vertices, src2: matrix, dst0: vertices + 8, dst1: bounds,
		count: 1, param0: 0, param1: 0, stride0: 24, stride1: 8, stride2: 24,
		processed: 0, resultCount: 0, exactPairCount: 0, broadphasePairCount: 0 };
	for (const [i, word] of [0, 0, 0, 0, count, 0].entries()) memory.writeU32(record + i * 4, word);
	for (const [i, word] of [0x10000, 0, 0x10000, 0, 0x10000, 0].entries()) memory.writeU32(matrix + i * 4, word);
	for (let i = 0; i < count; ++i) {
		memory.writeU32(vertices + i * 8, i === 0 ? 0x10000 : 0x50000);
		memory.writeU32(vertices + i * 8 + 4, i === 0 ? 0x20000 : 0x60000);
	}
	memory.writeU32(vertices + count * 8, 0xdeadbeef);
	return { memory, job, vertices, bounds, unit: new GeometryXform2Unit(memory) };
}

test('XFORM snapshots complete input before any overlapping output and retains the pending buffer across restore', () => {
	const { memory, job, vertices, bounds, unit } = fixture();
	const seed = unit.captureState(); seed.vertices[127] = 0xabcdef01; unit.restoreState(seed);
	unit.beginJob(); unit.processStep(job);
	assert.equal(unit.progress().phase, GeometryXform2Phase.Publish);
	assert.equal(unit.progress().pendingMemory.ramWords, 24);
	assert.equal(unit.progress().pendingWorkUnits, 2);
	assert.equal(unit.progress().vertices[127], 0xabcdef01);
	assert.equal(memory.readU32(vertices + 8), 0x50000);
	const checkpoint = unit.captureState();
	memory.writeU32(vertices, 0x90000); memory.writeU32(job.src2 + 8, 0x70000);
	unit.reset(); unit.restoreState(checkpoint); checkpoint.vertices.fill(0); checkpoint.bounds.fill(0);
	unit.processStep(job);
	assert.equal(unit.progress().phase, GeometryXform2Phase.Complete);
	assert.deepEqual([0, 1, 2, 3].map(i => memory.readU32(vertices + 8 + i * 4)), [0x20000, 0x20000, 0x60000, 0x60000]);
	assert.deepEqual([0, 1, 2, 3].map(i => memory.readU32(bounds + i * 4)), [0x20000, 0x20000, 0x60000, 0x60000]);
});

test('XFORM preserves fault priority and does not read spans for zero vertices', () => {
	const { memory, job, unit } = fixture();
	memory.writeU32(job.src0, 1);
	memory.writeU32(job.src0 + geo.GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET, geo.GEO_XFORM2_MAX_VERTICES + 1);
	unit.beginJob(); unit.processStep(job);
	assert.equal(unit.progress().pendingFault, geo.GEO_FAULT_BAD_RECORD_FLAGS);
	assert.equal(unit.progress().pendingMemory.ramWords, 6);
	memory.writeU32(job.src0, 0); unit.beginJob(); unit.processStep(job);
	assert.equal(unit.progress().pendingFault, geo.GEO_FAULT_BAD_VERTEX_COUNT);
	memory.writeU32(job.src0 + geo.GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET, 0);
	job.src1 = job.src2 = job.dst0 = job.dst1 = 0xffffffff;
	unit.beginJob(); unit.processStep(job);
	assert.equal(unit.progress().phase, GeometryXform2Phase.Complete);
	assert.equal(unit.progress().pendingFault, 0);
	assert.equal(unit.progress().pendingMemory.ramWords, 6);
});

function controllerCase(count = 2) {
	const f = fixture(count);
	const machine = new Machine(f.memory, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {},
	}, PSX_MACHINE_SPEC);
	machine.resetDevices(); machine.scheduler.reset();
	assert.ok(machine.cpu.heapAllocator.setFloor(GEO_BUFFERS + 0x3000));
	machine.geometryController.setTiming(PSX_MACHINE_SPEC.cpuFreqHz, PSX_MACHINE_SPEC.geoWorkUnitsPerSec);
	for (const [address, word] of [
		[io.IO_GEO_SRC0, f.job.src0], [io.IO_GEO_SRC1, f.job.src1], [io.IO_GEO_SRC2, f.job.src2],
		[io.IO_GEO_DST0, f.job.dst0], [io.IO_GEO_DST1, f.job.dst1], [io.IO_GEO_COUNT, 1],
		[io.IO_GEO_STRIDE0, f.job.stride0], [io.IO_GEO_STRIDE1, f.job.stride1], [io.IO_GEO_STRIDE2, f.job.stride2],
	]) f.memory.writeMappedWord(address, word);
	f.memory.writeMappedWord(io.IO_GEO_CMD, geo.IO_CMD_GEO_XFORM2_BATCH);
	function step() {
		const deadline = machine.scheduler.nextDeadline();
		assert.notEqual(deadline, Number.MAX_SAFE_INTEGER);
		machine.scheduler.advanceTo(deadline);

		assert.equal(machine.scheduler.popDueTimer(), DEVICE_SERVICE_GEO);
		machine.geometryController.onService(deadline);
	}
	return { ...f, machine, step };
}

test('XFORM controller pays the whole bounded record before publication, including restore', () => {
	const { memory, vertices, bounds, machine, step } = controllerCase();
	const controller = machine.geometryController;
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_BUSY);
	step();
	assert.equal(controller.captureState().pendingCycles, 29);
	assert.equal(controller.captureState().xform.phase, GeometryXform2Phase.Publish);
	const now = machine.scheduler.nowCycles;
	machine.scheduler.advanceTo(now + 28);
	assert.equal(memory.readU32(vertices + 8), 0x50000);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 0);
	const checkpoint = controller.captureState(); controller.reset(); controller.restoreState(checkpoint, machine.scheduler.nowCycles);
	step();
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_DONE);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 1);
	assert.deepEqual([0, 1, 2, 3].map(i => memory.readU32(vertices + 8 + i * 4)), [0x20000, 0x20000, 0x60000, 0x60000]);
	assert.deepEqual([0, 1, 2, 3].map(i => memory.readU32(bounds + i * 4)), [0x20000, 0x20000, 0x60000, 0x60000]);
});

test('XFORM controller abort one cycle before publication discards the pending buffer', () => {
	const { memory, vertices, machine, step } = controllerCase();
	step();
	const controller = machine.geometryController, now = machine.scheduler.nowCycles;
	machine.scheduler.advanceTo(now + 28);
	memory.writeMappedWord(io.IO_GEO_CTRL, geo.GEO_CTRL_ABORT);
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_DONE | geo.GEO_STATUS_ERROR);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 0);
	assert.equal(memory.readU32(vertices + 8), 0x50000);
	assert.equal(machine.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
});

test('a 64-vertex record is bounded to one paid interval and two timer services', () => {
	const { machine, step } = controllerCase(64);
	step();
	assert.equal(machine.geometryController.captureState().xform.pendingMemory.ramWords, 272);
	assert.equal(machine.geometryController.captureState().pendingCycles, 405);
	step();
	assert.equal(machine.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
});
