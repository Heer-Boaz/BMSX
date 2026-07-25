import {
	BLUA32_BOOT_HEADER_SIZE,
	decodeBlua32BootHeader,
	decodeBlua32Image,
	type Blua32MediaImage,
} from './blua32_image';
import {
	type Blua32ExecutionImage,
	type Blua32RuntimeFunction,
	type CPU,
	type ExecutionAddressResolver,
} from './cpu';
import { CART_ROM_BASE, RAM_BASE, SYSTEM_ROM_BASE } from '../memory/map';
import type { Memory, RomByteView } from '../memory/memory';

export class ExecutionLoader implements ExecutionAddressResolver {
	private systemImage!: Blua32ExecutionImage;
	private readonly cartridgeMediaImages: [Blua32MediaImage | null, Blua32MediaImage | null] = [null, null];
	private readonly cartridgeMediaDecoded: [boolean, boolean] = [false, false];
	private readonly cartridgeImages: [Blua32ExecutionImage | null, Blua32ExecutionImage | null] = [null, null];
	private readonly loadedImages: [
		Blua32ExecutionImage | null,
		Blua32ExecutionImage | null,
		Blua32ExecutionImage | null,
	] = [null, null, null];
	private readonly headerView: RomByteView = {
		bytes: new Uint8Array(0),
		byteOffset: 0,
		byteLength: 0,
	};
	private readonly imageView: RomByteView = {
		bytes: new Uint8Array(0),
		byteOffset: 0,
		byteLength: 0,
	};

	public constructor(private readonly memory: Memory) {}

	public mountExecutableMedia(cpu: CPU): void {
		const systemMedia = this.decodeExecutableMedia(SYSTEM_ROM_BASE, -1);
		if (systemMedia === null) {
			throw new Error('System ROM has no BLua32 executable image.');
		}
		cpu.beginExecutionImageMount();
		const systemImage = cpu.activateExecutableImage(systemMedia);
		this.systemImage = systemImage;
		this.cartridgeMediaImages[0] = null;
		this.cartridgeMediaImages[1] = null;
		this.cartridgeMediaDecoded[0] = false;
		this.cartridgeMediaDecoded[1] = false;
		this.cartridgeImages[0] = null;
		this.cartridgeImages[1] = null;
		this.loadedImages[0] = systemImage;
		this.loadedImages[1] = null;
		this.loadedImages[2] = null;
		cpu.setSystemExecutionImage(systemImage);
	}

	public installExecutionImage(cpu: CPU, target: 'system' | 0 | 1): void {
		if (target === 'system') {
			const media = this.decodeExecutableMedia(SYSTEM_ROM_BASE, -1);
			if (media === null) {
				throw new Error('System ROM has no BLua32 executable image.');
			}
			const previousImage = this.systemImage;
			const image = cpu.activateExecutableImage(media);
			this.systemImage = image;
			this.loadedImages[0] = image;
			cpu.replaceExecutionImage(previousImage, image);
			return;
		}

		const media = this.decodeExecutableMedia(CART_ROM_BASE, target);
		this.cartridgeMediaDecoded[target] = true;
		const previousImage = this.cartridgeImages[target];
		if (previousImage === null) {
			this.cartridgeMediaImages[target] = media;
			return;
		}
		if (media === null) {
			throw new Error('Cartridge ROM has no BLua32 executable image.');
		}
		const image = cpu.activateExecutableImage(media);
		this.cartridgeMediaImages[target] = null;
		this.cartridgeImages[target] = image;
		this.loadedImages[target + 1] = image;
		cpu.replaceExecutionImage(previousImage, image);
	}

	public systemStartupFunctionAddress(): number {
		return this.systemImage.boot.startupFunctionAddress;
	}

	public functionRecordOnSelectedBus(
		cpu: CPU,
		address: number,
	): Blua32RuntimeFunction | null {
		return this.functionRecordOnBus(
			cpu,
			address,
			this.memory.cartridgeController.selectedSlot(),
		);
	}

	public executionImageForSlot(cpu: CPU, slot: number): Blua32ExecutionImage | null {
		return this.cartridgeImageForExecution(cpu, slot);
	}

	public functionRecordInMappedDomain(
		cpu: CPU,
		executionImage: Blua32ExecutionImage,
		address: number,
	): Blua32RuntimeFunction | null {
		return this.functionRecordOnBus(cpu, address, executionImage.cartridgeSlot);
	}

	public loadedExecutionImages(): ReadonlyArray<Blua32ExecutionImage | null> {
		return this.loadedImages;
	}

	private functionRecordOnBus(
		cpu: CPU,
		address: number,
		cartridgeSlot: number,
	): Blua32RuntimeFunction | null {
		if (address >= CART_ROM_BASE) {
			const image = this.cartridgeImageForExecution(cpu, cartridgeSlot);
			return image === null ? null : cpu.functionRecordInImage(image, address);
		}
		if (address >= RAM_BASE) {
			return null;
		}
		return cpu.functionRecordInImage(this.systemImage, address);
	}

	private cartridgeImageForExecution(cpu: CPU, slot: number): Blua32ExecutionImage | null {
		let image = this.cartridgeImages[slot];
		if (image !== null) {
			return image;
		}
		if (!this.cartridgeMediaDecoded[slot]) {
			this.cartridgeMediaImages[slot] = this.decodeExecutableMedia(CART_ROM_BASE, slot);
			this.cartridgeMediaDecoded[slot] = true;
		}
		const media = this.cartridgeMediaImages[slot];
		if (media === null) {
			return null;
		}
		image = cpu.activateExecutableImage(media);
		this.cartridgeMediaImages[slot] = null;
		this.cartridgeImages[slot] = image;
		this.loadedImages[slot + 1] = image;
		cpu.executionImagesChanged();
		return image;
	}

	private decodeExecutableMedia(
		romBaseAddress: number,
		cartridgeSlot: number,
	): Blua32MediaImage | null {
		if (!this.memory.bindRomByteView(
			romBaseAddress,
			BLUA32_BOOT_HEADER_SIZE,
			cartridgeSlot < 0 ? 0 : cartridgeSlot,
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
			cartridgeSlot < 0 ? 0 : cartridgeSlot,
			this.imageView,
		)) {
			throw new Error('BLua32 image is not backed by the installed ROM.');
		}
		const bytes = this.imageView.bytes.subarray(
			this.imageView.byteOffset,
			this.imageView.byteOffset + this.imageView.byteLength,
		);
		return {
			layout: decodeBlua32Image(bytes, imageAddress),
			boot,
			cartridgeSlot,
		};
	}
}
