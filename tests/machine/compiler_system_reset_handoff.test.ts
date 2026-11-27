import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readLE32 } from '../../machine/ts/common/endian';
import { CpuRunKind, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { IO_IRQ_MASK } from '../../machine/ts/spec/bmsx/io';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { buildBlua32Image } from '../../toolchain/ts/rompack/blua32_image_builder';
import { HEAP_SERVICE_MODULES } from '../../toolchain/ts/rompack/blua32_heap_service';
import { writeTestBlua32Rom } from '../helpers/blua32';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { loadHeapServiceTestModules } from '../helpers/heap_service_system';

const resetPath = 'kernel/test-reset', initPath = 'fixture/init';
const sources = new Map([
	['main', `module<entry>
local state<const> = require('fixture/state')
require('fixture/init')
local data<const>: *word = state.data
local clear<const>: *word = state.clear
return *data + 100 * *clear`],
	[resetPath, `
local state<const> = require('fixture/state')
local entry<const> = require('bmsx/startup')
local heap<const> = require('kernel/gc_full')
local data<const>: *word = state.data
local clear<const>: *word = state.clear
local irq_mask<const>: *word = ${IO_IRQ_MASK}
*data = 1001
*clear = 73
local occupied = heap.heap_bytes()
*irq_mask = occupied & 15
cop0.exec = entry.managed_entry
*irq_mask = 31
`],
	['fixture/state', `module<const>
data load_data: word[1] = { 41 }
bss clear_bss: word
return { data = load_data, clear = clear_bss }`],
	[initPath, `
local state<const> = require('fixture/state')
local data<const>: *word = state.data
local clear<const>: *word = state.clear
*clear = *data + *clear + 1
return true
`],
]);
const authored = [...sources].map(([path, source]) => ({path, displayPath: path + '.lua', source, chunk: parseLuaChunk(source, path)}));
const library = loadHeapServiceTestModules().map(module => ({...module, displayPath: module.path + '.lua'}));
const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };

for (const optLevel of [0, 3] as const) test('raw System reset body uses ordinary CALL and EXEC before DATA/BSS → modules → entry at O' + optLevel, () => {
	const built = buildBlua32Image({
		domain: 'system', luaModules: [...authored, ...library], generatedLuaModules: [], loadAddress: 0x100,
		ramByteCount: PSX_MACHINE_SPEC.ramBytes, optLevel, traceStatements: 'erase',
		resetModule: resetPath, preloadModules: HEAP_SERVICE_MODULES, biosExports: [],
	});
	const linked = built.linked, rom = writeTestBlua32Rom(linked);
	const reset = linked.layout.functions[linked.functionProtoIndices.indexOf(built.object.vectors.resetProtoIndex)];
	const managed = linked.layout.functions[linked.symbols.metadata.functionDisplayNames.indexOf('startup')];
	const initBinding = built.object.sections.rodata.moduleProtos.find(module => module.path === initPath)!;
	const initializer = linked.layout.functions[linked.functionProtoIndices.indexOf(initBinding.protoIndex)];
	const { dataAddress, bssAddress } = linked.layout.header;
	assert.ok(reset && managed && initializer && reset.address !== managed.address);
	assert.equal(readLE32(rom, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET), reset.address);
	assert.ok(built.object.link.constValueRelocs.some(reloc => reloc.kind === 'link_value'
		&& reloc.modulePath === 'bmsx/startup'
		&& reloc.expression.kind === 'export' && reloc.expression.exportPath === 'managed_entry'));

	const runtime = new Runtime({ systemRomBytes: rom, cartridgeSlots: [null, null], machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler } = runtime.machine;
	assert.equal(cpu.readFramePc(0), reset.codeAddress);
	// The current CPU may already have allocated before the first fetch.
	// Constrain every grant of the raw reset body, not that upstream seed.
	const physical = cpu.heapAllocator.occupiedBytes(), logical = cpu.luaHeap.usedBytes();
	let fixed = 0, previousFixed = false;
	const grant = (cycles: number) => {
		const result = scheduler.runCpuSlice(0, cycles, undefined, CpuRunKind.Scheduled);
		const active = cpu.heapServiceActive();
		if (active && !previousFixed) ++fixed;
		previousFixed = active;
		return result;
	};
	for (let step = 0; step < 8192 && cpu.readFramePc(0) !== managed.codeAddress; ++step) {
		assert.equal(grant(cpu.heapServiceActive() ? 123 : 1), RunResult.Yielded);
		assert.equal(cpu.heapAllocator.occupiedBytes(), physical);
		assert.equal(cpu.luaHeap.usedBytes(), logical);
	}
	assert.equal(cpu.readFramePc(0), managed.codeAddress);
	assert.equal(cpu.getFrameDepth(), 1);
	assert.equal(cpu.activeThread.currentFrame!.functionAddress, managed.address);
	assert.equal(cpu.activeThread.currentFrame!.closureAddress, 0);
	assert.equal(fixed, 2, 'the real ordinary resident CALL and EXEC floor activation are separate');
	assert.equal(memory.readMappedWord(IO_IRQ_MASK), logical & 15, 'EXEC never retires the reset successor');
	assert.equal(memory.readMappedWord(dataAddress), 1001);
	assert.equal(memory.readMappedWord(bssAddress), 73);

	for (let step = 0; step < 8192 && cpu.readFramePc(cpu.getFrameDepth() - 1) !== initializer.codeAddress; ++step)
		assert.equal(grant(cpu.heapServiceActive() ? 123 : 1), RunResult.Yielded);
	assert.equal(cpu.readFramePc(cpu.getFrameDepth() - 1), initializer.codeAddress);
	assert.equal(memory.readMappedWord(dataAddress), 41, 'section init copied DATA before modules');
	assert.equal(memory.readMappedWord(bssAddress), 0, 'section init cleared BSS before modules');
	for (let step = 0; step < 512 && cpu.getFrameDepth(); ++step) grant(123);
	assert.equal(cpu.heapServiceActive(), false);
	assert.deepEqual(runtime.readCompletionValues(), [valueInteger(4241)]);
	assert.equal(memory.readMappedWord(bssAddress), 42, 'module initializer ran exactly once before entry');
});
