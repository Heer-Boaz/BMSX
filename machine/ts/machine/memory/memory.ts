import {
	CART_BUS_END,
	CART_MMIO_BASE,
	CART_MMIO_END,
	CART_RAM_END,
	CART_READ_ADDRESS_MASK,
	CART_READ_QUALIFIER,
	CART_READ_SLOT_SHIFT,
	CART_ROM_BASE,
	CART_ROM_END,
	CPU_RESET_BANK_ADDRESS, CPU_RESET_BANK_END, CPU_FIXED_FRAME_ADDRESS, CPU_FIXED_VALUE_END,
	CART_ROM_SIZE,
	IO_BASE,
	IO_WORD_SIZE,
	RAM_BASE,
	RAM_RECORD_WORD_MASK,
	MAIN_RAM_SIZE,
	SYSTEM_ROM_BASE,
	SYSTEM_ROM_SIZE,
} from '../../spec/bmsx/memory_map';
import { CartridgeController } from '../devices/cartridge/controller';
import { RomStorage } from './rom_storage';
import type { MemoryWordCounters } from './word_counters';
import type { CartridgeSocketMediaPair } from '../devices/cartridge/contracts';
import {
	DMA_BURST_WORD_CAPACITY,
	BUS_FAULT_ACCESS_READ,
	BUS_FAULT_ACCESS_F32,
	BUS_FAULT_ACCESS_F64,
	BUS_FAULT_ACCESS_U8,
	BUS_FAULT_ACCESS_U16,
	BUS_FAULT_ACCESS_U32,
	BUS_FAULT_ACCESS_VALUE,
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
	IO_CART_STATUS,
	IO_CART0_ROM_BYTE_COUNT,
	IO_CART1_ROM_BYTE_COUNT,
	IO_CART_ROM_BYTE_COUNT,
	IO_CART_RAM_BYTE_COUNT,
	IO_DMA0_STATUS,
	IO_DMA1_STATUS,
	IO_GEO_FAULT,
	IO_GEO_PROCESSED,
	IO_GEO_STATUS,
	IO_INP_KEYS,
	IO_INP_OUTPUT_PORT,
	IO_INP_OUTPUT_STATUS,
	IO_INP_STATUS,
	IO_IRQ_FLAGS,
	IO_IMGDEC_DECODED_WORD_COUNT,
	IO_IMGDEC_INPUT_WORDS_RECEIVED,
	IO_IMGDEC_STATUS,
	IO_SLOT_COUNT,
	IO_SYS_BUS_FAULT_ACCESS,
	IO_SYS_BUS_FAULT_ACK,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_BUS_FAULT_CODE,
	IO_SYS_FRAME_MS_Q16,
	IO_SYS_CYCLES_PER_FRAME,
	IO_SYS_STATUS,
	IO_SYS_ROM_BYTE_COUNT,
	IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS,
	IO_SYS_SUPERVISOR_FAULT_CAUSE,
	IO_SYS_SUPERVISOR_FAULT_DOMAIN,
	IO_SYS_SUPERVISOR_FAULT_EPC,
	IO_SYS_SUPERVISOR_FAULT_LUA_REASON,
	IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
	IO_SYS_TIME_MS,
} from '../../spec/bmsx/io';
import { VALUE_MEMORY_SIZE, VALUE_MEMORY_TAG_OFFSET } from '../../spec/blua32/memory_access_kind';
import { readLE16, readLE32, writeLE16, writeLE32 } from '../../common/endian';
import {
	MAPPED_BUS_INSTRUCTION_FETCH,
	MAPPED_BUS_MASTER_CPU,
	MAPPED_BUS_MASTER_DMA,
	MAPPED_BUS_DMA_MEMORY,
	MAPPED_BUS_DMA_BLOCK_END,
	mappedBusSignalsForCartridgeSlot,
	type MappedBusSignals,
} from './bus_signals';
import {
	MAPPED_PAGE_BYTE_SHIFT,
	MAPPED_PAGE_BYTE_SIZE,
	type MappedPageBinding,
	type MappedPageInvalidator,
	MappedPageWriteWatches,
} from './mapped_page';

export type { MappedPageBinding, MappedPageInvalidator } from './mapped_page';

export const enum MemoryRegionKind { Ram, SystemRom, Cartridge, Io, Other }

const BUS_ACCESS_READ_WORD = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_WORD;
const BUS_ACCESS_WRITE_WORD = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_WORD;
const BUS_ACCESS_READ_U8 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U8;
const BUS_ACCESS_WRITE_U8 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8;
const BUS_ACCESS_READ_U16 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U16;
const BUS_ACCESS_READ_U32 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_U32;
const BUS_ACCESS_READ_F32 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_F32;
const BUS_ACCESS_READ_F64 = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_F64;
const BUS_ACCESS_WRITE_U16 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U16;
const BUS_ACCESS_WRITE_U32 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U32;
const BUS_ACCESS_WRITE_F32 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F32;
const BUS_ACCESS_WRITE_F64 = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_F64;
const BUS_ACCESS_READ_VALUE = BUS_FAULT_ACCESS_READ | BUS_FAULT_ACCESS_VALUE;
const BUS_ACCESS_WRITE_VALUE = BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_VALUE;

// Decode the physical IO word permissions once, not on every DMA/CPU write.
const READ_ONLY_IO_SLOTS = new Uint8Array(IO_SLOT_COUNT);
READ_ONLY_IO_SLOTS.fill(1, (IO_INP_KEYS - IO_BASE) >>> 2, (IO_INP_OUTPUT_PORT - IO_BASE) >>> 2);
for (const address of [
	IO_SYS_BUS_FAULT_CODE,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_BUS_FAULT_ACCESS,
	IO_SYS_TIME_MS,
	IO_SYS_FRAME_MS_Q16,
	IO_SYS_CYCLES_PER_FRAME,
	IO_SYS_STATUS,
	IO_SYS_ROM_BYTE_COUNT,
	IO_IRQ_FLAGS,
	IO_DMA0_STATUS,
	IO_DMA1_STATUS,
	IO_IMGDEC_STATUS,
	IO_IMGDEC_INPUT_WORDS_RECEIVED,
	IO_IMGDEC_DECODED_WORD_COUNT,
	IO_GEO_STATUS,
	IO_GEO_PROCESSED,
	IO_GEO_FAULT,
	IO_INP_STATUS,
	IO_INP_OUTPUT_STATUS,
	IO_APU_STATUS,
	IO_APU_FAULT_CODE,
	IO_APU_FAULT_DETAIL,
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SLOT,
	IO_APU_EVENT_SOURCE_ADDR,
	IO_APU_EVENT_SEQ,
	IO_APU_SELECTED_SOURCE_ADDR,
	IO_APU_ACTIVE_MASK,
	IO_CART_STATUS,
	IO_CART0_ROM_BYTE_COUNT,
	IO_CART1_ROM_BYTE_COUNT,
	IO_CART_ROM_BYTE_COUNT,
	IO_CART_RAM_BYTE_COUNT,
	IO_SYS_SUPERVISOR_FAULT_SEQUENCE,
	IO_SYS_SUPERVISOR_FAULT_CAUSE,
	IO_SYS_SUPERVISOR_FAULT_EPC,
	IO_SYS_SUPERVISOR_FAULT_BAD_ADDRESS,
	IO_SYS_SUPERVISOR_FAULT_LUA_REASON,
	IO_SYS_SUPERVISOR_FAULT_DOMAIN,
]) READ_ONLY_IO_SLOTS[(address - IO_BASE) >>> 2] = 1;

