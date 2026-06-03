import { consoleCore, type ConsoleStartupOptions } from '../../core/console';
import type { Runtime } from '../runtime/runtime';

export type BootArgs = ConsoleStartupOptions;

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
