import type { Value } from '../cpu/cpu';
import {
	CART_ROM_BASE,
	IO_BASE,
	IO_WORD_SIZE,
	OVERLAY_ROM_BASE,
	PROGRAM_ROM_BASE,
	PROGRAM_ROM_SIZE,
	RAM_BASE,
	RAM_USED_END,
	SYSTEM_ROM_BASE,
	isVramMappedRange,
} from './map';
import {
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_SLOT,
	IO_APU_EVENT_SOURCE_ADDR,
	IO_APU_STATUS,
	IO_DMA_STATUS,
	IO_DMA_WRITTEN,
	IO_GEO_FAULT,
	IO_GEO_PROCESSED,
	IO_GEO_STATUS,
	IO_IMG_STATUS,
	IO_IMG_WRITTEN,
	IO_IRQ_FLAGS,
	IO_SLOT_COUNT,
	IO_SYS_HOST_FAULT_FLAGS,
	IO_SYS_HOST_FAULT_STAGE,
	IO_VDP_FAULT_CODE,
	IO_VDP_FAULT_DETAIL,
	IO_VDP_RD_DATA,
	IO_VDP_RD_STATUS,
	IO_VDP_STATUS,
} from '../bus/io';
import { formatNumberAsHex } from '../../common/byte_hex_string';

export type VramWriteSink = {
	writeVram(addr: number, bytes: Uint8Array): void;
	readVram(addr: number, out: Uint8Array): void;
};

export type IoReadHandler = (addr: number) => Value;
export type IoWriteHandler = (addr: number, value: Value) => void;

export type MemoryState = {
	ioMemory: Value[];
};

export type MemorySaveState = {
	ram: Uint8Array;
};

export type MemoryInit = {
	systemRom: Uint8Array;
	cartRom?: Uint8Array;
	overlayRom?: Uint8Array;
};

export class Memory {
	private readonly systemRom: Uint8Array;
	private readonly cartRom: Uint8Array | undefined;
	private readonly overlayRom: Uint8Array | undefined;
	private readonly ram: Uint8Array;
	private readonly ramView: DataView;
	private readonly ioSlots: Value[];
	private readonly ioReadHandlers: Array<IoReadHandler | null>;
	private readonly ioWriteHandlers: Array<IoWriteHandler | null>;
	private programCode: Uint8Array = new Uint8Array(0);
	private vramWriter: VramWriteSink;
	private readonly vramScratch = new Uint8Array(4);
	private readonly vramReadScratch = new Uint8Array(4);
	private readonly mappedFloatBuffer = new ArrayBuffer(8);
	private readonly mappedFloatView = new DataView(this.mappedFloatBuffer);

	public constructor(init: MemoryInit) {
		this.systemRom = init.systemRom;
		this.cartRom = init.cartRom;
		this.overlayRom = init.overlayRom;
		this.ram = new Uint8Array(RAM_USED_END - RAM_BASE);
		this.ramView = new DataView(this.ram.buffer, this.ram.byteOffset, this.ram.byteLength);
		this.ioSlots = new Array<Value>(IO_SLOT_COUNT);
		for (let index = 0; index < this.ioSlots.length; index += 1) {
			this.ioSlots[index] = null;
		}
		this.ioReadHandlers = new Array<IoReadHandler | null>(IO_SLOT_COUNT);
		this.ioWriteHandlers = new Array<IoWriteHandler | null>(IO_SLOT_COUNT);
		for (let index = 0; index < IO_SLOT_COUNT; index += 1) {
			this.ioReadHandlers[index] = null;
			this.ioWriteHandlers[index] = null;
		}
	}

	public setVramWriter(writer: VramWriteSink): void {
		this.vramWriter = writer;
	}

	public mapIoRead(addr: number, handler: IoReadHandler): void {
		this.ioReadHandlers[this.ioIndex(addr)] = handler;
	}

	public mapIoWrite(addr: number, handler: IoWriteHandler): void {
		this.ioWriteHandlers[this.ioIndex(addr)] = handler;
	}

