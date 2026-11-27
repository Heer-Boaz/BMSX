import assert from 'node:assert/strict';
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
import { IO_SYS_SUPERVISOR_FAULT_CAUSE, IO_SYS_SUPERVISOR_FAULT_EPC, IO_SYS_SUPERVISOR_FAULT_SEQUENCE } from '../../../machine/ts/spec/bmsx/io';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { returnWindowFixture } from '../../helpers/return_window';

const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
const directory = mkdtempSync(join(tmpdir(), 'bmsx-ret-frame-space-'));
try {
	for (const level of [0, 3] as const) {
		const f = returnWindowFixture(level), { cpu, memory, runtime, thread, arena } = f;
		const frame = thread.currentFrame!, parent = frame.previous!, depth = cpu.getFrameDepth();
		const capacity = () => memory.readRamRecordWord(thread.address + ThreadField.StackCapacity);
		const before = capacity(), rom = join(directory, `system-O${level}.rom`), script = join(directory, `grants-O${level}.trace`);
		writeFileSync(rom, f.romBytes);
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
			record(`E ${cycles}`, `${result.result} ${result.used} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
			return result;
		}
		assert.deepEqual(grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.RET] });
		assert.ok(cpu.fixedInterruptActive());
		assert.equal(cpu.readEpcWord(), f.issue);
		assert.equal(frame.pc, f.issue);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), thread.address);
		const fault = `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${f.issue}`;
		record('Z', fault);
		record('P', `1 ${cpu.readFramePc(0)}`);
		// Stop immediately after the backing record has been rewritten, while
		// the caller window and outgoing source have yet to retire.
		for (let i = 0; i < 65_536 && capacity() === before && cpu.fixedInterruptActive(); ++i)
			assert.equal(grant(1).result, RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), true);
		assert.ok(capacity() > before);
		assert.equal(thread.frameDepth, depth);
		assert.equal(thread.currentFrame, frame);
		assert.ok(parent.stackCapacity < f.expected.length);
		const saveTs = save('after-backing-write'), saveCpp = join(directory, `O${level}-native.state`);
		const prefix = commands.length;
		function finish() {
			for (let i = 0; i < 65_536 && cpu.fixedInterruptActive(); ++i) assert.equal(grant(1).result, RunResult.Yielded);
			assert.equal(cpu.activeThread, thread);
			assert.equal(cpu.getFrameDepth(), depth);
			assert.equal(cpu.readFramePc(depth - 1), f.issue);
			assert.deepEqual(grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.RET] + f.expected.length });
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
		assert.deepEqual(grant(1), { result: RunResult.Yielded, used: BASE_CYCLES[OpCode.RET] });
		for (let i = 0; i < 4096 && memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE) === 0; ++i) grant(243);
		assert.equal(cpu.readEpcWord(), f.issue);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		assert.equal(memory.readIoU32(IO_SYS_SUPERVISOR_FAULT_SEQUENCE), 1);
		for (const [address, value] of [[IO_SYS_SUPERVISOR_FAULT_SEQUENCE, 1], [IO_SYS_SUPERVISOR_FAULT_CAUSE, CPU_CAUSE_CODE_REGISTER_WINDOW],
			[IO_SYS_SUPERVISOR_FAULT_EPC, f.issue]]) {
			assert.equal(memory.readIoU32(address), value);
			record(`M ${address}`, `${value} 0`);
		}
		const low = memory.ramBusEnd() - RAM_BASE, end = memory.ramData().length;
		record(`H ${low} ${end}`, String(hashBytes(memory.ramData(), low, end - low)));
		record('Z', fault);
		assert.deepEqual(runNative(exhausted, commands), observations);
		console.log(`BIOS-RET-FRAME-SPACE:PASS O${level} (${prefix + suffix.length} exact grants/RAM observations, both portable restore directions and terminal OOM)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
