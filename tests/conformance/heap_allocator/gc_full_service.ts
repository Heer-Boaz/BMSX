import { nativeHeapReference } from '../../helpers/native_heap/reference';
import { createReferenceTable } from '../../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../../helpers/global_bank_reference';
import { resizeThreadStackReference } from '../../helpers/thread_allocation_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { asInteger, valueInteger, valueNil, valueString, valueTable } from '../../../machine/ts/machine/cpu/value';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { GC_TRACE_CONTEXT_OFFSET, GcTraceContextField, HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';
import { IO_IRQ_MASK } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, CPU_INTERRUPTED_CONTEXT_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GC_ROOT_CURSOR, GC_TRACE_CURSOR, GC_TRACE_RECORD, GcPhase } from '../../helpers/native_heap/gc_heap';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = `bss report: word[5]
full_collection_root = false
mem[${IO_IRQ_MASK}] = 0
report[1] = -1
while report[0] == 0 do halt_until_irq end
report[1] = collectgarbage('collect')
while report[0] == 1 do halt_until_irq end
report[2] = (collectgarbage('count') * 1024) & -1
report[3] = (collectgarbage('capacity') * 1024) & -1
report[4] = collectgarbage('step') and 1 or 2
return 73`;
const deadText = 'full collection must reclaim an unrooted Text value'.repeat(256);

