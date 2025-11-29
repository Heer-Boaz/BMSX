import { BFont, BootArgs, MSX1ScreenHeight, MSX1ScreenWidth, WorldConfiguration, $ } from 'bmsx';
import { EILA_MODULE } from './worldmodule';
import { BitmapId } from './resourceids';
// Ensure FSM blueprint is registered
import './world_fsm';

const _global = (window || globalThis) as { h406A?: (args: BootArgs) => Promise<void> };

_global['h406A'] = async function (args: BootArgs): Promise<void> {
	// Use FSM id matching the registered blueprint (@build_fsm on EilaModelFSM.bouw()) so world state machine runs.
	const worldConfig: WorldConfiguration = { viewportSize: { width: MSX1ScreenWidth, height: MSX1ScreenHeight }, fsmId: 'EilaModelFSM', modules: [EILA_MODULE] };
	return $.init({
		rompack: args.rompack,
		worldConfig: worldConfig,
		sndcontext: args.sndcontext,
		gainnode: args.gainnode,
		debug: args.debug ?? false,
		startingGamepadIndex: args.startingGamepadIndex,
		platform: args.platform,
		viewHost: args.viewHost,
	}).then(() => {
		$.hide_onscreen_gamepad_buttons(['ls', 'rs', 'select', 'y']);
		$.view.dynamicAtlas = null; // Must set this after creating the Game, otherwise GameView.images will not be initialized properly.
		$.view.default_font = new BFont(BitmapId);
		$.start();
	});
};
