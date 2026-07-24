export const CARTRIDGE_SLOT_COUNT = 2;
export const CARTRIDGE_BOARD_RAM = 1 << 0;
export const CARTRIDGE_BOARD_MAILBOX = 1 << 1;

export const CARTRIDGE_STATUS_SLOT0_PRESENT = 1 << 0;
export const CARTRIDGE_STATUS_SLOT1_PRESENT = 1 << 1;
export const CARTRIDGE_STATUS_SELECTED_SLOT1 = 1 << 16;

export const CARTRIDGE_MAILBOX_DATA_OFFSET = 0x00;
export const CARTRIDGE_MAILBOX_CONTROL_OFFSET = 0x04;
export const CARTRIDGE_MAILBOX_STATUS_OFFSET = 0x08;
export const CARTRIDGE_MAILBOX_IRQ_ACK_OFFSET = 0x0c;
export const CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER = 1 << 0;
export const CARTRIDGE_MAILBOX_CONTROL_DREQ_READ = 1 << 1;
export const CARTRIDGE_MAILBOX_CONTROL_DREQ_WRITE = 1 << 2;
export const CARTRIDGE_MAILBOX_STATUS_IRQ_PENDING = 1 << 0;

export type CartridgeSlotMedia = {
	rom: Uint8Array;
	boardWord: number;
	ramByteCount: number;
	present: boolean;
};

export type CartridgeSlotMediaPair = [
	CartridgeSlotMedia,
	CartridgeSlotMedia,
];

export type CartridgeSlotState = {
	ram: Uint8Array;
	mailboxDataWord: number;
	mailboxControlWord: number;
	mailboxIrqPending: boolean;
};

export type CartridgeControllerState = {
	selectionWord: number;
	slots: [CartridgeSlotState, CartridgeSlotState];
};

export type CartridgeByteView = {
	bytes: Uint8Array;
	byteOffset: number;
	byteLength: number;
};
