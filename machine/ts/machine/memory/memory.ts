import type { Value } from '../cpu/cpu';
import {
	CART_ROM_BASE,
	CART_ROM_SIZE,
	IO_BASE,
	IO_WORD_SIZE,
	PROGRAM_ROM_BASE,
	PROGRAM_ROM_SIZE,
	RAM_BASE,
	RAM_END,
	SYSTEM_ROM_BASE,
	SYSTEM_ROM_SIZE,
} from './map';
import {
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
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_SLOT,
	IO_APU_EVENT_SOURCE_ADDR,
	IO_APU_ACTIVE_MASK,
	IO_APU_SELECTED_SOURCE_ADDR,
	IO_APU_FAULT_CODE,
	IO_APU_FAULT_DETAIL,
	IO_APU_STATUS,
	IO_DMA_STATUS,
	IO_GEO_FAULT,
	IO_GEO_PROCESSED,
	IO_GEO_STATUS,
	IO_INP_KEYS,
	IO_INP_OUTPUT_PORT,
	IO_INP_OUTPUT_STATUS,
	IO_INP_STATUS,
	IO_IRQ_FLAGS,
	IO_SLOT_COUNT,
	IO_SYS_BUS_FAULT_ACCESS,
	IO_SYS_BUS_FAULT_ACK,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_BUS_FAULT_CODE,
	IO_SYS_HOST_FAULT_FLAGS,
	IO_SYS_HOST_FAULT_STAGE,
	IO_SYS_FRAME_MS,
	IO_SYS_CYCLES_PER_FRAME,
	IO_SYS_TIME_MS,
} from '../bus/io';
import { readLE16, readLE32, writeLE16, writeLE32 } from '../../common/endian';

const BUS_ACCESS_READ_WORD = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_WORD;
const BUS_ACCESS_WRITE_WORD = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_WORD;
const BUS_ACCESS_READ_U8 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8;
const BUS_ACCESS_WRITE_U8 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8;
const BUS_ACCESS_READ_U16 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U16;
const BUS_ACCESS_READ_U32 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32;
const BUS_ACCESS_WRITE_U16 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U16;
const BUS_ACCESS_WRITE_U32 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32;

export type IoReadHandler<TContext> = (context: TContext, addr: number) => Value;
export type IoWriteHandler<TContext> = (context: TContext, addr: number, value: Value) => void;
export type IoWriteReadyHandler<TContext> = (context: TContext, addr: number) => boolean;
type StoredIoReadHandler = (context: unknown, addr: number) => Value;
type StoredIoWriteHandler = (context: unknown, addr: number, value: Value) => void;
type StoredIoWriteReadyHandler = (context: unknown, addr: number) => boolean;

export type MemorySaveState = {
	ram: Uint8Array;
	busFaultCode: number;
	busFaultAddr: number;
	busFaultAccess: number;
};

export type MainMemoryByteView = {
	bytes: Uint8Array;
	byteOffset: number;
	byteLength: number;
};

export type MemoryInit = {
	systemRom: Uint8Array;
	cartRom: Uint8Array;
};

export class Memory {
	private readonly systemRom: Uint8Array;
	private readonly cartRom: Uint8Array;
	private readonly ram: Uint8Array;
	private readonly ioSlots: Value[];
	private readonly ioReadContexts: unknown[];
	private readonly ioWriteContexts: unknown[];
	private readonly ioReadHandlers: Array<StoredIoReadHandler | null>;
	private readonly ioWriteHandlers: Array<StoredIoWriteHandler | null>;
	private readonly ioWriteReadyHandlers: Array<StoredIoWriteReadyHandler | null>;
	private readonly ioByteLength = IO_SLOT_COUNT * IO_WORD_SIZE;
	private readonly busFaultCodeSlot = (IO_SYS_BUS_FAULT_CODE - IO_BASE) / IO_WORD_SIZE;
	private readonly busFaultAddrSlot = (IO_SYS_BUS_FAULT_ADDR - IO_BASE) / IO_WORD_SIZE;
	private readonly busFaultAccessSlot = (IO_SYS_BUS_FAULT_ACCESS - IO_BASE) / IO_WORD_SIZE;
	private readonly busFaultAckSlot = (IO_SYS_BUS_FAULT_ACK - IO_BASE) / IO_WORD_SIZE;
	private programRom: Uint8Array = new Uint8Array(0);
	private programTextByteLength = 0;
	private readonly mappedFloatBuffer = new ArrayBuffer(8);
	private readonly mappedFloatView = new DataView(this.mappedFloatBuffer);
	private busFaultCode = BUS_FAULT_NONE;
	private busFaultAddr = 0;
	private busFaultAccess = 0;