export type IoReadHandler<TContext> = (context: TContext, addr: number, busSignals: MappedBusSignals) => number;
export type IoWriteHandler<TContext> = (context: TContext, addr: number, value: number, busSignals: MappedBusSignals) => void;
export type IoWriteReadyHandler<TContext> = (
	context: TContext,
	addr: number,
	busSignals: MappedBusSignals,
) => boolean;
// Prefix callbacks apply only end-silent FIFO/latch/counter effects of a
// scheduler-admitted block; the ending scalar read -> ready -> write still
// performs all boundary work. A reader supplies a contiguous range retained
// through the synchronous prefix write.
export type DmaWordView = { words: Uint32Array; first: number };
export type IoDmaReadPrefixHandler<T> = (context: T, view: DmaWordView, count: number) => void;
export type IoDmaWritePrefixHandler<T> = (context: T, words: Uint32Array, first: number, count: number) => void;
export type IoDmaMappedWritePrefixHandler<T> = (context: T, view: Readonly<MemoryByteView>) => void;
type IoDmaPrefixBinding = {
	slot: number;
	read: IoDmaReadPrefixHandler<unknown> | null;
	write: IoDmaWritePrefixHandler<unknown> | null;
	mappedWrite: IoDmaMappedWritePrefixHandler<unknown> | null;
};
type StoredIoReadHandler = (context: unknown, addr: number, busSignals: MappedBusSignals) => number;
type StoredIoWriteHandler = (context: unknown, addr: number, value: number, busSignals: MappedBusSignals) => void;
type StoredIoWriteReadyHandler = (
	context: unknown,
	addr: number,
	busSignals: MappedBusSignals,
) => boolean;

export type MemoryBusState = {
	ramBusEnd: number;
	busFaultCode: number;
	busFaultAddr: number;
	busFaultAccess: number;
};

export type MemorySaveState = MemoryBusState & { ram: Uint8Array };

export type MemoryByteView = {
	bytes: Uint8Array;
	byteOffset: number;
	byteLength: number;
};

export type MemoryInit = {
	systemRom: Uint8Array;
	cartridgeSlots: CartridgeSocketMediaPair;
};

export const NO_BLOCKED_MAPPED_WRITE = 0xffffffff;

export const enum IoWriteStorage { Retained, Device }

export class Memory {
	private readonly systemRom: RomStorage;
	public readonly cartridgeController: CartridgeController;
	private readonly ramBacking: WebAssembly.Memory;
	private readonly ram: Uint8Array;
	private busEnd: number;
	public readonly ramView: DataView;
	// Little-endian word view of the same storage for runtime-owned RAM records.
	// Same physical bytes through the aligned native word port.
	public readonly ramWords: Uint32Array;
	public readonly ramFloats: Float32Array;
	private readonly ramPageWriteWatches: MappedPageWriteWatches;
	private readonly ramByteWriteObservers = new Set<(offset: number) => void>();
	private mappedPageInvalidator: MappedPageInvalidator | null = null;
	private readonly ioSlots: Uint32Array;
	private readonly ioReadContexts: unknown[];
	private readonly ioWriteContexts: unknown[];
	private readonly ioReadHandlers: Array<StoredIoReadHandler | null>;
	private readonly ioWriteHandlers: Array<StoredIoWriteHandler | null>;
	private readonly ioWriteReadyHandlers: Array<StoredIoWriteReadyHandler | null>;
	private readonly ioDmaPrefixes: IoDmaPrefixBinding[] = [];
	private readonly ioWriteStorage = new Uint8Array(IO_SLOT_COUNT);
	private readonly dmaPrefixWords = new Uint32Array(DMA_BURST_WORD_CAPACITY);
	private readonly dmaWordView: DmaWordView = { words: this.dmaPrefixWords, first: 0 };
	private readonly dmaRomView: MemoryByteView;
	private readonly ioByteLength = IO_SLOT_COUNT * IO_WORD_SIZE;
	private readonly busFaultCodeSlot = (IO_SYS_BUS_FAULT_CODE - IO_BASE) / IO_WORD_SIZE;
	private readonly busFaultAddrSlot = (IO_SYS_BUS_FAULT_ADDR - IO_BASE) / IO_WORD_SIZE;
	private readonly busFaultAccessSlot = (IO_SYS_BUS_FAULT_ACCESS - IO_BASE) / IO_WORD_SIZE;
	private readonly busFaultAckSlot = (IO_SYS_BUS_FAULT_ACK - IO_BASE) / IO_WORD_SIZE;
	private readonly mappedFloatBuffer = new ArrayBuffer(8);
	private readonly mappedFloatView = new DataView(this.mappedFloatBuffer);
	private busFaultCode = BUS_FAULT_NONE;
	private busFaultAddr = 0;
	private busFaultAccess = 0;
	private busFaultSequence = 0;

	public constructor(init: MemoryInit, ramByteCount: number) {
		this.systemRom = new RomStorage(init.systemRom);
		this.dmaRomView = { bytes: init.systemRom, byteOffset: 0, byteLength: 0 };
		this.cartridgeController = new CartridgeController(init.cartridgeSlots);
		// Reserve the host write-watch plane beyond the physical RAM aperture.
		const pages = (MAIN_RAM_SIZE >>> 16) + 1;
		this.ramBacking = new WebAssembly.Memory({ initial: pages, maximum: pages });
		const buffer = this.ramBacking.buffer;
		this.ram = new Uint8Array(buffer, 0, ramByteCount);
		this.busEnd = RAM_BASE + ramByteCount;
		this.ramView = new DataView(buffer, 0, ramByteCount);
		this.ramWords = new Uint32Array(buffer, 0, ramByteCount >>> 2);
		this.ramFloats = new Float32Array(buffer, 0, ramByteCount >>> 2);
		this.ramPageWriteWatches = new MappedPageWriteWatches(ramByteCount, buffer, MAIN_RAM_SIZE, offset => {
			for (const observer of this.ramByteWriteObservers) observer(offset);
		});
		this.ioSlots = new Uint32Array(IO_SLOT_COUNT);
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
		this.mapIoRead(IO_SYS_ROM_BYTE_COUNT, this, Memory.readSystemRomByteCountThunk);
		this.ioWriteContexts[this.busFaultAckSlot] = this;
		this.ioWriteHandlers[this.busFaultAckSlot] = Memory.onBusFaultAckWriteThunk;
		this.clearBusFault();
	}

