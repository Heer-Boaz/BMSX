import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../../machine/ts/machine/cpu/compiled_block';
import { CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_IRQ_MASK } from '../../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram } from '../../../toolchain/ts/lua/compiler';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkTestCartBlua32, writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { linkManagedTestSystem, TEST_CART_TRANSFER_SOURCE } from '../../helpers/managed_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

// This ABI uses public RAM descriptors (code, environment), a software link
// save slot, and independent count and result registers. No Function or
// Closure records describe the target, environment or saved continuation.
const source = `bss descriptors: word[6]
bss saved_link: word
bss report: word[6]
local leaf_pc, pipeline_pc, target, link = 0, 0, 0, 0
local environment, argc, x = 0, 0, 0
local count, result, extra = 0, 0, 0
local selected, slot = 0, 0
blua32.jump_link(leaf_pc, 'past_leaf')
::leaf::
count = argc
result = environment + x
if argc == 2 then extra = environment - x end
report[0] = 1
blua32.jump_register(link, 'returned_from_leaf')
::past_leaf::
blua32.jump_link(pipeline_pc, 'start')
::pipeline::
*saved_link = link
slot = (selected + 1) * 2
target, environment = descriptors[slot], descriptors[slot + 1]
blua32.jump_link(link, 'enter_leaf')
::returned_from_leaf::
result = result + descriptors[1]
link = *saved_link
blua32.jump_register(link, 'returned_from_pipeline')
::enter_leaf::
blua32.jump_register(target, 'leaf')
::start::
descriptors[0], descriptors[1] = pipeline_pc, 7
descriptors[2], descriptors[3] = leaf_pc, 100
descriptors[4], descriptors[5] = leaf_pc, 200
mem[${IO_IRQ_MASK}] = 0
::call::
argc, x, target = selected + 1, selected + 11, descriptors[0]
blua32.jump_link(link, 'enter_pipeline')
::returned_from_pipeline::
if selected == 0 then
	report[1], report[2] = count, result
	selected = 1
	goto call
end
report[3], report[4], report[5] = count, result, extra
report[0] = 2
halt_until_irq
goto call
::enter_pipeline::
blua32.jump_register(target, 'pipeline')`;

test('cartridge code can call RAM-selected code with its own environment and result ABI', t => {
	const system = linkManagedTestSystem(TEST_CART_TRANSFER_SOURCE, 3);
	const systemRomBytes = writeTestBlua32Rom(system);
	const program = compileLuaChunkToProgram(parseLuaChunk(source, 'software-abi.lua'), [], { entrySource: source, optLevel: 3 });
	const { cartImage, cartSymbols, cartRomBytes } = linkTestCartBlua32(system.biosImports, program);
	const entry = cartImage.functions[cartSymbols.metadata.functionIds.findIndex(id => id.endsWith('/entry'))];
	const report = cartSymbols.metadata.staticScopes.declarations.find(item => item.name === 'report')!.address!;
	const savedLink = cartSymbols.metadata.staticScopes.declarations.find(item => item.name === 'saved_link')!.address!;
	let jumps = 0;
	for (let pc = entry.codeAddress; pc < entry.codeAddress + entry.codeByteCount;) {
		const row = decodeBlua32InstructionAtPc(cartImage.textBytes, cartImage.header.textAddress, pc);
		assert.notEqual(row.op, OpCode.CALL);
		assert.notEqual(row.op, OpCode.RET);
		assert.notEqual(row.op, OpCode.SVC);
		if (row.op === OpCode.JREG) ++jumps;
		pc = row.pc + INSTRUCTION_BYTES;
	}
	assert.equal(jumps, 4);
	const runtime = new Runtime({ systemRomBytes, cartridgeSlots: cartridgeSlots(cartRomBytes), machineModel: PSX_MACHINE_SPEC,
		cpuExecutionBackend: CpuExecutionBackend.Interpreter },
	{ sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} });
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	const folder = mkdtempSync(join(tmpdir(), 'bmsx-software-abi-'));
	t.after(() => rmSync(folder, { recursive: true, force: true }));
	const rom = join(folder, 'system.rom'), cartridge = join(folder, 'cart.rom'), trace = join(folder, 'trace'), state = join(folder, 'checkpoint');
	writeFileSync(rom, systemRomBytes);
	writeFileSync(cartridge, cartRomBytes);
	const commands: string[] = [], observations: string[] = [];
	let checkpoint = -1, frame = -1, depth = -1;
	for (let slice = 0; slice < 8192; ++slice) {
		const budget = cpu.activeCartridgeSlot() < 0 ? 256 : 1;
		const outcome = scheduler.runCpuSlice(0, budget, 0, CpuRunKind.Scheduled);
		commands.push(`E ${budget}`);
		observations.push(`${outcome} ${budget - cpu.instructionBudgetRemaining} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
		if (cpu.activeCartridgeSlot() < 0) continue;
		const currentDepth = cpu.getFrameDepth();
		const currentFrame = cpu.readThreadFrameAddress(cpu.activeThread.address, currentDepth - 1);
		if (frame === -1) { depth = currentDepth; frame = currentFrame; }
		assert.equal(currentDepth, depth);
		assert.equal(currentFrame, frame);
		assert.equal(cpu.readFrameFunctionAddress(depth - 1), entry.address);
		assert.ok(cpu.isUserMode());
		const phase = memory.readMappedU32LE(report);
		if (phase === 1 && checkpoint < 0) {
			const link = memory.readMappedU32LE(savedLink);
			assert.ok(link > entry.codeAddress && link < entry.codeAddress + entry.codeByteCount);
			checkpoint = commands.length;
			writeFileSync(state, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			commands.push('P');
			observations.push(`${depth} ${cpu.readFramePc(depth - 1)}`);
		}
		if (phase === 2 && cpu.isHaltedUntilIrq()) break;
	}
	assert.ok(checkpoint >= 0, 'grant ended in the leaf while the caller link lived only in software');
	assert.ok(cpu.isHaltedUntilIrq());
	for (const [index, expected] of [2, 1, 118, 2, 219, 188].entries()) {
		const address = report + 4 * index;
		assert.equal(memory.readMappedU32LE(address), expected);
		commands.push(`M ${address}`);
		observations.push(`${expected} 0`);
	}
	const native = nativeConformanceRunner('bmsx_machine_conformance_runner');
	for (const [script, rows] of [[commands, observations], [['X', ...commands.slice(checkpoint)], observations.slice(checkpoint)]] as const) {
		writeFileSync(trace, script.join('\n'));
		assert.deepEqual(execFileSync(native, [rom, trace, state, cartridge], { encoding: 'utf8' }).trim().split('\n'), rows);
	}
});
