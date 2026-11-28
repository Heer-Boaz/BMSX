import { nativeHeapReference } from '../../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FrameField, FRAME_WINDOW_MASK } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CLOSURE_PROTOTYPE_ADDRESS } from '../../../machine/ts/machine/cpu/closure';
import { valueBool, valueInteger, valueNil, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import {
	applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin,
} from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { SYSTEM_EXECUTION_DOMAIN_MASK } from '../../../machine/ts/spec/blua32/execution_domain';
import {
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET, BLUA32_FUNCTION_FLAGS_OFFSET,
	BLUA32_FUNCTION_MAX_STACK_OFFSET, BLUA32_FUNCTION_NUM_PARAMS_OFFSET, BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET,
	BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
} from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, RegisterJumpMode } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, DYNAMIC_RAM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileCartlibProgram } from '../../helpers/cartlib_cpu';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const body = `
local key = 7
local advance = function() key = 9 return 41, 42 end
local t = {tag = 81}
t = { [key] = advance(), [t.tag] = 17, label -- field-name lookahead
	= 67; ['label'] = 78, 31, nil, 32, advance(), }
local wrap = function(...) return {...} end
local nested = {child = wrap(21, 22), flag = false}
return t[7], t[9], t[81], t.label, t[1], t[2], t[3], t[4], t[5],
	nested.child[1], nested.child[2], nested.flag, {}
`;
const expected = [
	valueInteger(41), valueNil(), valueInteger(17), valueInteger(78),
	valueInteger(31), valueNil(), valueInteger(32), valueInteger(41), valueNil(),
	valueInteger(21), valueNil(), valueBool(false),
];
const source = `
local aot = function() ${body} end
local actual = assert(load([=[${body}]=]))
local compiled, dynamic = table.pack(aot()), table.pack(actual())
assert(compiled.n == 13 and dynamic.n == 13)
for index = 1, 12 do
	assert(compiled[index] == dynamic[index])
end
assert(next(compiled[13]) == nil and next(dynamic[13]) == nil)
local make_wide = assert(load('return {${'0,'.repeat(513)}77, label=88}'))
local wide = make_wide()
local root = assert(load([=[
return function(value)
	local advance = false
	local read = function() return value, advance end
	advance = function(step) value = value + step; return value end
	return advance, read
end
]=]))
local make = root()
local add_a, read_a = make(3)
local add_b, read_b = make(30)
local a, captured_a = read_a()
local b, captured_b = read_b()
assert(a == 3 and b == 30 and captured_a == add_a and captured_b == add_b and captured_a ~= captured_b)
assert(add_a(4) == 7 and read_a() == 7 and read_b() == 30)
assert(add_b(5) == 35 and read_a() == 7 and read_b() == 35)
return wide, root, make, actual()
`;

