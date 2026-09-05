import { readLE16, readLE32, writeLE16, writeLE32 } from '../../../common/endian';
import {
	CART_MMIO_BASE,
	CART_RAM_BASE,
	CART_ROM_BASE,
	CART_ROM_END,
} from '../../../spec/bmsx/memory_map';
import type {
	MappedPageBinding,
	MappedPageInvalidator,
} from '../../memory/memory';
import {
	MAPPED_PAGE_BYTE_SIZE,
	MappedPageWriteWatches,
} from '../../memory/mapped_page';
import type {
	CartridgeByteView,
	CartridgeCardState,
	CartridgeCardMedia,
} from './contracts';
import {
	CartridgeMailbox,
} from './mailbox';

type CartridgeRamRegion = {
	bytes: Uint8Array;
	pageWriteWatches: MappedPageWriteWatches;
};

type CartridgeRomRegion = {
	bytes: Uint8Array;
};

export class CartridgeCard {
	private readonly rom: CartridgeRomRegion | null;
	private readonly ram: CartridgeRamRegion | null;
	private readonly mappedKeyOffset: number;
	private readonly mailbox: CartridgeMailbox | null;
	private mappedPageInvalidator: MappedPageInvalidator | null = null;

	public constructor(media: CartridgeCardMedia, mappedKeyOffset: number) {
		this.rom = media.rom === null ? null : { bytes: media.rom };
		this.ram = media.ramByteCount === null
			? null
			: {
				bytes: new Uint8Array(media.ramByteCount),
				pageWriteWatches: new MappedPageWriteWatches(media.ramByteCount),
			};
		this.mappedKeyOffset = mappedKeyOffset;
		this.mailbox = media.mailboxPresent ? new CartridgeMailbox() : null;
	}

	public ramByteCount(): number {
		return this.ram === null ? 0 : this.ram.bytes.byteLength;
	}

	public installRom(rom: Uint8Array): void {
		this.rom!.bytes = rom;
		if (this.mappedPageInvalidator !== null) {
			this.mappedPageInvalidator.invalidateMappedRange(
				CART_ROM_BASE + this.mappedKeyOffset,
				CART_ROM_END + this.mappedKeyOffset,
			);
		}
	}

	public attachMappedPageInvalidator(invalidator: MappedPageInvalidator): void {
		this.mappedPageInvalidator = invalidator;
	}

	public clearMappedPageWriteWatches(): void {
		if (this.ram !== null) this.ram.pageWriteWatches.clear();
	}

	public bindMappedPage(address: number, out: MappedPageBinding): void {
		out.key = address + this.mappedKeyOffset;
		out.readBytes = null;
		out.readByteOffset = 0;
		out.writeWatches = null;
		out.writeWatchIndex = 0;
		if (address < CART_RAM_BASE) {
			out.cacheable = true;
			const rom = this.rom;
			const offset = address - CART_ROM_BASE;
			if (rom !== null && offset + MAPPED_PAGE_BYTE_SIZE <= rom.bytes.byteLength) {
				out.readBytes = rom.bytes;
				out.readByteOffset = offset;
			}
			return;
		}
		if (address < CART_MMIO_BASE) {
			const ram = this.ram;
			const offset = address - CART_RAM_BASE;
			if (ram !== null && offset < ram.bytes.byteLength) {
				out.cacheable = true;
				if (offset + MAPPED_PAGE_BYTE_SIZE <= ram.bytes.byteLength) {
					out.readBytes = ram.bytes;
					out.readByteOffset = offset;
				}
				ram.pageWriteWatches.bind(offset, out);
				return;
			}
		}
		out.cacheable = false;
	}

	public reset(): void {
		if (this.mailbox !== null) this.mailbox.reset();
	}

	public captureState(storage?: CartridgeCardState): CartridgeCardState {
		let ram: Uint8Array | null = null;
		if (this.ram !== null) {
			ram = storage === undefined ? new Uint8Array(this.ram.bytes.byteLength) : storage.ram!;
			ram.set(this.ram.bytes);
		}
		return {
			ram,
			mailbox: this.mailbox === null ? null : this.mailbox.captureState(),
		};
	}

	public restoreState(state: CartridgeCardState): void {
		if ((state.ram === null) !== (this.ram === null)) {
			throw new Error('Cartridge RAM state does not match the inserted card.');
		}
		if (this.ram !== null && state.ram!.byteLength !== this.ram.bytes.byteLength) {
			throw new Error('Cartridge RAM size does not match the inserted card.');
		}
		if ((state.mailbox === null) !== (this.mailbox === null)) {
			throw new Error('Cartridge mailbox state does not match the inserted card.');
		}
		if (this.ram !== null) {
			this.ram.bytes.set(state.ram!);
		}
		if (this.ram !== null && this.mappedPageInvalidator !== null) {
			this.mappedPageInvalidator.invalidateMappedRange(
				CART_RAM_BASE + this.mappedKeyOffset,
				CART_RAM_BASE + this.mappedKeyOffset + this.ram.bytes.byteLength,
			);
		}
		if (this.mailbox !== null) {
			this.mailbox.restoreState(state.mailbox!);
		}
	}

	public readU8(address: number): number {
		if (address < CART_RAM_BASE) {
			const rom = this.rom;
			const offset = address - CART_ROM_BASE;
			return rom !== null && offset < rom.bytes.byteLength ? rom.bytes[offset]! : 0;
		}
		if (address < CART_MMIO_BASE) {
			const ram = this.ram;
			const offset = address - CART_RAM_BASE;
			return ram !== null && offset < ram.bytes.byteLength ? ram.bytes[offset]! : 0;
		}
		const word = this.readMmioWord(address - CART_MMIO_BASE);
		return (word >>> ((address & 3) << 3)) & 0xff;
	}

