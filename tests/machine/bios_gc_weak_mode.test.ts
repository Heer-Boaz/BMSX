import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueFromTag } from '../../machine/ts/machine/cpu/value';
import { BLUA32_STRING_LENGTH_OFFSET } from '../../machine/ts/spec/blua32/image_format';
import { IO_CART_SELECT } from '../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { createGcWeakModeFixture } from '../helpers/gc_weak_mode';

function grant(cpu: CPU, budget: number) {
	assert.equal(cpu.runUntilDepth(0, budget), RunResult.Yielded);
	const spent = budget - cpu.instructionBudgetRemaining;
	assert.ok(spent > 0);
	return spent;
}

function finish(cpu: CPU, budget = 64) {
	let spent = 0;
	for (let i = 0; i < 128 && cpu.heapServiceActive(); ++i) spent += grant(cpu, budget);
	assert.equal(cpu.heapServiceActive(), false);
	return spent;
}

function call(cpu: CPU, address: number, args: readonly number[]) {
	const occupied = cpu.heapAllocator.occupiedBytes(), charged = cpu.luaHeap.usedBytes();
	assert.ok(cpu.beginHeapService(address, args));
	finish(cpu);
	assert.equal(cpu.heapAllocator.occupiedBytes(), occupied);
	assert.equal(cpu.luaHeap.usedBytes(), charged);
	return cpu.heapServiceResult();
}

function checkRecord(cpu: CPU, [weak, length, byte]: readonly number[], id: number, expected: number) {
	const pool = cpu.stringPool;
	const mode = valueFromTag(ValueTag.String, id);
	assert.equal(cpu.gc['weakModeBits'](mode), expected);
	assert.equal(call(cpu, weak, [ValueTag.String, id]), expected);
	const count = pool.byteLength(id);
	assert.equal(call(cpu, length, [id]), count >>> 0);
	for (let i = 0; i < count; ++i) assert.equal(call(cpu, byte, [id, i]), pool.byteAt(id, i));
}

for (const optLevel of [0, 3] as const) {
	test(`firmware weak-mode reads actual String bodies from both cartridge sockets and System ROM at O${optLevel}`, () => {
		const { cpu, memory, addresses } = createGcWeakModeFixture(optLevel, true);
		runGuestToHalt(cpu, 10_000);
		const cases = [
			['k', 1, 0], ['kk', 0, 0], ['', 0, 0],
			['v', 2, 1], ['vv', 0, 1], ['k0v', 0, 1],
			['kv', 3, 2], ['vk', 3, 2], ['K', 0, 2],
		] as const;
		for (const selected of [0, 1]) {
			memory.writeMappedU32LE(IO_CART_SELECT, selected);
			for (const [text, result, bank] of cases) {
				const id = cpu.stringPool.find(text);
				assert.notEqual(id, undefined);
				assert.equal(id! < RAM_BASE ? 0 : ((id! >>> 31) + 1), bank, text);
				if (bank !== 0) assert.ok((id! & 0x7fffffff) >= CART_ROM_BASE);
				checkRecord(cpu, addresses, id!, result);
			}
		}
		assert.equal(call(cpu, addresses[0], [ValueTag.Table, 0xffffffff]), 0, 'non-String tag never interprets its payload as an address');
	});

	test(`firmware weak-mode matches RAM String length masking, aliases, and exact byte pairs at O${optLevel}`, () => {
		const { cpu, memory, addresses } = createGcWeakModeFixture(optLevel, false);
		runGuestToHalt(cpu, 10_000);
		for (const [text, result] of [['k', 1], ['v', 2], ['kv', 3], ['vk', 3], ['kvk', 0], ['kk', 0], ['k\0', 0], ['\xff', 0], ['', 0]] as const) {
			const id = cpu.stringPool.intern(text);
			assert.ok(id >= RAM_BASE && id < RAM_BASE + MAIN_RAM_SIZE);
			checkRecord(cpu, addresses, id, result);
		}
		const id = cpu.stringPool.intern('kv');
		memory.writeRamRecordWord(id + BLUA32_STRING_LENGTH_OFFSET, 0xab000002);
		const alias = id + MAIN_RAM_SIZE * 7;
		checkRecord(cpu, addresses, alias, 3);
		assert.ok(cpu.beginHeapService(addresses[0], [ValueTag.String, alias]));
		grant(cpu, 1);
		assert.ok(cpu.heapServiceActive());
		const partial = captureCpuCheckpoint(cpu);
		const cycles = finish(cpu, 1);
		assert.equal(cpu.heapServiceResult(), 3);
		restoreCpuCheckpoint(cpu, partial);
		assert.equal(finish(cpu, 1), cycles);
		assert.equal(cpu.heapServiceResult(), 3);
	});
}