test('stock load lowers constructors and captured functions with TS/native parity', t => {
	const output = mkdtempSync(join(tmpdir(), 'bmsx-load-constructor-'));
	t.after(() => rmSync(output, { recursive: true, force: true }));
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	const { images } = compileCartlibProgram(source, { optLevel: 3 });
	const { systemImage, systemSymbols } = images;
	const receiver = systemImage.functions[systemSymbols.metadata.functionIds.indexOf(
		'module:kernel/heap_control_call/module/static:kernel__heap_control_call__receive',
	)];
	let calls = 0, returns = 0;
	for (let pc = receiver.codeAddress; pc < receiver.codeAddress + receiver.codeByteCount;) {
		const op = decodeBlua32InstructionAtPc(systemImage.textBytes, systemImage.header.textAddress, pc);
		assert.notEqual(op.op, OpCode.CALL);
		assert.notEqual(op.op, OpCode.RET);
		if (op.op === OpCode.JAL || op.op === OpCode.JREG && op.c === RegisterJumpMode.Link) ++calls;
		if (op.op === OpCode.JREG && op.c === RegisterJumpMode.Jump) ++returns;
		pc = op.pc + INSTRUCTION_BYTES;
	}
	assert.ok(calls > 0 && returns > 0, 'the actual constructor handler calls and returns via ordinary jumps');
	const system = join(output, 'system.rom'), cart = join(output, 'cart.rom'), trace = join(output, 'trace');
	writeFileSync(system, images.systemRomBytes);
	writeFileSync(cart, images.cartRomBytes);
	const runtime = new Runtime({ systemRomBytes: images.systemRomBytes,
		cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const commands: string[] = [], rows: string[] = [];
	let result = RunResult.Yielded;
	const cycles = 20_000;
	for (let grant = 0; result !== RunResult.Halted && grant < 1_000; ++grant) {
		result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		commands.push(`E ${cycles}`);
		rows.push(`${result} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
	}
	assert.equal(result, RunResult.Halted);
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	const values = runtime.readCompletionValues();
	assert.equal(values.length, 16);
	assert.deepEqual(values.slice(3, -1), expected);
	assert.equal(valueTag(values[0]), ValueTag.Table);
	assert.equal(valueTag(values[15]), ValueTag.Table);
	for (const [closure, bindCount] of [[values[1], 1], [values[2], 2]] as const) {
		assert.equal(valueTag(closure), ValueTag.Closure);
		const proto = memory.readRamRecordWord(valuePayload(closure) + CLOSURE_PROTOTYPE_ADDRESS);
		const first = memory.readRamRecordWord(proto + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
		const end = first + memory.readRamRecordWord(proto + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET);
		let bindings = 0;
		for (let pc = first; pc < end;) {
			const instruction = decodeBlua32InstructionAtPc(memory.ramData(), RAM_BASE, pc);
			if (instruction.op === OpCode.SVC) {
				assert.equal(instruction.b, 2);
				bindings += 1;
			}
			pc = instruction.pc + INSTRUCTION_BYTES;
		}
		assert.equal(bindings, bindCount);
	}
	const wide = valuePayload(values[0]), empty = valuePayload(values[15]), tables = cpu.tables;
	assert.equal(tables.arrayCapacity(wide), 514);
	assert.equal(tables.hashSize(wide), 1);
	assert.equal(tables.getInteger(wide, 513), valueInteger(0));
	assert.equal(tables.getInteger(wide, 514), valueInteger(77));
	assert.equal(tables.getStringKey(wide, nativeHeapReference(cpu).stringPool.find('label')!), valueInteger(88));
	assert.equal(tables.arrayCapacity(empty), 0);
	assert.equal(tables.hashSize(empty), 0);
	commands.push('c');
	rows.push([values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	writeFileSync(trace, commands.join('\n'));
	assert.deepEqual(execFileSync(native, [system, trace, '-', cart], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
});

test('a RAM-compiled child closure resumes from the sampled code word on both cores', t => {
	const output = mkdtempSync(join(tmpdir(), 'bmsx-ram-binding-replay-'));
	t.after(() => rmSync(output, { recursive: true, force: true }));
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	const { images } = compileCartlibProgram(`
local build<const> = assert(load([=[
local saved = 31
return function(step)
	return saved + step, blua32.payload(blua32.float_from_bits(0xff812345))
end
]=]))
local add<const> = build()
local sum<const>, raw<const> = add(5)
return sum, add, raw, blua32.payload(false)
`, { optLevel: 3 });
	const system = join(output, 'system.rom'), cart = join(output, 'cart.rom'), trace = join(output, 'trace');
	const seed = join(output, 'seed.state'), tsState = join(output, 'ts-mid.state'), cppState = join(output, 'cpp-mid.state');
	writeFileSync(system, images.systemRomBytes);
	writeFileSync(cart, images.cartRomBytes);
	const runtime = new Runtime({ systemRomBytes: images.systemRomBytes,
		cartridgeSlots: cartridgeSlots(images.cartRomBytes), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const binding = valueInteger(0x1000c); // Software token: kernel/heap_control_ids.bind_function.
	let owner = 0, depth = 0;
	cpu.setExecutionHook(() => {
		if (!cpu.fixedInterruptActive() || cpu.readCauseWord() !== CPU_CAUSE_CODE_SYSCALL
			|| cpu.readFrameRegister(cpu.getFrameDepth() - 1, 0) !== binding) return false;
		const stopped = memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS);
		const frames = cpu.readThreadFrameDepth(stopped);
		// The loader itself is in System ROM. Target the subsequent SVC
		// emitted in RAM by the running compiler for the child closure.
		if (cpu.readThreadFrameWord(stopped, frames - 1, FrameField.Function) < DYNAMIC_RAM_BASE) return false;
		owner = stopped;
		depth = frames;
		return true;
	}, SYSTEM_EXECUTION_DOMAIN_MASK, 0);
	let result = RunResult.Yielded;
	for (let grant = 0; grant < 1000 && result === RunResult.Yielded; ++grant)
		result = scheduler.runCpuSlice(0, 20_000, undefined, CpuRunKind.Scheduled);
	cpu.setExecutionHook(null, 0, 0);
	assert.equal(result, RunResult.ExecutionStopped);

	const vector = cpu.getFrameDepth() - 1, epc = cpu.readEpcWord();
	const slot = valuePayload(cpu.readFrameRegister(vector, 1));
	assert.equal(cpu.readFrameRegister(vector, 2), valueInteger(1));
	const base = cpu.readThreadFrameWord(owner, depth - 1, FrameField.StackBase) & FRAME_WINDOW_MASK;
	const prototype = valuePayload(cpu.bindThread(owner).stackRegisters.get(base + slot + 1));
	assert.ok(prototype >= DYNAMIC_RAM_BASE);
	const fields = [BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_NUM_PARAMS_OFFSET, BLUA32_FUNCTION_MAX_STACK_OFFSET,
		BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET, BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET]
		.map(offset => prototype + offset);
	const code = memory.readRamRecordWord(fields[0]);
	assert.ok(code >= DYNAMIC_RAM_BASE);
	const reads: number[] = [];
	const read = memory.readMappedBusU32LE.bind(memory);
	t.mock.method(memory, 'readMappedBusU32LE', (...args: Parameters<typeof read>) => {
		if (fields.includes(args[0])) reads.push(args[0]);
		return read(...args);
	});

	const commands: string[] = [], rows: string[] = [];
	function grant(cycles: number) {
		const run = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		commands.push(`E ${cycles}`);
		rows.push(`${run} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return run;
	}
	writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	for (let step = 0; step < 1024 && reads.length === 0; ++step)
		assert.equal(grant(1), RunResult.Yielded);
	assert.deepEqual(reads, fields.slice(0, 1));
	assert.equal(cpu.fixedInterruptActive(), true);
	assert.equal(cpu.readEpcWord(), epc, 'the stopped caller still owns the ordinary SVC successor');
	assert.equal(cpu.bindThread(owner).stackRegisters.get(base + slot), binding, 'no closure is published after only the first read');
	commands.push('P');
	rows.push(`${cpu.getFrameDepth()} ${cpu.readFramePc(cpu.getFrameDepth() - 1)}`);
	writeFileSync(tsState, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	const history = new RamHistory();
	history.start(memory);
	const pages = history.capture(memory, null), checkpoint = captureRuntimeCheckpointState(runtime);
	const prefix = commands.splice(0), prefixRows = rows.splice(0);

	function finish() {
		assert.equal(memory.readRamRecordWord(fields[0]), code, 'the snapshot restored the unmodified prototype');
		// If the BIOS rereads this field (even after restore), it will reject
		// the code address. The sampled word belongs to live firmware state.
		memory.writeMappedWord(fields[0], 0);
		commands.push(`O ${fields[0]} 0`);
		let run = RunResult.Yielded;
		for (let step = 0; step < 32 && run === RunResult.Yielded; ++step) run = grant(4096);
		assert.equal(run, RunResult.Halted);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
		assert.deepEqual(reads, fields);
		const values = runtime.readCompletionValues();
		assert.equal(values.length, 4);
		assert.equal(values[0], valueInteger(36));
		assert.equal(valueTag(values[1]), ValueTag.Closure);
		assert.equal(cpu.captureClosureBinding(valuePayload(values[1])).codeAddress, code);
		assert.deepEqual(values.slice(2), [valueInteger(0xff812345), valueInteger(0)]);
		commands.push('c');
		rows.push([values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	}
	finish();
	const tail = commands.splice(0), tailRows = rows.splice(0);
	function replay(state: string, script: readonly string[]) {
		writeFileSync(trace, script.join('\n'));
		return execFileSync(native, [system, trace, state, cart], { encoding: 'utf8' }).trimEnd().split('\n');
	}
	assert.deepEqual(replay(seed, ['X', ...prefix, `x ${cppState}`, 'l', 's', ...tail, 'u', ...tail]),
		[...prefixRows, ...tailRows, ...tailRows], 'the production C++ core reaches the same checkpoint and rewinds the same write');
	assert.deepEqual(replay(tsState, ['X', ...tail]), tailRows, 'the TS checkpoint runs on the production C++ core');
	history.restore(memory, history.capture(memory, pages), pages);
	applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
	reads.length = 1;
	finish();
	assert.deepEqual(commands.splice(0), tail);
	assert.deepEqual(rows.splice(0), tailRows, 'the TS machine rewinds both execution and the prototype write');
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(cppState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	reads.length = 1;
	finish();
	assert.deepEqual(commands, tail);
	assert.deepEqual(rows, tailRows, 'the C++ checkpoint resumes identically on TS');
});
