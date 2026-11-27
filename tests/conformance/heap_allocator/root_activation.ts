import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField, registerWindowBucket } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { THREAD_HEAP_BYTES, THREAD_STACK_SLOT_BYTES, ThreadField, ThreadStatus } from '../../../machine/ts/machine/cpu/thread_record';
import { valueNil } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { HEAP_SERVICE_CLOSURE_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const path = 'kernel/root_activation';
const producer = `module<const>
local root<const> = require('${path}')
local build<const> = function(address, fn)
	local pc<const>, formals<const>, capacity<const> = root.read_system_entry(fn)
	root.publish_system_root(address, fn, pc, formals, capacity)
	return address
end
return { build = build }`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

const dir = mkdtempSync(join('tmp', 'authored-root-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const source = readFileSync('machine/bios/' + path + '.lua', 'utf8');
		const compiled = compileHeapServiceSystem('return 37', optLevel, [{ path, source }, { path: 'fixture/producer', source: producer }]);
		const start = compiled.program.protos[compiled.resetProtoIndex];
		start.numParams = 5;
		start.maxStack = 19;
		const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
		const root = object.sections.rodata.moduleExports.find(entry => entry.path === 'fixture/producer' && entry.exportPathKey === 'build')!;
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[root.slotName]);
		const build = linked.image.functions[index].address;
		deriveBlua32FixedStack(linked.image, [index]);
		const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine, arena = cpu.heapAllocator;
		const original = cpu.rootThread.currentFrame!;
		const originalAddress = original.controlOffset, fn = original.functionAddress;
		const expectedFrame = memory.ramData().slice(originalAddress, originalAddress + FRAME_CONTROL_BYTES);
		assert.equal(original.stackCapacity, 19);
		assert.equal(original.top, 5);
		assert.equal(original.closureAddress, 0);

		// Publication consumes an admitted bank; this independent fixture
		// supplies it without using the candidate's frame producer.
		const address = cpu.createThread(0);
		const count = registerWindowBucket(start.maxStack);
		cpu.luaHeap.reserveThreadFrameStorage(address, count, 0, valueNil());
		const frames = memory.readRamRecordWord(address + ThreadField.FrameBlock) & RAM_RECORD_WORD_MASK;
		const values = memory.readRamRecordWord(address + ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
		const tags = values + 4 * count;
		const ram = memory.ramData(), trace: string[] = [], observations: string[] = [];
		const observe = (command: string, output?: string | number) => {
			trace.push(command);
			if (output !== undefined) observations.push(String(output));
		};
		const range = (base: number, size: number) => observe(`H ${base} ${base + size}`, hashBytes(ram, base, size));
		range(originalAddress, FRAME_CONTROL_BYTES); // independent native reset reference, before portable import
		ram.fill(0x5a, frames, frames + 2 * FRAME_CONTROL_BYTES);
		ram.fill(0xa7, values, values + THREAD_STACK_SLOT_BYTES * count);

		const rom = join(dir, `O${optLevel}.rom`), script = join(dir, 'trace'), initial = join(dir, 'initial'), midNative = join(dir, 'native');
		writeFileSync(rom, linked.romBytes);
		writeFileSync(initial, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		observe('X');
		assert.ok(cpu.beginHeapService(build, [address, fn]));
		observe(`B ${build} 2 ${address} ${fn}`, 1);
		const physical = arena.occupiedBytes(), logical = cpu.luaHeap.usedBytes();
		function grant(cycles: number) {
			const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const latch = memory.readRamRecordWord(arena.managementOffset() + HEAP_SERVICE_CLOSURE_OFFSET);
			const paid = cycles - cpu.instructionBudgetRemaining;
			assert.ok(paid > 0 && result === RunResult.Yielded);
			assert.equal(arena.occupiedBytes(), physical);
			assert.equal(cpu.luaHeap.usedBytes(), logical);
			observe(`J ${cycles} 1`, `${result} ${paid} ${+cpu.heapServiceActive()} ${latch} ${physical} ${logical}`);
		}
		for (let i = 0; i < 512 && memory.readRamRecordWord(frames + FrameField.Protected) !== 0xffffffff; ++i) grant(1);
		assert.equal(memory.readRamRecordWord(frames + FrameField.Protected), 0xffffffff);
		assert.equal(memory.readRamRecordWord(address + ThreadField.FrameDepth), 0);
		range(frames, FRAME_CONTROL_BYTES);
		const checkpoint = captureRuntimeSaveState(runtime);
		observe(`x ${midNative}`);
		observe('S');
		function finish() {
			for (let i = 0; i < 512 && cpu.heapServiceActive(); ++i) grant(3);
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(cpu.heapServiceResult(), address);
			assert.deepEqual(ram.subarray(frames, frames + FRAME_CONTROL_BYTES), expectedFrame);
			assert.ok(ram.subarray(frames + FRAME_CONTROL_BYTES, frames + 2 * FRAME_CONTROL_BYTES).every(byte => byte === 0x5a));
			assert.equal(memory.readRamRecordWord(address + ThreadField.Status), ThreadStatus.Running);
			assert.equal(memory.readRamRecordWord(address + ThreadField.FrameDepth), 1);
			assert.equal(memory.readRamRecordWord(address + ThreadField.StackTop), start.maxStack);
			assert.ok(ram.subarray(values, values + 4 * start.numParams).every(byte => byte === 0));
			assert.ok(ram.subarray(values + 4 * start.numParams, tags).every(byte => byte === 0xa7));
			assert.ok(ram.subarray(tags, tags + start.numParams).every(byte => byte === 0));
			assert.ok(ram.subarray(tags + start.numParams, tags + count).every(byte => byte === 0xa7));
			range(address & RAM_RECORD_WORD_MASK, THREAD_HEAP_BYTES);
			range(frames, 2 * FRAME_CONTROL_BYTES);
			range(values, THREAD_STACK_SLOT_BYTES * count);
		}
		finish();
		observe('U');
		applyRuntimeSaveState(runtime, checkpoint);
		finish();
		writeFileSync(script, trace.join('\n'));
		assert.deepEqual(execFileSync(native, [rom, script, initial], { encoding: 'utf8' }).trimEnd().split('\n'), observations);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(midNative), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		finish();
		console.log(`ROOT-ACTIVATION:PASS O${optLevel} BIOS produces the exact native zero-argument Frame and resumes before Thread publication`);
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
