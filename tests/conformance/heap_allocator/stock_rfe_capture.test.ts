import { readStockGlobalValue } from '../../../toolchain/ts/firmware/stock_global_bank';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import * as Closure from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_COLOR_OFFSET, GC_RECORD_MASK, GC_RECORD_SHIFT, GC_OBJECT_PREFIX } from '../../../toolchain/ts/firmware/stock_object_layout';
import { TableRecords } from '../../../machine/ts/machine/cpu/table';
import { isOpen, load as capture, UPVALUE_HEAP_BYTES, UPVALUE_NEXT } from '../../../machine/ts/machine/cpu/upvalue';
import { ValueTag, valueInteger, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { advanceRuntimeTime } from '../../../machine/ts/machine/runtime/cpu_executor';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_NMI, CPU_INTERRUPT_STATE_WINDOW, CPU_STATUS_RFE_RESTORE_MASK } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_STATIC } from '../../../machine/ts/spec/blua32/image_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_IRQ_MASK, IO_IRQ_ACK, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { CPU_INTERRUPTED_CONTEXT_ADDRESS, CPU_INTERRUPT_STATE_ADDRESS, CPU_IRQ_VECTOR_ADDRESS, CART_ROM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET } from '../../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GC_WEAK_VISITS, GC_VISIT_COUNT, GC_VISIT_TAIL, GC_VISIT_HEADER_BYTE, GC_VISIT_MEMBER, GcPhase, asClosure } from '../../helpers/native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const source = `module<entry>
bss phase: word
weak = setmetatable({}, { __mode = 'v' })
saved_capture = false
function irq()
	local status<const>, epc<const> = cop0.status, cop0.epc
	mem[${IO_IRQ_ACK}] = ${IRQ_VBLANK}
	local child = false
	saved_capture = function() return child end
	local target<const> = { id = 0x4d00 }
	weak.target = target
	child = target
	cop0.status, cop0.epc = status, epc
	blua32.rfe()
