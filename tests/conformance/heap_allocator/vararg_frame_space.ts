import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_REGISTER_WINDOW } from '../../../machine/ts/spec/blua32/cop0';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { varargArguments as args, varargWindowFixture } from '../../helpers/vararg_window';

const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
	buildDirectory: join(tmpdir(), 'bmsx-native-frame-window'),
	configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
});
for (const level of [0, 3] as const) test(`generated VARARG issues an ordinary window fault and replays recovery in both directions at O${level}`, t => {
	const directory = mkdtempSync(join(tmpdir(), 'bmsx-vararg-window-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const f = varargWindowFixture(level), { runtime, cpu, memory } = f;
	const rom = join(directory, 'system.rom'), trace = join(directory, 'trace');
	writeFileSync(rom, f.romBytes);
	const anchor = captureRuntimeSaveState(runtime);
	function save(file: string) {
		const target = join(directory, file);
		writeFileSync(target, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		return target;
	}
	function runNative(seed: string, commands: string[]) {
		writeFileSync(trace, ['X', ...commands].join('\n'));
		return execFileSync(native, [rom, trace, seed], { encoding: 'utf8' }).trim().split('\n');
	}
	// Warm tiny actual completions at the same generated VARARG PC. The
	// larger call must exit exactly once to a real System exception.
	cpu.beginCompletionCall(f.closure, [args[0]]);
	const warm = save('warm');
	applyRuntimeSaveState(runtime, anchor);
	const frame = f.begin(args), thread = frame.thread, issue = frame.pc;
	assert.deepEqual(runNative(warm, ['K V']), [`1 ${CPU_CAUSE_CODE_REGISTER_WINDOW} ${issue}`]);

	const before = memory.readRamRecordWord(thread.address + ThreadField.StackCapacity);
	const seed = save('seed');
	const commands: string[] = [], expected: string[] = [];
	function record(command: string, row: string) { commands.push(command); expected.push(row); }
	function grant(n: number) {
		const result = f.grant(n);
		record(`E ${n}`, `${result.result} ${result.used} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return result;
	}
	assert.deepEqual(grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.VARARG] });
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.readEpcWord(), issue);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), thread.address);
	record('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${issue}`);
	for (let i = 0; i < 65_536 && memory.readRamRecordWord(thread.address + ThreadField.StackCapacity) === before; ++i) {
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(grant(1).result, RunResult.Yielded);
	}
	assert.ok(memory.readRamRecordWord(thread.address + ThreadField.StackCapacity) > before);
	assert.ok(cpu.fixedInterruptActive());
	const middle = commands.length, tsMid = save('ts.mid'), cppMid = join(directory, 'cpp.mid');
	function settle() {
		for (let i = 0; i < 65_536 && cpu.fixedInterruptActive(); ++i) assert.equal(grant(1).result, RunResult.Yielded);
		assert.equal(cpu.activeThread, thread);
		assert.equal(thread.currentFrame!.pc, issue);
		assert.deepEqual(grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.VARARG] + args.length });
		const start = memory.ramBusEnd() - RAM_BASE, stop = memory.ramData().length;
		record(`H ${start} ${stop}`, String(hashBytes(memory.ramData(), start, stop - start)));
		assert.equal(grant(65_536).result, RunResult.Halted);
		const values = runtime.readCompletionValues();
		assert.deepEqual(values, f.completion);
		record('c', `${values.length} ${values.map(value => `${valueTag(value)} ${valuePayload(value)}`).join(' ')}`);
	}
	settle();
	const tail = commands.slice(middle), expectedTail = expected.slice(middle);
	assert.deepEqual(runNative(seed, [...commands.slice(0, middle), `x ${cppMid}`, ...tail]), expected);
	assert.deepEqual(runNative(tsMid, tail), expectedTail);
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(cppMid), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = expected.length = 0;
	settle();
	assert.deepEqual(commands, tail);
	assert.deepEqual(expected, expectedTail);
});