const directory = mkdtempSync(join(tmpdir(), 'bmsx-gc-full-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const out = join(directory, `O${opt}`);
		execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
			'--mode', 'bios', '-respath', 'machine/bios/res', '--debug', `-O${opt}`, '--output-dir', out,
			'--store-dir', join(directory, 'store')], { encoding: 'utf8' });
		const rom = join(out, 'system', 'bmsx-bios.debug.rom'), system = readFileSync(rom);
		const program = compileLuaChunkToProgram(parseLuaChunk(source, 'explicit-collection.lua'), [], { entrySource: source, optLevel: opt });
		const linked = linkCartBlua32Image(readBlua32BiosImports(system), encodeCompiledProgramObject(program), program.metadata,
			CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
		const cart = writeTestBlua32Rom(linked), cartPath = join(out, 'cart.rom');
		writeFileSync(cartPath, cart);
		const report = linked.layout.header.bssAddress;
		for (const alreadyActive of [false, true]) {
			const name = `O${opt}-${alreadyActive ? 'active' : 'exhausted'}`;
			const configuration = { systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC };
			const runtime = new Runtime(configuration, input);
			runtime.boot();
			const { cpu, memory, scheduler, gxGpu } = runtime.machine, { gc, heapAllocator: arena, luaHeap } = nativeHeapReference(cpu);
			for (let i = 0; i < 1024 && !(cpu.activeCartridgeSlot() === 0 && cpu.isHaltedUntilIrq()); ++i) {
				if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
				runtime.frameScheduler.runCyclesToNextLogicalTick(65536);
			}
			assert.equal(cpu.activeCartridgeSlot(), 0,
				`${name}: stock BIOS did not enter the cartridge (cause=${cpu.readCauseWord()} reason=${cpu.readLuaFaultReasonWord()} pc=${cpu.lastPc} epc=${cpu.readEpcWord()} fixed=${cpu.fixedInterruptActive()})`);
			assert.ok(cpu.isHaltedUntilIrq());
			memory.writeMappedWord(report, 1);
			cpu.clearHaltUntilIrq();
			const management = arena.managementOffset(), traceLimit = management + GC_TRACE_CONTEXT_OFFSET + GcTraceContextField.Limit;
			const control = management + HEAP_GC_CONTROL_OFFSET;
			luaHeap.setCollectionTarget(luaHeap.capacity());
			const owner = cpu.activeThread.address;
			resizeThreadStackReference(cpu, cpu.activeThread, 512);
			const weak = createReferenceTable(cpu, 4, 0), metatable = createReferenceTable(cpu, 0, 1), hidden = createReferenceTable(cpu), floating = createReferenceTable(cpu);
			gc.tables.set(metatable, valueString(nativeHeapReference(cpu).stringPool.find('__mode')!), valueString(nativeHeapReference(cpu).stringPool.intern('v')));
			gc.tables.setMetatableAddress(weak, metatable);
			gc.tables.set(weak, valueInteger(1), valueTable(hidden));
			setReferenceGlobal(cpu, nativeHeapReference(cpu).stringPool.find('full_collection_root')!, valueTable(weak));
			const dropped = nativeHeapReference(cpu).stringPool.intern(deadText);
			assert.equal(gc.phase(), GcPhase.Pause);
			if (alreadyActive) {
				gc.step(valueTable(floating), valueNil(), valueNil(), 0, false, 1);
				assert.notEqual(gc.phase(), GcPhase.Pause);
			} else {
				// Fill the physical arena without allocating any guest object.
				// CALL/SVC and the collector must not need a heap frame to start.
				for (let bytes = 1 << 20; bytes >= 8; bytes >>= 1)
					while (arena.allocate(bytes, true) !== 0) { /* fixture reservation */ }
				assert.equal(arena.allocate(8, true), 0);
			}
			const seed = join(directory, `${name}.seed`), partial = join(directory, `${name}.partial`);
			const nativePartial = join(directory, `${name}.native`);
			writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const history = new RamHistory();
			history.start(memory);
			const historyBase = history.capture(memory, null);
			const commands: string[] = [], expected: string[] = [];
			function observe(command: string, output: string | number) {
				commands.push(command);
				expected.push(String(output));
			}
			function grant(cycles: number) {
				const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
				const used = cycles - cpu.instructionBudgetRemaining;
				observe(`L ${cycles}`, `${result} ${used} ${gc.fullEpochs()} ${gc.phase()} ${luaHeap.usedBytes()}`);
				if (cycles > 0) assert.ok(used > 0, `an admitted quantum pays ordinary instruction cycles (result=${result}, phase=${gc.phase()}, depth=${cpu.getFrameDepth()}, cause=${cpu.readCauseWord()}, reason=${cpu.readLuaFaultReasonWord()}, pc=${cpu.lastPc})`);
				return result;
			}
			for (let i = 0; i < 4096 && !cpu.fixedInterruptActive(); ++i) grant(1);
			assert.ok(cpu.fixedInterruptActive(), 'the cartridge CALL reaches the installed System vector');
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
			observe('Z', `${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${cpu.readEpcWord()}`);
			assert.equal(gc.fullEpochs(), 0, 'exception entry did not write the collector policy');
			const caller = cpu.readThreadFrameDepth(owner) - 1, successor = cpu.readEpcWord(), epochs = alreadyActive ? 2 : 1;
			function held() {
				assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
				assert.equal(cpu.readThreadFrameWord(owner, caller, FrameField.Pc), successor);
				assert.equal(memory.readRamRecordWord(report + 4), 0xffffffff, 'the cartridge did not retire the collect call');
			}
			for (let i = 0; i < 256 && !gc.fullEpochs(); ++i) assert.equal(grant(1), RunResult.Yielded);
			assert.equal(gc.fullEpochs(), epochs);
			held();
			for (let i = 0; i < 1024 && memory.readRamRecordWord(traceLimit) === 0; ++i) grant(1);
			assert.ok(memory.readRamRecordWord(traceLimit) > 1, 'one-cycle host fragments must not shorten the allowance to the next hardware event');
			observe(`H ${traceLimit} ${traceLimit + 4}`, hashBytes(memory.ramData(), traceLimit, 4));
			for (let i = 0; i < 8192 && cpu.fixedInterruptActive() && gc.tables.get(weak, valueInteger(1)) !== valueNil(); ++i) grant(509);
			assert.equal(gc.tables.get(weak, valueInteger(1)), valueNil(),
				`${name}: weak entry was not cleared (fixed=${cpu.fixedInterruptActive()}, phase=${gc.phase()}, epochs=${gc.fullEpochs()}, cause=${cpu.readCauseWord()}, reason=${cpu.readLuaFaultReasonWord()}, pc=${cpu.lastPc}, root=${memory.readRamRecordWord(control + GC_ROOT_CURSOR)}, trace=${memory.readRamRecordWord(control + GC_TRACE_RECORD)}/${memory.readRamRecordWord(control + GC_TRACE_CURSOR)})`);
			assert.equal(gc.fullEpochs(), epochs);
			assert.equal(cpu.fixedInterruptActive(), true);
			held();
			cpu.requestNonMaskableInterrupt();
			assert.equal(cpu.enterPendingInterrupt(), false, 'NMI cannot take over the collector activation');
			cpu.cancelNonMaskableInterrupt();
			const checkpoint = captureRuntimeCheckpointState(runtime);
			writeFileSync(partial, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			const interrupted = history.capture(memory, historyBase);
			const prefix = commands.length;
			function finish() {
				let remaining = gc.fullEpochs(), reductions = 0;
				while (cpu.fixedInterruptActive()) {
					assert.ok(commands.length < prefix + 8192);
					const result = grant(509);
					if (cpu.fixedInterruptActive()) assert.equal(result, RunResult.Yielded);
					if (gc.fullEpochs() < remaining) {
						assert.equal(gc.fullEpochs(), remaining - 1);
						if (remaining === 2) assert.equal(gc.tableRecordAddress(floating), floating, 'the current epoch retains its earlier mark');
						remaining = gc.fullEpochs();
						++reductions;
					}
					if (cpu.fixedInterruptActive()) held();
				}
				assert.equal(reductions, epochs);
				assert.equal(gc.fullEpochs(), 0);
				assert.equal(gc.phase(), GcPhase.Pause, 'full collection completes its own final mark and sweep before returning');
				assert.equal(gc.tableRecordAddress(hidden), 0);
				assert.equal(gc.tableRecordAddress(floating), 0);
				assert.equal(nativeHeapReference(cpu).stringPool.find(deadText), undefined);
				assert.ok(dropped >= RAM_BASE);
				assert.equal(cpu.activeThread.stackRegisters.capacity(), 512 >> epochs, 'the guest preserves full-only compaction at each epoch');
				const collectedBytes = luaHeap.usedBytes(), capacity = luaHeap.capacity();
				let result = RunResult.Yielded;
				for (let i = 0; i < 128 && !cpu.isHaltedUntilIrq(); ++i) grant(31);
				assert.ok(cpu.isHaltedUntilIrq());
				assert.equal(memory.readRamRecordWord(report + 4), 0, 'collectgarbage collect returns zero');
				memory.writeMappedWord(report, 2);
				cpu.clearHaltUntilIrq();
				commands.push(`O ${report} 2`, 'h');
				for (let i = 0; i < 4096 && result !== RunResult.Halted; ++i) result = grant(509);
				assert.equal(result, RunResult.Halted, `${name}: count, capacity and step all return to the cartridge`);
				assert.equal(cpu.readLuaFaultReasonWord(), 0);
				assert.equal(asInteger(runtime.readCompletionValues()[0]), 73);
				observe('C', 73);
				assert.equal(memory.readRamRecordWord(report + 8), collectedBytes);
				assert.equal(memory.readRamRecordWord(report + 12), capacity);
				assert.equal(memory.readRamRecordWord(report + 16), gc.phase() === GcPhase.Pause ? 1 : 2, 'step reports whether the epoch ended');
				for (const [first, last] of [[control, traceLimit + 4], [report - RAM_BASE, report - RAM_BASE + 20], [memory.ramBusEnd() - RAM_BASE, memory.ramData().length]]) {
					observe(`H ${first} ${last}`, hashBytes(memory.ramData(), first, last - first));
				}
			}
			finish();
			const tail = commands.slice(prefix), output = expected.slice(prefix);
			function check(suffix: string, snapshot: string, trace: string[], rows: string[]) {
				const path = join(directory, `${name}-${suffix}.trace`);
				writeFileSync(path, trace.join('\n'));
				const nativeRows = execFileSync(native, [rom, path, snapshot, cartPath], { encoding: 'utf8' }).trimEnd().split('\n');
				const mismatch = nativeRows.findIndex((row, index) => row !== rows[index]);
				assert.equal(mismatch, -1, `${suffix} line ${mismatch}: TS ${rows[mismatch]}, C++ ${nativeRows[mismatch]}`);
				assert.equal(nativeRows.length, rows.length);
			}
			check('cold', seed, ['X', ...commands.slice(0, prefix), 'N', 'I'], [...expected.slice(0, prefix), '0']);
			check('resume', partial, ['X', 'l', 's', `x ${nativePartial}`, ...tail, 'u', ...tail], [...output, ...output]);
			history.restore(memory, history.capture(memory, interrupted), interrupted);
			applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
			commands.length = expected.length = 0;
			finish();
			assert.deepEqual(commands, tail);
			assert.deepEqual(expected, output);
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativePartial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			commands.length = expected.length = 0;
			finish();
			assert.deepEqual(commands, tail);
			assert.deepEqual(expected, output);
			console.log(`BIOS-FULL-GC:PASS ${name} (${epochs} epochs, ${tail.length} exact grant/RAM observations, portable restore and rewind)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
