import assert from 'node:assert/strict';
import test from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { valueBool, valueInteger, valueIsString } from '../../machine/ts/machine/cpu/value';
import { LUA_FAULT_REASON_CALL_NON_FUNCTION } from '../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, RegisterJumpMode } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { IO_CART_SELECT } from '../../machine/ts/spec/bmsx/io';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import type { Blua32ImageLayout } from '../../toolchain/ts/rompack/blua32_image';
import type { Blua32SymbolsImage } from '../../toolchain/ts/rompack/blua32_symbols';
import { decodeBlua32InstructionAtPc } from '../../toolchain/ts/rompack/blua32_instruction_decode';
import { indexBlua32FunctionInstructions } from '../../toolchain/ts/rompack/disassembler';
import { createTestSystemCpu, linkTestCartBlua32, writeTestBlua32Rom } from '../helpers/blua32';
import { cartridgeSlots } from '../helpers/cartridge';
import { runGuestToHalt } from '../helpers/cpu_execution';
import { materializeCpuCompletionValues } from '../helpers/cpu_test_harness';
import { bootManagedTestSystem, linkManagedTestSystem, TEST_CART_TRANSFER_SOURCE } from '../helpers/managed_system';

const walkerPath = 'lexical/walker';
const walker = `
local odd
local function even(n)
	if n == 0 then return 10 end
	return odd(n - 1) + 2
end
odd = function(n)
	if n == 0 then return 20 end
	return even(n - 1) + 3
end
local function depth(n)
	if n == 0 then return 31 end
	return depth(n - 1) + 1
end
local a, b, c = even(6), odd(6), depth(4)
return a, b, c
`;

function assertWalkerBindings(layout: Blua32ImageLayout, symbols: Blua32SymbolsImage, level: 0 | 3) {
	const found = new Map<string, typeof layout.functions[number]>();
	for (const [i, name] of symbols.metadata.functionDisplayNames.entries()) {
		if (symbols.metadata.functionDefinitions[i]?.path === walkerPath && (name === 'even' || name === 'odd' || name === 'depth')) {
			assert.equal(found.has(name), false, `one Function record for ${name}`);
			found.set(name, layout.functions[i]);
		}
	}
	assert.deepEqual([...found.keys()].sort(), ['depth', 'even', 'odd']);
	for (const [name, fn] of found) {
		assert.equal(fn.upvalues.length, level === 0 ? 1 : 0, `O${level} captures in ${name}`);
		if (level !== 3) continue;
		for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount;) {
			const instruction = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, pc);
			assert.notEqual(instruction.op, OpCode.GETUP, `${name} must not load a closure Cell to reach its peer`);
			pc = instruction.pc + INSTRUCTION_BYTES;
		}
	}
	if (level === 3) {
		const codeAddresses = new Set(layout.constants.flatMap(constant => constant !== null && typeof constant === 'object'
			&& constant.kind === 'code_function' ? [constant.word] : []));
		// Inlining can collapse either edge of the mutual recursion into its peer.
		assert.ok(codeAddresses.has(found.get('even')!.address) || codeAddresses.has(found.get('odd')!.address),
			'the mutual recursion has a linked ROM Function');
		assert.ok(codeAddresses.has(found.get('depth')!.address), 'the self recursion has a linked ROM Function');
	}
	const entryIndex = symbols.metadata.functionIds.indexOf(`module:${walkerPath}/entry`);
	assert.notEqual(entryIndex, -1);
	const entry = layout.functions[entryIndex];
	let binds = 0;
	for (let pc = entry.codeAddress; pc < entry.codeAddress + entry.codeByteCount;) {
		const instruction = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, pc);
		// No other instruction in this source requests a two-slot SVC.
		if (instruction.op === OpCode.SVC && instruction.b === 2) ++binds;
		pc = instruction.pc + INSTRUCTION_BYTES;
	}
	assert.equal(binds, level === 0 ? 3 : 0, `O${level} function bindings in the entry body`);
}

const walkerResult = [valueInteger(25), valueInteger(35), valueInteger(35)];

test('a private lexical call graph uses ROM functions instead of captured function bindings at O3', () => {
	for (const level of [0, 3] as const) {
		const linked = linkManagedTestSystem(walker, level, [], [], walkerPath);
		assertWalkerBindings(linked.layout, linked.symbols, level);
		const { cpu } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(linked) }, CpuExecutionBackend.JavaScript);
		runGuestToHalt(cpu, 1_000_000);
		assert.deepEqual(materializeCpuCompletionValues(cpu), walkerResult);
	}
});

