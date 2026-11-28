import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { valueBool, valueInteger, valueNil, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { INSTRUCTION_BYTES, RegisterJumpMode, ValueMoveKind } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_CART_SELECT, IO_IRQ_MASK } from '../../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { parseLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { createTestSystemCpu, linkTestCartBlua32, writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { materializeCpuCompletionValues } from '../../helpers/cpu_test_harness';
import { linkManagedTestSystem, TEST_CART_TRANSFER_SOURCE } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

// Keep three bodies large enough that all three real edges reach the final
// calling-convention pass rather than disappearing into the inliner.
const mixing = Array.from({ length: 51 }, (_, i) => `x = ((x * 5) ~ (x >> 3)) + ${i + 1}`).join('\n');
const modulePath = 'window/arithmetic';
const source = `module<const>
bss counter: word
local effect<const> = function(value)
	*counter = *counter + value
	return value
end
local count<const> = function()
	return *counter
end
local leaf<const> = function(x, y)
	${mixing}
	return x, y
end
local middle<const> = function(a, b)
	local x, y = leaf(a, b)
	${mixing}
	return x, y
end
local outer<const> = function(a, b)
	local x, y = middle(a, b)
	${mixing}
	return x, y
end
local consume<const> = function(x)
	${mixing}
	if x ~= 0 then *counter = *counter + 11 end
end
return { effect = effect, count = count, leaf = leaf, middle = middle, outer = outer, consume = consume }
`;
const exercise = `
local tree<const> = require('${modulePath}')
local saved<const> = 41
local a, b = tree.outer(29)
local c, d = tree.outer(51, 33, tree.effect(7))
local padded = b == nil and saved or 0
tree.consume(2)
`;
function mixInt(value: number): number {
	for (let i = 1; i <= 51; ++i) value = ((Math.imul(value, 5) ^ (value >>> 3)) + i) | 0;
	return value;
}
const report = [29, 51].map(seed => mixInt(mixInt(mixInt(seed))));
const expected = [report[0], 41, report[1], 33, 18];

function assertPhysicalCallChain(layout: ReturnType<typeof linkManagedTestSystem>['layout'], functionIds: readonly string[]) {
	for (const name of ['leaf', 'middle', 'outer', 'consume']) {
		const matching = layout.functions.filter((_fn, i) => functionIds[i].endsWith(`__${name}`));
		assert.equal(matching.length, 1, `one executable body for ${name}`);
		const fn = matching[0];
		let enter = 0, leave = 0;
		for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount;) {
			const instruction = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, pc);
			assert.notEqual(instruction.op, OpCode.CALL, `no language CALL inside ${name}`);
			assert.notEqual(instruction.op, OpCode.RET, `no language RET inside ${name}`);
			if (instruction.op === OpCode.JREG && instruction.c === RegisterJumpMode.EnterWindow) ++enter;
			if (instruction.op === OpCode.JREG && instruction.c === RegisterJumpMode.LeaveWindow) {
				assert.equal(instruction.b, name === 'consume' ? 0 : 2);
				++leave;
			}
			pc = instruction.pc + INSTRUCTION_BYTES;
		}
		assert.equal(enter, name === 'middle' || name === 'outer' ? 1 : 0);
		assert.equal(leave, 1);
	}
}

test('the linked System passes fixed arguments and results through three physical windows', () => {
	const main = exercise + 'return a, padded, c, d, tree.count()';
	for (const optLevel of [0, 3] as const) {
		const linked = linkManagedTestSystem(main, optLevel, [{ path: modulePath, source }]);
		if (optLevel === 3) assertPhysicalCallChain(linked.layout, linked.symbols.metadata.functionIds);
		const { cpu } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(linked) });
		runGuestToHalt(cpu, 4_194_304);
		assert.deepEqual(materializeCpuCompletionValues(cpu), expected.map(valueInteger));
	}
});

