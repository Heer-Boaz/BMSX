import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger, valueResidentFunction, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { BiosFunction } from '../../../machine/ts/spec/bmsx/bios';
import { HEAP_SERVICE_CLOSURE_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkTestBlua32Pair } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const boot = 'cop0.exec = mem32le[0x10000028]';
const locals = Array.from({ length: 4100 }, (_, index) => `slot${index}`).join(',');
const entrySource = `
local ${locals}
local probe = {0,17,0,0,0; x=31,y=41,z=3}
return probe[2] * 10 + probe.z, probe
`;

mkdirSync('tmp', { recursive: true });
const folder = mkdtempSync(join('tmp', 'bmsx-high-constructor-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const cart = compileLuaChunkToProgram(parseLuaChunk(entrySource), [], { entrySource, optLevel });
		const pair = linkTestBlua32Pair(compileHeapServiceSystem(boot, optLevel), cart);
		const target = pair.systemBiosImports.functions[BiosFunction.CreateTable].functionAddress;
		const layout = pair.cartImage, { textAddress } = layout.header;
		const code = layout.functions.find(fn => fn.address === pair.cartVectors.entryFunctionAddress)!;
		let bindingPc = code.codeAddress;
		for (; bindingPc < code.codeAddress + code.codeByteCount;) {
			const op = decodeBlua32InstructionAtPc(layout.textBytes, textAddress, bindingPc);
			if (op.op === OpCode.CLOSURE && op.bx * 16 === target) break;
			bindingPc = op.pc + INSTRUCTION_BYTES;
		}
		assert.ok(bindingPc < code.codeAddress + code.codeByteCount);
		const binding = decodeBlua32InstructionAtPc(layout.textBytes, textAddress, bindingPc);
		const callPc = binding.pc + INSTRUCTION_BYTES;
		const call = decodeBlua32InstructionAtPc(layout.textBytes, textAddress, callPc);
		assert.ok(binding.a > 4095);
		assert.deepEqual([call.op, call.a, call.b, call.c], [OpCode.CALL, binding.a, 3, 2]);

		const runtime = new Runtime({
			systemRomBytes: pair.systemRomBytes, cartridgeSlots: cartridgeSlots(pair.cartRomBytes),
			machineModel: PSX_MACHINE_SPEC,
		}, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		const arena = cpu.heapAllocator;
		const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		const caller = () => cpu.getFrameDepth() - 1;
		for (let i = 0; i < 32768 && cpu.readFramePc(caller()) !== bindingPc; ++i)
			assert.notEqual(slice(1), RunResult.Halted);
		assert.equal(cpu.readFramePc(caller()), bindingPc);
		const stem = join(folder, `O${optLevel}`);
		const seed = stem + '.seed', rom = stem + '.rom', cartRom = stem + '.cart', trace = stem + '.trace';
		writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		writeFileSync(rom, pair.systemRomBytes);
		writeFileSync(cartRom, pair.cartRomBytes);
		const latch = arena.managementOffset() + HEAP_SERVICE_CLOSURE_OFFSET;
		const commands = ['X'], rows: string[] = [];
		function grant(cycles: number): number {
			const result = slice(cycles), spent = cycles - cpu.instructionBudgetRemaining;
			const stage = memory.readRamRecordWord(latch);
			commands.push(`J ${cycles} 1`);
			rows.push(`${result} ${spent} ${+cpu.heapServiceActive()} ${stage} ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
			return spent;
		}
		assert.equal(grant(1), BASE_CYCLES[OpCode.CLOSURE]);
		assert.equal(cpu.readFramePc(caller()), callPc);
		assert.equal(cpu.heapServiceActive(), false, 'loading the ROM binding does not allocate');
		assert.equal(cpu.readFrameRegister(caller(), binding.a), valueResidentFunction(target));
		assert.equal(cpu.readFrameRegister(caller(), binding.a + 1), valueInteger(5));
		assert.equal(cpu.readFrameRegister(caller(), binding.a + 2), valueInteger(3));
		assert.equal(grant(1), BASE_CYCLES[OpCode.CALL] + 2);
		assert.equal(cpu.heapServiceActive(), true);
		for (let i = 0; i < 256 && cpu.getFrameDepth(); ++i) grant(191);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		const values = runtime.readCompletionValues();
		assert.equal(values[0], valueInteger(173));
		assert.equal(valueTag(values[1]), ValueTag.Table);
		commands.push('C');
		rows.push('173');
		const first = memory.ramBusEnd() - RAM_BASE, last = memory.ramData().length;
		commands.push(`H ${first} ${last}`);
		rows.push(String(hashBytes(memory.ramData(), first, last - first)));
		writeFileSync(trace, commands.join('\n'));
		const seen = execFileSync(native, [rom, trace, seed, cartRom], { encoding: 'utf8' }).trimEnd().split('\n');
		assert.deepEqual(seen, rows);
		console.log(`HIGH-TABLE-CONSTRUCTOR:PASS O${optLevel} R${binding.a} (resident cartridge import, exact TS/C++ grants and heap)`);
	}
	rmSync(folder, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${folder}`);
	throw error;
}