	public constructor(init: MemoryInit) {
		this.systemRom = init.systemRom;
		this.cartRom = init.cartRom;
		this.ram = new Uint8Array(RAM_END - RAM_BASE);
		this.ioSlots = new Array<Value>(IO_SLOT_COUNT);
		for (let index = 0; index < this.ioSlots.length; index += 1) {
			this.ioSlots[index] = null;
		}
		this.ioReadContexts = new Array<unknown>(IO_SLOT_COUNT);
		this.ioWriteContexts = new Array<unknown>(IO_SLOT_COUNT);
		this.ioReadHandlers = new Array<StoredIoReadHandler | null>(IO_SLOT_COUNT);
		this.ioWriteHandlers = new Array<StoredIoWriteHandler | null>(IO_SLOT_COUNT);
		this.ioWriteReadyHandlers = new Array<StoredIoWriteReadyHandler | null>(IO_SLOT_COUNT);
		for (let index = 0; index < IO_SLOT_COUNT; index += 1) {
			this.ioReadContexts[index] = null;
			this.ioWriteContexts[index] = null;
			this.ioReadHandlers[index] = null;
			this.ioWriteHandlers[index] = null;
			this.ioWriteReadyHandlers[index] = null;
		}
		this.ioWriteContexts[this.busFaultAckSlot] = this;
		this.ioWriteHandlers[this.busFaultAckSlot] = Memory.onBusFaultAckWriteThunk;
		this.clearBusFault();
	}

	public mapIoRead<TContext>(addr: number, context: TContext, handler: IoReadHandler<TContext>): void {
		const slot = (addr - IO_BASE) / IO_WORD_SIZE;
		this.ioReadContexts[slot] = context;
		this.ioReadHandlers[slot] = handler as StoredIoReadHandler;
	}

	public mapIoWrite<TContext>(addr: number, context: TContext, handler: IoWriteHandler<TContext>): void {
		const slot = (addr - IO_BASE) / IO_WORD_SIZE;
		this.ioWriteContexts[slot] = context;
		this.ioWriteHandlers[slot] = handler as StoredIoWriteHandler;
	}

	public mapIoWriteReady<TContext>(addr: number, handler: IoWriteReadyHandler<TContext>): void {
		const slot = (addr - IO_BASE) / IO_WORD_SIZE;
		this.ioWriteReadyHandlers[slot] = handler as StoredIoWriteReadyHandler;
	}

	public mappedWriteReady(addr: number): boolean {
		const slot = this.ioAlignedSlot(addr);
		if (slot < 0) return true;
		const handler = this.ioWriteReadyHandlers[slot];
		return handler === null || handler(this.ioWriteContexts[slot], addr);
	}

	public setProgramRom(rom: Uint8Array, textByteLength: number): void {
		this.programRom = rom;
		this.programTextByteLength = textByteLength;
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
		this.ram.set(state.ram);
		this.busFaultCode = state.busFaultCode >>> 0;
		this.busFaultAddr = state.busFaultAddr >>> 0;
		this.busFaultAccess = state.busFaultAccess >>> 0;
		this.writeBusFaultSlots();
	}

	private readRomWindowU16LE(bytes: Uint8Array, offset: number): number {
		if (offset + 2 <= bytes.byteLength) {
			return readLE16(bytes, offset);
		}
		if (offset >= bytes.byteLength) {
			return 0;
		}
		return bytes[offset]!;
	}

	private readRomWindowU32LE(bytes: Uint8Array, offset: number): number {
		if (offset + 4 <= bytes.byteLength) {
			return readLE32(bytes, offset);
		}
		if (offset >= bytes.byteLength) {
			return 0;
		}
		let value = bytes[offset]!;
		const remaining = bytes.byteLength - offset;
		if (remaining >= 2) {
			value |= bytes[offset + 1]! << 8;
		}
		if (remaining >= 3) {
			value |= bytes[offset + 2]! << 16;
		}
		return value >>> 0;
	}

