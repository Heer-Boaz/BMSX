import {
	DMA_REQUEST_CARTRIDGE_SLOT0_READ,
	DMA_REQUEST_CARTRIDGE_SLOT0_WRITE,
	DMA_REQUEST_CARTRIDGE_SLOT1_READ,
	DMA_REQUEST_CARTRIDGE_SLOT1_WRITE,
	IO_CART_SELECT,
	IO_CART_STATUS,
	IRQ_CARTRIDGE_SLOT0,
	IRQ_CARTRIDGE_SLOT1,
} from '../../../spec/bmsx/io';
import {
	CART_RAM_BASE,
} from '../../../spec/bmsx/memory_map';
import {
	MAPPED_BUS_CARTRIDGE_SLOT1,
	MAPPED_BUS_CARTRIDGE_SLOT_OVERRIDE,
	MAPPED_BUS_MASTER_CPU,
	type MappedBusSignals,
} from '../../memory/bus_signals';
import type {
	MappedPageBinding,
	MappedPageInvalidator,
	Memory,
} from '../../memory/memory';
import type { DmaController } from '../dma/controller';
import type { IrqController } from '../irq/controller';
import {
	CARTRIDGE_STATUS_SELECTED_SLOT1,
	CARTRIDGE_STATUS_SLOT0_PRESENT,
	CARTRIDGE_STATUS_SLOT1_PRESENT,
	type CartridgeSlotIndex,
} from '../../../spec/bmsx/cartridge';
import {
	type CartridgeByteView,
	type CartridgeControllerState,
	type CartridgeSocketMediaPair,
} from './contracts';
import { CartridgeCard } from './card';
import {
	CARTRIDGE_CARD_DREQ_READ,
	CARTRIDGE_CARD_DREQ_WRITE,
	CARTRIDGE_CARD_EFFECT_DREQ_CHANGED,
	CARTRIDGE_CARD_EFFECT_IRQ_EDGE,
} from './signals';

const CARTRIDGE_SLOT0_MAPPED_KEY_OFFSET = 0x100000000;
const CARTRIDGE_SLOT1_MAPPED_KEY_OFFSET = 0x200000000;
const CARTRIDGE_SLOT0_DREQ_MASK =
	(1 << DMA_REQUEST_CARTRIDGE_SLOT0_WRITE)
	| (1 << DMA_REQUEST_CARTRIDGE_SLOT0_READ);
const CARTRIDGE_SLOT1_DREQ_MASK =
	(1 << DMA_REQUEST_CARTRIDGE_SLOT1_WRITE)
	| (1 << DMA_REQUEST_CARTRIDGE_SLOT1_READ);

export class CartridgeController {
	private readonly cards: [CartridgeCard | null, CartridgeCard | null];
	private selectionWord = 0;
	private irq!: IrqController;
	private dma!: DmaController;

	public constructor(media: CartridgeSocketMediaPair) {
		this.cards = [
			media[0] === null
				? null
				: new CartridgeCard(media[0], CARTRIDGE_SLOT0_MAPPED_KEY_OFFSET),
			media[1] === null
				? null
				: new CartridgeCard(media[1], CARTRIDGE_SLOT1_MAPPED_KEY_OFFSET),
		];
	}

	public connect(memory: Memory, irq: IrqController, dma: DmaController): void {
		this.irq = irq;
		this.dma = dma;
		memory.mapIoRead(IO_CART_SELECT, this, CartridgeController.readSelectionThunk);
		memory.mapIoWrite(IO_CART_SELECT, this, CartridgeController.writeSelectionThunk);
		memory.mapIoRead(IO_CART_STATUS, this, CartridgeController.readStatusThunk);
	}

	public selectedSlot(busSignals: MappedBusSignals = MAPPED_BUS_MASTER_CPU): CartridgeSlotIndex {
		if ((busSignals & MAPPED_BUS_CARTRIDGE_SLOT_OVERRIDE) === 0) {
			return (this.selectionWord & 1) === 0 ? 0 : 1;
		}
		return (busSignals & MAPPED_BUS_CARTRIDGE_SLOT1) === 0 ? 0 : 1;
	}

	public installRom(slotIndex: number, rom: Uint8Array): void {
		this.cards[slotIndex]!.installRom(rom);
	}

	public attachMappedPageInvalidator(invalidator: MappedPageInvalidator): void {
		if (this.cards[0] !== null) this.cards[0].attachMappedPageInvalidator(invalidator);
		if (this.cards[1] !== null) this.cards[1].attachMappedPageInvalidator(invalidator);
	}

	public clearMappedPageWriteWatches(): void {
		if (this.cards[0] !== null) this.cards[0].clearMappedPageWriteWatches();
		if (this.cards[1] !== null) this.cards[1].clearMappedPageWriteWatches();
	}

	public bindMappedPage(address: number, busSignals: MappedBusSignals, out: MappedPageBinding): void {
		const slotIndex = this.selectedSlot(busSignals);
		const card = this.cards[slotIndex];
		if (card !== null) {
			card.bindMappedPage(address, out);
			return;
		}
		out.key = address + (slotIndex === 0
			? CARTRIDGE_SLOT0_MAPPED_KEY_OFFSET
			: CARTRIDGE_SLOT1_MAPPED_KEY_OFFSET);
		out.cacheable = address < CART_RAM_BASE;
		out.readBytes = null;
		out.readByteOffset = 0;
		out.writeWatches = null;
		out.writeWatchIndex = 0;
	}

