import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { COP0_BAD_ADDRESS, CPU_CAUSE_CODE_ADDRESS_ERROR_LOAD } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_RESET_BANK_ADDRESS } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { integerConstant } from '../../../toolchain/ts/lua/number';
import { linkRawTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

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
