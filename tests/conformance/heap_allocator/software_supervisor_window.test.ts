import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FrameField, FRAME_WINDOW_MASK } from '../../../machine/ts/machine/cpu/call_state';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { linkManagedTestSystem } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

test('ordinary software calls can create values through the existing supervisor window', t => {
	const mix = Array.from({ length: 50 }, (_, i) => `x = x + ${i + 1}`).join('\n');
	const linked = linkManagedTestSystem(`bss marker: word
local function make(x)
	${mix}
	local table = {}
	return "part:" .. x, table
end
local function relay(x)
	${mix}
	return make(x)
end
*marker = 901
local saved = *marker
local string, table = relay(7)
return saved, string, table`, 3);
	const { layout, symbols } = linked;
	const index = symbols.metadata.functionIds.indexOf('module:main/entry/local:make');
	const caller = symbols.metadata.functionIds.indexOf('module:main/entry');
	assert.equal(symbols.metadata.softwareFramesByFunction[index]?.entry, true);
	const { codeAddress, codeByteCount } = layout.functions[index];
	const sites = new Map<number, number>();
	for (let pc = codeAddress; pc < codeAddress + codeByteCount;) {
		const row = decodeBlua32InstructionAtPc(layout.textBytes, layout.header.textAddress, pc);
		assert.notEqual(row.op, OpCode.CALL);
		assert.notEqual(row.op, OpCode.RET);
		const next = row.pc + INSTRUCTION_BYTES;
		if (row.op === OpCode.SVC) sites.set(next, row.a);
		pc = next;
	}
	assert.equal(sites.size, 2);
	const romBytes = writeTestBlua32Rom(linked);
	const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
		cpuExecutionBackend: CpuExecutionBackend.Interpreter },
	{ sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
	runtime.boot();
	const { cpu, scheduler, memory } = runtime.machine;
	const folder = mkdtempSync(join(tmpdir(), 'bmsx-software-svc-window-'));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	const rom = join(folder, 'system.rom'), trace = join(folder, 'trace'), state = join(folder, 'state');
	writeFileSync(rom, romBytes);
	const commands: string[] = [], rows: string[] = [], entered = new Set<number>();
	let firstTrap = -1;
	for (let grant = 0; grant < 8192; ++grant) {
		const before = cpu.readFramePc(cpu.getFrameDepth() - 1);
		const budget = before >= codeAddress && before < codeAddress + codeByteCount ? 1 : 31;
		const result = scheduler.runCpuSlice(0, budget, undefined, CpuRunKind.Scheduled);
		commands.push(`E ${budget}`);
		rows.push(`${result} ${budget - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		if (result === RunResult.Halted) break;
		if (!cpu.fixedInterruptActive() || cpu.readCauseWord() !== CPU_CAUSE_CODE_SYSCALL) continue;
		const pc = cpu.readEpcWord(), logical = sites.get(pc);
		if (logical === undefined || entered.has(pc)) continue;
		entered.add(pc);
		const stopped = memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS);
		const frame = cpu.readThreadFrameDepth(stopped) - 1;
		const basis = cpu.readThreadFrameWord(stopped, frame, FrameField.RegisterBase) & FRAME_WINDOW_MASK;
		assert.ok(basis > 0);
		assert.equal(cpu.readThreadFrameWord(stopped, frame, FrameField.Function), layout.functions[caller].address);
		assert.equal(cpu.readFrameRegister(cpu.getFrameDepth() - 1, 1), valueInteger(basis + logical));
		if (firstTrap < 0) {
			firstTrap = commands.length;
			writeFileSync(state, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
		}
	}
	assert.deepEqual(entered, new Set(sites.keys()));
	const values = runtime.readCompletionValues();
	assert.equal(values.length, 3);
	assert.equal(values[0], valueInteger(901));
	assert.equal(valueTag(values[1]), ValueTag.String);
	assert.equal(cpu.stringPool.bytes(valuePayload(values[1])), 'part:2557');
	assert.equal(valueTag(values[2]), ValueTag.Table);
	commands.push('c');
	rows.push([values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	for (const [script, expected] of [[commands, rows], [['X', ...commands.slice(firstTrap)], rows.slice(firstTrap)]] as const) {
		writeFileSync(trace, script.join('\n'));
		assert.deepEqual(execFileSync(native, [rom, trace, state], { encoding: 'utf8' }).trim().split('\n'), expected);
	}
});
