import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_CHANGED_HEAD, GC_MODE_META, GC_MODE_NODE, GC_TRACE_CURSOR, GC_TRACE_RECORD, GcPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_COLOR_OFFSET } from '../../machine/ts/machine/cpu/gc_object';
import { TableHeader } from '../../machine/ts/machine/cpu/table';
import { hashCanonicalTableKey, valueInteger, valueNil, valuePayload, valueString, valueTable, ValueTag, valueTag, type Value } from '../../machine/ts/machine/cpu/value';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';

const MODULE = 'kernel/table_insert_existing';
const symbol = 'insert_hash_without_growth';
const basis = '45025f5cd2063d4c4b2315b9de8ea19f1956b4ae';
const source = readFileSync(`machine/bios/${MODULE}.lua`, 'utf8');
const entrySource = 'halt_until_irq';

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource),
		[{ path: MODULE, source, chunk: parseLuaChunk(source, MODULE) }], { entrySource, optLevel, programDomain: 'system' });
	const object = encodeCompiledProgramObject(compiled), linked = linkTestSystemBlua32(compiled);
	const entry = object.sections.rodata.moduleExports.find(candidate => candidate.path === MODULE && candidate.exportPathKey === symbol);
	assert.ok(entry);
	const root = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[entry.slotName]);
	assert.ok(root >= 0);
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, [root]);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT, `pinned stack: ${frames} frames, ${valueSlots} values`);
	const { cpu, memory } = createTestSystemCpu(linked), oracle = createTestSystemCpu(linked).cpu;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 10_000);
	const first = memory.ramBusEnd() - RAM_BASE, last = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_THREAD_OFFSET;
	const control = cpu.gc.controlOffset;
	function same<T>(act: (target: CPU) => T): T {
		const got = act(cpu);
		assert.deepEqual(act(oracle), got);
		return got;
	}
	function begin(record: number, key: Value, value: Value, expected: number) {
		const tables = oracle.gc.tables, hash = tables.hashSize(record), words = tables.hashAddress(record);
		let inserted = -1;
		if (hash !== 0) {
			const home = hashCanonicalTableKey(key) & (hash - 1);
			inserted = tables['insertHashWithoutGrowth'](record, home, key, value, hash, words, words + 8 * hash, false);
			if (inserted >= 0) {
				tables['adjustHashLive'](words, hash, 1);
				tables['adjustIntegerBand'](words, hash, valueTag(key), valuePayload(key), 1);
			}
		}
		assert.equal(inserted, expected, 'the actual native General-recovery leaf selects this node');
		assert.ok(cpu.beginHeapService(linked.image.functions[root].address,
			[control, record, valueTag(key), valuePayload(key), valueTag(value), valuePayload(value), 0]));
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		assert.ok(cycles - cpu.instructionBudgetRemaining > 0);
	}
	function finish(expected: number) {
		for (let n = 0; n < 1024 && cpu.heapServiceActive(); ++n) grant(256);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(cpu.heapServiceResult() | 0, expected);
		const native = oracle.memory.ramData().subarray(first, last), guest = memory.ramData().subarray(first, last);
		const delta = guest.findIndex((byte, i) => byte !== native[i]);
		assert.equal(delta, -1, `old Table/private memory differs at 0x${(first + delta).toString(16)}`);
	}
	return { cpu, memory, control, same, begin, grant, finish };
}

const val = valueInteger(79);
function keysAt(hash: number, home: number, qty = 1): Value[] {
	const keys: Value[] = [];
	for (let n = -1; keys.length < qty; --n) {
		const key = valueInteger(n);
		if ((hashCanonicalTableKey(key) & (hash - 1)) === home) keys.push(key);
	}
	return keys;
}

