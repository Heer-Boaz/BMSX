import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GeometryOverlap2dPhase, GeometryOverlap2dUnit } from '../../machine/ts/machine/devices/geometry/overlap2d';
import type { GeometryJobState } from '../../machine/ts/machine/devices/geometry/job';
import * as geo from '../../machine/ts/machine/devices/geometry/contracts';
import { geometryByteAddr } from '../../machine/ts/machine/devices/geometry/addressing';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { Machine } from '../../machine/ts/machine/machine';
import * as io from '../../machine/ts/spec/bmsx/io';
import { IO_WORD_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { geometryVectors } from '../conformance/geometry/vectors';
import { cartridgeSlots } from '../helpers/cartridge';

function overlapCase() {
	const vector = geometryVectors().find(vector => vector.name === 'overlap-overlap')!;
	const memory = new Memory({ systemRom: new Uint8Array(), cartridgeSlots: cartridgeSlots() }, PSX_MACHINE_SPEC.ramBytes);
	for (const [address, word] of vector.writes) memory.writeMappedWord(address, word);
	const read = (address: number) => memory.readMappedWord(address);
	const job: GeometryJobState = {
		cmd: read(io.IO_GEO_CMD), src0: read(io.IO_GEO_SRC0), src1: read(io.IO_GEO_SRC1), src2: read(io.IO_GEO_SRC2),
		dst0: read(io.IO_GEO_DST0), dst1: read(io.IO_GEO_DST1), count: read(io.IO_GEO_COUNT),
		param0: read(io.IO_GEO_PARAM0), param1: read(io.IO_GEO_PARAM1),
		stride0: read(io.IO_GEO_STRIDE0), stride1: read(io.IO_GEO_STRIDE1), stride2: read(io.IO_GEO_STRIDE2),
		processed: 0, resultCount: 0, exactPairCount: 0, broadphasePairCount: 0,
	};
	return { memory, job, unit: new GeometryOverlap2dUnit(memory) };
}

function resultWords(memory: Memory, job: GeometryJobState): number[] {
	return Array.from({ length: geo.GEO_OVERLAP2D_RESULT_BYTES / IO_WORD_SIZE }, (_, word) => memory.readU32(job.dst0 + word * IO_WORD_SIZE));
}

test('one GEO step is bounded independently of the full-pass instance count', () => {
	const { memory, job, unit } = overlapCase();
	job.count = 0xffffffff;
	let reads = 0;
	const read = memory.readU32.bind(memory);
	memory.readU32 = (address, counters) => { reads += 1; return read(address, counters); };
	const maxPieceReads = 2 * (geo.GEO_OVERLAP2D_SHAPE_DESC_BYTES / IO_WORD_SIZE + geo.GEO_OVERLAP2D_MAX_POLY_VERTICES * 2);
	for (const phase of [GeometryOverlap2dPhase.Pair, GeometryOverlap2dPhase.Piece, GeometryOverlap2dPhase.CompletePiece]) {
		reads = 0;
		assert.equal(unit.processStep(job), 0);
		assert.equal(unit.readProgress().phase, phase);
		assert.ok(reads <= maxPieceReads, 'a step never follows the remaining outer/compound pair loops');
		assert.equal(job.resultCount, 0);
	}
	assert.deepEqual(resultWords(memory, job), Array(9).fill(0xdeadbeef), 'calculation does not publish its contact');
	assert.equal(unit.readProgress().pendingWork.axes, 8);
	assert.equal(unit.readProgress().pendingWork.squareRoots, 8);
	assert.equal(unit.readProgress().pendingWork.projectionVertices, 64);
	assert.equal(unit.processStep(job), 0);
	assert.equal(unit.readProgress().phase, GeometryOverlap2dPhase.Publish);
	assert.equal(unit.readProgress().pendingMemory.ramWords, 9, 'contact writes are priced before publication');
	assert.deepEqual(resultWords(memory, job), Array(9).fill(0xdeadbeef));
	assert.equal(unit.processStep(job), 0);
	assert.equal(unit.readProgress().phase, GeometryOverlap2dPhase.Pair);
	assert.equal(unit.readProgress().instanceBIndex, 2);
	assert.equal(job.resultCount, 1);
});

test('a GEO contact survives a checkpoint between calculation and publication without rereading source data', () => {
	const { memory, job, unit } = overlapCase();
	for (let step = 0; step < 3; ++step) assert.equal(unit.processStep(job), 0);
	const checkpoint = unit.captureState();
	assert.equal(checkpoint.phase, GeometryOverlap2dPhase.CompletePiece);
	const shape = memory.readU32(job.src0 + geo.GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET);
	const vertices = geometryByteAddr(shape, memory.readU32(shape + geo.GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET));
	for (let word = 0; word < 8; ++word) memory.writeU32(vertices + word * IO_WORD_SIZE, 0);
	unit.reset();
	assert.equal(checkpoint.pendingWork.axes, 8, 'reset does not mutate a captured checkpoint');
	assert.equal(checkpoint.instanceB[geo.GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET / IO_WORD_SIZE] !== 0, true);
	unit.restoreState(checkpoint);
	checkpoint.instanceA.fill(0);
	checkpoint.pendingWork.axes = 0;
	assert.equal(unit.readProgress().pendingWork.axes, 8, 'restore does not borrow checkpoint storage');
	let reads = 0;
	const read = memory.readU32.bind(memory);
	memory.readU32 = (address, counters) => { reads += 1; return read(address, counters); };
	assert.equal(unit.processStep(job), 0);
	assert.equal(unit.readProgress().phase, GeometryOverlap2dPhase.Publish);
	assert.equal(unit.readProgress().pendingMemory.ramWords, 13, 'contact and summary wait for their write budget');
	assert.equal(unit.processStep(job), 0);
	assert.equal(reads, 0, 'publication consumes the retained contact, not the now-modified polygon');
	assert.deepEqual(resultWords(memory, job), [0, 0xbf800000, 0x40400000, 0x40200000, 0x40200000, 0, 0, 0, 1]);
});

test('one GEO step does not exhaust either unbounded compound-piece dimension', () => {
	for (const side of [0, 1]) {
		const { memory, job, unit } = overlapCase();
		const instance = job.src0 + side * geo.GEO_OVERLAP2D_INSTANCE_BYTES;
		const shape = memory.readU32(instance + geo.GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET);
		const compound = job.src0 + 2 * geo.GEO_OVERLAP2D_INSTANCE_BYTES;
		memory.writeU32(compound + geo.GEO_OVERLAP2D_SHAPE_KIND_OFFSET, geo.GEO_OVERLAP2D_SHAPE_KIND_COMPOUND);
		memory.writeU32(compound + geo.GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET, 0xffffffff);
		memory.writeU32(compound + geo.GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET, shape - compound);
		memory.writeU32(compound + geo.GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET,
			shape + memory.readU32(shape + geo.GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET) - compound);
		memory.writeU32(instance + geo.GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET, compound);
		for (let step = 0; step < 4; ++step) assert.equal(unit.processStep(job), 0);
		const progress = unit.readProgress();
		assert.equal(progress.phase, GeometryOverlap2dPhase.Piece);
		assert.equal(progress.pieceA, side === 0 ? 1 : 0);
		assert.equal(progress.pieceB, side === 1 ? 1 : 0);
		assert.equal(progress.pendingFault, 0);
		assert.equal(job.resultCount, 0, 'best-contact reduction waits for all visited pieces');
		assert.deepEqual(resultWords(memory, job), Array(9).fill(0xdeadbeef));
	}
});

function overlapMachine() {
	const { memory, job } = overlapCase();
	const machine = new Machine(memory, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {},
	}, PSX_MACHINE_SPEC);
	machine.resetDevices();
	machine.scheduler.reset();
	const vector = geometryVectors().find(vector => vector.name === 'overlap-overlap')!;
	for (const [address, word] of vector.writes) memory.writeMappedWord(address, word);
	let now = 0;
	return { memory, job, machine, advance(cycles: number) {
		now += cycles;
		machine.scheduler.advanceTo(now);
		machine.geometryController.accrueCycles(cycles, now);
		machine.geometryController.onService(now);
		return now;
	} };
}

