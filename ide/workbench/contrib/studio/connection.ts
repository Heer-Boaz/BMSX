import type { Memory } from '../../../../machine/ts/machine/memory/memory';
import {
	CARTRIDGE_MAILBOX_CONTROL_DREQ_READ,
	CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE,
	CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER,
	CARTRIDGE_MAILBOX_CONTROL_OFFSET,
	CARTRIDGE_MAILBOX_DATA_OFFSET,
} from '../../../../machine/ts/spec/bmsx/cartridge';
import { IO_CART_SELECT } from '../../../../machine/ts/spec/bmsx/io';
import {
	CART_MMIO_BASE,
	CART_RAM_BASE,
} from '../../../../machine/ts/spec/bmsx/memory_map';
import type { StudioSocketPair } from './media_admission';
import {
	STUDIO_COMMAND_ARG0,
	STUDIO_COMMAND_ARG1,
	STUDIO_COMMAND_ARG2,
	STUDIO_COMMAND_ARG3,
	STUDIO_COMMAND_COMPONENT_HANDLE,
	STUDIO_COMMAND_OBJECT_HANDLE,
	STUDIO_COMMAND_OPCODE,
	STUDIO_COMMAND_SEQUENCE,
	STUDIO_COMMAND_TOKEN_HI,
	STUDIO_COMMAND_TOKEN_LO,
	STUDIO_COMMAND_WORD_COUNT,
	STUDIO_COMMAND_WORD_OFFSET,
} from './protocol';

const WORD_BYTES = 4;
const STUDIO_MAILBOX_CONTROL =
	CARTRIDGE_MAILBOX_CONTROL_DREQ_READ
	| CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE
	| CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER;

export class StudioBoardConnection {
	private readonly commandWords = new Uint32Array(STUDIO_COMMAND_WORD_COUNT);
	private nextCommandSequence = 1;
	private submittedCommandSequence = 0;
	private appliedCommandSequence = 0;
	private commandSequenceInitialized = false;

	public constructor(
		private readonly memory: Memory,
		public readonly sockets: StudioSocketPair,
	) {
	}

	// disable-next-line single_line_method_pattern -- the connection owns the physical board socket and keeps CART_SELECT out of chrome/model callers.
	public selectBoard(): void {
		this.memory.writeMappedU32LE(IO_CART_SELECT, this.sockets.boardSlot);
	}

	// disable-next-line single_line_method_pattern -- the connection restores the known execution socket after every board aperture access.
	public selectGame(): void {
		this.memory.writeMappedU32LE(IO_CART_SELECT, this.sockets.gameSlot);
	}

	public readBoardWord(wordOffset: number): number {
		return this.memory.readMappedU32LE(CART_RAM_BASE + wordOffset * WORD_BYTES);
	}

	public setAppliedCommandSequence(sequence: number): void {
		const applied = sequence >>> 0;
		const commandWasPending = this.commandPending;
		this.appliedCommandSequence = applied;
		if (!this.commandSequenceInitialized || !commandWasPending) {
			this.commandSequenceInitialized = true;
			this.submittedCommandSequence = applied;
			this.nextCommandSequence = (applied + 1) >>> 0;
		}
	}

	public get commandPending(): boolean {
		return this.submittedCommandSequence !== this.appliedCommandSequence;
	}

	public submit(
		opcode: number,
		objectHandle: number,
		componentHandle: number,
		arg0: number,
		arg1: number,
		arg2: number,
		arg3: number,
		tokenLo: number,
		tokenHi: number,
	): number {
		const sequence = this.nextCommandSequence >>> 0;
		this.commandSequenceInitialized = true;
		this.nextCommandSequence = (sequence + 1) >>> 0;
		const words = this.commandWords;
		words.fill(0);
		words[STUDIO_COMMAND_OPCODE] = opcode >>> 0;
		words[STUDIO_COMMAND_OBJECT_HANDLE] = objectHandle >>> 0;
		words[STUDIO_COMMAND_COMPONENT_HANDLE] = componentHandle >>> 0;
		words[STUDIO_COMMAND_ARG0] = arg0 >>> 0;
		words[STUDIO_COMMAND_ARG1] = arg1 >>> 0;
		words[STUDIO_COMMAND_ARG2] = arg2 >>> 0;
		words[STUDIO_COMMAND_ARG3] = arg3 >>> 0;
		words[STUDIO_COMMAND_TOKEN_LO] = tokenLo >>> 0;
		words[STUDIO_COMMAND_TOKEN_HI] = tokenHi >>> 0;
		words[STUDIO_COMMAND_SEQUENCE] = sequence;

		this.selectBoard();
		const commandAddress = CART_RAM_BASE + STUDIO_COMMAND_WORD_OFFSET * WORD_BYTES;
		for (let index = 1; index < STUDIO_COMMAND_WORD_COUNT; index += 1) {
			this.memory.writeMappedU32LE(commandAddress + index * WORD_BYTES, words[index]);
		}
		this.memory.writeMappedU32LE(
			commandAddress + STUDIO_COMMAND_SEQUENCE * WORD_BYTES,
			sequence,
		);
		this.memory.writeMappedU32LE(
			CART_MMIO_BASE + CARTRIDGE_MAILBOX_DATA_OFFSET,
			sequence,
		);
		this.memory.writeMappedU32LE(
			CART_MMIO_BASE + CARTRIDGE_MAILBOX_CONTROL_OFFSET,
			STUDIO_MAILBOX_CONTROL,
		);
		this.selectGame();
		this.submittedCommandSequence = sequence;
		return sequence;
	}
}
