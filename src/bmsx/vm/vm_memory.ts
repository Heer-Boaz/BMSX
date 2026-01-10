import type { Value } from './cpu';
import {
	CART_ROM_BASE,
	ENGINE_ROM_BASE,
	IO_BASE,
	IO_WORD_SIZE,
	OVERLAY_ROM_BASE,
	RAM_BASE,
	RAM_USED_END,
} from './memory_map';
import { VM_IO_SLOT_COUNT } from './vm_io';

export type VmMemoryInit = {
	engineRom: Uint8Array;
	cartRom?: Uint8Array | null;
	overlayRom?: Uint8Array | null;
};

export class VmMemory {
	private readonly engineRom: Uint8Array;
	private readonly cartRom: Uint8Array | null;
	private readonly overlayRom: Uint8Array | null;
	private readonly ram: Uint8Array;
	private readonly ramView: DataView;
	private readonly ioSlots: Value[];

	public constructor(init: VmMemoryInit) {
		this.engineRom = init.engineRom;
		this.cartRom = init.cartRom ?? null;
		this.overlayRom = init.overlayRom ?? null;
		this.ram = new Uint8Array(RAM_USED_END - RAM_BASE);
		this.ramView = new DataView(this.ram.buffer, this.ram.byteOffset, this.ram.byteLength);
		this.ioSlots = new Array<Value>(VM_IO_SLOT_COUNT);
		for (let index = 0; index < this.ioSlots.length; index += 1) {
			this.ioSlots[index] = null;
		}
	}

	public getIoSlotCount(): number {
		return this.ioSlots.length;
	}

	public readValue(addr: number): Value {
		if (this.isIoAddress(addr)) {
			return this.ioSlots[this.ioIndex(addr)];
		}
		return this.readU32(addr);
	}

	public writeValue(addr: number, value: Value): void {
		if (this.isIoAddress(addr)) {
			this.ioSlots[this.ioIndex(addr)] = value;
			return;
		}
		if (typeof value !== 'number') {
			throw new Error(`[VmMemory] STORE_MEM expects a number outside IO space. Got ${typeof value}.`);
		}
		this.writeU32(addr, value);
	}

	public readU8(addr: number): number {
		const { data, offset } = this.resolveReadRegion(addr, 1);
		return data[offset];
	}

	public writeU8(addr: number, value: number): void {
		const { data, offset } = this.resolveWriteRegion(addr, 1);
		data[offset] = value & 0xff;
	}

	public readU32(addr: number): number {
		const offset = this.resolveRamOffset(addr, 4);
		return this.ramView.getUint32(offset, true);
	}

	public writeU32(addr: number, value: number): void {
		const offset = this.resolveRamOffset(addr, 4);
		this.ramView.setUint32(offset, value >>> 0, true);
	}

	public readBytes(addr: number, length: number): Uint8Array {
		const { data, offset } = this.resolveReadRegion(addr, length);
		return data.subarray(offset, offset + length);
	}

	public writeBytes(addr: number, bytes: Uint8Array): void {
		const { data, offset } = this.resolveWriteRegion(addr, bytes.byteLength);
		data.set(bytes, offset);
	}

	private isIoAddress(addr: number): boolean {
		const index = addr - IO_BASE;
		return index >= 0 && index < this.ioSlots.length * IO_WORD_SIZE && (index % IO_WORD_SIZE) === 0;
	}

	private ioIndex(addr: number): number {
		const index = addr - IO_BASE;
		if (index < 0 || (index % IO_WORD_SIZE) !== 0) {
			throw new Error(`[VmMemory] Unaligned IO address: ${addr}.`);
		}
		const slot = index / IO_WORD_SIZE;
		if (slot < 0 || slot >= this.ioSlots.length) {
			throw new Error(`[VmMemory] IO address out of range: ${addr}.`);
		}
		return slot;
	}

	private resolveReadRegion(addr: number, length: number): { data: Uint8Array; offset: number } {
		if (addr >= ENGINE_ROM_BASE && addr + length <= ENGINE_ROM_BASE + this.engineRom.byteLength) {
			return { data: this.engineRom, offset: addr - ENGINE_ROM_BASE };
		}
		if (this.cartRom && addr >= CART_ROM_BASE && addr + length <= CART_ROM_BASE + this.cartRom.byteLength) {
			return { data: this.cartRom, offset: addr - CART_ROM_BASE };
		}
		if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr + length <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			return { data: this.overlayRom, offset: addr - OVERLAY_ROM_BASE };
		}
		const offset = this.resolveRamOffset(addr, length);
		return { data: this.ram, offset };
	}

	private resolveWriteRegion(addr: number, length: number): { data: Uint8Array; offset: number } {
		if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr + length <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			return { data: this.overlayRom, offset: addr - OVERLAY_ROM_BASE };
		}
		const offset = this.resolveRamOffset(addr, length);
		return { data: this.ram, offset };
	}

	private resolveRamOffset(addr: number, length: number): number {
		if (addr < RAM_BASE || addr + length > RAM_USED_END) {
			throw new Error(`[VmMemory] Address out of RAM bounds: ${addr} (len=${length}).`);
		}
		return addr - RAM_BASE;
	}
}