	private copyRomWindowInto(bytes: Uint8Array, offset: number, out: Uint8Array, dstOffset: number, length: number): void {
		if (offset >= bytes.byteLength) {
			out.fill(0, dstOffset, dstOffset + length);
			return;
		}
		const available = bytes.byteLength - offset;
		if (length <= available) {
			for (let index = 0; index < length; index += 1) {
				out[dstOffset + index] = bytes[offset + index]!;
			}
			return;
		}
		for (let index = 0; index < available; index += 1) {
			out[dstOffset + index] = bytes[offset + index]!;
		}
		out.fill(0, dstOffset + available, dstOffset + length);
	}

	private readMainMemoryU8(addr: number, faultAccess: number): number {
		if (this.isProgramRomReadableRange(addr, 1)) {
			const offset = addr - PROGRAM_ROM_BASE;
			return offset < this.programRom.byteLength ? this.programRom[offset]! : 0;
		}
		if (addr >= SYSTEM_ROM_BASE && addr < SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE) {
			const offset = addr - SYSTEM_ROM_BASE;
			return offset < this.systemRom.byteLength ? this.systemRom[offset]! : 0;
		}
		if (addr >= CART_ROM_BASE && addr < CART_ROM_BASE + CART_ROM_SIZE) {
			const offset = addr - CART_ROM_BASE;
			return offset < this.cartRom.byteLength ? this.cartRom[offset]! : 0;
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

	private readIoSlotValue(slot: number, addr: number): Value {
		const handler = this.ioReadHandlers[slot];
		return handler !== null ? handler(this.ioReadContexts[slot], addr) : this.ioSlots[slot];
	}

	private writeIoSlotValue(slot: number, addr: number, value: Value): void {
		this.ioSlots[slot] = value;
		const handler = this.ioWriteHandlers[slot];
		if (handler !== null) {
			handler(this.ioWriteContexts[slot], addr, value);
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
			return this.readProgramRomWord(addr);
		}
		if (addr < RAM_BASE) {
			return this.readSystemOrCartRomU32(addr);
		}
		return this.readU32(addr);
	}

	public readMappedValue(addr: number): Value {
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			return this.readIoSlotValue(slot, addr);
		}
		if (this.isIoRegionRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_WORD);
			return 0;
		}
		if (addr >= PROGRAM_ROM_BASE && addr + 4 <= PROGRAM_ROM_BASE + PROGRAM_ROM_SIZE) {
			return this.readProgramRomWord(addr);
		}
		if (this.isRangeWithinRegion(addr, 4, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE)) {
			return this.readRomWindowU32LE(this.systemRom, addr - SYSTEM_ROM_BASE);
		}
		else if (this.isRangeWithinRegion(addr, 4, CART_ROM_BASE, CART_ROM_SIZE)) {
			return this.readRomWindowU32LE(this.cartRom, addr - CART_ROM_BASE);
		}
		else if (addr >= RAM_BASE) {
			const ramOffset = addr - RAM_BASE;
			if (ramOffset + 4 > this.ram.byteLength) {
				this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_WORD);
				return 0;
			}
			return readLE32(this.ram, ramOffset);
		}
		else {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_WORD);
			return 0;
		}
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
		this.ioSlots[(addr - IO_BASE) / IO_WORD_SIZE] = value;
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
		if (this.writeRamWordLE(addr, 4, value as number)) {
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_WORD);
	}

	public readU8(addr: number): number {
		return this.readMainMemoryU8(addr, BUS_ACCESS_READ_U8);
	}

	public readMappedU8(addr: number): number {
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
		if (this.writeRamU8(addr, value)) {
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U8);
	}

	public readIoU32(addr: number): number {
		return (this.readIoSlotValue((addr - IO_BASE) / IO_WORD_SIZE, addr) as number) >>> 0;
	}

	public readIoI32(addr: number): number {
		return (this.readIoSlotValue((addr - IO_BASE) / IO_WORD_SIZE, addr) as number) | 0;
	}

	public readU32(addr: number): number {
		if (addr >= PROGRAM_ROM_BASE && addr + 4 <= PROGRAM_ROM_BASE + PROGRAM_ROM_SIZE) {
			return this.readProgramRomWord(addr);
		}
		if (addr < RAM_BASE) {
			return this.readSystemOrCartRomU32(addr);
		}
		const offset = addr - RAM_BASE;
			if (offset + 4 <= this.ram.byteLength) {
				return readLE32(this.ram, offset);
			}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
		return 0;
	}

	private readSystemOrCartRomU32(addr: number): number {
		if (this.isRangeWithinRegion(addr, 4, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE)) {
			return this.readRomWindowU32LE(this.systemRom, addr - SYSTEM_ROM_BASE);
		}
		else if (this.isRangeWithinRegion(addr, 4, CART_ROM_BASE, CART_ROM_SIZE)) {
			return this.readRomWindowU32LE(this.cartRom, addr - CART_ROM_BASE);
		}
		else {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
			return 0;
		}
	}

	public readMappedU16LE(addr: number): number {
		if (this.isIoRegionRange(addr, 2)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U16);
			return 0;
		}
		if (this.isProgramRomReadableRange(addr, 2)) {
			return this.readRomWindowU16LE(this.programRom, addr - PROGRAM_ROM_BASE);
		}
		else if (this.isRangeWithinRegion(addr, 2, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE)) {
			return this.readRomWindowU16LE(this.systemRom, addr - SYSTEM_ROM_BASE);
		}
		else if (this.isRangeWithinRegion(addr, 2, CART_ROM_BASE, CART_ROM_SIZE)) {
			return this.readRomWindowU16LE(this.cartRom, addr - CART_ROM_BASE);
		}
		else if (addr >= RAM_BASE) {
			const ramOffset = addr - RAM_BASE;
			if (ramOffset + 2 > this.ram.byteLength) {
				this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U16);
				return 0;
			}
			return readLE16(this.ram, ramOffset);
		}
		else {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U16);
			return 0;
		}
	}

	public readMappedU32LE(addr: number): number {
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			return (this.readIoSlotValue(slot, addr) as number) >>> 0;
		}
		if (this.isIoRegionRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U32);
			return 0;
		}
		if (this.isProgramRomReadableRange(addr, 4)) {
			return this.readRomWindowU32LE(this.programRom, addr - PROGRAM_ROM_BASE);
		}
		else if (this.isRangeWithinRegion(addr, 4, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE)) {
			return this.readRomWindowU32LE(this.systemRom, addr - SYSTEM_ROM_BASE);
		}
		else if (this.isRangeWithinRegion(addr, 4, CART_ROM_BASE, CART_ROM_SIZE)) {
			return this.readRomWindowU32LE(this.cartRom, addr - CART_ROM_BASE);
		}
		else if (addr >= RAM_BASE) {
			const ramOffset = addr - RAM_BASE;
			if (ramOffset + 4 > this.ram.byteLength) {
				this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
				return 0;
			}
			return readLE32(this.ram, ramOffset);
		}
		else {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
			return 0;
		}
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
		if (this.writeRamWordLE(addr, 4, value)) {
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U32);
	}

	public writeMappedF32LE(addr: number, value: number): void {
		this.mappedFloatView.setFloat32(0, value, true);
		this.writeMappedU32LE(addr, this.mappedFloatView.getUint32(0, true));
	}

	public writeMappedF64LE(addr: number, value: number): void {
		this.mappedFloatView.setFloat64(0, value, true);
		this.writeMappedU32LE(addr, this.mappedFloatView.getUint32(0, true));
		this.writeMappedU32LE(addr + 4, this.mappedFloatView.getUint32(4, true));
	}

	public readBytesInto(addr: number, out: Uint8Array, length: number, dstOffset = 0): void {
		if (this.isProgramRomReadableRange(addr, length)) {
			this.copyRomWindowInto(this.programRom, addr - PROGRAM_ROM_BASE, out, dstOffset, length);
			return;
		}
		else if (this.isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE)) {
			this.copyRomWindowInto(this.systemRom, addr - SYSTEM_ROM_BASE, out, dstOffset, length);
			return;
		}
		else if (this.isRangeWithinRegion(addr, length, CART_ROM_BASE, CART_ROM_SIZE)) {
			this.copyRomWindowInto(this.cartRom, addr - CART_ROM_BASE, out, dstOffset, length);
			return;
		}
		else if (addr >= RAM_BASE) {
			const offset = addr - RAM_BASE;
			if (offset + length <= this.ram.byteLength) {
				for (let index = 0; index < length; index += 1) {
					out[dstOffset + index] = this.ram[offset + index]!;
				}
				return;
			}
		}
		for (let index = 0; index < length; index += 1) {
			out[dstOffset + index] = 0;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
	}

	public isReadableMainMemoryRange(addr: number, length: number): boolean {
		return this.isProgramRomReadableRange(addr, length)
			|| this.isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE)
			|| this.isRangeWithinRegion(addr, length, CART_ROM_BASE, CART_ROM_SIZE)
			|| (addr >= RAM_BASE && addr - RAM_BASE + length <= this.ram.byteLength);
	}

	public isImmutableMainMemoryRange(addr: number, length: number): boolean {
		return length > 0
			&& (this.isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, this.systemRom.byteLength)
				|| this.isRangeWithinRegion(addr, length, CART_ROM_BASE, this.cartRom.byteLength));
	}

	public bindImmutableMainMemoryView(addr: number, length: number, out: MainMemoryByteView): boolean {
		if (length > 0 && this.isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, this.systemRom.byteLength)) {
			out.bytes = this.systemRom;
			out.byteOffset = addr - SYSTEM_ROM_BASE;
			out.byteLength = length;
			return true;
		}
		if (length > 0 && this.isRangeWithinRegion(addr, length, CART_ROM_BASE, this.cartRom.byteLength)) {
			out.bytes = this.cartRom;
			out.byteOffset = addr - CART_ROM_BASE;
			out.byteLength = length;
			return true;
		}
		return false;
	}

	public isRamRange(addr: number, length: number): boolean {
		return addr >= RAM_BASE && addr - RAM_BASE + length <= this.ram.byteLength;
	}

	public writeBytes(addr: number, bytes: Uint8Array): void {
		if (addr >= RAM_BASE) {
			const offset = addr - RAM_BASE;
			if (offset + bytes.byteLength <= this.ram.byteLength) {
				this.ram.set(bytes, offset);
				return;
			}
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8);
	}

	public writeBytesFrom(src: Uint8Array, srcOffset: number, dstAddr: number, length: number): void {
		if (dstAddr >= RAM_BASE) {
			const offset = dstAddr - RAM_BASE;
			if (offset + length <= this.ram.byteLength) {
				for (let index = 0; index < length; index += 1) {
					this.ram[offset + index] = src[srcOffset + index]!;
				}
				return;
			}
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, dstAddr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8);
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

	private static onBusFaultAckWriteThunk(context: Memory, addr: number, value: Value): void {
		void addr;
		if (((value as number) >>> 0) !== 0) {
			context.clearBusFault();
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
		if (addr >= IO_INP_KEYS && addr < IO_INP_OUTPUT_PORT) {
			return true; // latched keyboard/pointer/pad snapshot words
		}
		switch (addr) {
			case IO_SYS_BUS_FAULT_CODE:
			case IO_SYS_BUS_FAULT_ADDR:
			case IO_SYS_BUS_FAULT_ACCESS:
			case IO_SYS_HOST_FAULT_FLAGS:
			case IO_SYS_HOST_FAULT_STAGE:
			case IO_SYS_TIME_MS:
			case IO_SYS_FRAME_MS:
			case IO_SYS_CYCLES_PER_FRAME:
			case IO_IRQ_FLAGS:
			case IO_DMA_STATUS:
			case IO_GEO_STATUS:
			case IO_GEO_PROCESSED:
			case IO_GEO_FAULT:
			case IO_INP_STATUS:
			case IO_INP_OUTPUT_STATUS:
			case IO_APU_STATUS:
			case IO_APU_FAULT_CODE:
			case IO_APU_FAULT_DETAIL:
			case IO_APU_EVENT_KIND:
			case IO_APU_EVENT_SLOT:
			case IO_APU_EVENT_SOURCE_ADDR:
			case IO_APU_EVENT_SEQ:
			case IO_APU_SELECTED_SOURCE_ADDR:
			case IO_APU_ACTIVE_MASK:
				return true;
			default:
				return false;
		}
	}

	private isProgramRomReadableRange(addr: number, length: number): boolean {
		return addr >= PROGRAM_ROM_BASE
			&& addr + length <= PROGRAM_ROM_BASE + PROGRAM_ROM_SIZE;
	}

	private readProgramRomWord(addr: number): number {
		const offset = addr - PROGRAM_ROM_BASE;
		if (offset >= this.programRom.byteLength) {
			return 0;
		}
		if (offset >= this.programTextByteLength) {
			return this.readRomWindowU32LE(this.programRom, offset);
		}
		const code = this.programRom;
		const byteLength = code.byteLength;
		return (
			((offset < byteLength ? code[offset]! : 0) << 24)
			| ((offset + 1 < byteLength ? code[offset + 1]! : 0) << 16)
			| ((offset + 2 < byteLength ? code[offset + 2]! : 0) << 8)
			| (offset + 3 < byteLength ? code[offset + 3]! : 0)
		) >>> 0;
	}

}
