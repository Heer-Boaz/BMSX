import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_LAST_EPOCH_WORK, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { GC_ASSIST_BYTES, GC_STEP_WORDS } from '../../../machine/ts/machine/cpu/lua_heap';
import { valueInteger, valueNil, valueString, valueTable } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { instructionLowB, instructionOpcode } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { BiosCall } from '../../../machine/ts/spec/bmsx/bios';
import { HEAP_SERVICE_BIOS_CALL_OFFSET, HeapServiceBiosCallField, HeapServiceBiosCallKind, HeapServiceGcStage } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = `
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

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-gc-collect-step-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const image = linkTestSystemBlua32(compileHeapServiceSystem(source, opt, modules));
		const rom = join(directory, `system-O${opt}.rom`);
		writeFileSync(rom, image.romBytes);
		for (const entry of [GcPhase.Pause, GcPhase.Atomic, GcPhase.Strings]) {
			const id = `O${opt}-phase${entry}`;
			const cfg = { systemRomBytes: image.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC };
			const runtime = new Runtime(cfg, input), oracle = new Runtime(cfg, input);
			runtime.boot();
			oracle.boot();
			const { cpu, memory, scheduler } = runtime.machine, { gc, luaHeap: budget, heapAllocator: arena } = cpu;
			const management = arena.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
			const state = management + HEAP_SERVICE_BIOS_CALL_OFFSET;
			const completion = () => memory.readRamRecordWord(state + HeapServiceBiosCallField.Kind);
			const pc = () => cpu.readFramePc(cpu.getFrameDepth() - 1);
			const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			function atStep() {
				if (cpu.heapServiceActive()) return false;
				const head = memory.readMappedU32LE(pc());
				const body = instructionOpcode(head) === OpCode.WIDE ? memory.readMappedU32LE(pc() + 4) : head;
				return instructionOpcode(body) === OpCode.BIOSCALL && instructionLowB(body) === BiosCall.CollectStep;
			}
			for (let i = 0; i < 16384 && !atStep(); ++i) assert.notEqual(slice(1), RunResult.Halted);
			assert.ok(atStep(), 'the public Step branch lowered to the generic gate');
			const caller = cpu.getFrameDepth() - 1, origin = pc();
			const originalTop = cpu.getFrameRegisterCount(caller);
			const next = origin + (instructionOpcode(memory.readMappedU32LE(origin)) === OpCode.WIDE ? 8 : 4);
			budget.setCollectionTarget(budget.capacity());
			const slots = entry === GcPhase.Atomic ? 2 * GC_STEP_WORDS : 16;
			const weak = cpu.createTable(slots, 0), meta = cpu.createTable(0, 1), dead = cpu.createTable();
			gc.tables.set(meta, valueString(gc['modeKey']), valueString(cpu.stringPool.intern('v')));
			gc.tables.setMetatableAddress(weak, meta);
			gc.tables.set(weak, valueInteger(slots), valueTable(dead));
			cpu.setGlobalByKey(cpu.stringPool.intern('explicit-step-weak-root'), valueTable(weak));
			for (let n = 0; n < 64 && entry === GcPhase.Atomic && gc.phase() !== entry; ++n) gc.step();
			for (let n = 0; n < 4096 && entry === GcPhase.Strings && gc.phase() !== entry; ++n)
				gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
			assert.equal(gc.phase(), entry);
			const seed = captureRuntimeSaveState(runtime), seedFile = join(directory, `${id}.seed`);
			writeFileSync(seedFile, encodeRuntimeSaveState(seed));
			applyRuntimeSaveState(oracle, seed);
			const ref = oracle.machine.cpu;
			const before = gc.epochWork(), work = ref.gc.step(), finished = !ref.gc.active();
			const target = finished ? ref.luaHeap.collectionTarget() : ref.luaHeap.usedBytes() + GC_ASSIST_BYTES;
			if (entry === GcPhase.Atomic) {
				assert.ok(work > GC_STEP_WORDS, 'the original Atomic admission needs several physical quanta');
				assert.equal(ref.gc.phase(), GcPhase.Sweep);
			}
			assert.equal(finished, entry === GcPhase.Strings);

			const commands: string[] = [], expected: string[] = [];
			function record(command: string, row: string | number) { commands.push(command); expected.push(String(row)); }
			function grant(cycles: number) {
				const result = slice(cycles), spent = cycles - cpu.instructionBudgetRemaining;
				assert.ok(spent > 0);
				assert.equal(gc.serviceStage(), HeapServiceGcStage.Idle);
				record(`L ${cycles}`, `${result} ${spent} ${+cpu.heapServiceActive()} ${gc.serviceStage()} ${gc.fullEpochs()} ${gc.phase()} ${budget.usedBytes()}`);
				return { result, spent };
			}
			assert.deepEqual(grant(1), { result: RunResult.Yielded, spent: BASE_CYCLES[OpCode.BIOSCALL] });
			assert.ok(cpu.heapServiceActive());
			assert.equal(cpu.readFramePc(caller), next);
			assert.equal(memory.readRamRecordWord(state + HeapServiceBiosCallField.InstructionPc), origin);
			assert.equal(completion(), HeapServiceBiosCallKind.Opcode);
			const resultTop = memory.readRamRecordWord(state + HeapServiceBiosCallField.ResultBaseOrProtectedIndex) + 1;
			assert.equal(cpu.getFrameRegisterCount(caller), originalTop, 'zero operands leave the caller root window unchanged');
			const oldTarget = budget.collectionTarget();
			for (let n = 0; n < 32768 && budget.collectionTarget() === oldTarget; ++n) {
				grant(gc.phase() === ref.gc.phase() ? 1 : 79);
				if (entry === GcPhase.Atomic && gc.phase() === GcPhase.Atomic)
					assert.equal(gc.epochWork(), before, 'Atomic subquanta do not credit partial work');
			}
			assert.equal(budget.collectionTarget(), target);
			assert.equal(gc.phase(), ref.gc.phase());
			if (finished) assert.equal(gc.epochWork(), before, 'String completion reprices before the epoch-accounting epilogue');
			else assert.equal(gc.epochWork(), ref.gc.epochWork());
			assert.ok(cpu.heapServiceActive() && completion() === HeapServiceBiosCallKind.Opcode, 'target publication precedes the Boolean return');
			assert.equal(cpu.readFramePc(caller), next);
			const partial = captureRuntimeSaveState(runtime), partialFile = join(directory, `${id}.partial`);
			const fromCpp = join(directory, `${id}.cpp`);
			writeFileSync(partialFile, encodeRuntimeSaveState(partial));
			const count = commands.length;
			function drain() {
				for (let n = 0; n < 4096 && cpu.heapServiceActive(); ++n) grant(1);
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(completion(), HeapServiceBiosCallKind.Idle);
				assert.equal(cpu.getFrameRegisterCount(caller), Math.max(originalTop, resultTop));
				assert.equal(gc.epochWork(), ref.gc.epochWork());
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
			console.log(`BIOS-COLLECT-STEP:PASS ${id} (${work} policy units, result ${finished}, exact timed grants and cross-core restore)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