test('both cartridge sockets run the same closed software ABI with exact TS/native grants', t => {
	const bios = linkManagedTestSystem(TEST_CART_TRANSFER_SOURCE, 3);
	const systemRomBytes = writeTestBlua32Rom(bios);
	const cartSource = `bss result: word[5]
${exercise}
result[0] = a
result[1] = padded
result[2] = c
result[3] = d
result[4] = tree.count()
mem[${IO_IRQ_MASK}] = 0
halt_until_irq
`;
	const cart = compileLuaChunkToProgram(parseLuaChunk(cartSource, 'window/cart').chunk,
		[{ path: modulePath, source, chunk: parseLuaChunk(source, modulePath).chunk }],
		{ entrySource: cartSource, optLevel: 3 });
	const { cartImage, cartSymbols, cartRomBytes } = linkTestCartBlua32(bios.biosImports, cart);
	assertPhysicalCallChain(cartImage, cartSymbols.metadata.functionIds);
	const resultBase = cartSymbols.metadata.staticScopes.declarations.find(symbol => symbol.name === 'result')!.address!;
	const leaf = cartImage.functions[cartSymbols.metadata.functionIds.findIndex(id => id.endsWith('__leaf'))];
	const folder = mkdtempSync(join(tmpdir(), 'bmsx-software-call-'));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	const rom = join(folder, 'system.rom'), cartridge = join(folder, 'cart.rom'), trace = join(folder, 'trace');
	const state = join(folder, 'state');
	writeFileSync(rom, systemRomBytes);
	writeFileSync(cartridge, cartRomBytes);
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
	for (const socket of [0, 1] as const) {
		const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridgeSlots(cartRomBytes, cartRomBytes), machineModel: PSX_MACHINE_SPEC }, input);
		runtime.boot();
		const { cpu, memory, scheduler } = runtime.machine;
		memory.writeMappedWord(IO_CART_SELECT, socket);
		const commands = [`O ${IO_CART_SELECT} ${socket}`], observations: string[] = [];
		let continuation = 0;
		for (let grant = 0; grant < 4096 && (!cpu.isHaltedUntilIrq() || cpu.activeCartridgeSlot() !== socket); ++grant) {
			const result = scheduler.runCpuSlice(0, 256, 0, CpuRunKind.Scheduled);
			commands.push('E 256');
			observations.push(`${result} ${256 - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
			if (continuation === 0 && cpu.activeCartridgeSlot() === socket) {
				const depth = cpu.getFrameDepth();
				const pc = cpu.readFramePc(depth - 1);
				if (pc >= leaf.codeAddress && pc < leaf.codeAddress + leaf.codeByteCount) {
					for (let index = depth - 3; index < depth; ++index) assert.equal(cpu.readFrameFunctionAddress(index), 0);
					continuation = commands.length;
					writeFileSync(state, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
					commands.push('P');
					observations.push(`${depth} ${pc}`);
				}
			}
		}
		assert.ok(continuation > 0, 'one grant ends inside the nested software call');
		assert.equal(cpu.activeCartridgeSlot(), socket);
		assert.ok(cpu.isHaltedUntilIrq());
		const results = expected.map((_value, i) => {
			const address = resultBase + 4 * i;
			const word = memory.readMappedU32LE(address);
			commands.push(`M ${address}`);
			observations.push(`${word} 0`);
			return word | 0;
		});
		assert.deepEqual(results, expected);
		writeFileSync(trace, commands.join('\n'));
		const traceNative = () => execFileSync(native, [rom, trace, state, cartridge, cartridge], { encoding: 'utf8' }).trim().split('\n');
		assert.deepEqual(traceNative(), observations);
		writeFileSync(trace, ['X', ...commands.slice(continuation)].join('\n'));
		assert.deepEqual(traceNative(), observations.slice(continuation - 1), 'TS to C++ resume inside the three physical windows');
	}
});

test('open software returns forward a prefix and adapt to zero, short and padded receivers', t => {
	const path = 'window/results';
	const program = `module<const>
bss seen: word
local choose<const> = function(form, x)
	${mixing}
	*seen = *seen + 1
	if form == 0 then return end
	if form == 1 then return x end
	return x, false, 9
end
local relay<const> = function(form, x)
	${mixing}
	return x, choose(form, x)
end
local count<const> = function() return *seen end
return { choose = choose, relay = relay, count = count }
`;
	const main = `
local trial<const> = require('${path}')
local sum = 0
for k = 0, 23 do
	local prefix, v = trial.relay(k % 3, k)
	sum = sum + (v == nil and prefix or v)
end
local a, b, c = trial.choose(0, 4)
local d = trial.choose(2, 5)
local e, f = trial.choose(1, 6)
local g, h, i, j, k = trial.relay(2, 7)
trial.choose(2, 9)
return sum, a, b, c, d, e, f, g, h, i, j, k, trial.count(), trial.relay(1, 8)
`;
	let sum = 0;
	for (let k = 0; k <= 23; ++k) {
		const mixed = mixInt(k);
		sum = (sum + (k % 3 === 0 ? mixed : mixInt(mixed))) | 0;
	}
	const output = [valueInteger(sum), valueNil(), valueNil(), valueNil(), valueInteger(mixInt(5)),
		valueInteger(mixInt(6)), valueNil(), valueInteger(mixInt(7)), valueInteger(mixInt(mixInt(7))),
		valueBool(false), valueInteger(9), valueNil(), valueInteger(29), valueInteger(mixInt(8)), valueInteger(mixInt(mixInt(8)))];
	const original = linkManagedTestSystem(main, 0, [{ path, source: program }]);
	const { cpu: oracle } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(original) });
	runGuestToHalt(oracle, 4_194_304);
	assert.deepEqual(materializeCpuCompletionValues(oracle), output);
	const linked = linkManagedTestSystem(main, 3, [{ path, source: program }]);
	const modes = new Set<number>();
	const indirectLeaves = new Set<number>();
	for (const name of ['choose', 'relay']) {
		const fnIndex = linked.symbols.metadata.functionIds.findIndex(id => id.endsWith(`__${name}`));
		assert.notEqual(fnIndex, -1);
		const fn = linked.layout.functions[fnIndex];
		for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount;) {
			const op = decodeBlua32InstructionAtPc(linked.layout.textBytes, linked.layout.header.textAddress, pc);
			assert.notEqual(op.op, OpCode.CALL, name);
			assert.notEqual(op.op, OpCode.RET, name);
			if (op.op === OpCode.MOV) modes.add(op.c);
			if (op.op === OpCode.JREG && op.c === RegisterJumpMode.LeaveWindowFromRegister) indirectLeaves.add(pc);
			pc = op.pc + INSTRUCTION_BYTES;
		}
	}
	assert.ok(modes.has(ValueMoveKind.ReadIndexed) && modes.has(ValueMoveKind.WriteIndexed));
	assert.ok(indirectLeaves.size > 0, 'an open result is forwarded through a computed physical frontier');
	const systemRomBytes = writeTestBlua32Rom(linked);
	const folder = mkdtempSync(join(tmpdir(), 'bmsx-open-software-call-'));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	const rom = join(folder, 'system.rom'), trace = join(folder, 'trace'), state = join(folder, 'state');
	writeFileSync(rom, systemRomBytes);
	const cpuExecutionBackend = CpuExecutionBackend.JavaScript;
	const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend },
		{ sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
	runtime.boot();
	const { cpu, scheduler, memory } = runtime.machine;
	const commands: string[] = [], observations: string[] = [];
	let continuation = -1;
	for (let grant = 0; grant < 8192; ++grant) {
		const outcome = scheduler.runCpuSlice(0, 31, 0, CpuRunKind.Scheduled);
		commands.push('E 31');
		observations.push(`${outcome} ${31 - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		if (outcome === RunResult.Halted) break;
		const pc = cpu.readFramePc(cpu.getFrameDepth() - 1);
		if (continuation === -1 && indirectLeaves.has(pc)) {
			continuation = commands.length;
			writeFileSync(state, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		}
	}
	assert.notEqual(continuation, -1, 'a grant stops immediately before the computed return');
	assert.deepEqual(runtime.readCompletionValues(), output);
	commands.push('c');
	observations.push([output.length, ...output.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	writeFileSync(trace, commands.join('\n'));
	const replay = () => execFileSync(native, [rom, trace, state], { encoding: 'utf8' }).trim().split('\n');
	assert.deepEqual(replay(), observations);
	writeFileSync(trace, ['X', ...commands.slice(continuation)].join('\n'));
	assert.deepEqual(replay(), observations.slice(continuation), 'a dynamically computed return retains its exact frontier in the checkpoint');
});

test('software calls consume open arguments and preserve the actual variadic count', t => {
	const path = 'window/arguments';
	const program = `module<const>
bss evaluations: word
local produce<const> = function(form, x)
	${mixing}
	*evaluations = *evaluations + 1
	if form == 0 then return end
	if form == 1 then return false end
	return false, x, nil
end
local collect<const> = function(prefix, a, b, c, d)
	return prefix, a, b, c, d
end
local actual<const> = function(prefix, ...)
	local a, b, c = ...
	return blua32.argument_count(), prefix, a, b, c
end
local forward<const> = function(prefix, ...)
	return prefix, ...
end
local relay<const> = function(prefix, ...)
	return actual(prefix, ...)
end
local suffix<const> = function(prefix, ...)
	return blua32.argument_suffix(1)
end
local count<const> = function() return *evaluations end
return { produce = produce, collect = collect, actual = actual, forward = forward, relay = relay, suffix = suffix, count = count }
`;
	const main = `
local probe<const> = require('${path}')
local c0, p0, q0, r0, s0 = probe.collect(17, probe.produce(0, 2))
local c3, p3, q3, r3, s3 = probe.collect(19, probe.produce(2, 3))
local n0, a0, b0, d0, e0 = probe.actual(31, probe.produce(0, 4))
local n1, a1, b1, d1, e1 = probe.actual(32, probe.produce(1, 5))
local n3, a3, b3, d3, e3 = probe.actual(33, probe.produce(2, 6))
local nf, af, bf, df, ef = probe.actual(probe.forward(5, false, nil, 9))
local fs, gs, hs = probe.forward(7)
local nr, ar, br, dr, er = probe.relay(8, false, nil, 4)
local nt, at, bt, dt, et = probe.relay(11)
local ss, ts, us = probe.suffix(22, false, nil, 9)
local os, ps = probe.suffix(93)
return c0, p0, q0, r0, s0, c3, p3, q3, r3, s3, n0, a0, b0, d0, e0, n1, a1, b1, d1, e1,
	n3, a3, b3, d3, e3, nf, af, bf, df, ef, fs, gs, hs, nr, ar, br, dr, er, nt, at, bt, dt, et, ss, ts, us, os, ps, probe.count(),
	probe.forward(38, false, nil)
`;
	const z = valueNil(), f = valueBool(false), v = valueInteger;
	const output = [
		v(17), z, z, z, z,
		v(19), f, v(mixInt(3)), z, z,
		v(1), v(31), z, z, z,
		v(2), v(32), f, z, z,
		v(4), v(33), f, v(mixInt(6)), z,
		v(4), v(5), f, z, v(9),
		v(7), z, z,
		v(4), v(8), f, z, v(4),
		v(1), v(11), z, z, z,
		z, v(9), z, z, z, v(5), v(38), f, z,
	];
	const original = linkManagedTestSystem(main, 0, [{ path, source: program }]);
	const { cpu: oracle } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(original) });
	runGuestToHalt(oracle, 4_194_304);
	assert.deepEqual(materializeCpuCompletionValues(oracle), output);

	const linked = linkManagedTestSystem(main, 3, [{ path, source: program }]);
	const { layout, symbols } = linked;
	for (const name of ['__produce', '__collect', '__actual', '__forward', '__relay', '__suffix', '/entry']) {
		const idx = symbols.metadata.functionIds.findIndex(id => id.endsWith(name) && (name !== '/entry' || id === 'module:main/entry'));
		assert.notEqual(idx, -1, name);
		const fn = layout.functions[idx];
		let transfers = 0;
		for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount;) {
			const row = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, pc);
			assert.notEqual(row.op, OpCode.CALL, name);
			assert.notEqual(row.op, OpCode.VARARG, name);
			assert.notEqual(row.op, OpCode.ARGC, name);
			if (name !== '/entry') assert.notEqual(row.op, OpCode.RET, name);
			if (row.op === OpCode.JREG) ++transfers;
			pc = row.pc + INSTRUCTION_BYTES;
		}
		assert.ok(transfers > 0, name);
	}
	const systemRomBytes = writeTestBlua32Rom(linked);
	const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
		cpuExecutionBackend: CpuExecutionBackend.JavaScript },
		{ sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
	runtime.boot();
	const { cpu, scheduler, memory } = runtime.machine;
	const commands: string[] = [], observations: string[] = [];
	for (let grant = 0; grant < 8192; ++grant) {
		const outcome = scheduler.runCpuSlice(0, 53, 0, CpuRunKind.Scheduled);
		commands.push('E 53');
		observations.push(`${outcome} ${53 - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		if (outcome === RunResult.Halted) break;
	}
	assert.deepEqual(runtime.readCompletionValues(), output);
	commands.push('c');
	observations.push([output.length, ...output.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	const folder = mkdtempSync(join(tmpdir(), 'bmsx-open-software-arguments-'));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	const rom = join(folder, 'system.rom'), trace = join(folder, 'trace');
	writeFileSync(rom, systemRomBytes);
	writeFileSync(trace, commands.join('\n'));
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	assert.deepEqual(execFileSync(native, [rom, trace, trace], { encoding: 'utf8' }).trim().split('\n'), observations);
});
