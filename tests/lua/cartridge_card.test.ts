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
	public readonly pages: number[] = [];
	public readonly ranges: Array<readonly [number, number]> = [];

	public invalidateMappedPage(key: number): void {
		this.pages.push(key);
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
	ramBinding.writeWatches![ramBinding.writeWatchIndex] = 1;
	card.writeU32(CART_RAM_BASE, 0xaabbccdd);
	assert.equal(card.readU32(CART_RAM_BASE), 0xaabbccdd);
	assert.deepEqual(invalidator.pages, [MAPPED_KEY_OFFSET + CART_RAM_BASE]);

	card.writeU32(CART_RAM_BASE, 0x55667788);
	assert.deepEqual(invalidator.pages, [MAPPED_KEY_OFFSET + CART_RAM_BASE]);
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
	assert.equal(card.readU32(CART_RAM_BASE), 0);
	assert.equal(card.readU32(CART_MMIO_BASE), 0);
});

test('RAM-only cartridge leaves the ROM aperture unbacked', () => {
	const card = new CartridgeCard({
		rom: null,
		ramByteCount: 16,
		mailboxPresent: false,
	}, MAPPED_KEY_OFFSET);
	const view = { bytes: new Uint8Array(0), byteOffset: 0, byteLength: 0 };
	assert.equal(card.readU32(CART_ROM_BASE), 0);
	assert.equal(card.bindRomByteView(CART_ROM_BASE, 4, view), false);
	assert.equal(card.readU32(CART_RAM_BASE), 0);
});
