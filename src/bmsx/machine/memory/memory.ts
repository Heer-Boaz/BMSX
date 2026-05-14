import type { Value } from '../cpu/cpu';
import {
	CART_ROM_BASE,
	IO_BASE,
	IO_WORD_SIZE,
	OVERLAY_ROM_BASE,
	PROGRAM_ROM_BASE,
	PROGRAM_ROM_SIZE,
	RAM_BASE,
	RAM_END,
	SYSTEM_ROM_BASE,
	isVramMappedContiguousRange,
	isVramMappedRange,
} from './map';
import {
	BUS_FAULT_ACCESS_F32,
	BUS_FAULT_ACCESS_F64,
	BUS_FAULT_ACCESS_READ,
	BUS_FAULT_ACCESS_U8,
	BUS_FAULT_ACCESS_U16,
	BUS_FAULT_ACCESS_U32,
	BUS_FAULT_ACCESS_WORD,
	BUS_FAULT_ACCESS_WRITE,
	BUS_FAULT_NONE,
	BUS_FAULT_READ_ONLY,
	BUS_FAULT_UNALIGNED_IO,
	BUS_FAULT_UNMAPPED,
	BUS_FAULT_VRAM_RANGE,
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_SLOT,
	IO_APU_EVENT_SOURCE_ADDR,
	IO_APU_ACTIVE_MASK,
	IO_APU_SELECTED_SOURCE_ADDR,
	IO_APU_SELECTED_SLOT_REG0,
	IO_APU_SELECTED_SLOT_REG_COUNT,
	IO_APU_FAULT_CODE,
	IO_APU_FAULT_DETAIL,
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
	IO_SYS_BUS_FAULT_ACCESS,
	IO_SYS_BUS_FAULT_ACK,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_BUS_FAULT_CODE,
	IO_SYS_HOST_FAULT_FLAGS,
	IO_SYS_HOST_FAULT_STAGE,
	IO_VDP_FAULT_CODE,
	IO_VDP_FAULT_DETAIL,
	IO_VDP_RD_DATA,
	IO_VDP_RD_STATUS,
	IO_VDP_STATUS,
} from '../bus/io';
import { formatNumberAsHex } from '../../common/byte_hex_string';
import { readLE16, readLE32, writeLE16, writeLE32 } from '../../common/endian';

const BUS_ACCESS_READ_WORD = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_WORD;
const BUS_ACCESS_WRITE_WORD = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_WORD;
const BUS_ACCESS_READ_U8 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8;
const BUS_ACCESS_WRITE_U8 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8;
const BUS_ACCESS_READ_U16 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U16;
const BUS_ACCESS_READ_U32 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32;
const BUS_ACCESS_WRITE_U16 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U16;
const BUS_ACCESS_WRITE_U32 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32;

export type VramWriteSink = {
	writeVram(addr: number, bytes: Uint8Array, srcOffset?: number, length?: number): void;
	readVram(addr: number, out: Uint8Array): void;
};

export type IoReadHandler = (addr: number) => Value;
export type IoWriteHandler = (addr: number, value: Value) => void;