test('GEO retains BUSY, progress and contact until both compute and output deadlines are paid', () => {
	const { memory, job, machine, advance } = overlapMachine();
	const controller = machine.geometryController;
	controller.onService(0);
	assert.equal(controller.captureState().pendingCycles, 4, 'initial summary waits for four write cycles');
	advance(4);
	assert.equal(controller.captureState().pendingCycles, 26, 'the bounded header group reads the two instances, bounds and shape headers');
	advance(26);
	const calculated = controller.captureState();
	assert.equal(calculated.overlap.phase, GeometryOverlap2dPhase.CompletePiece);
	assert.ok(calculated.pendingCycles > calculated.overlap.pendingMemory.ramWords, 'actual math work adds to the operand cost');
	advance(calculated.pendingCycles - 1);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 0);
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_BUSY);
	assert.deepEqual(resultWords(memory, job), Array(9).fill(0xdeadbeef));
	const checkpoint = controller.captureState();
	assert.equal(checkpoint.pendingCycles, 1);
	controller.reset();
	controller.restoreState(checkpoint, machine.scheduler.nowCycles);
	assert.equal(machine.scheduler.nextDeadline(), machine.scheduler.nowCycles + 1, 'restore retains remaining device time');
	advance(1);
	assert.equal(controller.captureState().overlap.phase, GeometryOverlap2dPhase.Publish);
	assert.equal(controller.captureState().pendingCycles, 13, 'nine contact and four summary words must be paid before output');
	advance(12);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 0);
	assert.deepEqual(resultWords(memory, job), Array(9).fill(0xdeadbeef));
	advance(1);
	assert.deepEqual(resultWords(memory, job), [0, 0xbf800000, 0x40400000, 0x40200000, 0x40200000, 0, 0, 0, 1]);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 1);
	assert.equal(memory.readU32(job.dst1), 1);
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_BUSY, 'the final outer record still has its own read/summary phase');
	assert.equal(controller.captureState().pendingCycles, 9);
	advance(9);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 2);
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_DONE);
	assert.equal(memory.readMappedWord(io.IO_IRQ_FLAGS) & io.IRQ_GEO_DONE, io.IRQ_GEO_DONE);
});

