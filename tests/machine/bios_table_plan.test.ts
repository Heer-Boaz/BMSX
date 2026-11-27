import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { TableRebuild, TableRecords } from '../../machine/ts/machine/cpu/table';
import { ValueTag, type Value, valueInteger, valueNil, valuePayload, valueString, valueTable, valueTag } from '../../machine/ts/machine/cpu/value';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';

const MODULE = 'kernel/table_plan';
const port = 'machine/bios/kernel/table_plan.lua';
const basis = '3c4f901cbd0343dfcce3e0c3c0ea78486a56a481';
const SCRATCH_BYTES = 144;
const source = readFileSync(port, 'utf8');
const PROBE = 'table_plan_probe';
const probe = `module<const>
	local plan<const> = require('${MODULE}')
	local record_plan<const> = function(record, tag, word, extra, counted, scratch)
		local array<const>, hash<const>, keep<const> = plan.plan_rehash(record, tag, word, extra, counted, scratch)
		local out<const>: *u32 = 0x08000000 + scratch + ${SCRATCH_BYTES}
		out[0] = array
		out[1] = hash
		out[2] = keep
		return 1
	end
	local policy_plan<const> = function(old_array, old_hash, array, hash, keep, tag, word, scratch)
		local previous<const>, request<const>, bytes<const>, staged_growth<const>, staged<const> = plan.plan_reservation(old_array, old_hash, array, hash, keep)
		local a<const>, h<const> = plan.census_cycles(old_array, old_hash, tag, word)
		local out<const>: *u32 = 0x08000000 + scratch + ${SCRATCH_BYTES}
		out[0] = previous
		out[1] = request
		out[2] = bytes
		out[3] = staged_growth
		out[4] = staged
		out[5] = a
		out[6] = h
		return 1
	end
	return { record_plan = record_plan, policy_plan = policy_plan }`;
const entrySource = 'halt_until_irq';
const roots = [[PROBE, 'record_plan'], [PROBE, 'policy_plan'], [MODULE, 'spend_census_grant']] as const;
const modules = [{ path: MODULE, source }, { path: PROBE, source: probe }].map(module =>
	({ ...module, chunk: parseLuaChunk(module.source, module.path) }));

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const protoIndices = roots.map(([path, key]) => {
		const symbol = object.sections.rodata.moduleExports.find(entry => entry.path === path && entry.exportPathKey === key);
		assert.ok(symbol);
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[symbol.slotName]);
		assert.ok(index >= 0);
		return index;
	});
	const { frames, valueSlots } = deriveBlua32FixedStack(linked.image, protoIndices);
	assert.ok(frames <= HEAP_SERVICE_FRAME_COUNT && valueSlots <= HEAP_SERVICE_VALUE_COUNT, `stack: ${frames} frames, ${valueSlots} values`);
	const { cpu, memory } = createTestSystemCpu(linked), oracle = createTestSystemCpu(linked).cpu;
	for (const target of [cpu, oracle]) runGuestToHalt(target, 10_000);
	function same<T>(action: (target: CPU) => T): T {
		const result = action(cpu);
		assert.deepEqual(action(oracle), result);
		return result;
	}
	const scratch = same(target => target.heapAllocator.allocate(SCRATCH_BYTES + 32, true) - RAM_BASE);
	same(target => {
		for (let i = 0; i < SCRATCH_BYTES; i += 4) target.memory.writeRamRecordWord(scratch + i, 0);
		target.memory.writeRamRecordWord(scratch + SCRATCH_BYTES + 28, 0x27a0bf63);
	});
	const out = (count: number) => Array.from({ length: count }, (_, i) => memory.readRamRecordWord(scratch + SCRATCH_BYTES + 4 * i));
	const densityWords = () => Array.from({ length: 4 }, (_, i) => memory.readRamRecordWord(scratch + 4 * i));
	function begin(which: 0 | 1 | 2, args: readonly number[]) {
		assert.ok(cpu.beginHeapService(linked.image.functions[protoIndices[which]].address, args));
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		assert.ok(cycles - cpu.instructionBudgetRemaining > 0);
	}
	function finish() {
		for (let i = 0; i < 2048 && cpu.heapServiceActive(); ++i) grant(256);
		assert.equal(cpu.heapServiceActive(), false);
		assert.equal(memory.readRamRecordWord(scratch + SCRATCH_BYTES + 28), 0x27a0bf63);
		return cpu.heapServiceResult() | 0;
	}
	function plan(record: number, key: Value, extra: number, counted?: TableRebuild) {
		const { tables } = oracle.gc;
		tables['planRehash'](record, key, extra, counted);
		const { array, hash, keepHash } = tables['resizePlan'];
		const sizes = oracle.heapAllocator.occupiedBytes(), charged = oracle.luaHeap.usedBytes();
		const arrayBase = tables.arrayAddress(record), hashBase = tables.hashAddress(record);
		begin(0, [record, valueTag(key), valuePayload(key), extra, +(counted !== undefined), scratch]);
		assert.equal(finish(), 1);
		assert.deepEqual(out(3), [array, hash, +keepHash]);
		assert.equal(cpu.heapAllocator.occupiedBytes(), sizes);
		assert.equal(cpu.luaHeap.usedBytes(), charged);
		assert.equal(cpu.gc.tables.arrayAddress(record), arrayBase);
		assert.equal(cpu.gc.tables.hashAddress(record), hashBase);
		return out(3);
	}
	return { cpu, oracle, memory, scratch, densityWords, same, begin, grant, finish, plan, out };
}

