import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { asInteger } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { HEAP_SERVICE_CLOSURE_OFFSET, HEAP_SERVICE_FRAME_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { MAIN_RAM_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileCartlibProgram } from '../../helpers/cartlib_cpu';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const bytes = 8192;
const cartSource = `
local source<const> = 'L\\xff\\x00${'q'.repeat(bytes - 3)}ZJ'
local result<const> = string.sub(source, 2.75, -2)
assert(#result == ${bytes})
assert(string.byte(result, 1) == 255 and string.byte(result, 2) == 0)
assert(string.byte(result, -1 + #result) == 113 and string.byte(result, #result) == 90)
return 37
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const directory = mkdtempSync(join('tmp', 'bmsx-string-slice-call-'));
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');

try {
	for (const optLevel of [0, 3] as const) {
		const { images } = compileCartlibProgram(cartSource, { optLevel });
		const system = join(directory, `O${optLevel}.rom`), cart = join(directory, `O${optLevel}-cart.rom`);
		writeFileSync(system, images.systemRomBytes);
		writeFileSync(cart, images.cartRomBytes);
		const entryIndex = images.systemSymbols.metadata.functionIds.findIndex(id => id.startsWith('module:kernel/bios_string_slice/') && id.endsWith('|constant|intern_slice'));
		assert.ok(entryIndex >= 0, 'the public library links to a static BIOS function');
		const entry = images.systemImage.functions[entryIndex].address;

		for (const outcome of ['new', 'oom'] as const) {
			const runtime = new Runtime({
				systemRomBytes: images.systemRomBytes, cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC,
			}, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, { heapAllocator: arena, gc } = cpu;
			const management = arena.managementOffset();
			const run = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const inSlice = () => cpu.heapServiceActive() && memory.readRamRecordWord(management + HEAP_SERVICE_FRAME_OFFSET + FrameField.Function) === entry;
			for (let i = 0; i < 200_000 && !inSlice(); ++i) run(73);
			assert.ok(inSlice(), `the cartridge call entered the linked BIOS function (cause ${cpu.readCauseWord()}, Lua ${cpu.readLuaFaultReasonWord()}, EPC ${cpu.readEpcWord().toString(16)})`);
			const callerPc = cpu.readFramePc(cpu.getFrameDepth() - 1);
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
					memory.readRamRecordWord(management + HEAP_SERVICE_CLOSURE_OFFSET)} ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
				return result;
			}
			for (let i = 0; i < 8192 && (outcome === 'new' ? arena.occupiedBytes() === physicalBefore : gc.phase() === phaseBefore); ++i) {
				assert.ok(inSlice());
				assert.equal(cpu.readFramePc(cpu.getFrameDepth() - 1), callerPc, 'the cart cannot observe an incomplete String');
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
				if (outcome === 'oom') {
					assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
					observe('Z', `${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${cpu.readEpcWord()}`);
				} else {
					let result = RunResult.Yielded;
					for (let i = 0; i < 64 && result !== RunResult.Halted; ++i) result = grant(8192);
					assert.equal(result, RunResult.Halted);
					assert.equal(cpu.readLuaFaultReasonWord(), 0);
					assert.equal(asInteger(runtime.readCompletionValues()[0]), 37, 'guest consumed the entire raw byte slice');
					observe('C', 37);
				}
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