	public setProgramCode(code: Uint8Array): void {
		if (code.byteLength > PROGRAM_ROM_SIZE) {
			throw new Error(`[Memory] Program ROM is ${code.byteLength} bytes; maximum is ${PROGRAM_ROM_SIZE}.`);
		}
		this.programCode = code;
	}

	public getOverlayRomSize(): number {
		return this.overlayRom ? this.overlayRom.byteLength : 0;
	}

	public getIoSlots(): ReadonlyArray<Value> {
		return this.ioSlots;
	}

	public loadIoSlots(slots: ReadonlyArray<Value>): void {
		if (slots.length !== this.ioSlots.length) {
			throw new Error(`[Memory] I/O snapshot slot count mismatch (${slots.length} != ${this.ioSlots.length}).`);
		}
		for (let index = 0; index < this.ioSlots.length; index += 1) {
			this.ioSlots[index] = slots[index];
		}
	}

	public clearIoSlots(): void {
		this.ioSlots.fill(null);
	}

	public dumpMutableRam(): Uint8Array {
		return this.ram.slice();
	}

	public restoreMutableRam(snapshot: Uint8Array): void {
		if (snapshot.byteLength !== this.ram.byteLength) {
			throw new Error(`[Memory] RAM snapshot length mismatch (${snapshot.byteLength} != ${this.ram.byteLength}).`);
		}
		this.ram.set(snapshot);
	}

	public captureState(): MemoryState {
		return {
			ioMemory: this.ioSlots.slice(),
		};
	}

	public restoreState(state: MemoryState): void {
		this.loadIoSlots(state.ioMemory);
	}

	public captureSaveState(): MemorySaveState {
		return {
			ram: this.dumpMutableRam(),
		};
	}

	public restoreSaveState(state: MemorySaveState): void {
		this.restoreMutableRam(state.ram);
	}

	public readValue(addr: number): Value {
		if (this.isIoAddress(addr)) {
			const slot = this.ioIndex(addr);
			const handler = this.ioReadHandlers[slot];
			if (handler !== null) {
				return handler(addr);
			}
			return this.ioSlots[slot];
		}
		if (this.isProgramRomRange(addr, 4)) {
			return this.readProgramCodeWord(addr);
		}
		if (addr < RAM_BASE) {
			return this.readU32FromRegion(addr);
		}
		return this.readU32(addr);
	}

	public readMappedValue(addr: number): Value {
		if (this.isVramRange(addr, 4)) {
			return this.readMappedU32LE(addr);
		}
		return this.readValue(addr);
	}

	public writeValue(addr: number, value: Value): void {
		if (this.isIoAddress(addr)) {
			const slot = this.ioIndex(addr);
			this.ioSlots[slot] = value;
			const handler = this.ioWriteHandlers[slot];
			if (handler !== null) {
				handler(addr, value);
			}
			return;
		}
		this.writeU32(addr, value as number);
	}

	public writeIoValue(addr: number, value: Value): void {
		if (!this.isIoAddress(addr)) {
			throw new Error(`I/O fault @ ${formatNumberAsHex(addr >>> 0, 8)}: invalid register.`);
		}
		this.ioSlots[this.ioIndex(addr)] = value;
	}

