import { $, BFont, BGamepadButton, World, BootArgs, GamepadInputMapping, KeyboardButton, KeyboardInputMapping, MSX1ScreenHeight, MSX1ScreenWidth, StateMachineBlueprint, build_fsm, type State, WorldConfiguration } from 'bmsx';
import { quiz } from './quiz';
import { BitmapId } from './resourceids';
import { sint } from './sint';

const _global = (window || globalThis) as { h406A?: (args: BootArgs) => Promise<void> };


_global['h406A'] = async (args: BootArgs): Promise<void> => {
	const { platform } = args;
	if (!platform) {
		throw new Error('[Bootloader:sint2024] Platform services not provided. Ensure the host injects a Platform instance before starting the game.');
	}
	const worldConfig: WorldConfiguration = { viewportSize: { width: MSX1ScreenWidth, height: MSX1ScreenHeight }, fsmId: 'SintWorldFSM' };
	const viewHost = args.viewHost ?? platform.gameviewHost;
	if (!viewHost) {
		throw new Error('[Bootloader:sint2024] View host not provided by Platform.');
	}
	await $.init({
		engineRom: args.engineAssets,
		cartridge: args.cartridge,
		workspaceOverlay: args.workspaceOverlay,
		worldConfig,
		sndcontext: args.sndcontext,
		gainnode: args.gainnode,
		debug: args.debug ?? false,
		startingGamepadIndex: args.startingGamepadIndex,
		enableOnscreenGamepad: args.enableOnscreenGamepad,
		platform,
		viewHost,
	});
	// set input map previously done in do_one_time_game_init
	$.set_inputmap(1, { keyboard: keyboardInputMapping, gamepad: gamepadInputMapping, });
	$.view.default_font = new BFont(BitmapId);
};

const actions = ['up', 'right', 'down', 'left', 'a', 'b'] as const;
type InputAction = typeof actions[number];

type MyKeyboardInputMapping = {
	[key in keyof KeyboardInputMapping & InputAction]: KeyboardButton[];
};

type MyGamepadInputMapping = {
	[key in keyof GamepadInputMapping & InputAction]: BGamepadButton[];
};

const keyboardInputMapping: MyKeyboardInputMapping = {
	'up': ['ArrowUp'],
	'right': ['ArrowRight'],
	'down': ['ArrowDown'],
	'left': ['ArrowLeft'],
	'a': ['KeyA'],
	'b': ['KeyB'],
};

const gamepadInputMapping: MyGamepadInputMapping = {
	'up': ['up'],
	'right': ['right'],
	'down': ['down'],
	'left': ['left'],
	'a': ['a'],
	'b': ['b'],
};

export class SintWorldFSM { // export to prevent potential tree-shaking (not happened) and unused-definition compiler errors
	@build_fsm()
	/**
	 * Constructs and returns a StateMachineBlueprint object.
	 *
	 * The blueprint defines the states and their behaviors for the state machine.
	 *
	 * @returns {StateMachineBlueprint} The blueprint for the state machine.
	 *
	 * The blueprint contains the following states:
	 * - `#game_start`: The initial state of the game.
	 *   - `entering_state`: A function that is called when entering the `#game_start` state.
	 *   - `tick`: A function that is called to run the `#game_start` state. Returns the next state as 'default'.
	 *
	 * - `default`: The default state of the game.
	 *   - `entering_state`: A function that is called when entering the `default` state. It spawns a new quiz and a new sint.
	 */
	public static bouw(): StateMachineBlueprint {
		return {
			states: {
				'#game_start': {
					entering_state(this: World) {
					},
					tick(this: World, _s: State) { // Don't use 'onenter', as the game has not been fully initialized yet before 'onenter' triggers!
						return '/default';
					}
				},
				default: {
					entering_state(this: World) {
						let q = new quiz();
						$.spawn(q);
						let s = new sint();
						$.spawn(s);
					},
				},
			}
		};
	}

}