const int = valueInteger;
const full = (count: number, first = 1) => Array.from({ length: count }, (_, i) => int(first + i));

for (const opt of [0, 3] as const) {
	test(`BLua Table planner matches real native plans and retains backing at O${opt}`, () => {
		const f = fixture(opt);
		function table(array: number, hash: number, keys: readonly Value[]) {
			return f.same(target => {
				const address = target.createTable(array, hash);
				for (const key of keys) target.gc.tables.set(address, key, int(42));
				return address;
			});
		}
		const string = f.same(cpu => valueString(cpu.stringPool.intern('source-table-plan')));
		const missing = f.same(cpu => valueString(cpu.stringPool.intern('source-table-plan-missing')));
		const empty = table(0, 0, []);
		assert.deepEqual(f.plan(empty, int(1), 7), [1, 0, 1]);
		assert.deepEqual(f.plan(empty, int(2), 7), [0, 1, 0]);
		assert.deepEqual(f.plan(empty, int(-0x80000000), 7), [0, 8, 0]);
		const keep = table(4, 1, [...full(4), string]);
		assert.deepEqual(f.plan(keep, int(5), 3), [8, 1, 1]);
		assert.deepEqual(f.plan(keep, missing, 3), [4, 8, 0]);
		const small = table(8, 64, [...full(8), ...full(21, 9), string]);
		// A removed identity key retains its dead payload, not a live census edge.
		f.same(cpu => {
			const owner = cpu.createTable(0, 0);
			cpu.gc.tables.set(small, valueTable(owner), int(1));
			cpu.gc.tables.set(small, valueTable(owner), valueNil());
		});
		assert.deepEqual(f.plan(small, int(30), 0), [32, 1, 0]);
		assert.deepEqual(f.plan(small, missing, 1), [8, 32, 0]);
		const live = table(64, 128, [...full(65), int(127), int(512), string]);
		assert.deepEqual(f.plan(live, int(66), 2), [128, 2, 0]);
		assert.deepEqual(f.plan(live, missing, 3), [64, 8, 0]);
		const bands = table(8, 1024, [...full(10), int(17), int(257), int(0x7fffffff), string]);
		assert.deepEqual(f.plan(bands, int(11), 0), [16, 4, 0]);
		assert.deepEqual(f.plan(bands, int(0x7ffffffd), 0), [16, 8, 0]);
		assert.deepEqual(f.plan(bands, missing, 0), [8, 8, 0]);
		// The strict half-full reservation test rejects an exactly-half array.
		const sparse = table(1024, 64, [int(1), int(4), int(512), int(1024), string]);
		assert.deepEqual(f.plan(sparse, int(1025), 0), [1, 8, 0]);
	});

	test(`BLua census preserves native density, source allowance and checkpoint at O${opt}`, () => {
		const f = fixture(opt);
		const array = 2053, hash = 256;
		const record = f.same(cpu => {
			const address = cpu.createTable(array, hash);
			for (let key = 1; key <= array; ++key)
				if (key % 7 !== 0) cpu.gc.tables.set(address, int(key), int(key));
			for (const key of [4097, 5119, 8193]) cpu.gc.tables.set(address, int(key), int(key));
			return address;
		});
		const job = new TableRebuild();
		for (const budget of [0, 3, -2, 147, 23, 2000]) {
			f.oracle.instructionBudgetRemaining = budget;
			f.oracle.gc.tables['spendCensusGrant'](record, array, job, f.oracle);
			const expected = { cycles: f.oracle.instructionBudgetRemaining, density: [job.scanned, job.live, job.slots, job.kept] };
			f.begin(2, [record, f.scratch, budget]);
			if (budget === 147) {
				const before = f.densityWords()[0];
				do { f.grant(49); } while (f.cpu.heapServiceActive() && f.densityWords()[0] === before);
				assert.equal(f.cpu.heapServiceActive(), true);
				assert.ok(f.densityWords()[0] > before && f.densityWords()[0] < expected.density[0]);
				const checkpoint = captureCpuCheckpoint(f.cpu);
				assert.equal(f.finish(), expected.cycles);
				const after = f.densityWords();
				restoreCpuCheckpoint(f.cpu, checkpoint);
				assert.equal(f.finish(), expected.cycles);
				assert.deepEqual(f.densityWords(), after);
			} else {
				assert.equal(f.finish(), expected.cycles);
			}
			assert.deepEqual(f.densityWords(), expected.density);
		}
		assert.equal(job.scanned, array);
		assert.deepEqual(f.plan(record, int(2054), 0, job), f.plan(record, int(2054), 0));
	});

	test(`BLua planner uses original allocation extents and staging thresholds at O${opt}`, () => {
		const f = fixture(opt);
		for (const [oldArray, oldHash, array, hash, keep, tag, word, stagedGrowth, staged, arrayCycles, hashCycles] of [
			[4, 1, 8, 1, 1, ValueTag.Integer, 5, 0, 0, 0, 0],
			[16, 64, 16, 128, 0, ValueTag.String, 144, 0, 0, 0, 0],
			[65, 128, 65, 256, 0, ValueTag.Integer, 192, 0, 1, 1, 32],
			[0, 128, 8, 256, 0, ValueTag.Integer, 8, 0, 1, 0, 32],
			[1024, 0, 2048, 0, 1, ValueTag.Integer, 1025, 1, 1, 240, 0],
			[2053, 1024, 8, 2048, 0, ValueTag.Integer, 2054, 0, 1, 498, 0],
			[1024, 512, 1024, 1024, 0, ValueTag.Integer, -1, 0, 1, 0, 0],
		] as const) {
			f.begin(1, [oldArray, oldHash, array, hash, keep, tag, word, f.scratch]);
			assert.equal(f.finish(), 1);
			assert.deepEqual(f.out(7), [
				TableRecords.allocationCharge(oldArray, oldHash), TableRecords.allocationCharge(array, hash),
				TableRecords.storageBytes(array > oldArray ? array : 0, keep ? 0 : hash), stagedGrowth, staged, arrayCycles, hashCycles,
			]);
		}
	});
}