	public ramData(): Uint8Array {
		return this.ram;
	}

	public ramByteCount(): number {
		return this.ram.byteLength;
	}


	public ramWriteWatches(): MappedPageWriteWatches { return this.ramPageWriteWatches; }

	/** Physical offsets, independent of the CPU bus aperture and fetch watches. */
	public watchRamByte(offset: number): void { this.ramPageWriteWatches.watchByte(offset); }
	public unwatchRamByte(offset: number): void { this.ramPageWriteWatches.unwatchByte(offset); }

	/** Observe each armed byte synchronously after a store. RAM replacement is not a store. */
	public onRamWrite(observer: (offset: number) => void): () => void {
		this.ramByteWriteObservers.add(observer);
		return () => { this.ramByteWriteObservers.delete(observer); };
	}

	// The CPU record port addresses physical RAM, including bytes under MMIO.
	public readRamRecordWord(address: number): number {
		return this.ramWords[(address & RAM_RECORD_WORD_MASK) >>> 2];
	}

	public writeRamRecordWord(address: number, value: number): void {
		const offset = address & RAM_RECORD_WORD_MASK;
		this.ramWords[offset >>> 2] = value;
		if (this.ramPageWriteWatches.groupData()[offset >>> MAPPED_PAGE_BYTE_SHIFT] !== 0) {
			this.invalidateRamWrite(offset, 4);
		}
	}

	public writeRamRecordPair(address: number, first: number, second: number): void {
		const offset = address & (MAIN_RAM_SIZE - 8);
		const word = offset >>> 2;
		this.ramWords[word] = first;
		this.ramWords[word + 1] = second;
		if (this.ramPageWriteWatches.groupData()[offset >>> MAPPED_PAGE_BYTE_SHIFT] !== 0) {
			this.invalidateRamWrite(offset, 8);
		}
	}

	public readRamRecordByte(address: number): number {
		return this.ram[address & (MAIN_RAM_SIZE - 1)];
	}
	public writeRamRecordByte(address: number, value: number): void {
		const offset = address & (MAIN_RAM_SIZE - 1);
		this.ram[offset] = value;
		if (this.ramPageWriteWatches.groupData()[offset >>> MAPPED_PAGE_BYTE_SHIFT] !== 0) {
			this.invalidateRamWrite(offset, 1);
		}
	}

	// Private writes still notify the physical watches but cannot retire code.
	public invalidateRamWrite(offset: number, byteLength: number): void {
		const watches = this.ramPageWriteWatches;
		if (offset < this.busEnd - RAM_BASE) watches.invalidateWrite(offset, byteLength, RAM_BASE, this.mappedPageInvalidator!);
		else if (watches.tracksPrivateWrites()) watches.invalidatePrivateWrite(offset, byteLength);
	}

	// The register planes have separate physical extents but share one
	// private write-watch admission. Public aliases must still retire exact words.
	public invalidateRamWritePair(first: number, firstBytes: number, second: number, secondBytes: number): void {
		const privateStart = this.busEnd - RAM_BASE;
		if (first < privateStart || second < privateStart) {
			this.invalidateRamWrite(first, firstBytes);
			this.invalidateRamWrite(second, secondBytes);
		} else {
			const watches = this.ramPageWriteWatches;
			if (watches.tracksPrivateWrites()) {
				watches.invalidatePrivateWrite(first, firstBytes);
				watches.invalidatePrivateWrite(second, secondBytes);
			}
		}
	}

	public systemRomStorage(): RomStorage { return this.systemRom; }

	private static readSystemRomByteCountThunk(memory: Memory): number {
		return memory.systemRom.bytes.byteLength;
	}

	public installSystemRom(rom: Uint8Array): void {
		this.systemRom.install(rom);
		if (this.mappedPageInvalidator !== null) {
			this.mappedPageInvalidator.invalidateMappedRange(SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE);
		}
	}

	public attachMappedPageInvalidator(invalidator: MappedPageInvalidator): void {
		this.mappedPageInvalidator = invalidator;
		this.cartridgeController.attachMappedPageInvalidator(invalidator);
	}

	public clearMappedPageWriteWatches(): void {
		this.ramPageWriteWatches.clear();
		this.cartridgeController.clearMappedPageWriteWatches();
	}

	public ramBusEnd(): number { return this.busEnd; }

	public setRamBusEnd(end: number): void {
		const old = this.busEnd;
		this.busEnd = end;
		// The old range no longer supplies instruction words.
		if (end < old) this.ramPageWriteWatches.clearCodeRange(end - RAM_BASE, old - end);
		if (old !== end) this.mappedPageInvalidator?.invalidateMappedRange(Math.min(old, end), Math.max(old, end));
	}

	public bindMappedPage(addr: number, busSignals: MappedBusSignals, out: MappedPageBinding): void {
		out.key = addr;
		out.readBytes = null;
		out.readByteOffset = 0;
		out.writeWatches = null;
		out.writeWatchIndex = 0;
		if (addr < RAM_BASE) {
			out.cacheable = addr + 4 <= this.systemRom.bytes.byteLength;
			if (addr + MAPPED_PAGE_BYTE_SIZE <= this.systemRom.bytes.byteLength) {
				out.readBytes = this.systemRom.bytes;
				out.readByteOffset = addr;
			}
			return;
		}
		if (addr < CART_ROM_BASE) {
			if (addr < IO_BASE + this.ioByteLength) {
				out.cacheable = false;
				return;
			}
			const offset = addr - RAM_BASE;
			if (offset < this.ram.byteLength) {
				out.cacheable = true;
				if (this.isRamRange(addr, MAPPED_PAGE_BYTE_SIZE)) {
					out.readBytes = this.ram;
					out.readByteOffset = offset;
				}
				this.ramPageWriteWatches.bind(offset, out);
				return;
			}
			out.cacheable = false;
			return;
		}
		if (addr < CART_BUS_END) {
			this.cartridgeController.bindMappedPage(addr, busSignals, out);
			return;
		}
		out.cacheable = false;
	}