	public writeMappedValue(addr: number, value: Value): void {
		if (!this.isMappedWritableRange(addr, 4)) {
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write word.`);
		}
		if (this.isVramRange(addr, 4)) {
			this.writeMappedU32LE(addr, value as number);
			return;
		}
		this.writeValue(addr, value);
	}

	public readU8(addr: number): number {
		const { data, offset } = this.resolveReadRegion(addr, 1);
		return data[offset];
	}

	public readMappedU8(addr: number): number {
		if (this.isVramRange(addr, 1)) {
			const out = this.vramReadScratch.subarray(0, 1);
			this.readVram(addr, out);
			return out[0];
		}
		if (this.isIoAddress(addr)) {
			const value = this.readValue(addr);
			return (value as number) & 0xff;
		}
		if (this.isIoRegionRange(addr, 1)) {
			throw new Error(`I/O read fault @ ${formatNumberAsHex(addr >>> 0, 8)}: unaligned.`);
		}
		return this.readU8(addr);
	}

	public writeU8(addr: number, value: number): void {
		if (this.isVramRange(addr, 1)) {
			this.vramScratch[0] = value & 0xff;
			this.vramScratch[1] = 0;
			this.vramScratch[2] = 0;
			this.vramScratch[3] = 0;
			this.writeVram(addr, this.vramScratch.subarray(0, 1));
			return;
		}
		const { data, offset } = this.resolveWriteRegion(addr, 1);
		data[offset] = value & 0xff;
	}

	public writeMappedU8(addr: number, value: number): void {
		if (!this.isMappedWritableRange(addr, 1)) {
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write byte.`);
		}
		if (this.isIoAddress(addr)) {
			this.writeValue(addr, value & 0xff);
			return;
		}
		this.writeU8(addr, value);
	}

	public readIoU32(addr: number): number {
		if (!this.isIoAddress(addr)) {
			throw new Error(`I/O read fault @ ${formatNumberAsHex(addr >>> 0, 8)}: invalid register.`);
		}
		const value = this.readValue(addr);
		return (value as number) >>> 0;
	}

	public readIoI32(addr: number): number {
		return this.readIoU32(addr) | 0;
	}

	public readU32(addr: number): number {
		this.assertReadableRange(addr, 4);
		if (this.isProgramRomRange(addr, 4)) {
			return this.readProgramCodeWord(addr);
		}
		if (addr < RAM_BASE) {
			return this.readU32FromRegion(addr);
		}
		const offset = this.resolveRamOffset(addr, 4);
		return this.ramView.getUint32(offset, true);
	}

	private readU32FromRegion(addr: number): number {
		const { data, offset } = this.resolveReadRegion(addr, 4);
		return (
			data[offset]
			| (data[offset + 1] << 8)
			| (data[offset + 2] << 16)
			| (data[offset + 3] << 24)
		) >>> 0;
	}

	public readMappedU16LE(addr: number): number {
		const b0 = this.readMappedU8(addr);
		const b1 = this.readMappedU8(addr + 1);
		return (b0 | (b1 << 8)) >>> 0;
	}

	public readMappedU32LE(addr: number): number {
		const b0 = this.readMappedU8(addr);
		const b1 = this.readMappedU8(addr + 1);
		const b2 = this.readMappedU8(addr + 2);
		const b3 = this.readMappedU8(addr + 3);
		return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
	}

	public readMappedF32LE(addr: number): number {
		this.mappedFloatView.setUint32(0, this.readMappedU32LE(addr), true);
		return this.mappedFloatView.getFloat32(0, true);
	}

	public readMappedF64LE(addr: number): number {
		this.mappedFloatView.setUint32(0, this.readMappedU32LE(addr), true);
		this.mappedFloatView.setUint32(4, this.readMappedU32LE(addr + 4), true);
		return this.mappedFloatView.getFloat64(0, true);
	}

	public writeU32(addr: number, value: number): void {
		if (this.isVramRange(addr, 4)) {
			this.vramScratch[0] = value & 0xff;
			this.vramScratch[1] = (value >>> 8) & 0xff;
			this.vramScratch[2] = (value >>> 16) & 0xff;
			this.vramScratch[3] = (value >>> 24) & 0xff;
			this.writeVram(addr, this.vramScratch);
			return;
		}
		const offset = this.resolveRamOffset(addr, 4);
		this.ramView.setUint32(offset, value >>> 0, true);
	}

	public writeMappedU16LE(addr: number, value: number): void {
		if (!this.isMappedWritableRange(addr, 2)) {
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write halfword.`);
		}
		this.writeMappedU8(addr, value);
		this.writeMappedU8(addr + 1, value >>> 8);
	}

	public writeMappedU32LE(addr: number, value: number): void {
		if (!this.isMappedWritableRange(addr, 4)) {
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write word.`);
		}
		if (this.isIoAddress(addr)) {
			this.writeValue(addr, value >>> 0);
			return;
		}
		this.writeMappedU8(addr, value);
		this.writeMappedU8(addr + 1, value >>> 8);
		this.writeMappedU8(addr + 2, value >>> 16);
		this.writeMappedU8(addr + 3, value >>> 24);
	}

	public writeMappedF32LE(addr: number, value: number): void {
		this.mappedFloatView.setFloat32(0, value, true);
		this.writeMappedU32LE(addr, this.mappedFloatView.getUint32(0, true));
	}

	public writeMappedF64LE(addr: number, value: number): void {
		if (!this.isMappedWritableRange(addr, 8)) {
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write doubleword.`);
		}
		this.mappedFloatView.setFloat64(0, value, true);
		this.writeMappedU32LE(addr, this.mappedFloatView.getUint32(0, true));
		this.writeMappedU32LE(addr + 4, this.mappedFloatView.getUint32(4, true));
	}

	public readBytes(addr: number, length: number): Uint8Array {
		const { data, offset } = this.resolveReadRegion(addr, length);
		return data.subarray(offset, offset + length);
	}

	public isReadableMainMemoryRange(addr: number, length: number): boolean {
		return this.isProgramCodeReadableRange(addr, length)
			|| this.isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, this.systemRom.byteLength)
			|| (!!this.cartRom && this.isRangeWithinRegion(addr, length, CART_ROM_BASE, this.cartRom.byteLength))
			|| (!!this.overlayRom && this.isRangeWithinRegion(addr, length, OVERLAY_ROM_BASE, this.overlayRom.byteLength))
			|| this.isRangeWithinRegion(addr, length, RAM_BASE, RAM_USED_END - RAM_BASE);
	}

	public isRamRange(addr: number, length: number): boolean {
		return this.isRangeWithinRegion(addr, length, RAM_BASE, RAM_USED_END - RAM_BASE);
	}

	public writeBytes(addr: number, bytes: Uint8Array): void {
		if (this.isVramRange(addr, bytes.byteLength)) {
			this.writeVram(addr, bytes);
			return;
		}
		const { data, offset } = this.resolveWriteRegion(addr, bytes.byteLength);
		data.set(bytes, offset);
	}

	public writeBytesFrom(src: Uint8Array, srcOffset: number, dstAddr: number, length: number): void {
		const slice = src.subarray(srcOffset, srcOffset + length);
		if (this.isVramRange(dstAddr, length)) {
			this.writeVram(dstAddr, slice);
			return;
		}
		const { data, offset } = this.resolveWriteRegion(dstAddr, length);
		const dst = data.subarray(offset, offset + length);
		dst.set(slice);
	}

	private isIoAddress(addr: number): boolean {
		const index = addr - IO_BASE;
		return index >= 0 && index < this.ioSlots.length * IO_WORD_SIZE && (index % IO_WORD_SIZE) === 0;
	}

	private isIoRegionRange(addr: number, length: number): boolean {
		return addr >= IO_BASE && addr + length <= IO_BASE + this.ioSlots.length * IO_WORD_SIZE;
	}

	private ioIndex(addr: number): number {
		const index = addr - IO_BASE;
		if (index < 0 || (index % IO_WORD_SIZE) !== 0) {
			throw new Error(`I/O fault @ ${formatNumberAsHex(addr >>> 0, 8)}: unaligned.`);
		}
		const slot = index / IO_WORD_SIZE;
		if (slot < 0 || slot >= this.ioSlots.length) {
			throw new Error(`I/O fault @ ${formatNumberAsHex(addr >>> 0, 8)}: out of range.`);
		}
		return slot;
	}

	private resolveReadRegion(addr: number, length: number): { data: Uint8Array; offset: number } {
		this.assertReadableRange(addr, length);
		if (this.isProgramCodeReadableRange(addr, length)) {
			return { data: this.programCode, offset: addr - PROGRAM_ROM_BASE };
		}
		if (addr >= SYSTEM_ROM_BASE && addr + length <= SYSTEM_ROM_BASE + this.systemRom.byteLength) {
			return { data: this.systemRom, offset: addr - SYSTEM_ROM_BASE };
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
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: RAM range len=${length}.`);
		}
		return addr - RAM_BASE;
	}

	private assertReadableRange(addr: number, length: number): void {
		if (this.isVramRange(addr, length)) {
			throw new Error(`VRAM read fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write-only len=${length}.`);
		}
	}

	private isRangeWithinRegion(addr: number, length: number, base: number, size: number): boolean {
		return addr >= base && addr + length <= base + size;
	}

	private isLuaReadOnlyIoAddress(addr: number): boolean {
		switch (addr) {
			case IO_SYS_HOST_FAULT_FLAGS:
			case IO_SYS_HOST_FAULT_STAGE:
			case IO_IRQ_FLAGS:
			case IO_DMA_STATUS:
			case IO_DMA_WRITTEN:
			case IO_GEO_STATUS:
			case IO_GEO_PROCESSED:
			case IO_GEO_FAULT:
			case IO_IMG_STATUS:
			case IO_IMG_WRITTEN:
			case IO_APU_STATUS:
			case IO_APU_EVENT_KIND:
			case IO_APU_EVENT_SLOT:
			case IO_APU_EVENT_SOURCE_ADDR:
			case IO_APU_EVENT_SEQ:
			case IO_VDP_RD_STATUS:
			case IO_VDP_RD_DATA:
			case IO_VDP_STATUS:
			case IO_VDP_FAULT_CODE:
			case IO_VDP_FAULT_DETAIL:
				return true;
			default:
				return false;
		}
	}

	private isMappedWritableRange(addr: number, length: number): boolean {
		if (this.isIoRegionRange(addr, length)) {
			return length === IO_WORD_SIZE && this.isIoAddress(addr) && !this.isLuaReadOnlyIoAddress(addr);
		}
		if (this.isProgramRomRange(addr, length)) {
			return false;
		}
		if (this.isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, this.systemRom.byteLength)) {
			return false;
		}
		if (this.cartRom && this.isRangeWithinRegion(addr, length, CART_ROM_BASE, this.cartRom.byteLength)) {
			return false;
		}
		if (this.overlayRom && this.isRangeWithinRegion(addr, length, OVERLAY_ROM_BASE, this.overlayRom.byteLength)) {
			return false;
		}
		if (this.isVramRange(addr, length)) {
			return true;
		}
		return addr >= RAM_BASE && addr + length <= RAM_USED_END;
	}

	private writeVram(addr: number, bytes: Uint8Array): void {
		this.vramWriter.writeVram(addr, bytes);
	}

	private isProgramRomRange(addr: number, length: number): boolean {
		return this.isRangeWithinRegion(addr, length, PROGRAM_ROM_BASE, PROGRAM_ROM_SIZE);
	}

	private isProgramCodeReadableRange(addr: number, length: number): boolean {
		return addr >= PROGRAM_ROM_BASE
			&& addr + length <= PROGRAM_ROM_BASE + this.programCode.byteLength;
	}

	private readProgramCodeWord(addr: number): number {
		const offset = addr - PROGRAM_ROM_BASE;
		if (offset < 0 || offset + 4 > this.programCode.byteLength) {
			return 0;
		}
		const code = this.programCode;
		return (
			(code[offset] << 24)
			| (code[offset + 1] << 16)
			| (code[offset + 2] << 8)
			| code[offset + 3]
		) >>> 0;
	}

	private readVram(addr: number, out: Uint8Array): void {
		this.vramWriter.readVram(addr, out);
	}

	public isVramRange(addr: number, length: number): boolean {
		return isVramMappedRange(addr, length);
	}

}
