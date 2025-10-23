import { BootArgs, WorldConfiguration, Input, $, KeyboardButton, BGamepadButton } from 'bmsx';
import { createLuaShellWorldModule } from './worldmodule';
import { BmsxConsoleRuntime } from 'bmsx/console';

type ConsoleAction = 'console_left' | 'console_right' | 'console_up' | 'console_down' | 'console_o' | 'console_x';

type ConsoleKeyboardMapping = {
	[action in ConsoleAction]: KeyboardButton[];
};

type ConsoleGamepadMapping = {
	[action in ConsoleAction]: BGamepadButton[];
};

const keyboardInputMapping: ConsoleKeyboardMapping = {
	console_left: ['ArrowLeft'],
	console_right: ['ArrowRight'],
	console_up: ['ArrowUp'],
	console_down: ['ArrowDown'],
	console_o: ['KeyZ'],
	console_x: ['KeyX'],
};

const gamepadInputMapping: ConsoleGamepadMapping = {
	console_left: ['left'],
	console_right: ['right'],
	console_up: ['up'],
	console_down: ['down'],
	console_o: ['b'],
	console_x: ['a'],
};

const globalTarget = globalThis as { h406A?: (args: BootArgs) => Promise<void>; };

globalTarget.h406A = async (args: BootArgs): Promise<void> => {
	const platform = args.platform;
	if (!platform) {
		throw new Error('[Bootloader:luashell] Platform instance not provided.');
	}

	const viewHost = args.viewHost ?? platform.gameviewHost;
	if (!viewHost) {
		throw new Error('[Bootloader:luashell] View host not provided by platform.');
	}

	const module = createLuaShellWorldModule();
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

	const runtime = BmsxConsoleRuntime.instance;
	if (!runtime) {
		throw new Error('[Bootloader:luashell] Console runtime unavailable after init.');
	}
	runtime.ensureEditorActive();

	$.setInputMap(1, {
		keyboard: keyboardInputMapping,
		gamepad: gamepadInputMapping,
		pointer: Input.clonePointerMapping(),
	});

	$.start();
};