	public mapIoRead<TContext>(addr: number, context: TContext, handler: IoReadHandler<TContext>): void {
		const slot = (addr - IO_BASE) / IO_WORD_SIZE;
		this.ioReadContexts[slot] = context;
		this.ioReadHandlers[slot] = handler as StoredIoReadHandler;
		const prefix = this.findIoDmaPrefix(slot);
		if (prefix !== null) prefix.read = null;
	}

	public mapIoWrite<TContext>(addr: number, context: TContext, handler: IoWriteHandler<TContext>, storage = IoWriteStorage.Retained): void {
		const slot = (addr - IO_BASE) / IO_WORD_SIZE;
		this.ioWriteStorage[slot] = storage;
		this.ioWriteContexts[slot] = context;
		this.ioWriteHandlers[slot] = handler as StoredIoWriteHandler;
		const prefix = this.findIoDmaPrefix(slot);
		if (prefix !== null) {
			prefix.write = null;
			prefix.mappedWrite = null;
		}
	}

	public mapIoWriteReady<TContext>(addr: number, handler: IoWriteReadyHandler<TContext>): void {
		const slot = (addr - IO_BASE) / IO_WORD_SIZE;
		this.ioWriteReadyHandlers[slot] = handler as StoredIoWriteReadyHandler;
		const prefix = this.findIoDmaPrefix(slot);
		if (prefix !== null) {
			prefix.write = null;
			prefix.mappedWrite = null;
		}
	}

	private findIoDmaPrefix(slot: number): IoDmaPrefixBinding | null {
		const prefixes = this.ioDmaPrefixes;
		for (let i = 0; i < prefixes.length; ++i) if (prefixes[i].slot === slot) return prefixes[i];
		return null;
	}

	public mapIoDmaReadPrefix<T>(address: number, handler: IoDmaReadPrefixHandler<T> | null): void {
		const slot = (address - IO_BASE) / IO_WORD_SIZE, prefix = this.findIoDmaPrefix(slot);
		if (prefix !== null) prefix.read = handler as IoDmaReadPrefixHandler<unknown>;
		else if (handler !== null) this.ioDmaPrefixes.push({ slot, read: handler as IoDmaReadPrefixHandler<unknown>, write: null, mappedWrite: null });
	}

	public mapIoDmaWritePrefix<T>(address: number, handler: IoDmaWritePrefixHandler<T> | null): void {
		const slot = (address - IO_BASE) / IO_WORD_SIZE, prefix = this.findIoDmaPrefix(slot);
		if (prefix !== null) prefix.write = handler as IoDmaWritePrefixHandler<unknown>;
		else if (handler !== null) this.ioDmaPrefixes.push({ slot, read: null, write: handler as IoDmaWritePrefixHandler<unknown>, mappedWrite: null });
	}

	public mapIoDmaMappedWritePrefix<T>(address: number, handler: IoDmaMappedWritePrefixHandler<T> | null): void {
		const slot = (address - IO_BASE) / IO_WORD_SIZE, prefix = this.findIoDmaPrefix(slot);
		if (prefix !== null) prefix.mappedWrite = handler as IoDmaMappedWritePrefixHandler<unknown>;
		else if (handler !== null) this.ioDmaPrefixes.push({ slot, read: null, write: null, mappedWrite: handler as IoDmaMappedWritePrefixHandler<unknown> });
	}

	public mappedWriteReady(addr: number): boolean {
		const slot = this.ioAlignedSlot(addr);
		if (slot < 0) return true;
		const handler = this.ioWriteReadyHandlers[slot];
		return handler === null || handler(this.ioWriteContexts[slot], addr, MAPPED_BUS_MASTER_CPU);
	}

	public firstBlockedMappedWordWrite(addr: number, wordCount: number): number {
		if (wordCount === 0) return NO_BLOCKED_MAPPED_WRITE;
		const lastAddress = addr + (wordCount - 1) * IO_WORD_SIZE;
		const ioEnd = IO_BASE + this.ioByteLength;
		if (lastAddress < IO_BASE || addr >= ioEnd) return NO_BLOCKED_MAPPED_WRITE;
		let writeAddress = addr < IO_BASE ? IO_BASE : addr;
		while (writeAddress <= lastAddress && writeAddress < ioEnd) {
			const slot = (writeAddress - IO_BASE) / IO_WORD_SIZE;
			const handler = this.ioWriteReadyHandlers[slot];
			if (handler !== null && !handler(this.ioWriteContexts[slot], writeAddress, MAPPED_BUS_MASTER_CPU)) {
				return writeAddress;
			}
			writeAddress += IO_WORD_SIZE;
		}
		return NO_BLOCKED_MAPPED_WRITE;
	}

	public readBusFaultSequence(): number {
		return this.busFaultSequence;
	}

	public captureSaveState(ram: Uint8Array = new Uint8Array(this.ram.byteLength)): MemorySaveState {
		ram.set(this.ram);
		return { ...this.captureBusState(), ram };
	}

	public restoreSaveState(state: MemorySaveState): void {
		this.ram.set(state.ram);
		this.restoreBusState(state);
	}

	public captureBusState(): MemoryBusState {
		return {
			ramBusEnd: this.busEnd,
			busFaultCode: this.busFaultCode,
			busFaultAddr: this.busFaultAddr,
			busFaultAccess: this.busFaultAccess,
		};
	}

	public restoreBusState(state: MemoryBusState): void {
		this.busEnd = state.ramBusEnd;
		if (this.mappedPageInvalidator !== null) {
			this.mappedPageInvalidator.invalidateMappedRange(
				RAM_BASE,
				RAM_BASE + this.ram.byteLength,
			);
		}
		this.busFaultCode = state.busFaultCode >>> 0;
		this.busFaultAddr = state.busFaultAddr >>> 0;
		this.busFaultAccess = state.busFaultAccess >>> 0;
		this.writeBusFaultSlots();
	}

	private readQualifiedCartridge(addr: number, width: 1 | 2 | 4, cpuProtected: boolean): number | null {
		if ((addr & CART_READ_QUALIFIER) === 0) return null;
		const address = addr & CART_READ_ADDRESS_MASK;
		if (address < CART_ROM_BASE || address > (cpuProtected ? CART_RAM_END : CART_ROM_END) - width) return null;
		const signals = mappedBusSignalsForCartridgeSlot(addr >>> CART_READ_SLOT_SHIFT);
		const controller = this.cartridgeController;
		switch (width) {
			case 1: return controller.readU8(address, signals);
			case 2: return controller.readU16(address, signals);
			case 4: return controller.readU32(address, signals);
		}
	}

