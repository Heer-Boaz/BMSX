import { bindReferenceDlmalloc } from '../helpers/native_heap/dlmalloc_wasm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { MAPPED_PAGE_BYTE_SHIFT } from '../../machine/ts/machine/memory/mapped_page';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { HEAP_PAGE_SIZE, MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { buildBlua32Image } from '../../toolchain/ts/rompack/blua32_image_builder';
import { createTestSystemCpu, writeTestBlua32Rom } from '../helpers/blua32';
import { parseLuaChunk } from '../helpers/cpu_test_harness';

// Only ROM and the fixed reset context execute this allocator. The C/WASM
// oracle has its own arena; neither the fixture nor the CPU primes one for BLua.
const FLOOR = 0x80000;
const LIMIT = 0xc0000;
const STATE = LIMIT + 0x400;
const END = STATE + 0x200;
const MAILBOX = RAM_BASE + 0x60000;
const ops = [
	'reset', 'set_floor', 'floor', 'allocate', 'free', 'reserve_backing',
	'resize_backing', 'shrink', 'allocation_bytes', 'occupied_bytes', 'is_object',
] as const;
type Operation = typeof ops[number];

const entrySource = `
local alloc<const> = require("kernel/dlmalloc")
local mailbox<const>: *u32 = ${MAILBOX}
while true do
	local op<const> = mailbox[0]
	local x<const>, y<const> = mailbox[1], mailbox[2]
	local result = 0
${ops.map((op, index) => {
	const call = `alloc.bmsx_dlmalloc_${op}(${STATE}, x, y)`;
	const statement = ['reset', 'free', 'shrink'].includes(op) ? call : `result = ${call}`;
	return `	${index === 0 ? 'if' : 'elseif'} op == ${index + 1} then ${statement}`;
}).join('\n')}
	end
	if op ~= 0 then
		mailbox[3] = result
		mailbox[0] = 0
	end
end
`;

const allocatorModule = 'kernel/dlmalloc';
const luaModules = [
	{ path: 'main', source: 'module<entry>\nreturn' },
	{ path: 'reset', source: entrySource },
	{ path: 'irq', source: 'return' },
	{ path: 'exception', source: 'return' },
	{ path: allocatorModule, source: readFileSync(`machine/bios/${allocatorModule}.lua`, 'utf8') },
].map(module => ({ ...module, displayPath: `${module.path}.lua`, chunk: parseLuaChunk(module.source, module.path) }));
const { linked } = buildBlua32Image({
	domain: 'system', luaModules, generatedLuaModules: [], loadAddress: 0x100,
	ramByteCount: MAIN_RAM_SIZE, optLevel: 3, traceStatements: 'erase',
	resetModule: 'reset', irqModule: 'irq', exceptionModule: 'exception', biosExports: [],
});
const romBytes = writeTestBlua32Rom(linked);

