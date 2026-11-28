import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FRAME_WINDOW_MASK } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { THREAD_CONTROL_COUNT_MASK } from '../../../machine/ts/machine/cpu/thread_record';
import { valueBool, valueInteger, valueNil, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { COP0_EVENT_CYCLES, CPU_CAUSE_CODE_REGISTER_WINDOW } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, RegisterJumpMode, ValueMoveKind } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_CART_SELECT, IO_IRQ_ACK, IO_IRQ_MASK, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { parseLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import type { Blua32SymbolsImage } from '../../../toolchain/ts/rompack/blua32_symbols';
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

function assertPhysicalCallChain(layout: ReturnType<typeof linkManagedTestSystem>['layout'], { metadata }: Blua32SymbolsImage) {
	for (const name of ['leaf', 'middle', 'outer', 'consume']) {
		const index = metadata.functionIds.findIndex(id => id.endsWith(`__${name}`));
		assert.notEqual(index, -1, name);
		assert.equal(metadata.functionIds.findLastIndex(id => id.endsWith(`__${name}`)), index, `one executable body for ${name}`);
		const fn = layout.functions[index];
		let enter = 0, leave = 0;
		for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount;) {
			const instruction = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, pc);
			assert.notEqual(instruction.op, OpCode.CALL, `no language CALL inside ${name}`);
			assert.notEqual(instruction.op, OpCode.RET, `no language RET inside ${name}`);
			if (instruction.op === OpCode.JAL) ++enter;
			if (instruction.op === OpCode.JREG) {
				assert.equal(instruction.c, RegisterJumpMode.Jump, `ordinary return jump in ${name}`);
				++leave;
			}
			pc = instruction.pc + INSTRUCTION_BYTES;
		}
		assert.equal(enter, name === 'middle' || name === 'outer' ? 1 : 0);
		assert.equal(leave, 1);
		const { calls } = metadata.softwareFramesByFunction[index]!;
		assert.equal(calls.length, enter);
		for (const call of calls) {
			const jump = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress,
				fn.codeAddress + call.wordOffset * INSTRUCTION_BYTES);
			const continuation = fn.codeAddress + call.continuationWordOffset * INSTRUCTION_BYTES;
			const end = fn.codeAddress + call.endWordOffset * INSTRUCTION_BYTES;
			const top = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, continuation);
			assert.equal(jump.op, OpCode.JAL);
			assert.equal(top.op, OpCode.MOV);
			assert.equal(top.c, ValueMoveKind.SetTopImmediate);
			assert.equal(top.a, jump.a + 2, 'the caller publishes the two-result frontier in the selected register bank');
			if (call.baseDelta !== 0) {
				const restore = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, top.pc + INSTRUCTION_BYTES);
				assert.equal(restore.op, OpCode.MOV);
				assert.equal(restore.c, ValueMoveKind.AddBase);
				assert.equal(restore.pc + INSTRUCTION_BYTES, end);
			} else {
				const leaf = metadata.functionIds.findIndex(id => id.endsWith('__leaf'));
				assert.equal(name, 'middle');
				assert.deepEqual(call.targetFunctions, [leaf]);
				assert.ok(jump.a > 0, 'the direct link goes to the outgoing slot with no register-basis transfer');
				assert.deepEqual(metadata.softwareFramesByFunction[leaf]!.linkSlots[0], { wordOffset: 0, slot: jump.a });
				assert.equal(top.pc + INSTRUCTION_BYTES, end, 'no scratch Integer materialization or base restore');
			}
		}
	}
}

test('the linked System passes fixed arguments and results through ordinary jumps', () => {
	const main = exercise + 'return a, padded, c, d, tree.count()';
	for (const optLevel of [0, 3] as const) {
		const linked = linkManagedTestSystem(main, optLevel, [{ path: modulePath, source }]);
		if (optLevel === 3) assertPhysicalCallChain(linked.layout, linked.symbols);
		const { cpu } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(linked) });
		runGuestToHalt(cpu, 4_194_304);
		assert.deepEqual(materializeCpuCompletionValues(cpu), expected.map(valueInteger));
	}
});