for (const opt of [0, 3] as const) {
	test(`old Hash retries really reuse weak-cleared and identity tombstones at home at O${opt}`, () => {
		const f = fixture(opt);
		const [owner, dead, trigger, tagBase] = f.same(cpu => {
			const strings = cpu.stringPool, table = cpu.createTable(0, 8);
			const meta = cpu.createTable(0, 4), victim = cpu.createTable(0, 0);
			const weakKey = valueString(strings.intern('existing-hash-weak-home'));
			const home = hashCanonicalTableKey(weakKey) & 7;
			cpu.gc.tables.set(meta, valueString(strings.intern('__mode')), valueString(strings.intern('v')));
			cpu.gc.tables.setMetatableAddress(table, meta);
			cpu.gc.tables.set(table, weakKey, valueTable(victim));
			cpu.collectTrackedHeapBytes(valueTable(table));
			assert.equal(cpu.gc.tables.get(table, weakKey), valueNil(), 'a real native weak epoch cleared the value');
			return [table, home, keysAt(8, home)[0], cpu.gc.tables.hashAddress(table) + 8 * 8] as const;
		});
		assert.equal(f.memory.readRamRecordByte(tagBase + dead), ValueTag.String, 'weak clearing retained the String key tombstone');
		assert.equal(f.memory.readRamRecordByte(tagBase + dead + 8), ValueTag.Nil);
		f.begin(owner, trigger, val, dead);
		f.finish(dead);
		assert.equal(f.memory.readRamRecordWord(owner + TableHeader.Free), 7, 'home reuse never consumes the free cursor');
		assert.equal(f.cpu.gc.tables.get(owner, trigger), val);

		const [identityTable, identityHome] = f.same(cpu => {
			const record = cpu.createTable(0, 8), key = valueTable(cpu.createTable(0, 0));
			cpu.gc.tables.set(record, key, val);
			cpu.gc.tables.set(record, key, valueNil());
			return [record, hashCanonicalTableKey(key) & 7] as const;
		});
		const tags = f.cpu.gc.tables.hashAddress(identityTable) + 8 * 8;
		assert.equal(f.memory.readRamRecordByte(tags + identityHome), ValueTag.Nil);
		assert.equal(f.memory.readRamRecordByte(tags + identityHome + 8), ValueTag.DeadKey);
		f.begin(identityTable, keysAt(8, identityHome)[0], val, identityHome);
		f.finish(identityHome);
	});

	test(`old Hash Full is non-mutating, preserves off-home tombstones and updates live/bands only on insertion at O${opt}`, () => {
		const f = fixture(opt);
		const empty = f.same(cpu => cpu.createTable(0, 0));
		f.begin(empty, keysAt(8, 0)[0], val, -1);
		f.finish(-1);
		for (const hash of [8, 128]) {
			const record = f.same(cpu => {
				const table = cpu.createTable(0, hash);
				for (let home = 0; home < hash; ++home) cpu.gc.tables.set(table, keysAt(hash, home)[0], val);
				// The small table has a logical hole which cannot be used
				// as a free displaced node; the large one is truly full.
				if (hash === 8) cpu.gc.tables.set(table, keysAt(hash, 1)[0], valueNil());
				return table;
			});
			const key = keysAt(hash, 0, 2)[1];
			f.begin(record, key, val, -1);
			f.finish(-1);
			assert.equal(f.memory.readRamRecordWord(record + TableHeader.Free), hash - 1);
		}

		const hash = 1024, record = f.same(cpu => cpu.createTable(0, hash)), incoming = valueInteger(257);
		const home = hashCanonicalTableKey(incoming) & (hash - 1);
		f.begin(record, incoming, val, home);
		f.finish(home);
		const census = f.cpu.gc.tables.hashAddress(record) + 14 * hash;
		assert.equal(f.memory.readRamRecordWord(census), 1);
		assert.equal(f.memory.readRamRecordWord(census + (1 + 9) * 4), 1, '257 uses ceilLog2 band 9');
	});

	test(`old Hash relocates a foreign occupant only after invalidating the collector cursor at O${opt}`, () => {
		const f = fixture(opt);
		for (const hash of [8, 256]) {
			const home = hash - 1, free = home - 1;
			const [anchor, displaced, append] = keysAt(hash, 0, 3), trigger = keysAt(hash, home)[0];
			const [record, traced] = f.same(cpu => {
				const table = cpu.createTable(0, hash);
				cpu.gc.tables.set(table, anchor, val);
				cpu.gc.tables.set(table, displaced, val);
				// Word links additionally exercise the ModeMeta-only alias:
				// the original TraceRecord, not the moving Table, rescans.
				return [table, hash === 8 ? table : cpu.createTable(0, 0)] as const;
			});
			const words = f.cpu.gc.tables.hashAddress(record), tags = words + 8 * hash;
			const trace = f.control + GC_TRACE_RECORD;
			f.same(cpu => {
				cpu.memory.writeRamRecordByte(f.control, GcPhase.Mark);
				cpu.memory.writeRamRecordByte(traced + GC_COLOR_OFFSET, 3);
				cpu.memory.writeRamRecordPair(trace, traced, 4);
				cpu.memory.writeRamRecordPair(f.control + GC_MODE_META, record, 6);
				cpu.memory.writeRamRecordWord(f.control + GC_MODE_NODE + 4, 7);
			});
			f.begin(record, trigger, val, home);
			for (let n = 0; n < 1024 && f.memory.readRamRecordWord(trace) !== 0; ++n) f.grant(1);
			assert.equal(f.cpu.heapServiceActive(), true);
			assert.equal(f.memory.readRamRecordWord(record + TableHeader.Free), free - 1, 'the free cursor publishes before relocation');
			assert.equal(f.memory.readRamRecordWord(trace), 0, 'the trace cursor is interrupted by the move');
			assert.equal(f.memory.readRamRecordWord(words + 4 * home), valuePayload(displaced), 'the old payload is still in its original lane');
			assert.equal(f.memory.readRamRecordByte(tags + free), ValueTag.Nil, 'the new slot has not been populated');
			const checkpoint = captureCpuCheckpoint(f.cpu);
			f.finish(home);
			assert.equal(f.memory.readRamRecordWord(f.control + GC_TRACE_CURSOR), 0);
			assert.equal(f.memory.readRamRecordWord(f.control + GC_MODE_META), 0);
			assert.equal(f.memory.readRamRecordWord(f.control + GC_MODE_NODE), 0);
			assert.notEqual(f.memory.readRamRecordWord(f.control + GC_CHANGED_HEAD), 0, 'the traced black Table is queued for rescan');
			assert.notEqual(f.memory.readRamRecordByte(traced + GC_COLOR_OFFSET), 3, 'the original trace target is no longer black');
			assert.equal(f.cpu.gc.tables.get(record, displaced), val, 'the displaced key remains reachable through its original chain');
			assert.equal(f.cpu.gc.tables.get(record, trigger), val);
			restoreCpuCheckpoint(f.cpu, checkpoint);
			f.finish(home);

			// Same-home append consumes free without invalidating a
			// trace: no already-present element moved behind the cursor.
			f.same(cpu => cpu.memory.writeRamRecordPair(trace, record, 5));
			f.begin(record, append, val, free - 1);
			f.finish(free - 1);
			assert.equal(f.memory.readRamRecordWord(trace), record);
			assert.equal(f.memory.readRamRecordWord(f.control + GC_TRACE_CURSOR), 5);
		}
	});
}

