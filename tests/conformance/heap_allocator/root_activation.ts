import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { THREAD_HEAP_BYTES, ThreadField, ThreadStatus } from '../../../machine/ts/machine/cpu/thread_record';
import { valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_RESET_BANK_ADDRESS, DYNAMIC_RAM_BASE, HEAP_PAGE_SIZE, RAM_BASE, RUNTIME_MANAGEMENT_SIZE, THREAD_STACK_SLOT_BYTES } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { buildBlua32Image } from '../../../toolchain/ts/rompack/blua32_image_builder';
import { applyBlua32LinkValues } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { loadHeapServiceTestModules } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const resetPath = 'fixture/reset';
const receiverPath = 'fixture/receiver';
const bindingPath = 'fixture/binding';
const irqPath = 'fixture/irq';
const exceptionPath = 'kernel/cold_exception';
const managementOffset = PSX_MACHINE_SPEC.ramBytes - RUNTIME_MANAGEMENT_SIZE;
const floor = DYNAMIC_RAM_BASE + HEAP_PAGE_SIZE;
const window = 32;
const reset = `
local heap<const> = require('kernel/heap_bootstrap')
local thread<const> = require('kernel/thread_create')
local storage<const> = require('kernel/thread_frame_storage')
local root<const> = require('kernel/root_activation')
local binding<const> = require('${bindingPath}')

bss ready: word

heap.initialize_heap(${managementOffset}, ${floor - RAM_BASE})
local address<const> = ${RAM_BASE} + thread.create_thread(${managementOffset}, 0)
if address == ${RAM_BASE} or storage.reserve_frame_storage(${managementOffset}, address, ${window}, 0) == 0 then
	halt_until_irq
end
local frame_ptr<const>: *addr = address + ${ThreadField.FrameBlock}
local stack_ptr<const>: *addr = address + ${ThreadField.StackBlock}
local frames<const>: *u32 = *frame_ptr
local stack<const>: *u32 = *stack_ptr
for i = 0, ${2 * FRAME_CONTROL_BYTES / 4 - 1} do frames[i] = 0x5a5a5a5a end
for i = 0, ${window * THREAD_STACK_SLOT_BYTES / 4 - 1} do stack[i] = 0xa7a7a7a7 end
cop0.ram_end = ${floor}
*ready = address
root.publish_system_root(address, binding.target)
cop0.context = address`;
const receiver = `module<const>
local receive<const> = function(a, b, c, d, e)
	if a == nil and b == nil and c == nil and d == nil and e == nil then
		return 37
	end
	return -1
end
return { receive = receive }`;
const startupModules = [
	['main', 'module<entry>\nreturn -2'],
	[resetPath, reset],
	[receiverPath, receiver],
	[irqPath, 'return'],
	['kernel/heap_bootstrap', readFileSync('machine/bios/kernel/heap_bootstrap.lua', 'utf8')],
	['kernel/root_activation', readFileSync('machine/bios/kernel/root_activation.lua', 'utf8')],
	[exceptionPath, readFileSync('machine/bios/' + exceptionPath + '.lua', 'utf8')],
	['kernel/exception_report', readFileSync('machine/bios/kernel/exception_report.lua', 'utf8')],
].map(([path, source]) => ({ path, source, displayPath: path + '.lua', chunk: parseLuaChunk(source, path) }));
const library = loadHeapServiceTestModules().map(module => ({ ...module, displayPath: module.path + '.lua' }));
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