test('a frame-free software callee reads the device horizon', () => {
	const path = 'window/deadline';
	const source = `module<const>
local remaining<const> = function(x)
	local before<const> = cop0.event_cycles
	${mixing}
	local after<const> = cop0.event_cycles
	return x, before > after
end
return { remaining = remaining }
`;
	const linked = linkManagedTestSystem(`local deadline<const> = require('${path}')
return deadline.remaining(71)
`, 3, [{ path, source }]);
	const { layout, symbols } = linked;
	const fn = layout.functions[symbols.metadata.functionIds.findIndex(id => id.endsWith('__remaining'))];
	let reads = 0;
	for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount;) {
		const instruction = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, pc);
		assert.notEqual(instruction.op, OpCode.RET);
		if (instruction.op === OpCode.MFC0 && instruction.b === COP0_EVENT_CYCLES) ++reads;
		pc = instruction.pc + INSTRUCTION_BYTES;
	}
	assert.equal(reads, 2);
	const romBytes = writeTestBlua32Rom(linked);
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const { cpu } = createTestSystemCpu({ romBytes }, backend);
		runGuestToHalt(cpu, 4_194_304);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(mixInt(71)), valueBool(true)]);
	}
});

test('both cartridge sockets run the same frame-free ABI with exact TS/native grants', t => {
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
	assertPhysicalCallChain(cartImage, cartSymbols);
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
					assert.notEqual(cpu.readFrameFunctionAddress(depth - 1), 0, 'an ordinary enclosing activation remains selected');
					assert.notEqual(cpu.readFrameFunctionAddress(depth - 1), leaf.address, 'entering the leaf did not install a frame');
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
		assert.deepEqual(traceNative(), observations.slice(continuation - 1), 'TS to C++ resume inside a frame-free call');
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
	const irqSource = `
local trace<const> = require('kernel/gc_thread_trace').internal
bss cleared_suffix: word
local interrupted<const>: *addr = ${CPU_INTERRUPTED_CONTEXT_ADDRESS}
local owner<const>: *stopped_thread = *interrupted
local depth<const> = owner.frame_depth & ${THREAD_CONTROL_COUNT_MASK}
local frame<const>: *stopped_frame = ${RAM_BASE} + ((owner.frame_block + (depth - 1) * sizeof(stopped_frame)) & ${RAM_RECORD_WORD_MASK})
local first<const> = (frame.top + frame.stack_base) & ${FRAME_WINDOW_MASK}
trace.clear_stack_range(owner.stack_block & ${RAM_RECORD_WORD_MASK}, owner.stack_capacity, first, owner.stack_capacity)
*cleared_suffix = 1
mem[${IO_IRQ_ACK}] = ${IRQ_VBLANK}
mem[${IO_IRQ_MASK}] = 0
`;
	const linked = linkManagedTestSystem(main, 3, [{ path, source: program }], [], 'main', { irqSource });
	const modes = new Set<number>();
	const forwardedLeaves = new Map<number, number>();
	for (const name of ['choose', 'relay']) {
		const fnIndex = linked.symbols.metadata.functionIds.findIndex(id => id.endsWith(`__${name}`));
		assert.notEqual(fnIndex, -1);
		const fn = linked.layout.functions[fnIndex];
		assert.equal(linked.symbols.metadata.softwareFramesByFunction[fnIndex]?.entry, true);
		for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount;) {
			const op = decodeBlua32InstructionAtPc(linked.layout.textBytes, linked.layout.header.textAddress, pc);
			assert.notEqual(op.op, OpCode.CALL, name);
			assert.notEqual(op.op, OpCode.RET, name);
			if (op.op === OpCode.MOV) modes.add(op.c);
			if (op.op === OpCode.JREG) {
				assert.equal(op.c, RegisterJumpMode.Jump, name);
				if (name === 'relay') forwardedLeaves.set(pc, op.a);
			}
			pc = op.pc + INSTRUCTION_BYTES;
		}
	}
	assert.ok(modes.has(ValueMoveKind.ReadIndexed) && modes.has(ValueMoveKind.WriteIndexed));
	assert.ok(modes.has(ValueMoveKind.SetTop));
	assert.ok(forwardedLeaves.size > 0, 'an open result is forwarded through an ordinary jump');
	const systemRomBytes = writeTestBlua32Rom(linked);
	const folder = mkdtempSync(join(tmpdir(), 'bmsx-open-software-call-'));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	const rom = join(folder, 'system.rom'), trace = join(folder, 'trace'), state = join(folder, 'state');
	writeFileSync(rom, systemRomBytes);
	const cpuExecutionBackend = CpuExecutionBackend.Interpreter;
	const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend },
		{ sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
	runtime.boot();
	const { cpu, scheduler, memory, irqController } = runtime.machine;
	const commands: string[] = [], observations: string[] = [];
	const relay = linked.layout.functions[linked.symbols.metadata.functionIds.findIndex(id => id.endsWith('__relay'))];
	let continuation = -1, grantSize = 31;
	for (let grant = 0; grant < 8192; ++grant) {
		const cycles = grantSize;
		const outcome = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
		commands.push(`E ${cycles}`);
		observations.push(`${outcome} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		if (outcome === RunResult.Halted) break;
		const pc = cpu.readFramePc(cpu.getFrameDepth() - 1);
		if (continuation === -1 && pc >= relay.codeAddress && pc < relay.codeAddress + relay.codeByteCount) grantSize = 1;
		const link = forwardedLeaves.get(pc);
		if (continuation === -1 && link !== undefined) {
			const frame = cpu.activeThread.currentFrame!;
			assert.ok(Math.max(link, 4) < frame.top, 'firmware can clear the dead suffix without losing the link or count');
			assert.ok([1, 2, 4].map(valueInteger).includes(frame.registers.get(4)), 'prefix plus actual return suffix count');
			const caller = linked.symbols.metadata.functionIds.indexOf('module:main/entry');
			assert.equal(cpu.readFrameFunctionAddress(cpu.getFrameDepth() - 1), linked.layout.functions[caller].address,
				'neither the variable producer nor the forwarder installs a frame');
			continuation = commands.length;
			writeFileSync(state, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			memory.writeMappedWord(IO_IRQ_MASK, IRQ_VBLANK);
			irqController.raise(IRQ_VBLANK);
			assert.equal(cpu.enterPendingInterrupt(), true);
			assert.equal(cpu.fixedInterruptActive(), true);
			commands.push(`O ${IO_IRQ_MASK} ${IRQ_VBLANK}`, `i ${IRQ_VBLANK}`, 'I');
			observations.push('1');
			grantSize = 31;
		}
	}
	assert.notEqual(continuation, -1, 'a grant stops immediately before the computed return');
	assert.deepEqual(runtime.readCompletionValues(), output);
	const cleared = linked.symbols.metadata.staticScopes.declarations.find(symbol => symbol.name === 'cleared_suffix')!.address!;
	assert.equal(memory.readMappedU32LE(cleared), 1);
	commands.push(`M ${cleared}`);
	observations.push('1 0');
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
local relay_exact<const> = function(prefix, ...)
	return actual(prefix, ...)
end
local suffix<const> = function(prefix, ...)
	return blua32.argument_suffix(1)
end
local count<const> = function() return *evaluations end
return { produce = produce, collect = collect, actual = actual, forward = forward, relay = relay,
	relay_exact = relay_exact, suffix = suffix, count = count }
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
local nx, ax, bx, dx, ex = probe.relay_exact(81, false, nil, 7)
local ss, ts, us = probe.suffix(22, false, nil, 9)
local os, ps = probe.suffix(93)
return c0, p0, q0, r0, s0, c3, p3, q3, r3, s3, n0, a0, b0, d0, e0, n1, a1, b1, d1, e1,
	n3, a3, b3, d3, e3, nf, af, bf, df, ef, fs, gs, hs, nr, ar, br, dr, er, nt, at, bt, dt, et,
	nx, ax, bx, dx, ex, ss, ts, us, os, ps, probe.count(),
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
		v(4), v(81), f, z, v(7),
		z, v(9), z, z, z, v(5), v(38), f, z,
	];
	const original = linkManagedTestSystem(main, 0, [{ path, source: program }]);
	const { cpu: oracle } = createTestSystemCpu({ romBytes: writeTestBlua32Rom(original) });
	runGuestToHalt(oracle, 4_194_304);
	assert.deepEqual(materializeCpuCompletionValues(oracle), output);

	const linked = linkManagedTestSystem(main, 3, [{ path, source: program }]);
	const { layout, symbols } = linked;
	for (const name of ['__produce', '__collect', '__actual', '__forward', '__relay', '__relay_exact', '__suffix', '/entry']) {
		const idx = symbols.metadata.functionIds.findIndex(id => id.endsWith(name) && (name !== '/entry' || id === 'module:main/entry'));
		assert.notEqual(idx, -1, name);
		const fn = layout.functions[idx];
		let transfers = 0, immediateTop = 0, registerTop = 0;
		for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount;) {
			const row = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, pc);
			assert.notEqual(row.op, OpCode.CALL, name);
			assert.notEqual(row.op, OpCode.VARARG, name);
			assert.notEqual(row.op, OpCode.ARGC, name);
			if (name !== '/entry') assert.notEqual(row.op, OpCode.RET, name);
			if (row.op === OpCode.JREG) ++transfers;
			if (row.op === OpCode.MOV && row.c === ValueMoveKind.SetTopImmediate) ++immediateTop;
			if (row.op === OpCode.MOV && row.c === ValueMoveKind.SetTop) ++registerTop;
			pc = row.pc + INSTRUCTION_BYTES;
		}
		assert.ok(transfers > 0, name);
		if (name === '__relay') assert.equal(registerTop, 1, 'the forwarded tuple has a runtime count');
		if (name === '__relay_exact') {
			assert.equal(immediateTop, 1, 'the proven count uses one immediate frontier update');
			assert.equal(registerTop, 0);
		}
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

test('a wide software callee uses backing admitted at entry without growing it on the call', () => {
	const path = 'window/footprint';
	const locals = Array.from({ length: 180 }, (_, i) => `term${i}`);
	const linked = linkManagedTestSystem(`
local window<const> = require('${path}')
local x = window.wide(31)
return x + 1
`, 3, [{ path, source: `module<const>
local wide<const> = function(seed)
	${locals.map((name, i) => `local ${name} = seed + ${i}`).join('\n')}
	return ${locals.join(' + ')}
end
return { wide = wide }
` }]);
	const { layout, symbols } = linked;
	const caller = layout.functions[symbols.metadata.functionIds.indexOf('module:main/entry')];
	const callee = layout.functions[symbols.metadata.functionIds.findIndex(id => id.endsWith('__wide'))];
	assert.ok(caller.maxStack >= callee.maxStack, 'the linked caller reserves the transitive physical footprint');
	let issue = caller.codeAddress;
	while (issue < caller.codeAddress + caller.codeByteCount) {
		const row = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, issue);
		if (row.op === OpCode.JAL) break;
		issue = row.pc + INSTRUCTION_BYTES;
	}
	assert.ok(issue < caller.codeAddress + caller.codeByteCount);
	const runtime = new Runtime({ systemRomBytes: writeTestBlua32Rom(linked), cartridgeSlots: cartridgeSlots(),
		machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend: CpuExecutionBackend.Interpreter },
	{ sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
	runtime.boot();
	const { cpu, scheduler } = runtime.machine;
	const thread = cpu.rootThread;
	let completed = false, visited = false;
	let callerContext: { depth: number; frame: number; capacity: number } | undefined;
	for (let grant = 0; grant < 100_000; ++grant) {
		const depth = cpu.getFrameDepth(), pc = cpu.readFramePc(depth - 1);
		if (pc === issue) {
			callerContext = { depth, frame: cpu.readThreadFrameAddress(thread.address, depth - 1), capacity: thread.stackRegisters.capacity() };
			assert.ok(callerContext.capacity >= caller.maxStack);
		}
		if (pc >= callee.codeAddress && pc < callee.codeAddress + callee.codeByteCount) {
			assert.ok(callerContext);
			assert.deepEqual({ depth, frame: cpu.readThreadFrameAddress(thread.address, depth - 1), capacity: thread.stackRegisters.capacity() }, callerContext);
			visited = true;
		}
		const outcome = scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled);
		assert.ok(!(cpu.fixedInterruptActive() && cpu.readCauseWord() === CPU_CAUSE_CODE_REGISTER_WINDOW && cpu.readEpcWord() === issue));
		if (outcome === RunResult.Halted) { completed = true; break; }
	}
	assert.ok(visited && completed);
	assert.ok(thread.stackRegisters.capacity() >= callee.maxStack);
	assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(180 * 31 + ((179 * 180) >> 1) + 1)]);
});
