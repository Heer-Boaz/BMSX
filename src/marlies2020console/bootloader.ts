import { BootArgs, WorldConfiguration, Input, $, KeyboardButton, BGamepadButton } from 'bmsx';
import { createMarlies2020ConsoleWorldModule } from './worldmodule';

type ConsoleAction = 'move_left' | 'move_right' | 'move_up' | 'move_down' | 'fire' | 'interact';

type ConsoleKeyboardMapping = {
	[action in ConsoleAction]: KeyboardButton[];
};

type ConsoleGamepadMapping = {
	[action in ConsoleAction]: BGamepadButton[];
};

const keyboardInputMapping: ConsoleKeyboardMapping = {
	move_left: ['ArrowLeft'],
	move_right: ['ArrowRight'],
	move_up: ['ArrowUp'],
	move_down: ['ArrowDown'],
	fire: ['KeyZ'],
	interact: ['KeyX'],
};

const gamepadInputMapping: ConsoleGamepadMapping = {
	move_left: ['left'],
	move_right: ['right'],
	move_up: ['up'],
	move_down: ['down'],
	fire: ['b'],
	interact: ['a'],
};

const globalTarget = globalThis as { h406A?: (args: BootArgs) => Promise<void>; };

globalTarget.h406A = async (args: BootArgs): Promise<void> => {
	const platform = args.platform;
	if (!platform) {
		throw new Error('[Bootloader:marlies2020console] Platform instance not provided.');
	}

	const viewHost = args.viewHost ?? platform.gameviewHost;
	if (!viewHost) {
		throw new Error('[Bootloader:marlies2020console] View host not provided by platform.');
	}

	const module = createMarlies2020ConsoleWorldModule();
	const worldConfiguration: WorldConfiguration = {
		viewportSize: { x: 256, y: 212 },
		modules: [module],
	};

	await $.init({
		rompack: args.rompack,
		worldConfig: worldConfiguration,
		sndcontext: args.sndcontext,
		gainnode: args.gainnode,
		debug: args.debug,
		startingGamepadIndex: args.startingGamepadIndex ?? null,
		enableOnscreenGamepad: args.enableOnscreenGamepad,
		platform,
		viewHost,
	});

	$.setInputMap(1, {
		keyboard: keyboardInputMapping,
		gamepad: gamepadInputMapping,
		pointer: Input.clonePointerMapping(),
	});

	$.start();
};
