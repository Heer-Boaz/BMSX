import {
	CARTRIDGE_BOARD_MAILBOX,
	CARTRIDGE_BOARD_RAM,
} from '../../../machine/ts/spec/bmsx/cartridge';
import { CART_RAM_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';
import { requireObject } from '../../../machine/ts/common/serializer/binencoder';

export type CartManifest = {
	title?: string;
	cartridge?: {
		board: 'rom' | 'ram' | 'mailbox' | 'ram_mailbox';
		ram_bytes?: number;
	};
};

export type RomManifest = CartManifest;

export function parseCartManifest(value: unknown, label: string): CartManifest {
	return requireObject(value, label) as CartManifest;
}

export function resolveCartridgeHeaderWords(manifest: CartManifest | null): {
	cartridgeBoardWord: number;
	cartridgeRamByteCount: number;
} {
	const board = manifest?.cartridge?.board;
	let cartridgeBoardWord: number;
	switch (board) {
		case undefined:
		case 'rom':
			cartridgeBoardWord = 0;
			break;
		case 'ram':
			cartridgeBoardWord = CARTRIDGE_BOARD_RAM;
			break;
		case 'mailbox':
			cartridgeBoardWord = CARTRIDGE_BOARD_MAILBOX;
			break;
		case 'ram_mailbox':
			cartridgeBoardWord = CARTRIDGE_BOARD_RAM | CARTRIDGE_BOARD_MAILBOX;
			break;
		default:
			throw new Error(`Unknown cartridge board "${String(board)}".`);
	}
	const cartridgeRamByteCount = manifest?.cartridge?.ram_bytes ?? 0;
	if (!Number.isInteger(cartridgeRamByteCount)
			|| cartridgeRamByteCount < 0
			|| cartridgeRamByteCount > CART_RAM_SIZE) {
		throw new Error(`Cartridge RAM byte count must be an integer from 0 through ${CART_RAM_SIZE}.`);
	}
	if ((cartridgeBoardWord & CARTRIDGE_BOARD_RAM) === 0 && cartridgeRamByteCount !== 0) {
		throw new Error('Cartridge RAM bytes require a RAM board.');
	}
	return { cartridgeBoardWord, cartridgeRamByteCount };
}