test('GEO ABORT discards an unpaid contact without publishing its result or progress', () => {
	const { memory, job, machine, advance } = overlapMachine();
	const controller = machine.geometryController;
	controller.onService(0);
	assert.equal(controller.captureState().pendingCycles, 4, 'initial summary waits for four write cycles');
	advance(4);
	advance(controller.captureState().pendingCycles);
	advance(controller.captureState().pendingCycles);
	assert.equal(controller.captureState().overlap.phase, GeometryOverlap2dPhase.Publish);
	assert.equal(controller.captureState().pendingCycles, 13);
	memory.writeMappedWord(io.IO_GEO_CTRL, geo.GEO_CTRL_ABORT);
	advance(13);
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_DONE | geo.GEO_STATUS_ERROR);
	assert.equal(memory.readIoU32(io.IO_GEO_FAULT) >>> geo.GEO_FAULT_CODE_SHIFT, geo.GEO_FAULT_ABORTED);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 0);
	assert.deepEqual(resultWords(memory, job), Array(9).fill(0xdeadbeef));
	assert.equal(memory.readU32(job.dst1), 0, 'an aborted provisional contact does not refresh the launch summary');
});

test('GEO defers a piece fault until the already sampled operands have been paid', () => {
	const { memory, job, machine, advance } = overlapMachine();
	const shapeB = memory.readU32(job.src0 + geo.GEO_OVERLAP2D_INSTANCE_BYTES + geo.GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET);
	memory.writeU32(shapeB + geo.GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET, 0x40000000);
	const controller = machine.geometryController;
	controller.onService(0);
	assert.equal(controller.captureState().pendingCycles, 4, 'initial summary waits for four write cycles');
	advance(4);
	advance(controller.captureState().pendingCycles);
	const faulting = controller.captureState();
	assert.equal(faulting.overlap.pendingFault, geo.GEO_FAULT_BAD_VERTEX_COUNT);
	assert.ok(faulting.pendingCycles > 0);
	advance(faulting.pendingCycles - 1);
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_BUSY);
	assert.equal(memory.readIoU32(io.IO_GEO_FAULT), 0);
	assert.deepEqual(resultWords(memory, job), Array(9).fill(0xdeadbeef));
	const checkpoint = controller.captureState();
	controller.reset();
	controller.restoreState(checkpoint, machine.scheduler.nowCycles);
	advance(1);
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_DONE | geo.GEO_STATUS_ERROR);
	assert.equal(memory.readIoU32(io.IO_GEO_FAULT) >>> geo.GEO_FAULT_CODE_SHIFT, geo.GEO_FAULT_BAD_VERTEX_COUNT);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 0);
	assert.deepEqual(resultWords(memory, job), Array(9).fill(0xdeadbeef));
});

