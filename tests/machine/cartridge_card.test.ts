import assert from 'node:assert/strict';
import { test } from 'node:test';

import { writeLE32 } from '../../machine/ts/common/endian';
import { CartridgeCard } from '../../machine/ts/machine/devices/cartridge/card';
import type { CartridgeCardMedia } from '../../machine/ts/machine/devices/cartridge/contracts';
import {
	CARTRIDGE_CARD_DREQ_READ,
	CARTRIDGE_CARD_EFFECT_DREQ_CHANGED,
	CARTRIDGE_CARD_EFFECT_IRQ_EDGE,
} from '../../machine/ts/machine/devices/cartridge/signals';
import type {
	MappedPageBinding,
	MappedPageInvalidator,
} from '../../machine/ts/machine/memory/memory';
import { MAPPED_PAGE_BYTE_SIZE, MappedPageWriteWatches } from '../../machine/ts/machine/memory/mapped_page';
import {
	CARTRIDGE_MAILBOX_CONTROL_DREQ_READ,
	CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER,
	CARTRIDGE_MAILBOX_CONTROL_OFFSET,
	CARTRIDGE_MAILBOX_DATA_OFFSET,
	CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET,
	CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING,
	CARTRIDGE_MAILBOX_STATUS_OFFSET,
} from '../../machine/ts/spec/bmsx/cartridge';
import {
	CART_MMIO_BASE,
	CART_RAM_BASE,
	CART_ROM_BASE,
	CART_ROM_END,
} from '../../machine/ts/spec/bmsx/memory_map';

const MAPPED_KEY_OFFSET = 0x100000000;

class RecordingInvalidator implements MappedPageInvalidator {
	public readonly writes: Array<readonly [number, number, number]> = [];
	public readonly ranges: Array<readonly [number, number]> = [];

	public invalidateMappedWords(key: number, firstWord: number, endWord: number): void {
		this.writes.push([key, firstWord, endWord]);
	}

	public invalidateMappedRange(firstKey: number, endKey: number): void {
		this.ranges.push([firstKey, endKey]);
	}
}

function binding(): MappedPageBinding {
	return {
		key: 0,
		cacheable: false,
		readBytes: null,
		readByteOffset: 0,
		writeWatches: null,
		writeWatchIndex: 0,
	};
}

function media(rom: Uint8Array): CartridgeCardMedia {
	return {
		rom,
		ramByteCount: 2048,
		mailboxPresent: true,
	};
}

test('cartridge card binds ROM and RAM pages directly with socket-local keys', () => {
	const rom = new Uint8Array(2048);
	writeLE32(rom, 0, 0x11223344);
	const card = new CartridgeCard(media(rom), MAPPED_KEY_OFFSET);
	const invalidator = new RecordingInvalidator();
	card.attachMappedPageInvalidator(invalidator);

	const romBinding = binding();
	card.bindMappedPage(CART_ROM_BASE, romBinding);
	assert.equal(romBinding.key, MAPPED_KEY_OFFSET + CART_ROM_BASE);
	assert.equal(romBinding.cacheable, true);
	assert.equal(romBinding.readBytes, rom);
	assert.equal(romBinding.readByteOffset, 0);

	const ramBinding = binding();
	card.bindMappedPage(CART_RAM_BASE, ramBinding);
	assert.equal(ramBinding.key, MAPPED_KEY_OFFSET + CART_RAM_BASE);
	assert.equal(ramBinding.cacheable, true);
	assert.equal(ramBinding.readBytes?.byteLength, 2048);
	assert.notEqual(ramBinding.writeWatches, null);
	ramBinding.writeWatches!.armWord(ramBinding.writeWatchIndex, 0);
	ramBinding.writeWatches!.armWord(ramBinding.writeWatchIndex, 8);
	card.writeU32(CART_RAM_BASE, 0xaabbccdd);
	assert.equal(card.readU32(CART_RAM_BASE), 0xaabbccdd);
	assert.deepEqual(invalidator.writes, [[MAPPED_KEY_OFFSET + CART_RAM_BASE, 0, 1]]);

	card.writeU32(CART_RAM_BASE, 0x55667788);
	assert.equal(invalidator.writes.length, 1, 'already invalidated source word needs no repeated callback');
	card.writeU16(CART_RAM_BASE + 8 * 4, 0x1234);
	assert.deepEqual(invalidator.writes, [[MAPPED_KEY_OFFSET + CART_RAM_BASE, 0, 1], [MAPPED_KEY_OFFSET + CART_RAM_BASE, 8, 9]]);
	card.clearMappedPageWriteWatches();
	card.writeU8(CART_RAM_BASE, 0x99);
	assert.equal(invalidator.writes.length, 2);
});

