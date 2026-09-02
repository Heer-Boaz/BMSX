export type CartridgeCardMedia = {
	rom: Uint8Array | null;
	ramByteCount: number | null;
	mailboxPresent: boolean;
};

export type CartridgeSocketMediaPair = [
	CartridgeCardMedia | null,
	CartridgeCardMedia | null,
];

export type CartridgeMailboxState = {
	dataWord: number;
	controlWord: number;
	irqPending: boolean;
};

export type CartridgeCardState = {
	ram: Uint8Array | null;
	mailbox: CartridgeMailboxState | null;
};

export type CartridgeControllerState = {
	selectionWord: number;
	slots: [CartridgeCardState | null, CartridgeCardState | null];
};

export type CartridgeByteView = {
	bytes: Uint8Array;
	byteOffset: number;
	byteLength: number;
};
