import { GC_PACE_PAID } from '../helpers/native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../helpers/firmware_heap_layout';
import { nativeHeapReference } from '../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { MAIN_RAM_SIZE } from '../../machine/ts/spec/bmsx/memory_map';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { createTestHeapServiceCpu } from '../helpers/heap_service_system';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe, linkFirmwareProbe } from '../helpers/ordinary_firmware_probe';

const PACE = 'kernel/gc_pace', PROBE = 'test/word_arithmetic';
const probe = `module<const>
local word<const> = require('kernel/word_arithmetic')
local ram_base<const> = 0x08000000
struct output
	high: u32
	low: u32
	quotient_high: u32
end
local run<const> = function(destination, left, right, addend, divisor)
	local high<const>, low<const> = word.multiply_add_words(left, right, addend)
	local qhi<const>, qlo<const> = word.divide_words_by_word(high, low, divisor)
	local buffer<const>: *output = ram_base + destination
	buffer.high = high
	buffer.low = low
	buffer.quotient_high = qhi
	return qlo
end
return { run = run }
`;
const modules = [
	...['kernel/gc_control', 'kernel/word_arithmetic', PACE].map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') })),
	{ path: PROBE, source: probe },
].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));

function referenceCpp(basis: number, paid: number, estimate: number, runway: number): number {
	const batch = paid < estimate ? Math.min(512, estimate - paid) : 512;
	const product = BigInt((paid + batch) >>> 0) * BigInt(runway);
	const next = BigInt(basis | 0) + (product + BigInt(estimate - 1)) / BigInt(estimate);
	return next < 0n ? 0 : next > MAIN_RAM_SIZE ? MAIN_RAM_SIZE : Number(next);
}

