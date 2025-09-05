import { BFont, BootArgs, MSX1ScreenHeight, MSX1ScreenWidth, WorldConfiguration, $ } from '../bmsx';
import { EILA_PLUGIN } from './modelplugin';
import { BitmapId } from './resourceids';
// Ensure FSM blueprint is registered
import './world_fsm';

const _global = (window || globalThis) as unknown as { h406A: (args: BootArgs) => Promise<void> };

_global['h406A'] = (args: BootArgs): Promise<void> => {
	// Use FSM id matching the registered blueprint (@build_fsm on EilaModelFSM.bouw()) so world state machine runs.
	const worldConfig: WorldConfiguration = { viewportSize: { x: MSX1ScreenWidth, y: MSX1ScreenHeight }, fsmId: 'EilaModelFSM', modules: [EILA_PLUGIN] };
	return $.init({
		rompack: args.rompack,
		worldConfig: worldConfig,
		sndcontext: args.sndcontext,
		gainnode: args.gainnode,
		debug: args.debug ?? false,
		startingGamepadIndex: args.startingGamepadIndex ?? null
	}).then(() => {
		$.hideOnscreenGamepadButtons(['ls', 'rs', 'select', 'y']);
		$.view.dynamicAtlas = null; // Must set this after creating the Game, otherwise GameView.images will not be initialized properly.
		$.view.default_font = new BFont(BitmapId);
		$.start();
	}).catch((err) => {
		console.error('Error initializing game:', err);
	});
};
