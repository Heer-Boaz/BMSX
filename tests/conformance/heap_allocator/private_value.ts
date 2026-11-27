import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_RESERVED_INSTRUCTION } from '../../../machine/ts/spec/blua32/cop0';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { HEAP_SERVICE_CLOSURE_OFFSET, HEAP_SERVICE_RESULT_OFFSET, HEAP_SERVICE_VALUE_CELL_OFFSET, HEAP_SERVICE_VALUE_CELL_SIZE, HEAP_SERVICE_VALUE_CELL_TAG_OFFSET } from '../../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE, RUNTIME_MANAGEMENT_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { deriveBlua32FixedStack } from '../../../toolchain/ts/rompack/blua32_fixed_stack';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { linkTestSystemBlua32 } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { compileHeapServiceSystem } from '../../helpers/heap_service_system';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const path = 'test/private_value';
const address = RAM_BASE + PSX_MACHINE_SPEC.ramBytes - RUNTIME_MANAGEMENT_SIZE + HEAP_SERVICE_VALUE_CELL_OFFSET;
const source = `
module<const>
local layout<const> = require('kernel/gc_runtime_layout')
struct distant_cell
	before: u32[256]
	slot: value
end
local dynamic<const> = function(management, rounds)
	local base<const> = layout.ram_base + management + layout.value_cell_offset
	local cell<const>: *value = base
	local word<const>: *u32 = base
	local tag<const>: *u8 = base + layout.value_cell_tag_offset
	local saved<const> = *cell
	*word = 0
	*tag = 0
	*cell = saved
	local truth = 0
	for i = 1, rounds do
		local item<const> = *cell
		if item then truth = truth + 1 end
		*cell = item
	end
	return truth
end
local constant<const> = function(rounds)
	local cell<const>: *distant_cell = ${address - 1024}
	local word<const>: *u32 = ${address}
	local tag<const>: *u8 = ${address + HEAP_SERVICE_VALUE_CELL_TAG_OFFSET}
	local saved<const> = cell.slot
	*word = 0
	*tag = 0
	cell.slot = saved
	local truth = 0
	for i = 1, rounds do
		local item<const> = cell.slot
		if item then truth = truth + 1 end
		cell.slot = item
	end
	return truth
end
return { dynamic = dynamic, constant = constant }
`;
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const fixture = { path, source };
const entry = 'halt_until_irq';
const cycles = 293;
const rounds = 126;
const verifyNative = process.env.BMSX_TEST_SCALAR_VALUE_PORT !== '1';

const rejectedSource = `
local cell<const>: *value = ${address}
return *cell
`;
assert.throws(() => compileLuaChunkToProgram(parseLuaChunk(rejectedSource, 'card.lua').chunk, [], { entrySource: rejectedSource, optLevel: 0, programDomain: 'cart' }),
	/typed Value view is only available/);

