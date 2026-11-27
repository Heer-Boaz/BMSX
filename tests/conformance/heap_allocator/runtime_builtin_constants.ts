import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueBuiltinFunction, valueInteger } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { BUILTIN_FUNCTION_COUNT, BuiltinFunctionId } from '../../../machine/ts/spec/blua32/builtin';
import { COP0_EXEC } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CART_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { linkRawTestBlua32Pair, linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const hostInput = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const invalidBuiltin = /BLua32 builtin constant is invalid for this image/;

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-immutable-builtin-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	const commandFile = join(directory, 'trace'), unused = join(directory, 'unused.state');
	const systemPath = join(directory, 'system.rom'), cartPath = join(directory, 'cart.rom');
	const instruction = new Uint8Array(4 * INSTRUCTION_BYTES);
	writeInstruction(instruction, 0, OpCode.LOADK, 0, 0, 0);
	writeInstruction(instruction, 1, OpCode.KSMI, 1, 0, 37);
	writeInstruction(instruction, 2, OpCode.CALL, 0, 2, 2);
	writeInstruction(instruction, 3, OpCode.RET, 0, 2, 0);
	const system = linkRawTestSystemBlua32({
		text: instruction, functions: [{ firstWord: 0, wordCount: 4, maxStack: 2 }],
		constants: [{ kind: 'builtin', word: BuiltinFunctionId.ToInteger }],
	});
	const constant = system.image.header.constantTableAddress;
	assert.equal(system.image.header.systemGlobalNameCount, 0);
	assert.equal(readLE32(system.romBytes, constant + BLUA32_CONSTANT_TAG_OFFSET), Blua32ConstantTag.Builtin);
	assert.equal(readLE32(system.romBytes, constant + BLUA32_CONSTANT_PAYLOAD_OFFSET), BuiltinFunctionId.ToInteger);

	function bootAndRetire(systemRomBytes: Uint8Array, cartridge?: Uint8Array) {
		const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridge === undefined ? cartridgeSlots() : cartridgeSlots(cartridge),
			machineModel: PSX_MACHINE_SPEC }, hostInput);
		runtime.boot();
		const { cpu } = runtime.machine;
		const command = ['P'], output = [`1 ${cpu.readFramePc(0)}`];
		function grant(cycles: number) {
			const result = runtime.machine.scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
			const used = cycles - cpu.instructionBudgetRemaining;
			command.push(`J ${cycles} 1`);
			output.push(`${result} ${used} 0 0 ${cpu.heapAllocator.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
			return result;
		}
		assert.equal(grant(1), RunResult.Yielded);
		if (cartridge === undefined) assert.equal(cpu.readFrameRegister(0, 0), valueBuiltinFunction(BuiltinFunctionId.ToInteger));
		let result = RunResult.Yielded;
		for (let i = 0; i < 32 && result === RunResult.Yielded; ++i) result = grant(128);
		assert.equal(result, RunResult.Halted);
		assert.deepEqual(runtime.readCompletionValues(), [valueInteger(37)]);
		command.push('C');
		output.push('37');
		writeFileSync(systemPath, systemRomBytes);
		writeFileSync(commandFile, command.join('\n'));
		const args = [systemPath, commandFile, unused];
		if (cartridge !== undefined) {
			writeFileSync(cartPath, cartridge);
			args.push(cartPath);
		}
		assert.deepEqual(execFileSync(native, args, { encoding: 'utf8' }).trimEnd().split('\n'), output);
	}
	bootAndRetire(system.romBytes);

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
	const launcher = new Uint8Array(4 * INSTRUCTION_BYTES), program = new Uint8Array(2 * INSTRUCTION_BYTES);
	writeInstruction(launcher, 0, OpCode.LOADK, 0, 0, 0);
	writeInstruction(launcher, 1, OpCode.LOAD_MEM, 0, 0, MemoryAccessKind.Word);
	writeInstruction(launcher, 2, OpCode.MTC0, 0, COP0_EXEC, 0);
	writeInstruction(launcher, 3, OpCode.HALT, 0, 0, 0);
	writeInstruction(program, 0, OpCode.LOADK, 0, 0, 0);
	writeInstruction(program, 1, OpCode.RET, 0, 2, 0);
	const pair = linkRawTestBlua32Pair({
		text: launcher, functions: [{ firstWord: 0, wordCount: 4 }],
		constants: [integerConstant(CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET)],
	}, {
		text: program, functions: [{ firstWord: 0, wordCount: 2 }], constants: [integerConstant(37)],
	});
	bootAndRetire(pair.systemRomBytes, pair.cartRomBytes);
	const forged = pair.cartRomBytes.slice(), cartConstant = pair.cartImage.header.constantTableAddress - CART_ROM_BASE;
	writeLE32(forged, cartConstant + BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag.Builtin);
	writeLE32(forged, cartConstant + BLUA32_CONSTANT_PAYLOAD_OFFSET, BuiltinFunctionId.ToInteger);
	const rejectedCart = new Runtime({
		systemRomBytes: pair.systemRomBytes, cartridgeSlots: cartridgeSlots(forged), machineModel: PSX_MACHINE_SPEC,
	}, hostInput);
	rejectedCart.boot();
	const startPc = rejectedCart.machine.cpu.readFramePc(0);
	assert.throws(() => rejectedCart.machine.scheduler.runCpuSlice(0, 128, undefined, CpuRunKind.Scheduled), invalidBuiltin);
	assert.deepEqual(rejectedCart.readCompletionValues(), []);
	writeFileSync(cartPath, forged);
	writeFileSync(commandFile, 'P\nJ 128 1\nC\n');
	const cartFault = spawnSync(native, [systemPath, commandFile, unused, cartPath], { encoding: 'utf8' });
	assert.equal(cartFault.status, 1);
	assert.equal(cartFault.stdout, `1 ${startPc}\n`, 'the System launcher entered, but the cartridge produced no observation or value');
	assert.match(cartFault.stderr, invalidBuiltin);

	console.log('IMMUTABLE-BUILTIN:PASS paired System CALL, unknown System ID and forged Cart tag rejected');
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
