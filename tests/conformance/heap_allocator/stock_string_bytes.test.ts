import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { hashBytes } from '../../../machine/ts/common/hash';
import { CpuRunKind, RunResult } from '../../../machine/ts/machine/cpu/cpu';
import { valuePayload, valueTag, ValueTag } from '../../../machine/ts/machine/cpu/value';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import { encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { CPU_CAUSE_CODE_SYSCALL } from '../../../machine/ts/spec/blua32/cop0';
import { BLUA32_STRING_HASH_OFFSET, BLUA32_STRING_RECORD_HEADER_SIZE } from '../../../machine/ts/spec/blua32/image_format';
import { IO_CART_SELECT, IO_IRQ_FLAGS, IO_IRQ_MASK } from '../../../machine/ts/spec/bmsx/io';
import { CART_RAM_BASE, CART_ROM_BASE, MAIN_RAM_SIZE, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';

test('stock string.from_bytes admits the public bus, then resumes a mutable-source copy and interns under pressure', t => {
	const dir = mkdtempSync(join(tmpdir(), 'bmsx-stock-string-bytes-'));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
		'--mode', 'bios', '-respath', 'machine/bios/res', '--debug', '-O3', '--output-dir', dir,
		'--store-dir', join(dir, 'store')], { encoding: 'utf8' });
	const systemPath = join(dir, 'system', 'bmsx-bios.debug.rom');
	const system = readFileSync(systemPath);
	const size = 1025, bank0Word = 'installed-slot-zero-string', other = Buffer.from(bank0Word, 'ascii');
	const source = `
struct probe_record
	stage: u32
	ready: u32
	data: u8[${size}]
end
bss probe: probe_record
local state<const>: *probe_record = probe
local source<const> = probe + offsetof(probe_record.data)
local from = string.from_bytes
local function invalid(address, count)
	local ok, reason = pcall(from, address, count)
	return not ok and reason == 'Invalid argument.'
end
mem[${IO_IRQ_MASK}] = 0
assert(from(-1, 0) == '' and from(${IO_IRQ_FLAGS}, 0) == '')
assert(invalid(${IO_IRQ_FLAGS}, 1) and invalid(0, -1) and invalid('0', 0))
assert(string.byte(from(${system.length - 1}.0, 1.0)) == ${system[system.length - 1]})
assert(invalid(${system.length - 1}, 2))
mem[${IO_CART_SELECT}] = 1
local media = from(${CART_ROM_BASE}, ${other.length})
assert(media == '${bank0Word}' and invalid(${CART_ROM_BASE}, ${other.length + 1}) and invalid(${CART_RAM_BASE}, 1))
collectgarbage()
state.stage = 1
while state.ready == 0 do halt_until_irq end
local copied = from(source, ${size})
state.stage = 2
while state.ready == 1 do halt_until_irq end
local reused = from(source, ${size})
local ok, reason = pcall(from, source + 4, ${size - 4})
return copied, reused, media, ok, reason
`;
	const program = compileLuaChunkToProgram(parseLuaChunk(source, 'string-bytes.lua'), [], { entrySource: source, optLevel: 3 });
	const cart = linkCartBlua32Image(readBlua32BiosImports(system), encodeCompiledProgramObject(program), program.metadata,
		CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
	const cartBytes = writeTestBlua32Rom(cart);
	const cartPath = join(dir, 'cart.rom'), otherPath = join(dir, 'slot1.rom');
	writeFileSync(cartPath, cartBytes);
	writeFileSync(otherPath, other);
	const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cartBytes, other), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {},
	});
	runtime.boot();
	const { cpu, memory, scheduler, gxGpu } = runtime.machine, arena = cpu.heapAllocator;
	const report = cart.layout.header.bssAddress, data = report + 8;
	const readStage = () => memory.readRamRecordWord(report);
	for (let i = 0; i < 1024 && readStage() !== 1; ++i) {
		if (gxGpu.backendCommandDrainPending()) gxGpu.retireExecutedCommands();
		runtime.frameScheduler.runCyclesToNextLogicalTick(65536);
	}
	assert.equal(readStage(), 1, `public admission: tick=${runtime.frameScheduler.lastTickSequence}, domain=${cpu.activeCartridgeSlot()}, Cause=${cpu.readCauseWord()}, reason=${cpu.readLuaFaultReasonWord()}, PC=${cpu.readFramePc(0)}`);
	assert.ok(cpu.isHaltedUntilIrq());
	assert.equal(cpu.readFrameExecutionDomain(0), 0);
	const input = Uint8Array.from({ length: size }, (_, i) => (i * 17 + (i >>> 2)) & 255);
	for (let i = 0; i < size; ++i) memory.writeMappedU8(data + i, input[i]);
	memory.writeMappedU32LE(report + 4, 1);
	cpu.clearHaltUntilIrq();
	const physical = arena.occupiedBytes();
	const grant = (budget: number) => scheduler.runCpuSlice(0, budget, 0, CpuRunKind.Scheduled);
	for (let i = 0; i < 50000 && arena.occupiedBytes() === physical; ++i) grant(1);
	assert.ok(cpu.fixedInterruptActive(), 'the provisional record lives in the ordinary vector');
	assert.equal(cpu.readCauseWord(), CPU_CAUSE_CODE_SYSCALL);
	assert.equal(readStage(), 1);
	assert.ok(arena.occupiedBytes() >= physical + size);
	const before = join(dir, 'before-copy.state');
	writeFileSync(before, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));

	// Model a producer changing the admitted physical source between grants,
	// after the lookup hash but before the corresponding payload store.
	input[size - 1] ^= 0xff;
	const lastWord = data + size - 1;
	assert.equal(lastWord & 3, 0);
	memory.writeMappedU32LE(lastWord, input[size - 1]);
	const budget = 65536;
	const copiedResult = grant(budget);
	const copiedCycles = budget - cpu.instructionBudgetRemaining;
	assert.equal(readStage(), 2);
	assert.ok(cpu.isHaltedUntilIrq());
	const trace = join(dir, 'trace');
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner');
	const replay = (state: string, commands: string[]) => {
		writeFileSync(trace, commands.join('\n'));
		return execFileSync(native, [systemPath, trace, state, cartPath, otherPath], { encoding: 'utf8' }).trimEnd().split('\n');
	};
	const offset = report - RAM_BASE;
	assert.deepEqual(replay(before, ['X', `W ${lastWord - RAM_BASE} ${input[size - 1]}`, `E ${budget}`, `H ${offset} ${offset + 8}`]), [
		[copiedResult, copiedCycles, memory.ramBusEnd(), 0].join(' '),
		String(hashBytes(memory.ramData(), offset, 8)),
	]);

	cpu.luaHeap.setCollectionTarget(cpu.luaHeap.capacity());
	for (let bytes = MAIN_RAM_SIZE >>> 1; bytes !== 0; bytes >>>= 1) {
		while (arena.allocate(bytes, true)) { /* exhaust physical backing */ }
	}
	assert.equal(arena.allocate(1, true), 0);
	const full = join(dir, 'full.state');
	writeFileSync(full, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	memory.writeMappedU32LE(report + 4, 2);
	cpu.clearHaltUntilIrq();
	const commands = ['X', `W ${offset + 4} 2`, 'h'], expected: string[] = [];
	for (let i = 0; i < 250; ++i) {
		const result = grant(budget);
		commands.push(`E ${budget}`);
		expected.push([result, budget - cpu.instructionBudgetRemaining, memory.ramBusEnd(), cpu.activeCartridgeSlot()].join(' '));
		if (result === RunResult.Halted) break;
	}
	const result = runtime.readCompletionValues();
	assert.equal(result.length, 5);
	const [copied, repeated, canonical, ok, reason] = result, id = valuePayload(copied);
	assert.equal(valueTag(copied), ValueTag.String);
	assert.equal(valueTag(canonical), ValueTag.String);
	assert.ok(valuePayload(canonical) >= CART_ROM_BASE);
	assert.equal(valuePayload(canonical) >>> 31, 0, 'the selected slot-1 bytes hit the installed slot-0 directory');
	assert.equal(repeated, copied, 'exact interning works even with no backing left');
	assert.equal(cpu.stringPool.bytes(id), Buffer.from(input).toString('latin1'));
	assert.equal(memory.readRamRecordWord(id + BLUA32_STRING_HASH_OFFSET), hashBytes(input, 0, input.length));
	assert.equal(valueTag(ok), ValueTag.False);
	assert.equal(cpu.stringPool.bytes(valuePayload(reason)), 'Out of memory.');
	commands.push('c');
	expected.push(`${result.length} ${result.map(v => `${valueTag(v)} ${valuePayload(v)}`).join(' ')}`);
	const first = id - RAM_BASE, length = BLUA32_STRING_RECORD_HEADER_SIZE + size;
	commands.push(`H ${first} ${first + length}`);
	expected.push(String(hashBytes(memory.ramData(), first, length)));
	assert.deepEqual(replay(full, commands), expected);
});
