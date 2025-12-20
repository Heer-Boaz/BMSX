import { type BootArgs, type WorldConfiguration, shallowcopy } from '../index';
import { createBmsxVMModule } from './module';
import type { CartManifest } from '../rompack/rompack';
import { buildRuntimeAssets } from '../rompack/romloader';
import { BmsxVMRuntime } from './vm_runtime';

export const DEFAULT_VM_FONT_VARIANT = 'msx';

export async function startCart(args: BootArgs): Promise<void> {
	const assets = await buildRuntimeAssets({
		cartridge: args.cartridge,
		engineAssets: args.engineAssets,
		workspaceOverlay: args.workspaceOverlay,
	});
	const manifest = assets.cartIndex.manifest as CartManifest;
	const viewport = manifest.vm.viewport;
	const module = createBmsxVMModule();

	const worldConfig: WorldConfiguration = {
		viewportSize: shallowcopy(viewport),
		modules: [module],
	};

	await BmsxVMRuntime.init({
		boot: args,
		assets,
		worldConfig,
	});
}
