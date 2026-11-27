import { nativeHeapReference } from '../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeometrySat2Phase, GeometrySat2Unit } from '../../machine/ts/machine/devices/geometry/sat2';
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

function fixture() {
	const memory = new Memory({ systemRom: new Uint8Array(), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	const record = GEO_BUFFERS, descriptors = record + 0x100, vertices = record + 0x200, result = record + 0x400;
	const job: GeometryJobState = { cmd: 0, src0: record, src1: descriptors, src2: vertices, dst0: result, dst1: 0,
		count: 1, param0: 0, param1: 0, stride0: 20, stride1: 16, stride2: 0,
		processed: 0, resultCount: 0, exactPairCount: 0, broadphasePairCount: 0 };
	for (const [i, word] of [0, 0, 0, 1, 0].entries()) memory.writeU32(record + i * 4, word);
	for (const [i, word] of [1, 4, 0, 0, 1, 4, 32, 0].entries()) memory.writeU32(descriptors + i * 4, word);
	for (const [i, word] of [0, 0, 0x40000, 0, 0x40000, 0x40000, 0, 0x40000,
		0x10000, 0x10000, 0x50000, 0x10000, 0x50000, 0x50000, 0x10000, 0x50000].entries()) memory.writeU32(vertices + i * 4, word);
	for (let i = 0; i < 5; ++i) memory.writeU32(result + i * 4, 0xdeadbeef);
	return { memory, job, vertices, result, unit: new GeometrySat2Unit(memory) };
}

test('SAT2 latches each polygon once and publishes only after compute cost', () => {
	const { memory, job, vertices, result, unit } = fixture();
	unit.beginJob(); unit.processStep(job);
	assert.equal(unit.progress().phase, GeometrySat2Phase.LoadA);
	assert.equal(unit.progress().pendingMemory.ramWords, 13);
	unit.processStep(job);
	assert.equal(unit.progress().phase, GeometrySat2Phase.LoadB);
	assert.equal(unit.progress().pendingMemory.ramWords, 8);
	const afterA = unit.captureState();
	memory.writeU32(vertices, 0x70000);
	unit.reset(); unit.restoreState(afterA); afterA.verticesA.fill(0xffffffff);
	unit.processStep(job);
	assert.equal(unit.progress().phase, GeometrySat2Phase.Compute);
	assert.equal(unit.progress().pendingMemory.ramWords, 8);
	memory.writeU32(vertices + 32, 0x70000);
	unit.processStep(job);
	assert.equal(unit.progress().phase, GeometrySat2Phase.Publish);
	assert.equal(unit.progress().pendingMemory.ramWords, 5);
	assert.equal(unit.progress().pendingWorkUnits, 108);
	assert.equal(memory.readU32(result), 0xdeadbeef);
	const beforePublish = unit.captureState();
	unit.reset(); unit.restoreState(beforePublish); beforePublish.result.fill(0xffffffff);
	unit.processStep(job);
	assert.equal(unit.progress().phase, GeometrySat2Phase.Complete);
	assert.equal(unit.progress().pendingMemory.ramWords, 0);
	assert.deepEqual([0, 1, 2, 3, 4].map(i => memory.readU32(result + i * 4)), [1, 0, 0x10000, 0x30000, 0]);
});

test('SAT2 early separation pays visited axes and zero edges fail without writes', () => {
	const { memory, job, vertices, result, unit } = fixture();
	for (let i = 0; i < 4; ++i) memory.writeU32(vertices + 32 + i * 8 + 4, 0xa0000 + (i >= 2 ? 0x40000 : 0));
	unit.beginJob(); for (let i = 0; i < 4; ++i) unit.processStep(job);
	assert.equal(unit.progress().phase, GeometrySat2Phase.Publish);
	assert.equal(unit.progress().pendingWorkUnits, 24);
	unit.processStep(job);
	assert.deepEqual([0, 1, 2, 3, 4].map(i => memory.readU32(result + i * 4)), [0, 0, 0, 0, 0]);
	for (let i = 0; i < 16; ++i) memory.writeU32(vertices + i * 4, 0);
	memory.writeU32(result, 0xdeadbeef);
	unit.beginJob(); for (let i = 0; i < 4; ++i) unit.processStep(job);
	assert.equal(unit.progress().phase, GeometrySat2Phase.Complete);
	assert.equal(unit.progress().pendingFault, geo.GEO_FAULT_DESCRIPTOR_KIND);
	assert.equal(unit.progress().pendingWorkUnits, 28);
	assert.equal(unit.progress().pendingMemory.ramWords, 0);
	assert.equal(memory.readU32(result), 0xdeadbeef);
});

test('SAT2 retains record validation order and reached bus reads', () => {
	const { memory, job, unit } = fixture();
	memory.writeU32(job.src0, 1); job.dst0 = 0xffffffff;
	unit.beginJob(); unit.processStep(job);
	assert.equal(unit.progress().pendingFault, geo.GEO_FAULT_BAD_RECORD_FLAGS);
	assert.equal(unit.progress().pendingMemory.ramWords, 5);
	memory.writeU32(job.src0, 0);
	unit.beginJob(); unit.processStep(job);
	assert.equal(unit.progress().pendingFault, geo.GEO_FAULT_DST_RANGE);
	assert.equal(unit.progress().pendingMemory.ramWords, 5);
});

function controllerCase() {
	const f = fixture();
	const machine = new Machine(f.memory, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {},
	}, PSX_MACHINE_SPEC);
	machine.resetDevices(); machine.scheduler.reset();
	assert.ok(nativeHeapReference(machine.cpu).heapAllocator.setFloor(GEO_BUFFERS + 0x1000));
	machine.geometryController.setTiming(PSX_MACHINE_SPEC.cpuFreqHz, PSX_MACHINE_SPEC.geoWorkUnitsPerSec);
	for (const [address, word] of [
		[io.IO_GEO_SRC0, f.job.src0], [io.IO_GEO_SRC1, f.job.src1], [io.IO_GEO_SRC2, f.job.src2],
		[io.IO_GEO_DST0, f.job.dst0], [io.IO_GEO_COUNT, 1],
		[io.IO_GEO_STRIDE0, f.job.stride0], [io.IO_GEO_STRIDE1, f.job.stride1],
	]) f.memory.writeMappedWord(address, word);
	f.memory.writeMappedWord(io.IO_GEO_CMD, geo.IO_CMD_GEO_SAT2_BATCH);
	function step() {
		const deadline = machine.scheduler.nextDeadline();
		assert.notEqual(deadline, Number.MAX_SAFE_INTEGER);
		machine.scheduler.advanceTo(deadline);

		assert.equal(machine.scheduler.popDueTimer(), DEVICE_SERVICE_GEO);
		machine.geometryController.onService(deadline);
	}
	return { ...f, machine, step };
}

test('SAT2 controller deadlines and restored pending result preserve sampling and publication order', () => {
	const { memory, vertices, result, machine, step } = controllerCase();
	const controller = machine.geometryController;
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_BUSY);
	step();
	assert.equal(controller.captureState().sat.phase, GeometrySat2Phase.LoadA);
	assert.equal(controller.captureState().pendingCycles, 13);
	step();
	assert.equal(controller.captureState().sat.phase, GeometrySat2Phase.LoadB);
	assert.equal(controller.captureState().pendingCycles, 8);
	const afterA = controller.captureState();
	memory.writeU32(vertices, 0x70000);
	controller.reset(); controller.restoreState(afterA, machine.scheduler.nowCycles);
	step();
	assert.equal(controller.captureState().sat.phase, GeometrySat2Phase.Compute);
	assert.equal(controller.captureState().pendingCycles, 8);
	memory.writeU32(vertices + 32, 0x70000);
	step();
	assert.equal(controller.captureState().sat.phase, GeometrySat2Phase.Publish);
	const debt = controller.captureState().pendingCycles;
	assert.equal(debt, 229, '108 work units and five result words use the installed clock');
	const now = machine.scheduler.nowCycles;
	machine.scheduler.advanceTo(now + debt - 1);

	assert.equal(memory.readU32(result), 0xdeadbeef);
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_BUSY);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 0);
	const beforePublish = controller.captureState();
	controller.reset(); controller.restoreState(beforePublish, machine.scheduler.nowCycles);
	step();
	assert.deepEqual([0, 1, 2, 3, 4].map(i => memory.readU32(result + i * 4)), [1, 0, 0x10000, 0x30000, 0]);
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_DONE);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 1);
	assert.equal(machine.scheduler.nowCycles, 258);
});