test('mapped writes retain watches and report each containing source-word window', () => {
	const pageBytes = MAPPED_PAGE_BYTE_SIZE;
	const watches = new MappedPageWriteWatches(3 * pageBytes);
	for (let page = 0; page < 3; page++) {
		const pageBinding = binding();
		watches.bind(page * pageBytes, pageBinding);
		pageBinding.writeWatches!.armWord(pageBinding.writeWatchIndex, 0);
		pageBinding.writeWatches!.armWord(pageBinding.writeWatchIndex, pageBytes / 4 - 1);
	}
	const invalidator = new RecordingInvalidator();
	watches.invalidateWrite(pageBytes - 3, pageBytes + 7, MAPPED_KEY_OFFSET, invalidator);
	assert.deepEqual(invalidator.writes, [
		[MAPPED_KEY_OFFSET, 255, 256],
		[MAPPED_KEY_OFFSET + pageBytes, 0, 256],
		[MAPPED_KEY_OFFSET + 2 * pageBytes, 0, 1],
	]);
	watches.invalidateWrite(1, 2, MAPPED_KEY_OFFSET, invalidator);
	assert.deepEqual(invalidator.writes[3], [MAPPED_KEY_OFFSET, 0, 1]);
	watches.clear();
	watches.invalidateWrite(0, 3 * pageBytes, MAPPED_KEY_OFFSET, invalidator);
	assert.equal(invalidator.writes.length, 4);
});

test('every mapped source word consumes only its own changed bytes', () => {
	const watches = new MappedPageWriteWatches(MAPPED_PAGE_BYTE_SIZE);
	const pageBinding = binding();
	watches.bind(0, pageBinding);
	const invalidator = new RecordingInvalidator();
	for (let word = 0; word < MAPPED_PAGE_BYTE_SIZE / 4; word++) {
		for (const delta of [-5, -1, 0, 3, 4]) for (const length of [1, 2, 4, 8]) {
			const firstByte = word * 4 + delta;
			if (firstByte < 0 || firstByte + length > MAPPED_PAGE_BYTE_SIZE) continue;
			watches.clear();
			watches.armWord(0, word);
			invalidator.writes.length = 0;
			watches.invalidateWrite(firstByte, length, MAPPED_KEY_OFFSET, invalidator);
			const overlaps = firstByte < (word + 1) * 4 && firstByte + length > word * 4;
			assert.equal(invalidator.writes.length, overlaps ? 1 : 0);
			if (overlaps) assert.deepEqual(invalidator.writes[0], [MAPPED_KEY_OFFSET, firstByte >>> 2, (firstByte + length + 3) >>> 2]);
			watches.invalidateWrite(firstByte, length, MAPPED_KEY_OFFSET, invalidator);
			assert.equal(invalidator.writes.length, overlaps ? 1 : 0, 'consumed word bits do not invalidate twice');
			watches.invalidateWrite(word * 4, 1, MAPPED_KEY_OFFSET, invalidator);
			assert.equal(invalidator.writes.length, 1, 'unaffected source word remains armed');
		}
	}
});