test('GEO coalesces cheap rejected headers into a bounded read group rather than one event per pair', () => {
	const { memory, job, machine, advance } = overlapMachine();
	memory.writeMappedWord(io.IO_GEO_CTRL, geo.GEO_CTRL_ABORT);
	memory.writeMappedWord(io.IO_GEO_FAULT_ACK, 1);
	const instances = job.src0 + 0x1000;
	const shape = memory.readU32(job.src0);
	for (let index = 0; index < 64; ++index) {
		const address = instances + index * geo.GEO_OVERLAP2D_INSTANCE_BYTES;
		memory.writeU32(address, shape);
		for (let word = 1; word < geo.GEO_OVERLAP2D_INSTANCE_WORDS; ++word) memory.writeU32(address + word * IO_WORD_SIZE, 0);
	}
	memory.writeMappedWord(io.IO_GEO_SRC0, instances);
	memory.writeMappedWord(io.IO_GEO_COUNT, 64);
	memory.writeMappedWord(io.IO_GEO_CMD, job.cmd);
	advance(4);
	const state = machine.geometryController.captureState();
	assert.equal(state.overlap.phase, GeometryOverlap2dPhase.Pair);
	assert.ok(state.overlap.instanceBIndex > 1 && state.overlap.instanceBIndex < 64, 'one group covers multiple but not all remaining pairs');
	assert.equal(state.pendingCycles, state.overlap.instanceBIndex * geo.GEO_OVERLAP2D_INSTANCE_WORDS);
	assert.ok(state.pendingCycles <= io.DMA_BURST_WORD_CAPACITY);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 0);
	assert.equal(state.activeJob!.broadphasePairCount, 0);
});

test('even an empty GEO overlap job pays its initial summary before DONE', () => {
	const { memory, job, advance } = overlapMachine();
	memory.writeMappedWord(io.IO_GEO_CTRL, geo.GEO_CTRL_ABORT);
	memory.writeMappedWord(io.IO_GEO_FAULT_ACK, 1);
	memory.writeU32(job.dst1, 0xdeadbeef);
	memory.writeMappedWord(io.IO_GEO_COUNT, 0);
	memory.writeMappedWord(io.IO_GEO_CMD, job.cmd);
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_BUSY);
	advance(3);
	assert.equal(memory.readU32(job.dst1), 0xdeadbeef);
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_BUSY);
	advance(1);
	assert.equal(memory.readU32(job.dst1), 0);
	assert.equal(memory.readIoU32(io.IO_GEO_STATUS), geo.GEO_STATUS_DONE);
	assert.equal(memory.readIoU32(io.IO_GEO_PROCESSED), 0);
});


test('GEO summary planning and publication retain 32-bit address-word wrapping', () => {
	const { memory, job, unit } = overlapCase();
	job.dst1 = 0xfffffffc;
	unit.beginJob(job);
	assert.deepEqual(unit.readProgress().pendingMemory, { ramWords: 0, systemRomWords: 3, cartridgeWords: 0, otherWords: 1 });
	const addresses: number[] = [];
	const write = memory.writeU32.bind(memory);
	memory.writeU32 = (address, word) => { addresses.push(address); write(address, word); };
	assert.equal(unit.processStep(job), 0);
	assert.deepEqual(addresses, [0xfffffffc, 0, 4, 8]);
});
