import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_THREAD_VISITS, GC_WEAK_VISITS, GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_GRAY_INDEX_BITS, GC_GRAY_INDEX_MASK, GC_OBJECT_LINK_BEFORE, GC_RECORD_LINK, GC_RECORD_SHIFT } from '../../machine/ts/machine/cpu/gc_object';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { THREAD_RECORD_KIND } from '../../machine/ts/machine/cpu/thread_record';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap, createTestHeapServiceCpu } from '../helpers/heap_service_system';

const CONTROL = 0x60004; // Native control offset is four bytes off the pair boundary.
const MAILBOX = RAM_BASE + 0x61000;
const A = RAM_BASE + 0x80008, B = RAM_BASE + 0x103018, C = RAM_BASE + 0x100028;
const END = 0x104000;
const EPOCH_WORK = 0x5c, LAST_EPOCH_WORK = 0x60, PHYSICAL_ASSIST = 0x68;
const OBJECT_HEAD = 0x6c, OBJECT_COUNT = 0x70, SWEEP_LINK = 0x74, CONTROL_BYTES = 0x78;

const enum Operation { Publish = 1, Visit, Account }
const path = 'kernel/gc_control';
const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
const entrySource = `
local gc<const> = require("${path}")
local mailbox<const>: *u32 = ${MAILBOX}
halt_until_irq
while true do
	local op<const> = mailbox[0]
	if op == ${Operation.Publish} then gc.publish_object(${CONTROL}, mailbox[1])
	elseif op == ${Operation.Visit} then gc.append_visit(${CONTROL}, mailbox[1], mailbox[2])
	elseif op == ${Operation.Account} then mailbox[3] = gc.account_epoch_work(${CONTROL}, mailbox[1]) end
	if op ~= 0 then mailbox[0] = 0 end
end
`;
const image = linkTestSystemBlua32(compileTestSystemWithHeap(parseLuaChunk(entrySource),
	[{ path, source, chunk: parseLuaChunk(source, path) }], { entrySource, optLevel: 3, programDomain: 'system' }));

