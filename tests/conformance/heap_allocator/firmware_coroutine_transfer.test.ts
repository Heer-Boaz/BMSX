import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FrameField, FRAME_WINDOW_MASK } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueBool, valueInteger, valueNil, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { COROUTINE_FIRMWARE_MODULES } from '../../helpers/firmware_modules';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = `
local co<const> = require('coroutine')
local thread<const> = co.create(function(first, empty, last)
	local again, missing, final = co.yield(first + 1, empty, last)
	return again, false, missing, final
end)
halt_until_irq
local ok, a, b, c = co.resume(thread, 41, nil, 55)
local resumed, d, e, f, g = co.resume(thread, 77, nil, 88)
local finished, diagnostic = co.resume(thread)
return ok, a, b, c, resumed, d, e, f, g, finished, diagnostic
`;

for (const optLevel of [0, 3] as const) test(`ordinary coroutine transfers use the System vector and resume from guest RAM (O${optLevel})`, t => {
	const linked = linkManagedTestSystem(source, optLevel, COROUTINE_FIRMWARE_MODULES);
	const rom = writeTestBlua32Rom(linked);
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-coroutine-transfer-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace');
	const tsState = join(dir, 'ts.state'), cppState = join(dir, 'cpp.state');
	writeFileSync(romPath, rom);
	const addressOf = (id: string) => linked.symbols.functionAddresses[linked.symbols.metadata.functionIds.indexOf(id)];
	const resume = addressOf('module:kernel/coroutine_resume/module');
	const yieldWrapper = addressOf('module:kernel/coroutine_yield/module');
	const entry = addressOf('module:kernel/coroutine_entry/module');
	assert.ok(resume && yieldWrapper && entry);
	const visits = [resume, yieldWrapper, resume, entry, resume];
	const commands: string[] = [], rows: string[] = [];
	const observe = (command: string, row: string) => { commands.push(command); rows.push(row); };
	const boot = () => {
		const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		return runtime;
	};
	const runtime = boot(), { cpu, memory } = runtime.machine;
	function grant(rt: Runtime, cycles: number) {
		const { cpu, memory, scheduler } = rt.machine;
		const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		observe(`E ${cycles}`, `${result} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return result;
	}
	for (let i = 0; !cpu.isHaltedUntilIrq() && i < 2048; ++i) grant(runtime, 1024);
	assert.ok(cpu.isHaltedUntilIrq());
	const vector = linked.layout.functions.find(fn => fn.address === cpu.captureRuntimeState().systemVectorWord);
	assert.ok(vector, 'reset installed a System exception vector');
	cpu.clearHaltUntilIrq();
	commands.push('h');

	let next = 0, commandCut = 0, rowCut = 0, result = RunResult.Yielded;
	for (let i = 0; result !== RunResult.Halted && i < 65536; ++i) {
		result = grant(runtime, 1);
		if (!cpu.fixedInterruptActive() || cpu.readCauseWord() !== CPU_CAUSE_CODE_SYSCALL
			|| cpu.activeThread.currentFrame?.pc !== vector.codeAddress) continue;
		const interrupted = memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS);
		const depth = cpu.readThreadFrameDepth(interrupted), frame = depth - 1;
		const fn = cpu.readThreadFrameWord(interrupted, frame, FrameField.Function);
		assert.equal(fn, visits[next++]);
		if (fn === entry) {
			assert.equal(depth, 1, 'the original coroutine entry is the only suspended frame');
			const active = cpu.activeThread.currentFrame!;
			const first = valuePayload(active.registers.get(0));
			const base = cpu.readThreadFrameWord(interrupted, frame, FrameField.StackBase) & FRAME_WINDOW_MASK;
			const top = cpu.readThreadFrameWord(interrupted, frame, FrameField.Top) & FRAME_WINDOW_MASK;
			const stack = cpu.bindThread(interrupted).stackRegisters;
			assert.deepEqual(Array.from({ length: top - first }, (_, i) => stack.get(base + first + i)),
				[valueInteger(77), valueBool(false), valueNil(), valueInteger(88)]);
		}
		if (fn !== yieldWrapper) continue;
		const base = cpu.readThreadFrameWord(interrupted, frame, FrameField.VarargBase) & FRAME_WINDOW_MASK;
		const values = cpu.bindThread(interrupted).stackRegisters;
		assert.deepEqual([values.get(base), values.get(base + 1), values.get(base + 2)], [valueInteger(42), valueNil(), valueInteger(55)]);
		writeFileSync(tsState, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		commands.push(`x ${cppState}`);
		commandCut = commands.length; rowCut = rows.length;
	}
	assert.equal(next, visits.length);
	assert.ok(commandCut);
	function completed(rt: Runtime, result: RunResult) {
		assert.equal(result, RunResult.Halted);
		assert.equal(rt.machine.cpu.captureRuntimeState().hardHalted, false);
		const values = rt.readCompletionValues(), diagnostic = values[10];
		assert.equal(valueTag(diagnostic), ValueTag.String);
		assert.equal(rt.machine.cpu.stringPool.toString(valuePayload(diagnostic)), 'cannot resume non-suspended coroutine');
		assert.deepEqual(values, [
			valueBool(true), valueInteger(42), valueNil(), valueInteger(55),
			valueBool(true), valueInteger(77), valueBool(false), valueNil(), valueInteger(88),
			valueBool(false), diagnostic,
		]);
		observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	}
	completed(runtime, result);
	function replay(commands: readonly string[], expected: readonly string[]) {
		writeFileSync(trace, commands.join('\n'));
		assert.deepEqual(execFileSync(native, [romPath, trace, tsState], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
	}
	replay(commands, rows);
	const tail = commands.slice(commandCut), expected = rows.slice(rowCut);
	replay(['X', ...tail], expected);
	const rt = boot();
	applyRuntimeSaveState(rt, decodeRuntimeSaveState(readFileSync(cppState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	assert.equal(rt.machine.cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
	commands.length = rows.length = 0;
	for (const step of tail) if (step === 'E 1') result = grant(rt, 1);
	completed(rt, result);
	assert.deepEqual(commands, tail);
	assert.deepEqual(rows, expected);
});