const references = [
	['T', 'machine/ts/machine/cpu/table.ts', '43943fc1e988e8bb032938d3f178c14f20a896bae3ea4fd8a48606e7201a03fe'],
	['C', 'machine/cpp/machine/cpu/table.cpp', '783f0ca0f9d55a227d430a360ed19556c50c0d233bcfe7b715b3c1a441a4233e'],
	['H', 'machine/cpp/machine/cpu/table.h', '975c598973a6b809af9e3dcdca304b75bc1787bb3132414982ebcec44e311412'],
	['V', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641'],
	['W', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
] as const;

test('old Hash insertion pins both mirrors and accounts for its statements', () => {
	const byTag = new Map<string, string[]>();
	const mapped = new Map<string, Set<number>>();
	for (const [tag, path, expected] of references) {
		const bytes = execFileSync('git', ['show', `${basis}:${path}`]);
		assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, path);
		byTag.set(tag, bytes.toString().trimEnd().split('\n'));
		mapped.set(tag, new Set());
	}
	for (const [index, line] of source.split('\n').entries()) {
		const [code, comment = ''] = line.split('--', 2);
		const statement = code.trim();
		if (!statement || statement === 'end' || statement.startsWith('struct ')
			|| statement === 'module<const>' || statement === 'return { insert_hash_without_growth = insert_hash_without_growth }') continue;
		const ranges = [...comment.matchAll(/\b([TCHVWM]):([0-9,-]+)/g)];
		assert.ok(ranges.length, `no source owner at BLua ${index + 1}: ${statement}`);
		for (const [, tag, field] of ranges) {
			const lines = byTag.get(tag)!;
			for (const range of field.split(',')) {
				const [first, last = first] = range.split('-').map(Number);
				assert.ok(first > 0 && first <= last && last <= lines.length, `${tag}:${range}`);
				for (let number = first; number <= last; ++number) mapped.get(tag)!.add(number);
			}
		}
	}
	for (const [tag, lines] of [
		['T', [101, 102, 103, 104, 107, 108, 109, 596, 598, 608, 609, 611, 612, 613, 614, 615, 617, 618, 619,
			620, 621, 622, 623, 624, 625, 626, 627, 629, 630, 631, 633, 634, 635, 805, 806, 807, 808, 809]],
		['C', [369, 370, 371, 372, 373, 566, 567, 568, 569, 571, 572, 573, 575, 576, 577, 578, 579, 580,
			581, 582, 583, 584, 585, 587, 588, 589, 590, 591, 593, 594, 595, 596, 597, 638, 639, 640, 641, 643, 644, 645]],
	] as const) for (const line of lines) assert.ok(mapped.get(tag)!.has(line), `${tag}:${line} missing`);
});
