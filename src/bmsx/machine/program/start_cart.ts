import { consoleCore } from '../../core/console';
import type { BootArgs } from '../../rompack/format';
import type { Runtime } from '../runtime/runtime';

export async function startCart(args: BootArgs): Promise<Runtime> {
	return await consoleCore.init({
		systemRom: args.systemRom,
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
