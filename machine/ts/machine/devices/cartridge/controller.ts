import { readLE16, readLE32, writeLE16, writeLE32 } from '../../../common/endian';
import {
	DMA_REQUEST_CARTRIDGE_SLOT0_READ,
	DMA_REQUEST_CARTRIDGE_SLOT0_WRITE,
	DMA_REQUEST_CARTRIDGE_SLOT1_READ,
	DMA_REQUEST_CARTRIDGE_SLOT1_WRITE,
	IO_CART_SELECT,
	IO_CART_SLOT0_BOARD,
	IO_CART_SLOT0_RAM_BYTES,
	IO_CART_SLOT1_BOARD,
	IO_CART_SLOT1_RAM_BYTES,
	IO_CART_STATUS,
	IRQ_CARTRIDGE_SLOT0,
	IRQ_CARTRIDGE_SLOT1,
} from '../../bus/io';
import type { Value } from '../../cpu/cpu';
import {
	MAPPED_BUS_CARTRIDGE_SLOT1,
	MAPPED_BUS_CARTRIDGE_SLOT_OVERRIDE,
	MAPPED_BUS_MASTER_CPU,
	type MappedBusSignals,
} from '../../memory/bus_signals';
import {
	CART_MMIO_BASE,
	CART_RAM_BASE,
	CART_ROM_BASE,
} from '../../memory/map';
import type { Memory } from '../../memory/memory';
import type { DmaController } from '../dma/controller';
import type { IrqController } from '../irq/controller';
import {
	CARTRIDGE_BOARD_MAILBOX,
	CARTRIDGE_BOARD_RAM,
	CARTRIDGE_MAILBOX_CONTROL_DREQ_READ,
	CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE,
	CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER,
	CARTRIDGE_MAILBOX_CONTROL_OFFSET,
	CARTRIDGE_MAILBOX_DATA_OFFSET,
	CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET,
	CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING,
	CARTRIDGE_MAILBOX_STATUS_OFFSET,
	CARTRIDGE_STATUS_SELECTED_SLOT1,
	CARTRIDGE_STATUS_SLOT0_PRESENT,
	CARTRIDGE_STATUS_SLOT1_PRESENT,
	type CartridgeByteView,
	type CartridgeControllerState,
	type CartridgeSlotMedia,
	type CartridgeSlotMediaPair,
	type CartridgeSlotState,
} from './contracts';

type CartridgeSlot = {
	media: CartridgeSlotMedia;
	ram: Uint8Array;
	mailboxDataWord: number;
	mailboxControlWord: number;
	mailboxIrqPending: boolean;
};

const CARTRIDGE_DREQ_MASK =
	(1 << DMA_REQUEST_CARTRIDGE_SLOT0_WRITE)
	| (1 << DMA_REQUEST_CARTRIDGE_SLOT0_READ)
	| (1 << DMA_REQUEST_CARTRIDGE_SLOT1_WRITE)
	| (1 << DMA_REQUEST_CARTRIDGE_SLOT1_READ);

export class CartridgeController {
	private readonly slots: [CartridgeSlot, CartridgeSlot];
	private readonly romMediaRevisions = new Uint32Array([1, 1]);
	private selectionWord = 0;
	private irq!: IrqController;
	private dma!: DmaController;

	public constructor(media: CartridgeSlotMediaPair) {
		this.slots = [
			{
				media: media[0],
				ram: new Uint8Array(media[0].ramByteCount),
				mailboxDataWord: 0,
				mailboxControlWord: 0,
				mailboxIrqPending: false,
			},
			{
				media: media[1],
				ram: new Uint8Array(media[1].ramByteCount),
				mailboxDataWord: 0,
				mailboxControlWord: 0,
				mailboxIrqPending: false,
			},
		];
	}