const dir = mkdtempSync(join(tmpdir(), 'authored-root-'));
try {
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const { linked, object } = buildBlua32Image({
			domain: 'system', luaModules: [...startupModules, ...library],
			generatedLuaModules: [{ path: bindingPath, source: 'module<const>\nreturn { target = 0 }', linkValues: new Map([['target', 0]]) }],
			loadAddress: 0x100, ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel, traceStatements: 'erase',
			resetModule: resetPath, irqModule: irqPath, exceptionModule: exceptionPath,
			preloadModules: [receiverPath], biosExports: [],
		});
		const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === receiverPath && entry.exportPathKey === 'receive')!;
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
		const target = linked.layout.functions[index];
		applyBlua32LinkValues(linked, object.link.constValueRelocs, bindingPath, new Map([['target', target.address]]));

		const ready = linked.symbols.metadata.staticScopes.declarations.find(symbol => symbol.name === 'ready')!.address!;
		assert.ok(ready < floor);
		assert.equal(target.numParams, 5);
		assert.ok(target.maxStack > target.numParams && target.maxStack < window);
		const expectedFrame = new Uint8Array(FRAME_CONTROL_BYTES);
		writeLE32(expectedFrame, 12, 0x5a5a5a5a); // The frame publisher leaves the prefilled padding alone.
		for (const [field, value] of [
			[FrameField.Function, target.address], [FrameField.CallSite, target.codeAddress],
			[FrameField.Pc, target.codeAddress],
			[FrameField.VarargBase, target.numParams], [FrameField.Top, target.numParams],
			[FrameField.StackCapacity, target.maxStack],
		]) {
			writeLE32(expectedFrame, field, value);
		}

		const romBytes = writeTestBlua32Rom(linked);
		const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		const { cpu, memory, scheduler } = runtime.machine, arena = nativeHeapReference(cpu).heapAllocator;
		const ram = memory.ramData();
		const trace: string[] = [], observations: string[] = [];
		const observe = (command: string, output?: string | number) => {
			trace.push(command);
			if (output !== undefined) observations.push(String(output));
		};
		const range = (base: number, size: number) => observe(`H ${base} ${base + size}`, hashBytes(ram, base, size));
		const grant = (cycles: number) => {
			const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
			const paid = cycles - cpu.instructionBudgetRemaining;
			assert.ok(paid > 0);
			observe(`E ${cycles}`, `${result} ${paid} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
			return result;
		};

		runtime.boot();
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(arena.occupiedBytes(), 0);
		observe('P', `1 ${cpu.readFramePc(0)}`);
		range(arena.allocatorStateOffset(), 24);
		for (let i = 0; i < 16384 && memory.readMappedWord(ready) === 0; ++i) {
			assert.equal(grant(1), RunResult.Yielded);
		}
		const address = memory.readMappedWord(ready);
		assert.ok(address > floor);
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(memory.readRamRecordWord(address + ThreadField.FrameDepth), 0);
		assert.equal(memory.readRamRecordWord(address + ThreadField.StackCapacity), window);
		const frames = memory.readRamRecordWord(address + ThreadField.FrameBlock) - RAM_BASE;
		const words = memory.readRamRecordWord(address + ThreadField.StackBlock) - RAM_BASE;
		const tags = words + 4 * window;
		const physical = arena.occupiedBytes(), logical = nativeHeapReference(cpu).luaHeap.usedBytes();
		assert.ok(ram.subarray(frames, frames + 2 * FRAME_CONTROL_BYTES).every(byte => byte === 0x5a));
		assert.ok(ram.subarray(words, words + THREAD_STACK_SLOT_BYTES * window).every(byte => byte === 0xa7));
		observe(`M ${ready}`, `${address} 0`);
		range(frames, 2 * FRAME_CONTROL_BYTES);
		range(words, THREAD_STACK_SLOT_BYTES * window);

		// Cut after the first NIL tag store, before the rest of the tag plane
		// and the final depth publication. No second activation owns the slab.
		for (let i = 0; i < 512 && ram[tags] === 0xa7; ++i) assert.equal(grant(1), RunResult.Yielded);
		assert.equal(ram[tags], 0);
		assert.equal(ram[tags + 1], 0xa7);
		assert.equal(memory.readRamRecordWord(address + ThreadField.FrameDepth), 0);
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.ok(cpu.getFrameDepth() > 1, 'the ordinary reset publisher is still on the fixed stack');
		assert.deepEqual(ram.slice(frames, frames + FRAME_CONTROL_BYTES), expectedFrame);
		range(address - RAM_BASE, THREAD_HEAP_BYTES);
		range(words, THREAD_STACK_SLOT_BYTES * window);

		const rom = join(dir, `O${optLevel}.rom`), script = join(dir, 'trace');
		const tsPartial = join(dir, 'ts.state'), nativePartial = join(dir, 'native.state');
		writeFileSync(rom, romBytes);
		writeFileSync(tsPartial, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		observe(`x ${nativePartial}`);
		observe('S');
		const start = trace.length, before = observations.length;
		function finish() {
			for (let i = 0; i < 512 && memory.readRamRecordWord(address + ThreadField.FrameDepth) === 0; ++i) {
				assert.equal(grant(1), RunResult.Yielded);
			}
			assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
			assert.equal(memory.readRamRecordWord(address + ThreadField.Status), ThreadStatus.Running);
			assert.equal(memory.readRamRecordWord(address + ThreadField.FrameDepth), 1);
			assert.equal(memory.readRamRecordWord(address + ThreadField.StackTop), target.maxStack);
			assert.equal(arena.occupiedBytes(), physical);
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), logical);
			assert.deepEqual(ram.slice(frames, frames + FRAME_CONTROL_BYTES), expectedFrame);
			assert.ok(ram.subarray(frames + FRAME_CONTROL_BYTES, frames + 2 * FRAME_CONTROL_BYTES).every(byte => byte === 0x5a));
			assert.ok(ram.subarray(words, words + 4 * target.numParams).every(byte => byte === 0));
			assert.ok(ram.subarray(words + 4 * target.numParams, tags).every(byte => byte === 0xa7));
			assert.ok(ram.subarray(tags, tags + target.numParams).every(byte => byte === 0));
			assert.ok(ram.subarray(tags + target.numParams, tags + window).every(byte => byte === 0xa7));
			range(address - RAM_BASE, THREAD_HEAP_BYTES);
			range(frames, 2 * FRAME_CONTROL_BYTES);
			range(words, THREAD_STACK_SLOT_BYTES * window);
			let halt = RunResult.Yielded;
			for (let i = 0; i < 16 && halt === RunResult.Yielded; ++i) halt = grant(41);
			assert.equal(halt, RunResult.Halted);
			assert.equal(cpu.rootThread.address, address);
			assert.deepEqual(runtime.readCompletionValues(), [valueInteger(37)]);
			observe('C', 37);
		}
		function replay(checkpoint: string, label: string) {
			writeFileSync(script, trace.join('\n'));
			assert.deepEqual(execFileSync(native, [rom, script, checkpoint], { encoding: 'utf8' }).trimEnd().split('\n'), observations, label);
		}
		finish();
		const tail = trace.slice(start), tailObservations = observations.slice(before);
		trace.push('U', ...tail);
		observations.push(...tailObservations);
		replay(tsPartial, 'independent native reset and native save/restore');
		trace.splice(0, trace.length, 'X', ...tail);
		observations.splice(0, observations.length, ...tailObservations);
		replay(tsPartial, 'portable TS to native');
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		trace.length = 0;
		observations.length = 0;
		finish();
		assert.deepEqual(observations, tailObservations, 'portable native to TS');
		console.log(`ROOT-ACTIVATION:PASS O${optLevel} ordinary fixed-bank boot, partial NIL tags, exact managed frame and bidirectional resume`);
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
