import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CPU, CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { asInteger, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { COP0_EXEC } from '../../../machine/ts/spec/blua32/cop0';
import { EXECUTION_IMAGE_BINDING_SIZE, executionDomainBit, executionImageBindingOffset, SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { instructionLowB, instructionOpcode, MAX_LOW_OPERAND, MAX_OPERAND_BITS } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_IRQ_MASK, IO_SYS_CONTROL, IO_SYS_STATUS, SYS_CONTROL_RESET, SYS_STATUS_SUPERVISOR_ACTIVE } from '../../../machine/ts/spec/bmsx/io';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, Blua32ConstantTag } from '../../../machine/ts/spec/blua32/image_format';
import { CART_ROM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

test('stock firmware binds the selected socket before EXEC; RESET discards an unentered image', async t => {
	mkdirSync('tmp', { recursive: true });
	const dir = mkdtempSync(join('tmp', 'stock-cart-exec-'));
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	let failed = false;
	for (const optLevel of [0, 3] as const) await t.test(`O${optLevel}`, () => {
		try {
			const output = join(dir, `O${optLevel}`);
			execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
				'--mode', 'bios', '-respath', 'machine/bios/res', '--debug', `-O${optLevel}`,
				'--output-dir', output, '--store-dir', join(dir, 'store')], { stdio: 'inherit' });
			const rom = join(output, 'system', 'bmsx-bios.debug.rom');
			const system = readFileSync(rom);
			const payload = 'socket one cartridge literal';
			const source = `bss report: word[0x2000]
selected_payload = '${payload}'
report[0] = 37
report[1] = #selected_payload
mem[${IO_IRQ_MASK}] = 0
halt_until_irq
`;
			const cart = (entrySource: string, path: string) => {
				const program = compileLuaChunkToProgram(parseLuaChunk(entrySource, path), [], { entrySource, optLevel });
				return linkCartBlua32Image(readBlua32BiosImports(system), encodeCompiledProgramObject(program), program.metadata,
					CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
			};
			const slot0 = cart(source.replace('0x2000', '0x4000').replace(payload, 'unselected cartridge'), 'nonbootable-slot0.lua');
			const slot1 = cart(source, 'selected-slot1.lua');
			const other = writeTestBlua32Rom(slot0), selected = writeTestBlua32Rom(slot1);
			// Socket 0 has a distinct operand record but no startup vector.
			writeLE32(other, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET, 0);
			const otherPath = join(output, 'slot0.rom'), selectedPath = join(output, 'slot1.rom');
			writeFileSync(otherPath, other);
			writeFileSync(selectedPath, selected);
			const boot = (slots: ReturnType<typeof cartridgeSlots>, done: (cpu: CPU, runtime: Runtime) => boolean,
				beforeTransfer?: (runtime: Runtime) => boolean) => {
				const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: slots, machineModel: PSX_MACHINE_SPEC }, {
					sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
				});
				runtime.boot();
				const { cpu, scheduler, gxGpu } = runtime.machine;
				if (beforeTransfer) cpu.setExecutionHook((_domain, pc) => {
					const word = readLE32(system, pc);
					return instructionOpcode(word) === OpCode.MTC0 && instructionLowB(word) === COP0_EXEC
						&& asInteger(cpu.activeThread.currentFrame!.registers.get((word >>> (2 * MAX_OPERAND_BITS)) & MAX_LOW_OPERAND)) >= CART_ROM_BASE
						&& beforeTransfer(runtime);
				}, executionDomainBit(SYSTEM_EXECUTION_DOMAIN_ID), 0);
				const frames = runtime.frameScheduler, commands: string[] = [], expected: string[] = [];
				const systemEnd = runtime.machine.memory.ramBusEnd();
				const pulse = (grant: number) => {
					if (gxGpu.backendCommandDrainPending()) {
						gxGpu.retireExecutedCommands();
						commands.push('>');
					}
					const cycles = scheduler.nowCycles, tick = frames.lastTickSequence;
					const complete = frames.runCyclesToNextLogicalTick(grant);
					commands.push(`p ${grant}`);
					expected.push([+complete, scheduler.nowCycles - cycles, frames.lastTickSequence - tick,
						+cpu.heapServiceActive(), +cpu.isHaltedUntilIrq()].join(' '));
				};
				for (let grant = 0; grant < 2048 && !done(cpu, runtime); ++grant) pulse(65536);
				assert.ok(done(cpu, runtime), 'the real System startup reached the requested machine boundary');
				if (beforeTransfer) cpu.setExecutionHook(null, 0, 0);
				return { runtime, commands, expected, pulse, systemEnd };
			};
			const compare = (traceName: string, commands: string[], expected: string[], seed: string, ...carts: string[]) => {
				const trace = join(output, traceName);
				writeFileSync(trace, commands.join('\n'));
				const actual = execFileSync(native, [rom, trace, seed, ...carts], { encoding: 'utf8' }).trimEnd().split('\n');
				const mismatch = actual.findIndex((row, i) => row !== expected[i]);
				assert.equal(mismatch, -1, `at ${mismatch}: native=${actual[mismatch]}, TypeScript=${expected[mismatch]}`);
				assert.equal(actual.length, expected.length);
			};
			let installed = 0, beforeExec: Uint8Array | undefined;
			const observeBinding = ({ machine: { cpu, memory } }: Runtime) => {
				installed = executionImageBindingOffset(cpu.heapAllocator.managementOffset(), 1);
				assert.equal(cpu.captureRuntimeState().executionResidencyMask & executionDomainBit(1), 0,
					'the slot has no host execution image before the transfer');
				assert.ok(memory.readRamRecordWord(installed) > RAM_BASE);
				assert.ok(memory.readRamRecordWord(installed + 4) > 0);
				beforeExec = memory.ramData().slice(installed, installed + EXECUTION_IMAGE_BINDING_SIZE);
			};
			const { runtime, commands, expected } = boot(cartridgeSlots(other, selected), cpu =>
				cpu.activeCartridgeSlot() === 1 && cpu.isHaltedUntilIrq(), live => { observeBinding(live); return false; });
			const { cpu, memory, scheduler } = runtime.machine;
			const { bssAddress, bssByteCount } = slot1.layout.header;
			assert.equal(memory.readMappedU32LE(bssAddress), 37);
			assert.equal(memory.readMappedU32LE(bssAddress + 4), payload.length);
			assert.ok(beforeExec !== undefined);
			assert.deepEqual(memory.ramData().slice(installed, installed + EXECUTION_IMAGE_BINDING_SIZE), beforeExec,
				'EXEC consumes the installed binding without replacing it');
			const constant = cpu.getGlobalByKey(cpu.stringPool.find('selected_payload')!);
			assert.equal(valueTag(constant), ValueTag.String);
			assert.equal(valuePayload(constant) >>> 31, 1, 'the executed literal belongs to socket 1');
			const floor = RAM_BASE + cpu.heapAllocator.floorOffset(bssAddress + bssByteCount);
			assert.ok(cpu.heapAllocator.floorOffset(slot0.layout.header.bssAddress + slot0.layout.header.bssByteCount) > floor - RAM_BASE);
			assert.equal(memory.ramBusEnd(), floor, 'the ordinary mapped selected socket supplies the exact aperture');
			const result = scheduler.runCpuSlice(0, 1, 0, CpuRunKind.Scheduled);
			commands.push('E 1', `H ${bssAddress - RAM_BASE} ${bssAddress - RAM_BASE + 8}`, `H ${installed} ${installed + EXECUTION_IMAGE_BINDING_SIZE}`);
			expected.push([result, 1 - cpu.instructionBudgetRemaining, +cpu.heapServiceActive(),
				memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' '));
			expected.push(String(hashBytes(memory.ramData(), bssAddress - RAM_BASE, 8)),
				String(hashBytes(memory.ramData(), installed, EXECUTION_IMAGE_BINDING_SIZE)));
			const unused = join(output, 'unused');
			compare('launch.trace', commands, expected, unused, otherPath, selectedPath);

			let stopped = false;
			const preTransfer = boot(cartridgeSlots(other, selected), () => stopped, live => {
				observeBinding(live);
				stopped = true;
				return true;
			});
			const unentered = preTransfer.runtime.machine;
			assert.equal(unentered.cpu.systemResetInhibited(), false);
			assert.equal(unentered.cpu.activeCartridgeSlot(), SYSTEM_EXECUTION_DOMAIN_ID);
			const preparedCharge = unentered.cpu.luaHeap.usedBytes();
			const operandBytes = unentered.memory.readRamRecordWord(installed + 4);
			const seed = join(output, 'pre-exec.state');
			writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(preTransfer.runtime)));
			unentered.memory.writeMappedWord(IO_SYS_CONTROL, SYS_CONTROL_RESET);
			const beforeResetCycles = unentered.scheduler.nowCycles, beforeResetTick = preTransfer.runtime.frameScheduler.lastTickSequence;
			const complete = preTransfer.runtime.frameScheduler.runCyclesToNextLogicalTick(1);
			assert.equal(unentered.systemController.hasResetRequest(), false);
			assert.equal(unentered.memory.ramBusEnd(), preTransfer.systemEnd);
			assert.deepEqual(unentered.memory.ramData().slice(installed, installed + EXECUTION_IMAGE_BINDING_SIZE),
				new Uint8Array(EXECUTION_IMAGE_BINDING_SIZE), 'reset retires RAM backing without a host cartridge view');
			compare('reset-before-exec.trace',
				['X', `O ${IO_SYS_CONTROL} ${SYS_CONTROL_RESET}`, 'p 1', `H ${installed} ${installed + EXECUTION_IMAGE_BINDING_SIZE}`],
				[[+complete, unentered.scheduler.nowCycles - beforeResetCycles,
					preTransfer.runtime.frameScheduler.lastTickSequence - beforeResetTick, +unentered.cpu.heapServiceActive(),
					+unentered.cpu.isHaltedUntilIrq()].join(' '),
					String(hashBytes(unentered.memory.ramData(), installed, EXECUTION_IMAGE_BINDING_SIZE))],
				seed, otherPath, selectedPath);

			// Keep the table sizes, symbol names and String directory intact.
			// Only the literal's operand points at bytes that aren't a String:
			// this is reached after the prospective binding block is reserved.
			const badLiteral = selected.slice();
			const constantTable = slot1.layout.header.constantTableAddress - CART_ROM_BASE;
			let malformedRecord = -1;
			for (let i = 0; i < slot1.layout.header.constantCount; ++i) {
				const record = constantTable + i * BLUA32_CONSTANT_RECORD_SIZE;
				if (readLE32(badLiteral, record) === Blua32ConstantTag.String) { malformedRecord = record; break; }
			}
			assert.notEqual(malformedRecord, -1);
			writeLE32(badLiteral, malformedRecord + BLUA32_CONSTANT_PAYLOAD_OFFSET, CART_ROM_BASE);
			const badLiteralPath = join(output, 'bad-literal.rom');
			writeFileSync(badLiteralPath, badLiteral);
			const malformed = boot(cartridgeSlots(other, badLiteral), (_cpu, live) =>
				(live.machine.memory.readMappedU32LE(IO_SYS_STATUS) & SYS_STATUS_SUPERVISOR_ACTIVE) !== 0);
			const malformedMachine = malformed.runtime.machine;
			assert.equal(malformedMachine.cpu.activeCartridgeSlot(), SYSTEM_EXECUTION_DOMAIN_ID);
			assert.equal(malformedMachine.cpu.luaHeap.usedBytes(), preparedCharge - operandBytes,
				'failure releases the unpublished block and its charge, without undoing namespace effects');
			assert.deepEqual(malformedMachine.memory.ramData().slice(installed, installed + EXECUTION_IMAGE_BINDING_SIZE),
				new Uint8Array(EXECUTION_IMAGE_BINDING_SIZE));
			const charged = malformedMachine.cpu.luaHeap.occupiedOffset;
			malformed.commands.push(`H ${installed} ${installed + EXECUTION_IMAGE_BINDING_SIZE}`, `H ${charged} ${charged + 4}`);
			malformed.expected.push(String(hashBytes(malformedMachine.memory.ramData(), installed, EXECUTION_IMAGE_BINDING_SIZE)),
				String(hashBytes(malformedMachine.memory.ramData(), charged, 4)));
			compare('bad-literal.trace', malformed.commands, malformed.expected, unused, otherPath, badLiteralPath);

			// A valid section header with an invalid startup operand reaches
			// EXEC after admission, then hard-halts. RESET must still be allowed.
			const rejected = selected.slice();
			writeLE32(rejected, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET, slot1.startupFunctionAddress + 4);
			const rejectedPath = join(output, 'rejected.rom');
			writeFileSync(rejectedPath, rejected);
			const fault = boot(cartridgeSlots(rejected), cpu => cpu.captureRuntimeState().hardHalted);
			const rejectedMachine = fault.runtime.machine;
			assert.ok(fault.systemEnd < floor);
			assert.equal(rejectedMachine.memory.ramBusEnd(), floor);
			assert.equal(rejectedMachine.cpu.activeCartridgeSlot(), SYSTEM_EXECUTION_DOMAIN_ID);
			assert.equal(rejectedMachine.memory.readMappedU32LE(bssAddress), 0, 'the rejected cart did not run');
			assert.equal(rejectedMachine.cpu.systemResetInhibited(), false, 'releasing reset is separate from the transfer succeeding');
			fault.commands.push('F', `O ${IO_SYS_CONTROL} ${SYS_CONTROL_RESET}`);
			fault.expected.push('1');
			rejectedMachine.memory.writeMappedWord(IO_SYS_CONTROL, SYS_CONTROL_RESET);
			fault.pulse(1);
			assert.equal(rejectedMachine.systemController.hasResetRequest(), false);
			assert.equal(rejectedMachine.cpu.captureRuntimeState().hardHalted, false);
			assert.equal(rejectedMachine.memory.ramBusEnd(), fault.systemEnd, 'the existing live native reset returns to the System aperture');
			const depth = rejectedMachine.cpu.getFrameDepth();
			fault.commands.push('F', 'P');
			fault.expected.push('0', `${depth} ${rejectedMachine.cpu.readFramePc(depth - 1)}`);
			compare('rejected.trace', fault.commands, fault.expected, unused, rejectedPath);
		} catch (err) {
			failed = true;
			throw err;
		}
	});
	if (failed) t.diagnostic(`Stock launch artifacts retained in ${dir}`);
	else rmSync(dir, { recursive: true, force: true });
});