end
mem[${IO_IRQ_MASK}] = 0
*phase = 1
halt_until_irq
collectgarbage('step')
*phase = 2
while true do halt_until_irq end`;

test('RFE rescans a closed managed capture before stock Atomic clears weak values', async t => {
	const directory = mkdtempSync(join(tmpdir(), 'bmsx-rfe-capture-'));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
		'--mode', 'bios', '-respath', 'machine/bios/res', '--debug', '-O3', '--output-dir', directory,
		'--store-dir', join(directory, 'store')], { encoding: 'utf8' });
	const systemPath = join(directory, 'system', 'bmsx-bios.debug.rom'), system = readFileSync(systemPath);
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { buildDirectory: join(directory, 'native') });

	for (const optLevel of [0, 3] as const) {
		const program = compileLuaChunkToProgram(parseLuaChunk(source, 'rfe.lua'), [], { entrySource: source, optLevel });
		const linked = linkCartBlua32Image(readBlua32BiosImports(system), encodeCompiledProgramObject(program), program.metadata,
			CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
		const index = linked.symbols.metadata.functionIds.findIndex(id => id.endsWith('/decl:irq'));
		assert.ok(index >= 0);
		const vector = linked.layout.functions[index], cart = writeTestBlua32Rom(linked);
		// Use the authored capture-capable IRQ function itself, not the compiler's capture-free vector wrapper.
		writeLE32(cart, BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET, vector.address);
		writeLE32(cart, vector.address - CART_ROM_BASE + BLUA32_FUNCTION_FLAGS_OFFSET, vector.flags | BLUA32_FUNCTION_STATIC);
		const cartPath = join(directory, `cart-O${optLevel}.rom`);
		writeFileSync(cartPath, cart);

		for (const route of ['forwarded', 'direct'] as const) await t.test(`${route} O${optLevel}`, () => {
			const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cart), machineModel: PSX_MACHINE_SPEC }, input);
			runtime.boot();
			const { cpu, memory, scheduler, gxGpu, irqController } = runtime.machine, { heapAllocator: arena, gc } = nativeHeapReference(cpu);
			const report = linked.layout.header.bssAddress;
			for (let i = 0; i < 1024 && memory.readRamRecordWord(report) !== 1; ++i) {
				if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
				runtime.frameScheduler.runCyclesToNextLogicalTick(65536);
			}
			assert.equal(memory.readRamRecordWord(report), 1);
			assert.equal(cpu.activeCartridgeSlot(), 0);
			assert.ok(cpu.isHaltedUntilIrq());
			const depth = cpu.getFrameDepth(), returnPc = cpu.readFramePc(depth - 1);
			assert.notEqual(memory.readRamRecordWord(CPU_IRQ_VECTOR_ADDRESS), 0);
			if (route === 'direct') memory.writeRamRecordWord(CPU_IRQ_VECTOR_ADDRESS, 0);
			memory.writeMappedWord(IO_IRQ_MASK, IRQ_VBLANK);
			irqController.raise(IRQ_VBLANK);
			assert.ok(cpu.enterPendingInterrupt());
			assert.equal(cpu.fixedInterruptActive(), route === 'forwarded');

			const commands = ['X'], rows: string[] = [];
			const observe = (command: string, output?: string | number) => {
				commands.push(command);
				if (output !== undefined) rows.push(String(output));
			};
			const resetTrace = () => {
				commands.length = 1;
				rows.length = 0;
			};
			const grant = (cycles: number) => {
				const result = scheduler.runCpuSlice(0, cycles, 0, CpuRunKind.Scheduled);
				const paid = cycles - cpu.instructionBudgetRemaining;
				observe(`E ${cycles}`, [result, paid, memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' '));
				if (paid > 0) {
					advanceRuntimeTime(runtime, paid);
					observe(`v ${paid}`, scheduler.nowCycles);
				}
				return result;
			};
			const atRfe = () => {
				const frame = cpu.activeThread.currentFrame!;
				return frame.functionAddress === vector.address
					&& decodeBlua32InstructionAtPc(cart, CART_ROM_BASE, frame.pc).op === OpCode.RFE;
			};
			for (let i = 0; i < 4096 && !atRfe(); ++i) grant(1);
			assert.ok(atRfe(), 'the authored IRQ reached RFE with its actual ordinary frame live');
			assert.equal(cpu.fixedInterruptActive(), false);
			assert.equal(cpu.getFrameDepth(), depth + 1);
			assert.equal(cpu.readEpcWord(), returnPc);

			const global = (name: string) => readStockGlobalValue(cpu.memory, nativeHeapReference(cpu).stringPool.find(name)!);
			const getter = asClosure(global('saved_capture'), gc);
			const cell = Closure.captureAddress(memory, getter, 0), cellOffset = cell & GC_RECORD_MASK;
			assert.equal(cpu.activeThread.currentFrame!.openUpvalueHead, cell);
			assert.ok(arena.issuedObjectStart(cellOffset - GC_OBJECT_PREFIX));
			assert.ok(isOpen(memory, cell));
			const edge = capture(memory, cell), child = valuePayload(edge);
			assert.equal(valueTag(edge), ValueTag.Table);
			assert.ok(arena.issuedObjectStart((child & GC_RECORD_MASK) - GC_OBJECT_PREFIX));
			const weak = valuePayload(global('weak')), key = nativeHeapReference(cpu).stringPool.find('target')!;
			const weakValue = () => gc.tables.getStringKey(weak, key);
			assert.equal(weakValue(), edge);
			assert.equal(memory.readRamRecordByte(child + GC_COLOR_OFFSET), gc.white());

			// Stage the end of major mark: the real weak owner was visited, but the
			// captured child is white. The guest, not the fixture, issued all records.
			const control = arena.managementOffset() + HEAP_GC_CONTROL_OFFSET, changed = gc.changedHeadOffset();
			assert.equal(gc.phase(), GcPhase.Pause);
			assert.equal(memory.readRamRecordWord(changed), 0);
			assert.equal(memory.readRamRecordWord(control + GC_WEAK_VISITS), 0);
			const weakIndex = (weak - RAM_BASE) >>> GC_RECORD_SHIFT;
			memory.writeRamRecordWord(control + GC_WEAK_VISITS, weakIndex);
			memory.writeRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_TAIL, weakIndex);
			memory.writeRamRecordWord(control + GC_WEAK_VISITS + GC_VISIT_COUNT, 1);
			memory.writeRamRecordByte(weak + GC_VISIT_HEADER_BYTE, GC_VISIT_MEMBER);
			for (const record of [weak, gc.tables.metatableAddress(weak), getter, cell]) memory.writeRamRecordByte(record + GC_COLOR_OFFSET, 3);
			memory.writeRamRecordByte(control, GcPhase.MarkAgain);

			const path = (kind: string) => join(directory, `O${optLevel}-${route}.${kind}`);
			const snapshot = (kind: string) => {
				const file = path(kind);
				writeFileSync(file, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
				return file;
			};
			const restore = (file: string) => applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(file),
				PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			const latchWords = () => {
				const state = cpu.captureRuntimeState();
				return [state.causeWord, state.luaFaultReasonWord, state.epcWord, state.badAddressWord, state.exceptionDomainWord];
			};
			const hash = (first: number, bytes: number) => hashBytes(memory.ramData(), first, bytes);
			const observeHash = (first: number, bytes: number) => observe(`H ${first} ${first + bytes}`, hash(first, bytes));
			const run = (state: string) => {
				const trace = path('trace');
				writeFileSync(trace, commands.join('\n'));
				assert.deepEqual(execFileSync(native, [systemPath, trace, state, cartPath], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
			};
			const sourceFrame = cpu.activeThread.currentFrame!;
			const frameOffset = sourceFrame.controlOffset, owner = sourceFrame.thread.address, issuePc = sourceFrame.pc;
			const sourceHead = () => cpu.readThreadFrameWord(owner, depth, FrameField.OpenHead);
			const eventOffset = CPU_INTERRUPTED_CONTEXT_ADDRESS - RAM_BASE;
			const entryCell = hash(cellOffset, UPVALUE_HEAP_BYTES), entryControl = hash(control, 16);
			const statusWord = () => cpu.captureRuntimeState().statusWord;
			const before = latchWords(), status = statusWord();
			const assertPending = () => {
				assert.ok(cpu.fixedInterruptActive());
				assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), owner);
				assert.equal(memory.readRamRecordWord(CPU_INTERRUPT_STATE_ADDRESS), CPU_INTERRUPT_STATE_WINDOW);
				assert.equal(cpu.readThreadFrameDepth(owner), depth + 1);
				assert.equal(cpu.readThreadFrameWord(owner, depth, FrameField.Function), vector.address);
				assert.equal(cpu.readThreadFrameWord(owner, depth, FrameField.Pc), issuePc);
				assert.equal(cpu.readThreadFrameWord(owner, depth - 1, FrameField.Pc), returnPc);
				assert.equal(memory.readRamRecordWord(report), 1, 'no instruction from the receiving frame ran');
				assert.deepEqual(latchWords(), before);
				assert.equal(statusWord(), status);
			};
			const observeWindow = () => {
				observe('Z', latchWords().slice(0, 3).join(' '));
				observeHash(frameOffset, FRAME_CONTROL_BYTES);
				observeHash(eventOffset, 8);
				observeHash(cellOffset, UPVALUE_HEAP_BYTES);
				observeHash(control, 16);
			};
			resetTrace();
			const seed = snapshot('seed'), deviceDeadline = scheduler.nextDeadline();
			assert.equal(grant(1), RunResult.Yielded);
			assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.RFE]);
			assertPending();
			assert.equal(hash(cellOffset, UPVALUE_HEAP_BYTES), entryCell, 'RFE admission did not close or recolor the cell');
			assert.equal(hash(control, 16), entryControl, 'RFE admission did not enqueue collector work');
			assert.equal(sourceHead(), cell);
			const packet = cpu.activeThread.currentFrame!;
			const deadline = Math.min(0x7fff_ffff, Math.max(0, deviceDeadline - scheduler.nowCycles));
			assert.equal(packet.argumentCount, 4);
			assert.deepEqual([0, 1, 2, 3].map(i => packet.registers.get(i)), [0, 0, OpCode.RFE, deadline].map(valueInteger));
			const fixedStack = packet.thread.stackOffset(), fixedSlot = packet.stackBase;
			observe('P', `${cpu.getFrameDepth()} ${packet.pc}`);
			observeHash(fixedStack + fixedSlot * 4, 4 * 4);
			observeHash(fixedStack + packet.thread.stackRegisters.capacity() * 4 + fixedSlot, 4);
			observeWindow();

			for (let i = 0; i < 4096 && isOpen(memory, cell); ++i) assert.equal(grant(1), RunResult.Yielded);
			assertPending();
			assert.equal(isOpen(memory, cell), false, 'the first close store was a firmware instruction');
			assert.equal(sourceHead(), cell);
			assert.equal(memory.readRamRecordByte(cell + GC_COLOR_OFFSET), 3);
			assert.equal(memory.readRamRecordWord(changed), 0, 'snapshot between mechanical close and collector publication');
			observeWindow();
			const staged = snapshot('ts-mid'), mid = path('cpp-mid'), retired = path('cpp-retired');
			observe(`x ${mid}`);
			const prefixRows = rows.length;

			const retire = () => {
				let enqueued = false;
				for (let i = 0; i < 4096 && cpu.fixedInterruptActive(); ++i) {
					assert.equal(grant(1), RunResult.Yielded);
					if (!enqueued && memory.readRamRecordWord(changed) !== 0) {
						assertPending();
						assert.equal(capture(memory, cell), edge);
						assert.equal(memory.readRamRecordByte(cell + GC_COLOR_OFFSET), 2);
						assert.equal(memory.readRamRecordWord(changed), cellOffset >>> GC_RECORD_SHIFT);
						assert.equal(memory.readRamRecordWord(cell + UPVALUE_NEXT), 0);
						enqueued = true;
						observeWindow();
					}
				}
				assert.ok(enqueued, 'the fixed vector published the rescan');
				assert.equal(cpu.fixedInterruptActive(), false);
				assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.RFE],
					'the fixed vector retires the original RFE without re-executing it');
				assert.equal(cpu.activeThread.address, owner);
				assert.equal(cpu.getFrameDepth(), depth);
				assert.equal(sourceHead(), 0, 'no window remains attached to the retired source frame');
				assert.equal(cpu.readFramePc(depth - 1), returnPc);
				assert.equal(memory.readRamRecordWord(report), 1);
				assert.equal(memory.readRamRecordWord(CPU_INTERRUPTED_CONTEXT_ADDRESS), 0);
				assert.equal(memory.readRamRecordWord(CPU_INTERRUPT_STATE_ADDRESS), 0);
				assert.deepEqual(latchWords(), before);
				assert.equal(statusWord(), (status & ~CPU_STATUS_RFE_RESTORE_MASK)
					| ((status >>> 2) & CPU_STATUS_RFE_RESTORE_MASK));
				observe('P', `${depth} ${returnPc}`);
				observeWindow();
			};
			const weakStorage = gc.tables.hashAddress(weak) - RAM_BASE, weakBytes = TableRecords.hashStorageBytes(gc.tables.hashSize(weak));
			const finish = () => {
				for (let i = 0; i < 128 && memory.readRamRecordWord(report) !== 2; ++i) grant(8192);
				assert.equal(memory.readRamRecordWord(report), 2);
				observeHash(weakStorage, weakBytes);
			};
			retire();
			observe(`x ${retired}`);
			finish();
			assert.equal(weakValue(), edge, 'actual Atomic revisits the closed cell before clearing weak values');
			const kept = rows.slice(prefixRows);
			run(seed);

			restore(mid);
			assertPending();
			resetTrace();
			retire();
			finish();
			assert.deepEqual(rows, kept);
			run(staged);

			restore(retired);
			resetTrace();
			// Counterfactual: leave the mechanical close intact and elide only the rescan publication.
			memory.writeRamRecordWord(changed, 0);
			memory.writeRamRecordByte(cell + GC_COLOR_OFFSET, 3);
			const skipped = snapshot('without-barrier');
			finish();
			assert.equal(valueTag(weakValue()), ValueTag.Nil, 'mechanical close alone loses the edge in the same Atomic pass');
			run(skipped);

			restore(mid);
			resetTrace();
			cpu.requestNonMaskableInterrupt();
			observe('N');
			assert.equal(cpu.enterPendingInterrupt(), false);
			observe('I', 0);
			retire();
			assert.ok(cpu.enterPendingInterrupt(), 'the NMI is admitted after the original RFE retires');
			observe('I', 1);
			assert.equal(cpu.readCauseWord(), CPU_CAUSE_NMI);
			assert.equal(cpu.readEpcWord(), returnPc);
			observe('Z', latchWords().slice(0, 3).join(' '));
			run(mid);
		});
	}
});