function fixture(backend: CpuExecutionBackend) {
	const { cpu, memory } = createTestSystemCpu({ romBytes }, backend);
	const reference = new Memory({ systemRom: new Uint8Array(0), cartridgeSlots: [null, null] }, MAIN_RAM_SIZE);
	const arena = bindReferenceDlmalloc(reference, STATE);
	const actualBytes = memory.ramData().subarray(FLOOR, END);
	const expectedBytes = reference.ramData().subarray(FLOOR, END);
	// Scratch around the state starts nonzero so an accidental wider clear
	// cannot hide behind the fixture's zero-initialized RAM.
	actualBytes.fill(0x6d, LIMIT - FLOOR);
	expectedBytes.fill(0x6d, LIMIT - FLOOR);
	const watches = memory.ramWriteWatches(), referenceWatches = reference.ramWriteWatches();
	const firstGroup = FLOOR >>> MAPPED_PAGE_BYTE_SHIFT;
	const endGroup = ((END - 1) >>> MAPPED_PAGE_BYTE_SHIFT) + 1;

	function begin(op: Operation, x: number, y: number) {
		watches.armHistoryWrites();
		referenceWatches.armHistoryWrites();
		memory.writeRamRecordWord(MAILBOX + 4, x);
		memory.writeRamRecordWord(MAILBOX + 8, y);
		memory.writeRamRecordWord(MAILBOX, ops.indexOf(op) + 1);
	}
	function pending() { return memory.readRamRecordWord(MAILBOX) !== 0; }
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded,
			`fault ${cpu.readCauseWord().toString(16)} at EPC ${cpu.readEpcWord().toString(16)}`);
	}
	function finish() {
		for (let i = 0; i < 4096 && pending(); i++) grant(2048);
		assert.ok(!pending(), 'the allocator returned within the test cycle bound');
		return memory.readRamRecordWord(MAILBOX + 12);
	}
	function compare(context: string) {
		if (Buffer.compare(actualBytes, expectedBytes) !== 0) {
			const i = actualBytes.findIndex((byte, index) => byte !== expectedBytes[index]);
			assert.equal(actualBytes[i], expectedBytes[i], `${context}: arena byte 0x${(FLOOR + i).toString(16)}`);
		}
		for (let g = firstGroup; g < endGroup; ++g) {
			assert.equal(watches.historyPageDirty(g, g + 1), referenceWatches.historyPageDirty(g, g + 1),
				`${context}: dirty history group 0x${g.toString(16)}`);
		}
	}
	function oracle(op: Operation, x: number, y: number): number {
		switch (op) {
			case 'reset': arena.reset(x, y); return 0;
			case 'set_floor': return arena.setFloor(x);
			case 'floor': return arena.floor();
			case 'allocate': return arena.allocate(x, y);
			case 'free': arena.free(x); return 0;
			case 'reserve_backing': return arena.reserveBacking(x, y);
			case 'resize_backing': return arena.resizeBacking(x, y);
			case 'shrink': arena.shrink(x, y); return 0;
			case 'allocation_bytes': return arena.allocationBytes(x);
			case 'occupied_bytes': return arena.occupiedBytes();
			case 'is_object': return arena.isObject(x);
		}
	}
	function run(op: Operation, x = 0, y = 0) {
		begin(op, x, y);
		const expected = oracle(op, x, y);
		const context = `${op}(${x}, ${y})`;
		assert.equal(finish(), expected, context);
		compare(context);
		return expected;
	}
	function payload(offset: number, bytes: number) {
		for (let i = 0; i < bytes; ++i) {
			const value = (offset + i * 13) & 0xff;
			memory.writeRamRecordByte(RAM_BASE + offset + i, value);
			reference.writeRamRecordByte(RAM_BASE + offset + i, value);
		}
	}
	run('reset', FLOOR, LIMIT);
	return { cpu, memory, arena, begin, pending, grant, finish, compare, run, payload };
}

