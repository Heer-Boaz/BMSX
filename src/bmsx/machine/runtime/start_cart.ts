import { $ } from '../../core/engine_core';
import type { BootArgs } from '../../rompack/rompack';

export async function startCart(args: BootArgs): Promise<void> {
	await $.init({
		engineRom: args.engineAssets,
		cartridge: args.cartridge,
		workspaceOverlay: args.workspaceOverlay,
		sndcontext: args.sndcontext,
		gainnode: args.gainnode,
		debug: args.debug,
		startingGamepadIndex: args.startingGamepadIndex,
		enableOnscreenGamepad: args.enableOnscreenGamepad,
		platform: args.platform,
		viewHost: args.viewHost,
	});
}