export type MemorySaveState = {
	ram: Uint8Array;
	busFaultCode: number;
	busFaultAddr: number;
	busFaultAccess: number;
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
	private readonly ioSlots: Value[];
	private readonly ioReadHandlers: Array<IoReadHandler | null>;
	private readonly ioWriteHandlers: Array<IoWriteHandler | null>;
	private readonly ioByteLength = IO_SLOT_COUNT * IO_WORD_SIZE;
	private readonly busFaultCodeSlot = (IO_SYS_BUS_FAULT_CODE - IO_BASE) / IO_WORD_SIZE;
	private readonly busFaultAddrSlot = (IO_SYS_BUS_FAULT_ADDR - IO_BASE) / IO_WORD_SIZE;
	private readonly busFaultAccessSlot = (IO_SYS_BUS_FAULT_ACCESS - IO_BASE) / IO_WORD_SIZE;
	private readonly busFaultAckSlot = (IO_SYS_BUS_FAULT_ACK - IO_BASE) / IO_WORD_SIZE;
	private programCode: Uint8Array = new Uint8Array(0);
	private vramWriter: VramWriteSink;
	private readonly vramScratch = new Uint8Array(4);
	private readonly vramReadScratch = new Uint8Array(4);
	private readonly vramScratch1 = this.vramScratch.subarray(0, 1);
	private readonly vramScratch2 = this.vramScratch.subarray(0, 2);
	private readonly vramReadScratch1 = this.vramReadScratch.subarray(0, 1);
	private readonly vramReadScratch2 = this.vramReadScratch.subarray(0, 2);
	private readonly mappedFloatBuffer = new ArrayBuffer(8);
	private readonly mappedFloatView = new DataView(this.mappedFloatBuffer);
	private busFaultCode = BUS_FAULT_NONE;
	private busFaultAddr = 0;
	private busFaultAccess = 0;

	public constructor(init: MemoryInit) {
		this.systemRom = init.systemRom;
		this.cartRom = init.cartRom;
		this.overlayRom = init.overlayRom;
		this.ram = new Uint8Array(RAM_END - RAM_BASE);
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
		this.ioWriteHandlers[this.busFaultAckSlot] = this.onBusFaultAckWrite.bind(this);
		this.clearBusFault();
	}

	public setVramWriter(writer: VramWriteSink): void {
		this.vramWriter = writer;
	}

	public mapIoRead(addr: number, handler: IoReadHandler): void {
		const slot = this.ioAlignedSlot(addr);
		if (slot < 0) {
			throw new Error(`I/O fault @ ${formatNumberAsHex(addr >>> 0, 8)}: invalid register.`);
		}
		this.ioReadHandlers[slot] = handler;
	}

	public mapIoWrite(addr: number, handler: IoWriteHandler): void {
		const slot = this.ioAlignedSlot(addr);
		if (slot < 0) {
			throw new Error(`I/O fault @ ${formatNumberAsHex(addr >>> 0, 8)}: invalid register.`);
		}
		this.ioWriteHandlers[slot] = handler;
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

	public captureSaveState(): MemorySaveState {
		return {
			ram: this.ram.slice(),
			busFaultCode: this.busFaultCode,
			busFaultAddr: this.busFaultAddr,
			busFaultAccess: this.busFaultAccess,
		};
	}

	public restoreSaveState(state: MemorySaveState): void {
		if (state.ram.byteLength !== this.ram.byteLength) {
			throw new Error(`[Memory] RAM snapshot length mismatch (${state.ram.byteLength} != ${this.ram.byteLength}).`);
		}
		this.ram.set(state.ram);
		this.busFaultCode = state.busFaultCode >>> 0;
		this.busFaultAddr = state.busFaultAddr >>> 0;
		this.busFaultAccess = state.busFaultAccess >>> 0;
		this.writeBusFaultSlots();
	}

	private readMainMemoryU8(addr: number, faultAccess: number): number {
		if (this.isProgramCodeReadableRange(addr, 1)) {
			return this.programCode[addr - PROGRAM_ROM_BASE];
		}
		if (addr >= SYSTEM_ROM_BASE && addr < SYSTEM_ROM_BASE + this.systemRom.byteLength) {
			return this.systemRom[addr - SYSTEM_ROM_BASE];
		}
		if (this.cartRom && addr >= CART_ROM_BASE && addr < CART_ROM_BASE + this.cartRom.byteLength) {
			return this.cartRom[addr - CART_ROM_BASE];
		}
		if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr < OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			return this.overlayRom[addr - OVERLAY_ROM_BASE];
		}
		if (addr >= RAM_BASE) {
			const offset = addr - RAM_BASE;
			if (offset < this.ram.byteLength) {
				return this.ram[offset];
			}
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
		return 0;
	}

	private writeVramU16LE(addr: number, value: number): void {
		writeLE16(this.vramScratch, 0, value);
		this.vramWriter.writeVram(addr, this.vramScratch2);
	}

	private writeVramU32LE(addr: number, value: number): void {
		writeLE32(this.vramScratch, 0, value);
		this.vramWriter.writeVram(addr, this.vramScratch);
	}

	private readIoSlotValue(slot: number, addr: number): Value {
		const handler = this.ioReadHandlers[slot];
		return handler !== null ? handler(addr) : this.ioSlots[slot];
	}

	private writeIoSlotValue(slot: number, addr: number, value: Value): void {
		this.ioSlots[slot] = value;
		const handler = this.ioWriteHandlers[slot];
		if (handler !== null) {
			handler(addr, value);
		}
	}

	private writeRamU8(addr: number, value: number): boolean {
		if (addr < RAM_BASE) {
			return false;
		}
		const offset = addr - RAM_BASE;
		if (offset >= this.ram.byteLength) {
			return false;
		}
		this.ram[offset] = value & 0xff;
		return true;
	}

	private writeRamWordLE(addr: number, byteLength: 2 | 4, value: number): boolean {
		if (addr < RAM_BASE) {
			return false;
		}
		const offset = addr - RAM_BASE;
		if (offset + byteLength > this.ram.byteLength) {
			return false;
		}
		if (byteLength === 2) {
			writeLE16(this.ram, offset, value);
		} else {
			writeLE32(this.ram, offset, value);
		}
		return true;
	}

	public clearIoSlots(): void {
		this.ioSlots.fill(null);
		this.clearBusFault();
	}

	public clearBusFault(): void {
		this.busFaultCode = BUS_FAULT_NONE;
		this.busFaultAddr = 0;
		this.busFaultAccess = 0;
		this.writeBusFaultSlots();
	}

	public collectRootValues(visit: (value: Value) => void): void {
		for (let index = 0; index < this.ioSlots.length; index += 1) {
			visit(this.ioSlots[index]);
		}
	}

	public readValue(addr: number): Value {
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			return this.readIoSlotValue(slot, addr);
		}
		if (addr >= PROGRAM_ROM_BASE && addr + 4 <= PROGRAM_ROM_BASE + PROGRAM_ROM_SIZE) {
			return this.readProgramCodeWord(addr);
		}
		if (addr < RAM_BASE) {
			return this.readU32FromRegion(addr);
		}
		return this.readU32(addr);
	}

	public readMappedValue(addr: number): Value {
		if (isVramMappedContiguousRange(addr, 4)) {
			this.vramWriter.readVram(addr, this.vramReadScratch);
			return readLE32(this.vramReadScratch, 0);
		}
		if (isVramMappedRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_READ_WORD);
			return 0;
		}
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			return this.readIoSlotValue(slot, addr);
		}
		if (this.isIoRegionRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_WORD);
			return 0;
		}
		if (addr >= PROGRAM_ROM_BASE && addr + 4 <= PROGRAM_ROM_BASE + PROGRAM_ROM_SIZE) {
			return this.readProgramCodeWord(addr);
		}
		let data: Uint8Array;
		let offset: number;
		if (addr >= SYSTEM_ROM_BASE && addr + 4 <= SYSTEM_ROM_BASE + this.systemRom.byteLength) {
			data = this.systemRom;
			offset = addr - SYSTEM_ROM_BASE;
		}
		else if (this.cartRom && addr >= CART_ROM_BASE && addr + 4 <= CART_ROM_BASE + this.cartRom.byteLength) {
			data = this.cartRom;
			offset = addr - CART_ROM_BASE;
		}
		else if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr + 4 <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			data = this.overlayRom;
			offset = addr - OVERLAY_ROM_BASE;
		}
		else if (addr >= RAM_BASE) {
			const ramOffset = addr - RAM_BASE;
			if (ramOffset + 4 > this.ram.byteLength) {
				this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_WORD);
				return 0;
			}
			data = this.ram;
			offset = ramOffset;
		}
		else {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_WORD);
			return 0;
		}
		return readLE32(data, offset);
	}

	public writeValue(addr: number, value: Value): void {
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			this.writeIoSlotValue(slot, addr, value);
			return;
		}
		this.writeU32(addr, value as number);
	}

	public writeIoValue(addr: number, value: Value): void {
		const slot = this.ioAlignedSlot(addr);
		if (slot < 0) {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_WORD);
			return;
		}
		this.ioSlots[slot] = value;
	}

	public writeMappedValue(addr: number, value: Value): void {
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			if (this.isLuaReadOnlyIoAddress(addr)) {
				this.raiseBusFault(BUS_FAULT_READ_ONLY, addr, BUS_ACCESS_WRITE_WORD);
				return;
			}
			this.writeIoSlotValue(slot, addr, value);
			return;
		}
		if (this.isIoRegionRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_WRITE_WORD);
			return;
		}
		if (isVramMappedContiguousRange(addr, 4)) {
			this.writeVramU32LE(addr, value as number);
			return;
		}
		if (isVramMappedRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_WRITE_WORD);
			return;
		}
		if (this.writeRamWordLE(addr, 4, value as number)) {
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_WORD);
	}

	public readU8(addr: number): number {
		if (isVramMappedRange(addr, 1)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_READ_U8);
			return 0;
		}
		return this.readMainMemoryU8(addr, BUS_ACCESS_READ_U8);
	}

	public readMappedU8(addr: number): number {
		if (isVramMappedRange(addr, 1)) {
			const out = this.vramReadScratch1;
			this.vramWriter.readVram(addr, out);
			return out[0];
		}
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			return (this.readIoSlotValue(slot, addr) as number) & 0xff;
		}
		if (this.isIoRegionRange(addr, 1)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U8);
			return 0;
		}
		return this.readMainMemoryU8(addr, BUS_ACCESS_READ_U8);
	}

	public writeU8(addr: number, value: number): void {
		if (isVramMappedRange(addr, 1)) {
			this.vramScratch[0] = value & 0xff;
			this.vramWriter.writeVram(addr, this.vramScratch1);
			return;
		}
		if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr < OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			this.overlayRom[addr - OVERLAY_ROM_BASE] = value & 0xff;
			return;
		}
		if (this.writeRamU8(addr, value)) {
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U8);
	}

	public writeMappedU8(addr: number, value: number): void {
		if (this.isIoRegionRange(addr, 1)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_WRITE_U8);
			return;
		}
		if (isVramMappedRange(addr, 1)) {
			this.vramScratch[0] = value & 0xff;
			this.vramWriter.writeVram(addr, this.vramScratch1);
			return;
		}
		if (this.writeRamU8(addr, value)) {
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U8);
	}

	public readIoU32(addr: number): number {
		const slot = this.ioAlignedSlot(addr);
		if (slot < 0) {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
			return 0;
		}
		return (this.readIoSlotValue(slot, addr) as number) >>> 0;
	}

	public readIoI32(addr: number): number {
		const slot = this.ioAlignedSlot(addr);
		if (slot < 0) {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
			return 0;
		}
		return (this.readIoSlotValue(slot, addr) as number) | 0;
	}

	public readU32(addr: number): number {
		if (isVramMappedRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_READ_U32);
			return 0;
		}
		if (addr >= PROGRAM_ROM_BASE && addr + 4 <= PROGRAM_ROM_BASE + PROGRAM_ROM_SIZE) {
			return this.readProgramCodeWord(addr);
		}
		if (addr < RAM_BASE) {
			return this.readU32FromRegion(addr);
		}
		const offset = addr - RAM_BASE;
			if (offset + 4 <= this.ram.byteLength) {
				return readLE32(this.ram, offset);
			}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
		return 0;
	}

	private readU32FromRegion(addr: number): number {
		let data: Uint8Array;
		let offset: number;
		if (this.isProgramCodeReadableRange(addr, 4)) {
			data = this.programCode;
			offset = addr - PROGRAM_ROM_BASE;
		}
		else if (addr >= SYSTEM_ROM_BASE && addr + 4 <= SYSTEM_ROM_BASE + this.systemRom.byteLength) {
			data = this.systemRom;
			offset = addr - SYSTEM_ROM_BASE;
		}
		else if (this.cartRom && addr >= CART_ROM_BASE && addr + 4 <= CART_ROM_BASE + this.cartRom.byteLength) {
			data = this.cartRom;
			offset = addr - CART_ROM_BASE;
		}
		else if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr + 4 <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			data = this.overlayRom;
			offset = addr - OVERLAY_ROM_BASE;
		}
		else {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
			return 0;
		}
		return readLE32(data, offset);
	}

	public readMappedU16LE(addr: number): number {
		if (isVramMappedContiguousRange(addr, 2)) {
			const out = this.vramReadScratch2;
			this.vramWriter.readVram(addr, out);
			return readLE16(out, 0);
		}
		if (isVramMappedRange(addr, 2)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_READ_U16);
			return 0;
		}
		if (this.isIoRegionRange(addr, 2)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U16);
			return 0;
		}
		let data: Uint8Array;
		let offset: number;
		if (this.isProgramCodeReadableRange(addr, 2)) {
			data = this.programCode;
			offset = addr - PROGRAM_ROM_BASE;
		}
		else if (addr >= SYSTEM_ROM_BASE && addr + 2 <= SYSTEM_ROM_BASE + this.systemRom.byteLength) {
			data = this.systemRom;
			offset = addr - SYSTEM_ROM_BASE;
		}
		else if (this.cartRom && addr >= CART_ROM_BASE && addr + 2 <= CART_ROM_BASE + this.cartRom.byteLength) {
			data = this.cartRom;
			offset = addr - CART_ROM_BASE;
		}
		else if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr + 2 <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			data = this.overlayRom;
			offset = addr - OVERLAY_ROM_BASE;
		}
		else if (addr >= RAM_BASE) {
			const ramOffset = addr - RAM_BASE;
			if (ramOffset + 2 > this.ram.byteLength) {
				this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U16);
				return 0;
			}
			data = this.ram;
			offset = ramOffset;
		}
		else {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U16);
			return 0;
		}
		return readLE16(data, offset);
	}

	public readMappedU32LE(addr: number): number {
		if (isVramMappedContiguousRange(addr, 4)) {
			this.vramWriter.readVram(addr, this.vramReadScratch);
			return readLE32(this.vramReadScratch, 0);
		}
		if (isVramMappedRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_READ_U32);
			return 0;
		}
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			return (this.readIoSlotValue(slot, addr) as number) >>> 0;
		}
		if (this.isIoRegionRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U32);
			return 0;
		}
		let data: Uint8Array;
		let offset: number;
		if (this.isProgramCodeReadableRange(addr, 4)) {
			data = this.programCode;
			offset = addr - PROGRAM_ROM_BASE;
		}
		else if (addr >= SYSTEM_ROM_BASE && addr + 4 <= SYSTEM_ROM_BASE + this.systemRom.byteLength) {
			data = this.systemRom;
			offset = addr - SYSTEM_ROM_BASE;
		}
		else if (this.cartRom && addr >= CART_ROM_BASE && addr + 4 <= CART_ROM_BASE + this.cartRom.byteLength) {
			data = this.cartRom;
			offset = addr - CART_ROM_BASE;
		}
		else if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr + 4 <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			data = this.overlayRom;
			offset = addr - OVERLAY_ROM_BASE;
		}
		else if (addr >= RAM_BASE) {
			const ramOffset = addr - RAM_BASE;
			if (ramOffset + 4 > this.ram.byteLength) {
				this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
				return 0;
			}
			data = this.ram;
			offset = ramOffset;
		}
		else {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
			return 0;
		}
		return readLE32(data, offset);
	}

	public readMappedF32LE(addr: number): number {
		if (!this.isMappedReadableRange(addr, 4)) {
			const code = this.isIoRegionRange(addr, 4)
				? BUS_FAULT_UNALIGNED_IO
				: (isVramMappedRange(addr, 4) ? BUS_FAULT_VRAM_RANGE : BUS_FAULT_UNMAPPED);
			this.raiseBusFault(code, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_F32);
			return 0;
		}
		this.mappedFloatView.setUint32(0, this.readMappedU32LE(addr), true);
		return this.mappedFloatView.getFloat32(0, true);
	}

	public readMappedF64LE(addr: number): number {
		if (!this.isMappedReadableRange(addr, 8)) {
			const code = this.isIoRegionRange(addr, 8)
				? BUS_FAULT_UNALIGNED_IO
				: (isVramMappedRange(addr, 8) ? BUS_FAULT_VRAM_RANGE : BUS_FAULT_UNMAPPED);
			this.raiseBusFault(code, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_F64);
			return 0;
		}
		this.mappedFloatView.setUint32(0, this.readMappedU32LE(addr), true);
		this.mappedFloatView.setUint32(4, this.readMappedU32LE(addr + 4), true);
		return this.mappedFloatView.getFloat64(0, true);
	}

	public writeU32(addr: number, value: number): void {
		if (isVramMappedRange(addr, 4)) {
			this.writeVramU32LE(addr, value);
			return;
		}
		if (this.writeRamWordLE(addr, 4, value)) {
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U32);
	}

	public writeMappedU16LE(addr: number, value: number): void {
		if (this.isIoRegionRange(addr, 2)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_WRITE_U16);
			return;
		}
		if (isVramMappedContiguousRange(addr, 2)) {
			this.writeVramU16LE(addr, value);
			return;
		}
		if (isVramMappedRange(addr, 2)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_WRITE_U16);
			return;
		}
		if (this.writeRamWordLE(addr, 2, value)) {
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U16);
	}

	public writeMappedU32LE(addr: number, value: number): void {
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			if (this.isLuaReadOnlyIoAddress(addr)) {
				this.raiseBusFault(BUS_FAULT_READ_ONLY, addr, BUS_ACCESS_WRITE_U32);
				return;
			}
			const word = value >>> 0;
			this.writeIoSlotValue(slot, addr, word);
			return;
		}
		if (this.isIoRegionRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_WRITE_U32);
			return;
		}
		if (isVramMappedContiguousRange(addr, 4)) {
			this.writeVramU32LE(addr, value);
			return;
		}
		if (isVramMappedRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_WRITE_U32);
			return;
		}
		if (this.writeRamWordLE(addr, 4, value)) {
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U32);
	}

	public writeMappedF32LE(addr: number, value: number): void {
		if (!this.isMappedWritableRange(addr, 4)) {
			const code = this.isIoRegionRange(addr, 4)
				? (this.ioAlignedSlot(addr) >= 0 ? BUS_FAULT_READ_ONLY : BUS_FAULT_UNALIGNED_IO)
				: (isVramMappedRange(addr, 4) ? BUS_FAULT_VRAM_RANGE : BUS_FAULT_UNMAPPED);
			this.raiseBusFault(code, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F32);
			return;
		}
		this.mappedFloatView.setFloat32(0, value, true);
		this.writeMappedU32LE(addr, this.mappedFloatView.getUint32(0, true));
	}

	public writeMappedF64LE(addr: number, value: number): void {
		if (!this.isMappedWritableRange(addr, 8)) {
			const code = this.isIoRegionRange(addr, 8)
				? BUS_FAULT_UNALIGNED_IO
				: (isVramMappedRange(addr, 8) ? BUS_FAULT_VRAM_RANGE : BUS_FAULT_UNMAPPED);
			this.raiseBusFault(code, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F64);
			return;
		}
		this.mappedFloatView.setFloat64(0, value, true);
		this.writeMappedU32LE(addr, this.mappedFloatView.getUint32(0, true));
		this.writeMappedU32LE(addr + 4, this.mappedFloatView.getUint32(4, true));
	}

	public readBytesInto(addr: number, out: Uint8Array, length: number): boolean {
		if (isVramMappedRange(addr, length)) {
			for (let index = 0; index < length; index += 1) {
				out[index] = 0;
			}
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_ACCESS_READ_U8);
			return false;
		}
		let data: Uint8Array | undefined;
		let offset = 0;
		if (this.isProgramCodeReadableRange(addr, length)) {
			data = this.programCode;
			offset = addr - PROGRAM_ROM_BASE;
		}
		else if (addr >= SYSTEM_ROM_BASE && addr + length <= SYSTEM_ROM_BASE + this.systemRom.byteLength) {
			data = this.systemRom;
			offset = addr - SYSTEM_ROM_BASE;
		}
		else if (this.cartRom && addr >= CART_ROM_BASE && addr + length <= CART_ROM_BASE + this.cartRom.byteLength) {
			data = this.cartRom;
			offset = addr - CART_ROM_BASE;
		}
		else if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr + length <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			data = this.overlayRom;
			offset = addr - OVERLAY_ROM_BASE;
		}
		else if (addr >= RAM_BASE) {
			offset = addr - RAM_BASE;
			if (offset + length <= this.ram.byteLength) {
				data = this.ram;
			}
		}
		if (data !== undefined) {
			for (let index = 0; index < length; index += 1) {
				out[index] = data[offset + index]!;
			}
			return true;
		}
		for (let index = 0; index < length; index += 1) {
			out[index] = 0;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
		return false;
	}

	public isReadableMainMemoryRange(addr: number, length: number): boolean {
		return this.isProgramCodeReadableRange(addr, length)
			|| this.isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, this.systemRom.byteLength)
			|| (!!this.cartRom && this.isRangeWithinRegion(addr, length, CART_ROM_BASE, this.cartRom.byteLength))
			|| (!!this.overlayRom && this.isRangeWithinRegion(addr, length, OVERLAY_ROM_BASE, this.overlayRom.byteLength))
			|| (addr >= RAM_BASE && addr - RAM_BASE + length <= this.ram.byteLength);
	}

	public isRamRange(addr: number, length: number): boolean {
		return addr >= RAM_BASE && addr - RAM_BASE + length <= this.ram.byteLength;
	}

	public writeBytes(addr: number, bytes: Uint8Array): boolean {
		if (isVramMappedRange(addr, bytes.byteLength)) {
			this.vramWriter.writeVram(addr, bytes);
			return true;
		}
		if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr + bytes.byteLength <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			this.overlayRom.set(bytes, addr - OVERLAY_ROM_BASE);
			return true;
		}
		if (addr >= RAM_BASE) {
			const offset = addr - RAM_BASE;
			if (offset + bytes.byteLength <= this.ram.byteLength) {
				this.ram.set(bytes, offset);
				return true;
			}
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8);
		return false;
	}

	public writeBytesFrom(src: Uint8Array, srcOffset: number, dstAddr: number, length: number): boolean {
		if (isVramMappedRange(dstAddr, length)) {
			this.vramWriter.writeVram(dstAddr, src, srcOffset, length);
			return true;
		}
		if (this.overlayRom && dstAddr >= OVERLAY_ROM_BASE && dstAddr + length <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			const offset = dstAddr - OVERLAY_ROM_BASE;
			for (let index = 0; index < length; index += 1) {
				this.overlayRom[offset + index] = src[srcOffset + index]!;
			}
			return true;
		}
		if (dstAddr >= RAM_BASE) {
			const offset = dstAddr - RAM_BASE;
			if (offset + length <= this.ram.byteLength) {
				for (let index = 0; index < length; index += 1) {
					this.ram[offset + index] = src[srcOffset + index]!;
				}
				return true;
			}
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, dstAddr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8);
		return false;
	}

	private raiseBusFault(code: number, addr: number, access: number): void {
		if (this.busFaultCode !== BUS_FAULT_NONE) {
			return;
		}
		this.busFaultCode = code >>> 0;
		this.busFaultAddr = addr >>> 0;
		this.busFaultAccess = access >>> 0;
		this.writeBusFaultSlots();
	}

	private onBusFaultAckWrite(_addr: number, value: Value): void {
		if (((value as number) >>> 0) !== 0) {
			this.clearBusFault();
		}
	}

	private writeBusFaultSlots(): void {
		this.ioSlots[this.busFaultCodeSlot] = this.busFaultCode;
		this.ioSlots[this.busFaultAddrSlot] = this.busFaultAddr;
		this.ioSlots[this.busFaultAccessSlot] = this.busFaultAccess;
		this.ioSlots[this.busFaultAckSlot] = 0;
	}

	private isIoRegionRange(addr: number, length: number): boolean {
		return addr >= IO_BASE && addr + length <= IO_BASE + this.ioByteLength;
	}

	private ioAlignedSlot(addr: number): number {
		const index = addr - IO_BASE;
		if (index < 0 || index >= this.ioByteLength || (index & (IO_WORD_SIZE - 1)) !== 0) {
			return -1;
		}
		return index / IO_WORD_SIZE;
	}

	private isRangeWithinRegion(addr: number, length: number, base: number, size: number): boolean {
		return addr >= base && addr + length <= base + size;
	}

	private isLuaReadOnlyIoAddress(addr: number): boolean {
		if (addr >= IO_APU_SELECTED_SLOT_REG0 && addr < IO_APU_SELECTED_SLOT_REG0 + IO_APU_SELECTED_SLOT_REG_COUNT * IO_WORD_SIZE) {
			return true;
		}
		switch (addr) {
			case IO_SYS_BUS_FAULT_CODE:
			case IO_SYS_BUS_FAULT_ADDR:
			case IO_SYS_BUS_FAULT_ACCESS:
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
			case IO_APU_FAULT_CODE:
			case IO_APU_FAULT_DETAIL:
			case IO_APU_EVENT_KIND:
			case IO_APU_EVENT_SLOT:
			case IO_APU_EVENT_SOURCE_ADDR:
			case IO_APU_EVENT_SEQ:
			case IO_APU_SELECTED_SOURCE_ADDR:
			case IO_APU_ACTIVE_MASK:
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
			return length === IO_WORD_SIZE && this.ioAlignedSlot(addr) >= 0 && !this.isLuaReadOnlyIoAddress(addr);
		}
		if (addr >= PROGRAM_ROM_BASE && addr + length <= PROGRAM_ROM_BASE + PROGRAM_ROM_SIZE) {
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
		if (isVramMappedRange(addr, length)) {
			return isVramMappedContiguousRange(addr, length);
		}
		return addr >= RAM_BASE && addr - RAM_BASE + length <= this.ram.byteLength;
	}

	private isMappedReadableRange(addr: number, length: number): boolean {
		if (this.isIoRegionRange(addr, length)) {
			return length === IO_WORD_SIZE && this.ioAlignedSlot(addr) >= 0;
		}
		if (this.isProgramCodeReadableRange(addr, length)) {
			return true;
		}
		if (this.isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, this.systemRom.byteLength)) {
			return true;
		}
		if (this.cartRom && this.isRangeWithinRegion(addr, length, CART_ROM_BASE, this.cartRom.byteLength)) {
			return true;
		}
		if (this.overlayRom && this.isRangeWithinRegion(addr, length, OVERLAY_ROM_BASE, this.overlayRom.byteLength)) {
			return true;
		}
		if (isVramMappedRange(addr, length)) {
			return isVramMappedContiguousRange(addr, length);
		}
		return addr >= RAM_BASE && addr - RAM_BASE + length <= this.ram.byteLength;
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

}
