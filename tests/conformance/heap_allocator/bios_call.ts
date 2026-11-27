import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { asInteger, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { instructionOpcode } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_BIOS_CALL_OFFSET, HEAP_SERVICE_CLOSURE_OFFSET, HeapServiceBiosCallField, HeapServiceBiosCallKind } from '../../../machine/ts/spec/bmsx/heap_service';
import { CART_ROM_BASE, HEAP_PAGE_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { linkTestBlua32Pair } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = `local t = {120, x = 63, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8}
return t[1] + t.x, t`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const deadText = 'bios call recover exhausted table backing '.repeat(144);
const dir = mkdtempSync(join('tmp', 'bmsx-bios-call-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const system = `function exception(error) halt_until_irq end
cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]`;
		const image = linkTestBlua32Pair(compileHeapServiceSystem(system, opt), compileLuaChunkToProgram(parseLuaChunk(source), [], {entrySource: source, optLevel: opt}));
		const rom = join(dir, `O${opt}.rom`);
		writeFileSync(rom, image.systemRomBytes);
		const cart = join(dir, `O${opt}-cart.rom`);
		writeFileSync(cart, image.cartRomBytes);
		for (const scenario of ['recovered', 'oom'] as const) {
			const runtime = new Runtime({ systemRomBytes: image.systemRomBytes, cartridgeSlots: cartridgeSlots(image.cartRomBytes), machineModel: PSX_MACHINE_SPEC }, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, { heapAllocator: arena, gc } = cpu;
			const management = arena.managementOffset(), call = management + HEAP_SERVICE_BIOS_CALL_OFFSET;
			const closureLatch = management + HEAP_SERVICE_CLOSURE_OFFSET;
			const completion = () => memory.readRamRecordWord(call + HeapServiceBiosCallField.Kind);
			const framePc = () => cpu.readFramePc(cpu.getFrameDepth() - 1);
			const run = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			for (let i = 0; i < 16384 && instructionOpcode(memory.readMappedU32LE(framePc())) !== OpCode.BIOSCALL; ++i) run(1);
			assert.equal(instructionOpcode(memory.readMappedU32LE(framePc())), OpCode.BIOSCALL);
			const original = framePc();
			cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
			if (scenario === 'recovered') cpu.stringPool.intern(deadText);
			while (arena.allocate(HEAP_PAGE_SIZE - 8, true)) { /* fill page fits */ }
			while (arena.allocate(16, true)) { /* fill small fits */ }
			const seed = join(dir, `O${opt}-${scenario}.seed`), partial = join(dir, `O${opt}-${scenario}.partial`);
			const nativePartial = join(dir, `O${opt}-${scenario}.native`);
			writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			const trace: string[] = [], expected: string[] = [];
			const observe = (command: string, outcome: string | number) => { trace.push(command); expected.push(String(outcome)); };
			function grant(cycles: number) {
				const result = run(cycles);
				const used = cycles - cpu.instructionBudgetRemaining;
				const stage = memory.readRamRecordWord(closureLatch);
				assert.equal(stage, 0, 'BIOSCALL does not issue a CLOSURE continuation');
				observe(`J ${cycles} 1`, `${result} ${used} ${+cpu.heapServiceActive()} ${stage} ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
				return used;
			}
			assert.equal(grant(1), BASE_CYCLES[OpCode.BIOSCALL]);
			assert.equal(completion(), HeapServiceBiosCallKind.Opcode);
			assert.ok(cpu.heapServiceActive());
			assert.equal(framePc(), original + 4);
			assert.equal(memory.readRamRecordWord(call + HeapServiceBiosCallField.InstructionPc), original);
			for (let i = 0; i < 4096 && gc.phase() !== GcPhase.Strings; ++i) {
				assert.ok(cpu.heapServiceActive());
				assert.equal(framePc(), original + 4);
				grant(57);
			}
			assert.equal(gc.phase(), GcPhase.Strings);
			const interrupted = captureRuntimeSaveState(runtime);
			const interruptedRam = history.capture(memory, baseline);
			writeFileSync(partial, encodeRuntimeSaveState(interrupted));
			const prefixLength = trace.length;
			function finish() {
				assert.equal(completion(), HeapServiceBiosCallKind.Opcode);
				assert.ok(cpu.heapServiceActive());
				for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) grant(127);
				assert.equal(cpu.heapServiceActive(), false);
				assert.equal(completion(), HeapServiceBiosCallKind.Idle);
				if (scenario === 'oom') {
					assert.equal(cpu.readCauseWord() & CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_TRAP);
					assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_OUT_OF_MEMORY);
					assert.equal(cpu.readEpcWord(), original);
					observe('Z', `${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${original}`);
				} else {
					assert.equal(cpu.readLuaFaultReasonWord(), 0);
					assert.equal(cpu.stringPool.find(deadText), undefined);
					grant(4096);
					const values = runtime.readCompletionValues();
					assert.equal(asInteger(values[0]), 183);
					assert.equal(valueTag(values[1]), ValueTag.Table);
					assert.equal(valuePayload(values[1]), memory.readRamRecordWord(call + HeapServiceBiosCallField.Word));
					observe('C', 183);
				}
				const first = memory.ramBusEnd() - RAM_BASE, last = memory.ramData().length;
				observe(`H ${first} ${last}`, hashBytes(memory.ramData(), first, last - first));
			}
			finish();
			const wholeTrace = trace.slice(), wholeExpected = expected.slice();
			function check(name: string, state: string, commands: string[], output: string[]) {
				const log = join(dir, `${opt}-${scenario}-${name}.trace`);
				writeFileSync(log, commands.join('\n'));
				const observed = execFileSync(native, [rom, log, state, cart], { encoding: 'utf8' }).trimEnd().split('\n');
				const diff = observed.findIndex((row, index) => row !== output[index]);
				assert.equal(diff, -1, `${name} line ${diff}: TS=${output[diff]} C++=${observed[diff]}`);
				assert.equal(observed.length, output.length);
			}
			const tail = wholeTrace.slice(prefixLength), tailExpected = wholeExpected.slice(prefixLength);
			check('cold', seed, ['X', 'l', ...wholeTrace.slice(0, prefixLength), 's', `x ${nativePartial}`, ...tail, 'u', ...tail],
				[...wholeExpected, ...tailExpected]);
			check('portable', partial, ['X', ...tail], tailExpected);
			history.restore(memory, history.capture(memory, interruptedRam), interruptedRam);
			applyRuntimeCheckpointState(runtime, interrupted, RuntimeRestoreOrigin.HistorySeek);
			trace.length = expected.length = 0;
			finish();
			assert.deepEqual(trace, tail);
			assert.deepEqual(expected, tailExpected);
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			trace.length = expected.length = 0;
			finish();
			assert.deepEqual(trace, tail);
			assert.deepEqual(expected, tailExpected);
			console.log(`BIOS-CALL:PASS O${opt} ${scenario} (${wholeTrace.length} grant/RAM observations)`);
		}
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
