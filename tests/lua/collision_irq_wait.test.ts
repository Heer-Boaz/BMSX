import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { MAX_OP_BITS, packInstructionWord } from '../../machine/ts/spec/blua32/instruction_format';
import { GEO_STATUS_BUSY, GEO_STATUS_DONE, GEO_OVERLAP2D_MODE_FULL_PASS, GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB, IO_CMD_GEO_OVERLAP2D_PASS } from '../../machine/ts/machine/devices/geometry/contracts';
import { IO_GEO_STATUS, IO_IRQ_FLAGS, IRQ_GEO_DONE, IO_GEO_SRC0, IO_GEO_DST0, IO_GEO_DST1, IO_GEO_COUNT, IO_GEO_CMD, IO_GEO_PARAM0, IO_GEO_PARAM1, IO_GEO_STRIDE0 } from '../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { compileCartlibProgram } from '../helpers/cartlib_cpu';
import { cartridgeSlots } from '../helpers/cartridge';

const marker = 0x080d0000, shape = 0x080d0100;
const opcodeMask = packInstructionWord((1 << MAX_OP_BITS) - 1, 0, 0, 0);
const haltOpcode = packInstructionWord(OpCode.HALT, 0, 0, 0);
const modules = ['cartlib/irq', 'cartlib/irq/source', 'cartlib/collision/collision_2d']
	.map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') }));
