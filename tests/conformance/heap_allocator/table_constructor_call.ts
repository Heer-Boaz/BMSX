import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { asInteger, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_INVALID_ARGUMENT, LUA_FAULT_REASON_OUT_OF_MEMORY } from '../../../machine/ts/spec/blua32/cop0';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_CLOSURE_OFFSET, HEAP_SERVICE_RESIDENT_OFFSET, HeapServiceResidentField } from '../../../machine/ts/spec/bmsx/heap_service';
import { CART_ROM_BASE, HEAP_PAGE_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { cartridgeSlots } from '../../helpers/cartridge';
import { BASE_FIRMWARE_MODULES } from '../../helpers/firmware_modules';
import { loadTestBiosUtilityModules } from '../../helpers/heap_service_system';
import { linkManagedTestSystem, TEST_CART_TRANSFER_SOURCE } from '../../helpers/managed_system';
import { BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { BLUA32_FUNCTION_RECORD_SIZE, BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { BiosFunction } from '../../../machine/ts/spec/bmsx/bios';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { BIOS_FUNCTION_EXPORTS } from '../../../toolchain/ts/rompack/system';

const source = `local t = {120, x = 63, b = 2, c = 3, d = 4, e = 5, f = 6, g = 7, h = 8}
return t[1] + t.x, t`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const deadText = 'bios call recover exhausted table backing '.repeat(144);
mkdirSync('tmp', { recursive: true });
const dir = mkdtempSync(join('tmp', 'bmsx-table-constructor-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const system = `
require('base')
function exception(error) halt_until_irq end
${TEST_CART_TRANSFER_SOURCE}`;
		const linkedSystem = linkManagedTestSystem(system, opt,
			[...loadTestBiosUtilityModules(), ...BASE_FIRMWARE_MODULES, { path: 'tty/console', source: 'return {}' }], BIOS_FUNCTION_EXPORTS);
		const systemRomBytes = writeTestBlua32Rom(linkedSystem);
		const linkCart = (entrySource: string) => {
			const program = compileLuaChunkToProgram(parseLuaChunk(entrySource), [], { entrySource, optLevel: opt });
			return linkCartBlua32Image(linkedSystem.biosImports, encodeCompiledProgramObject(program), program.metadata,
				CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
		};
		const linkedCart = linkCart(source);
		const cartRomBytes = writeTestBlua32Rom(linkedCart);
		const rom = join(dir, `O${opt}.rom`);
		writeFileSync(rom, systemRomBytes);
		const cart = join(dir, `O${opt}-cart.rom`);
		writeFileSync(cart, cartRomBytes);
		for (const scenario of ['recovered', 'oom'] as const) {
			const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridgeSlots(cartRomBytes), machineModel: PSX_MACHINE_SPEC }, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, { heapAllocator: arena, gc } = cpu;
			const management = arena.managementOffset(), resident = management + HEAP_SERVICE_RESIDENT_OFFSET;
			const closureLatch = management + HEAP_SERVICE_CLOSURE_OFFSET;
			const framePc = () => cpu.readFramePc(cpu.getFrameDepth() - 1);
			const run = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			for (let i = 0; i < 256 && !cpu.isCartridgeExecutionActive(); ++i) run(4096);
			assert.ok(cpu.isCartridgeExecutionActive());
			const instructions = linkedCart.layout.functions.map(fn => {
				const code: (ReturnType<typeof decodeBlua32InstructionAtPc> & { start: number })[] = [];
				for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount;) {
					const op = decodeBlua32InstructionAtPc(linkedCart.layout.textBytes, linkedCart.layout.header.textAddress, pc);
					code.push({ ...op, start: pc });
					pc = op.pc + 4;
				}
				return code;
			});
			const constructor = instructions.find(code => code.some(op => op.op === OpCode.SETFIELD))!.find(op => op.op === OpCode.CALL)!;
			const original = constructor.start, resume = constructor.pc + 4;
			for (let i = 0; i < 16384 && framePc() !== original; ++i) run(1);
			assert.equal(framePc(), original);

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
				assert.equal(stage, 0, 'resident CLOSURE loads a function without allocating');
				observe(`J ${cycles} 1`, `${result} ${used} ${+cpu.heapServiceActive()} ${stage} ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
				return used;
			}
			assert.equal(grant(1), BASE_CYCLES[OpCode.CALL] + 2);
			assert.ok(cpu.heapServiceActive());
			assert.equal(framePc(), resume);
			assert.equal(memory.readRamRecordWord(resident + HeapServiceResidentField.IssuePc), original);
			for (let i = 0; i < 4096 && gc.phase() !== GcPhase.Strings; ++i) {
				assert.ok(cpu.heapServiceActive());
				assert.equal(framePc(), resume);
				grant(57);
			}
			assert.equal(gc.phase(), GcPhase.Strings);
			const interrupted = captureRuntimeSaveState(runtime);
			const interruptedRam = history.capture(memory, baseline);
			writeFileSync(partial, encodeRuntimeSaveState(interrupted));
			const prefixLength = trace.length;
			function finish() {
				assert.ok(cpu.heapServiceActive());
				for (let i = 0; i < 4096 && cpu.heapServiceActive(); ++i) grant(127);
				assert.equal(cpu.heapServiceActive(), false);
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
			console.log(`BIOS-CREATE-TABLE:PASS O${opt} ${scenario} (${wholeTrace.length} grant/RAM observations)`);
		}
		const protectedSource = `
return function()
local image<const> = mem32le[${BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET}]
local table_address<const> = mem32le[image + ${BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET}]
local create<const> = blua32.closure(table_address + ${BiosFunction.CreateTable * BLUA32_FUNCTION_RECORD_SIZE})
local bad_tag, e1 = pcall(create, false, 0)
local bad_range, e2 = pcall(create, 32768, 0)
local bad_float, e3 = pcall(create, 1.5, 0)
local t<const> = create(8, 3)
t[1] = 183
if bad_tag or bad_range or bad_float or type(e1) ~= 'string' or e1 ~= e2 or e1 ~= e3 then
	return -1, t
end
return t[1], t
end
`;
		const protectedBytes = writeTestBlua32Rom(linkCart(protectedSource));
		const protectedCart = join(dir, `O${opt}-protected.rom`);
		const protectedTrace = join(dir, `O${opt}-protected.trace`);
		const protectedSeed = join(dir, `O${opt}-protected.seed`);
		writeFileSync(protectedCart, protectedBytes);
		const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridgeSlots(protectedBytes), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, scheduler } = runtime.machine;
		let bootResult = RunResult.Yielded;
		for (let i = 0; i < 256 && bootResult !== RunResult.Halted; ++i)
			bootResult = scheduler.runCpuSlice(0, 8192, undefined, CpuRunKind.Direct);
		assert.equal(bootResult, RunResult.Halted);
		const [entry] = runtime.readCompletionValues();
		assert.equal(valueTag(entry), ValueTag.Closure);
		cpu.beginCompletionCall(valuePayload(entry));
		writeFileSync(protectedSeed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const commands = ['X'], rows: string[] = [];
		let result = RunResult.Yielded;
		for (let i = 0; i < 128 && result !== RunResult.Halted; ++i) {
			result = scheduler.runCpuSlice(0, 8192, undefined, CpuRunKind.Direct);
			commands.push('J 8192 0');
			rows.push(`${result} ${8192 - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} 0 ${cpu.heapAllocator.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
		}
		assert.equal(result, RunResult.Halted);
		assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
		assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_INVALID_ARGUMENT, 'the firmware catches the invalid hints through the Trap vector');
		const values = runtime.readCompletionValues();
		assert.equal(asInteger(values[0]), 183);
		assert.equal(valueTag(values[1]), ValueTag.Table);
		commands.push('c');
		rows.push(`2 ${ValueTag.Integer} 183 ${ValueTag.Table} ${valuePayload(values[1])}`);
		writeFileSync(protectedTrace, commands.join('\n'));
		assert.deepEqual(execFileSync(native, [rom, protectedTrace, protectedSeed, protectedCart], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
		console.log(`BIOS-CREATE-TABLE:PASS O${opt} invalid protected arguments and tagged result`);

	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${dir}`);
	throw error;
}
