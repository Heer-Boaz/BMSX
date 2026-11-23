import { readLE16, readLE32, writeLE16, writeLE32 } from '../../../common/endian';
import { RomStorage } from '../../memory/rom_storage';
import {
	CART_BUS_END,
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

export class CartridgeCard {
	private readonly rom: RomStorage | null;
	private readonly ram: CartridgeRamRegion | null;
	private readonly mappedKeyOffset: number;
	private readonly mailbox: CartridgeMailbox | null;
	private mappedPageInvalidator: MappedPageInvalidator | null = null;

	public constructor(media: CartridgeCardMedia, mappedKeyOffset: number) {
		this.rom = media.rom === null ? null : new RomStorage(media.rom);
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
		this.rom!.install(rom);
		if (this.mappedPageInvalidator !== null) {
			this.mappedPageInvalidator.invalidateMappedRange(
				CART_ROM_BASE + this.mappedKeyOffset,
				CART_ROM_END + this.mappedKeyOffset,
			);
		}
	}

	public romStorage(): RomStorage | null { return this.rom; }

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
			const rom = this.rom;
			const offset = address - CART_ROM_BASE;
			out.cacheable = rom !== null && offset + 4 <= rom.bytes.byteLength;
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

	private readScalar(address: number, width: 1 | 2 | 4): number | null {
		if (address < CART_MMIO_BASE) {
			const inRom = address < CART_RAM_BASE;
			const storage = inRom ? this.rom : this.ram;
			const offset = address - (inRom ? CART_ROM_BASE : CART_RAM_BASE);
			if (storage === null || offset + width > storage.bytes.byteLength) return null;
			if (width === 1) return storage.bytes[offset];
			if (width === 2) return readLE16(storage.bytes, offset);
			return readLE32(storage.bytes, offset);
		}
		if (this.mailbox === null) return null;
		const word = this.mailbox.readWord(address - CART_MMIO_BASE);
		if (width === 1) return (word >>> ((address & 3) << 3)) & 0xff;
		if (width === 2) return (word >>> ((address & 2) << 3)) & 0xffff;
		return word;
	}

	public readU8(address: number): number | null { return this.readScalar(address, 1); }
	public readU16(address: number): number | null { return this.readScalar(address, 2); }
	public readU32(address: number): number | null { return this.readScalar(address, 4); }

	private writeRamScalar(address: number, value: number, width: 1 | 2 | 4): boolean {
		const ram = this.ram;
		const offset = address - CART_RAM_BASE;
		if (ram === null || offset + width > ram.bytes.byteLength) return false;
		if (width === 1) ram.bytes[offset] = value;
		else if (width === 2) writeLE16(ram.bytes, offset, value);
		else writeLE32(ram.bytes, offset, value);
		ram.pageWriteWatches.invalidateWrite(offset, width, CART_RAM_BASE + this.mappedKeyOffset, this.mappedPageInvalidator!);
		return true;
	}

	public writeU8(address: number, value: number): boolean {
		if (address >= CART_MMIO_BASE) return this.mailbox !== null;
		if (address >= CART_RAM_BASE) return this.writeRamScalar(address, value, 1);
		return this.rom !== null && address - CART_ROM_BASE + 1 <= this.rom.bytes.byteLength;
	}

	public writeU16(address: number, value: number): boolean {
		if (address >= CART_MMIO_BASE) return this.mailbox !== null;
		if (address >= CART_RAM_BASE) return this.writeRamScalar(address, value, 2);
		return this.rom !== null && address - CART_ROM_BASE + 2 <= this.rom.bytes.byteLength;
	}

	public writeU32(address: number, value: number): number | null {
		if (address >= CART_MMIO_BASE) return this.mailbox === null ? null : this.mailbox.writeWord(address - CART_MMIO_BASE, value);
		if (address >= CART_RAM_BASE) return this.writeRamScalar(address, value, 4) ? 0 : null;
		return this.rom !== null && address - CART_ROM_BASE + 4 <= this.rom.bytes.byteLength ? 0 : null;
	}

	public isReadableRange(address: number, length: number): boolean {
		if (address >= CART_MMIO_BASE) return this.mailbox !== null && address + length <= CART_BUS_END;
		const inRom = address < CART_RAM_BASE;
		const storage = inRom ? this.rom : this.ram;
		return length !== 0 && storage !== null && address - (inRom ? CART_ROM_BASE : CART_RAM_BASE) + length <= storage.bytes.byteLength;
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

	public bindMappedReadView(address: number, length: number, out: CartridgeByteView): boolean {
		if (address < CART_RAM_BASE) return this.bindRomByteView(address, length, out);
		const ram = this.ram;
		const offset = address - CART_RAM_BASE;
		if (address >= CART_MMIO_BASE || ram === null || length === 0
			|| offset >= ram.bytes.byteLength || length > ram.bytes.byteLength - offset) return false;
		out.bytes = ram.bytes;
		out.byteOffset = offset;
		out.byteLength = length;
		return true;
	}

	public dreqLines(): number {
		return this.mailbox === null ? 0 : this.mailbox.dreqLines();
	}
}