const source = `
local collision<const> = require('cartlib/collision/collision_2d')
local shape<const> = ${shape}
local function resolve_shape(_self) return shape end
local a<const> = { wox=0, woy=0, layer=1, mask=0, resolve_shape=resolve_shape }
local b<const> = { wox=0, woy=0, layer=1, mask=0, resolve_shape=resolve_shape }
local colliders<const> = { a, b }
local pairs<const> = { get = function() error('unexpected contact') end }
mem[${marker}] = 1
local count<const> = collision.collect_overlaps(colliders, 2, pairs)
mem[${marker}] = 2 + count
while true do halt_until_irq end
`;
for (const mode of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) test(`real cartlib GEO wait, mode ${mode}`, () => {
	const { images } = compileCartlibProgram(source, { modules, optLevel: 3 });
	const runtime = new Runtime({ systemRomBytes: images.systemRomBytes, cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend: mode }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const memory = runtime.machine.memory, cpu = runtime.machine.cpu;
	for (let step = 0; step < 100000 && memory.readU32(marker) === 0; ++step) runtime.frameScheduler.runCyclesToNextLogicalTick(16);
	assert.equal(memory.readU32(marker), 1, 'real cart reached public collision query');
	for (let step = 0; step < 100000 && (memory.readMappedWord(IO_GEO_STATUS) & GEO_STATUS_BUSY) === 0; ++step) runtime.frameScheduler.runCyclesToNextLogicalTick(1);
	assert.equal(memory.readMappedWord(IO_GEO_STATUS) & GEO_STATUS_BUSY, GEO_STATUS_BUSY, 'the guest has submitted the real GEO task');
	assert.equal(cpu.isHaltedUntilIrq(), false, 'the CPU has not yet reached the wait');
	// Force device progress before the CPU enters the public collision wait.
	runtime.frameScheduler.runDevicesToNextLogicalTick(1000);
	assert.equal(memory.readMappedWord(IO_GEO_STATUS) & GEO_STATUS_DONE, GEO_STATUS_DONE, 'GEO completes while execution is suspended');
	assert.notEqual(memory.readMappedWord(IO_IRQ_FLAGS) & IRQ_GEO_DONE, 0, 'real GEO completion requests its IRQ');
	let sawAccepted = false, consumedAtHalt = false;
	for (let step = 0; step < 100000 && memory.readU32(marker) === 1; ++step) {
		const geoStatus = memory.readMappedWord(IO_GEO_STATUS);
		if (cpu.isHaltedUntilIrq() && (geoStatus & GEO_STATUS_DONE) !== 0 && (memory.readMappedWord(IO_IRQ_FLAGS) & IRQ_GEO_DONE) === 0) break;
		const snapshot = cpu.captureRuntimeState();
		const event = snapshot.interruptEventPending;
		const depth = cpu.getFrameDepth();
		const pc = depth > 0 ? cpu.readFramePc(depth - 1) : 0;
		const opcode = pc === 0 ? -1 : memory.readMappedWord(pc) & opcodeMask;
		if (geoStatus !== 0 && event) sawAccepted = true;
		runtime.frameScheduler.runCyclesToNextLogicalTick(1);
		if (event && opcode === haltOpcode && !cpu.captureRuntimeState().interruptEventPending) consumedAtHalt = true;
	}
	assert.equal(memory.readU32(marker), 2, 'real public query finishes without an extra interrupt');
	assert.ok(sawAccepted, 'GEO completion is accepted before the wait has finished');
	assert.ok(consumedAtHalt, 'the wait HALT consumes the preaccepted event');
});

const conditionSource = `
local irq<const> = require('cartlib/irq')
local source<const> = require('cartlib/irq/source')
bss done: word
irq.register(source.geo_done, function() *done = 1 end)
local instances<const>: *word = 0x080d2000
for i = 0, 15 do
 instances[i * 5] = ${shape}
 instances[i * 5 + 1] = 0
 instances[i * 5 + 2] = 0
 instances[i * 5 + 3] = 1
 instances[i * 5 + 4] = 0
end
mem[${IO_GEO_SRC0}] = 0x080d2000
mem[${IO_GEO_DST0}] = 0x080d4000
mem[${IO_GEO_DST1}] = 0x080d4100
mem[${IO_GEO_COUNT}] = 16
mem[${IO_GEO_PARAM0}] = ${GEO_OVERLAP2D_MODE_FULL_PASS | GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB}
mem[${IO_GEO_PARAM1}] = 0
mem[${IO_GEO_STRIDE0}] = 20
mem[${marker}] = 1
mem[${IO_GEO_CMD}] = ${IO_CMD_GEO_OVERLAP2D_PASS}
while *done == 0 do halt_until_irq end
mem[${marker}] = 2
while true do halt_until_irq end
`;
for (const mode of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) test(`predicate-to-HALT race uses the retained GEO event, mode ${mode}`, () => {
	const { images } = compileCartlibProgram(conditionSource, { modules: modules.filter(module => module.path !== 'cartlib/collision/collision_2d'), optLevel: 3 });
	const runtime = new Runtime({ systemRomBytes: images.systemRomBytes, cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend: mode }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh() { return false; }, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const memory = runtime.machine.memory, cpu = runtime.machine.cpu;
	for (let step = 0; step < 100000 && memory.readU32(marker) === 0; ++step) runtime.frameScheduler.runCyclesToNextLogicalTick(16);
	assert.equal(memory.readU32(marker), 1);
	let reachedHalt = false;
	for (let step = 0; step < 100000; ++step) {
		const status = memory.readMappedWord(IO_GEO_STATUS);
		const depth = cpu.getFrameDepth();
		const pc = depth > 0 ? cpu.readFramePc(depth - 1) : 0;
		const opcode = pc === 0 ? -1 : memory.readMappedWord(pc) & opcodeMask;
		if ((status & GEO_STATUS_BUSY) !== 0 && opcode === haltOpcode) { reachedHalt = true; break; }
		runtime.frameScheduler.runCyclesToNextLogicalTick(1);
	}
	assert.ok(reachedHalt, 'the guest read the false predicate and is about to execute HALT');
	assert.equal(cpu.isHaltedUntilIrq(), false);
	// Inject the real completion after the predicate read but before HALT.
	runtime.frameScheduler.runDevicesToNextLogicalTick(10000);
	assert.equal(memory.readMappedWord(IO_GEO_STATUS) & GEO_STATUS_DONE, GEO_STATUS_DONE);
	assert.notEqual(memory.readMappedWord(IO_IRQ_FLAGS) & IRQ_GEO_DONE, 0);
	let sawAccepted = false, consumedAtHalt = false;
	for (let step = 0; step < 100000 && memory.readU32(marker) === 1; ++step) {
		if (cpu.isHaltedUntilIrq() && (memory.readMappedWord(IO_IRQ_FLAGS) & IRQ_GEO_DONE) === 0) break;
		const event = cpu.captureRuntimeState().interruptEventPending;
		const depth = cpu.getFrameDepth();
		const pc = depth > 0 ? cpu.readFramePc(depth - 1) : 0;
		const opcode = pc === 0 ? -1 : memory.readMappedWord(pc) & opcodeMask;
		if (event) sawAccepted = true;
		runtime.frameScheduler.runCyclesToNextLogicalTick(1);
		if (event && opcode === haltOpcode && !cpu.captureRuntimeState().interruptEventPending) consumedAtHalt = true;
	}
	assert.equal(memory.readU32(marker), 2, 'the completed GEO task does not need another interrupt');
	assert.ok(sawAccepted && consumedAtHalt, 'the real GEO IRQ is retained across the check-to-HALT interval');
});
