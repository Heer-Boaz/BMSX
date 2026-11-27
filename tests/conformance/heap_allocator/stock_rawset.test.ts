import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_CHANGED_HEAD, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_COLOR_MASK } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { valueBool, valueInteger, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { HEAP_SERVICE_FRAME_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileCartlibProgram } from '../../helpers/cartlib_cpu';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = `
local t, child, object = {11, 22}, {word = 31}, {}
local same = rawset(t, 1, child) == t
local value = rawget(t, 1).word
rawset(t, 2, nil)
local length = #t
rawset(t, 3.0, 64)
local integer_alias = rawget(t, 3)
rawset(t, -0.0, 71)
local zero_alias = rawget(t, 0)
rawset(t, 2.5, 81)
local fraction = rawget(t, 2.5)
rawset(t, object, 95)
rawset(t, object, nil)
local removed = rawget(t, object) == nil
rawset(t, object, 97)
setmetatable(t, {__newindex = function() error('rawset entered __newindex') end})
rawset(t, 'direct', 129)
local missing, missing_reason = pcall(rawset, t, 'absent')
local nil_key, nil_reason = pcall(rawset, t, nil, 0)
local nan_key, nan_reason = pcall(rawset, t, blua32.float_from_bits(0x7fc12345), 0)
local proxy = {}
setmetatable(proxy, {__newindex = rawset})
proxy.implicit = 145
local fixed, padding = rawset(t, 'fixed', 151)
local outer, inner, nested = pcall(pcall, rawset, t, 'nested', 157)
for i = 4, 96 do rawset(t, i * 3, i) end
return same, value, length, integer_alias, zero_alias, fraction, removed,
       rawget(t, object), rawget(t, 'direct'), missing, nil_key, nan_key, rawget(t, 288),
       missing_reason == 'Invalid argument.', nil_reason == 'Table index is nil.',
       nan_reason == 'Table index is NaN.', proxy.implicit,
       fixed == t and padding == nil, outer and inner and nested == t
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const optLevel of [0, 3] as const) test(`stock rawset O${optLevel} runs the table barrier and assignment on the BIOS stack`, () => {
	const { images } = compileCartlibProgram(source, { optLevel });
	const target = images.systemSymbols.metadata.functionIds.findIndex(id =>
		id.startsWith('module:kernel/table_grow/') && id.endsWith('|constant|raw_set'));
	assert.notEqual(target, -1);
	const functionAddress = images.systemImage.functions[target].address;
	const runtime = new Runtime({ systemRomBytes: images.systemRomBytes, cartridgeSlots: cartridgeSlots(images.cartRomBytes),
		machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine, { heapAllocator: arena } = cpu;
	const frame = arena.managementOffset() + HEAP_SERVICE_FRAME_OFFSET;
	const grant = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
	const atStore = () => cpu.heapServiceActive()
		&& memory.readRamRecordWord(frame + FrameField.Function) === functionAddress;
	for (let i = 0; i < 20_000 && !atStore(); ++i) grant(1024);
	assert.ok(atStore(), `no BIOS raw-set: Cause=${cpu.readCauseWord()} EPC=${cpu.readEpcWord().toString(16)} reason=${cpu.readLuaFaultReasonWord()}`);
	assert.equal(cpu.readFrameExecutionDomain(cpu.getFrameDepth() - 2), 0, 'the cartridge called the public function');
	const argumentsFrame = cpu.activeThread.currentFrame!;
	const table = argumentsFrame.registers.get(0);
	assert.equal(valueTag(table), ValueTag.Table);
	const address = valuePayload(table), control = arena.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	// Exact barrier state at the admitted store: the new value is an edge
	// and the owner was already scanned during Mark. No device advances GC.
	const color = memory.readRamRecordByte(address + GC_COLOR_OFFSET);
	memory.writeRamRecordByte(address + GC_COLOR_OFFSET, (color & ~GC_COLOR_MASK) | 3);
	memory.writeRamRecordByte(control, (memory.readRamRecordByte(control) & ~7) | GcPhase.Mark);
	assert.equal(memory.readRamRecordWord(control + GC_CHANGED_HEAD), 0);
	grant(1);
	assert.ok(atStore(), 'the operation can be interrupted before its result retires');
	mkdirSync('tmp', { recursive: true });
	const directory = mkdtempSync(join('tmp', 'stock-rawset-'));
	const system = join(directory, 'system.rom'), cart = join(directory, 'cart.rom'), checkpoint = join(directory, 'start.state');
	const nativeState = join(directory, 'native.state'), trace = join(directory, 'trace');
	writeFileSync(system, images.systemRomBytes);
	writeFileSync(cart, images.cartRomBytes);
	writeFileSync(checkpoint, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const commands = ['X', `x ${nativeState}`], observations: string[] = [];
	const observe = (command: string, expected: string) => { commands.push(command); observations.push(expected); };
	for (let i = 0; i < 128 && atStore(); ++i) {
		const result = grant(17);
		observe('E 17', `${result} ${17 - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
	}
	assert.equal(atStore(), false);
	assert.equal(memory.readRamRecordByte(address + GC_COLOR_OFFSET) & GC_COLOR_MASK, 2);
	assert.notEqual(memory.readRamRecordWord(control + GC_CHANGED_HEAD), 0);
	const low = memory.ramBusEnd() - RAM_BASE, end = memory.ramData().length;
	observe(`H ${low} ${end}`, String(hashBytes(memory.ramData(), low, end - low)));
	function finish(record: boolean) {
		for (let i = 0; i < 2_048; ++i) {
			const result = grant(4096);
			if (record) observe('E 4096', `${result} ${4096 - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
			if (result === RunResult.Halted) break;
		}
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		const values = runtime.readCompletionValues();
		assert.deepEqual(values, [
			valueBool(true), valueInteger(31), valueInteger(1), valueInteger(64), valueInteger(71),
			valueInteger(81), valueBool(true), valueInteger(97), valueInteger(129), valueBool(false),
			valueBool(false), valueBool(false), valueInteger(96),
			valueBool(true), valueBool(true), valueBool(true), valueInteger(145), valueBool(true), valueBool(true),
		]);
		if (record) {
			observe('c', `${values.length} ${values.map(v => `${valueTag(v)} ${valuePayload(v)}`).join(' ')}`);
			observe(`H ${low} ${end}`, String(hashBytes(memory.ramData(), low, end - low)));
		}
	}
	finish(true);
	writeFileSync(trace, commands.join('\n'));
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	const actual = execFileSync(native, [system, trace, checkpoint, cart], { encoding: 'utf8' }).trim().split('\n');
	const mismatch = actual.findIndex((line, index) => line !== observations[index]);
	assert.equal(mismatch, -1, `observation ${mismatch}: ${actual[mismatch]} != ${observations[mismatch]}`);
	assert.equal(actual.length, observations.length);
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	finish(false);
	rmSync(directory, { recursive: true });
});