test('single-word consumption retains neighboring words, groups and the high mask bit', () => {
	const watches = new MappedPageWriteWatches(MAPPED_PAGE_BYTE_SIZE);
	const pageBinding = binding();
	watches.bind(0, pageBinding);
	for (const word of [30, 31, 32, 63, 64, 255]) watches.armWord(0, word);
	const invalidator = new RecordingInvalidator();
	for (const word of [31, 30, 32, 64, 63, 255]) {
		const before = invalidator.writes.length;
		watches.invalidateWrite(word * 4 + 3, 1, MAPPED_KEY_OFFSET, invalidator);
		assert.equal(invalidator.writes.length, before + 1);
		assert.deepEqual(invalidator.writes.at(-1), [MAPPED_KEY_OFFSET, word, word + 1]);
		watches.invalidateWrite(word * 4, 4, MAPPED_KEY_OFFSET, invalidator);
		assert.equal(invalidator.writes.length, before + 1);
	}
});

test('cartridge card invalidates its mapped regions when ROM or RAM state changes', () => {
	const card = new CartridgeCard(media(new Uint8Array(2048)), MAPPED_KEY_OFFSET);
	const invalidator = new RecordingInvalidator();
	card.attachMappedPageInvalidator(invalidator);

	const replacement = new Uint8Array(2048);
	writeLE32(replacement, 0, 0x89abcdef);
	card.installRom(replacement);
	assert.deepEqual(invalidator.ranges, [[
		MAPPED_KEY_OFFSET + CART_ROM_BASE,
		MAPPED_KEY_OFFSET + CART_ROM_END,
	]]);
	assert.equal(card.readU32(CART_ROM_BASE), 0x89abcdef);

	const state = card.captureState();
	writeLE32(state.ram!, 0, 0x12345678);
	card.restoreState(state);
	assert.deepEqual(invalidator.ranges[1], [
		MAPPED_KEY_OFFSET + CART_RAM_BASE,
		MAPPED_KEY_OFFSET + CART_RAM_BASE + 2048,
	]);
	assert.equal(card.readU32(CART_RAM_BASE), 0x12345678);
});

test('cartridge mailbox owns raw registers, edge latch, request lines, and state', () => {
	const card = new CartridgeCard(media(new Uint8Array(0)), MAPPED_KEY_OFFSET);
	const controlAddress = CART_MMIO_BASE + CARTRIDGE_MAILBOX_CONTROL_OFFSET;
	const statusAddress = CART_MMIO_BASE + CARTRIDGE_MAILBOX_STATUS_OFFSET;

	card.writeU32(CART_MMIO_BASE + CARTRIDGE_MAILBOX_DATA_OFFSET, 0x11223344);
	assert.equal(
		card.writeU32(
			controlAddress,
			0x80000000 | CARTRIDGE_MAILBOX_CONTROL_DREQ_READ | CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER,
		),
		CARTRIDGE_CARD_EFFECT_DREQ_CHANGED | CARTRIDGE_CARD_EFFECT_IRQ_EDGE,
	);
	assert.equal(
		card.readU32(controlAddress),
		(0x80000000 | CARTRIDGE_MAILBOX_CONTROL_DREQ_READ) >>> 0,
	);
	assert.equal(card.readU32(statusAddress), CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING);
	assert.equal(card.dreqLines(), CARTRIDGE_CARD_DREQ_READ);
	assert.equal(
		card.writeU32(controlAddress, CARTRIDGE_MAILBOX_CONTROL_DREQ_READ | CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER),
		0,
	);

	card.writeU32(CART_MMIO_BASE + CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET, 1);
	assert.equal(card.readU32(statusAddress), 0);
	assert.equal(
		card.writeU32(controlAddress, CARTRIDGE_MAILBOX_CONTROL_DREQ_READ | CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER),
		CARTRIDGE_CARD_EFFECT_IRQ_EDGE,
	);

	card.writeU32(CART_RAM_BASE, 0xdeadbeef);
	card.reset();
	assert.equal(card.readU32(CART_RAM_BASE), 0xdeadbeef);
	assert.equal(card.readU32(CART_MMIO_BASE + CARTRIDGE_MAILBOX_DATA_OFFSET), 0);
	assert.equal(card.dreqLines(), 0);
});

