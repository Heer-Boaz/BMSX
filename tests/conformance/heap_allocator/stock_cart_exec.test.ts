import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CPU, CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../../machine/ts/machine/cpu/thread_record';
import { asInteger, valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { COP0_EXEC } from '../../../machine/ts/spec/blua32/cop0';
import { EXECUTION_IMAGE_BINDING_SIZE, GLOBAL_BANK_OFFSET, GlobalBankField, executionDomainBit, executionImageBindingOffset, SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { INSTRUCTION_BYTES, instructionLowB, instructionOpcode, MAX_LOW_OPERAND, MAX_OPERAND_BITS, writeInstruction } from '../../../machine/ts/spec/blua32/instruction_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_CART_SELECT, IO_IRQ_MASK, IO_SYS_CONTROL, IO_SYS_STATUS, SYS_CONTROL_RESET, SYS_STATUS_SUPERVISOR_ACTIVE } from '../../../machine/ts/spec/bmsx/io';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_FUNCTION_ALIGNMENT, BLUA32_FUNCTION_MAX_STACK_OFFSET, Blua32ConstantTag } from '../../../machine/ts/spec/blua32/image_format';
import { CART_ROM_BASE, CPU_RESET_BANK_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image, rewriteResolvedABx } from '../../../toolchain/ts/rompack/blua32_linker';
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
namespace_preserved = 51
for index = 1, 256 do setglobal('dynamic global ' .. index, index) end
report[2] = namespace_preserved
setglobal('namespace_preserved', 89)
report[3] = namespace_preserved
namespace_preserved = 144
report[4] = getglobal('namespace_preserved')
report[5] = getglobal('dynamic global 256')
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
				const systemEnd = RAM_BASE + cpu.heapAllocator.floorOffset(runtime.machine.executionAddressSpace.resolveSystemDomain().staticEnd);
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
			const finishReset = (running: ReturnType<typeof boot>) => {
				const { cpu, memory } = running.runtime.machine;
				assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS, 'the RESET request has entered immutable System code');
				for (let grant = 0; grant < 2048 && cpu.rootThread.address === CPU_RESET_BANK_ADDRESS; ++grant) running.pulse(2048);
				assert.notEqual(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS, 'firmware admitted its replacement context');
				assert.equal(memory.ramBusEnd(), running.systemEnd, 'firmware restored the System aperture');
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
			assert.deepEqual([2, 3, 4, 5].map(slot => memory.readMappedU32LE(bssAddress + 4 * slot)), [51, 89, 144, 256]);
			const bank = cpu.heapAllocator.managementOffset() + GLOBAL_BANK_OFFSET;
			const bankCapacity = memory.readRamRecordWord(bank + GlobalBankField.Capacity);
			assert.ok(bankCapacity >= 256);
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
			commands.push('E 1', `H ${bssAddress - RAM_BASE} ${bssAddress - RAM_BASE + 24}`, `H ${installed} ${installed + EXECUTION_IMAGE_BINDING_SIZE}`);
			expected.push([result, 1 - cpu.instructionBudgetRemaining, +cpu.heapServiceActive(),
				memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' '));
			expected.push(String(hashBytes(memory.ramData(), bssAddress - RAM_BASE, 24)),
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
			const prepared = captureRuntimeSaveState(preTransfer.runtime);
			writeFileSync(seed, encodeRuntimeSaveState(prepared));

			// From the same admitted System frame, try constructing a callable
			// from a valid record on the socket that has *not* been prepared.
			// This exercises CLOSURE's lazy image lookup, not the EXEC check.
			const probeRom = new Uint8Array(system);
			const actualFrame = unentered.cpu.getFrameDepth() - 1;
			const word = unentered.cpu.readFramePc(actualFrame) / INSTRUCTION_BYTES;
			writeInstruction(probeRom, word, OpCode.WIDE, 0, 0, 0);
			writeInstruction(probeRom, word + 1, OpCode.CLOSURE, 0, 0, 0);
			rewriteResolvedABx(probeRom, word + 1, OpCode.CLOSURE, slot0.startupFunctionAddress / BLUA32_FUNCTION_ALIGNMENT);
			const probe = new Runtime({ systemRomBytes: probeRom, cartridgeSlots: cartridgeSlots(other, selected),
				machineModel: PSX_MACHINE_SPEC }, {
				sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
			});
			probe.boot();
			applyRuntimeSaveState(probe, prepared);
			const attempted = probe.machine;
			attempted.memory.writeMappedWord(IO_CART_SELECT, 0);
			const absent = executionImageBindingOffset(attempted.cpu.heapAllocator.managementOffset(), 0);
			const empty = new Uint8Array(EXECUTION_IMAGE_BINDING_SIZE);
			assert.deepEqual(attempted.memory.ramData().slice(absent, absent + EXECUTION_IMAGE_BINDING_SIZE), empty);
			const physicalBytes = attempted.cpu.heapAllocator.occupiedBytes();
			const attemptedResult = attempted.scheduler.runCpuSlice(0, 1, 0, CpuRunKind.Scheduled);
			assert.equal(attempted.cpu.luaHeap.usedBytes(), preparedCharge, 'a Function lookup does not initialize an unprepared cartridge');
			assert.equal(attempted.cpu.heapAllocator.occupiedBytes(), physicalBytes);
			assert.equal(attemptedResult, RunResult.Halted);
			assert.equal(attempted.cpu.captureRuntimeState().hardHalted, true);
			assert.equal(attempted.cpu.isExecutionDomainResident(0), false);
			assert.deepEqual(attempted.memory.ramData().slice(absent, absent + EXECUTION_IMAGE_BINDING_SIZE), empty);
			const probeSystem = join(output, 'unprepared-function.rom');
			const probeTrace = join(output, 'unprepared-function.trace');
			writeFileSync(probeSystem, probeRom);
			writeFileSync(probeTrace, ['X', `O ${IO_CART_SELECT} 0`, 'L 1', 'F', `H ${absent} ${absent + EXECUTION_IMAGE_BINDING_SIZE}`].join('\n'));
			const attemptedRows = execFileSync(native, [probeSystem, probeTrace, seed, otherPath, selectedPath], { encoding: 'utf8' });
			assert.deepEqual(attemptedRows.trimEnd().split('\n'), [
				[attemptedResult, 1 - attempted.cpu.instructionBudgetRemaining, 0, attempted.cpu.gc.fullEpochs(),
					attempted.cpu.gc.phase(), preparedCharge].join(' '),
				'1', String(hashBytes(empty, 0, empty.length)),
			]);

			unentered.memory.writeMappedWord(IO_SYS_CONTROL, SYS_CONTROL_RESET);
			preTransfer.commands.length = preTransfer.expected.length = 0;
			preTransfer.commands.push('X', `O ${IO_SYS_CONTROL} ${SYS_CONTROL_RESET}`);
			preTransfer.pulse(1);
			assert.equal(unentered.systemController.hasResetRequest(), false);
			assert.equal(unentered.memory.ramBusEnd(), floor, 'hardware RESET does not change the aperture');
			finishReset(preTransfer);
			assert.deepEqual(unentered.memory.ramData().slice(installed, installed + EXECUTION_IMAGE_BINDING_SIZE),
				empty, 'firmware retires RAM backing without a host cartridge view');
			preTransfer.commands.push(`H ${installed} ${installed + EXECUTION_IMAGE_BINDING_SIZE}`);
			preTransfer.expected.push(String(hashBytes(empty, 0, empty.length)));
			compare('reset-before-exec.trace', preTransfer.commands, preTransfer.expected, seed, otherPath, selectedPath);

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
			assert.equal(rejectedMachine.memory.ramBusEnd(), floor);
			finishReset(fault);
			const depth = rejectedMachine.cpu.getFrameDepth();
			fault.commands.push('F', 'P');
			fault.expected.push('0', `${depth} ${rejectedMachine.cpu.readFramePc(depth - 1)}`);
			compare('rejected.trace', fault.commands, fault.expected, unused, rejectedPath);

			// The same executable can legally request a larger entry window.
			// Keep the original reset and malformed-binding paths unchanged.
			const entrySlots = 4097;
			const startup = readLE32(selected, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET);
			const wide = selected.slice(), widePath = join(output, 'wide-entry.rom');
			writeLE32(wide, startup - CART_ROM_BASE + BLUA32_FUNCTION_MAX_STACK_OFFSET, entrySlots);
			writeFileSync(widePath, wide);
			let wideStopped = false;
			const { runtime: wideRuntime } = boot(cartridgeSlots(other, wide), () => wideStopped, () => wideStopped = true);
			const wideMachine = wideRuntime.machine;
			const capacityAddress = wideMachine.cpu.rootThread.address + ThreadField.StackCapacity;
			assert.equal(wideMachine.memory.readRamRecordWord(capacityAddress), 8192,
				'the BIOS has already reserved the larger selected-socket window');
			const wideSeed = join(output, 'wide-pre-exec.state');
			writeFileSync(wideSeed, encodeRuntimeSaveState(captureRuntimeSaveState(wideRuntime)));
			const occupied = wideMachine.cpu.heapAllocator.occupiedBytes();
			const chargedBytes = wideMachine.cpu.luaHeap.usedBytes();
			const entered = wideMachine.scheduler.runCpuSlice(0, 1, 0, CpuRunKind.Scheduled);
			const paid = 1 - wideMachine.cpu.instructionBudgetRemaining;
			assert.equal(entered, RunResult.Yielded);
			assert.equal(paid, BASE_CYCLES[OpCode.MTC0]);
			assert.equal(wideMachine.cpu.activeCartridgeSlot(), 1);
			assert.equal(wideMachine.cpu.rootThread.frameAtDepth(0).stackCapacity, entrySlots);
			assert.equal(wideMachine.cpu.heapServiceActive(), false);
			assert.equal(wideMachine.cpu.heapAllocator.occupiedBytes(), occupied);
			assert.equal(wideMachine.cpu.luaHeap.usedBytes(), chargedBytes);
			compare('prepared-frame-exec.trace', ['X', 'J 1 1'], [
				`${entered} ${paid} 0 0 ${occupied} ${chargedBytes}`,
			], wideSeed, otherPath, widePath);
			const wideLaunch = boot(cartridgeSlots(other, wide), cpu =>
				cpu.activeCartridgeSlot() === 1 && cpu.isHaltedUntilIrq());
			compare('wide-stock-launch.trace', wideLaunch.commands, wideLaunch.expected, unused, otherPath, widePath);

			// Supply the same larger Function to the transfer without having
			// prepared its backing. Both CPU cores must refuse, not allocate.
			const missingSpace = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(other, wide),
				machineModel: PSX_MACHINE_SPEC }, {
				sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
			});
			missingSpace.boot();
			applyRuntimeSaveState(missingSpace, prepared);
			const without = missingSpace.machine;
			assert.ok(without.memory.readRamRecordWord(without.cpu.rootThread.address + ThreadField.StackCapacity) < entrySlots);
			const unpreparedPhysical = without.cpu.heapAllocator.occupiedBytes();
			const refused = without.scheduler.runCpuSlice(0, 1, 0, CpuRunKind.Scheduled);
			assert.equal(refused, RunResult.Halted);
			assert.equal(without.cpu.captureRuntimeState().hardHalted, true);
			assert.equal(without.cpu.heapAllocator.occupiedBytes(), unpreparedPhysical);
			assert.equal(without.cpu.luaHeap.usedBytes(), preparedCharge);
			compare('unprepared-frame-exec.trace', ['X', 'J 1 1', 'F'], [
				`${refused} ${1 - without.cpu.instructionBudgetRemaining} 0 0 ${unpreparedPhysical} ${preparedCharge}`, '1',
			], seed, otherPath, widePath);


		} catch (err) {
			failed = true;
			throw err;
		}
	});
	if (failed) t.diagnostic(`Stock launch artifacts retained in ${dir}`);
	else rmSync(dir, { recursive: true, force: true });
});
