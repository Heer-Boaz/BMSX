import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueBool, valueFloatBits, valueInteger, valueNil, valuePayload, valueString, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_REGISTER_WINDOW, CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_CALL_NON_FUNCTION, LUA_FAULT_REASON_EXPLICIT_ERROR } from '../../../machine/ts/spec/blua32/cop0';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const optLevel of [0, 3] as const) test(`BIOS catches ordinary protected traps and returns exact Lua values at O${optLevel}`, t => {
	const linked = linkManagedTestSystem(`
local entries<const> = require('bmsx/startup')
local pcall<const> = blua32.closure(entries.protected_call)
local xpcall<const> = blua32.closure(entries.protected_xcall)
local error<const> = __bmsx_error
local function handler(value) return value, 103 end
local function broken(value) error(value) end
halt_until_irq
local nil_ok, nil_value = pcall(error, nil)
local invalid_ok, invalid_message = pcall(41)
local handled_ok, exact, unused = xpcall(error, handler, blua32.float_from_bits(0xff812345))
local broken_ok, broken_message = xpcall(error, broken, 97)
local good, first, absent, last = pcall(function(...) return ... end, 11, nil, 17)
local outer, inner, nested = pcall(xpcall, error, handler, 75)
local exposed<const> = blua32.closure(entries.protected_body)
local unwrapped, raw = pcall(exposed, error, handler, 51)
return nil_ok, nil_value, invalid_ok, invalid_message, handled_ok, exact, unused, broken_ok, broken_message,
	good, first, absent, last, outer, inner, nested, unwrapped, raw
`, optLevel);
	const rom = writeTestBlua32Rom(linked);
	const vector = linked.layout.functions[linked.symbols.metadata.functionIds.findIndex(id =>
		id.startsWith('module:kernel/exception_bridge/') && id.endsWith('|constant|enter'))];
	assert.ok(vector);
	const landing = linked.layout.functions[linked.symbols.metadata.functionIds.indexOf('module:kernel/protected_handler/module')];
	assert.ok(landing);
	const path = mkdtempSync(join(tmpdir(), 'bmsx-protected-trap-'));
	t.after(() => rmSync(path, { recursive: true, force: true }));
	const romPath = join(path, 'system.rom'), trace = join(path, 'trace');
	const tsState = join(path, 'ts.state'), nativeState = join(path, 'cpp.state');
	writeFileSync(romPath, rom);
	function boot() {
		const rt = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
		rt.boot();
		return rt;
	}
	const rt = boot(), { cpu, memory } = rt.machine;
	const commands: string[] = [], expected: string[] = [];
	function observe(command: string, row: string | number) {
		commands.push(command);
		expected.push(String(row));
	}
	function grant(machine: Runtime, cycles: number) {
		const { cpu, memory, scheduler } = machine.machine;
		const state = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		observe(`E ${cycles}`, `${state} ${cycles - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		return state;
	}
	function hash(machine: Runtime, first: number, length: number) {
		observe(`H ${first} ${first + length}`, hashBytes(machine.machine.memory.ramData(), first, length));
	}
	for (let i = 0; i < 1024 && !cpu.isHaltedUntilIrq(); ++i) grant(rt, 1024);
	assert.equal(cpu.isHaltedUntilIrq(), true);
	assert.equal(cpu.fixedInterruptActive(), false);
	const root = cpu.rootThread.address;
	cpu.clearHaltUntilIrq();
	commands.push('h');

	const bits = valueFloatBits(0xff812345);
	const expectedEntries = [
		[CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_EXPLICIT_ERROR, 1, valueNil()],
		[CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_CALL_NON_FUNCTION, 0, valueNil()],
		[CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_EXPLICIT_ERROR, 1, bits],
		[CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_EXPLICIT_ERROR, 1, valueInteger(97)],
		[CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_EXPLICIT_ERROR, 1, valueInteger(97)],
		[CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_EXPLICIT_ERROR, 1, valueInteger(75)],
		[CPU_CAUSE_CODE_TRAP, LUA_FAULT_REASON_EXPLICIT_ERROR, 1, valueInteger(51)],
	] as const;
	let next = 0, cut = 0, rowsAtCut = 0;
	let outcome = RunResult.Yielded;
	for (let i = 0; i < 8192 && outcome !== RunResult.Halted; ++i) {
		outcome = grant(rt, 1);
		const frame = cpu.activeThread.currentFrame;
		if (cut === 0 && !cpu.fixedInterruptActive() && frame?.pc === landing.codeAddress) {
			writeFileSync(tsState, encodeRuntimeSaveState(captureRuntimeSaveState(rt)));
			commands.push(`x ${nativeState}`);
			cut = commands.length;
			rowsAtCut = expected.length;
		}
		if (!cpu.fixedInterruptActive() || frame?.pc !== vector.codeAddress) continue;
		assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), root);
		if (cpu.readCauseWord() === CPU_CAUSE_CODE_REGISTER_WINDOW) {
			assert.equal(frame.argumentCount, 4, 'the ordinary handler CALL may need backing');
			continue;
		}
		const [cause, reason, argc, value] = expectedEntries[next++];
		assert.equal(cpu.readCauseWord(), cause);
		assert.equal(cpu.readLuaFaultReasonWord(), reason);
		assert.equal(frame.argumentCount, argc);
		assert.equal(frame.registers.get(0), value);
		observe('Z', `${cause} ${reason} ${cpu.readEpcWord()}`);
		hash(rt, frame.controlOffset, FRAME_CONTROL_BYTES);
		const physical = frame.thread.stackOffset();
		hash(rt, physical + 4 * frame.stackBase, 4);
		hash(rt, physical + 4 * frame.thread.stackRegisters.capacity() + frame.stackBase, 1);

	}
	assert.ok(cut !== 0);
	assert.equal(next, expectedEntries.length);
	function completed(machine: Runtime, state: RunResult) {
		const { cpu } = machine.machine;
		assert.equal(state, RunResult.Halted);
		assert.equal(cpu.getFrameDepth(), 0);
		assert.equal(cpu.captureRuntimeState().hardHalted, false);
		const values = [
			valueBool(false), valueNil(),
			valueBool(false), valueString(cpu.stringPool.find('Attempted to call a non-function value.')!),
			valueBool(false), bits, valueNil(),
			valueBool(false), valueString(cpu.stringPool.find('error in error handling')!),
			valueBool(true), valueInteger(11), valueNil(), valueInteger(17),
			valueBool(true), valueBool(false), valueInteger(75),
			valueBool(false), valueInteger(51),
		];
		assert.deepEqual(machine.readCompletionValues(), values);
		observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	}
	completed(rt, outcome);
	function replay(steps: readonly string[], rows: readonly string[]) {
		writeFileSync(trace, steps.join('\n'));
		const have = execFileSync(native, [romPath, trace, tsState], { encoding: 'utf8' }).trimEnd().split('\n');
		const mismatch = have.findIndex((row, index) => row !== rows[index]);
		assert.equal(mismatch, -1, `row ${mismatch}: C++=${have[mismatch]}, TS=${rows[mismatch]}`);
		assert.equal(have.length, rows.length);
	}
	replay(commands, expected);
	const tail = commands.slice(cut), rows = expected.slice(rowsAtCut);
	replay(['X', ...tail], rows);
	const restored = boot();
	applyRuntimeSaveState(restored, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	assert.equal(restored.machine.cpu.fixedInterruptActive(), false);
	assert.equal(restored.machine.cpu.activeThread.currentFrame!.pc, landing.codeAddress);
	assert.equal(restored.machine.cpu.activeThread.currentFrame!.registers.get(1), bits);
	// Resume the ordinary handler frame using exactly the same grants.
	const grantRows = rows.filter((_, index) => tail[index] === 'E 1');
	commands.length = expected.length = 0;
	outcome = RunResult.Yielded;
	for (const step of tail) if (step === 'E 1') outcome = grant(restored, 1);
	completed(restored, outcome);
	assert.deepEqual(expected.slice(0, -1), grantRows);
	assert.equal(expected.at(-1), rows.at(-1));
});
