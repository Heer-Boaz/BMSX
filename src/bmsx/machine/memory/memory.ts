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

export type VramWriteSink = {
	writeVram(addr: number, bytes: Uint8Array): void;
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
	private readonly ramView: DataView;
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

	public dumpMutableRam(): Uint8Array {
		return this.ram.slice();
	}

	public restoreMutableRam(snapshot: Uint8Array): void {
		if (snapshot.byteLength !== this.ram.byteLength) {
			throw new Error(`[Memory] RAM snapshot length mismatch (${snapshot.byteLength} != ${this.ram.byteLength}).`);
		}
		this.ram.set(snapshot);
	}

	public captureSaveState(): MemorySaveState {
		return {
			ram: this.dumpMutableRam(),
			busFaultCode: this.busFaultCode,
			busFaultAddr: this.busFaultAddr,
			busFaultAccess: this.busFaultAccess,
		};
	}

	public restoreSaveState(state: MemorySaveState): void {
		this.restoreMutableRam(state.ram);
		this.busFaultCode = state.busFaultCode >>> 0;
		this.busFaultAddr = state.busFaultAddr >>> 0;
		this.busFaultAccess = state.busFaultAccess >>> 0;
		this.writeBusFaultSlots();
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
		if (isVramMappedContiguousRange(addr, 4)) {
			this.readVram(addr, this.vramReadScratch);
			const out = this.vramReadScratch;
			return (out[0] | (out[1] << 8) | (out[2] << 16) | (out[3] << 24)) >>> 0;
		}
		if (this.isVramRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_WORD);
			return 0;
		}
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			const handler = this.ioReadHandlers[slot];
			return handler !== null ? handler(addr) : this.ioSlots[slot];
		}
		if (this.isIoRegionRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_WORD);
			return 0;
		}
		if (this.isProgramRomRange(addr, 4)) {
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
		else if (addr >= RAM_BASE && addr + 4 <= RAM_END) {
			data = this.ram;
			offset = addr - RAM_BASE;
		}
		else {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_WORD);
			return 0;
		}
		return (
			data[offset]
			| (data[offset + 1] << 8)
			| (data[offset + 2] << 16)
			| (data[offset + 3] << 24)
		) >>> 0;
	}

	public writeValue(addr: number, value: Value): void {
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
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
		const slot = this.ioAlignedSlot(addr);
		if (slot < 0) {
			throw new Error(`I/O fault @ ${formatNumberAsHex(addr >>> 0, 8)}: invalid register.`);
		}
		this.ioSlots[slot] = value;
	}

	public writeMappedValue(addr: number, value: Value): void {
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			if (this.isLuaReadOnlyIoAddress(addr)) {
				this.raiseBusFault(BUS_FAULT_READ_ONLY, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_WORD);
				return;
			}
			this.ioSlots[slot] = value;
			const handler = this.ioWriteHandlers[slot];
			if (handler !== null) {
				handler(addr, value);
			}
			return;
		}
		if (this.isIoRegionRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_WORD);
			return;
		}
		if (isVramMappedContiguousRange(addr, 4)) {
			const word = value as number;
			this.vramScratch[0] = word & 0xff;
			this.vramScratch[1] = (word >>> 8) & 0xff;
			this.vramScratch[2] = (word >>> 16) & 0xff;
			this.vramScratch[3] = (word >>> 24) & 0xff;
			this.writeVram(addr, this.vramScratch);
			return;
		}
		if (this.isVramRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_WORD);
			return;
		}
		if (addr >= RAM_BASE && addr + 4 <= RAM_END) {
			const offset = addr - RAM_BASE;
			const word = value as number;
			this.ram[offset] = word & 0xff;
			this.ram[offset + 1] = (word >>> 8) & 0xff;
			this.ram[offset + 2] = (word >>> 16) & 0xff;
			this.ram[offset + 3] = (word >>> 24) & 0xff;
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_WORD);
	}

	public readU8(addr: number): number {
		if (this.isVramRange(addr, 1)) {
			throw new Error(`VRAM read fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write-only len=1.`);
		}
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
		if (addr >= RAM_BASE && addr < RAM_END) {
			return this.ram[addr - RAM_BASE];
		}
		throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: RAM range len=1.`);
	}

	public readMappedU8(addr: number): number {
		if (this.isVramRange(addr, 1)) {
			const out = this.vramReadScratch1;
			this.readVram(addr, out);
			return out[0];
		}
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			const handler = this.ioReadHandlers[slot];
			const value = handler !== null ? handler(addr) : this.ioSlots[slot];
			return (value as number) & 0xff;
		}
		if (this.isIoRegionRange(addr, 1)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
			return 0;
		}
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
		if (addr >= RAM_BASE && addr < RAM_END) {
			return this.ram[addr - RAM_BASE];
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8);
		return 0;
	}

	public writeU8(addr: number, value: number): void {
		if (this.isVramRange(addr, 1)) {
			this.vramScratch[0] = value & 0xff;
			this.vramScratch[1] = 0;
			this.vramScratch[2] = 0;
			this.vramScratch[3] = 0;
			this.writeVram(addr, this.vramScratch1);
			return;
		}
		if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr < OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			this.overlayRom[addr - OVERLAY_ROM_BASE] = value & 0xff;
			return;
		}
		const offset = this.resolveRamOffset(addr, 1);
		this.ram[offset] = value & 0xff;
	}

	public writeMappedU8(addr: number, value: number): void {
		if (this.isIoRegionRange(addr, 1)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8);
			return;
		}
		if (this.isVramRange(addr, 1)) {
			this.vramScratch[0] = value & 0xff;
			this.writeVram(addr, this.vramScratch1);
			return;
		}
		if (addr >= RAM_BASE && addr < RAM_END) {
			this.ram[addr - RAM_BASE] = value & 0xff;
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8);
	}

	public readIoU32(addr: number): number {
		const slot = this.ioAlignedSlot(addr);
		if (slot < 0) {
			throw new Error(`I/O read fault @ ${formatNumberAsHex(addr >>> 0, 8)}: invalid register.`);
		}
		const handler = this.ioReadHandlers[slot];
		const value = handler !== null ? handler(addr) : this.ioSlots[slot];
		return (value as number) >>> 0;
	}

	public readIoI32(addr: number): number {
		const slot = this.ioAlignedSlot(addr);
		if (slot < 0) {
			throw new Error(`I/O read fault @ ${formatNumberAsHex(addr >>> 0, 8)}: invalid register.`);
		}
		const handler = this.ioReadHandlers[slot];
		const value = handler !== null ? handler(addr) : this.ioSlots[slot];
		return (value as number) | 0;
	}

	public readU32(addr: number): number {
		if (this.isVramRange(addr, 4)) {
			throw new Error(`VRAM read fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write-only len=4.`);
		}
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
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: RAM range len=4.`);
		}
		return (
			data[offset]
			| (data[offset + 1] << 8)
			| (data[offset + 2] << 16)
			| (data[offset + 3] << 24)
		) >>> 0;
	}

	public readMappedU16LE(addr: number): number {
		if (isVramMappedContiguousRange(addr, 2)) {
			const out = this.vramReadScratch2;
			this.readVram(addr, out);
			return (out[0] | (out[1] << 8)) >>> 0;
		}
		if (this.isVramRange(addr, 2)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U16);
			return 0;
		}
		if (this.isIoRegionRange(addr, 2)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U16);
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
		else if (addr >= RAM_BASE && addr + 2 <= RAM_END) {
			data = this.ram;
			offset = addr - RAM_BASE;
		}
		else {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U16);
			return 0;
		}
		const b0 = data[offset];
		const b1 = data[offset + 1];
		return (b0 | (b1 << 8)) >>> 0;
	}

	public readMappedU32LE(addr: number): number {
		if (isVramMappedContiguousRange(addr, 4)) {
			this.readVram(addr, this.vramReadScratch);
			const out = this.vramReadScratch;
			return (out[0] | (out[1] << 8) | (out[2] << 16) | (out[3] << 24)) >>> 0;
		}
		if (this.isVramRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32);
			return 0;
		}
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			const handler = this.ioReadHandlers[slot];
			const value = handler !== null ? handler(addr) : this.ioSlots[slot];
			return (value as number) >>> 0;
		}
		if (this.isIoRegionRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32);
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
		else if (addr >= RAM_BASE && addr + 4 <= RAM_END) {
			data = this.ram;
			offset = addr - RAM_BASE;
		}
		else {
			this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32);
			return 0;
		}
		const b0 = data[offset];
		const b1 = data[offset + 1];
		const b2 = data[offset + 2];
		const b3 = data[offset + 3];
		return (b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) >>> 0;
	}

	public readMappedF32LE(addr: number): number {
		if (!this.isMappedReadableRange(addr, 4)) {
			const code = this.isIoRegionRange(addr, 4)
				? BUS_FAULT_UNALIGNED_IO
				: (this.isVramRange(addr, 4) ? BUS_FAULT_VRAM_RANGE : BUS_FAULT_UNMAPPED);
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
				: (this.isVramRange(addr, 8) ? BUS_FAULT_VRAM_RANGE : BUS_FAULT_UNMAPPED);
			this.raiseBusFault(code, addr, BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_F64);
			return 0;
		}
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
		if (this.isIoRegionRange(addr, 2)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U16);
			return;
		}
		if (isVramMappedContiguousRange(addr, 2)) {
			this.vramScratch[0] = value & 0xff;
			this.vramScratch[1] = (value >>> 8) & 0xff;
			this.writeVram(addr, this.vramScratch2);
			return;
		}
		if (this.isVramRange(addr, 2)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U16);
			return;
		}
		if (addr >= RAM_BASE && addr + 2 <= RAM_END) {
			const offset = addr - RAM_BASE;
			this.ram[offset] = value & 0xff;
			this.ram[offset + 1] = (value >>> 8) & 0xff;
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U16);
	}

	public writeMappedU32LE(addr: number, value: number): void {
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			if (this.isLuaReadOnlyIoAddress(addr)) {
				this.raiseBusFault(BUS_FAULT_READ_ONLY, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32);
				return;
			}
			const word = value >>> 0;
			this.ioSlots[slot] = word;
			const handler = this.ioWriteHandlers[slot];
			if (handler !== null) {
				handler(addr, word);
			}
			return;
		}
		if (this.isIoRegionRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32);
			return;
		}
		if (isVramMappedContiguousRange(addr, 4)) {
			this.vramScratch[0] = value & 0xff;
			this.vramScratch[1] = (value >>> 8) & 0xff;
			this.vramScratch[2] = (value >>> 16) & 0xff;
			this.vramScratch[3] = (value >>> 24) & 0xff;
			this.writeVram(addr, this.vramScratch);
			return;
		}
		if (this.isVramRange(addr, 4)) {
			this.raiseBusFault(BUS_FAULT_VRAM_RANGE, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32);
			return;
		}
		if (addr >= RAM_BASE && addr + 4 <= RAM_END) {
			const offset = addr - RAM_BASE;
			this.ram[offset] = value & 0xff;
			this.ram[offset + 1] = (value >>> 8) & 0xff;
			this.ram[offset + 2] = (value >>> 16) & 0xff;
			this.ram[offset + 3] = (value >>> 24) & 0xff;
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32);
	}

	public writeMappedF32LE(addr: number, value: number): void {
		if (!this.isMappedWritableRange(addr, 4)) {
			const code = this.isIoRegionRange(addr, 4)
				? (this.ioAlignedSlot(addr) >= 0 ? BUS_FAULT_READ_ONLY : BUS_FAULT_UNALIGNED_IO)
				: (this.isVramRange(addr, 4) ? BUS_FAULT_VRAM_RANGE : BUS_FAULT_UNMAPPED);
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
				: (this.isVramRange(addr, 8) ? BUS_FAULT_VRAM_RANGE : BUS_FAULT_UNMAPPED);
			this.raiseBusFault(code, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F64);
			return;
		}
		this.mappedFloatView.setFloat64(0, value, true);
		this.writeMappedU32LE(addr, this.mappedFloatView.getUint32(0, true));
		this.writeMappedU32LE(addr + 4, this.mappedFloatView.getUint32(4, true));
	}

	public readBytes(addr: number, length: number): Uint8Array {
		if (this.isVramRange(addr, length)) {
			throw new Error(`VRAM read fault @ ${formatNumberAsHex(addr >>> 0, 8)}: write-only len=${length}.`);
		}
		if (this.isProgramCodeReadableRange(addr, length)) {
			const offset = addr - PROGRAM_ROM_BASE;
			return this.programCode.subarray(offset, offset + length);
		}
		if (addr >= SYSTEM_ROM_BASE && addr + length <= SYSTEM_ROM_BASE + this.systemRom.byteLength) {
			const offset = addr - SYSTEM_ROM_BASE;
			return this.systemRom.subarray(offset, offset + length);
		}
		if (this.cartRom && addr >= CART_ROM_BASE && addr + length <= CART_ROM_BASE + this.cartRom.byteLength) {
			const offset = addr - CART_ROM_BASE;
			return this.cartRom.subarray(offset, offset + length);
		}
		if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr + length <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			const offset = addr - OVERLAY_ROM_BASE;
			return this.overlayRom.subarray(offset, offset + length);
		}
		const offset = this.resolveRamOffset(addr, length);
		return this.ram.subarray(offset, offset + length);
	}

	public isReadableMainMemoryRange(addr: number, length: number): boolean {
		return this.isProgramCodeReadableRange(addr, length)
			|| this.isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, this.systemRom.byteLength)
			|| (!!this.cartRom && this.isRangeWithinRegion(addr, length, CART_ROM_BASE, this.cartRom.byteLength))
			|| (!!this.overlayRom && this.isRangeWithinRegion(addr, length, OVERLAY_ROM_BASE, this.overlayRom.byteLength))
			|| this.isRangeWithinRegion(addr, length, RAM_BASE, RAM_END - RAM_BASE);
	}

	public isRamRange(addr: number, length: number): boolean {
		return this.isRangeWithinRegion(addr, length, RAM_BASE, RAM_END - RAM_BASE);
	}

	public writeBytes(addr: number, bytes: Uint8Array): void {
		if (this.isVramRange(addr, bytes.byteLength)) {
			this.writeVram(addr, bytes);
			return;
		}
		if (this.overlayRom && addr >= OVERLAY_ROM_BASE && addr + bytes.byteLength <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			this.overlayRom.set(bytes, addr - OVERLAY_ROM_BASE);
			return;
		}
		this.ram.set(bytes, this.resolveRamOffset(addr, bytes.byteLength));
	}

	public writeBytesFrom(src: Uint8Array, srcOffset: number, dstAddr: number, length: number): void {
		const slice = src.subarray(srcOffset, srcOffset + length);
		if (this.isVramRange(dstAddr, length)) {
			this.writeVram(dstAddr, slice);
			return;
		}
		if (this.overlayRom && dstAddr >= OVERLAY_ROM_BASE && dstAddr + length <= OVERLAY_ROM_BASE + this.overlayRom.byteLength) {
			this.overlayRom.set(slice, dstAddr - OVERLAY_ROM_BASE);
			return;
		}
		this.ram.set(slice, this.resolveRamOffset(dstAddr, length));
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

	private resolveRamOffset(addr: number, length: number): number {
		if (addr < RAM_BASE || addr + length > RAM_END) {
			throw new Error(`Bus fault @ ${formatNumberAsHex(addr >>> 0, 8)}: RAM range len=${length}.`);
		}
		return addr - RAM_BASE;
	}

	private isRangeWithinRegion(addr: number, length: number, base: number, size: number): boolean {
		return addr >= base && addr + length <= base + size;
	}

	private isLuaReadOnlyIoAddress(addr: number): boolean {
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
			return length === IO_WORD_SIZE && this.ioAlignedSlot(addr) >= 0 && !this.isLuaReadOnlyIoAddress(addr);
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
			return isVramMappedContiguousRange(addr, length);
		}
		return addr >= RAM_BASE && addr + length <= RAM_END;
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
		if (this.isVramRange(addr, length)) {
			return isVramMappedContiguousRange(addr, length);
		}
		return addr >= RAM_BASE && addr + length <= RAM_END;
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