function fixture(optLevel: 0 | 3) {
	const begin = 0, update = 1, words = 2;
	const linked = linkFirmwareProbe(optLevel, modules, [
		{ path: PACE, member: 'begin_pace_credit', arity: 5, result: false },
		{ path: PACE, member: 'update_pace_credit', arity: 5, result: false },
		{ path: PROBE, member: 'run', arity: 5 },
	]);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	runGuestToHalt(cpu, 10_000);
	runGuestToHalt(oracle, 10_000);
	const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	const state = control + GC_PACE_PAID - 12, scratch = management + 0x680;
	const occupied = cpu.heapAllocator.occupiedBytes();
	const beginCall = (index: number, args: readonly number[]) => {
		issueFirmwareProbe(cpu, args, index);
	};
	const grant = (cycles: number) => {
		const spent = grantFirmwareProbe(cpu, cycles);
		assert.ok(spent > 0);
		return spent;
	};
	function finish() {
		let spent = 0;
		for (let count = 0; count < 128 && !cpu.isHaltedUntilIrq(); ++count) spent += grant(128);
		assert.ok(cpu.isHaltedUntilIrq());
		assert.equal(cpu.heapAllocator.occupiedBytes(), occupied);
		return spent;
	}
	function lanes(target = memory): readonly number[] {
		return Array.from({ length: 5 }, (_, index) => target.readRamRecordWord(state + 4 * index));
	}
	return { cpu, oracle, memory, begin, update, words, control, scratch, occupied, beginCall, grant, finish, lanes };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua exact word multiply-add/divide agrees with unsigned arithmetic at O${optLevel}`, () => {
		const { cpu, memory, words, scratch, beginCall, finish } = fixture(optLevel);
		const cases: number[][] = [
			[0, 0, 0, 1], [1, 0, 0x80000000, 17], [65535, 65535, 0xffffffff, 65535],
			[0xffffffff, 0xffffffff, 0xffffffff, 1], [0xffffffff, 0xffffffff, 0xfffffffe, 0xffffffff],
			[0x80000000, 0x80000000, 0, 0x80000001], [0x80000000, 1, 0, 0x80000001],
			[0, 5, 0xffffffff, 0xffffffff], [0xffffffff, 17, 0xff, 0x80000000],
		];
		let seed = 0xd2b74407;
		for (let index = 0; index < 80; ++index) {
			const next = () => {
				seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
				return seed >>> 0;
			};
			cases.push([next(), next(), next(), next() | 1]);
		}
		for (const [left, right, addend, divisor] of cases) {
			const numerator = BigInt(left) * BigInt(right) + BigInt(addend);
			const quotient = numerator / BigInt(divisor >>> 0);
			beginCall(words, [scratch, left, right, addend, divisor]);
			finish();
			assert.equal(memory.readRamRecordWord(scratch), Number(numerator >> 32n));
			assert.equal(memory.readRamRecordWord(scratch + 4), Number(BigInt.asUintN(32, numerator)));
			assert.equal(memory.readRamRecordWord(scratch + 8), Number(quotient >> 32n));
			assert.equal(firmwareProbeResult(cpu), Number(BigInt.asUintN(32, quotient)));
		}
	});

	test(`BLua collector pace preserves publication, signed basis and resume at O${optLevel}`, () => {
		const { cpu, oracle, begin, update, control, occupied, beginCall, grant, finish, lanes } = fixture(optLevel);
		const capacity = cpu.heapAllocator.capacityBytes();
		for (const [estimate, shift] of [[1, 0], [8192, 1], [513, 0]] as const) {
			nativeHeapReference(oracle).gc['beginPaceCredit'](estimate, shift);
			beginCall(begin, [control, occupied, capacity, estimate, shift]);
			finish();
			assert.deepEqual(lanes(), lanes(oracle.memory));
		}
		beginCall(begin, [control, 4096, 4096, 2048, 1]);
		finish();
		assert.deepEqual(lanes(), [4096, 2048, 1, 0, 4097], 'a full arena still prices the next batch at one-byte runway');
		nativeHeapReference(oracle).gc['beginPaceCredit'](513, 0);
		beginCall(begin, [control, occupied, capacity, 513, 0]);
		finish();
		const cases = [
			[-2_000_000, 1_589_999, 3_333_333, 3_500_000], // widened non-clamped update
			[102, 1, 1024, 127], [102, 1023, 1024, 127], [102, 1024, 1024, 127],
			[-1000, 0, 512, 1], [0, 0, 513, 9], [0, 0, 512, 9],
			[MAIN_RAM_SIZE - 10, 777, 1, MAIN_RAM_SIZE],
			[-2_000_000, 2_500_000, 3_300_001, 3_600_001],
			[-400, 3_800_000, 4_000_000, 3_800_000],
			[-0x80000000, 0x80000000, 2, 2], // undo a signed basis after an unsigned word-sized quotient
		] as const;
		for (const [index, [basis, paid, estimate, runway]] of cases.entries()) {
			const before = lanes();
			nativeHeapReference(oracle).gc['updatePaceCredit'](basis, paid, estimate, runway);
			beginCall(update, [control, basis, paid, estimate, runway]);
			if (index === 0) {
				grant(64);
				assert.ok(cpu.fixedInterruptActive());
				assert.deepEqual(lanes(), before, 'widened division has not published a threshold');
				const arithmetic = captureCpuCheckpoint(cpu);
				for (let count = 0; count < 2048 && lanes()[0] === before[0]; ++count) grant(1);
				assert.ok(cpu.fixedInterruptActive());
				assert.deepEqual(lanes(), [basis >>> 0, ...before.slice(1)], 'basis is the first update store');
				const publication = captureCpuCheckpoint(cpu);
				const final = finish();
				assert.deepEqual(lanes(), lanes(oracle.memory));
				restoreCpuCheckpoint(cpu, publication);
				assert.equal(finish(), final);
				restoreCpuCheckpoint(cpu, arithmetic);
				assert.ok(finish() > final);
			} else finish();
			assert.deepEqual(lanes(), lanes(oracle.memory));
			assert.equal(lanes()[4], referenceCpp(basis, paid, estimate, runway));
		}
		// The pure word port follows C++'s paid+batch wrap. JS keeps the
		// carry above bit 31 and reaches a different clamped pay threshold.
		nativeHeapReference(oracle).gc['updatePaceCredit'](0, 0xffffffff, 512, 1);
		beginCall(update, [control, 0, 0xffffffff, 512, 1]);
		finish();
		assert.equal(lanes()[4], referenceCpp(0, 0xffffffff, 512, 1));
		assert.equal(lanes()[4], 1);
		assert.equal(lanes(oracle.memory)[4], MAIN_RAM_SIZE);
		// No word wraps here: the legacy TS multiplication rounds a
		// numerator above 2^53 and moves the threshold by one byte.
		nativeHeapReference(oracle).gc['updatePaceCredit'](0, 2_200_000_000, 2_200_000_001, 4_094_427);
		beginCall(update, [control, 0, 2_200_000_000, 2_200_000_001, 4_094_427]);
		finish();
		assert.equal(lanes()[4], referenceCpp(0, 2_200_000_000, 2_200_000_001, 4_094_427));
		assert.equal(lanes()[4], 4_094_427);
		assert.equal(lanes(oracle.memory)[4], 4_094_428);
	});
}
