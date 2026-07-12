import {
	buildRuntimeRomLayer,
	buildSystemRuntimeRomLayer,
	type RuntimeRomLayer,
} from '../rompack/loader';
import { SYSTEM_BOOT_ENTRY_PATH, SYSTEM_MACHINE_MANIFEST } from './system';

export type RomBootPlan = {
	systemLayer: RuntimeRomLayer;
	cartLayer: RuntimeRomLayer | null;
};

export class RomBootManager {
	public async buildBootPlan(options: { systemRom: Uint8Array; cartridge?: Uint8Array }): Promise<RomBootPlan> {
		const systemLayer = await buildSystemRuntimeRomLayer({
			blob: options.systemRom,
			machine: SYSTEM_MACHINE_MANIFEST,
			entry_path: SYSTEM_BOOT_ENTRY_PATH,
		});
		const cartLayer = options.cartridge
			? await buildRuntimeRomLayer({ blob: options.cartridge, id: 'cart' })
			: null;

		return {
			systemLayer,
			cartLayer,
		};
	}
}