	public connect(memory: Memory, irq: IrqController, dma: DmaController): void {
		this.irq = irq;
		this.dma = dma;
		memory.mapIoRead(IO_CART_SELECT, this, CartridgeController.readSelectionThunk);
		memory.mapIoWrite(IO_CART_SELECT, this, CartridgeController.writeSelectionThunk);
		memory.mapIoRead(IO_CART_STATUS, this, CartridgeController.readStatusThunk);
		memory.mapIoRead(IO_CART_SLOT0_BOARD, this, CartridgeController.readSlot0BoardThunk);
		memory.mapIoRead(IO_CART_SLOT0_RAM_BYTES, this, CartridgeController.readSlot0RamBytesThunk);
		memory.mapIoRead(IO_CART_SLOT1_BOARD, this, CartridgeController.readSlot1BoardThunk);
		memory.mapIoRead(IO_CART_SLOT1_RAM_BYTES, this, CartridgeController.readSlot1RamBytesThunk);
	}

	public selectedSlot(): number {
		return this.selectionWord & 1;
	}

	public installRom(slotIndex: number, rom: Uint8Array): void {
		this.slots[slotIndex]!.media.rom = rom;
		this.romMediaRevisions[slotIndex] += 1;
	}

	public romRevision(slotIndex: number): number {
		return this.romMediaRevisions[slotIndex];
	}

	public ramByteCount(): number {
		return this.slots[0].ram.byteLength + this.slots[1].ram.byteLength;
	}

	public reset(): void {
		this.selectionWord = 0;
		for (let slotIndex = 0; slotIndex < this.slots.length; slotIndex += 1) {
			const slot = this.slots[slotIndex]!;
			slot.mailboxDataWord = 0;
			slot.mailboxControlWord = 0;
			slot.mailboxIrqPending = false;
		}
		this.publishDreqLines();
	}

	public captureState(): CartridgeControllerState {
		return {
			selectionWord: this.selectionWord,
			slots: [
				this.captureSlot(this.slots[0]),
				this.captureSlot(this.slots[1]),
			],
		};
	}

	public restoreState(state: CartridgeControllerState): void {
		this.selectionWord = state.selectionWord >>> 0;
		this.restoreSlot(this.slots[0], state.slots[0]);
		this.restoreSlot(this.slots[1], state.slots[1]);
		this.publishDreqLines();
	}

