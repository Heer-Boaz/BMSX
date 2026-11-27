import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_RESIDENT_ACTIVATION, FRAME_RESIDENT_PLACE_WINDOW, FRAME_RESIDENT_RETIRE_WINDOW_SOURCE } from '../../../machine/ts/machine/cpu/call_state';
import { RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { returnWindowFixture } from '../../helpers/return_window';

const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-ret-frame-space-'));
try {
	for (const level of [0, 3] as const) {
		const f = returnWindowFixture(level), { cpu, memory, runtime, thread, arena } = f;
		const frame = thread.currentFrame!, parent = frame.previous!, depth = cpu.getFrameDepth();
		const capacity = () => memory.readRamRecordWord(thread.address + ThreadField.StackCapacity);
		const before = capacity(), rom = join(directory, `system-O${level}.rom`), script = join(directory, `grants-O${level}.trace`);
		writeFileSync(rom, f.linked.romBytes);
		function save(name: string) {
			const path = join(directory, `O${level}-${name}.state`);
			writeFileSync(path, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			return path;
		}
		function runNative(state: string, commands: string[]) {
			writeFileSync(script, ['X', ...commands].join('\n'));
			return execFileSync(native, [rom, script, state], { encoding: 'utf8' }).trim().split('\n');
		}
		const start = save('before-ret');

		let commands: string[] = [], observations: string[] = [];
		function record(command: string, row: string) { commands.push(command); observations.push(row); }
		function grant(cycles: number) {
			const result = f.grant(cycles);
			record(`J ${cycles} 1`, `${result.result} ${result.used} ${+cpu.heapServiceActive()} 0 ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
			return result;
		}
		assert.deepEqual(grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.RET] + 1 });
		assert.equal(f.flags(), FRAME_RESIDENT_ACTIVATION | FRAME_RESIDENT_PLACE_WINDOW | FRAME_RESIDENT_RETIRE_WINDOW_SOURCE);
		// A whole native grant must also stop after issuing RET, not run
		// another instruction just because there are cycles left.
		assert.deepEqual(runNative(start, ['J 65536 1', 'P']), [observations[0], `${depth} ${frame.pc}`]);
		// Stop immediately after the backing record has been rewritten, while
		// the caller window and outgoing source have yet to retire.
		for (let i = 0; i < 65_536 && capacity() === before && cpu.heapServiceActive(); ++i)
			assert.equal(grant(1).result, RunResult.Yielded);
		assert.equal(cpu.heapServiceActive(), true);
		assert.ok(capacity() > before);
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(thread.currentFrame, frame);
		assert.ok(parent.stackCapacity < f.expected.length);
		const saveTs = save('after-backing-write'), saveCpp = join(directory, `O${level}-native.state`);
		const prefix = commands.length;
		function finish() {
			for (let i = 0; i < 512 && cpu.heapServiceActive(); ++i) assert.equal(grant(139).result, RunResult.Yielded);
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(cpu.getFrameDepth(), depth - 1);
			const low = memory.ramBusEnd() - RAM_BASE, end = memory.ramData().length;
			record(`H ${low} ${end}`, String(hashBytes(memory.ramData(), low, end - low)));
			assert.equal(grant(65_536).result, RunResult.Halted);
			const result = runtime.readCompletionValues();
			assert.deepEqual(result, f.completion);
			record('c', `${result.length} ${result.map(value => `${valueTag(value)} ${valuePayload(value)}`).join(' ')}`);
		}
		finish();
		const suffix = commands.slice(prefix), expected = observations.slice(prefix);
		assert.deepEqual(runNative(start, [...commands.slice(0, prefix), `x ${saveCpp}`, ...suffix]), observations);
		assert.deepEqual(runNative(saveTs, suffix), expected);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(saveCpp), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		commands = []; observations = [];
		finish();
		assert.deepEqual(commands, suffix);
		assert.deepEqual(observations, expected);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(start), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		while (arena.allocate(4088, true)) { /* exhaust pages */ }
		while (arena.allocate(24, true)) { /* exhaust the tail */ }
		const exhausted = save('exhausted');
		commands = []; observations = [];
		assert.deepEqual(grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.RET] + 1 });
		for (let i = 0; i < 65_536 && cpu.heapServiceActive(); ++i) grant(243);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.readEpcWord(), f.issue);
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
		const low = memory.ramBusEnd() - RAM_BASE, end = memory.ramData().length;
		record(`H ${low} ${end}`, String(hashBytes(memory.ramData(), low, end - low)));
		record('Z', `${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${cpu.readEpcWord()}`);
		assert.deepEqual(runNative(exhausted, commands), observations);
		console.log(`BIOS-RET-FRAME-SPACE:PASS O${level} (${prefix + suffix.length} exact grants/RAM observations, both portable restore directions and terminal OOM)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
