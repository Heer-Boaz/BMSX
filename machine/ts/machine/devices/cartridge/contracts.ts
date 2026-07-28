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
