import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_FIXED_FRAME_OFFSET, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
	buildDirectory: 'tmp/build-native-fixed-divide',
	configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
});
mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join(process.cwd(), 'tmp', 'bmsx-fixed-divide-'));
try {
	for (const level of [0, 3] as const) {
		const compiled = compileHeapServiceSystem('halt_until_irq', level), linked = linkTestSystemBlua32(compiled);
		const object = encodeCompiledProgramObject(compiled);
		const exported = object.sections.rodata.moduleExports.find(item => item.path === 'kernel/heap_admission' && item.exportPathKey === 'limit_assist_allowance');
		assert.ok(exported);
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
		assert.ok(index >= 0);
		const fn = linked.image.functions[index];
		const divides: number[] = [];
		for (let head = fn.codeAddress; head < fn.codeAddress + fn.codeByteCount;) {
			const body = decodeBlua32InstructionAtPc(linked.image.textBytes, linked.image.header.textAddress, head);
			assert.notEqual(body.op, OpCode.CALL, 'one actual arithmetic routine, without another activation');
			if (body.op === OpCode.FLOORDIV) divides.push(head);
			head = body.pc + INSTRUCTION_BYTES;
		}
		assert.equal(divides.length, 1);
		const rom = join(directory, `O${level}.rom`), trace = join(directory, `O${level}.trace`);
		writeFileSync(rom, linked.romBytes);
		const runtime = new Runtime({ systemRomBytes: linked.romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine, arena = cpu.heapAllocator, management = arena.managementOffset();
		runGuestToHalt(cpu, 65_536);
		cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
		// Allowance owner is reached during Record, Table and Thread backing
		// collector assists. These are actual positive work/clock units.
		const args = [211, 517];
		const bind = `B ${fn.address} ${args.length} ${args.join(' ')}`;
		const seed = join(directory, `O${level}.seed`), checkpoint = join(directory, `O${level}.native`);
		writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const pc = () => memory.readRamRecordWord(management + CPU_FIXED_FRAME_OFFSET + FrameField.Pc);
		function pulse(n: number) {
			const result = scheduler.runCpuSlice(0, n, undefined, CpuRunKind.Direct);
			const used = n - cpu.instructionBudgetRemaining;

			return { used, row: `${result} ${used} ${+cpu.fixedInterruptActive()} ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}` };
		}
		// Save-state import recreates native image caches. Warm actual
		// invocations in the same installed System image without restoring.
		const warm: string[] = [], warmRows: string[] = [];
		for (let invocation = 0; invocation < 96; ++invocation) {
			assert.ok(cpu.beginHeapService(fn.address, args));
			warm.push(bind, 'J 65536 0');
			warmRows.push('1', pulse(65_536).row);
		}
		const first = memory.ramBusEnd() - RAM_BASE, stop = memory.ramData().length;
		const hash = () => String(hashBytes(memory.ramData(), first, stop - first));
		function runNative(path: string, commands: string[]) {
			writeFileSync(trace, commands.join('\n'));
			return execFileSync(native, [rom, trace, path], { encoding: 'utf8' }).trim().split('\n');
		}
		assert.ok(cpu.beginHeapService(fn.address, args));
		const whole = pulse(65_536), wholeHash = hash();
		assert.equal(cpu.heapServiceResult(), 172);
		const summary = runNative(seed, ['X', ...warm, bind, 'n', 'J 65536 0', 'n', `H ${first} ${stop}`]);
		assert.deepEqual(summary.slice(0, warmRows.length + 1), [...warmRows, '1']);
		const [before, row, after, privateRam] = summary.slice(-4);
		assert.equal(row, whole.row);
		assert.equal(privateRam, wholeHash);
		const [, entriesBefore, cyclesBefore] = before.split(' ').map(Number);
		const [, entriesAfter, cyclesAfter, nativePc] = after.split(' ').map(Number);
		assert.ok(entriesAfter > entriesBefore && nativePc >= fn.codeAddress && nativePc < fn.codeAddress + fn.codeByteCount,
			'native code ran at the linked production assist PC, inside a fixed activation');
		// The real routine divides once and has no callee on this path.
		// Native cycles beyond the budget of all other bytecodes prove
		// this instruction executed, even if another prefix was scalar.
		assert.ok(cyclesAfter - cyclesBefore > whole.used - BASE_CYCLES[OpCode.FLOORDIV],
			'cycles retired by the fixed native blocks include the production division');

		assert.ok(cpu.beginHeapService(fn.address, args));
		const prefix: { pc: number; used: number; row: string }[] = [];
		for (let n = 0; n < 128; ++n) {
			const head = pc();
			const instruction = decodeBlua32InstructionAtPc(linked.image.textBytes, linked.image.header.textAddress, head);
			prefix.push({ pc: head, ...pulse(1) });
			if (instruction.op === OpCode.FLOORDIV) {
				assert.equal(pc(), instruction.pc + INSTRUCTION_BYTES);
				break;
			}
		}
		const floor = prefix.at(-1)!.pc;
		assert.equal(floor, divides[0], 'the checkpoint follows the single exact linked divide');
		const divided = hash(), tsCheckpoint = join(directory, `O${level}.ts`);
		writeFileSync(tsCheckpoint, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const pulses: string[] = [], mixed = [1, 7, 19, 115, 37];
		for (let grant = 0; grant < 4096 && cpu.heapServiceActive(); ++grant) pulses.push(pulse(mixed[grant % mixed.length]).row);
		assert.equal(cpu.heapServiceResult(), 172);
		const final = hash();
		const frontend = [...warmRows, '1', whole.row, '1', ...prefix.map(row => row.row)];
		const tail = [...pulses.map((_, i) => `J ${mixed[i % mixed.length]} 0`), `H ${first} ${stop}`];
		assert.deepEqual(runNative(seed, ['X', ...warm, bind, 'J 65536 0', bind, ...prefix.map(() => 'J 1 0'), `x ${checkpoint}`, ...tail]),
			[...frontend, ...pulses, final]);
		assert.deepEqual(runNative(tsCheckpoint, ['X', ...tail]), [...pulses, final]);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(checkpoint), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.equal(hash(), divided);
		assert.deepEqual(pulses.map((_, grant) => pulse(mixed[grant % mixed.length]).row), pulses);
		assert.equal(hash(), final);
		console.log(`PINNED-FLOORDIV:PASS O${level} (linked GC assist allowance pc 0x${floor.toString(16)}, ${cyclesAfter - cyclesBefore} of ${whole.used} cycles native)`);
	}
} finally {
	rmSync(directory, { recursive: true, force: true });
}