	public ramByteCount(): number {
		return (this.cards[0] === null ? 0 : this.cards[0].ramByteCount())
			+ (this.cards[1] === null ? 0 : this.cards[1].ramByteCount());
	}

	public reset(): void {
		this.selectionWord = 0;
		if (this.cards[0] !== null) this.cards[0].reset();
		if (this.cards[1] !== null) this.cards[1].reset();
		this.publishDreqLines(0);
		this.publishDreqLines(1);
	}

	public captureState(): CartridgeControllerState {
		return {
			selectionWord: this.selectionWord,
			slots: [
				this.cards[0] === null ? null : this.cards[0].captureState(),
				this.cards[1] === null ? null : this.cards[1].captureState(),
			],
		};
	}

	public restoreState(state: CartridgeControllerState): void {
		if ((this.cards[0] === null) !== (state.slots[0] === null)
				|| (this.cards[1] === null) !== (state.slots[1] === null)) {
			throw new Error('Cartridge state does not match the occupied physical sockets.');
		}
		this.selectionWord = state.selectionWord >>> 0;
		if (this.cards[0] !== null) this.cards[0].restoreState(state.slots[0]!);
		if (this.cards[1] !== null) this.cards[1].restoreState(state.slots[1]!);
		this.publishDreqLines(0);
		this.publishDreqLines(1);
	}

	public readU8(address: number, busSignals: MappedBusSignals): number {
		const card = this.cards[this.selectedSlot(busSignals)];
		return card === null ? 0 : card.readU8(address);
	}

	public readU16(address: number, busSignals: MappedBusSignals): number {
		const card = this.cards[this.selectedSlot(busSignals)];
		return card === null ? 0 : card.readU16(address);
	}

	public readU32(address: number, busSignals: MappedBusSignals): number {
		const card = this.cards[this.selectedSlot(busSignals)];
		return card === null ? 0 : card.readU32(address);
	}

	public writeU8(address: number, value: number, busSignals: MappedBusSignals): void {
		const card = this.cards[this.selectedSlot(busSignals)];
		if (card !== null) card.writeU8(address, value);
	}

	public writeU16(address: number, value: number, busSignals: MappedBusSignals): void {
		const card = this.cards[this.selectedSlot(busSignals)];
		if (card !== null) card.writeU16(address, value);
	}

	public writeU32(address: number, value: number, busSignals: MappedBusSignals): void {
		const slotIndex = this.selectedSlot(busSignals);
		const card = this.cards[slotIndex];
		if (card === null) return;
		const effects = card.writeU32(address, value);
		if ((effects & CARTRIDGE_CARD_EFFECT_IRQ_EDGE) !== 0) {
			this.irq.raise(slotIndex === 0 ? IRQ_CARTRIDGE_SLOT0 : IRQ_CARTRIDGE_SLOT1);
		}
		if ((effects & CARTRIDGE_CARD_EFFECT_DREQ_CHANGED) !== 0) {
			this.publishDreqLines(slotIndex);
		}
	}

	public readBytes(address: number, out: Uint8Array, dstOffset: number, length: number): void {
		const card = this.cards[this.selectedSlot()];
		if (card === null) {
			out.fill(0, dstOffset, dstOffset + length);
			return;
		}
		card.readBytes(address, out, dstOffset, length);
	}

	public bindRomByteView(slotIndex: number, address: number, length: number, out: CartridgeByteView): boolean {
		const card = this.cards[slotIndex];
		return card === null ? false : card.bindRomByteView(address, length, out);
	}

	private publishDreqLines(slotIndex: CartridgeSlotIndex): void {
		let asserted = 0;
		const card = this.cards[slotIndex];
		const lines = card === null ? 0 : card.dreqLines();
		if (slotIndex === 0) {
			if ((lines & CARTRIDGE_CARD_DREQ_WRITE) !== 0) {
				asserted |= 1 << DMA_REQUEST_CARTRIDGE_SLOT0_WRITE;
			}
			if ((lines & CARTRIDGE_CARD_DREQ_READ) !== 0) {
				asserted |= 1 << DMA_REQUEST_CARTRIDGE_SLOT0_READ;
			}
			this.dma.setRequestLines(CARTRIDGE_SLOT0_DREQ_MASK, asserted);
			return;
		}
		if ((lines & CARTRIDGE_CARD_DREQ_WRITE) !== 0) {
			asserted |= 1 << DMA_REQUEST_CARTRIDGE_SLOT1_WRITE;
		}
		if ((lines & CARTRIDGE_CARD_DREQ_READ) !== 0) {
			asserted |= 1 << DMA_REQUEST_CARTRIDGE_SLOT1_READ;
		}
		this.dma.setRequestLines(CARTRIDGE_SLOT1_DREQ_MASK, asserted);
	}

	private static readSelectionThunk(context: CartridgeController): number {
		return context.selectionWord;
	}

	private static writeSelectionThunk(context: CartridgeController, _address: number, value: number): void {
		context.selectionWord = value;
	}

	private static readStatusThunk(context: CartridgeController): number {
		let status = context.selectedSlot() === 1 ? CARTRIDGE_STATUS_SELECTED_SLOT1 : 0;
		if (context.cards[0] !== null) status |= CARTRIDGE_STATUS_SLOT0_PRESENT;
		if (context.cards[1] !== null) status |= CARTRIDGE_STATUS_SLOT1_PRESENT;
		return status;
	}
}
