import {
	CARTRIDGE_MAILBOX_CONTROL_DREQ_READ,
	CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE,
	CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER,
	CARTRIDGE_MAILBOX_CONTROL_OFFSET,
	CARTRIDGE_MAILBOX_DATA_OFFSET,
	CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET,
	CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING,
	CARTRIDGE_MAILBOX_STATUS_OFFSET,
} from '../../../spec/bmsx/cartridge';

import {
	CARTRIDGE_CARD_DREQ_READ,
	CARTRIDGE_CARD_DREQ_WRITE,
	CARTRIDGE_CARD_EFFECT_DREQ_CHANGED,
	CARTRIDGE_CARD_EFFECT_IRQ_EDGE,
} from './signals';
import type { CartridgeMailboxState } from './contracts';

export class CartridgeMailbox {
	private dataWord = 0;
	private controlWord = 0;
	private irqPending = false;

	public reset(): void {
		this.dataWord = 0;
		this.controlWord = 0;
		this.irqPending = false;
	}

	public captureState(): CartridgeMailboxState {
		return {
			dataWord: this.dataWord,
			controlWord: this.controlWord,
			irqPending: this.irqPending,
		};
	}

	public restoreState(state: CartridgeMailboxState): void {
		this.dataWord = state.dataWord >>> 0;
		this.controlWord = state.controlWord >>> 0;
		this.irqPending = state.irqPending;
	}

	public readWord(offset: number): number {
		switch (offset & ~3) {
			case CARTRIDGE_MAILBOX_DATA_OFFSET:
				return this.dataWord;
			case CARTRIDGE_MAILBOX_CONTROL_OFFSET:
				return this.controlWord;
			case CARTRIDGE_MAILBOX_STATUS_OFFSET:
				return this.irqPending ? CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING : 0;
			default:
				return 0;
		}
	}

	public writeWord(offset: number, value: number): number {
		switch (offset) {
			case CARTRIDGE_MAILBOX_DATA_OFFSET:
				this.dataWord = value;
				return 0;
			case CARTRIDGE_MAILBOX_CONTROL_OFFSET: {
				const previousDreq = this.dreqLines();
				this.controlWord = (value & ~CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER) >>> 0;
				let effects = previousDreq === this.dreqLines()
					? 0
					: CARTRIDGE_CARD_EFFECT_DREQ_CHANGED;
				if ((value & CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER) !== 0 && !this.irqPending) {
					this.irqPending = true;
					effects |= CARTRIDGE_CARD_EFFECT_IRQ_EDGE;
				}
				return effects;
			}
			case CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET:
				if (value !== 0) this.irqPending = false;
				return 0;
			default:
				return 0;
		}
	}

	public dreqLines(): number {
		let lines = 0;
		if ((this.controlWord & CARTRIDGE_MAILBOX_CONTROL_DREQ_READ) !== 0) {
			lines |= CARTRIDGE_CARD_DREQ_READ;
		}
		if ((this.controlWord & CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE) !== 0) {
			lines |= CARTRIDGE_CARD_DREQ_WRITE;
		}
		return lines;
	}
}
