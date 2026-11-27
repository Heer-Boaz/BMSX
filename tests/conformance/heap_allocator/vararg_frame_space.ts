import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_RESIDENT_ACTIVATION, FRAME_RESIDENT_PLACE_WINDOW } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = `
local function capture(n)
	return function(...) return n, ... end
end
return capture(183)
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const args = Array.from({ length: 33 }, (_, i) => valueInteger(i + 74));
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
	buildDirectory: 'tmp/build-native-frame-call',
	configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
});
mkdirSync('tmp', { recursive: true });
for (const level of [0, 3] as const) test(`generated growing VARARG and bidirectional grant-state replay at O${level}`, t => {
	const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-vararg-window-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const linked = linkTestSystemBlua32(compileHeapServiceSystem(source, level));
	const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine, arena = cpu.heapAllocator;
	const rom = join(directory, 'system.rom'), trace = join(directory, 'trace');
	writeFileSync(rom, linked.romBytes);
	runGuestToHalt(cpu, 65_536);
	cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
	const closure = valuePayload(runtime.readCompletionValues()[0]);
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
	cpu.beginCompletionCall(closure, [args[0]]);
	const warm = save('warm');
	const proof = runNative(warm, ['K V']);
	assert.equal(proof.length, 1);
	assert.deepEqual(proof[0].split(' ').slice(0, 2).map(Number), [1, FRAME_RESIDENT_ACTIVATION | FRAME_RESIDENT_PLACE_WINDOW]);

	applyRuntimeSaveState(runtime, anchor);
	cpu.beginCompletionCall(closure, args);
	const seed = save('seed');
	const commands: string[] = [], expected: string[] = [];
	function record(command: string, row: string) { commands.push(command); expected.push(row); }
	function grant(n: number) {
		const result = scheduler.runCpuSlice(0, n, undefined, CpuRunKind.Scheduled);
		record(`J ${n} 1`, `${result} ${n - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} 0 ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
		return result;
	}
	for (let i = 0; i < 64 && !cpu.heapServiceActive(); ++i) assert.equal(grant(1), RunResult.Yielded);
	assert.ok(cpu.heapServiceActive());
	assert.equal(grant(17), RunResult.Yielded);
	assert.ok(cpu.heapServiceActive());
	const middle = commands.length, tsMid = save('ts.mid'), cppMid = join(directory, 'cpp.mid');
	function settle() {
		for (let i = 0; i < 128 && cpu.heapServiceActive(); ++i) assert.equal(grant(139), RunResult.Yielded);
		assert.equal(cpu.heapServiceActive(), false);
		const start = memory.ramBusEnd() - RAM_BASE, stop = memory.ramData().length;
		record(`H ${start} ${stop}`, String(hashBytes(memory.ramData(), start, stop - start)));
		assert.equal(grant(65_536), RunResult.Halted);
		const values = runtime.readCompletionValues();
		assert.deepEqual(values, [valueInteger(183), ...args]);
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
