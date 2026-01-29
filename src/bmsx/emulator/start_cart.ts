import { type BootArgs, $ } from '../index';

export const DEFAULT_FONT_VARIANT = 'msx';

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
