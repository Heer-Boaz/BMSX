import { readLE32 } from '../common/endian';
import { MemoryRegionKind, type Memory, type MemoryByteView } from './memory/memory';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../spec/bmsx/memory_map';
import type { MappedBusSignals } from './memory/bus_signals';
import {
	SYSTEM_EXECUTION_DOMAIN_ID,
	type ExecutionDomainId,
} from '../spec/blua32/execution_domain';
import {
	BMSX_ROM_BOOT_HEADER_SIZE,
	BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET,
	BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET,
	BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET,
} from '../spec/bmsx/rom_header';
import {
	BLUA32_IMAGE_BSS_ADDRESS_OFFSET,
	BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_DATA_ADDRESS_OFFSET,
	BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_HEADER_SIZE,
} from '../spec/blua32/image_format';

export type Blua32ExecutionBoot = {
	imageAddress: number;
	executionDomainId: ExecutionDomainId;
	startupFunctionAddress: number;
	irqFunctionAddress: number;
	exceptionFunctionAddress: number;
	// Exclusive end of the image's DATA run and BSS; the language-heap floor.
	staticEnd: number;
};

const EMPTY_ROM_BYTES = new Uint8Array(0);

export class ExecutionAddressSpace {
	private readonly headerView: MemoryByteView = {
		bytes: EMPTY_ROM_BYTES,
		byteOffset: 0,
		byteLength: 0,
	};
	private readonly programHeaderView: MemoryByteView = {
		bytes: EMPTY_ROM_BYTES,
		byteOffset: 0,
		byteLength: 0,
	};
	public constructor(private readonly memory: Memory) {
	}

	public domainIdOnBus(address: number, busSignals: MappedBusSignals): ExecutionDomainId | null {
		switch (this.memory.mappedRegion(address)) {
			case MemoryRegionKind.SystemRom:
				return SYSTEM_EXECUTION_DOMAIN_ID;
			case MemoryRegionKind.Cartridge:
				return this.memory.cartridgeController.selectedSlot(busSignals);
			default:
				return null;
		}
	}

	public bindReadOnlyView(
		executionDomainId: ExecutionDomainId,
		address: number,
		byteLength: number,
		out: MemoryByteView,
	): void {
		const cartridgeSlot = executionDomainId === SYSTEM_EXECUTION_DOMAIN_ID
			? 0
			: executionDomainId;
		if (!this.memory.bindRomByteView(address, byteLength, cartridgeSlot, out)) {
			throw new Error('BLua32 execution read is not backed by the installed ROM.');
		}
	}

	public resolveSystemDomain(): Blua32ExecutionBoot {
		const systemImage = this.resolveDomain(SYSTEM_EXECUTION_DOMAIN_ID);
		if (!systemImage) {
			throw new Error('System ROM has no BLua32 executable image.');
		}
		return systemImage;
	}

	public resolveDomain(executionDomainId: ExecutionDomainId): Blua32ExecutionBoot | null {
		const romBaseAddress = executionDomainId === SYSTEM_EXECUTION_DOMAIN_ID
			? SYSTEM_ROM_BASE
			: CART_ROM_BASE;
		const cartridgeSlot = executionDomainId === SYSTEM_EXECUTION_DOMAIN_ID
			? 0
			: executionDomainId;
		if (!this.memory.bindRomByteView(
			romBaseAddress,
			BMSX_ROM_BOOT_HEADER_SIZE,
			cartridgeSlot,
			this.headerView,
		)) {
			return null;
		}
		const bytes = this.headerView.bytes;
		const byteOffset = this.headerView.byteOffset;
		const imageOffset = readLE32(
			bytes,
			byteOffset + BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET,
		);
		if (imageOffset === 0) {
			return null;
		}
		const imageAddress = (romBaseAddress + imageOffset) >>> 0;
		// An unbacked program header leaves the failure to image activation.
		let staticEnd = 0;
		if (this.memory.bindRomByteView(imageAddress, BLUA32_IMAGE_HEADER_SIZE, cartridgeSlot, this.programHeaderView)) {
			const program = this.programHeaderView.bytes;
			const programOffset = this.programHeaderView.byteOffset;
			const dataEnd = (readLE32(program, programOffset + BLUA32_IMAGE_DATA_ADDRESS_OFFSET)
				+ readLE32(program, programOffset + BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET)) >>> 0;
			const bssEnd = (readLE32(program, programOffset + BLUA32_IMAGE_BSS_ADDRESS_OFFSET)
				+ readLE32(program, programOffset + BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET)) >>> 0;
			staticEnd = Math.max(dataEnd, bssEnd);
		}
		return {
			imageAddress,
			executionDomainId,
			startupFunctionAddress: readLE32(
				bytes,
				byteOffset + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET,
			),
			irqFunctionAddress: readLE32(
				bytes,
				byteOffset + BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET,
			),
			exceptionFunctionAddress: readLE32(
				bytes,
				byteOffset + BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET,
			),
			staticEnd,
		};
	}
}
