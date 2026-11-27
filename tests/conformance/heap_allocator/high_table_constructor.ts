import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { executionDomainBit } from '../../../machine/ts/spec/blua32/execution_domain';
import { CART_ROM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { linkManagedTestSystem, TEST_CART_TRANSFER_SOURCE } from '../../helpers/managed_system';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const locals = Array.from({ length: 4100 }, (_, index) => `slot${index}`).join(',');
const entrySource = `
local ${locals}
local probe = {0,17,0,0,0; x=31,y=41,z=3}
return probe[2] * 10 + probe.z, probe
`;

const folder = mkdtempSync('/tmp/bmsx-high-constructor-');
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const cart = compileLuaChunkToProgram(parseLuaChunk(entrySource), [], { entrySource, optLevel });
		const system = linkManagedTestSystem(TEST_CART_TRANSFER_SOURCE, optLevel);
		const { layout, ...linked } = linkCartBlua32Image(system.biosImports, encodeCompiledProgramObject(cart), cart.metadata,
			CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
		const cartRomBytes = writeTestBlua32Rom({ layout, ...linked });
		const systemRomBytes = writeTestBlua32Rom(system);
		const { textAddress } = layout.header;
		const code = layout.functions.find(fn => fn.codeAddress === layout.header.textAddress)!;
		let callPc = code.codeAddress;
		for (; callPc < code.codeAddress + code.codeByteCount;) {
			const op = decodeBlua32InstructionAtPc(layout.textBytes, textAddress, callPc);
			if (op.op === OpCode.SVC) break;
			callPc = op.pc + INSTRUCTION_BYTES;
		}
		assert.ok(callPc < code.codeAddress + code.codeByteCount);
		const call = decodeBlua32InstructionAtPc(layout.textBytes, textAddress, callPc);
		assert.ok(call.a > 4095);
		assert.deepEqual([call.op, call.b, call.c], [OpCode.SVC, 3, 0]);

		const runtime = new Runtime({
			systemRomBytes, cartridgeSlots: cartridgeSlots(cartRomBytes),
			machineModel: PSX_MACHINE_SPEC,
		}, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		const arena = cpu.heapAllocator;
		const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		const caller = () => cpu.getFrameDepth() - 1;
		cpu.setExecutionHook((_domain, at) => at === callPc, executionDomainBit(0), 0);
		for (let i = 0; i < 256 && cpu.readFramePc(caller()) !== callPc; ++i)
			assert.notEqual(slice(4096), RunResult.Halted);
		assert.equal(cpu.readFramePc(caller()), callPc);
		cpu.setExecutionHook(null, 0, 0);
		const stem = join(folder, `O${optLevel}`);
		const seed = stem + '.seed', rom = stem + '.rom', cartRom = stem + '.cart', trace = stem + '.trace';
		writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		writeFileSync(rom, systemRomBytes);
		writeFileSync(cartRom, cartRomBytes);

		const commands = ['X'], rows: string[] = [];
		function grant(cycles: number): number {
			const result = slice(cycles), spent = cycles - cpu.instructionBudgetRemaining;

			commands.push(`J ${cycles} 1`);
			rows.push(`${result} ${spent} ${+cpu.fixedInterruptActive()} ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
			return spent;
		}
		assert.equal(cpu.readFrameRegister(caller(), call.a), valueInteger(0));
		assert.equal(cpu.readFrameRegister(caller(), call.a + 1), valueInteger(5));
		assert.equal(cpu.readFrameRegister(caller(), call.a + 2), valueInteger(3));
		assert.ok(grant(1) >= BASE_CYCLES[OpCode.SVC]);
		assert.ok(cpu.fixedInterruptActive());
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
		console.log(`HIGH-TABLE-CONSTRUCTOR:PASS O${optLevel} R${call.a} (original cartridge window, exact TS/C++ grants and heap)`);
	}
	rmSync(folder, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${folder}`);
	throw error;
}
