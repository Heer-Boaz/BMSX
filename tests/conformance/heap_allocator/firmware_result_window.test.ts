import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_COMPLETION, FRAME_EXCEPTION, FRAME_WINDOW_MASK, FrameField, registerWindowBucket } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { THREAD_HEAP_BYTES, ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { ValueTag, valueBool, valueInteger, valueNil, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BuiltinFunctionId } from '../../../machine/ts/spec/blua32/builtin';
import { CPU_CAUSE_CODE_REGISTER_WINDOW } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES, MAX_LOW_OPERAND, MAX_OPERAND_BITS, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode, encodeFixedValueCount } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_FIXED_VALUE_ADDRESS, CPU_FIXED_VALUE_COUNT, CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const locals = Array.from({ length: 49 }, (_, index) => `local r${index} = ${index + 1}`).join('\n');
const fixedResults = 80;
const deadText = 'unreachable room for completed CALL results '.repeat(256);

for (const kind of ['open', 'fixed', 'refusal', 'resident', 'weak'] as const) test(`firmware places a completed ${kind} CALL result without repeating the producer`, t => {
	const resident = kind === 'resident', refusal = kind === 'refusal', weak = kind === 'weak';
	const linked = linkManagedTestSystem(`
local entries<const> = require('bmsx/startup')
local protect<const> = blua32.closure(entries.protected_call)
${resident ? "local heap<const> = require('kernel/gc_full')" : ''}
${weak ? `
local set_meta<const> = require('kernel/gc_barrier').set_metatable
local function weak_owner()
	return set_meta({{marker = 57}}, { __mode = 'v' })
end
` : ''}
local function caller(${weak ? 'owner' : ''})
	${locals}
	${resident || weak ? '' : 'local thread = (__bmsx_coroutine_running())'}
	halt_until_irq
	return ${resident ? 'heap.heap_bytes()' : weak ? '__bmsx_next(owner, nil)' : '__bmsx_frame_header(thread, 0)'}
end
return protect(caller${weak ? ', weak_owner()' : ''})
`, 0);
	const rom = writeTestBlua32Rom(linked);
	if (resident || weak || kind === 'fixed') {
		// Bytecode may request more results than its present window can hold.
		// A source assignment would statically reserve the padding instead.
		const slot = linked.symbols.metadata.functionIds.findIndex(id => id.endsWith(':caller'));
		assert.ok(slot >= 0);
		const caller = linked.layout.functions[slot];
		const supplied = resident ? 1 : 3;
		let patched = false;
		for (let pc = caller.codeAddress; pc < caller.codeAddress + caller.codeByteCount; pc += INSTRUCTION_BYTES) {
			const op = decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, pc);
			if (op.op !== OpCode.CALL || op.b !== supplied || op.c !== 0) continue;
			const count = encodeFixedValueCount(fixedResults);
			assert.ok(op.a <= MAX_LOW_OPERAND);
			writeInstruction(rom, (op.pc - SYSTEM_ROM_BASE) / INSTRUCTION_BYTES, OpCode.CALL,
				op.a, op.b, count & MAX_LOW_OPERAND, count >>> MAX_OPERAND_BITS);
			patched = true;
			break;
		}
		assert.equal(patched, true);
	}

	function boot() {
		const rt = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		rt.boot();
		return rt;
	}
	const runtime = boot(), { cpu, memory } = runtime.machine;
	runGuestToHalt(cpu, 4_194_304);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	const thread = cpu.activeThread, owner = thread.address, depth = thread.frameDepth, caller = thread.currentFrame!;
	cpu.clearHaltUntilIrq();
	const decode = () => decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, caller.pc);
	for (let step = 0; step < 32 && decode().op !== OpCode.CALL; ++step)
		assert.equal(runtime.machine.scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
	const instruction = decode();
	assert.equal(instruction.op, OpCode.CALL);
	assert.equal(valueTag(caller.registers.get(instruction.a)), resident ? ValueTag.ResidentFunction : ValueTag.BuiltinFunction);
	if (!resident) assert.equal(valuePayload(caller.registers.get(instruction.a)), weak ? BuiltinFunctionId.Next : BuiltinFunctionId.FrameHeader);
	const issue = caller.pc, successor = instruction.pc + INSTRUCTION_BYTES;
	const stack = memory.readRamRecordWord(owner + ThreadField.StackBlock);
	const controls = memory.readRamRecordWord(owner + ThreadField.FrameBlock);
	const initialCapacity = thread.stackRegisters.capacity(), initialTop = caller.top;
	const observedCallSite = cpu.readThreadFrameWord(owner, 0, FrameField.CallSite);
	const flags = cpu.readThreadFrameWord(owner, 0, FrameField.Flags);
	const weakOwner = weak ? valuePayload(caller.registers.get(instruction.a + 1)) : 0;
	const output = resident ? [valueInteger(cpu.luaHeap.usedBytes()), valueInteger(cpu.luaHeap.capacity())]
		: weak ? [valueInteger(1), cpu.gc.tables.getInteger(weakOwner, 1)] : [
		valueInteger(cpu.readThreadFrameWord(owner, 0, FrameField.Function)),
		valueInteger(cpu.readThreadFrameWord(owner, 0, FrameField.Pc)),
		valueInteger(observedCallSite),
		valueBool((flags & FRAME_COMPLETION) !== 0),
		valueInteger(cpu.readThreadFrameExecutionDomain(owner, 0)),
		valueBool((flags & FRAME_EXCEPTION) !== 0),
	];
	const selected = instruction.c === 0 ? output.length : instruction.c - 1;
	const top = instruction.a + selected;
	const required = caller.stackBase + registerWindowBucket(top);
	assert.ok(caller.stackBase + top > initialCapacity, 'the actual result, not merely its rounded bucket, exceeds backing');
	cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
	if (weak) {
		assert.equal(valueTag(output[1]), ValueTag.Table);
		// Start with a clean heap, temporarily keeping the weak member
		// during setup. The next epoch sees only the actual guest roots.
		cpu.gc.collect(output[1]);
		cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
		cpu.stringPool.intern(deadText);
		for (let step = 0; cpu.gc.phase() !== GcPhase.Atomic && step < 4096; ++step)
			cpu.gc.step(valueNil(), valueNil(), valueNil(), 0, false, 11);
		assert.equal(cpu.gc.phase(), GcPhase.Atomic);
		assert.equal(cpu.gc.isAlive(valuePayload(output[1])), false, 'the next() value is weak-only while the producer is still stopped');
		assert.equal(cpu.gc.tables.getInteger(weakOwner, 1), output[1]);
	}
	if (weak || refusal) {
		if (refusal) cpu.gc.collect();
		while (cpu.heapAllocator.allocate(4088, true)) { /* occupy the remaining large extents */ }
		while (cpu.heapAllocator.allocate(24, true)) { /* leave no extent for Value backing */ }
	}

	const dir = mkdtempSync(join(tmpdir(), 'firmware-result-window-'));
	t.after(() => rmSync(dir, { force: true, recursive: true }));
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace');
	const seed = join(dir, 'seed'), tsMid = join(dir, 'ts-mid'), cppMid = join(dir, 'cpp-mid');
	writeFileSync(romPath, rom);
	writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const commands: string[] = [], rows: string[] = [];
	function observe(command: string, row: string | number) {
		commands.push(command);
		rows.push(String(row));
	}
	function hash(rt: Runtime, start: number, bytes: number) {
		const offset = start - RAM_BASE;
		observe(`H ${offset} ${offset + bytes}`, hashBytes(rt.machine.memory.ramData(), offset, bytes));
	}
	function grant(rt: Runtime, budget: number) {
		const { cpu, memory, scheduler } = rt.machine;
		const result = scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Scheduled);
		const used = budget - cpu.instructionBudgetRemaining;
		observe(`E ${budget}`, `${result} ${used} ${+cpu.heapServiceActive()} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return { result, used };
	}
	const issued = grant(runtime, 1);
	assert.equal(issued.result, RunResult.Yielded);
	if (resident) {
		assert.equal(cpu.heapServiceActive(), true, 'the existing resident producer is entered once');
		for (let step = 0; !cpu.fixedInterruptActive() && step < 4096; ++step)
			assert.equal(grant(runtime, 1).result, RunResult.Yielded);
	} else assert.equal(issued.used, BASE_CYCLES[OpCode.CALL] + 1, 'placement is not charged before the BIOS receives the result');
	assert.equal(cpu.heapServiceActive(), false, 'result growth runs in the ordinary exception, not the producer bank');
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW);
	assert.equal(cpu.readEpcWord(), issue);
	assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
	assert.equal(cpu.readThreadFrameDepth(owner), depth);
	assert.equal(cpu.readThreadFrameWord(owner, depth - 1, FrameField.Pc), successor, 'the completed producer is not retried');
	assert.equal(cpu.readThreadFrameWord(owner, depth - 1, FrameField.Top) & FRAME_WINDOW_MASK, initialTop);
	assert.equal(memory.readRamRecordWord(owner + ThreadField.StackBlock), stack);
	assert.equal(memory.readRamRecordWord(owner + ThreadField.StackCapacity), initialCapacity);

	const packet = cpu.activeThread.currentFrame!, regs = packet.registers;
	assert.equal(packet.argumentCount, 6 + output.length, 'padding does not occupy exception arguments');
	assert.deepEqual([regs.get(0), regs.get(1), regs.get(2)], [required, top, -1].map(valueInteger));
	assert.equal(valueTag(regs.get(3)), ValueTag.Integer);
	assert.equal(regs.get(4), valueInteger(instruction.a));
	assert.equal(regs.get(5), valueInteger(selected));
	assert.deepEqual(output.map((_, index) => regs.get(6 + index)), output);
	observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${issue}`);
	hash(runtime, CPU_FIXED_VALUE_ADDRESS + 4 * packet.stackBase, 4 * packet.argumentCount);
	hash(runtime, CPU_FIXED_VALUE_ADDRESS + 4 * CPU_FIXED_VALUE_COUNT + packet.stackBase, packet.argumentCount);

	if (!resident && !weak) {
		// An externally edited diagnostic lane of the parked ancestor does
		// not affect control flow. Re-running FrameHeader would now return
		// the new callsite instead of the already sampled one.
		const address = controls + FrameField.CallSite, replacement = observedCallSite + INSTRUCTION_BYTES;
		memory.writeRamRecordWord(address, replacement);
		commands.push(`W ${address} ${replacement}`);
	}
	assert.equal(grant(runtime, 17).result, RunResult.Yielded);
	assert.equal(cpu.fixedInterruptActive(), true);
	writeFileSync(tsMid, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	commands.push(`x ${cppMid}`);
	const commandCut = commands.length, rowCut = rows.length;
	function finish(rt: Runtime) {
		const { cpu, memory } = rt.machine;
		for (let step = 0; cpu.fixedInterruptActive() && step < 65_536; ++step)
			assert.equal(grant(rt, 1).result, RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(cpu.activeThread.address, owner);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
		if (refusal) {
			assert.ok(cpu.getFrameDepth() <= depth);
			assert.equal(memory.readRamRecordWord(owner + ThreadField.StackBlock), stack);
			assert.equal(memory.readRamRecordWord(owner + ThreadField.StackCapacity), initialCapacity);
		} else {
			assert.equal(cpu.getFrameDepth(), depth, 'result placement does not publish a child frame');
			assert.equal(cpu.readFramePc(depth - 1), successor);
			assert.equal(cpu.readEpcWord(), successor);
			assert.ok(cpu.activeThread.stackRegisters.capacity() >= required);
			assert.equal(cpu.activeThread.currentFrame!.top, top);
			for (let i = 0; i < selected; ++i)
				assert.equal(cpu.readFrameRegister(depth - 1, instruction.a + i), i < output.length ? output[i] : valueNil());
			if (weak) {
				assert.equal(cpu.stringPool.find(deadText), undefined, 'growth collected the extent blocker before retry');
				assert.equal(cpu.gc.tables.getInteger(weakOwner, 1), output[1]);
				assert.equal(cpu.gc.tableRecordAddress(valuePayload(output[1])), valuePayload(output[1]));
			}
		}
		hash(rt, owner, THREAD_HEAP_BYTES);
		let run = RunResult.Yielded;
		for (let step = 0; step < 256 && run === RunResult.Yielded; ++step) run = grant(rt, 257).result;
		assert.equal(run, RunResult.Halted);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		const values = rt.readCompletionValues();
		if (refusal) {
			assert.equal(values.length, 2);
			assert.equal(values[0], valueBool(false));
			assert.equal(valueTag(values[1]), ValueTag.String);
			assert.equal(cpu.stringPool.toString(valuePayload(values[1])), 'Out of memory.');
		} else assert.deepEqual(values, [valueBool(true), ...output, ...Array.from({ length: selected - output.length }, () => valueNil())]);
		observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	}
	finish(runtime);
	function replay(input: string, sequence: readonly string[], expected: readonly string[]) {
		writeFileSync(trace, ['X', ...sequence].join('\n'));
		const actual = execFileSync(native, [romPath, trace, input], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trimEnd().split('\n');
		const mismatch = actual.findIndex((row, index) => row !== expected[index]);
		assert.equal(mismatch, -1, `row ${mismatch}: C++=${actual[mismatch]}, TS=${expected[mismatch]}`);
		assert.equal(actual.length, expected.length);
	}
	replay(seed, commands, rows);
	const tail = commands.slice(commandCut), expected = rows.slice(rowCut);
	replay(tsMid, ['l', 's', ...tail, 'u', ...tail], [...expected, ...expected]);
	const restored = boot();
	applyRuntimeSaveState(restored, decodeRuntimeSaveState(readFileSync(cppMid), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = rows.length = 0;
	finish(restored);
	assert.deepEqual(commands, tail);
	assert.deepEqual(rows, expected);
});
