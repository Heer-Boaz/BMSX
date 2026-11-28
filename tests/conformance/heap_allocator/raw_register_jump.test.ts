import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { CompiledBlockExit, CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { MAPPED_PAGE_BYTE_MASK } from '../../../machine/ts/machine/memory/mapped_page';
import { valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { COP0_BAD_ADDRESS, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_RESET_BANK_ADDRESS } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

test('WIDE JAL reaches a sibling ROM body and writes the complete successor into the active window', t => {
	const text = new Uint8Array(6 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.WIDE, 1, 0, 0);
	writeInstruction(text, 1, OpCode.JAL, 0, 0, 1); // r64 = continuation; branch over the caller RET.
	writeInstruction(text, 2, OpCode.RET, 64 & 63, 2, 0, 64);
	writeInstruction(text, 3, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 4, OpCode.K1, 1, 0, 0);
	writeInstruction(text, 5, OpCode.JREG, 0, 0, 0, 64);
	const linked = linkRawTestSystemBlua32({ text, verifiedControlFlow: true, functions: [
		{ firstWord: 0, wordCount: 3, maxStack: 65 }, { firstWord: 3, wordCount: 3, maxStack: 65 },
	] });
	const [caller, worker] = linked.image.functions, successor = caller.codeAddress + 2 * INSTRUCTION_BYTES;
	const boot = (cpuExecutionBackend: CpuExecutionBackend, systemRomBytes = linked.romBytes) => {
		const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC, cpuExecutionBackend }, input);
		runtime.boot();
		return runtime;
	};
	for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
		const { cpu, scheduler } = boot(backend).machine;
		for (let visit = 0; visit < 24; ++visit) {
			cpu.writeFrameExecution(0, SYSTEM_EXECUTION_DOMAIN_ID, caller.address, caller.codeAddress);
			cpu.activeThread.currentFrame!.top = 0;
			assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
			assert.equal(1 - cpu.instructionBudgetRemaining, 2);
			assert.equal(cpu.readFrameFunctionAddress(0), caller.address);
			assert.equal(cpu.readFramePc(0), worker.codeAddress);
			assert.equal(cpu.readFrameRegister(0, 64), valueInteger(successor));
			assert.equal(cpu.getFrameRegisterCount(0), 65);
			assert.equal(scheduler.runCpuSlice(0, 4, undefined, CpuRunKind.Scheduled), RunResult.Yielded);
			assert.equal(cpu.readFramePc(0), successor);
			assert.equal(cpu.readFrameRegister(0, 1), valueInteger(1));
		}
		if (backend === CpuExecutionBackend.JavaScript) {
			const { executionImage } = cpu.activeThread.currentFrame!;
			const page = executionImage.compiledCodeLookup!.find(caller.codeAddress, 0);
			const entry = page?.compiledBlocks?.entries[(caller.codeAddress & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES];
			assert.equal(entry?.terminal.exit, CompiledBlockExit.Continue);
			assert.equal(entry.terminal.nextPc, worker.codeAddress);
		}
	}

	const folder = mkdtempSync(join(tmpdir(), 'bmsx-raw-jal-'));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	const program = join(folder, 'system.rom'), trace = join(folder, 'trace');
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	const replay = () => execFileSync(native, [program, trace, join(folder, 'unused.state')], { encoding: 'utf8' }).trimEnd().split('\n');
	const runtime = boot(CpuExecutionBackend.Interpreter);
	const { scheduler, cpu, memory } = runtime.machine;
	const commands: string[] = [], rows: string[] = [];
	for (const grant of [1, 4, 64]) {
		const result = scheduler.runCpuSlice(0, grant, undefined, CpuRunKind.Scheduled);
		commands.push(`E ${grant}`);
		rows.push(`${result} ${grant - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} -1`);
	}
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger(successor)]);
	commands.push('c');
	rows.push(`1 ${valueTag(valueInteger(successor))} ${successor}`);
	writeFileSync(program, linked.romBytes);
	writeFileSync(trace, commands.join('\n'));
	assert.deepEqual(replay(), rows);

	const invalid = linked.romBytes.slice();
	writeInstruction(invalid, caller.codeAddress / INSTRUCTION_BYTES + 1, OpCode.JAL, 0, 0, 2); // WIDE body.
	assert.throws(() => boot(CpuExecutionBackend.Interpreter, invalid), /JAL target is not an instruction in its image/);
	writeFileSync(program, invalid);
	assert.throws(replay, /JAL target is not an instruction in its image/);
});

