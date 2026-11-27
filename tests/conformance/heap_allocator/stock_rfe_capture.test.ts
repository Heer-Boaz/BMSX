import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import * as Closure from '../../../machine/ts/machine/cpu/closure';
import { CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { GC_WEAK_VISITS, GC_VISIT_COUNT, GC_VISIT_TAIL, GC_VISIT_HEADER_BYTE, GC_VISIT_MEMBER, GcPhase } from '../../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET, GC_RECORD_MASK, GC_RECORD_SHIFT, GC_OBJECT_PREFIX } from '../../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { TableRecords } from '../../../machine/ts/machine/cpu/table';
import { isOpen, load as capture, UPVALUE_HEAP_BYTES, UPVALUE_NEXT } from '../../../machine/ts/machine/cpu/upvalue';
import { ValueTag, asClosure, valuePayload, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_STATIC } from '../../../machine/ts/spec/blua32/image_format';
import { BASE_CYCLES, OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { IO_IRQ_MASK, IO_IRQ_ACK, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { CPU_IRQ_VECTOR_ADDRESS, CART_ROM_BASE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
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
			const { cpu, memory, scheduler, gxGpu, irqController } = runtime.machine, { gc, heapAllocator: arena } = cpu;
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

			const grant = (cycles: number) => {
				const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
				return [result, cycles - cpu.instructionBudgetRemaining, memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' ');
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

			const global = (name: string) => cpu.getGlobalByKey(cpu.stringPool.find(name)!);
			const getter = asClosure(global('saved_capture'), gc);
			const cell = Closure.captureAddress(memory, getter, 0), cellOffset = cell & GC_RECORD_MASK;
			assert.equal(cpu.activeThread.currentFrame!.openUpvalueHead, cell);
			assert.ok(arena.issuedObjectStart(cellOffset - GC_OBJECT_PREFIX));
			assert.ok(isOpen(memory, cell));
			const edge = capture(memory, cell), child = valuePayload(edge);
			assert.equal(valueTag(edge), ValueTag.Table);
			assert.ok(arena.issuedObjectStart((child & GC_RECORD_MASK) - GC_OBJECT_PREFIX));
			const weak = valuePayload(global('weak')), key = cpu.stringPool.find('target')!;
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
			const latches = () => {
				const state = cpu.captureRuntimeState();
				return [state.causeWord, state.luaFaultReasonWord, state.epcWord, state.badAddressWord, state.exceptionDomainWord];
			};
			const seed = snapshot('seed'), before = latches();
			const rfe = grant(1);
			assert.equal(1 - cpu.instructionBudgetRemaining, BASE_CYCLES[OpCode.RFE] + 1);
			assert.deepEqual(latches(), before);
			assert.equal(cpu.getFrameDepth(), depth);
			assert.equal(cpu.readFramePc(depth - 1), returnPc);
			assert.equal(isOpen(memory, cell), false);
			assert.equal(capture(memory, cell), edge);
			assert.equal(memory.readRamRecordByte(cell + GC_COLOR_OFFSET), 2);
			assert.equal(memory.readRamRecordWord(changed), cellOffset >>> GC_RECORD_SHIFT);
			assert.equal(memory.readRamRecordWord(cell + UPVALUE_NEXT), 0);

			const hash = (first: number, bytes: number) => String(hashBytes(memory.ramData(), first, bytes));
			const weakStorage = gc.tables.hashAddress(weak) - RAM_BASE, weakBytes = TableRecords.hashStorageBytes(gc.tables.hashSize(weak));
			const finish = () => {
				const rows: string[] = [];
				for (let i = 0; i < 128 && memory.readRamRecordWord(report) !== 2; ++i) rows.push(grant(8192));
				assert.equal(memory.readRamRecordWord(report), 2);
				return rows;
			};
			const run = (state: string, prefix: string[], expected: string[], grants: string[]) => {
				const trace = path('trace');
				writeFileSync(trace, ['X', ...prefix, ...grants.map(() => 'E 8192'), `H ${weakStorage} ${weakStorage + weakBytes}`].join('\n'));
				assert.deepEqual(execFileSync(native, [systemPath, trace, state, cartPath], { encoding: 'utf8' }).trimEnd().split('\n'),
					[...expected, ...grants, hash(weakStorage, weakBytes)]);
			};
			const retired = path('cpp-retired');
			const prefix = [rfe, before.slice(0, 3).join(' '), hash(cellOffset, UPVALUE_HEAP_BYTES), hash(control, 16), `${depth} ${returnPc}`];
			const kept = finish();
			assert.equal(weakValue(), edge, 'actual Atomic revisits the closed cell before clearing weak values');
			const keptBytes = hash(weakStorage, weakBytes);
			run(seed, ['E 1', 'Z', `H ${cellOffset} ${cellOffset + UPVALUE_HEAP_BYTES}`, `H ${control} ${control + 16}`, 'P',
				`x ${retired}`], prefix, kept);

			const restoreRetirement = () => applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(retired),
				PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
			restoreRetirement();
			assert.deepEqual(latches(), before);
			assert.deepEqual(finish(), kept);
			assert.equal(hash(weakStorage, weakBytes), keptBytes);

			restoreRetirement();
			// Counterfactual: leave the mechanical close intact and elide only the rescan publication.
			memory.writeRamRecordWord(changed, 0);
			memory.writeRamRecordByte(cell + GC_COLOR_OFFSET, 3);
			const skipped = snapshot('without-barrier');
			const cleared = finish();
			assert.equal(valueTag(weakValue()), ValueTag.Nil, 'mechanical close alone loses the edge in the same Atomic pass');
			run(skipped, [], [], cleared);
		});
	}
});
