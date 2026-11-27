import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { asInteger, valueBool, valueInteger, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, MAIN_RAM_SIZE, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileCartlibProgram } from '../../helpers/cartlib_cpu';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';

const bytes = 8192;
const cartSource = `
local source<const> = 'L\\xff\\x00${'q'.repeat(bytes - 3)}ZJ'
local ok<const>, result<const> = pcall(string.sub, source, 2.75, -2)
if not ok then return false, result end
assert(#result == ${bytes})
assert(string.byte(result, 1) == 255 and string.byte(result, 2) == 0)
assert(string.byte(result, -1 + #result) == 113 and string.byte(result, #result) == 90)
return true, 37
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const directory = mkdtempSync(join(tmpdir(), 'bmsx-string-slice-call-'));
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');

try {
	for (const optLevel of [0, 3] as const) {
		const { images } = compileCartlibProgram(cartSource, { optLevel });
		const system = join(directory, `O${optLevel}.rom`), cart = join(directory, `O${optLevel}-cart.rom`);
		writeFileSync(system, images.systemRomBytes);
		writeFileSync(cart, images.cartRomBytes);
		for (const outcome of ['new', 'oom'] as const) {
			const runtime = new Runtime({
				systemRomBytes: images.systemRomBytes, cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC,
			}, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, { heapAllocator: arena, gc } = cpu;
			const run = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const issue = () => {
				if (!cpu.fixedInterruptActive() || cpu.readCauseWord() !== CPU_CAUSE_CODE_SYSCALL) return null;
				const owner = memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), depth = cpu.readThreadFrameDepth(owner) - 1;
				if (cpu.readThreadFrameExecutionDomain(owner, depth) >= 0) return null;
				const pc = cpu.readEpcWord();
				const op = decodeBlua32InstructionAtPc(images.systemRomBytes, SYSTEM_ROM_BASE, pc - INSTRUCTION_BYTES);
				if (op.op !== OpCode.SVC || op.b !== 4 || cpu.readThreadRegister(owner, depth, op.a) !== valueInteger(0x10008)) return null;
				return { owner, depth, pc };
			};
			let call = issue();
			for (let i = 0; i < 200_000 && call === null; ++i) { run(73); call = issue(); }
			assert.ok(call, `the public string.sub entered the SVC vector (cause ${cpu.readCauseWord()}, Lua ${cpu.readLuaFaultReasonWord()}, EPC ${cpu.readEpcWord().toString(16)})`);
			const { owner, depth, pc } = call;
			const inSlice = () => cpu.fixedInterruptActive() && cpu.readCauseWord() === CPU_CAUSE_CODE_SYSCALL
				&& memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS) === owner;
			assert.equal(cpu.heapServiceActive(), false);
			cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
			if (outcome === 'oom') {
				for (let extent = MAIN_RAM_SIZE >> 1; extent >= 1024; extent >>= 1)
					while (arena.allocate(extent, true)) { /* exhaust this physical size class */ }
				assert.equal(arena.allocate(bytes + 16, true), 0, 'no free run fits the requested String');
			}
			const physicalBefore = arena.occupiedBytes();
			const phaseBefore = gc.phase();
			const seed = join(directory, 'seed'), partialPath = join(directory, 'partial'), nativePartial = join(directory, 'native-partial');
			writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			const commands: string[] = [], expected: string[] = [];
			function observe(command: string, result: string | number) {
				commands.push(command);
				expected.push(String(result));
			}
			function grant(cycles: number) {
				const result = run(cycles);
				observe(`J ${cycles} 1`, `${result} ${cycles - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${
					+cpu.fixedInterruptActive()} ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
				return result;
			}
			for (let i = 0; i < 8192 && (outcome === 'new' ? arena.occupiedBytes() === physicalBefore : gc.phase() === phaseBefore); ++i) {
				assert.ok(inSlice());
				assert.equal(cpu.readThreadFrameWord(owner, depth, FrameField.Pc), pc, 'the cart cannot observe an incomplete String');
				grant(73);
			}
			assert.ok(inSlice(), 'a grant ended inside the production String operation');
			if (outcome === 'new') assert.ok(arena.occupiedBytes() > physicalBefore, 'pause after the physical reservation');
			else assert.notEqual(gc.phase(), phaseBefore, 'collect before reporting refusal');
			const partial = captureRuntimeSaveState(runtime);
			const partialRam = history.capture(memory, baseline);
			writeFileSync(partialPath, encodeRuntimeSaveState(partial));
			const prefix = commands.length;

			function finish() {
				for (let i = 0; i < 8192 && inSlice(); ++i) grant(137);
				assert.equal(inSlice(), false);
				let result = RunResult.Yielded;
				for (let i = 0; i < 64 && result !== RunResult.Halted; ++i) result = grant(8192);
				assert.equal(result, RunResult.Halted);
				const values = runtime.readCompletionValues();
				assert.equal(values.length, 2);
				if (outcome === 'oom') {
					assert.equal(values[0], valueBool(false));
					assert.equal(valueTag(values[1]), ValueTag.String);
					assert.equal(cpu.stringPool.bytes(valuePayload(values[1])), 'Out of memory.');
				} else {
					assert.equal(values[0], valueBool(true));
					assert.equal(asInteger(values[1]), 37, 'guest consumed the entire raw byte slice');
				}
				observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
				const start = memory.ramBusEnd() - RAM_BASE, end = memory.ramData().length;
				observe(`H ${start} ${end}`, hashBytes(memory.ramData(), start, end - start));
			}
			finish();
			const tail = commands.slice(prefix), suffix = expected.slice(prefix);
			function compare(path: string, script: string[], result: string[]) {
				const trace = join(directory, 'trace');
				writeFileSync(trace, script.join('\n'));
				const actual = execFileSync(native, [system, trace, path, cart], { encoding: 'utf8' }).trimEnd().split('\n');
				const first = actual.findIndex((line, index) => line !== result[index]);
				assert.equal(first, -1, `O${optLevel} ${outcome} grant ${first}: TS=${result[first]} C++=${actual[first]}`);
				assert.equal(actual.length, result.length);
			}
			compare(seed, ['X', 'l', ...commands.slice(0, prefix), 's', `x ${nativePartial}`, ...tail, 'u', ...tail], [...expected, ...suffix]);
			compare(partialPath, ['X', ...tail], suffix);
			history.restore(memory, history.capture(memory, partialRam), partialRam);
			applyRuntimeCheckpointState(runtime, partial, RuntimeRestoreOrigin.HistorySeek);
			commands.length = expected.length = 0;
			finish();
			assert.deepEqual(expected, suffix);
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			commands.length = expected.length = 0;
			finish();
			assert.deepEqual(expected, suffix);
			console.log(`BIOS-STRING-SLICE:PASS O${optLevel} ${outcome} (${prefix + tail.length} matching grant/RAM observations)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
