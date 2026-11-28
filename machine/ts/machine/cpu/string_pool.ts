import { byteStringFromBytes, byteStringToText } from '../../common/byte_string';
import { readLE32 } from '../../common/endian';
import {
	BLUA32_STRING_LENGTH_OFFSET, BLUA32_STRING_RECORD_HEADER_SIZE,
	BLUA32_STRING_ROM_ADDRESS_MASK, BLUA32_STRING_ROM_SOCKET_SHIFT,
} from '../../spec/blua32/image_format';
import { CART_ROM_BASE, MAIN_RAM_SIZE, RAM_BASE } from '../../spec/bmsx/memory_map';
import type { Memory } from '../memory/memory';

export type StringId = number;
const RAM_BYTE_MASK = MAIN_RAM_SIZE - 1;

export function isRamStringId(address: StringId): boolean { return address >= RAM_BASE && address < CART_ROM_BASE; }
export function storageOffset(address: StringId): number {
	if (address < RAM_BASE) return address;
	if (address < CART_ROM_BASE) return address & (MAIN_RAM_SIZE - 1);
	return (address & BLUA32_STRING_ROM_ADDRESS_MASK) - CART_ROM_BASE;
}

/** The String operand gives a physical record address, not an intern-table slot. */
export class StringPool {
	public constructor(protected readonly memory: Memory) {}
	private storage(address: number): Uint8Array {
		if (address < RAM_BASE) return this.memory.systemRomStorage().bytes;
		if (address < CART_ROM_BASE) return this.memory.ramData();
		return this.memory.cartridgeController.romStorage(address >>> BLUA32_STRING_ROM_SOCKET_SHIFT)!.bytes;
	}
	protected readWord(base: number, displacement = 0): number {
		if (isRamStringId(base)) return this.memory.readRamRecordWord(base + displacement);
		return readLE32(this.storage(base), storageOffset(base) + displacement);
	}

	public byteLength(id: StringId): number {
		const count = this.readWord(id, BLUA32_STRING_LENGTH_OFFSET);
		return isRamStringId(id) ? count & RAM_BYTE_MASK : count | 0;
	}
	public byteAt(id: StringId, index: number): number {
		if (isRamStringId(id)) return this.memory.readRamRecordByte(id + BLUA32_STRING_RECORD_HEADER_SIZE + index);
		return this.storage(id)[storageOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE + index];
	}

	public bytes(id: StringId, length = this.byteLength(id) >>> 0): string {
		if (length === 0) return '';
		if (isRamStringId(id)) {
			const source = this.memory.ramData(), offset = (id + BLUA32_STRING_RECORD_HEADER_SIZE) & RAM_BYTE_MASK;
			const first = Math.min(length, MAIN_RAM_SIZE - offset);
			const prefix = byteStringFromBytes(source, offset, first);
			return first === length ? prefix : prefix + byteStringFromBytes(source, 0, length - first);
		}
		return byteStringFromBytes(this.storage(id), storageOffset(id) + BLUA32_STRING_RECORD_HEADER_SIZE, length);
	}
	public toString(id: StringId): string { return byteStringToText(this.bytes(id)); }

	public compareBytes(left: StringId, right: StringId, offset: number, count: number): number {
		if (left === right) return 0;
		const a = this.storage(left), b = this.storage(right);
		const aMask = isRamStringId(left) ? RAM_BYTE_MASK : -1, bMask = isRamStringId(right) ? RAM_BYTE_MASK : -1;
		let ai = (storageOffset(left) + BLUA32_STRING_RECORD_HEADER_SIZE + offset) & aMask;
		let bi = (storageOffset(right) + BLUA32_STRING_RECORD_HEADER_SIZE + offset) & bMask;
		while (count !== 0) {
			const n = Math.min(count, (aMask >>> 0) + 1 - ai, (bMask >>> 0) + 1 - bi);
			for (let i = 0; i < n; ++i) {
				const delta = a[ai + i] - b[bi + i];
				if (delta !== 0) return delta;
			}
			count -= n;
			ai = (ai + n) & aMask;
			bi = (bi + n) & bMask;
		}
		return 0;
	}
}