	private readMainMemoryU8(addr: number, faultAccess: number, cpuProtected = false): number {
		if (addr < RAM_BASE) {
			if (addr < this.systemRom.bytes.byteLength) return this.systemRom.bytes[addr];
		} else if (addr < CART_ROM_BASE) {
			const offset = addr - RAM_BASE;
			if (this.isRamRange(addr, 1, cpuProtected)) {
				return this.ram[offset];
			}
		} else if (addr < CART_BUS_END) {
			const value = this.cartridgeController.readU8(addr, MAPPED_BUS_MASTER_CPU);
			if (value !== null) return value;
		} else {
			const value = this.readQualifiedCartridge(addr, 1, cpuProtected);
			if (value !== null) return value;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
		return 0;
	}

	private readIoSlot(slot: number, addr: number, busSignals: MappedBusSignals): number {
		const handler = this.ioReadHandlers[slot];
		return handler !== null ? handler(this.ioReadContexts[slot], addr, busSignals) : this.ioSlots[slot];
	}

	private writeIoSlot(slot: number, addr: number, value: number, faultAccess: number, busSignals: MappedBusSignals): void {
		if (READ_ONLY_IO_SLOTS[slot] !== 0) {
			this.raiseBusFault(BUS_FAULT_READ_ONLY, addr, faultAccess);
			return;
		}
		const word = value >>> 0;
		const writeReady = this.ioWriteReadyHandlers[slot];
		if ((busSignals & MAPPED_BUS_MASTER_DMA) !== 0
			&& writeReady !== null
			&& !writeReady(this.ioWriteContexts[slot], addr, busSignals)) {
			return;
		}
		if (this.ioWriteStorage[slot] === IoWriteStorage.Retained) this.ioSlots[slot] = word;
		const handler = this.ioWriteHandlers[slot];
		if (handler !== null) {
			handler(this.ioWriteContexts[slot], addr, word, busSignals);
		}
	}

	private writeRamU8(addr: number, value: number, cpuProtected = false): boolean {
		if (!this.isRamRange(addr, 1, cpuProtected)) return false;
		const offset = addr - RAM_BASE;
		this.ram[offset] = value & 0xff;
		this.ramPageWriteWatches.invalidateWrite(offset, 1, RAM_BASE, this.mappedPageInvalidator!);
		return true;
	}

	private writeRamWordLE(addr: number, byteLength: 2 | 4, value: number, cpuProtected = false): boolean {
		if (!this.isRamRange(addr, byteLength, cpuProtected)) return false;
		const offset = addr - RAM_BASE;
		if (byteLength === 2) {
			writeLE16(this.ram, offset, value);
		} else {
			writeLE32(this.ram, offset, value);
		}
		this.ramPageWriteWatches.invalidateWrite(
			offset,
			byteLength,
			RAM_BASE,
			this.mappedPageInvalidator!,
		);
		return true;
	}

	public clearIoSlots(): void {
		this.ioSlots.fill(0);
		this.clearBusFault();
	}

	public clearBusFault(): void {
		this.busFaultCode = BUS_FAULT_NONE;
		this.busFaultAddr = 0;
		this.busFaultAccess = 0;
		this.writeBusFaultSlots();
	}

	public readMappedWord(addr: number, cpuProtected = false): number {
		return this.readMappedBusU32LE(addr, MAPPED_BUS_MASTER_CPU, BUS_ACCESS_READ_WORD, cpuProtected);
	}

	public writeIoU32(addr: number, value: number): void {
		this.ioSlots[(addr - IO_BASE) / IO_WORD_SIZE] = value;
	}

	public writeMappedWord(addr: number, value: number, cpuProtected = false): void {
		this.writeMappedBusU32LE(addr, value, MAPPED_BUS_MASTER_CPU, BUS_ACCESS_WRITE_WORD, cpuProtected);
	}

	public readU8(addr: number): number {
		return this.readMainMemoryU8(addr, BUS_ACCESS_READ_U8);
	}

	public readMappedU8(addr: number, cpuProtected = false): number {
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			return this.readIoSlot(slot, addr, MAPPED_BUS_MASTER_CPU) & 0xff;
		}
		if (this.isIoRegionRange(addr, 1)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U8);
			return 0;
		}
		return this.readMainMemoryU8(addr, BUS_ACCESS_READ_U8, cpuProtected);
	}

	public writeU8(addr: number, value: number): void {
		if (addr < CART_ROM_BASE) {
			if (this.writeRamU8(addr, value)) {
				return;
			}
		} else if (addr < CART_BUS_END) {
			if (this.cartridgeController.writeU8(addr, value, MAPPED_BUS_MASTER_CPU)) return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U8);
	}

	public writeMappedU8(addr: number, value: number, cpuProtected = false): void {
		if (this.isIoRegionRange(addr, 1)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_WRITE_U8);
			return;
		}
		if (addr < CART_ROM_BASE) {
			if (this.writeRamU8(addr, value, cpuProtected)) {
				return;
			}
		} else if (addr < CART_BUS_END) {
			if (this.cartridgeController.writeU8(addr, value, MAPPED_BUS_MASTER_CPU)) return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U8);
	}

	public readIoU32(addr: number): number {
		return this.readIoSlot((addr - IO_BASE) / IO_WORD_SIZE, addr, MAPPED_BUS_MASTER_CPU);
	}

	public readU32(addr: number, counters: MemoryWordCounters | null = null): number {
		if (addr < RAM_BASE) {
			if (addr + 4 <= this.systemRom.bytes.byteLength) {
				if (counters !== null) counters.systemRomWords = (counters.systemRomWords + 1) >>> 0;
				return readLE32(this.systemRom.bytes, addr);
			}
		} else if (addr < CART_ROM_BASE) {
			const offset = addr - RAM_BASE;
			if (this.isRamRange(addr, 4)) {
				if (counters !== null) counters.ramWords = (counters.ramWords + 1) >>> 0;
				return readLE32(this.ram, offset);
			}
		} else if (addr <= CART_BUS_END - 4) {
			const value = this.cartridgeController.readU32(addr, MAPPED_BUS_MASTER_CPU);
			if (value !== null) {
				if (counters !== null) counters.cartridgeWords = (counters.cartridgeWords + 1) >>> 0;
				return value;
			}
		}
		if (counters !== null) counters.otherWords = (counters.otherWords + 1) >>> 0;
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U32);
		return 0;
	}

	public readMappedU16LE(addr: number, cpuProtected = false): number {
		if (this.isIoRegionRange(addr, 2)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_READ_U16);
			return 0;
		}
		if (addr < RAM_BASE) {
			if (addr + 2 <= this.systemRom.bytes.byteLength) {
				return readLE16(this.systemRom.bytes, addr);
			}
		} else if (addr < CART_ROM_BASE) {
			const ramOffset = addr - RAM_BASE;
			if (this.isRamRange(addr, 2, cpuProtected)) {
				return readLE16(this.ram, ramOffset);
			}
		} else if (addr <= CART_BUS_END - 2) {
			const value = this.cartridgeController.readU16(addr, MAPPED_BUS_MASTER_CPU);
			if (value !== null) return value;
		} else {
			const value = this.readQualifiedCartridge(addr, 2, cpuProtected);
			if (value !== null) return value;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U16);
		return 0;
	}

	public readMappedU32LE(addr: number, faultAccess = BUS_ACCESS_READ_U32, cpuProtected = false): number {
		return this.readMappedBusU32LE(addr, MAPPED_BUS_MASTER_CPU, faultAccess, cpuProtected);
	}


	public readMappedBusU32LE(
		addr: number,
		busSignals: MappedBusSignals,
		faultAccess = BUS_ACCESS_READ_U32,
		cpuProtected = false,
	): number {
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			if ((busSignals & (MAPPED_BUS_INSTRUCTION_FETCH | MAPPED_BUS_DMA_MEMORY)) !== 0) {
				this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
				return 0;
			}
			return this.readIoSlot(slot, addr, busSignals);
		}
		if (this.isIoRegionRange(addr, 4)) {
			this.raiseBusFault((busSignals & (MAPPED_BUS_INSTRUCTION_FETCH | MAPPED_BUS_DMA_MEMORY)) !== 0
				? BUS_FAULT_UNMAPPED : BUS_FAULT_UNALIGNED_IO, addr, faultAccess);
			return 0;
		}
		if (addr < RAM_BASE) {
			if (addr + 4 <= this.systemRom.bytes.byteLength) {
				return readLE32(this.systemRom.bytes, addr);
			}
		} else if (addr < CART_ROM_BASE) {
			const ramOffset = addr - RAM_BASE;
			if (this.isRamRange(addr, 4, cpuProtected)) {
				return readLE32(this.ram, ramOffset);
			}
		} else if (addr <= CART_BUS_END - 4) {
			if (addr >= CART_MMIO_BASE && (busSignals & MAPPED_BUS_INSTRUCTION_FETCH) !== 0) {
				this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
				return 0;
			}
			const value = this.cartridgeController.readU32(addr, busSignals);
			if (value !== null) return value;
		} else if ((busSignals & (MAPPED_BUS_INSTRUCTION_FETCH | MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_MEMORY)) === 0) {
			const value = this.readQualifiedCartridge(addr, 4, cpuProtected);
			if (value !== null) return value;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
		return 0;
	}

	public readMappedF32LE(addr: number): number {
		this.mappedFloatView.setUint32(0, this.readMappedU32LE(addr, BUS_ACCESS_READ_F32), true);
		return this.mappedFloatView.getFloat32(0, true);
	}

	public readMappedF64LE(addr: number, cpuProtected = false): number {
		const faultSequence = this.busFaultSequence;
		this.mappedFloatView.setUint32(0, this.readMappedU32LE(addr, BUS_ACCESS_READ_F64, cpuProtected), true);
		if (this.busFaultSequence !== faultSequence) {
			return 0;
		}
		this.mappedFloatView.setUint32(4, this.readMappedU32LE(addr + 4, BUS_ACCESS_READ_F64, cpuProtected), true);
		if (this.busFaultSequence !== faultSequence) {
			return 0;
		}
		return this.mappedFloatView.getFloat64(0, true);
	}

	public writeU32(addr: number, value: number): void {
		if (addr < CART_ROM_BASE) {
			if (this.writeRamWordLE(addr, 4, value)) {
				return;
			}
		} else if (addr <= CART_BUS_END - 4) {
			if (this.cartridgeController.writeU32(addr, value, MAPPED_BUS_MASTER_CPU)) return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U32);
	}

	public countRawWriteU32(addr: number, counters: MemoryWordCounters): void {
		if (addr < CART_ROM_BASE) {
			if (this.isRamRange(addr, IO_WORD_SIZE)) { counters.ramWords = (counters.ramWords + 1) >>> 0; return; }
			if (addr <= SYSTEM_ROM_SIZE - IO_WORD_SIZE) { counters.systemRomWords = (counters.systemRomWords + 1) >>> 0; return; }
		} else if (addr <= CART_BUS_END - IO_WORD_SIZE) {
			counters.cartridgeWords = (counters.cartridgeWords + 1) >>> 0;
			return;
		}
		counters.otherWords = (counters.otherWords + 1) >>> 0;
	}

	public writeMappedU16LE(addr: number, value: number, cpuProtected = false): void {
		if (this.isIoRegionRange(addr, 2)) {
			this.raiseBusFault(BUS_FAULT_UNALIGNED_IO, addr, BUS_ACCESS_WRITE_U16);
			return;
		}
		if (addr < CART_ROM_BASE) {
			if (this.writeRamWordLE(addr, 2, value, cpuProtected)) {
				return;
			}
		} else if (addr <= CART_BUS_END - 2) {
			if (this.cartridgeController.writeU16(addr, value, MAPPED_BUS_MASTER_CPU)) return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_WRITE_U16);
	}

	public writeMappedU32LE(addr: number, value: number, faultAccess = BUS_ACCESS_WRITE_U32, cpuProtected = false): void {
		this.writeMappedBusU32LE(addr, value, MAPPED_BUS_MASTER_CPU, faultAccess, cpuProtected);
	}

	// Fixed I/O slots are resolved once; live handlers and per-word bus effects remain ordered.
	public transferDmaBlock(readAddress: number, writeAddress: number, wordCount: number,
		readStep: number, writeStep: number, readBusSignals: MappedBusSignals, writeBusSignals: MappedBusSignals): void {
		if (wordCount !== 0 && readStep === IO_WORD_SIZE && writeStep === IO_WORD_SIZE) {
			const bytes = wordCount * IO_WORD_SIZE;
			const view = this.dmaRomView;
			if (writeAddress >= IO_BASE + this.ioByteLength
				&& this.isRamRange(writeAddress, bytes)
				&& this.bindMappedReadView(readAddress, bytes, readBusSignals, view)) {
				const destination = writeAddress - RAM_BASE;
				for (let offset = 0; offset < bytes; offset += IO_WORD_SIZE) {
					writeLE32(this.ram, destination + offset, readLE32(view.bytes, view.byteOffset + offset));
				}
				this.ramPageWriteWatches.invalidateWrite(destination, bytes, RAM_BASE, this.mappedPageInvalidator!);
				return;
			}
		}
		const readSlot = readStep === 0 && (readBusSignals & MAPPED_BUS_DMA_MEMORY) === 0 ? this.ioAlignedSlot(readAddress) : -1;
		const writeSlot = writeStep === 0 && (writeBusSignals & MAPPED_BUS_DMA_MEMORY) === 0 ? this.ioAlignedSlot(writeAddress) : -1;
		const writePrefix = wordCount > 1 && writeSlot >= 0 ? this.findIoDmaPrefix(writeSlot) : null;
		if (writePrefix !== null && READ_ONLY_IO_SLOTS[writeSlot] === 0) {
			const prefix = wordCount - 1;
			const context = this.ioWriteContexts[writeSlot];
			let accepted = false;
			if (writePrefix.mappedWrite !== null && readStep === IO_WORD_SIZE
				&& this.bindMappedReadView(readAddress, prefix * IO_WORD_SIZE, readBusSignals, this.dmaRomView)) {
				writePrefix.mappedWrite(context, this.dmaRomView);
				accepted = true;
			} else if (writePrefix.write !== null) {
				const wordView = this.dmaWordView;
				const readPrefix = readSlot >= 0 ? this.findIoDmaPrefix(readSlot) : null;
				let prefixRead = false;
				if (readPrefix !== null && readPrefix.read !== null) {
					readPrefix.read(this.ioReadContexts[readSlot], wordView, prefix);
					prefixRead = true;
				} else if (readStep === 0 || readStep === IO_WORD_SIZE) {
					const words = this.dmaPrefixWords;
					wordView.words = words;
					wordView.first = 0;
					const byteCount = readStep === 0 ? IO_WORD_SIZE : prefix * IO_WORD_SIZE;
					if (readAddress >= IO_BASE + this.ioByteLength && this.isRamRange(readAddress, byteCount)) {
						for (let i = 0; i < prefix; ++i) words[i] = readLE32(this.ram, readAddress - RAM_BASE + i * readStep);
						prefixRead = true;
					} else if (this.bindRomByteView(readAddress, byteCount, this.cartridgeController.selectedSlot(readBusSignals), this.dmaRomView)) {
						const view = this.dmaRomView;
						for (let i = 0; i < prefix; ++i) words[i] = readLE32(view.bytes, view.byteOffset + i * readStep);
						prefixRead = true;
					}
				}
				if (prefixRead) {
					writePrefix.write(context, wordView.words, wordView.first, prefix);
					accepted = true;
				}
			}
			if (accepted) {
				readAddress = (readAddress + prefix * readStep) >>> 0;
				wordCount = 1;
			}
		}
		if (readSlot >= 0 && writeSlot >= 0) {
			for (let i = 0; i < wordCount; ++i) {
				const end = i + 1 === wordCount ? MAPPED_BUS_DMA_BLOCK_END : 0;
				const word = this.readIoSlot(readSlot, readAddress, readBusSignals | end);
				this.writeIoSlot(writeSlot, writeAddress, word, BUS_ACCESS_WRITE_U32, writeBusSignals | end);
			}
			return;
		}
		if (writeSlot >= 0) {
			for (let i = 0; i < wordCount; ++i) {
				const end = i + 1 === wordCount ? MAPPED_BUS_DMA_BLOCK_END : 0;
				const word = this.readMappedBusU32LE(readAddress, readBusSignals | end);
				this.writeIoSlot(writeSlot, writeAddress, word, BUS_ACCESS_WRITE_U32, writeBusSignals | end);
				readAddress = (readAddress + readStep) >>> 0;
			}
			return;
		}
		if (readSlot >= 0) {
			for (let i = 0; i < wordCount; ++i) {
				const end = i + 1 === wordCount ? MAPPED_BUS_DMA_BLOCK_END : 0;
				const word = this.readIoSlot(readSlot, readAddress, readBusSignals | end);
				this.writeMappedBusU32LE(writeAddress, word, writeBusSignals | end);
				writeAddress = (writeAddress + writeStep) >>> 0;
			}
			return;
		}
		for (let i = 0; i < wordCount; ++i) {
			const end = i + 1 === wordCount ? MAPPED_BUS_DMA_BLOCK_END : 0;
			const word = this.readMappedBusU32LE(readAddress, readBusSignals | end);
			this.writeMappedBusU32LE(writeAddress, word, writeBusSignals | end);
			readAddress = (readAddress + readStep) >>> 0;
			writeAddress = (writeAddress + writeStep) >>> 0;
		}
	}

	public writeMappedBusU32LE(addr: number, value: number, busSignals: MappedBusSignals, faultAccess = BUS_ACCESS_WRITE_U32, cpuProtected = false): void {
		const slot = this.ioAlignedSlot(addr);
		if (slot >= 0) {
			if ((busSignals & MAPPED_BUS_DMA_MEMORY) !== 0) {
				this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
				return;
			}
			this.writeIoSlot(slot, addr, value, faultAccess, busSignals);
			return;
		}
		if (this.isIoRegionRange(addr, 4)) {
			this.raiseBusFault((busSignals & MAPPED_BUS_DMA_MEMORY) !== 0
				? BUS_FAULT_UNMAPPED : BUS_FAULT_UNALIGNED_IO, addr, faultAccess);
			return;
		}
		if (addr < CART_ROM_BASE) {
			if (this.writeRamWordLE(addr, 4, value, cpuProtected)) {
				return;
			}
		} else if (addr <= CART_BUS_END - 4) {
			if (this.cartridgeController.writeU32(addr, value, busSignals)) return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, faultAccess);
	}

	public writeMappedF32LE(addr: number, value: number): void {
		this.mappedFloatView.setFloat32(0, value, true);
		this.writeMappedU32LE(addr, this.mappedFloatView.getUint32(0, true), BUS_ACCESS_WRITE_F32);
	}

	public writeMappedF64LE(addr: number, value: number, cpuProtected = false): void {
		this.mappedFloatView.setFloat64(0, value, true);
		const faultSequence = this.busFaultSequence;
		this.writeMappedU32LE(addr, this.mappedFloatView.getUint32(0, true), BUS_ACCESS_WRITE_F64, cpuProtected);
		if (this.busFaultSequence !== faultSequence) {
			return;
		}
		this.writeMappedU32LE(addr + 4, this.mappedFloatView.getUint32(4, true), BUS_ACCESS_WRITE_F64, cpuProtected);
	}

	private admitMappedValue(addr: number, access: number): boolean {
		if (addr >= IO_BASE + this.ioByteLength && this.isRamRange(addr, VALUE_MEMORY_SIZE, true)) return true;
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, access);
		return false;
	}

	public readMappedValueOffset(addr: number): number | undefined {
		if (this.admitMappedValue(addr, BUS_ACCESS_READ_VALUE)) return addr - RAM_BASE;
	}

	public writeMappedValue(addr: number, payload: number, tag: number): boolean {
		if (!this.admitMappedValue(addr, BUS_ACCESS_WRITE_VALUE)) return false;
		const offset = addr - RAM_BASE;
		writeLE32(this.ram, offset, payload);
		this.ram[offset + VALUE_MEMORY_TAG_OFFSET] = tag;
		// Physical observers see both written lanes, never a partial Value.
		this.invalidateRamWrite(offset, VALUE_MEMORY_TAG_OFFSET + 1);
		return true;
	}

	public readBytesInto(addr: number, out: Uint8Array, length: number, dstOffset = 0): void {
		if (length === 0) return;
		const view = { bytes: out, byteOffset: 0, byteLength: 0 };
		if (this.bindMappedReadView(addr, length, MAPPED_BUS_MASTER_CPU, view)) {
			out.set(view.bytes.subarray(view.byteOffset, view.byteOffset + view.byteLength), dstOffset);
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_ACCESS_READ_U8);
	}

	public isReadableMainMemoryRange(addr: number, length: number): boolean {
		if (addr < RAM_BASE) return addr + length <= this.systemRom.bytes.byteLength;
		if (addr < CART_ROM_BASE) return this.isRamRange(addr, length);
		return addr < CART_BUS_END && this.cartridgeController.isReadableRange(addr, length);
	}

	public bindRomByteView(addr: number, length: number, cartridgeSlot: number, out: MemoryByteView): boolean {
		if (length > 0 && this.isRangeWithinRegion(addr, length, SYSTEM_ROM_BASE, this.systemRom.bytes.byteLength)) {
			out.bytes = this.systemRom.bytes;
			out.byteOffset = addr - SYSTEM_ROM_BASE;
			out.byteLength = length;
			return true;
		}
		if (this.isRangeWithinRegion(addr, length, CART_ROM_BASE, CART_ROM_SIZE)) {
			return this.cartridgeController.bindRomByteView(cartridgeSlot, addr, length, out);
		}
		return false;
	}

	public isRamRange(addr: number, length: number, cpuProtected = false): boolean {
		const end = cpuProtected ? RAM_BASE + this.ram.byteLength : this.busEnd;
		return addr >= RAM_BASE && addr + length <= end
			&& (addr + length <= CPU_RESET_BANK_ADDRESS || addr >= CPU_RESET_BANK_END)
			&& (addr + length <= CPU_FIXED_FRAME_ADDRESS || addr >= CPU_FIXED_VALUE_END);
	}

	public bindMappedReadView(addr: number, length: number, busSignals: MappedBusSignals, out: MemoryByteView): boolean {
		if (addr < RAM_BASE) return this.bindRomByteView(addr, length, 0, out);
		if (addr < CART_ROM_BASE) {
			const offset = addr - RAM_BASE;
			if (length === 0 || !this.isRamRange(addr, length)
				|| (addr < IO_BASE + this.ioByteLength && addr + length > IO_BASE)) return false;
			out.bytes = this.ram;
			out.byteOffset = offset;
			out.byteLength = length;
			return true;
		}
		return addr < CART_BUS_END && this.cartridgeController.bindMappedReadView(addr, length, busSignals, out);
	}

	public mappedRegion(addr: number): MemoryRegionKind {
		if (this.isIoRegionRange(addr, IO_WORD_SIZE)) {
			return MemoryRegionKind.Io;
		}
		if (addr < RAM_BASE) {
			return addr <= SYSTEM_ROM_SIZE - IO_WORD_SIZE ? MemoryRegionKind.SystemRom : MemoryRegionKind.Other;
		}
		if (addr < CART_ROM_BASE) {
			return this.isRamRange(addr, IO_WORD_SIZE) ? MemoryRegionKind.Ram : MemoryRegionKind.Other;
		}
		return addr <= CART_BUS_END - IO_WORD_SIZE ? MemoryRegionKind.Cartridge : MemoryRegionKind.Other;
	}

	public mappedRegionWordSpan(addr: number, wordLimit: number, region: MemoryRegionKind): number {
		const systemRomEnd = SYSTEM_ROM_BASE + SYSTEM_ROM_SIZE;
		const ioEnd = IO_BASE + this.ioByteLength;
		const ramEnd = this.busEnd;
		let boundary: number;
		switch (region) {
			case MemoryRegionKind.SystemRom:
				boundary = systemRomEnd;
				break;
			case MemoryRegionKind.Cartridge:
				boundary = addr < CART_ROM_END
					? CART_ROM_END
					: addr < CART_RAM_END ? CART_RAM_END : CART_MMIO_END;
				break;
			case MemoryRegionKind.Io:
				boundary = ioEnd;
				break;
			case MemoryRegionKind.Ram:
				boundary = ramEnd;
				break;
			case MemoryRegionKind.Other:
				boundary = addr < systemRomEnd
					? systemRomEnd
					: addr < IO_BASE
						? IO_BASE
						: addr < ioEnd
							? ioEnd
							: addr < ramEnd
								? ramEnd
								: addr < CART_ROM_BASE
									? CART_ROM_BASE
									: addr < CART_BUS_END ? CART_BUS_END : 0x100000000;
				break;
		}
		const roundedByteSpan = boundary - addr + (IO_WORD_SIZE - 1);
		const regionWords = (roundedByteSpan - (roundedByteSpan & (IO_WORD_SIZE - 1))) / IO_WORD_SIZE;
		return regionWords < wordLimit ? regionWords : wordLimit;
	}

	public writeBytes(addr: number, bytes: Uint8Array): void {
		if (this.isRamRange(addr, bytes.byteLength)) {
			const offset = addr - RAM_BASE;
			this.ram.set(bytes, offset);
			this.ramPageWriteWatches.invalidateWrite(offset, bytes.byteLength, RAM_BASE, this.mappedPageInvalidator!);
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, addr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8);
	}

	public writeBytesFrom(src: Uint8Array, srcOffset: number, dstAddr: number, length: number): void {
		if (this.isRamRange(dstAddr, length)) {
			const offset = dstAddr - RAM_BASE;
			this.ram.set(src.subarray(srcOffset, srcOffset + length), offset);
			this.ramPageWriteWatches.invalidateWrite(offset, length, RAM_BASE, this.mappedPageInvalidator!);
			return;
		}
		this.raiseBusFault(BUS_FAULT_UNMAPPED, dstAddr, BUS_FAULT_ACCESS_WRITE | BUS_FAULT_ACCESS_U8);
	}

	private raiseBusFault(code: number, addr: number, access: number): void {
		this.busFaultSequence = (this.busFaultSequence + 1) >>> 0;
		if (this.busFaultCode !== BUS_FAULT_NONE) {
			return;
		}
		this.busFaultCode = code >>> 0;
		this.busFaultAddr = addr >>> 0;
		this.busFaultAccess = access >>> 0;
		this.writeBusFaultSlots();
	}

	private static onBusFaultAckWriteThunk(context: Memory, addr: number, value: number): void {
		void addr;
		if (value !== 0) {
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


}
