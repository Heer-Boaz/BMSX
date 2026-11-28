import { nativeHeapReference } from '../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag, valueFromTag } from '../../machine/ts/machine/cpu/value';
import { BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_RECORD_HEADER_SIZE, BLUA32_STRING_RECORD_KIND } from '../../machine/ts/spec/blua32/image_format';
import { IO_CART_SELECT } from '../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE, MAIN_RAM_SIZE, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { createGcWeakModeFixture, WEAK_MODE_RAM_RECORD, WeakModeProbe } from '../helpers/gc_weak_mode';
import { firmwareProbeResult, grantFirmwareProbe, issueFirmwareProbe } from '../helpers/ordinary_firmware_probe';

function grant(cpu: CPU, budget: number) {
	const spent = grantFirmwareProbe(cpu, budget);
	assert.ok(spent > 0);
	return spent;
}

function finish(cpu: CPU, budget = 64) {
	let spent = 0;
	for (let i = 0; i < 128 && !cpu.isHaltedUntilIrq(); ++i) spent += grant(cpu, budget);
	assert.ok(cpu.isHaltedUntilIrq());
	assert.equal(cpu.readExceptionReturnFrameDepth(), -1);
	assert.equal(cpu.readLuaFaultReasonWord(), 0);
	return spent;
}

function call(cpu: CPU, operation: WeakModeProbe, args: readonly number[]) {
	const occupied = nativeHeapReference(cpu).heapAllocator.occupiedBytes(), charged = nativeHeapReference(cpu).luaHeap.usedBytes();
	issueFirmwareProbe(cpu, args, operation);
	finish(cpu);
	assert.equal(nativeHeapReference(cpu).heapAllocator.occupiedBytes(), occupied);
	assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), charged);
	return firmwareProbeResult(cpu);
}

function checkRecord(cpu: CPU, id: number, expected: number) {
	const pool = nativeHeapReference(cpu).stringPool;
	const mode = valueFromTag(ValueTag.String, id);
	assert.equal(nativeHeapReference(cpu).gc['weakModeBits'](mode), expected);
	assert.equal(call(cpu, WeakModeProbe.Bits, [ValueTag.String, id]), expected);
	const count = pool.byteLength(id);
	assert.equal(call(cpu, WeakModeProbe.Length, [id]), count >>> 0);
	for (let i = 0; i < count; ++i) assert.equal(call(cpu, WeakModeProbe.Byte, [id, i]), pool.byteAt(id, i));
}

for (const optLevel of [0, 3] as const) {
	test(`firmware weak-mode reads actual String bodies from both cartridge sockets and System ROM at O${optLevel}`, () => {
		const { cpu, memory, ids } = createGcWeakModeFixture(optLevel, true);
		runGuestToHalt(cpu, 10_000);
		const cases = [
			['k', 1, 0], ['kk', 0, 0], ['', 0, 0],
			['v', 2, 1], ['vv', 0, 1], ['k0v', 0, 1],
			['kv', 3, 2], ['vk', 3, 2], ['K', 0, 2],
		] as const;
		for (const selected of [0, 1]) {
			memory.writeMappedU32LE(IO_CART_SELECT, selected);
			for (const [text, result, bank] of cases) {
				const id = ids.get(text);
				assert.notEqual(id, undefined);
				assert.equal(id! < RAM_BASE ? 0 : ((id! >>> 31) + 1), bank, text);
				if (bank !== 0) assert.ok((id! & 0x7fffffff) >= CART_ROM_BASE);
				checkRecord(cpu, id!, result);
			}
		}
		assert.equal(call(cpu, WeakModeProbe.Bits, [ValueTag.Table, 0xffffffff]), 0, 'non-String tag never interprets its payload as an address');
	});

	test(`firmware weak-mode matches RAM String length masking, aliases, and exact byte pairs at O${optLevel}`, () => {
		const { cpu, memory } = createGcWeakModeFixture(optLevel, false);
		runGuestToHalt(cpu, 10_000);
		const id = WEAK_MODE_RAM_RECORD;
		memory.writeRamRecordWord(id, BLUA32_STRING_RECORD_KIND);
		for (const [text, result] of [['k', 1], ['v', 2], ['kv', 3], ['vk', 3], ['kvk', 0], ['kk', 0], ['k\0', 0], ['\xff', 0], ['', 0]] as const) {
			memory.writeRamRecordWord(id + BLUA32_STRING_LENGTH_OFFSET, text.length);
			for (let i = 0; i < text.length; ++i) memory.writeRamRecordByte(id + BLUA32_STRING_RECORD_HEADER_SIZE + i, text.charCodeAt(i));
			checkRecord(cpu, id, result);
		}
		memory.writeRamRecordWord(id + BLUA32_STRING_LENGTH_OFFSET, 0xab000002);
		memory.writeRamRecordPair(id + BLUA32_STRING_RECORD_HEADER_SIZE, 0x0000766b, 0);
		const alias = id + MAIN_RAM_SIZE * 7;
		checkRecord(cpu, alias, 3);
		issueFirmwareProbe(cpu, [ValueTag.String, alias], WeakModeProbe.Bits);
		for (let i = 0; i < 16 && cpu.readExceptionReturnFrameDepth() === -1; ++i) grant(cpu, 1);
		assert.equal(cpu.readExceptionReturnFrameDepth(), 1, 'the System vector is active on the reset bank');
		const partial = captureCpuCheckpoint(cpu);
		const cycles = finish(cpu, 1);
		assert.equal(firmwareProbeResult(cpu), 3);
		restoreCpuCheckpoint(cpu, partial);
		assert.equal(finish(cpu, 1), cycles);
		assert.equal(firmwareProbeResult(cpu), 3);
	});
}