test('SAT2 controller abort discards prepaid unpublished result', () => {
	const { memory, result, machine, step } = controllerCase();
	for (let i = 0; i < 4; ++i) step();
	assert.equal(machine.geometryController.captureState().sat.phase, GeometrySat2Phase.Publish);
	memory.writeMappedWord(io.IO_GEO_CTRL, geo.GEO_CTRL_ABORT);
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_DONE | geo.GEO_STATUS_ERROR);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 0);
	assert.equal(memory.readU32(result), 0xdeadbeef);
	assert.equal(machine.scheduler.nextDeadline(), Number.MAX_SAFE_INTEGER);
});

test('SAT2 largest legal polygons use bounded raw vertex loads and axis work', () => {
	const { memory, job, vertices, unit } = fixture();
	memory.writeU32(job.src1 + geo.GEO_SAT2_DESC_VERTEX_COUNT_OFFSET, 64);
	memory.writeU32(job.src1 + 16 + geo.GEO_SAT2_DESC_VERTEX_COUNT_OFFSET, 64);
	memory.writeU32(job.src1 + 16 + geo.GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET, 512);
	job.dst0 = GEO_BUFFERS + 0x800;
	for (let i = 0; i < 256; ++i) memory.writeU32(vertices + i * 4, 0);
	unit.beginJob(); unit.processStep(job);
	assert.equal(unit.progress().phase, GeometrySat2Phase.LoadA);
	unit.processStep(job);
	assert.equal(unit.progress().pendingMemory.ramWords, 128);
	unit.processStep(job);
	assert.equal(unit.progress().pendingMemory.ramWords, 128);
	unit.processStep(job);
	assert.equal(unit.progress().phase, GeometrySat2Phase.Complete);
	assert.equal(unit.progress().pendingFault, geo.GEO_FAULT_DESCRIPTOR_KIND);
	assert.equal(unit.progress().pendingWorkUnits, 388);
});
