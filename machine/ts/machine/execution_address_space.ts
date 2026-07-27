import {
	decodeBlua32BootHeader,
	decodeBlua32Image,
	type Blua32ImageLayout,
} from './cpu/blua32_image';
import type { Memory, RomByteView } from './memory/memory';
import { CART_ROM_BASE, RAM_BASE, SYSTEM_ROM_BASE } from '../spec/bmsx/memory_map';
import { BMSX_ROM_BOOT_HEADER_SIZE } from '../spec/bmsx/rom_header';

export const SYSTEM_EXECUTION_DOMAIN_ID = -1;
export type ExecutionDomainId = -1 | 0 | 1;

export type Blua32DecodedExecutionImage = {
	layout: Blua32ImageLayout;
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
	private readonly imageView: RomByteView = {
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

	public resolveSystemDomain(): Blua32DecodedExecutionImage {
		const systemImage = this.resolveDomain(SYSTEM_EXECUTION_DOMAIN_ID);
		if (!systemImage) {
			throw new Error('System ROM has no BLua32 executable image.');
		}
		return systemImage;
	}

	public resolveDomain(executionDomainId: ExecutionDomainId): Blua32DecodedExecutionImage | null {
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
		const boot = decodeBlua32BootHeader(this.headerView.bytes, this.headerView.byteOffset);
		if (boot.imageOffset === 0) {
			return null;
		}
		const imageAddress = romBaseAddress + boot.imageOffset;
		if (!this.memory.bindRomByteView(
			imageAddress,
			boot.imageByteCount,
			cartridgeSlot,
			this.imageView,
		)) {
			throw new Error('BLua32 image is not backed by the installed ROM.');
		}
		return {
			layout: decodeBlua32Image(
				this.imageView.bytes.subarray(
					this.imageView.byteOffset,
					this.imageView.byteOffset + this.imageView.byteLength,
				),
				imageAddress,
			),
			executionDomainId,
			startupFunctionAddress: boot.startupFunctionAddress,
			irqFunctionAddress: boot.irqFunctionAddress,
			exceptionFunctionAddress: boot.exceptionFunctionAddress,
		};
	}
}
