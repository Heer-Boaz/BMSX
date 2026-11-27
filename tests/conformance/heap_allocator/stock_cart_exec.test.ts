import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CPU, CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { IO_IRQ_MASK, IO_SYS_CONTROL, SYS_CONTROL_RESET } from '../../../machine/ts/spec/bmsx/io';
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

test('the stock System ROM admits only the selected cartridge’s sections before EXEC', async t => {
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
			const source = `bss report: word[0x2000]
report[0] = 37
mem[${IO_IRQ_MASK}] = 0
halt_until_irq
`;
			const cart = (entrySource: string, path: string) => {
				const program = compileLuaChunkToProgram(parseLuaChunk(entrySource, path), [], { entrySource, optLevel });
				return linkCartBlua32Image(readBlua32BiosImports(system), encodeCompiledProgramObject(program), program.metadata,
					CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
			};
			const slot0 = cart(source.replace('0x2000', '0x4000'), 'nonbootable-slot0.lua');
			const slot1 = cart(source, 'selected-slot1.lua');
			const other = writeTestBlua32Rom(slot0), selected = writeTestBlua32Rom(slot1);
			// Socket 0 has a distinct operand record but no startup vector.
			writeLE32(other, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET, 0);
			const otherPath = join(output, 'slot0.rom'), selectedPath = join(output, 'slot1.rom');
			writeFileSync(otherPath, other);
			writeFileSync(selectedPath, selected);
			const boot = (slots: ReturnType<typeof cartridgeSlots>, done: (cpu: CPU) => boolean) => {
				const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: slots, machineModel: PSX_MACHINE_SPEC }, {
					sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
				});
				runtime.boot();
				const { cpu, scheduler, gxGpu } = runtime.machine;
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
				for (let grant = 0; grant < 2048 && !done(cpu); ++grant) pulse(65536);
				assert.ok(done(cpu), 'the real System startup reached the requested machine boundary');
				return { runtime, commands, expected, pulse, systemEnd };
			};
			const compare = (traceName: string, commands: string[], expected: string[], ...carts: string[]) => {
				const trace = join(output, traceName);
				writeFileSync(trace, commands.join('\n'));
				const actual = execFileSync(native, [rom, trace, join(output, 'unused'), ...carts], { encoding: 'utf8' }).trimEnd().split('\n');
				const mismatch = actual.findIndex((row, i) => row !== expected[i]);
				assert.equal(mismatch, -1, `at ${mismatch}: native=${actual[mismatch]}, TypeScript=${expected[mismatch]}`);
				assert.equal(actual.length, expected.length);
			};
			const { runtime, commands, expected } = boot(cartridgeSlots(other, selected), cpu =>
				cpu.activeCartridgeSlot() === 1 && cpu.isHaltedUntilIrq());
			const { cpu, memory, scheduler } = runtime.machine;
			const { bssAddress, bssByteCount } = slot1.layout.header;
			assert.equal(memory.readMappedU32LE(bssAddress), 37);
			const floor = RAM_BASE + cpu.heapAllocator.floorOffset(bssAddress + bssByteCount);
			assert.ok(cpu.heapAllocator.floorOffset(slot0.layout.header.bssAddress + slot0.layout.header.bssByteCount) > floor - RAM_BASE);
			assert.equal(memory.ramBusEnd(), floor, 'the ordinary mapped selected socket supplies the exact aperture');
			const result = scheduler.runCpuSlice(0, 1, 0, CpuRunKind.Scheduled);
			commands.push('E 1', `H ${bssAddress - RAM_BASE} ${bssAddress - RAM_BASE + 4}`);
			expected.push([result, 1 - cpu.instructionBudgetRemaining, +cpu.heapServiceActive(),
				memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' '));
			expected.push(String(hashBytes(memory.ramData(), bssAddress - RAM_BASE, 4)));
			compare('launch.trace', commands, expected, otherPath, selectedPath);

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
			compare('rejected.trace', fault.commands, fault.expected, rejectedPath);
		} catch (err) {
			failed = true;
			throw err;
		}
	});
	if (failed) t.diagnostic(`Stock launch artifacts retained in ${dir}`);
	else rmSync(dir, { recursive: true, force: true });
});