for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) {
	test(`BLua dlmalloc matches shared C, including all arena bytes and dirty groups (${backend})`, () => {
		const { run, payload } = fixture(backend);
		assert.equal(run('floor'), FLOOR);
		for (const bytes of [0x80000000, 0xffffffc0, 0xffffffff]) assert.equal(run('allocate', bytes), 0);
		for (const bytes of [1, 10, 11, 12, 13, 244, 245, 248, 249, 256, 0xffff, 0x10000]) {
			const offset = run('allocate', bytes, 1);
			assert.ok(offset > 0);
			assert.equal(run('is_object', offset), 1);
			assert.ok(run('allocation_bytes', offset) >= bytes + 4);
			run('free', offset);
			assert.equal(run('is_object', offset), 0);
		}

		// Equal-size tree siblings, unequal children, small-bin exact fit,
		// victim splits and successful/unsuccessful growth under fragmentation.
		const blocks = [344, 400, 344, 64, 320, 328, 64, 120].map(bytes => {
			const offset = run('allocate', bytes);
			run('allocate', 32); // prevent consolidation between these blocks
			return offset;
		});
		for (const offset of blocks) run('free', offset);
		for (const bytes of [64, 64, 144, 306, 334, 336, 380, 8]) assert.ok(run('allocate', bytes) > 0);
		run('reset', FLOOR, LIMIT);

		let seed = 0x5eed4ea9;
		const next = (bound: number) => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
			return (seed >>> 8) % bound;
		};
		const live: { offset: number; bytes: number; object: number }[] = [];
		let refused = 0, exhausted = 0, moved = 0, inPlace = 0;
		for (let i = 0; i < 850; ++i) {
			const op = next(100);
			if (op < 43 || live.length === 0) {
				const bytes = 1 + next(next(3) === 0 ? 7000 : 312);
				const object = +(next(3) === 0);
				const offset = run('allocate', bytes, object);
				if (offset === 0) ++exhausted;
				else {
					payload(offset, bytes);
					assert.equal(run('is_object', offset), object);
					live.push({ offset, bytes, object });
				}
			} else if (op < 65) {
				const index = next(live.length);
				run('free', live[index].offset);
				live[index] = live[live.length - 1];
				live.pop();
			} else if (op < 93) {
				const item = live[next(live.length)];
				if (item.object) continue;
				if (op < 71) {
					item.bytes = (item.bytes >>> 1) + 1;
					run('shrink', item.offset, item.bytes);
				} else {
					const bytes = item.bytes + 1 + next(6000);
					const old = item.offset;
					const reserve = op < 81;
					const offset = run(reserve ? 'reserve_backing' : 'resize_backing', old, bytes);
					if (offset === 0) ++exhausted;
					else if (offset === old) {
						++inPlace;
						item.bytes = bytes;
					} else {
						++moved;
						if (reserve) live.push({ offset, bytes, object: 0 });
						else Object.assign(item, { offset, bytes });
					}
				}
			} else {
				const floor = FLOOR + next(1 + (LIMIT - FLOOR) / HEAP_PAGE_SIZE) * HEAP_PAGE_SIZE;
				if (run('set_floor', floor) === 0) ++refused;
				run('floor');
			}
		}
		assert.ok(refused > 0 && exhausted > 0 && moved > 0 && inPlace > 0,
			`trace: ${JSON.stringify({ refused, exhausted, moved, inPlace })}`);
		for (const { offset } of live) run('free', offset);
		assert.equal(run('occupied_bytes'), 0);
		assert.equal(run('set_floor', LIMIT), 1);
		assert.equal(run('allocate', 16), 0);
		assert.equal(run('set_floor', FLOOR), 1);
		assert.ok(run('allocate', (LIMIT - FLOOR) / 2) > 0);
	});

	test(`BLua dlmalloc resumes from a partially published tree insertion (${backend})`, () => {
		const { cpu, memory, arena, begin, pending, grant, finish, compare, run } = fixture(backend);
		const offset = run('allocate', 1200, 1);
		run('allocate', 64);
		begin('free', offset, 0);
		arena.free(offset);
		const head = RAM_BASE + offset - 4;
		const map = RAM_BASE + STATE + 4;
		for (let i = 0; i < 2000 && (memory.readRamRecordWord(head) & 2) !== 0; ++i) grant(1);
		assert.equal(memory.readRamRecordWord(head) & 2, 0, 'the chunk head is already free');
		assert.equal(memory.readRamRecordWord(map), 0, 'the tree bitmap has not been published');
		assert.ok(pending());
		const savedCpu = cpu.captureRuntimeState(), savedRam = memory.captureSaveState();
		assert.equal(finish(), 0);
		compare('first continuation from mid-insert');
		const finalRam = memory.captureSaveState().ram;

		memory.restoreSaveState(savedRam);
		cpu.restoreRuntimeState(savedCpu);
		assert.equal(finish(), 0);
		// Compare the saved arena domain; CPU frames and history bookkeeping
		// are the execution context, not dlmalloc records.
		assert.equal(Buffer.compare(memory.ramData().subarray(FLOOR, END), finalRam.subarray(FLOOR, END)), 0);
		assert.equal(run('allocate', 1200, 1), offset);
	});

	test(`BLua dlmalloc rewinds a partially copied backing allocation (${backend})`, () => {
		const { cpu, memory, arena, begin, pending, grant, finish, run, payload } = fixture(backend);
		const offset = run('allocate', 2400);
		run('allocate', 64);
		const retained = arena.allocationBytes(offset) - 4;
		payload(offset, retained);

		const history = new RamHistory();
		history.start(memory);
		const before = history.capture(memory, null);
		begin('resize_backing', offset, 6000);
		const dest = arena.resizeBacking(offset, 6000);
		assert.ok(dest !== 0 && dest !== offset);
		const from = RAM_BASE + offset, to = RAM_BASE + dest;
		const first = memory.readRamRecordWord(from);
		for (let i = 0; i < 4000 && memory.readRamRecordWord(to) !== first; ++i) grant(1);
		assert.ok(pending());
		assert.equal(memory.readRamRecordWord(to), first, 'the new backing has a copied prefix');
		assert.notEqual(memory.readRamRecordWord(to + retained - 4), memory.readRamRecordWord(from + retained - 4),
			'the last retained word has not been copied');
		assert.notEqual(memory.readRamRecordWord(from - 4) & 2, 0, 'the source is still allocated');
		const savedCpu = cpu.captureRuntimeState(), savedBus = memory.captureBusState();
		compareCopyBeforeCheckpoint();
		const partial = history.capture(memory, before);
		assert.equal(finish(), dest);
		const final = history.capture(memory, partial);
		const finalRam = memory.ramData().slice(FLOOR, END);

		history.restore(memory, final, partial);
		memory.restoreBusState(savedBus);
		cpu.restoreRuntimeState(savedCpu);
		compareCopyBeforeCheckpoint();
		assert.equal(finish(), dest);
		assert.equal(Buffer.compare(memory.ramData().subarray(FLOOR, END), finalRam), 0);
		// The scratch execution context may have different history watches
		// after restoring CPU state; subsequent arena writes must re-arm them.
		assert.equal(run('allocation_bytes', dest), arena.allocationBytes(dest));

		function compareCopyBeforeCheckpoint() {
			assert.equal(memory.readRamRecordWord(to), first);
			assert.notEqual(memory.readRamRecordWord(to + retained - 4), memory.readRamRecordWord(from + retained - 4));
		}
	});
}
