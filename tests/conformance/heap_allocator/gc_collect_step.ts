import { nativeHeapReference } from '../../helpers/native_heap/reference';
import { createReferenceTable } from '../../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_WINDOW_MASK, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_ASSIST_BYTES, GC_STEP_WORDS } from '../../helpers/native_heap/lua_heap';
import { valueBool, valueInteger, valueNil, valueString, valueTable } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GC_LAST_EPOCH_WORK, GcPhase } from '../../helpers/native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = `
require('base')
halt_until_irq
local ok, finished = pcall(collectgarbage, 'step')
if not ok then return -1 end
if finished == true then return 17 end
if finished == false then return 13 end
return -2
`;
const modules = [
	// Use the production base source. Its numeric parser and console are
	// unused by this fixture; the full BIOS build binds both.
	{ path: 'tty/console', source: 'return {}' },
	{ path: 'number/parse', source: 'return {}' },
	{ path: 'base', source: readFileSync('machine/bios/base.lua', 'utf8') },
];

const directory = mkdtempSync(join(tmpdir(), 'bmsx-gc-collect-step-'));
try {
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	for (const opt of [0, 3] as const) {
		const image = linkManagedTestSystem(source, opt, modules);
		const romBytes = writeTestBlua32Rom(image), rom = join(directory, `system-O${opt}.rom`);
		writeFileSync(rom, romBytes);
		for (const entry of [GcPhase.Pause, GcPhase.Atomic, GcPhase.Strings]) {
			const id = `O${opt}-phase${entry}`;
			const cfg = { systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC };
			const runtime = new Runtime(cfg, input), oracle = new Runtime(cfg, input);
			runtime.boot();
			oracle.boot();
			const { cpu, memory, scheduler } = runtime.machine, { gc, luaHeap: budget, heapAllocator: arena } = nativeHeapReference(cpu);
			const management = arena.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
			runGuestToHalt(cpu, 4_194_304);
			assert.ok(cpu.isHaltedUntilIrq());
			const thread = cpu.rootThread;
			cpu.requestRegisterWindow(512, 64, scheduler.cyclesUntilDeadline());
			runGuestToHalt(cpu, 65_536, thread.frameDepth - 1);
			assert.ok(cpu.isHaltedUntilIrq());
			cpu.clearHaltUntilIrq();
			const pc = () => cpu.readFramePc(cpu.getFrameDepth() - 1);
			const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const instruction = () => decodeBlua32InstructionAtPc(image.layout.textBytes, image.layout.header.textAddress, pc());
			function atStep() {
				if (cpu.fixedInterruptActive()) return false;
				const { op, a, b } = instruction();
				return op === OpCode.SVC && b === 1
					&& cpu.readFrameRegister(cpu.getFrameDepth() - 1, a) === valueInteger(0x10002);
			}
			for (let i = 0; i < 16384 && !atStep(); ++i) assert.notEqual(slice(1), RunResult.Halted);
			assert.ok(atStep(), 'the public Step branch reaches its supervisor instruction');
			const owner = cpu.activeThread.address, caller = cpu.getFrameDepth() - 1, call = instruction();
			const originalTop = cpu.getFrameRegisterCount(caller);
			const next = call.pc + INSTRUCTION_BYTES;
			budget.setCollectionTarget(budget.capacity());
			const slots = entry === GcPhase.Atomic ? 2 * GC_STEP_WORDS : 16;
			const weak = createReferenceTable(cpu, slots, 0), meta = createReferenceTable(cpu, 0, 1), dead = createReferenceTable(cpu);
			gc.tables.set(meta, valueString(nativeHeapReference(cpu).stringPool.find('__mode')!), valueString(nativeHeapReference(cpu).stringPool.intern('v')));
			gc.tables.setMetatableAddress(weak, meta);
			gc.tables.set(weak, valueInteger(slots), valueTable(dead));
			setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.intern('explicit-step-weak-root'), valueTable(weak));
			for (let n = 0; n < 64 && entry === GcPhase.Atomic && gc.phase() !== entry; ++n) gc.step();
			for (let n = 0; n < 4096 && entry === GcPhase.Strings && gc.phase() !== entry; ++n)
				gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
			assert.equal(gc.phase(), entry);
			assert.equal(gc.tables.getInteger(weak, slots), entry === GcPhase.Strings ? valueNil() : valueTable(dead));
			const seed = captureRuntimeSaveState(runtime), seedFile = join(directory, `${id}.seed`);
			writeFileSync(seedFile, encodeRuntimeSaveState(seed));
			applyRuntimeSaveState(oracle, seed);
			const ref = oracle.machine.cpu, { gc: refGc } = nativeHeapReference(ref);
			const before = gc.epochWork(), work = refGc.step(), finished = !refGc.active();
			const target = finished ? nativeHeapReference(ref).luaHeap.collectionTarget() : nativeHeapReference(ref).luaHeap.usedBytes() + GC_ASSIST_BYTES;
			if (entry === GcPhase.Atomic) {
				assert.ok(work > GC_STEP_WORDS, 'the original Atomic admission needs several physical quanta');
				assert.equal(refGc.phase(), GcPhase.Sweep);
			}
			assert.equal(finished, entry === GcPhase.Strings);

			const commands: string[] = [], expected: string[] = [];
			function record(command: string, row: string | number) { commands.push(command); expected.push(String(row)); }
			function grant(cycles: number) {
				const result = slice(cycles), spent = cycles - cpu.instructionBudgetRemaining;
				assert.ok(spent > 0);
				record(`E ${cycles}`, `${result} ${spent} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
				return { result, spent };
			}
			assert.deepEqual(grant(1), { result: RunResult.Yielded, spent: BASE_CYCLES[OpCode.SVC] });
			assert.ok(cpu.fixedInterruptActive());
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
			assert.equal(cpu.readEpcWord(), next);
			record('Z', `${CPU_CAUSE_CODE_SYSCALL} 0 ${next}`);
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
			assert.equal(cpu.readThreadFrameWord(owner, caller, FrameField.Pc), next);
			assert.equal(cpu.readThreadFrameWord(owner, caller, FrameField.Top) & FRAME_WINDOW_MASK, originalTop);
			const oldTarget = budget.collectionTarget();
			for (let n = 0; n < 32768 && budget.collectionTarget() === oldTarget; ++n) {
				grant(gc.phase() === refGc.phase() ? 1 : 79);
				if (entry === GcPhase.Atomic && gc.phase() === GcPhase.Atomic)
					assert.equal(gc.epochWork(), before, 'Atomic subquanta do not credit partial work');
			}
			assert.equal(budget.collectionTarget(), target);
			assert.equal(gc.phase(), refGc.phase());
			if (finished) assert.equal(gc.epochWork(), before, 'String completion reprices before the epoch-accounting epilogue');
			else assert.equal(gc.epochWork(), refGc.epochWork());
			assert.ok(cpu.fixedInterruptActive(), 'target publication precedes the Boolean return');
			assert.equal(cpu.readThreadFrameWord(owner, caller, FrameField.Pc), next);
			// The target belongs to the Step quantum; a stopped final mark
			// settles separately, before the borrowed caller can run again.
			const finalMarkWork = refGc.finishFinalMark();
			const partial = captureRuntimeSaveState(runtime), partialFile = join(directory, `${id}.partial`);
			const fromCpp = join(directory, `${id}.cpp`);
			writeFileSync(partialFile, encodeRuntimeSaveState(partial));
			const count = commands.length;
			function drain() {
				for (let n = 0; n < 32768 && cpu.fixedInterruptActive(); ++n) grant(1);
				assert.ok(!cpu.fixedInterruptActive(), `step did not RFE: ${id} phase=${gc.phase()} reason=${cpu.readLuaFaultReasonWord()} pc=${cpu.lastPc} EPC=${cpu.readEpcWord()}`);
				assert.equal(cpu.activeThread.address, owner);
				assert.equal(cpu.getFrameRegisterCount(caller), Math.max(originalTop, call.a + 1));
				assert.equal(cpu.readFrameRegister(caller, call.a), valueBool(finished));
				assert.equal(gc.epochWork(), refGc.epochWork());
				assert.equal(gc.phase(), refGc.phase());
				assert.equal(refGc.tables.getInteger(weak, slots), valueNil());
				assert.equal(gc.tables.getInteger(weak, slots), valueNil(), 'the stopped Step clears the weak value before RFE');
				assert.equal(memory.readRamRecordWord(control + GC_LAST_EPOCH_WORK), ref.memory.readRamRecordWord(control + GC_LAST_EPOCH_WORK));
				assert.equal(cpu.readFramePc(caller), next);
				const end = finished ? 17 : 13;
				for (let n = 0; n < 64 && cpu.getFrameDepth(); ++n) grant(97);
				assert.deepEqual(runtime.readCompletionValues(), [valueInteger(end)], 'pcall and comparison see the exact Boolean tag');
				record('C', end);
				const low = memory.ramBusEnd() - RAM_BASE, last = memory.ramData().length;
				record(`H ${low} ${last}`, hashBytes(memory.ramData(), low, last - low));
			}
			drain();
			const tail = commands.slice(count), rows = expected.slice(count);
			function check(name: string, stateFile: string, tx: string[], rx: string[]) {
				const trace = join(directory, `${id}-${name}.trace`);
				writeFileSync(trace, tx.join('\n'));
				const rows = execFileSync(native, [rom, trace, stateFile], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trimEnd().split('\n');
				const mismatch = rows.findIndex((row, index) => row !== rx[index]);
				assert.equal(mismatch, -1, `${name} row ${mismatch}: C++=${rows[mismatch]} TS=${rx[mismatch]}`);
				assert.equal(rows.length, rx.length);
			}
			check('cold', seedFile, ['X', ...commands], expected);
			check('restore', partialFile, ['X', 'l', 's', `x ${fromCpp}`, ...tail, 'u', ...tail], [...rows, ...rows]);
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(fromCpp), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			commands.length = expected.length = count;
			drain();
			assert.deepEqual(commands.slice(count), tail);
			assert.deepEqual(expected.slice(count), rows);
			console.log(`BIOS-COLLECT-STEP:PASS ${id} (${work} Step units + ${finalMarkWork} final-mark units, result ${finished}, exact timed grants and cross-core restore)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
