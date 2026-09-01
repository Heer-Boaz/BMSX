import assert from 'node:assert/strict';
import test from 'node:test';

import type { Memory } from '../../machine/ts/machine/memory/memory';
import {
	CARTRIDGE_MAILBOX_CONTROL_DREQ_READ,
	CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE,
	CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER,
	CARTRIDGE_MAILBOX_CONTROL_OFFSET,
	CARTRIDGE_MAILBOX_DATA_OFFSET,
} from '../../machine/ts/spec/bmsx/cartridge';
import { IO_CART_SELECT } from '../../machine/ts/spec/bmsx/io';
import {
	CART_MMIO_BASE,
	CART_RAM_BASE,
} from '../../machine/ts/spec/bmsx/memory_map';
import { StudioBoardConnection } from '../../ide/workbench/contrib/studio/connection';
import { StudioDescriptorModel } from '../../ide/workbench/contrib/studio/model';
import * as studio from '../../ide/workbench/contrib/studio/protocol';

const WORD_BYTES = 4;

class StudioMemoryFixture {
	public selectedSlot = 0;
	public readonly boardWords = [new Uint32Array(0x40000), new Uint32Array(0x40000)];
	public readonly mmioWords = new Map<number, number>();
	public readonly revisionReads: number[] = [];

	public readMappedU32LE(address: number): number {
		if (address === CART_RAM_BASE + studio.STUDIO_HEADER_REVISION * WORD_BYTES
			&& this.revisionReads.length !== 0) {
			return this.revisionReads.shift()!;
		}
		return this.boardWords[this.selectedSlot][(address - CART_RAM_BASE) / WORD_BYTES];
	}

	public writeMappedU32LE(address: number, value: number): void {
		const word = value >>> 0;
		if (address === IO_CART_SELECT) {
			this.selectedSlot = word & 1;
			return;
		}
		if (address >= CART_RAM_BASE && address < CART_MMIO_BASE) {
			this.boardWords[this.selectedSlot][(address - CART_RAM_BASE) / WORD_BYTES] = word;
			return;
		}
		this.mmioWords.set(address, word);
	}

	public memory(): Memory {
		return this as unknown as Memory;
	}
}

function writeDescriptorHeader(
	fixture: StudioMemoryFixture,
	revision: number,
	flags: number,
	appliedCommandSequence: number,
): void {
	const words = fixture.boardWords[1];
	words[studio.STUDIO_HEADER_MAGIC] = studio.STUDIO_DESCRIPTOR_MAGIC;
	words[studio.STUDIO_HEADER_VERSION] = studio.STUDIO_DESCRIPTOR_VERSION;
	words[studio.STUDIO_HEADER_REVISION] = revision;
	words[studio.STUDIO_HEADER_FLAGS] = flags;
	words[studio.STUDIO_HEADER_OBJECT_COUNT] = 0;
	words[studio.STUDIO_HEADER_COMPONENT_COUNT] = 0;
	words[studio.STUDIO_HEADER_APPLIED_COMMAND_SEQUENCE] = appliedCommandSequence;
	words[studio.STUDIO_HEADER_OBJECT_TABLE_WORD_OFFSET] = studio.STUDIO_HEADER_WORD_COUNT;
	words[studio.STUDIO_HEADER_OBJECT_STRIDE_WORDS] = studio.STUDIO_OBJECT_STRIDE_WORDS;
	words[studio.STUDIO_HEADER_COMPONENT_TABLE_WORD_OFFSET] = studio.STUDIO_HEADER_WORD_COUNT;
	words[studio.STUDIO_HEADER_COMPONENT_STRIDE_WORDS] = studio.STUDIO_COMPONENT_STRIDE_WORDS;
	words[studio.STUDIO_HEADER_COMMAND_WORD_OFFSET] = studio.STUDIO_COMMAND_WORD_OFFSET;
	words[studio.STUDIO_HEADER_COMMAND_WORD_COUNT] = studio.STUDIO_COMMAND_WORD_COUNT;
	words[studio.STUDIO_HEADER_GAME_SLOT] = 0;
	words[studio.STUDIO_HEADER_BOARD_SLOT] = 1;
}