function fixture(backend: CpuExecutionBackend) {
	const { cpu, memory } = createTestHeapServiceCpu(image, backend);
	const reference = createTestHeapServiceCpu(image, CpuExecutionBackend.Interpreter).cpu;
	const ref = reference.memory, gc = reference.gc;
	const referenceControl = reference.heapAllocator.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	// Finish startup and admit the mailbox's frame before narrowing the bus
	// to the synthetic records; startup uses the production backing service.
	runGuestToHalt(cpu, 65_536);
	cpu.activeThread.reserveFrame(128);
	cpu.clearHaltUntilIrq();
	memory.setRamBusEnd(RAM_BASE + END);
	const expected = ref.ramData().subarray(referenceControl, referenceControl + CONTROL_BYTES);
	const actual = memory.ramData().subarray(CONTROL, CONTROL + CONTROL_BYTES);
	expected.fill(0x6d);
	actual.fill(0x6d);

	function word(offset: number, value: number) {
		memory.writeRamRecordWord(CONTROL + offset, value);
		ref.writeRamRecordWord(referenceControl + offset, value);
	}
	function seedRecord(address: number) {
		const header = 0x80000000 | (address === C ? ValueTag.Table : THREAD_RECORD_KIND), mixedLinks = 0xfffad321;
		for (const mem of [ref, memory]) {
			mem.writeRamRecordWord(address - GC_OBJECT_LINK_BEFORE, 0x6d6d6d6d);
			mem.writeRamRecordPair(address, header, mixedLinks);
		}
	}
	function compare() {
		assert.deepEqual(actual, expected, 'complete collector control prefix');
		for (const address of [A, B, C]) {
			const offset = address - RAM_BASE;
			assert.deepEqual(memory.ramData().subarray(offset - 4, offset + 8),
				ref.ramData().subarray(offset - 4, offset + 8), `record 0x${address.toString(16)}`);
		}
	}
	function begin(op: Operation, first: number, second = 0) {
		memory.writeRamRecordWord(MAILBOX + 4, first);
		memory.writeRamRecordWord(MAILBOX + 8, second);
		memory.writeRamRecordWord(MAILBOX, op);
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		assert.equal(cpu.readLuaFaultReasonWord(), 0);
	}
	function finish() {
		for (let i = 0; i < 32 && memory.readRamRecordWord(MAILBOX) !== 0; ++i) grant(128);
		assert.equal(memory.readRamRecordWord(MAILBOX), 0, 'the firmware operation returned');
		return memory.readRamRecordWord(MAILBOX + 12);
	}

	word(0, 0);
	for (const offset of [OBJECT_HEAD, OBJECT_COUNT, SWEEP_LINK, GC_THREAD_VISITS, GC_THREAD_VISITS + 4,
		GC_THREAD_VISITS + 8, GC_WEAK_VISITS, GC_WEAK_VISITS + 4, GC_WEAK_VISITS + 8]) word(offset, 0);
	for (const address of [A, B, C]) seedRecord(address);
	return { cpu, gc, memory, ref, referenceControl, word, compare, begin, grant, finish };
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`BLua GC control matches inventory, packed visits and work boundaries (${backend})`, () => {
		const { gc, memory, ref, referenceControl, word, compare, begin, finish } = fixture(backend);
		for (const address of [A, B, C]) {
			if (address === B) {
				// Both collectors are about to examine the old list's head.
				memory.writeRamRecordWord(CONTROL + SWEEP_LINK, CONTROL + OBJECT_HEAD);
				ref.writeRamRecordWord(referenceControl + SWEEP_LINK, referenceControl + OBJECT_HEAD);
			}
			begin(Operation.Publish, address);
			gc.publishObject(address);
			finish();
			compare();
		}
		assert.equal(memory.readRamRecordWord(CONTROL + SWEEP_LINK), B - GC_OBJECT_LINK_BEFORE);
		assert.equal(memory.readRamRecordWord(CONTROL + OBJECT_COUNT), 3);
		assert.equal(memory.readRamRecordWord(A - GC_OBJECT_LINK_BEFORE), 0);
		assert.equal(memory.readRamRecordWord(B - GC_OBJECT_LINK_BEFORE), A);
		assert.equal(memory.readRamRecordWord(C - GC_OBJECT_LINK_BEFORE), B);

		for (const [list, address] of [[GC_THREAD_VISITS, A], [GC_THREAD_VISITS, B],
			[GC_THREAD_VISITS, A], [GC_WEAK_VISITS, C], [GC_WEAK_VISITS, C]] as const) {
			begin(Operation.Visit, list, address);
			gc['appendVisit'](list, address);
			finish();
			compare();
		}
		const next = (memory.readRamRecordWord(A + GC_RECORD_LINK) >>> GC_GRAY_INDEX_BITS)
			| ((memory.readRamRecordByte(A + 3) & 0x3f) << (32 - GC_GRAY_INDEX_BITS));
		assert.equal(next, (B - RAM_BASE) >>> GC_RECORD_SHIFT, 'the visit link extends into the header lane');
		assert.equal(memory.readRamRecordByte(A + 3) & 0xc0, 0xc0, 'membership does not change the upper header bit');
		assert.equal(memory.readRamRecordWord(A + GC_RECORD_LINK) & GC_GRAY_INDEX_MASK, 0xfffad321 & GC_GRAY_INDEX_MASK,
			'the gray link is independent of the visit link');
		assert.equal(memory.readRamRecordWord(CONTROL + GC_THREAD_VISITS + 8), 2);
		assert.equal(memory.readRamRecordWord(CONTROL + GC_WEAK_VISITS + 8), 1);

		for (const phase of [GcPhase.Mark, GcPhase.MarkAgain, GcPhase.Atomic, GcPhase.Sweep, GcPhase.Strings, GcPhase.Pause, 6, 7]) {
			word(0, 0xd1e2a0f8 | phase);
			word(EPOCH_WORK, 0xfffffff0);
			word(LAST_EPOCH_WORK, 28);
			word(PHYSICAL_ASSIST, 1);
			begin(Operation.Account, 32);
			assert.equal(finish(), gc['accountEpochWork'](32));
			compare();
		}
	});
}

test('BLua GC control resumes with an inventory link written but not published', () => {
	const { cpu, gc, memory, compare, begin, grant, finish } = fixture(CpuExecutionBackend.Interpreter);
	begin(Operation.Publish, A);
	gc.publishObject(A);
	finish();
	compare();

	begin(Operation.Publish, B);
	for (let i = 0; i < 256 && memory.readRamRecordWord(B - GC_OBJECT_LINK_BEFORE) !== A; ++i) grant(1);
	assert.equal(memory.readRamRecordWord(B - GC_OBJECT_LINK_BEFORE), A);
	assert.equal(memory.readRamRecordWord(CONTROL + OBJECT_HEAD), A, 'the head is still unpublished');
	const middle = captureCpuCheckpoint(cpu);
	gc.publishObject(B);
	finish();
	compare();
	const end = cpu.captureRuntimeState();
	restoreCpuCheckpoint(cpu, middle);
	finish();
	compare();
	assert.deepEqual(cpu.captureRuntimeState(), end);
});