	public readU8(address: number, busSignals: MappedBusSignals): number {
		const slot = this.slots[this.slotIndexForSignals(busSignals)]!;
		if (address < CART_RAM_BASE) {
			const offset = address - CART_ROM_BASE;
			return offset < slot.media.rom.byteLength ? slot.media.rom[offset]! : 0;
		}
		if (address < CART_MMIO_BASE) {
			if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) === 0) return 0;
			const offset = address - CART_RAM_BASE;
			return offset < slot.ram.byteLength ? slot.ram[offset]! : 0;
		}
		const word = this.readMailboxWord(slot, address - CART_MMIO_BASE);
		return (word >>> ((address & 3) << 3)) & 0xff;
	}

	public readU16(address: number, busSignals: MappedBusSignals): number {
		const slot = this.slots[this.slotIndexForSignals(busSignals)]!;
		if (address < CART_RAM_BASE) {
			return this.readU16From(slot.media.rom, address - CART_ROM_BASE);
		}
		if (address < CART_MMIO_BASE) {
			if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) === 0) return 0;
			return this.readU16From(slot.ram, address - CART_RAM_BASE);
		}
		const word = this.readMailboxWord(slot, address - CART_MMIO_BASE);
		return (word >>> ((address & 2) << 3)) & 0xffff;
	}

	public readU32(address: number, busSignals: MappedBusSignals): number {
		const slot = this.slots[this.slotIndexForSignals(busSignals)]!;
		if (address < CART_RAM_BASE) {
			return this.readU32From(slot.media.rom, address - CART_ROM_BASE);
		}
		if (address < CART_MMIO_BASE) {
			if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) === 0) return 0;
			return this.readU32From(slot.ram, address - CART_RAM_BASE);
		}
		return this.readMailboxWord(slot, address - CART_MMIO_BASE);
	}

	public writeU8(address: number, value: number, busSignals: MappedBusSignals): void {
		const slot = this.slots[this.slotIndexForSignals(busSignals)]!;
		if (address >= CART_RAM_BASE && address < CART_MMIO_BASE) {
			if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) === 0) return;
			const offset = address - CART_RAM_BASE;
			if (offset < slot.ram.byteLength) {
				slot.ram[offset] = value & 0xff;
			}
		}
	}

	public writeU16(address: number, value: number, busSignals: MappedBusSignals): void {
		if (address < CART_RAM_BASE || address >= CART_MMIO_BASE) return;
		const slot = this.slots[this.slotIndexForSignals(busSignals)]!;
		if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) === 0) return;
		const ram = slot.ram;
		const offset = address - CART_RAM_BASE;
		if (offset + 2 <= ram.byteLength) {
			writeLE16(ram, offset, value);
		}
	}

	public writeU32(address: number, value: number, busSignals: MappedBusSignals): void {
		const slotIndex = this.slotIndexForSignals(busSignals);
		const slot = this.slots[slotIndex]!;
		if (address >= CART_RAM_BASE && address < CART_MMIO_BASE) {
			if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) === 0) return;
			const offset = address - CART_RAM_BASE;
			if (offset + 4 <= slot.ram.byteLength) {
				writeLE32(slot.ram, offset, value);
			}
			return;
		}
		if (address >= CART_MMIO_BASE) {
			this.writeMailboxWord(slotIndex, slot, address - CART_MMIO_BASE, value >>> 0);
		}
	}

	public readBytes(address: number, out: Uint8Array, dstOffset: number, length: number): void {
		const slot = this.slots[this.selectedSlot()]!;
		if (address < CART_RAM_BASE && address + length <= CART_RAM_BASE) {
			this.readByteRun(slot.media.rom, address - CART_ROM_BASE, out, dstOffset, length);
			return;
		}
		if (address >= CART_RAM_BASE && address + length <= CART_MMIO_BASE) {
			if ((slot.media.boardWord & CARTRIDGE_BOARD_RAM) === 0) {
				out.fill(0, dstOffset, dstOffset + length);
				return;
			}
			this.readByteRun(slot.ram, address - CART_RAM_BASE, out, dstOffset, length);
			return;
		}
		for (let index = 0; index < length; index += 1) {
			out[dstOffset + index] = this.readU8(address + index, MAPPED_BUS_MASTER_CPU);
		}
	}

	public bindRomByteView(slotIndex: number, address: number, length: number, out: CartridgeByteView): boolean {
		const rom = this.slots[slotIndex]!.media.rom;
		const offset = address - CART_ROM_BASE;
		if (length === 0 || offset >= rom.byteLength || length > rom.byteLength - offset) {
			return false;
		}
		out.bytes = rom;
		out.byteOffset = offset;
		out.byteLength = length;
		return true;
	}

	private captureSlot(slot: CartridgeSlot): CartridgeSlotState {
		return {
			ram: slot.ram.slice(),
			mailboxDataWord: slot.mailboxDataWord,
			mailboxControlWord: slot.mailboxControlWord,
			mailboxIrqPending: slot.mailboxIrqPending,
		};
	}

	private restoreSlot(slot: CartridgeSlot, state: CartridgeSlotState): void {
		if (state.ram.byteLength !== slot.ram.byteLength) {
			throw new Error('Cartridge RAM size does not match the inserted board.');
		}
		slot.ram.set(state.ram);
		slot.mailboxDataWord = state.mailboxDataWord >>> 0;
		slot.mailboxControlWord = state.mailboxControlWord >>> 0;
		slot.mailboxIrqPending = state.mailboxIrqPending;
	}

	private slotIndexForSignals(busSignals: MappedBusSignals): number {
		if ((busSignals & MAPPED_BUS_CARTRIDGE_SLOT_OVERRIDE) === 0) {
			return this.selectionWord & 1;
		}
		return (busSignals & MAPPED_BUS_CARTRIDGE_SLOT1) !== 0 ? 1 : 0;
	}

	private readU16From(bytes: Uint8Array, offset: number): number {
		if (offset + 2 <= bytes.byteLength) return readLE16(bytes, offset);
		return offset < bytes.byteLength ? bytes[offset]! : 0;
	}

	private readByteRun(bytes: Uint8Array, offset: number, out: Uint8Array, dstOffset: number, length: number): void {
		const available = offset < bytes.byteLength ? Math.min(length, bytes.byteLength - offset) : 0;
		out.set(bytes.subarray(offset, offset + available), dstOffset);
		if (available !== length) {
			out.fill(0, dstOffset + available, dstOffset + length);
		}
	}

	private readU32From(bytes: Uint8Array, offset: number): number {
		if (offset + 4 <= bytes.byteLength) return readLE32(bytes, offset);
		if (offset >= bytes.byteLength) return 0;
		let word = bytes[offset]!;
		if (offset + 1 < bytes.byteLength) word |= bytes[offset + 1]! << 8;
		if (offset + 2 < bytes.byteLength) word |= bytes[offset + 2]! << 16;
		return word >>> 0;
	}

	private readMailboxWord(slot: CartridgeSlot, offset: number): number {
		if ((slot.media.boardWord & CARTRIDGE_BOARD_MAILBOX) === 0) return 0;
		switch (offset & ~3) {
			case CARTRIDGE_MAILBOX_DATA_OFFSET:
				return slot.mailboxDataWord;
			case CARTRIDGE_MAILBOX_CONTROL_OFFSET:
				return slot.mailboxControlWord;
			case CARTRIDGE_MAILBOX_STATUS_OFFSET:
				return slot.mailboxIrqPending ? CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING : 0;
			default:
				return 0;
		}
	}

	private writeMailboxWord(slotIndex: number, slot: CartridgeSlot, offset: number, value: number): void {
		if ((slot.media.boardWord & CARTRIDGE_BOARD_MAILBOX) === 0) return;
		switch (offset) {
			case CARTRIDGE_MAILBOX_DATA_OFFSET:
				slot.mailboxDataWord = value;
				return;
			case CARTRIDGE_MAILBOX_CONTROL_OFFSET:
				slot.mailboxControlWord = (value & ~CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER) >>> 0;
				if ((value & CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER) !== 0 && !slot.mailboxIrqPending) {
					slot.mailboxIrqPending = true;
					this.irq.raise(slotIndex === 0 ? IRQ_CARTRIDGE_SLOT0 : IRQ_CARTRIDGE_SLOT1);
				}
				this.publishDreqLines();
				return;
			case CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET:
				if (value !== 0) slot.mailboxIrqPending = false;
				return;
		}
	}

	private publishDreqLines(): void {
		let asserted = 0;
		const slot0 = this.slots[0];
		const slot1 = this.slots[1];
		if ((slot0.mailboxControlWord & CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE) !== 0) {
			asserted |= 1 << DMA_REQUEST_CARTRIDGE_SLOT0_WRITE;
		}
		if ((slot0.mailboxControlWord & CARTRIDGE_MAILBOX_CONTROL_DREQ_READ) !== 0) {
			asserted |= 1 << DMA_REQUEST_CARTRIDGE_SLOT0_READ;
		}
		if ((slot1.mailboxControlWord & CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE) !== 0) {
			asserted |= 1 << DMA_REQUEST_CARTRIDGE_SLOT1_WRITE;
		}
		if ((slot1.mailboxControlWord & CARTRIDGE_MAILBOX_CONTROL_DREQ_READ) !== 0) {
			asserted |= 1 << DMA_REQUEST_CARTRIDGE_SLOT1_READ;
		}
		this.dma.setRequestLines(CARTRIDGE_DREQ_MASK, asserted);
	}

	private static readSelectionThunk(context: CartridgeController): Value {
		return context.selectionWord;
	}

	private static writeSelectionThunk(context: CartridgeController, _address: number, value: Value): void {
		context.selectionWord = (value as number) >>> 0;
	}

	private static readStatusThunk(context: CartridgeController): Value {
		let status = context.selectedSlot() === 1 ? CARTRIDGE_STATUS_SELECTED_SLOT1 : 0;
		if (context.slots[0].media.present) status |= CARTRIDGE_STATUS_SLOT0_PRESENT;
		if (context.slots[1].media.present) status |= CARTRIDGE_STATUS_SLOT1_PRESENT;
		return status;
	}

	private static readSlot0BoardThunk(context: CartridgeController): Value {
		return context.slots[0].media.boardWord;
	}

	private static readSlot0RamBytesThunk(context: CartridgeController): Value {
		return context.slots[0].ram.byteLength;
	}

	private static readSlot1BoardThunk(context: CartridgeController): Value {
		return context.slots[1].media.boardWord;
	}

	private static readSlot1RamBytesThunk(context: CartridgeController): Value {
		return context.slots[1].ram.byteLength;
	}
}