test('Studio descriptor publishes only matching even seqlock revisions', () => {
	const fixture = new StudioMemoryFixture();
	const gameplayRunningFlag = studio.STUDIO_FLAG_GAMEPLAY_RUNNING;
	writeDescriptorHeader(fixture, 2, gameplayRunningFlag, 0);
	const model = new StudioDescriptorModel(
		new StudioBoardConnection(fixture.memory(), { gameSlot: 0, boardSlot: 1 }),
	);
	assert.equal(model.synchronize(), true);
	assert.equal(model.snapshot.revision, 2);
	assert.equal(model.snapshot.flags, gameplayRunningFlag);
	assert.equal(fixture.selectedSlot, 0);

	writeDescriptorHeader(fixture, 6, studio.STUDIO_FLAG_TRANSLATING, 0);
	fixture.revisionReads.push(4, 6);
	assert.equal(model.synchronize(), false);
	assert.equal(model.snapshot.revision, 2);
	assert.equal(model.snapshot.flags, gameplayRunningFlag);
	assert.equal(fixture.selectedSlot, 0);

	fixture.revisionReads.push(7);
	assert.equal(model.synchronize(), false);
	assert.equal(model.snapshot.revision, 2);
	assert.equal(fixture.selectedSlot, 0);

	fixture.revisionReads.push(6, 6);
	assert.equal(model.synchronize(), true);
	assert.equal(model.snapshot.revision, 6);
	assert.equal(model.snapshot.flags, studio.STUDIO_FLAG_TRANSLATING);
	assert.equal(fixture.selectedSlot, 0);
});

test('Studio connection continues the guest sequence and rings the physical board mailbox', () => {
	const fixture = new StudioMemoryFixture();
	writeDescriptorHeader(fixture, 2, 0, 41);
	const connection = new StudioBoardConnection(
		fixture.memory(),
		{ gameSlot: 0, boardSlot: 1 },
	);
	const model = new StudioDescriptorModel(connection);
	assert.equal(model.synchronize(), true);
	assert.equal(connection.commandPending, false);

	const sequence = connection.submit(
		studio.STUDIO_COMMAND_SELECT,
		0x1234,
		0x5678,
		0,
		0,
		0,
		0,
		0,
		0,
	);
	assert.equal(sequence, 42);
	assert.equal(connection.commandPending, true);
	assert.equal(
		fixture.boardWords[1][studio.STUDIO_COMMAND_WORD_OFFSET + studio.STUDIO_COMMAND_SEQUENCE],
		42,
	);
	assert.equal(
		fixture.boardWords[1][studio.STUDIO_COMMAND_WORD_OFFSET + studio.STUDIO_COMMAND_OPCODE],
		studio.STUDIO_COMMAND_SELECT,
	);
	assert.equal(
		fixture.boardWords[1][studio.STUDIO_COMMAND_WORD_OFFSET + studio.STUDIO_COMMAND_OBJECT_HANDLE],
		0x1234,
	);
	assert.equal(
		fixture.boardWords[1][studio.STUDIO_COMMAND_WORD_OFFSET + studio.STUDIO_COMMAND_COMPONENT_HANDLE],
		0x5678,
	);
	assert.equal(
		fixture.mmioWords.get(CART_MMIO_BASE + CARTRIDGE_MAILBOX_DATA_OFFSET),
		42,
	);
	assert.equal(
		fixture.mmioWords.get(CART_MMIO_BASE + CARTRIDGE_MAILBOX_CONTROL_OFFSET),
		CARTRIDGE_MAILBOX_CONTROL_DREQ_READ
			| CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE
			| CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER,
	);
	assert.equal(fixture.selectedSlot, 0);
});
