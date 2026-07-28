import { PSX_MACHINE_SPEC } from '../machine/model_registry';
import { Runtime } from '../machine/runtime/runtime';
import type { RuntimeInputSource } from '../machine/runtime/input';
import { Memory } from '../machine/memory/memory';
import { configureMemoryMap } from '../machine/memory/map';
import { resolveRuntimeTiming } from '../machine/runtime/boot_timing';
import { parseRomImage } from '../rompack/image';
import {
	type CartridgeSlotMediaPair,
} from '../machine/devices/cartridge/contracts';

const EMPTY_CARTRIDGE_ROM = new Uint8Array(0);

export interface MachineInitializationOptions {
	systemRom: Uint8Array;
	cartridgeSlots: [Uint8Array | null, Uint8Array | null];
}

export class MachineManager {
	private _runtime!: Runtime;
	public get runtime(): Runtime { return this._runtime; }

	public initialize(
		options: MachineInitializationOptions,
		input: RuntimeInputSource,
	): Runtime {
		const {
			systemRom,
			cartridgeSlots,
		} = options;
		const systemImage = parseRomImage(systemRom, 'system');
		const cartridgeImages = [
			cartridgeSlots[0] ? parseRomImage(cartridgeSlots[0], 'cart') : null,
			cartridgeSlots[1] ? parseRomImage(cartridgeSlots[1], 'cart') : null,
		] as const;
		const cartridgeMedia: CartridgeSlotMediaPair = [
			{
				rom: EMPTY_CARTRIDGE_ROM,
				boardWord: 0,
				ramByteCount: 0,
				present: false,
			},
			{
				rom: EMPTY_CARTRIDGE_ROM,
				boardWord: 0,
				ramByteCount: 0,
				present: false,
			},
		];
		for (let slotIndex = 0; slotIndex < cartridgeImages.length; slotIndex += 1) {
			const image = cartridgeImages[slotIndex];
			if (!image) continue;
			cartridgeMedia[slotIndex] = {
				rom: image.bytes,
				boardWord: image.header.cartridgeBoardWord,
				ramByteCount: image.header.cartridgeRamByteCount,
				present: true,
			};
		}
		configureMemoryMap(PSX_MACHINE_SPEC.ramBytes);
		const memory = new Memory({
			systemRom: systemImage.bytes,
			cartridgeSlots: cartridgeMedia,
		});

		const timing = resolveRuntimeTiming(PSX_MACHINE_SPEC.cpuFreqHz);
		const runtime = new Runtime({
			memory,
			pcrtcRunning: timing.pcrtcRunning,
			ufpsScaled: timing.ufpsScaled,
			cpuHz: timing.cpuHz,
			cycleBudgetPerFrame: timing.cycleBudgetPerFrame,
			totalHalfLines: timing.totalHalfLines,
			activeDisplayHalfLines: timing.activeDisplayHalfLines,
			geoWorkUnitsPerSec: timing.geoWorkUnitsPerSec,
		}, input);
		this._runtime = runtime;
		return runtime;
	}
}