for (const unaligned of [false, true]) test(unaligned
	? 'raw register jump reports misalignment before an aliased link write'
	: 'raw register jump across ROM extents survives NMI and cross-core restore', t => {
	const text = new Uint8Array(9 * INSTRUCTION_BYTES);
	writeInstruction(text, 0, OpCode.LOADK, 0, 0, 0);
	writeInstruction(text, 1, OpCode.WIDE, 0, 0, 0);
	writeInstruction(text, 2, OpCode.JREG, 0, 0, 1);
	writeInstruction(text, 3, OpCode.RET, 0, 3, 0);
	writeInstruction(text, 4, OpCode.KSMI, 1, 0, 59);
	writeInstruction(text, 5, OpCode.WIDE, 0, 63, 0);
	writeInstruction(text, 6, OpCode.JREG, 0, 63, 0); // B ignored; this final instruction cannot fall through.
	writeInstruction(text, 7, OpCode.MFC0, 0, COP0_BAD_ADDRESS, 0);
	writeInstruction(text, 8, OpCode.RFE, 0, 0, 0);
	const { romBytes: rom, image } = linkRawTestSystemBlua32({
		text, constants: [integerConstant(0)], verifiedControlFlow: true, irqFunctionIndex: 2, exceptionFunctionIndex: 2,
		functions: [{ firstWord: 0, wordCount: 4, maxStack: 2 }, { firstWord: 4, wordCount: 3, maxStack: 2 },
			{ firstWord: 7, wordCount: 2 }],
	});
	const [issuer, sibling, { codeAddress: vector }] = image.functions;
	const start = issuer.codeAddress;
	const issue = start + INSTRUCTION_BYTES, link = start + 3 * INSTRUCTION_BYTES;
	const target = sibling.codeAddress + (unaligned ? 2 : 0);
	writeLE32(rom, image.header.constantTableAddress + BLUA32_CONSTANT_PAYLOAD_OFFSET, target);
	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const commands: string[] = [], expected: string[] = [];
	function observe(command: string, row: string) {
		commands.push(command);
		expected.push(row);
	}
	function step(op: OpCode, result = RunResult.Yielded, extra = 0) {
		assert.equal(scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Scheduled), result);
		assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[op] + extra);
		observe('E 1', `${result} ${1 - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} -1`);
	}
	function pc(depth: number, address: number) {
		assert.equal(cpu.getFrameDepth(), depth);
		assert.equal(cpu.readFramePc(depth - 1), address);
		observe('P', `${depth} ${address}`);
	}
	function register(frame: number, index: number, word: number) {
		assert.equal(cpu.readFrameRegister(frame, index), valueInteger(word));
		const thread = cpu.activeThread, slot = thread.frameAtDepth(frame).stackBase + index;
		const payload = thread.stackOffset() + slot * 4;
		const tag = thread.stackOffset() + thread.stackRegisters.capacity() * 4 + slot;
		observe(`H ${payload} ${payload + 4}`, String(hashBytes(memory.ramData(), payload, 4)));
		observe(`H ${tag} ${tag + 1}`, String(hashBytes(memory.ramData(), tag, 1)));
	}
	assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
	step(OpCode.LOADK);
	step(OpCode.JREG);
	const checkpoint = captureRuntimeSaveState(runtime);
	if (unaligned) {
		pc(2, vector);
		assert.equal(cpu.readBadAddressWord(), target);
		assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD);
		assert.equal(cpu.readEpcWord(), issue);
		observe('Z', `${CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD} 0 ${issue}`);
		register(0, 0, target); // A and B are the same register. It still contains the unaligned input.
		step(OpCode.MFC0);
		register(1, 0, target); // The handler sees the submitted address.
	} else {
		pc(1, target);
		assert.equal(cpu.readFrameFunctionAddress(0), issuer.address);
		register(0, 0, link);
		const resume = () => {
			cpu.requestNonMaskableInterrupt();
			commands.push('N');
			assert.equal(cpu.enterPendingInterrupt(), true);
			observe('I', '1');
			pc(2, vector);
			assert.equal(cpu.readEpcWord(), target);
			step(OpCode.MFC0);
			step(OpCode.RFE);
			pc(1, target);
			assert.equal(cpu.readFrameFunctionAddress(0), issuer.address, 'neither JREG nor RFE activates a different function');
			register(0, 0, link);
			step(OpCode.KSMI);
			step(OpCode.JREG);
			pc(1, link);
			step(OpCode.RET, RunResult.Halted, 2);
			const values = runtime.readCompletionValues();
			assert.deepEqual(values, [valueInteger(link), valueInteger(59)]);
			observe('c', [values.length, ...values.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
		};
		commands.push('S');
		resume();
		applyRuntimeSaveState(runtime, checkpoint);
		commands.push('U');
		resume();
	}
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-raw-register-jump-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const program = join(dir, 'system.rom'), trace = join(dir, 'trace'), state = join(dir, 'ts-checkpoint');
	writeFileSync(program, rom);
	writeFileSync(state, encodeRuntimeSaveState(checkpoint));
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner', { buildDirectory: join(dir, 'native') });
	function replay(script: string[], rows: string[]) {
		writeFileSync(trace, script.join('\n'));
		assert.deepEqual(execFileSync(native, [program, trace, state], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
	}
	replay(commands, expected);
	replay(['X', ...commands.slice(2)], expected.slice(2));

	if (unaligned) return;
	// The full decoded C field is the mode, not just the instruction body's low bits.
	for (const [wideC, c, extension] of [[0, 2, 0], [0, 1, 1], [1, 1, 0]]) {
		const invalid = rom.slice(), index = issue / INSTRUCTION_BYTES;
		writeInstruction(invalid, index, OpCode.WIDE, 0, 0, wideC);
		writeInstruction(invalid, index + 1, OpCode.JREG, 0, 0, c, extension);
		assert.throws(() => new Runtime({
			systemRomBytes: invalid, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC,
		}, input).boot(), /register jump has an invalid mode/);
		writeFileSync(program, invalid);
		assert.throws(() => execFileSync(native, [program, trace, state], { stdio: 'pipe', encoding: 'utf8' }),
			/register jump has an invalid mode/);
	}
});
