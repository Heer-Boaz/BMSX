import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CLOSURE_PROTOTYPE_ADDRESS } from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { THREAD_HEAP_BYTES, ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { ValueTag, valueBool, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_REGISTER_WINDOW } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode, TABLE_INDEX_VISIT_CYCLES } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_FIXED_VALUE_ADDRESS, CPU_FIXED_VALUE_COUNT, CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_RESET_BANK_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { runGuestToHalt } from '../../helpers/cpu_execution';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', {
	buildDirectory: join(tmpdir(), 'build-native-implicit-frame'),
	configure: ['-DCMAKE_BUILD_TYPE=Release', '-DBMSX_ENABLE_NATIVE_BLOCKS=ON', '-DBMSX_NATIVE_GATE_PROFILE=ON'],
});
const wideArguments = Array.from({ length: 320 }, (_, index) => String(index + 1)).join(',');

for (const level of [0, 3] as const) for (const scenario of ['read', 'write', 'refusal'] as const) {
	const refusal = scenario === 'refusal', writing = scenario === 'write';
	test(`implicit frame ${scenario} retains the architectural fault arguments at O${level}`, t => {
		const targetOp = writing ? OpCode.SETFIELD : OpCode.GETFIELD;
		const selector = writing ? '__newindex' : '__index';
		const linked = linkManagedTestSystem(`
bss invoked: u32[1]
local entries<const> = require('bmsx/startup')
local protect<const> = blua32.closure(entries.protected_call)
local set_meta<const> = require('kernel/set_metatable')
local function callback(receiver, ...)
	invoked[0] = invoked[0] + 1
	-- The cold branch reserves an ordinary large register window without
	-- changing the two or three values supplied by the implicit call.
	local guard = receiver.guard
	if guard == 0 then receiver.extra(${wideArguments}) end
	${writing ? 'local key, value = ...\n\treceiver.guard = #key + value' : 'local key = ...\n\treturn guard + #key'}
end
local function receiver()
	local forward = set_meta({ guard = 66 }, { ${selector} = callback })
	local outer = set_meta({ ${selector} = forward }, { __mode = 'v' })
	return set_meta({}, outer)
end
local function issue(object)
	halt_until_irq
	${writing ? 'object.missing = 211\n\treturn 1' : 'return object.missing, 1'}
end
local ok, result, trailing = protect(issue, receiver())
return ok, result, trailing
`, level);
		const romBytes = writeTestBlua32Rom(linked);
		const invokedSymbol = linked.object.sections.bss.symbols.find(symbol => symbol.name.endsWith('invoked'))!;
		const invoked = linked.layout.header.bssAddress + invokedSymbol.offset;
		function boot() {
			const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
			runtime.boot();
			assert.equal(runtime.machine.cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
			return runtime;
		}
		const runtime = boot(), { cpu, memory } = runtime.machine, arena = cpu.heapAllocator, tables = cpu.gc.tables;
		runGuestToHalt(cpu, 4_194_304);
		assert.equal(cpu.isHaltedUntilIrq(), true);
		const thread = cpu.activeThread, owner = thread.address, depth = thread.frameDepth, caller = thread.currentFrame!;
		const decode = () => decodeBlua32InstructionAtPc(romBytes, SYSTEM_ROM_BASE, caller.pc);
		cpu.clearHaltUntilIrq();
		for (let i = 0; i < 32 && decode().op !== targetOp; ++i)
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		const instruction = decode();
		assert.equal(instruction.op, targetOp);
		const issue = caller.pc, successor = instruction.pc + INSTRUCTION_BYTES;
		const object = valuePayload(caller.registers.get(writing ? instruction.a : instruction.b));
		const outer = tables.metatableAddress(object);
		const selectorId = cpu.stringPool.find(selector)!, key = cpu.stringPool.find('missing')!, guard = cpu.stringPool.find('guard')!;
		const receiver = tables.getStringKey(outer, selectorId);
		assert.equal(valueTag(receiver), ValueTag.Table);
		const forward = valuePayload(receiver);
		const method = tables.getStringKey(tables.metatableAddress(forward), selectorId);
		assert.equal(valueTag(method), ValueTag.Closure);
		const methodAddress = memory.readRamRecordWord(valuePayload(method) + CLOSURE_PROTOTYPE_ADDRESS);
		const callee = linked.layout.functions.find(fn => fn.address === methodAddress)!;
		const stackTop = thread.stackTop, stackBlock = memory.readRamRecordWord(owner + ThreadField.StackBlock);
		const frames = memory.readRamRecordWord(owner + ThreadField.FrameBlock), valueCapacity = thread.stackRegisters.capacity();
		const operands = writing ? [receiver, valueString(key), valueInteger(211)] : [receiver, valueString(key)];
		const required = stackTop + operands.length + callee.maxStack;
		assert.ok(required > valueCapacity, `the vararg callback needs ${required} Values with only ${valueCapacity} backed`);
		assert.equal(callee.numParams, 1);
		assert.equal(memory.readRamRecordWord(invoked), 0);

		cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
		if (refusal) {
			for (let i = 0; i < 4096 && cpu.gc.phase() !== GcPhase.Atomic; ++i)
				cpu.gc.step(valueNil(), valueNil(), valueNil(), 0, false, 11);
			assert.equal(cpu.gc.phase(), GcPhase.Atomic);
			assert.equal(cpu.gc.isAlive(forward), false, 'the selected receiver is only weakly reachable before the fault');
			while (arena.allocate(4088, true)) { /* fill the large free extents before either core runs the fault */ }
			while (arena.allocate(24, true)) { /* leave no extents wide enough for the callback */ }
		}

		const dir = mkdtempSync(join(tmpdir(), 'implicit-window-'));
		t.after(() => rmSync(dir, { recursive: true, force: true }));
		const rom = join(dir, 'system.rom'), trace = join(dir, 'trace');
		const seed = join(dir, 'seed'), mid = join(dir, 'ts-mid'), nativeMid = join(dir, 'native-mid');
		writeFileSync(rom, romBytes);
		writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		const commands: string[] = [], rows: string[] = [];
		function observe(command: string, row: string | number) {
			commands.push(command);
			rows.push(String(row));
		}
		function hash(rt: Runtime, address: number, bytes: number) {
			const start = address - RAM_BASE;
			observe(`H ${start} ${start + bytes}`, hashBytes(rt.machine.memory.ramData(), start, bytes));
		}
		function grant(rt: Runtime, budget: number) {
			const { cpu, memory, scheduler } = rt.machine;
			const result = scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Scheduled);
			const used = budget - cpu.instructionBudgetRemaining;
			observe(`E ${budget}`, `${result} ${used} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
			return { result, used };
		}
		const charged = cpu.luaHeap.usedBytes();
		assert.deepEqual(grant(runtime, 1), { result: RunResult.Yielded, used: BASE_CYCLES[targetOp] + TABLE_INDEX_VISIT_CYCLES });
		assert.equal(cpu.fixedInterruptActive(), true);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_REGISTER_WINDOW);
		assert.equal(cpu.readEpcWord(), issue);
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
		assert.equal(cpu.readThreadFrameDepth(owner), depth);
		assert.equal(cpu.readThreadFrameWord(owner, depth - 1, FrameField.Pc), successor, 'detached issue proceeds only once');
		assert.equal(cpu.luaHeap.usedBytes(), charged);

		const packet = cpu.activeThread.currentFrame!;
		const argumentCount = 12 + operands.length;
		assert.equal(packet.argumentCount, argumentCount);
		const regs = packet.registers;
		assert.deepEqual([regs.get(0), regs.get(1), regs.get(2)], [valueInteger(required), valueInteger(depth + 2), valueInteger(0)]);
		assert.equal(valueTag(regs.get(3)), ValueTag.Integer);
		assert.deepEqual(Array.from({ length: argumentCount - 4 }, (_, index) => regs.get(index + 4)), [
			valueInteger(methodAddress), valueInteger(callee.codeAddress), valueInteger(valuePayload(method)), valueInteger(1 << 5),
			valueInteger(callee.numParams), valueInteger(stackTop + operands.length),
			valueInteger(writing ? 0 : instruction.a), valueInteger(writing ? 1 : 2),
			...operands,
		]);
		observe('Z', `${CPU_CAUSE_CODE_REGISTER_WINDOW} 0 ${issue}`);
		hash(runtime, owner, THREAD_HEAP_BYTES);
		hash(runtime, RAM_BASE + packet.controlOffset, FRAME_CONTROL_BYTES);
		hash(runtime, CPU_FIXED_VALUE_ADDRESS + 4 * packet.stackBase, 4 * argumentCount);
		hash(runtime, CPU_FIXED_VALUE_ADDRESS + 4 * CPU_FIXED_VALUE_COUNT + packet.stackBase, argumentCount);
		assert.equal(grant(runtime, 17).result, RunResult.Yielded);
		assert.equal(cpu.fixedInterruptActive(), true);
		assert.equal(cpu.readThreadFrameDepth(owner), depth);
		writeFileSync(mid, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		commands.push(`x ${nativeMid}`);
		const commandCut = commands.length, rowCut = rows.length;
		function finish(rt: Runtime) {
			const { cpu, memory } = rt.machine;
			for (let step = 0; cpu.fixedInterruptActive() && step < 65_536; ++step) {
				const { result } = grant(rt, 1);
				assert.equal(result, RunResult.Yielded,
					`fixed window handler stopped with cause ${cpu.readCauseWord()}, reason ${cpu.readLuaFaultReasonWord()}, pc ${cpu.readCurrentInstructionPc().toString(16)}`);
			}
			assert.equal(cpu.fixedInterruptActive(), false);
			assert.equal(cpu.activeThread.address, owner);
			assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
			assert.equal(memory.readRamRecordWord(invoked), 0, 'no callback instruction has run before firmware returns');
			if (refusal) {
				assert.ok(cpu.readThreadFrameDepth(owner) <= depth, 'failed reservation publishes no child');
				assert.equal(memory.readRamRecordWord(owner + ThreadField.StackBlock), stackBlock);
				assert.equal(memory.readRamRecordWord(owner + ThreadField.FrameBlock), frames);
				assert.equal(cpu.gc.tableRecordAddress(forward), forward, 'the vector roots the otherwise weak-only receiver across recovery');
			} else {
				assert.equal(cpu.readThreadFrameDepth(owner), depth + 1);
				const frame = cpu.activeThread.currentFrame!;
				assert.equal(frame.functionAddress, methodAddress);
				assert.equal(frame.pc, callee.codeAddress);
				assert.equal(frame.callSitePc, issue);
				assert.equal(frame.argumentCount, operands.length);
				assert.ok(cpu.activeThread.stackRegisters.capacity() >= required);
				assert.equal(frame.registers.get(0), receiver);
				assert.deepEqual(operands.slice(1).map((_, index) => cpu.activeThread.stackRegisters.get(frame.varargBase + index)), operands.slice(1));
			}
			hash(rt, owner, THREAD_HEAP_BYTES);
			let run = RunResult.Yielded;
			for (let step = 0; step < 256 && run === RunResult.Yielded; ++step) run = grant(rt, 257).result;
			assert.equal(run, RunResult.Halted);
			assert.equal(cpu.captureRuntimeState().hardHalted, false);
			const result = rt.readCompletionValues();
			if (refusal) {
				assert.equal(result[0], valueBool(false));
				assert.equal(valueTag(result[1]), ValueTag.String);
				assert.equal(cpu.stringPool.toString(valuePayload(result[1])), 'Out of memory.');
				assert.equal(result[2], valueNil());
			} else {
				assert.deepEqual(result, writing ? [valueBool(true), valueInteger(1), valueNil()] : [valueBool(true), valueInteger(73), valueInteger(1)]);
				assert.equal(cpu.gc.tables.getStringKey(forward, guard), valueInteger(writing ? 218 : 66));
			}
			assert.equal(memory.readRamRecordWord(invoked), refusal ? 0 : 1);
			observe('c', [result.length, ...result.flatMap(v => [valueTag(v), valuePayload(v)])].join(' '));
			hash(rt, invoked, INSTRUCTION_BYTES);
		}
		finish(runtime);
		function replay(input: string, steps: readonly string[], expected: readonly string[]) {
			writeFileSync(trace, ['X', ...steps].join('\n'));
			const actual = execFileSync(native, [rom, trace, input], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trimEnd().split('\n');
			const mismatch = actual.findIndex((row, index) => row !== expected[index]);
			assert.equal(mismatch, -1, `row ${mismatch}: C++=${actual[mismatch]}, TS=${expected[mismatch]}`);
			assert.equal(actual.length, expected.length);
		}
		replay(seed, commands, rows);
		const tail = commands.slice(commandCut), expected = rows.slice(rowCut);
		replay(mid, ['l', 's', ...tail, 'u', ...tail], [...expected, ...expected]);
		const restored = boot();
		applyRuntimeSaveState(restored, decodeRuntimeSaveState(readFileSync(nativeMid), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		commands.length = rows.length = 0;
		finish(restored);
		assert.deepEqual(commands, tail);
		assert.deepEqual(rows, expected);
	});
}