const references = [
	['T', 'machine/ts/machine/cpu/table.ts', '8143aa5d72636389592dd04c1c271cf73fe4d6447ac8dc63a0cb352be5e7b255'],
	['C', 'machine/cpp/machine/cpu/table.cpp', '783f0ca0f9d55a227d430a360ed19556c50c0d233bcfe7b715b3c1a441a4233e'],
	['H', 'machine/cpp/machine/cpu/table.h', '975c598973a6b809af9e3dcdca304b75bc1787bb3132414982ebcec44e311412'],
	['J', 'machine/cpp/machine/cpu/table_rebuild.h', '3949c956a6d04499b9a4093613a170af13bef7dc8a558b4b0491140ba13c367b'],
	['V', 'machine/ts/machine/cpu/value.ts', 'bdafe30a070405b98b673dfe76e0daad1384ccd87ee7ca26584eba734204c641'],
	['W', 'machine/cpp/machine/cpu/value.h', 'cb211876c00637f49334db80b281d4af8a17f978bdceb736b6c9a177b9abe94e'],
	['N', 'machine/cpp/common/count_nonzero.h', 'ad8a2ac57554d53d6ed9ad51c453f59fb05d6d6b411619ca14aaa0d2db3fb9e1'],
	['M', 'machine/ts/spec/bmsx/memory_map.ts', '00dbd23e01f06a9aaf126c55fa7ba6c3306b5ac86caa3adfa695b6b9360fe1f0'],
] as const;