	public readU16(address: number): number {
		if (address < CART_RAM_BASE) {
			return this.rom === null
				? 0
				: CartridgeCard.readU16From(this.rom.bytes, address - CART_ROM_BASE);
		}
		if (address < CART_MMIO_BASE) {
			return this.ram === null
				? 0
				: CartridgeCard.readU16From(this.ram.bytes, address - CART_RAM_BASE);
		}
		const word = this.readMmioWord(address - CART_MMIO_BASE);
		return (word >>> ((address & 2) << 3)) & 0xffff;
	}

	public readU32(address: number): number {
		if (address < CART_RAM_BASE) {
			return this.rom === null
				? 0
				: CartridgeCard.readU32From(this.rom.bytes, address - CART_ROM_BASE);
		}
		if (address < CART_MMIO_BASE) {
			return this.ram === null
				? 0
				: CartridgeCard.readU32From(this.ram.bytes, address - CART_RAM_BASE);
		}
		return this.readMmioWord(address - CART_MMIO_BASE);
	}

	public writeU8(address: number, value: number): void {
		if (address < CART_RAM_BASE || address >= CART_MMIO_BASE) return;
		const ram = this.ram;
		const offset = address - CART_RAM_BASE;
		if (ram !== null && offset < ram.bytes.byteLength) {
			ram.bytes[offset] = value & 0xff;
			ram.pageWriteWatches.invalidateWrite(
				offset,
				1,
				CART_RAM_BASE + this.mappedKeyOffset,
				this.mappedPageInvalidator!,
			);
		}
	}

	public writeU16(address: number, value: number): void {
		if (address < CART_RAM_BASE || address >= CART_MMIO_BASE) return;
		const ram = this.ram;
		const offset = address - CART_RAM_BASE;
		if (ram !== null && offset + 2 <= ram.bytes.byteLength) {
			writeLE16(ram.bytes, offset, value);
			ram.pageWriteWatches.invalidateWrite(
				offset,
				2,
				CART_RAM_BASE + this.mappedKeyOffset,
				this.mappedPageInvalidator!,
			);
		}
	}

	public writeU32(address: number, value: number): number {
		if (address >= CART_RAM_BASE && address < CART_MMIO_BASE) {
			const ram = this.ram;
			const offset = address - CART_RAM_BASE;
			if (ram !== null && offset + 4 <= ram.bytes.byteLength) {
				writeLE32(ram.bytes, offset, value);
				ram.pageWriteWatches.invalidateWrite(
					offset,
					4,
					CART_RAM_BASE + this.mappedKeyOffset,
					this.mappedPageInvalidator!,
				);
			}
			return 0;
		}
		if (address >= CART_MMIO_BASE && this.mailbox !== null) {
			return this.mailbox.writeWord(address - CART_MMIO_BASE, value >>> 0);
		}
		return 0;
	}

	public readBytes(address: number, out: Uint8Array, dstOffset: number, length: number): void {
		if (address < CART_RAM_BASE && address + length <= CART_RAM_BASE) {
			if (this.rom === null) {
				out.fill(0, dstOffset, dstOffset + length);
			} else {
				CartridgeCard.readByteRun(this.rom.bytes, address - CART_ROM_BASE, out, dstOffset, length);
			}
			return;
		}
		if (address >= CART_RAM_BASE && address + length <= CART_MMIO_BASE) {
			if (this.ram === null) {
				out.fill(0, dstOffset, dstOffset + length);
			} else {
				CartridgeCard.readByteRun(this.ram.bytes, address - CART_RAM_BASE, out, dstOffset, length);
			}
			return;
		}
		for (let index = 0; index < length; index += 1) {
			out[dstOffset + index] = this.readU8(address + index);
		}
	}

	public bindRomByteView(address: number, length: number, out: CartridgeByteView): boolean {
		const rom = this.rom;
		const offset = address - CART_ROM_BASE;
		if (rom === null || length === 0 || offset >= rom.bytes.byteLength || length > rom.bytes.byteLength - offset) {
			return false;
		}
		out.bytes = rom.bytes;
		out.byteOffset = offset;
		out.byteLength = length;
		return true;
	}

	public dreqLines(): number {
		return this.mailbox === null ? 0 : this.mailbox.dreqLines();
	}

	private readMmioWord(offset: number): number {
		return this.mailbox === null ? 0 : this.mailbox.readWord(offset);
	}

	private static readU16From(bytes: Uint8Array, offset: number): number {
		if (offset + 2 <= bytes.byteLength) return readLE16(bytes, offset);
		return offset < bytes.byteLength ? bytes[offset]! : 0;
	}

	private static readByteRun(
		bytes: Uint8Array,
		offset: number,
		out: Uint8Array,
		dstOffset: number,
		length: number,
	): void {
		const available = offset < bytes.byteLength ? Math.min(length, bytes.byteLength - offset) : 0;
		out.set(bytes.subarray(offset, offset + available), dstOffset);
		if (available !== length) {
			out.fill(0, dstOffset + available, dstOffset + length);
		}
	}

	private static readU32From(bytes: Uint8Array, offset: number): number {
		if (offset + 4 <= bytes.byteLength) return readLE32(bytes, offset);
		if (offset >= bytes.byteLength) return 0;
		let word = bytes[offset]!;
		if (offset + 1 < bytes.byteLength) word |= bytes[offset + 1]! << 8;
		if (offset + 2 < bytes.byteLength) word |= bytes[offset + 2]! << 16;
		return word >>> 0;
	}
}