test('ROM-only cartridge state contains no synthetic devices', () => {
	const card = new CartridgeCard({
		rom: new Uint8Array(0),
		ramByteCount: null,
		mailboxPresent: false,
	}, MAPPED_KEY_OFFSET);
	assert.deepEqual(card.captureState(), { ram: null, mailbox: null });
	assert.equal(card.readU32(CART_RAM_BASE), null);
	assert.equal(card.readU32(CART_MMIO_BASE), null);
});

test('complete card storage access is handled, but the missing tail is not', () => {
	const card = new CartridgeCard({
		rom: Uint8Array.of(1, 2, 3, 4, 5, 6, 7), ramByteCount: 7, mailboxPresent: false,
	}, MAPPED_KEY_OFFSET);
	assert.equal(card.readU32(CART_ROM_BASE), 0x04030201);
	assert.equal(card.readU8(CART_ROM_BASE + 6), 7);
	assert.equal(card.readU8(CART_ROM_BASE + 7), null);
	assert.equal(card.readU16(CART_ROM_BASE + 6), null);
	assert.equal(card.readU32(CART_ROM_BASE + 4), null);
	assert.equal(card.writeU32(CART_ROM_BASE, 0xffffffff), 0);
	assert.equal(card.readU32(CART_ROM_BASE), 0x04030201);
	assert.equal(card.writeU8(CART_ROM_BASE + 7, 0), false);
	assert.equal(card.writeU16(CART_ROM_BASE + 6, 0), false);
	assert.equal(card.writeU32(CART_ROM_BASE + 4, 0), null);
	assert.equal(card.writeU8(CART_RAM_BASE + 6, 0x67), true);
	assert.equal(card.writeU16(CART_RAM_BASE + 6, 0), false);
	assert.equal(card.writeU32(CART_RAM_BASE + 4, 0), null);
	assert.equal(card.readU8(CART_RAM_BASE + 6), 0x67);
	assert.equal(card.readU8(CART_RAM_BASE + 7), null);
	assert.equal(card.readU16(CART_RAM_BASE + 6), null);
	assert.equal(card.readU32(CART_RAM_BASE + 4), null);
	assert.equal(card.readU8(CART_MMIO_BASE), null);
	assert.equal(card.readU16(CART_MMIO_BASE), null);
	assert.equal(card.readU32(CART_MMIO_BASE), null);
	assert.equal(card.writeU8(CART_MMIO_BASE, 0), false);
	assert.equal(card.writeU16(CART_MMIO_BASE, 0), false);
	assert.equal(card.writeU32(CART_MMIO_BASE, 0), null);
	const fitted = new CartridgeCard({ rom: null, ramByteCount: null, mailboxPresent: true }, MAPPED_KEY_OFFSET);
	assert.equal(fitted.readU32(CART_MMIO_BASE + 0x10), 0);
	assert.equal(fitted.writeU32(CART_MMIO_BASE + 0x10, 123), 0);
});

test('RAM-only cartridge leaves the ROM aperture unbacked', () => {
	const card = new CartridgeCard({
		rom: null,
		ramByteCount: 16,
		mailboxPresent: false,
	}, MAPPED_KEY_OFFSET);
	const view = { bytes: new Uint8Array(0), byteOffset: 0, byteLength: 0 };
	assert.equal(card.readU32(CART_ROM_BASE), null);
	assert.equal(card.bindRomByteView(CART_ROM_BASE, 4, view), false);
	assert.equal(card.readU32(CART_RAM_BASE), 0);
});