mkdirSync('tmp', { recursive: true });
const directory = mkdtempSync(join('tmp', 'bmsx-private-value-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const opt of [0, 3] as const) {
		const compiled = compileHeapServiceSystem(entry, opt, [fixture]);
		const system = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
		const idx = (name: string) => {
			const exported = object.sections.rodata.moduleExports.find(item => item.path === path && item.exportPathKey === name);
			assert.ok(exported);
			return system.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
		};
		const dynamic = idx('dynamic'), constant = idx('constant');
		deriveBlua32FixedStack(system.image, [dynamic, constant]);
		const rom = join(directory, `O${opt}.rom`);
		writeFileSync(rom, system.romBytes);
		const aggregate = new Set<OpCode>();
		for (const [index, variant] of [[dynamic, 'dynamic'], [constant, 'constant']] as const) {
			const fn = system.image.functions[index];
			for (let pc = fn.codeAddress; pc < fn.codeAddress + fn.codeByteCount;) {
				const instruction = decodeBlua32InstructionAtPc(system.image.textBytes, system.image.header.textAddress, pc);
				if (instruction.c === MemoryAccessKind.Value) aggregate.add(instruction.op);
				pc = instruction.pc + 4;
			}
			for (const tag of [ValueTag.False, ValueTag.Table]) {
				const runtime = new Runtime({ systemRomBytes: system.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
				runtime.boot();
				const { cpu, memory, scheduler } = runtime.machine, arena = cpu.heapAllocator, management = arena.managementOffset();
				for (let i = 0; i < 64 && !cpu.isHaltedUntilIrq(); ++i) scheduler.runCpuSlice(0, 10_000, undefined, CpuRunKind.Direct);
				assert.ok(cpu.isHaltedUntilIrq());
				const cell = management + HEAP_SERVICE_VALUE_CELL_OFFSET;
				const word = tag === ValueTag.Table ? cpu.createTable(1, 0) : 0;
				memory.writeRamRecordWord(cell, word);
				memory.writeRamRecordByte(cell + HEAP_SERVICE_VALUE_CELL_TAG_OFFSET, tag);
				const prefix = join(directory, `O${opt}-${variant}-${tag}`);
				writeFileSync(`${prefix}.seed`, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
				const args = variant === 'dynamic' ? [management, rounds] : [rounds];
				const commands: string[] = ['X', `B ${fn.address} ${args.length} ${args.join(' ')}`], expected: string[] = ['1'];
				assert.equal(cpu.beginHeapService(fn.address, args), true);
				function record(cmd: string, row: string | number) { commands.push(cmd); expected.push(String(row)); }
				function grant(n: number) {
					const result = scheduler.runCpuSlice(0, n, undefined, CpuRunKind.Direct);
					assert.equal(result, RunResult.Yielded);
					assert.ok(n > cpu.instructionBudgetRemaining);
					record(`J ${n} 0`, `${result} ${n - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${memory.readRamRecordWord(management + HEAP_SERVICE_CLOSURE_OFFSET)} ${arena.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
				}
				for (let n = 0; n < 1024 && memory.readRamRecordByte(cell + HEAP_SERVICE_VALUE_CELL_TAG_OFFSET) !== ValueTag.Nil; ++n) grant(1);
				assert.ok(cpu.heapServiceActive());
				assert.equal(memory.readRamRecordWord(cell), 0);
				assert.equal(memory.readRamRecordByte(cell + HEAP_SERVICE_VALUE_CELL_TAG_OFFSET), ValueTag.Nil);
				const partialFile = `${prefix}.partial`, nativeFile = `${prefix}.native`;
				writeFileSync(partialFile, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
				const start = commands.length, first = expected.length;
				function settle() {
					for (let i = 0; i < 128 && cpu.heapServiceActive(); ++i) grant(cycles);
					assert.equal(cpu.heapServiceActive(), false);
					assert.equal(cpu.heapServiceResult(), tag === ValueTag.Table ? rounds : 0, 'Boolean false must not become the truthy Integer 0');
					assert.equal(memory.readRamRecordWord(cell), word);
					assert.equal(memory.readRamRecordByte(cell + HEAP_SERVICE_VALUE_CELL_TAG_OFFSET), tag);
					record(`H ${cell} ${cell + HEAP_SERVICE_VALUE_CELL_SIZE}`, hashBytes(memory.ramData(), cell, HEAP_SERVICE_VALUE_CELL_SIZE));
					const result = management + HEAP_SERVICE_RESULT_OFFSET;
					record(`H ${result} ${result + 4}`, hashBytes(memory.ramData(), result, 4));
				}
				settle();
				const tail = commands.slice(start), rows = expected.slice(first);
				function check(name: string, seed: string, trace: string[], want: string[], profile = false) {
					const file = `${prefix}-${name}.trace`;
					writeFileSync(file, [...trace, ...(profile ? [':'] : [])].join('\n'));
					const output = execFileSync(native, [rom, file, seed], { encoding: 'utf8' }).trimEnd().split('\n');
					if (profile) {
						const [entries, reads, writes] = output.pop()!.split(' ').map(Number);
						assert.ok(entries > 0 && reads > 4 && writes > 4, `actual private native Value load/store exits: ${entries}/${reads}/${writes}`);
					}
					const diff = output.findIndex((row, i) => row !== want[i]);
					assert.equal(diff, -1, `row ${diff}: C++=${output[diff]} TS=${want[diff]}`);
					assert.equal(output.length, want.length);
				}
				check('cold', `${prefix}.seed`, commands, expected, verifyNative);
				check('rewind', partialFile, ['X', 'l', 's', `x ${nativeFile}`, ...tail, 'u', ...tail], [...rows, ...rows]);
				applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeFile), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
				commands.length = start; expected.length = first;
				settle();
				assert.deepEqual(commands.slice(start), tail);
				assert.deepEqual(expected.slice(first), rows);
			}
		}
		for (const op of [OpCode.LOAD_MEM, OpCode.LOAD_MEM_D, OpCode.STORE_MEM, OpCode.STORE_MEM_D]) assert.ok(aggregate.has(op), `missing private memory opcode ${op}`);
		for (const reject of ['load', 'store'] as const) {
			const start = `function exception() halt_until_irq end\nhalt_until_irq\nlocal cell<const>: *value = ${address}\n${reject === 'load' ? 'return *cell' : '*cell = 1'}`;
			const ordinary = linkTestSystemBlua32(compileHeapServiceSystem(start, opt));
			const runtime = new Runtime({ systemRomBytes: ordinary.romBytes, cartridgeSlots: cartridgeSlots(), machineModel: PSX_MACHINE_SPEC }, input);
			runtime.boot();
			const { cpu, memory, scheduler } = runtime.machine, management = cpu.heapAllocator.managementOffset();
			for (let i = 0; i < 64 && !cpu.isHaltedUntilIrq(); ++i) scheduler.runCpuSlice(0, 10_000, undefined, CpuRunKind.Direct);
			assert.ok(cpu.isHaltedUntilIrq());
			assert.equal(cpu.readCauseWord(), 0);
			cpu.clearHaltUntilIrq();
			const cell = management + HEAP_SERVICE_VALUE_CELL_OFFSET;
			memory.writeRamRecordWord(cell, 17);
			memory.writeRamRecordByte(cell + HEAP_SERVICE_VALUE_CELL_TAG_OFFSET, ValueTag.False);
			const seed = join(directory, `O${opt}-${reject}.seed`), badRom = join(directory, `O${opt}-${reject}.rom`);
			writeFileSync(seed, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
			writeFileSync(badRom, ordinary.romBytes);
			const trace = ['X'], rows: string[] = [];
			for (let i = 0; i < 128 && (cpu.readCauseWord() & CPU_CAUSE_CODE_MASK) !== CPU_CAUSE_CODE_RESERVED_INSTRUCTION; ++i) {
				const result = scheduler.runCpuSlice(0, 1, undefined, CpuRunKind.Direct);
				trace.push('J 1 0');
				rows.push(`${result} ${1 - cpu.instructionBudgetRemaining} ${+cpu.heapServiceActive()} ${memory.readRamRecordWord(management + HEAP_SERVICE_CLOSURE_OFFSET)} ${cpu.heapAllocator.occupiedBytes()} ${cpu.luaHeap.usedBytes()}`);
			}
			assert.equal(cpu.readCauseWord() & CPU_CAUSE_CODE_MASK, CPU_CAUSE_CODE_RESERVED_INSTRUCTION);
			assert.equal(memory.readRamRecordWord(cell), 17);
			assert.equal(memory.readRamRecordByte(cell + HEAP_SERVICE_VALUE_CELL_TAG_OFFSET), ValueTag.False);
			trace.push('Z'); rows.push(`${cpu.readCauseWord()} ${cpu.readLuaFaultReasonWord()} ${cpu.readEpcWord()}`);
			const traceFile = join(directory, `O${opt}-${reject}.trace`);
			writeFileSync(traceFile, trace.join('\n'));
			assert.deepEqual(execFileSync(native, [badRom, traceFile, seed], { encoding: 'utf8' }).trimEnd().split('\n'), rows);
		}
		console.log(`BIOS-PRIVATE-VALUE:PASS O${opt} (both forms, genuine Table/false, exact grants, restricted ordinary execution, bidirectional restore)`);
	}
	rmSync(directory, { recursive: true });
} catch (error) {
	console.error(`Evidence retained: ${directory}`);
	throw error;
}
