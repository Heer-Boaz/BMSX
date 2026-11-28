import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashBytes, hashText } from '../../../machine/ts/common/hash';
import { FRAME_CONTROL_BYTES, FrameField } from '../../../machine/ts/machine/cpu/call_state';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { GC_DIAGNOSTIC_OFFSET } from '../../../machine/ts/machine/cpu/gc_heap';
import { TableHeader } from '../../../machine/ts/machine/cpu/table';
import { THREAD_RECORD_KIND, ThreadField, ThreadStatus } from '../../../machine/ts/machine/cpu/thread_record';
import { ValueTag, valueBool, valueInteger, valuePayload, valueString, valueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { applyRuntimeSaveState, captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import {
		EXECUTION_IMAGE_BINDING_ORDINARY_OFFSET, EXECUTION_IMAGE_BINDING_SYSTEM_OFFSET, EXECUTION_IMAGE_BINDING_STRINGS_OFFSET,
	GLOBAL_BANK_OFFSET, GlobalBankField, SYSTEM_GLOBAL_BANK_OFFSET,
	SYSTEM_EXECUTION_DOMAIN_ID, executionImageBindingOffset,
} from '../../../machine/ts/spec/blua32/execution_domain';
import {
	BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_MAX_STACK_OFFSET, BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_LENGTH_OFFSET,
	BLUA32_STRING_RECORD_HEADER_SIZE, BLUA32_STRING_RECORD_KIND,
} from '../../../machine/ts/spec/blua32/image_format';
import { BASE_CYCLES, OpCode, TABLE_INDEX_VISIT_CYCLES } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_FIXED_STACK_BASE, CPU_RESET_BANK_ADDRESS, RAM_BASE, SYSTEM_ROM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { buildBlua32Image } from '../../../toolchain/ts/rompack/blua32_image_builder';
import { decodeBlua32InstructionAtPc } from '../../../toolchain/ts/rompack/blua32_instruction_decode';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

// These addresses deliberately overlap the stock BIOS's software state, not
// the fixed CPU bank. This ROM uses its own format and never links stock code.
const collector = CPU_FIXED_STACK_BASE + 0x344;
const allocator = CPU_FIXED_STACK_BASE + 0x400;
const slotBytes = 0x80, slotWords = slotBytes / 4;
const first = CPU_FIXED_STACK_BASE - 0x200, second = first + slotBytes, unreachable = second + slotBytes;
const context = first - 0x200, frames = context + 0x60, values = frames + 2 * FRAME_CONTROL_BYTES, valueCount = 48;
const stringKey = second + 0x10;
const array = unreachable + 0x30, hash = unreachable + 0x40;
const meta = first + 0x10, metaHash = first + 0x30, lookupKey = first + 0x50;
const inherited = second + 0x28, inheritedArray = second + 0x48;
const receiverCell = unreachable + 0x50, keyCell = receiverCell + 8;
const globalDescriptor = CPU_FIXED_STACK_BASE + GLOBAL_BANK_OFFSET;
const systemDescriptor = CPU_FIXED_STACK_BASE + SYSTEM_GLOBAL_BANK_OFFSET;
const systemBinding = RAM_BASE + executionImageBindingOffset(SYSTEM_EXECUTION_DOMAIN_ID);
const globalValues = CPU_FIXED_STACK_BASE - 0x60, globalCapacity = 4, globalOrdinal = 2;
const globalNeighborTags = ValueTag.Integer | (ValueTag.Integer << 8);
const initialGlobalTags = globalNeighborTags | (ValueTag.False << 16);
const updatedGlobalTags = globalNeighborTags | (ValueTag.Integer << 16);
const ordinalMap = CPU_FIXED_STACK_BASE + 0x600, systemOrdinalMap = CPU_FIXED_STACK_BASE + 0x630;
const literalIds = CPU_FIXED_STACK_BASE + 0x650, systemValues = CPU_FIXED_STACK_BASE + 0x6c0, systemOrdinal = 3;
const systemNeighborTags = ValueTag.Integer | (ValueTag.Integer << 8) | (ValueTag.Integer << 16);
const initialSystemTags = systemNeighborTags | (ValueTag.True << 24);
const updatedSystemTags = systemNeighborTags | (ValueTag.Integer << 24);
const signature = 0x61b10f4d, sweeping = 0x5a51000d, settled = 0x5a510015, tableReady = 0x5a510020;
const reset = `
local startup<const> = require('bmsx/startup')
local initialize<const> = function()
	local pool<const>: *u32 = ${allocator}
	pool[0], pool[1] = ${signature}, 0
	local nodes<const>: *u32 = ${first}
	nodes[0], nodes[${slotWords}], nodes[${2 * slotWords}] = ${second}, 0, ${first}
	nodes[1], nodes[${slotWords + 1}], nodes[${2 * slotWords + 1}] = 0, 0, 0
	nodes[2], nodes[${slotWords + 2}], nodes[${2 * slotWords + 2}] = 31, 59, 73
end
local collect<const> = function(root)
	local state<const>: *u32 = ${collector}
	local pool<const>: *u32 = ${allocator}
	local cursor = root
	while cursor ~= 0 do
		local object<const>: *u32 = cursor
		object[1] = 1
		cursor = object[0]
	end
	state[0] = ${sweeping}
	for address = ${first}, ${unreachable}, ${slotBytes} do
		local object<const>: *u32 = address
		if object[1] == 0 then
			object[0] = pool[1]
			pool[1] = address
		end
	end
	state[0] = ${settled}
end
local take<const> = function()
	local pool<const>: *u32 = ${allocator}
	local result<const> = pool[1]
	if result == 0 then return 0 end
	local free<const>: *u32 = result
	pool[1] = free[0]
	return result
end
-- This firmware chooses its own key, with no stock String bank or roots.
local lookup_key<const>: *u32 = ${lookupKey}
lookup_key[0] = ${BLUA32_STRING_RECORD_KIND}
lookup_key[${BLUA32_STRING_HASH_OFFSET / 4}] = ${hashText('read') | 0}
lookup_key[${BLUA32_STRING_LENGTH_OFFSET / 4}] = 4
lookup_key[${BLUA32_STRING_RECORD_HEADER_SIZE / 4}] = 0x64616572
local other<const>: *u32 = ${inherited}
other[0], other[${TableHeader.Array / 4}], other[${TableHeader.ArrayStorage / 4}] = ${ValueTag.Table}, 3, ${inheritedArray}
local inherited_values<const>: *u32 = ${inheritedArray}
inherited_values[2], inherited_values[3] = 113, ${ValueTag.Integer << 16}
cop0.table_lookup_key = ${lookupKey}
cop0.table_assign_key = ${lookupKey}
cop0.string_index_table = ${inherited}

-- Each linked ordinal maps to its own register window. The three
-- resolved operand tables need not share an allocation.
local globals<const>: *u32 = ${globalDescriptor}
globals[${GlobalBankField.Values / 4}], globals[${GlobalBankField.Capacity / 4}], globals[${GlobalBankField.Count / 4}] = ${globalValues}, ${globalCapacity}, 3
local global_values<const>: *u32 = ${globalValues}
global_values[0], global_values[1], global_values[${globalOrdinal}], global_values[${globalCapacity}] = 23, 47, 0, ${initialGlobalTags}
local system<const>: *u32 = ${systemDescriptor}
system[${GlobalBankField.Values / 4}], system[${GlobalBankField.Capacity / 4}], system[${GlobalBankField.Count / 4}] = ${systemValues}, ${globalCapacity}, 4
local system_values<const>: *u32 = ${systemValues}
system_values[0], system_values[1], system_values[2], system_values[${systemOrdinal}], system_values[${globalCapacity}] =
	17, 29, 43, 0, ${initialSystemTags}
local ordinal<const>: *u32 = ${ordinalMap}
ordinal[0], ordinal[1] = ${globalOrdinal}, 1
local system_ordinal<const>: *u32 = ${systemOrdinalMap}
system_ordinal[0], system_ordinal[1], system_ordinal[2] = 1, ${systemOrdinal}, 2
local literal_ids<const>: *u32 = ${literalIds}
literal_ids[0], literal_ids[1] = ${lookupKey}, ${stringKey}
local installed<const>: *u32 = ${systemBinding}
installed[${EXECUTION_IMAGE_BINDING_ORDINARY_OFFSET / 4}], installed[${EXECUTION_IMAGE_BINDING_SYSTEM_OFFSET / 4}] = ${ordinalMap}, ${systemOrdinalMap}
installed[${EXECUTION_IMAGE_BINDING_STRINGS_OFFSET / 4}] = ${literalIds}
initialize()
collect(${first})
local reused<const>, exhausted<const> = take(), take()
local nodes<const>: *u32 = ${first}
local reclaimed<const> = nodes[${2 * slotWords + 2}]

-- The reclaimed cell holds the receiver, and retained cells supply its
-- metatable and inherited Table.
local meta<const>: *u32 = ${meta}
meta[0], meta[${TableHeader.Hash / 4}], meta[${TableHeader.HashStorage / 4}] = ${ValueTag.Table}, 1, ${metaHash}
local meta_fields<const>: *u32 = ${metaHash}
meta_fields[0], meta_fields[1], meta_fields[2] = ${lookupKey}, ${inherited}, ${ValueTag.String | (ValueTag.Table << 8) | (0xff << 16)}

local text<const>: *u32 = ${stringKey}
text[0] = ${BLUA32_STRING_RECORD_KIND}
text[${BLUA32_STRING_HASH_OFFSET / 4}] = ${hashText('k') | 0}
text[${BLUA32_STRING_LENGTH_OFFSET / 4}] = 1
text[${BLUA32_STRING_RECORD_HEADER_SIZE / 4}] = 0x6b
local header<const>: *u32 = reused
header[0] = ${ValueTag.Table}
header[${TableHeader.Metatable / 4}] = ${meta}
header[${TableHeader.Array / 4}], header[${TableHeader.ArrayStorage / 4}] = 2, reused + 0x30
header[${TableHeader.Hash / 4}], header[${TableHeader.HashStorage / 4}] = 1, reused + 0x40
header[${TableHeader.Length / 4}], header[${TableHeader.Free / 4}] = 2, 0
local body<const>: *u32 = reused + 0x30
body[0], body[1], body[2] = 37, 59, ${ValueTag.Integer | (ValueTag.Integer << 8)}
local fields<const>: *u32 = reused + 0x40
fields[0], fields[1], fields[2] = ${stringKey}, 79, ${ValueTag.String | (ValueTag.Integer << 8) | (0xff << 16)}
local cells<const>: *u32 = reused + 0x50
cells[0], cells[1], cells[2], cells[3] = reused, ${ValueTag.Table}, ${stringKey}, ${ValueTag.String}

-- The direct reset code is scalar. Publish ordinary physical frame/value
-- records for the table instructions; this ROM's allocator is not involved.
local fn<const>: *u32 = startup.table_exercise
local pc<const>, window<const> = fn[${BLUA32_FUNCTION_CODE_ADDRESS_OFFSET / 4}], fn[${BLUA32_FUNCTION_MAX_STACK_OFFSET / 4}]
local thread<const>: *u32 = ${context}
thread[0], thread[${ThreadField.Status / 4}] = ${THREAD_RECORD_KIND}, ${ThreadStatus.Running}
thread[${ThreadField.StackTop / 4}], thread[${ThreadField.StackBlock / 4}], thread[${ThreadField.StackCapacity / 4}] = window, ${values}, ${valueCount}
thread[${ThreadField.FrameCapacity / 4}], thread[${ThreadField.FrameDepth / 4}], thread[${ThreadField.FrameBlock / 4}] = 2, 1, ${frames}
local frame<const>: *u32 = ${frames}
frame[${FrameField.Function / 4}], frame[${FrameField.CallSite / 4}], frame[${FrameField.Pc / 4}] = startup.table_exercise, pc, pc
frame[${FrameField.VarargBase / 4}], frame[${FrameField.ArgumentCount / 4}], frame[${FrameField.Top / 4}], frame[${FrameField.StackCapacity / 4}] = 3, 3, 3, window
local arguments<const>: *u32 = ${values}
arguments[0], arguments[1], arguments[2] = reused, exhausted, reclaimed
arguments[${valueCount}] = ${ValueTag.Integer | (ValueTag.Integer << 8) | (ValueTag.Integer << 16)}
local state<const>: *u32 = ${collector}
state[0] = ${tableReady}
cop0.context = ${context}`;
const tableExercise = `
return function(reused, exhausted, reclaimed)
	local nodes<const>: *u32 = ${first}
	local table_ref<const>: *value = reused + 0x50
	local key_ref<const>: *value = reused + 0x58
	local target<const>, key<const> = *table_ref, *key_ref
	local old_array<const>, old_field<const> = target[2], target[key]
	target[2] = 91
	target[key] = 107
	local own_array<const>, own_field<const>, size<const>, key_size<const> = target[2], target[key], #target, #key
	local string_field<const> = key[3]
	local inherited<const> = target[3]
	cop0.table_lookup_key = 0
	local disabled<const> = target[3] or 0
	cop0.table_lookup_key = ${lookupKey}
	target[3] = 137
	local initial_global<const> = independent_counter
	independent_counter = 158
	local initial_system<const> = irq
	irq = 211
	return reused, exhausted, nodes[2], nodes[${slotWords + 2}], reclaimed, old_array, old_field,
		own_array, own_field, size, key_size, string_field, inherited, disabled, target[3],
		initial_global, independent_counter, initial_system, irq, 'read', 'k'
end`;
const modules = [['main', 'module<entry>\nreturn 0'], ['reset', reset],
	['table-exercise', tableExercise], ['irq', 'halt_until_irq'], ['exception', 'halt_until_irq']].map(([path, source]) =>
	({ path, displayPath: path + '.lua', source, chunk: parseLuaChunk(source, path) }));

const dir = mkdtempSync(join(tmpdir(), 'bmsx-independent-firmware-'));
try {
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	for (const optLevel of [0, 3] as const) {
		const { linked } = buildBlua32Image({
			domain: 'system', luaModules: modules, generatedLuaModules: [], loadAddress: 0x100,
			ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel, traceStatements: 'erase',
			resetModule: 'reset', irqModule: 'irq', exceptionModule: 'exception', biosExports: [],
			managedEntries: [{ path: 'table-exercise', symbol: 'table_exercise' }],
		});
		assert.equal(linked.layout.header.globalNameCount, 1, 'the independent firmware supplies exactly one linked ordinary ordinal');
		assert.deepEqual(linked.layout.systemGlobalNames, ['table_exercise', 'irq', 'exception']);
		const stringSlots = linked.layout.constants.flatMap((value, slot) => typeof value === 'string' ? [slot] : []);
		assert.deepEqual(stringSlots.map(slot => linked.layout.constants[slot]), ['read', 'k']);
		const romBytes = writeTestBlua32Rom(linked);
		const runtime = new Runtime({ systemRomBytes: romBytes, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, {
			sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
		});
		runtime.boot();
		const { cpu, scheduler, memory, executionAddressSpace } = runtime.machine;
		const raw = memory.ramData();
		const allocatorOffset = allocator - RAM_BASE, collectorOffset = collector - RAM_BASE;
		const globalOffset = globalValues - RAM_BASE, globalBytes = 5 * globalCapacity;
		const diagnostics = CPU_FIXED_STACK_BASE - RAM_BASE + GC_DIAGNOSTIC_OFFSET;
		assert.deepEqual(raw.subarray(allocatorOffset, allocatorOffset + 32), new Uint8Array(32));
		assert.equal(memory.readRamRecordWord(collector), 0);
		const rom = join(dir, `system-O${optLevel}.rom`), trace = join(dir, `trace-O${optLevel}.txt`);
		const tsState = join(dir, `O${optLevel}.state`), nativeState = join(dir, `O${optLevel}.native`);
		const commands: string[] = [], observations: string[] = [];
		function grant(budget: number, expected: RunResult) {
			assert.equal(scheduler.runCpuSlice(0, budget, 0, CpuRunKind.Scheduled), expected);
			// Sample only machine state; the stock allocation diagnostics may
			// not interpret this ROM's different software representation.
			commands.push(`E ${budget}`);
			const paid = budget - cpu.instructionBudgetRemaining;
			observations.push(`${expected} ${paid} ${memory.ramBusEnd()} ${cpu.activeCartridgeSlot()}`);
			return paid;
		}
		function fingerprint() {
			for (const [offset, count] of [[allocatorOffset, 32], [collectorOffset, 4], [first - RAM_BASE, 3 * slotBytes], [diagnostics, 36],
				[globalOffset - 48, globalBytes + 96], [globalDescriptor - RAM_BASE, 12], [systemDescriptor - RAM_BASE, 12],
				[systemBinding - RAM_BASE, 16], [CPU_FIXED_STACK_BASE - RAM_BASE + 0x250, 36],
				[ordinalMap - RAM_BASE, 8], [systemOrdinalMap - RAM_BASE, 12], [literalIds - RAM_BASE, 8], [systemValues - RAM_BASE, globalBytes]]) {
				commands.push(`H ${offset} ${offset + count}`);
				observations.push(String(hashBytes(raw, offset, count)));
			}
		}
		fingerprint();
		for (let step = 0; step < 512; ++step) {
			grant(1, RunResult.Yielded);
			if (memory.readRamRecordWord(collector) === sweeping && memory.readRamRecordWord(unreachable) === 0) break;
		}
		assert.equal(memory.readRamRecordWord(collector), sweeping);
		assert.equal(cpu.rootThread.address, CPU_RESET_BANK_ADDRESS);
		assert.equal(memory.readRamRecordWord(first), second);
		assert.deepEqual([first, second, unreachable].map(address => memory.readRamRecordWord(address + 4)), [1, 1, 0]);
		assert.equal(memory.readRamRecordWord(unreachable), 0, 'the free block link has been stored');
		assert.equal(memory.readRamRecordWord(allocator + 4), 0, 'the sweep has not published the free head yet');
		assert.equal(memory.readRamRecordWord(allocator), signature);
		fingerprint();
		const midpoint = captureRuntimeSaveState(runtime);
		writeFileSync(tsState, encodeRuntimeSaveState(midpoint));
		commands.push('S', `x ${nativeState}`);
		const result = [unreachable, 0, 31, 59, 73, 59, 79, 91, 107, 2, 1, 113, 113, 0, 137].map(valueInteger);
		result.push(valueBool(false), valueInteger(158), valueBool(true), valueInteger(211), valueString(lookupKey), valueString(stringKey));
		const ownOps = [OpCode.GETI, OpCode.GETT, OpCode.SETI, OpCode.SETT, OpCode.GETI, OpCode.GETT, OpCode.LEN, OpCode.LEN, OpCode.GETI];
		const expectedTableOps = [...ownOps.map(op => [op, BASE_CYCLES[op]]),
			[OpCode.GETI, BASE_CYCLES[OpCode.GETI] + TABLE_INDEX_VISIT_CYCLES],
			[OpCode.GETI, BASE_CYCLES[OpCode.GETI]],
			[OpCode.SETI, BASE_CYCLES[OpCode.SETI] + TABLE_INDEX_VISIT_CYCLES],
			[OpCode.GETI, BASE_CYCLES[OpCode.GETI] + TABLE_INDEX_VISIT_CYCLES]];
		function finish() {
			const start = observations.length;
			for (let step = 0; step < 256 && cpu.rootThread.address === CPU_RESET_BANK_ADDRESS; ++step) grant(1, RunResult.Yielded);
			assert.equal(cpu.rootThread.address, context);
			assert.equal(memory.readRamRecordWord(collector), tableReady);
			assert.equal(memory.readRamRecordWord(receiverCell), unreachable, 'the raw sweep returned the Table storage to the independent ROM');
			assert.equal(memory.readRamRecordWord(keyCell), stringKey);
			assert.equal(memory.readRamRecordWord(array + 4), 59);
			assert.equal(memory.readRamRecordWord(hash + 4), 79);
			assert.equal(memory.readRamRecordWord(globalValues + 4 * globalOrdinal), 0, 'the saved Value is live before SETGL');
			assert.equal(memory.readRamRecordWord(globalValues + 4 * globalCapacity), initialGlobalTags);
			assert.equal(memory.readRamRecordWord(systemValues + 4 * globalCapacity), initialSystemTags);
			fingerprint();
			const tableOps: [OpCode, number][] = [];
			const globalOps: [OpCode, number][] = [];
			const literalLoads: [number, number][] = [];
			for (let step = 0; step < 128; ++step) {
				const pc = cpu.readFramePc(0);
				const { op, bx } = decodeBlua32InstructionAtPc(romBytes, SYSTEM_ROM_BASE, pc);
				const paid = grant(1, op === OpCode.RET ? RunResult.Halted : RunResult.Yielded);
				if (op === OpCode.RET) break;
				if (op === OpCode.GETI || op === OpCode.GETT || op === OpCode.SETI || op === OpCode.SETT || op === OpCode.LEN) {
					tableOps.push([op, paid]);
				} else if (op === OpCode.GETGL || op === OpCode.SETGL || op === OpCode.GETSYS || op === OpCode.SETSYS) {
					globalOps.push([op, paid]);
				} else if (op === OpCode.LOADK && stringSlots.includes(bx)) {
					literalLoads.push([bx, paid]);
				}
			}
			assert.deepEqual(tableOps, expectedTableOps, 'the custom key controls exactly one extra charged visit');
			assert.deepEqual(globalOps, [OpCode.GETGL, OpCode.SETGL, OpCode.GETSYS, OpCode.SETSYS, OpCode.GETGL, OpCode.GETSYS]
				.map(op => [op, BASE_CYCLES[op]]));
			assert.deepEqual(literalLoads, stringSlots.map(slot => [slot, BASE_CYCLES[OpCode.LOADK]]));
			assert.deepEqual(runtime.readCompletionValues(), result);
			assert.equal(cpu.captureRuntimeState().hardHalted, false);
			assert.equal(cpu.readLuaFaultReasonWord(), 0);
			assert.equal(memory.readRamRecordWord(collector), tableReady);
			assert.equal(memory.readRamRecordWord(allocator), signature);
			assert.equal(memory.readRamRecordWord(allocator + 4), 0);
			assert.deepEqual(raw.subarray(allocatorOffset + 8, allocatorOffset + 32), new Uint8Array(24));
			assert.deepEqual(raw.subarray(diagnostics, diagnostics + 36), new Uint8Array(36), 'stock diagnostic roots are never installed');
			assert.equal(memory.readRamRecordWord(array + 4), 91, 'SETI updates the authored Array storage');
			assert.equal(memory.readRamRecordWord(hash + 4), 107, 'SETT updates the authored own hash node');
			assert.equal(memory.readRamRecordWord(inheritedArray + 8), 137, 'SETI follows the authored assignment key');
			assert.deepEqual([0, 1, 2, 3, globalCapacity].map(slot => memory.readRamRecordWord(globalValues + 4 * slot)),
				[23, 47, 158, 0, updatedGlobalTags], 'only the linked global Value was mutated, including its split tag');
			assert.deepEqual(raw.subarray(globalOffset - 48, globalOffset), new Uint8Array(48));
			assert.deepEqual(raw.subarray(globalOffset + globalBytes, globalOffset + globalBytes + 48), new Uint8Array(48),
				'neither former compound-storage lane is needed by the CPU');
			assert.deepEqual([0, 4].map(offset => memory.readRamRecordWord(literalIds + offset)), [lookupKey, stringKey]);
			assert.deepEqual([0, 1, 2, 3, globalCapacity].map(slot => memory.readRamRecordWord(systemValues + 4 * slot)),
				[17, 29, 43, 211, updatedSystemTags], 'the system operand did not use the word after the ordinary table');
			const stockBacking = CPU_FIXED_STACK_BASE - RAM_BASE + 0x250;
			assert.deepEqual(raw.subarray(stockBacking, stockBacking + 36), new Uint8Array(36),
				'the alternative firmware publishes no stock reservation or collector extent');
			fingerprint();
			commands.push('c');
			observations.push([result.length, ...result.flatMap(value => [valueTag(value), valuePayload(value)])].join(' '));
			return observations.slice(start);
		}
		const ending = finish();
		// After execution has retired, attach the same executable using
		// only the operand planes, with no allocation record to consult.
		const beforePublication = hashBytes(raw, 0, raw.length);
		memory.installSystemRom(romBytes);
		cpu.replaceExecutionImages([executionAddressSpace.resolveSystemDomain()]);
		assert.equal(hashBytes(raw, 0, raw.length), beforePublication);
		commands.push(`+ ${rom}`);
		observations.push('1 0 0 0 0');
		applyRuntimeSaveState(runtime, midpoint);
		commands.push('U');
		assert.deepEqual(finish(), ending);
		applyRuntimeSaveState(runtime, midpoint);
		commands.push('X');
		assert.deepEqual(finish(), ending);
		writeFileSync(rom, romBytes);
		writeFileSync(trace, commands.join('\n'));
		const out = execFileSync(native, [rom, trace, tsState], { encoding: 'utf8' }).trimEnd().split('\n');
		assert.deepEqual(out, observations);
		applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(nativeState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
		assert.deepEqual(finish(), ending);
		console.log(`INDEPENDENT-SYSTEM-ROM:PASS O${optLevel} (private allocator and collector, local table keys, independent operand planes; portable RAM and cycle parity)`);
	}
	rmSync(dir, { recursive: true });
} catch (error) {
	console.error(`Evidence retained at ${dir}`);
	throw error;
}