test('linked lexical ROM functions stay in cartridge socket 1 with ordinary data on socket 0', () => {
	const bios = linkManagedTestSystem(`mem[${IO_CART_SELECT}] = 1\n` + TEST_CART_TRANSFER_SOURCE, 3);
	const source = walker.replace('local a, b, c =', `mem[${IO_CART_SELECT}] = 0\nlocal a, b, c =`);
	const program = compileLuaChunkToProgram(parseLuaChunk(source, walkerPath).chunk, [], { entrySource: source, optLevel: 3 });
	const { cartImage, cartSymbols, cartRomBytes } = linkTestCartBlua32(bios.biosImports, program);
	assertWalkerBindings(cartImage, cartSymbols, 3);

	const { cpu, memory } = bootManagedTestSystem(bios, 'main', cartridgeSlots(null, cartRomBytes));
	runGuestToHalt(cpu, 1_000_000);
	assert.equal(memory.readIoU32(IO_CART_SELECT), 0);
	assert.equal(cpu.activeCartridgeSlot(), 1);
	assert.deepEqual(materializeCpuCompletionValues(cpu), walkerResult);
});

test('ordinary nonrecursive lexical calls enter and leave borrowed physical windows', () => {
	// Keep both actual bodies above the inlining threshold.
	const mixing = Array.from({ length: 40 }, (_, i) => `x = ((x ~ ${i + 3}) * 7 + ${i}) & 0xffff`).join('\n');
	const path = 'lexical/borrowed';
	const linked = linkManagedTestSystem(`
local function mix(x)
	${mixing}
	return x
end
local function apply(input)
	local x = mix(input)
	${mixing}
	return x
end
local result = apply(91)
return result
`, 3, [], [], path);
	const { layout, symbols } = linked;
	for (const name of ['mix', 'apply']) {
		const index = symbols.metadata.functionIds.indexOf(`module:${path}/entry/local:${name}`);
		assert.notEqual(index, -1);
		assert.equal(layout.functions[index].upvalues.length, 0);
		let enters = 0, leaves = 0;
		for (const pc of indexBlua32FunctionInstructions(layout, index)) {
			const { op, c } = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, pc);
			assert.notEqual(op, OpCode.CALL, `${name} does not launch a language call`);
			assert.notEqual(op, OpCode.RET, `${name} does not return through the language ABI`);
			if (op !== OpCode.JREG) continue;
			if (c === RegisterJumpMode.EnterWindow) ++enters;
			if (c === RegisterJumpMode.LeaveWindow || c === RegisterJumpMode.LeaveWindowFromRegister) ++leaves;
		}
		assert.equal(enters, name === 'apply' ? 1 : 0);
		assert.equal(leaves, 1);
	}
	const entry = symbols.metadata.functionIds.indexOf(`module:${path}/entry`);
	assert.notEqual(entry, -1);
	assert.ok(indexBlua32FunctionInstructions(layout, entry).some(pc => {
		const { op, c } = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, pc);
		return op === OpCode.JREG && c === RegisterJumpMode.EnterWindow;
	}), 'the ordinary entry calls apply through a borrowed window');
	const { cpu } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(linked) }, CpuExecutionBackend.JavaScript);
	runGuestToHalt(cpu, 1_000_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(63_995)]);
});

test('escaped recursive closures keep fresh identity and share only their own activation Cell', () => {
	const linked = linkManagedTestSystem(`
local function create(seed)
	local current = seed
	local function accumulate(n)
		if n == 0 then return current end
		current = current + 1
		return accumulate(n - 1)
	end
	local function inspect()
		return current
	end
	return accumulate, inspect
end
local a, inspect_a = create(20)
local b, inspect_b = create(20)
local alias = a
return alias == a, a == b, a(3), inspect_a(), b(2), inspect_b(), a(1), inspect_a()
`, 3);
	const { cpu } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(linked) }, CpuExecutionBackend.JavaScript);
	runGuestToHalt(cpu, 1_000_000);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueBool(true), valueBool(false),
		valueInteger(23), valueInteger(23), valueInteger(22), valueInteger(22), valueInteger(24), valueInteger(24)]);
});

test('pausing after an early call does not publish a forward function before its assignment', () => {
	const linked = linkManagedTestSystem(`
local startup<const> = require('bmsx/startup')
local protect<const> = blua32.closure(startup.protected_call)
local dispatch
local function invoke(value)
	return dispatch(value)
end
local before, reason = protect(invoke, 5)
halt_until_irq
dispatch = function(value)
	return value * 3
end
return before, reason, invoke(5)
`, 3);
	const { cpu } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(linked) }, CpuExecutionBackend.JavaScript);
	runGuestToHalt(cpu, 1_000_000);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(cpu.readLuaFaultReasonWord(), LUA_FAULT_REASON_CALL_NON_FUNCTION);
	cpu.clearHaltUntilIrq();
	runGuestToHalt(cpu, 100_000);
	const result = materializeCpuCompletionValues(cpu);
	assert.equal(result.length, 3);
	assert.equal(result[0], valueBool(false));
	assert.ok(valueIsString(result[1]));
	assert.equal(result[2], valueInteger(15));
});
