import {
	BLUA32_BOOT_HEADER_SIZE,
	decodeBlua32BootHeader,
	decodeBlua32Image,
	type Blua32BootHeader,
	type Blua32ImageLayout,
} from './blua32_image';
import type { Memory, RomByteView } from '../memory/memory';
import { CART_ROM_BASE, RAM_BASE, SYSTEM_ROM_BASE } from '../memory/map';

export const SYSTEM_EXECUTION_DOMAIN_ID = -1;

export type Blua32DecodedExecutionImage = {
	layout: Blua32ImageLayout;
	boot: Blua32BootHeader;
	executionDomainId: number;
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

	public domainIdOnBus(address: number): number | null {
		if (address < RAM_BASE) {
			return SYSTEM_EXECUTION_DOMAIN_ID;
		}
		if (address < CART_ROM_BASE) {
			return null;
		}
		return this.memory.cartridgeController.selectedSlot();
	}

	public loadDomain(executionDomainId: number): Blua32DecodedExecutionImage | null {
		const romBaseAddress = executionDomainId === SYSTEM_EXECUTION_DOMAIN_ID
			? SYSTEM_ROM_BASE
			: CART_ROM_BASE;
		const cartridgeSlot = executionDomainId === SYSTEM_EXECUTION_DOMAIN_ID
			? 0
			: executionDomainId;
		if (!this.memory.bindRomByteView(
			romBaseAddress,
			BLUA32_BOOT_HEADER_SIZE,
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
			boot,
			executionDomainId,
		};
	}
}
