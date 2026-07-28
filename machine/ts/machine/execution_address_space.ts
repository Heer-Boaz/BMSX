import { readLE32 } from '../common/endian';
import type { Memory, RomByteView } from './memory/memory';
import { CART_ROM_BASE, RAM_BASE, SYSTEM_ROM_BASE } from '../spec/bmsx/memory_map';
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

export type Blua32ExecutionBoot = {
	imageAddress: number;
	executionDomainId: ExecutionDomainId;
	startupFunctionAddress: number;
	irqFunctionAddress: number;
	exceptionFunctionAddress: number;
};

const EMPTY_ROM_BYTES = new Uint8Array(0);

export class ExecutionAddressSpace {
	private readonly headerView: RomByteView = {
		bytes: EMPTY_ROM_BYTES,
		byteOffset: 0,
		byteLength: 0,
	};
	public constructor(private readonly memory: Memory) {
	}

	public domainIdOnBus(address: number): ExecutionDomainId | null {
		if (address < RAM_BASE) {
			return SYSTEM_EXECUTION_DOMAIN_ID;
		}
		if (address < CART_ROM_BASE) {
			return null;
		}
		return this.memory.cartridgeController.selectedSlot();
	}

	public bindReadOnlyView(
		executionDomainId: ExecutionDomainId,
		address: number,
		byteLength: number,
		out: RomByteView,
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
		return {
			imageAddress: romBaseAddress + imageOffset,
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
		};
	}
}
