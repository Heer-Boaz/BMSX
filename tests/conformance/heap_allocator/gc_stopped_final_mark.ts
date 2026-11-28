import { nativeHeapReference } from '../../helpers/native_heap/reference';
import { createReferenceTable } from '../../helpers/cpu_heap_reference';
import { setReferenceGlobal } from '../../helpers/global_bank_reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_STEP_WORDS } from '../../helpers/native_heap/lua_heap';
import { asInteger, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { IO_IRQ_ACK, IO_IRQ_MASK, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GcPhase } from '../../helpers/native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';

const source = `bss report: word[3]
function irq()
	mem[${IO_IRQ_ACK}] = ${IRQ_VBLANK}
	report[1] = report[1] + 1
end
final_mark_weak_root = false
final_mark_result_root = false
mem[${IO_IRQ_MASK}] = 0
mem[${IO_IRQ_ACK}] = ${IRQ_VBLANK}
while report[0] == 0 do halt_until_irq end
if report[0] == 1 then
	report[2] = collectgarbage('step') and -1 or 1
elseif report[0] == 2 then
	mem[${IO_IRQ_MASK}] = ${IRQ_VBLANK}
	while report[1] == 0 do halt_until_irq end
	report[2] = 2
else
	final_mark_result_root = {3}
	report[2] = final_mark_result_root[1]
end
return 73`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const directory = mkdtempSync(join(tmpdir(), 'bmsx-final-mark-'));
const slots = 2 * GC_STEP_WORDS;

try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const out = join(directory, `O${opt}`);
		execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
			'--mode', 'bios', '-respath', 'machine/bios/res', '--debug', `-O${opt}`, '--output-dir', out,
			'--store-dir', join(directory, 'store')], { encoding: 'utf8' });
		const rom = join(out, 'system', 'bmsx-bios.debug.rom'), system = readFileSync(rom);
		const program = compileLuaChunkToProgram(parseLuaChunk(source, 'final-mark.lua'), [], { entrySource: source, optLevel: opt });
		const linked = linkCartBlua32Image(readBlua32BiosImports(system), encodeCompiledProgramObject(program), program.metadata,
			CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
		const cart = writeTestBlua32Rom(linked), cartFile = join(out, 'fixture.rom');
		writeFileSync(cartFile, cart);
		for (const [name, mode] of [['step', 1], ['irq', 2], ['allocation', 3]] as const) {
			const irq = mode === 2, allocation = mode === 3;
			const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
			runtime.boot();
			const { cpu, memory, scheduler, gxGpu, irqController } = runtime.machine;
			const { gc, heapAllocator: arena, luaHeap } = nativeHeapReference(cpu);
			const report = linked.layout.header.bssAddress, offset = report - RAM_BASE;
			const word = (slot: number) => memory.readRamRecordWord(report + 4 * slot);
			for (let i = 0; i < 1024 && !(cpu.activeCartridgeSlot() === 0 && cpu.isHaltedUntilIrq()); ++i) {
				if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
				runtime.frameScheduler.runCyclesToNextLogicalTick(65536);
			}
			assert.equal(cpu.activeCartridgeSlot(), 0);
			assert.ok(cpu.isHaltedUntilIrq());
			const slice = (cycles: number) => scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
			if (irq) {
				memory.writeMappedWord(report, mode);
				cpu.clearHaltUntilIrq();
				slice(1024);
				assert.ok(cpu.isHaltedUntilIrq());
				assert.equal(memory.readIoU32(IO_IRQ_MASK), IRQ_VBLANK);
			}

			// Construct one identical fixture; production guest code runs all
			// collector work from this exact MarkAgain boundary onward.
			luaHeap.setCollectionTarget(luaHeap.capacity());
			const weak = createReferenceTable(cpu, slots, 0), meta = createReferenceTable(cpu, 0, 1);
			gc.tables.set(meta, valueString(cpu.stringPool.find('__mode')!), valueString(nativeHeapReference(cpu).stringPool.intern('v')));
			gc.tables.setMetatableAddress(weak, meta);
			gc.tables.set(weak, valueInteger(1), valueTable(createReferenceTable(cpu)));
			gc.tables.set(weak, valueInteger(slots), valueTable(createReferenceTable(cpu)));
			setReferenceGlobal(cpu, cpu.stringPool.find('final_mark_weak_root')!, valueTable(weak));
			if (irq) assert.notEqual(arena.allocate(arena.capacityBytes() >>> 1, true), 0);
			if (gc.phase() === GcPhase.Pause) gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
			for (let i = 0; i < 65536 && gc.phase() === GcPhase.Mark; ++i)
				gc.step(valueNil(), valueNil(), valueNil(), 0, false, 1);
			assert.equal(gc.phase(), GcPhase.MarkAgain, 'the reference prepares but does not execute Atomic');
			// Enough logical debt for the constructor's ordinary assist, without
			// exhausting the arena and forcing the separate full-epoch recovery.
			if (allocation) luaHeap.setCollectionTarget(luaHeap.usedBytes() - 2 * GC_STEP_WORDS);
			const save = (suffix: string) => {
				const file = join(out, `${name}-${suffix}.state`);
				writeFileSync(file, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
				return file;
			};
			const seed = save('seed'), partial = join(out, `${name}-cpp.state`);
			const commands: string[] = ['X'], rows: string[] = [];
			const observe = (command: string, row?: string) => { commands.push(command); if (row !== undefined) rows.push(row); };
			if (irq) {
				irqController.raise(IRQ_VBLANK);
				observe(`i ${IRQ_VBLANK}`);
				assert.equal(cpu.enterPendingInterrupt(), true);
				observe('I', '1');
			} else {
				memory.writeMappedWord(report, mode);
				cpu.clearHaltUntilIrq();
				observe(`O ${report} ${mode}`);
				observe('h');
			}
			const grant = (cycles: number) => {
				const result = slice(cycles), used = cycles - cpu.instructionBudgetRemaining;
				observe(`L ${cycles}`, [result, used, gc.fullEpochs(), gc.phase(), luaHeap.usedBytes()].join(' '));
				assert.ok(used > 0, `${opt}/${name}: result=${result} phase=${gc.phase()} depth=${cpu.getFrameDepth()} cause=${cpu.readCauseWord()} reason=${cpu.readLuaFaultReasonWord()} pc=${cpu.lastPc}`);
				return result;
			};
			const active = () => cpu.fixedInterruptActive();
			for (let i = 0; i < 8192 && gc.tables.getInteger(weak, 1) !== valueNil(); ++i) grant(137);
			assert.equal(gc.phase(), GcPhase.Atomic);
			assert.ok(active());
			if (!irq && !allocation) assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
			assert.equal(word(1), 0, 'the cartridge has not acknowledged its pending IRQ');
			assert.equal(word(2), 0, 'the mutator cannot pass the collection boundary');
			assert.equal(gc.tables.getInteger(weak, 1), valueNil());
			assert.notEqual(gc.tables.getInteger(weak, slots), valueNil());
			const atomicWork = gc.epochWork(), suspended = save('partial');
			cpu.requestNonMaskableInterrupt();
			assert.equal(cpu.enterPendingInterrupt(), false);
			cpu.cancelNonMaskableInterrupt();
			const prefix = commands.length, rowPrefix = rows.length;
			const finish = () => {
				let interimCredit = false, result = RunResult.Yielded;
				for (let i = 0; i < 8192 && result !== RunResult.Halted; ++i) {
					result = grant(251);
					if (gc.phase() === GcPhase.Atomic) {
						assert.ok(active());
						assert.equal(word(2), 0);
						if (gc.epochWork() !== atomicWork) interimCredit = true;
					}
				}
				assert.equal(result, RunResult.Halted);
				assert.equal(interimCredit, irq, 'IRQ accounts source quanta; Step and allocation account the completed final mark once');
				assert.equal(gc.phase(), GcPhase.Sweep);
				assert.equal(gc.tables.getInteger(weak, slots), valueNil());
				assert.equal(word(1), +irq);
				assert.equal(word(2), mode);
				assert.equal(asInteger(runtime.readCompletionValues()[0]), 73);
				observe('C', '73');
				if (allocation) {
					const value = cpu.getGlobalByKey(cpu.stringPool.find('final_mark_result_root')!);
					assert.equal(valueTag(value), ValueTag.Table);
					const record = valuePayload(value);
					assert.equal(gc.sweepGarbage(record), false, 'the constructor result was marked before the mutator received it');
					assert.equal(gc.tables.getInteger(record, 1), valueInteger(3));
					const start = record - RAM_BASE;
					observe(`H ${start} ${start + 8}`, String(hashBytes(memory.ramData(), start, 8)));
				}
				const control = arena.managementOffset() + HEAP_GC_CONTROL_OFFSET;
				for (const [first, length] of [[offset, 12], [control, 0xac]])
					observe(`H ${first} ${first + length}`, String(hashBytes(memory.ramData(), first, length)));
			};
			finish();
			const tail = commands.slice(prefix), tailRows = rows.slice(rowPrefix);
			const replay = (checkpoint: string, script: string[], expected: string[]) => {
				const trace = join(out, `${name}.trace`);
				writeFileSync(trace, script.join('\n'));
				assert.deepEqual(execFileSync(native, [rom, trace, checkpoint, cartFile], { encoding: 'utf8' }).trimEnd().split('\n'), expected);
			};
			replay(seed, commands, rows);
			replay(suspended, ['X', 'l', 's', `x ${partial}`, ...tail, 'u', ...tail], [...tailRows, ...tailRows]);
			applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(partial), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			commands.length = prefix;
			rows.length = rowPrefix;
			finish();
			assert.deepEqual(rows.slice(rowPrefix), tailRows);
			console.log(`BIOS-FINAL-MARK:PASS O${opt}-${name} (timed owning boundary, weak-array quanta, portable restore and rewind)`);
		}
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