test('Table planner pins both source mirrors and accounts for executable statements', () => {
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
		const trimmed = code.trim();
		if (!trimmed || trimmed === 'end' || trimmed === '}' || trimmed === '},' || trimmed.startsWith('struct ')
			|| trimmed === 'module<const>' || trimmed === 'return {' || trimmed === 'internal = { bit_width = bit_width, count_nonzero_bytes = count_nonzero_bytes, count_array_range = count_array_range,'
			|| /^(census_cycles|spend_census_grant|plan_rehash|plan_reservation|count_integer_key) = .*[,}]$/.test(trimmed))
			continue;
		const ranges = [...comment.matchAll(/\b([TCHJVWNM]):([0-9,-]+)/g)];
		assert.ok(ranges.length, `no owner at BLua ${index + 1}: ${trimmed}`);
		for (const [, tag, field] of ranges) {
			const lines = byTag.get(tag)!;
			for (const range of field.split(',')) {
				const [first, last = first] = range.split('-').map(Number);
				assert.ok(first > 0 && first <= last && last <= lines.length, `${tag}:${range}`);
				for (let number = first; number <= last; ++number) mapped.get(tag)!.add(number);
			}
		}
	}
	const sourceDecisions = [
		['C', [158, 159, 160, 161, 162, 167, 168, 169, 170, 177, 179, 183, 188, 190, 193, 194, 195, 196, 197,
			199, 200, 201, 203, 204, 207, 208, 209, 211, 215, 216, 217, 218, 219, 220, 221, 222, 227, 228, 230, 231,
			232, 233, 234, 235, 236, 237, 239, 242, 243, 244, 245, 252, 258, 259, 260, 313, 314, 315, 316]],
		['T', [671, 672, 673, 675, 676, 677, 678, 679, 680, 681, 682, 686, 687, 688, 691, 692, 693, 694, 696, 698,
			699, 700, 701, 703, 704, 705, 708, 710, 711, 712, 715, 716, 718, 719, 721, 722, 723, 724, 725, 726, 727,
			728, 729, 730, 732, 733, 734, 735, 736, 737, 738, 739, 740, 743, 744, 745, 746, 747, 748, 749, 750, 751,
			753, 754, 755, 756, 763, 764, 765, 766, 767, 784, 790, 846, 847]],
	] as const;
	for (const [mirror, decisions] of sourceDecisions)
		for (const line of decisions) assert.ok(mapped.get(mirror)!.has(line), `${mirror}:${line} missing`);
});
