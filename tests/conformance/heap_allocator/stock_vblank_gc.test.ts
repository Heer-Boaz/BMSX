import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { readLE32 } from '../../../machine/ts/common/endian';
import { hashBytes } from '../../../machine/ts/common/hash';
import { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { RamHistory } from '../../../machine/ts/machine/runtime/history/ram_history';
import { applyRuntimeCheckpointState, applyRuntimeSaveState, captureRuntimeCheckpointState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../../machine/ts/machine/runtime/save_state';
import { decodeRuntimeSaveState, encodeRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state/codec';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../../machine/ts/spec/blua32/execution_domain';
import { BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET } from '../../../machine/ts/spec/blua32/image_format';
import { IO_IRQ_ACK, IO_IRQ_FLAGS, IO_IRQ_MASK, IRQ_VBLANK } from '../../../machine/ts/spec/bmsx/io';
import { GC_ROOT_BANKS_HEADER_SIZE, GC_ROOT_BANKS_OFFSET, HEAP_GC_CONTROL_OFFSET } from '../../helpers/firmware_heap_layout';
import { CART_ROM_BASE, CPU_IRQ_VECTOR_ADDRESS, RAM_BASE } from '../../../machine/ts/spec/bmsx/memory_map';
import { PSX_MACHINE_SPEC } from '../../../machine/ts/spec/bmsx/model';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../../toolchain/ts/lua/compiler';
import { readBlua32BiosImports } from '../../../toolchain/ts/rompack/blua32_bios_imports';
import { linkCartBlua32Image } from '../../../toolchain/ts/rompack/blua32_linker';
import { writeTestBlua32Rom } from '../../helpers/blua32';
import { cartridgeSlots } from '../../helpers/cartridge';
import { parseLuaChunk } from '../../helpers/cpu_test_harness';
import { nativeConformanceRunner } from '../../helpers/native_conformance.mjs';
import { GC_LAST_EPOCH_WORK, GC_TRACE_CURSOR, GC_TRACE_HEAD, GC_TRACE_RECORD } from '../../helpers/native_heap/gc_heap';
import { nativeHeapReference } from '../../helpers/native_heap/reference';

const input = { sampleInputControllerSnapshot() {}, supervisorRequestLineHigh: () => false, applyInputControllerVibrationEffect() {} };
const length = 0x120000;
const source = `bss observation: u32[8]
local irq_flags<const>: *word = ${IO_IRQ_FLAGS}
local irq_ack<const>: *word = ${IO_IRQ_ACK}
function irq()
	local pending<const> = *irq_flags & ${IRQ_VBLANK}
	if pending ~= 0 then
		observation[3] = pending
		*irq_ack = pending
		observation[7] = *irq_flags & pending
		observation[2] = observation[2] + 1
	end
end
local run<const> = function()
	local mask<const>: *word = ${IO_IRQ_MASK}
	local ack<const>: *word = ${IO_IRQ_ACK}
	*mask = 0
	*ack = ${IRQ_VBLANK}
	-- This heap String is held by a running coroutine, not a module global.
	local held<const> = string.rep('Z', ${length})
	observation[1] = #held
	while observation[0] == 0 do end
	collectgarbage('collect')
	observation[6] = 1
	while observation[0] < 2 do end
	*mask = ${IRQ_VBLANK}
	while true do
		halt_until_irq
		observation[4] = #held
		observation[5] = string.byte(held, #held)
	end
end
assert(coroutine.resume(coroutine.create(run)))
`;
const enum Report { Command, Ready, Calls, Pending, Length, FinalByte, Collected, AfterAck }
// Only the production-owned sample is observed; this test never sets GC policy RAM.
const physicalSample = GC_LAST_EPOCH_WORK + 4;

function verify(romPath: string, native: string, output: string, optLevel: 0 | 3): void {
	const system = readFileSync(romPath);
	const compiled = compileLuaChunkToProgram(parseLuaChunk(source, 'vblank-cart.lua'), [], { entrySource: source, optLevel });
	const linked = linkCartBlua32Image(readBlua32BiosImports(system), encodeCompiledProgramObject(compiled), compiled.metadata,
		CART_ROM_BASE + 0x100, PSX_MACHINE_SPEC.ramBytes);
	const cartridge = writeTestBlua32Rom(linked), cartPath = join(output, 'irq-cart.rom');
	writeFileSync(cartPath, cartridge);
	const runtime = new Runtime({ systemRomBytes: system, cartridgeSlots: cartridgeSlots(cartridge), machineModel: PSX_MACHINE_SPEC }, input);
	runtime.boot();
	const { cpu, memory, scheduler, gxGpu } = runtime.machine;
	const frames = runtime.frameScheduler, arena = cpu.heapAllocator;
	const control = arena.managementOffset() + HEAP_GC_CONTROL_OFFSET, reports = linked.layout.header.bssAddress;
	const report = (field: Report) => memory.readRamRecordWord(reports + field * 4);
	const flags = () => memory.readIoU32(IO_IRQ_FLAGS);
	const sample = () => memory.readRamRecordWord(control + physicalSample);
	const work = () => [nativeHeapReference(cpu).gc.epochWork(), memory.readRamRecordWord(control + GC_LAST_EPOCH_WORK)];
	const traceCursor = () => [nativeHeapReference(cpu).gc.phase(), memory.readRamRecordWord(control + GC_TRACE_HEAD),
		memory.readRamRecordWord(control + GC_TRACE_RECORD), memory.readRamRecordWord(control + GC_TRACE_CURSOR),
		nativeHeapReference(cpu).gc.epochWork(), arena.occupiedBytes()];
	const commands: string[] = [], expected: string[] = [];
	const observe = (command: string, result?: string | number) => {
		commands.push(command);
		if (result !== undefined) expected.push(String(result));
	};
	const fingerprint = (first: number, length: number) => observe(`H ${first} ${first + length}`, hashBytes(memory.ramData(), first, length));
	const observeState = () => {
		observe(`M ${IO_IRQ_FLAGS}`, `${flags()} 0`);
		fingerprint(reports - RAM_BASE, 32);
		fingerprint(control, physicalSample + 8);
	};
	function grant(cycles: number) {
		if (gxGpu.backendCommandDrainPending()) {
			gxGpu.retireExecutedCommands();
			observe('>');
		}
		const before = scheduler.nowCycles, tick = frames.lastTickSequence;
		const done = frames.runCyclesToNextLogicalTick(cycles);
		observe(`p ${cycles}`, [Number(done), scheduler.nowCycles - before, frames.lastTickSequence - tick, Number(cpu.isHaltedUntilIrq())].join(' '));
	}
	// Preparing the pressure fixture itself concatenates several MiB of
	// String data in the BIOS. Only IRQ delivery below is under test here.
	const readyDeadline = 20 * PSX_MACHINE_SPEC.cpuFreqHz;
	for (let offered = 0; offered < readyDeadline && report(Report.Ready) !== length; offered += 65536) grant(65536);
	assert.equal(report(Report.Ready), length,
		`pressure fixture not ready at cycle ${scheduler.nowCycles} (Lua fault ${cpu.readLuaFaultReasonWord()})`);
	assert.equal(cpu.activeCartridgeSlot(), 0);
	const interruptedThread = cpu.activeThread.address;
	assert.notEqual(interruptedThread, cpu.rootThread.address, 'the coroutine is not the system root context');
	grant(0);
	const completionCount = arena.managementOffset() + GC_ROOT_BANKS_OFFSET + GC_ROOT_BANKS_HEADER_SIZE;
	// Both cores start with the real coroutine stopped at a CPU grant boundary.
	const initialState = join(output, 'before-collection.ts');
	writeFileSync(initialState, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	commands.length = expected.length = 0;
	observe('X');
	memory.writeMappedWord(reports, 1);
	observe(`O ${reports} 1`);
	for (let i = 0; i < 128 && report(Report.Collected) === 0; ++i) grant(65536);
	assert.equal(report(Report.Collected), 1);
	assert.equal(cpu.activeThread.address, interruptedThread);
	const irq = memory.readRamRecordWord(CPU_IRQ_VECTOR_ADDRESS);
	assert.notEqual(irq, 0, 'stock BIOS installs a System vector for cartridge interrupts');
	const irqCode = readLE32(system, irq + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
	const irqEnd = irqCode + readLE32(system, irq + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET);
	const systemIrqInstruction = (pc: number, domain: number) =>
		domain === SYSTEM_EXECUTION_DOMAIN_ID && pc >= irqCode && pc < irqEnd;
	assert.equal(memory.readIoU32(IO_IRQ_MASK), 0, 'the cartridge owns its mask');
	assert.ok(arena.occupiedBytes() >= length);
	const maskedTick = frames.lastTickSequence, maskedSample = sample(), maskedWork = work();
	for (let i = 0; i < 128 && frames.lastTickSequence < maskedTick + 3; ++i) grant(65536);
	// A logical tick can stop partway through the submitted grant. Spend its
	// retained suffix while still masked before using instruction-size grants.
	grant(0);
	assert.equal(frames.lastTickSequence, maskedTick + 3, 'three physical PCRTC VBlanks occurred while masked');
	assert.equal(report(Report.Calls), 0);
	assert.equal(flags() & IRQ_VBLANK, IRQ_VBLANK, 'masked VBlanks set one pending bit');
	assert.equal(sample(), maskedSample, 'masked delivery did not silently invoke the collector');
	assert.deepEqual(work(), maskedWork);
	observeState();

	memory.writeMappedWord(reports + Report.Command * 4, 2);
	observe(`O ${reports + Report.Command * 4} 2`);
	const vectorState = join(output, 'vector.native');
	const beforeTrace = traceCursor();
	let vectorObserved = false;
	for (let i = 0; i < 8192 && sample() === maskedSample; ++i) {
		grant(1);
		if (!vectorObserved && systemIrqInstruction(cpu.lastPc, cpu.readLastExecutionDomain())) {
			vectorObserved = true;
			observe(`x ${vectorState}`);
		}
	}
	assert.equal(sample(), arena.occupiedBytes(), 'the IRQ has reached the physical-pressure sampler');
	assert.notEqual(sample(), maskedSample);
	assert.equal(frames.lastTickSequence, maskedTick + 3, 'unmasking delivers the latched request without a fourth VBlank');
	for (let i = 0; i < 32768 && traceCursor().every((word, index) => word === beforeTrace[index]); ++i) grant(1);
	const partialCycle = scheduler.nowCycles;
	assert.notDeepEqual(traceCursor(), beforeTrace, 'collection advanced before capture');
	assert.ok(cpu.fixedInterruptActive(), 'ordinary BIOS instructions still own the IRQ');
	assert.equal(memory.readRamRecordWord(arena.managementOffset() + GC_ROOT_BANKS_OFFSET + 4),
		interruptedThread, 'firmware scans the suspended context, not its own IRQ frames');
	assert.equal(memory.readRamRecordWord(completionCount), 0, 'the IRQ requires no host completion roots');
	fingerprint(completionCount, 12);
	assert.equal(report(Report.Calls), 0, 'the cart has not seen the interrupt while the BIOS collects');
	assert.equal(flags() & IRQ_VBLANK, IRQ_VBLANK, 'BIOS has not acknowledged the pending cart interrupt');
	observeState();
	const tsPath = join(output, 'partial.ts'), cppPath = join(output, 'partial.native'), script = join(output, 'trace');
	const history = new RamHistory();
	history.start(memory);
	const previous = history.capture(memory, null), partial = history.capture(memory, previous);
	const checkpoint = captureRuntimeCheckpointState(runtime);
	writeFileSync(tsPath, encodeRuntimeSaveState(captureRuntimeSaveState(runtime)));
	observe('l');
	observe('s');
	observe(`x ${cppPath}`);
	const prefix = commands.length, rows = expected.length;

	function finish() {
		for (let i = 0; i < 16384 && report(Report.FinalByte) !== 90; ++i) grant(137);
		assert.ok(scheduler.nowCycles > partialCycle, 'maintenance and dispatch consume console cycles');
		// The suspended cursor above proves work even if the new epoch has
		// the same total as the preceding explicit collection.
		assert.equal(report(Report.Calls), 1, `multiple masked edges coalesced to one cart callback (PC ${cpu.lastPc.toString(16)}, CAUSE ${cpu.readCauseWord().toString(16)})`);
		assert.equal(report(Report.Pending), IRQ_VBLANK, 'the cart observed its own pending source before acknowledging');
		assert.equal(report(Report.AfterAck), 0);
		assert.equal(flags() & IRQ_VBLANK, 0);
		assert.equal(report(Report.Length), length);
		assert.equal(report(Report.FinalByte), 90, 'the GC preserved the live mutator String');
		observeState();
		const settledTick = frames.lastTickSequence;
		for (let i = 0; i < 128 && frames.lastTickSequence === settledTick; ++i) {
			grant(32768);
			assert.equal(report(Report.Calls), 1, 'no second callback before a fresh VBlank');
		}
		assert.equal(frames.lastTickSequence, settledTick + 1);
		assert.equal(flags() & IRQ_VBLANK, IRQ_VBLANK, 'the new physical edge latched before its handler ran');
		observeState();
		// Maintenance can extend past another edge. Read the acknowledgement
		// back in the cartridge's handler rather than after a scheduler slice.
		for (let i = 0; i < 16384 && report(Report.Calls) < 2; ++i) grant(137);
		assert.equal(report(Report.Calls), 2);
		assert.equal(report(Report.Pending), IRQ_VBLANK);
		assert.equal(report(Report.AfterAck), 0, 'the second handler acknowledged the pending bit');
		observeState();
	}

	finish();
	const tail = commands.slice(prefix), want = expected.slice(rows);
	const end = history.capture(memory, partial);
	history.restore(memory, end, partial);
	applyRuntimeCheckpointState(runtime, checkpoint, RuntimeRestoreOrigin.HistorySeek);
	observe('u');
	finish();
	assert.deepEqual(commands.slice(prefix + tail.length + 1), tail);
	assert.deepEqual(expected.slice(rows + want.length), want);

	function replay(state: string, commands: readonly string[], want: readonly string[]) {
		writeFileSync(script, commands.join('\n'));
		const actual = execFileSync(native, [romPath, script, state, cartPath], { encoding: 'utf8' }).trimEnd().split('\n');
		const mismatch = actual.findIndex((line, index) => line !== want[index]);
		assert.equal(mismatch, -1, `row ${mismatch}: C++=${actual[mismatch]} TS=${want[mismatch]}`);
		assert.equal(actual.length, want.length);
	}

	replay(initialState, commands, expected);
	replay(tsPath, ['X', ...tail], want);
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(readFileSync(cppPath), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes));
	commands.length = expected.length = 0;
	finish();
	assert.deepEqual(commands, tail);
	assert.deepEqual(expected, want);
	// A legacy prelude could run exactly the same collector and leave the
	// same RAM. It never executes the installed System IRQ vector here.
	assert.ok(vectorObserved, 'the installed System IRQ vector executes before the VBlank sampler during cartridge execution');
	const stored = decodeRuntimeSaveState(readFileSync(vectorState), PSX_MACHINE_SPEC.ramBytes, PSX_MACHINE_SPEC.gxGpuVramBytes);
	assert.ok(systemIrqInstruction(stored.cpuState.lastPc, stored.cpuState.lastExecutionDomainId), 'native executes that same System vector');
}

test('stock PCRTC VBlank runs BIOS collection before cartridge IRQ acknowledgment', async t => {
	t.mock.method(WebAssembly, 'Instance', () => assert.fail('stock boot and collection must not instantiate the allocator oracle'));
	mkdirSync('tmp', { recursive: true });
	const dir = mkdtempSync(join('tmp', 'stock-vblank-gc-'));
	const native = nativeConformanceRunner('bmsx_heap_service_conformance_runner', { buildDirectory: join(dir, 'native') });
	let failed = false;
	for (const optLevel of [0, 3] as const) await t.test(`O${optLevel}`, () => {
		const output = join(dir, `O${optLevel}`);
		try {
			execFileSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
				'--mode', 'bios', '--skiptypecheck', '-respath', 'machine/bios/res', '--debug', `-O${optLevel}`,
				'--output-dir', output, '--store-dir', join(dir, 'store')], { stdio: 'inherit' });
			verify(join(output, 'system', 'bmsx-bios.debug.rom'), native, output, optLevel);
		} catch (error) {
			failed = true;
			throw error;
		}
	});
	if (failed) t.diagnostic(`Stock VBlank evidence retained at ${dir}`);
	else rmSync(dir, { recursive: true, force: true });
});
