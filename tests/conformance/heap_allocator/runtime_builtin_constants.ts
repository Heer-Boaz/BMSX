import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueBuiltinFunction, valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { BUILTIN_FUNCTION_COUNT, BuiltinFunctionId } from '../../../machine/ts/spec/blua32/builtin';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CART_ROM_BASE, DYNAMIC_RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { linkRawTestBlua32Pair, linkRawTestSystemBlua32, writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const hostInput = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const invalidBuiltin = /BLua32 builtin constant is invalid for this image/;

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-immutable-builtin-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	const commandFile = join(directory, 'trace'), unused = join(directory, 'unused.state');
	const systemPath = join(directory, 'system.rom'), cartPath = join(directory, 'cart.rom');
	const report = DYNAMIC_RAM_BASE - 4;
	const instruction = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(instruction, 0, OpCode.LOADK, 0, 0, 0);
	writeInstruction(instruction, 1, OpCode.KSMI, 1, 0, 37);
	writeInstruction(instruction, 2, OpCode.CALL, 0, 2, 2);
	writeInstruction(instruction, 3, OpCode.LOADK, 1, 0, 1);
	writeInstruction(instruction, 4, OpCode.STORE_MEM, 0, 1, MemoryAccessKind.Word);
	writeInstruction(instruction, 5, OpCode.RET, 0, 1, 0);
	const system = linkRawTestSystemBlua32({
		text: instruction, functions: [{ firstWord: 0, wordCount: 6, maxStack: 2 }],
		constants: [{ kind: 'builtin', word: BuiltinFunctionId.ToInteger }, integerConstant(report)],
	});
	const constant = system.image.header.constantTableAddress;
	assert.equal(system.image.header.systemGlobalNameCount, 0);
	assert.equal(readLE32(system.romBytes, constant + BLUA32_CONSTANT_TAG_OFFSET), Blua32ConstantTag.Builtin);
	assert.equal(readLE32(system.romBytes, constant + BLUA32_CONSTANT_PAYLOAD_OFFSET), BuiltinFunctionId.ToInteger);

	function instrument(systemRomBytes: Uint8Array, cartridge?: Uint8Array) {
		const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridge === undefined ? cartridgeSlots() : cartridgeSlots(cartridge),
			machineModel: PSX_MACHINE_SPEC }, hostInput);
		runtime.boot();
		const { cpu } = runtime.machine;
		const command = ['P'], output = [`1 ${cpu.readFramePc(0)}`];
		function grant(cycles: number) {
			command.push(`g ${cycles} 0`);
			const result = runtime.machine.scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const used = cycles - cpu.instructionBudgetRemaining;
			output.push(`${result} ${used} ${cpu.heapAllocator.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
			return result;
		}
		function finish() {
			let result = RunResult.Yielded;
			for (let i = 0; i < 128 && result === RunResult.Yielded; ++i) result = grant(4096);
			assert.equal(result, RunResult.Halted);
		}
		function replay() {
			writeFileSync(systemPath, systemRomBytes);
			writeFileSync(commandFile, command.join('\n'));
			const args = [systemPath, commandFile, unused];
			if (cartridge !== undefined) {
				writeFileSync(cartPath, cartridge);
				args.push(cartPath);
			}
			return args;
		}
		return { runtime, command, output, grant, finish, replay };
	}
	const raw = instrument(system.romBytes);
	assert.equal(raw.grant(1), RunResult.Yielded);
	assert.equal(raw.runtime.machine.cpu.readFrameRegister(0, 0), valueBuiltinFunction(BuiltinFunctionId.ToInteger));
	raw.finish();
	assert.equal(raw.runtime.machine.cpu.heapAllocator.occupiedBytes(), 0);
	assert.equal(raw.runtime.machine.memory.readMappedWord(report), 37);
	raw.command.push(`M ${report}`);
	raw.output.push('37 0');
	assert.deepEqual(execFileSync(native, raw.replay(), { encoding: 'utf8' }).trimEnd().split('\n'), raw.output);

	const unknown = system.romBytes.slice();
	writeLE32(unknown, constant + BLUA32_CONSTANT_PAYLOAD_OFFSET, BUILTIN_FUNCTION_COUNT);
	const rejectedSystem = new Runtime({
		systemRomBytes: unknown, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
	}, hostInput);
	assert.throws(() => rejectedSystem.boot(), invalidBuiltin);
	writeFileSync(systemPath, unknown);
	writeFileSync(commandFile, 'P\n');
	const systemFault = spawnSync(native, [systemPath, commandFile, unused], { encoding: 'utf8' });
	assert.equal(systemFault.status, 1);
	assert.equal(systemFault.stdout, '', 'the first System frame was not entered');
	assert.match(systemFault.stderr, invalidBuiltin);

	// Launch the real cartridge on its normal physical EXEC path. The same
	// program accepted with its legitimate Integer constant is rejected when
	// its input ROM bytes attempt to manufacture a System-only function tag.
	const program = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(program, 0, OpCode.LOADK, 0, 0, 0);
	writeInstruction(program, 1, OpCode.RET, 0, 2, 0);
	const pair = linkRawTestBlua32Pair({
		text: instruction, functions: [{ firstWord: 0, wordCount: 6, maxStack: 2 }],
		constants: [{ kind: 'builtin', word: BuiltinFunctionId.ToInteger }, integerConstant(report)],
	}, {
		text: program, functions: [{ firstWord: 0, wordCount: 2 }], constants: [integerConstant(37)],
	});
	const launcher = writeTestBlua32Rom(linkManagedTestSystem(
		`local startup<const>: *addr = ${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}
cop0.exec = *startup`, 0));
	const legitimate = instrument(launcher, pair.cartRomBytes);
	legitimate.finish();
	assert.deepEqual(legitimate.runtime.readCompletionValues(), [valueInteger(37)]);
	legitimate.command.push('C');
	legitimate.output.push('37');
	assert.deepEqual(execFileSync(native, legitimate.replay(), { encoding: 'utf8' }).trimEnd().split('\n'), legitimate.output);

	const forged = pair.cartRomBytes.slice(), cartConstant = pair.cartImage.header.constantTableAddress - CART_ROM_BASE;
	writeLE32(forged, cartConstant + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.Builtin);
	writeLE32(forged, cartConstant + BLUA32_CONSTANT_PAYLOAD_OFFSET, BuiltinFunctionId.ToInteger);
	const rejected = instrument(launcher, forged);
	assert.throws(() => rejected.finish(), invalidBuiltin);
	assert.deepEqual(rejected.runtime.readCompletionValues(), []);
	const cartFault = spawnSync(native, rejected.replay(), { encoding: 'utf8' });
	assert.equal(cartFault.status, 1);
	assert.deepEqual(cartFault.stdout.trimEnd().split('\n'), rejected.output, 'both cores reject at the same managed launcher advance');
	assert.match(cartFault.stderr, invalidBuiltin);

	console.log('IMMUTABLE-BUILTIN:PASS paired System CALL, unknown System ID and forged Cart tag rejected');
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
