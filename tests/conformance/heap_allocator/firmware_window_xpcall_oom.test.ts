import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import {
	FRAME_CONTROL_BYTES, FRAME_WINDOW_MASK, FrameField,
} from '../../../machine/ts/machine/cpu/call_state';
import { captureAddress, CLOSURE_PROTOTYPE_ADDRESS } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { THREAD_HEAP_BYTES, ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { isOpen, load, UPVALUE_ADDRESS_MASK, UPVALUE_HEAP_BYTES } from '../../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valueBool, valueClosure, valueNil, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_REGISTER_WINDOW, CPU_STATUS_USER_MODE_CURRENT } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_RESET_BANK_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const parent of [false, true]) test(`firmware xpcall handles real CALL window OOM${parent ? ' through a nested ordinary pcall' : ' in the interrupted User context'}`, t => {
	const staticBytes = 3_600_000;
	const locals = Array.from({ length: 160 }, (_, index) => `local z${index} = 1`).join('\n');
	const linked = linkManagedTestSystem(`
bss blocked: u8[${staticBytes}]
bss handler_calls: word
blocked[0] = 1
local vectors<const> = require('bmsx/startup')
local protect<const> = blua32.closure(vectors.protected_xcall)
${parent ? 'local outer<const> = blua32.closure(vectors.protected_call)' : ''}

local function make_handler()
	local kept = {}
	return function(raised)
		local calls<const>: *word = handler_calls
		*calls = *calls + 1
		observed_error = raised
		return kept, 0x12345678
	end
end

local function descend()
	${locals}
	return descend()
end

local handler<const> = make_handler()
cop0.status = ${CPU_STATUS_USER_MODE_CURRENT}
local ok, result, trailing = ${parent ? 'outer(protect, descend, handler)' : 'protect(descend, handler)'}
return ok, result, trailing
`, 0);
	const rom = writeTestBlua32Rom(linked);
	const bss = linked.object.sections.bss.symbols.find(symbol => symbol.name.endsWith('handler_calls'))!;
	const counter = linked.layout.header.bssAddress + bss.offset;
	const trampoline = linked.layout.functions[linked.symbols.metadata.functionIds.indexOf('module:kernel/protected_handler/module')];
	const body = linked.layout.functions[linked.symbols.metadata.functionIds.indexOf('module:kernel/protected_body/module')];
	const entry = linked.layout.functions[linked.symbols.metadata.functionIds.indexOf('module:main/entry')];
	function boot() {
		const rt = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		rt.boot();
		assert.equal(rt.machine.cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		return rt;
	}
	const runtime = boot(), { cpu, memory } = runtime.machine;
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-firmware-xpcall-window-oom-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const romPath = join(dir, 'system.rom'), trace = join(dir, 'trace');
	const tsState = join(dir, 'ts.state'), nativeState = join(dir, 'native.state');
	writeFileSync(romPath, rom);
	const commands: string[] = [], expected: string[] = [];
	function observe(command: string, row: string | number) {
		commands.push(command);
		expected.push(String(row));
	}
	function hash(rt: Runtime, address: number, size: number) {
		const first = address - RAM_BASE;
		observe(`H ${first} ${first + size}`, hashBytes(rt.machine.memory.ramData(), first, size));
	}
	function grant(rt: Runtime, budget = 3072) {
		const { cpu, memory, scheduler } = rt.machine;
		const run = scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Scheduled);
		observe(`E ${budget}`, `${run} ${budget - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return run;
	}

	let owner = 0, handler = 0, captured = 0, lastIssue = 0, required = 0, issues = 0;
	const enteredHandler = () => !cpu.fixedInterruptActive() && cpu.activeThread.currentFrame?.functionAddress === trampoline.address;
	const entries = new Map(linked.layout.functions.map(fn => [fn.address, fn]));
	for (let i = 0; i < 65536 && !enteredHandler(); ++i) {
		// Narrow the grant only near the terminal unwind. The boot, recursive
		// execution and collection do not need single-instruction tracing.
		const budget = owner !== 0 && memory.readRamRecordWord(owner + ThreadField.StackCapacity) >= 16384
			? cpu.fixedInterruptActive() && cpu.readThreadFrameDepth(owner) < 24 ? 1 : 512
			: 3072;
		assert.equal(grant(runtime, budget), RunResult.Yielded, 'the xpcall has not returned past the handler entry');
		if (!cpu.fixedInterruptActive() || cpu.readCauseWord() !== CPU_CAUSE_CODE_REGISTER_WINDOW) continue;
		const interrupted = memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS);
		const depth = cpu.readThreadFrameDepth(interrupted);
		const boundary = Array.from({ length: depth }, (_, index) => cpu.readThreadFrameWord(interrupted, index, FrameField.Function)).indexOf(body.address);
		if (boundary < 0) continue;
		const issuer = memory.readRamRecordWord(interrupted + ThreadField.FrameBlock) + (depth - 1) * FRAME_CONTROL_BYTES;
		const pc = cpu.readEpcWord();
		if (memory.readRamRecordWord(issuer + FrameField.Pc) !== pc) continue;
		const callee = decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, pc);
		if (callee.op !== OpCode.CALL) continue;
		const value = cpu.readThreadRegister(interrupted, depth - 1, callee.a);
		if (valueTag(value) !== ValueTag.Closure) continue;
		if (memory.readRamRecordWord(valuePayload(value) + CLOSURE_PROTOTYPE_ADDRESS) !==
			memory.readRamRecordWord(issuer + FrameField.Function)) continue;
		const fn = entries.get(memory.readRamRecordWord(issuer + FrameField.Function))!;
		const extent = (memory.readRamRecordWord(issuer + FrameField.StackBase) & FRAME_WINDOW_MASK) + callee.a + 1 + fn.maxStack;
		if (extent <= required) continue;
		++issues;
		lastIssue = pc;
		required = extent;
		owner = interrupted;
		assert.equal(owner, cpu.rootThread.address);
		const handlerSlot = cpu.readThreadFrameWord(owner, boundary - 1, FrameField.VarargBase) & FRAME_WINDOW_MASK;
		handler = valuePayload(cpu.rootThread.stackRegisters.get(handlerSlot));
		captured = captureAddress(memory, handler, 0);
		assert.equal(isOpen(memory, captured), false, 'handler owns a closed Table capture');
		observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${lastIssue}`);
		hash(runtime, issuer, FRAME_CONTROL_BYTES);
	}
	assert.ok(issues > 1, 'recursive CALL window growth preceded the terminal shortage');
	assert.ok(enteredHandler(), `the BIOS resumed the ordinary ROM handler trampoline (cause ${cpu.readCauseWord()}, pc ${cpu.activeThread.currentFrame?.pc}, interrupted depth ${cpu.readThreadFrameDepth(owner)}, extent ${required})`);
	assert.ok(memory.ramBusEnd() >= linked.layout.header.bssAddress + staticBytes);
	assert.ok(required > memory.readRamRecordWord(owner + ThreadField.StackCapacity));
	const active = cpu.activeThread.currentFrame!;
	const sentinel = load(memory, captured), diagnostic = active.registers.get(1);
	assert.equal(valueTag(sentinel), ValueTag.Table);
	assert.equal(valueTag(diagnostic), ValueTag.String);
	assert.equal(cpu.stringPool.toString(valuePayload(diagnostic)), 'Out of memory.');
	assert.equal(active.argumentCount, 2);
	assert.equal(active.registers.get(0), valueClosure(handler));
	assert.equal(cpu.isUserMode(), true, 'the ordinary handler resumed in the original mode');
	assert.equal(cpu.readEpcWord(), trampoline.codeAddress);
	assert.equal(active.pc, trampoline.codeAddress);
	assert.equal(memory.readRamRecordWord(counter), 0, 'handler has not run at the RFE boundary');
	observe('P', `${cpu.getFrameDepth()} ${active.pc}`);
	hash(runtime, RAM_BASE + active.controlOffset, FRAME_CONTROL_BYTES);
	hash(runtime, RAM_BASE + (captured & UPVALUE_ADDRESS_MASK), UPVALUE_HEAP_BYTES);

	writeFileSync(tsState, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	commands.push(`x ${nativeState}`);
	const commandCut = commands.length, rowCut = expected.length;

	function finish(rt: Runtime) {
		const { cpu, memory } = rt.machine;
		let run = RunResult.Yielded;
		for (let i = 0; i < 128 && run !== RunResult.Halted; ++i) run = grant(rt);
		assert.equal(run, RunResult.Halted);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		assert.equal(cpu.fixedInterruptActive(), false);
		assert.equal(cpu.isUserMode(), true);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW);
		// The entry's later RET retires the recursive capture and replaces
		// the handler's original EPC, which was sampled before it ran.
		const returnPc = cpu.readEpcWord();
		assert.ok(returnPc >= entry.codeAddress && returnPc < entry.codeAddress + entry.codeByteCount);
		assert.equal(decodeBlua32InstructionAtPc(rom, SYSTEM_ROM_BASE, returnPc).op, OpCode.RET);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
		assert.equal(memory.readRamRecordWord(counter), 1);
		assert.equal(cpu.getGlobalByKey(cpu.stringPool.find('observed_error')!), diagnostic);
		const results = parent ? [valueBool(true), valueBool(false), sentinel] : [valueBool(false), sentinel, valueNil()];
		assert.deepEqual(rt.readCompletionValues(), results);
		observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${returnPc}`);
		observe('c', [results.length, ...results.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
		hash(rt, owner, THREAD_HEAP_BYTES);
		hash(rt, counter, INSTRUCTION_BYTES);
	}
	finish(runtime);

	function replay(steps: readonly string[], expectedRows: readonly string[]) {
		writeFileSync(trace, steps.join('\n'));
		const rows = execFileSync(native, [romPath, trace, tsState], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trimEnd().split('\n');
		const mismatch = rows.findIndex((row, index) => row !== expectedRows[index]);
		assert.equal(mismatch, -1, `row ${mismatch}: C++=${rows[mismatch]}, TS=${expectedRows[mismatch]}`);
		assert.equal(rows.length, expectedRows.length);
	}
	replay(commands, expected);
	const tail = commands.slice(commandCut), rows = expected.slice(rowCut);
	replay(['X', ...tail], rows);
	const restored = boot();
	applyRuntimeSaveState(restored, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	assert.equal(restored.machine.cpu.activeThread.currentFrame!.pc, trampoline.codeAddress);
	assert.equal(restored.machine.memory.readRamRecordWord(counter), 0);
	commands.length = expected.length = 0;
	finish(restored);
	assert.deepEqual(commands, tail);
	assert.deepEqual(expected, rows);
});
