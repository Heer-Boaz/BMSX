import { nativeHeapReference } from '../../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { HEAP_STRING_METADATA_OFFSET } from '../../../machine/ts/machine/cpu/heap_allocator';
import { ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { IO_IRQ_MASK } from '../../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, MAIN_RAM_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

const source = `
bss report: word[4]
local object = {}
local captured = function() return object end
local thread = (coroutine.running())
local function classify(object, captured, thread)
	local kind, number_kind = type, math.type
	report[2] = blua32.tag(kind)
	report[3] = blua32.tag(number_kind)
	local boolean_kind = kind(false)
	local byte = string.byte
	return kind() == 'nil' and kind(nil) == 'nil'
		and kind(true) == boolean_kind and #boolean_kind == 7
		and byte(boolean_kind, 1) == 0x62 and byte(boolean_kind, 2) == 0x6f and byte(boolean_kind, 3) == 0x6f
		and byte(boolean_kind, 4) == 0x6c and byte(boolean_kind, 5) == 0x65
		and byte(boolean_kind, 6) == 0x61 and byte(boolean_kind, 7) == 0x6e
		and kind(12) == 'number' and kind(12.0) == 'number'
		and kind('hello') == 'string' and kind(object) == 'table'
		and kind(captured) == 'function' and kind(next) == 'function'
		and kind(kind) == 'function' and kind(thread) == 'thread'
		and number_kind() == nil and number_kind('12') == nil
		and number_kind(12) == 'integer' and number_kind(12.0) == 'float'
		and number_kind(blua32.float_from_bits(0x7fc12345)) == 'float'
end
report[0] = classify(object, captured, thread) and 1 or -1
mem[${IO_IRQ_MASK}] = 0
while report[1] == 0 do halt_until_irq end
report[0] = classify(object, captured, thread) and 2 or -2
while true do halt_until_irq end
`;

test('stock type and math.type classify a cartridge’s values without allocating in a full arena', t => {
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-stock-value-type-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
		'--mode', 'bios', '-respath', 'machine/bios/res', '--debug', '-O3',
		'--output-dir', dir, '--store-dir', join(dir, 'store')], { encoding: 'utf8' });
	const systemPath = join(dir, 'system', 'bmsx-bios.debug.rom');
	const system = readFileSync(systemPath);
	const program = compileLuaChunkToProgram(parseLuaChunk(source, 'value-type.lua'), [], { entrySource: source, optLevel: 3 });
	const cart = linkCartBlua32Image(readBlua32BiosImports(system), encodeCompiledProgramObject(program), program.metadata,
		CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
	const cartPath = join(dir, 'cart.rom'), cartBytes = writeTestBlua32Rom(cart);
	writeFileSync(cartPath, cartBytes);
	const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cartBytes), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler, gxGpu } = runtime.machine, arena = nativeHeapReference(cpu).heapAllocator;
	const report = cart.layout.header.bssAddress, offset = report - RAM_BASE;
	for (let grant = 0; grant < 1024 && !(cpu.activeCartridgeSlot() === 0 && cpu.isHaltedUntilIrq()); ++grant) {
		if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
		runtime.frameScheduler.runCyclesToNextLogicalTick(65536);
	}
	assert.equal(cpu.activeCartridgeSlot(), 0);
	assert.ok(cpu.isHaltedUntilIrq());
	assert.equal(memory.readMappedU32LE(report), 1, 'the unpressured pass warmed the same frames');
	nativeHeapReference(cpu).luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
	for (let bytes = MAIN_RAM_SIZE >>> 1; bytes !== 0; bytes >>>= 1) {
		while (arena.allocate(bytes, true)) { /* exhaust physical backing */ }
	}
	assert.equal(arena.allocate(1, true), 0, 'no physical allocation fits');
	const occupied = arena.occupiedBytes(), logical = cpu.luaHeap.usedBytes();
	const first = arena.managementOffset() + HEAP_STRING_METADATA_OFFSET;
	const end = arena.allocatorStateOffset();
	const ledger = hashBytes(memory.ramData(), first, end - first);
	const state = join(dir, 'start.state');
	writeFileSync(state, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));

	memory.writeMappedU32LE(report + 4, 1);
	cpu.clearHaltUntilIrq();
	const budget = 4096, result = scheduler.runCpuSlice(0, budget, 0, CpuRunKind.Scheduled);
	assert.equal(memory.readMappedU32LE(report), 2, 'all classifications still return from ordinary firmware calls');
	for (const slot of [2, 3]) {
		const tag = memory.readMappedU32LE(report + 4 * slot);
		assert.ok(tag === ValueTag.Closure || tag === ValueTag.CodeFunction, 'the public function is ordinary guest code');
	}
	assert.ok(cpu.isHaltedUntilIrq());
	assert.equal(arena.occupiedBytes(), occupied);
	assert.equal(cpu.luaHeap.usedBytes(), logical);
	assert.equal(hashBytes(memory.ramData(), first, end - first), ledger, 'no string index or collector administration changed');

	const trace = join(dir, 'trace');
	writeFileSync(trace, ['X', `W ${offset + 4} 1`, 'h', `L ${budget}`, `H ${first} ${end}`, `H ${offset} ${offset + 16}`].join('\n'));
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	assert.deepEqual(execFileSync(native, [systemPath, trace, state, cartPath], { encoding: 'utf8' }).trimEnd().split('\n'), [
		[result, budget - cpu.instructionBudgetRemaining, 0, cpu.gc.fullEpochs(), cpu.gc.phase(), logical].join(' '),
		String(ledger),
		String(hashBytes(memory.ramData(), offset, 16)),
	]);
});
