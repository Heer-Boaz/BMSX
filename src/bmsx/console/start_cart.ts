import { $, type BootArgs, type WorldConfiguration, shallowcopy, InputMap, Input, } from '../index';
import { createBmsxConsoleModule } from './module';
import { ConsoleFont } from './font';
import type { CartManifest } from '../rompack/rompack';
import { applyWorkspaceOverridesToCart } from './workspace';
import { BmsxConsoleRuntime } from './runtime';

const DEFAULT_INPUT_MAPPING = {
	1: {
		keyboard: {
			console_left: ['ArrowLeft'],
			console_right: ['ArrowRight'],
			console_up: ['ArrowUp'],
			console_down: ['ArrowDown'],
			console_b: ['KeyZ'],
			console_a: ['KeyX'],
		},
		gamepad: {
			console_left: ['left'],
			console_right: ['right'],
			console_up: ['up'],
			console_down: ['down'],
			console_b: ['b'],
			console_a: ['a'],
		},
		pointer: Input.DEFAULT_POINTER_INPUT_MAPPING,
	} as InputMap,
};

function deriveConsoleOptions(manifest: CartManifest) {
	const consoleConfig = manifest.console;
	const viewport = consoleConfig.viewport;
	const canonicalization = consoleConfig.canonicalization;
	return {
		viewport,
		canonicalization,
	};
}

export async function startCart(args: BootArgs): Promise<void> {
	const manifest = args.rompack.manifest;
	if (!manifest) {
		throw new Error('[start_cart] Cart manifest not found in rompack.');
	}
	const { viewport, } = deriveConsoleOptions(manifest);
	const module = createBmsxConsoleModule();

	const worldConfig: WorldConfiguration = {
		viewportSize: shallowcopy(viewport),
		modules: [module],
	};

	await $.init({
		rompack: args.rompack,
		worldConfig,
		sndcontext: args.sndcontext,
		gainnode: args.gainnode,
		debug: args.debug,
		startingGamepadIndex: args.startingGamepadIndex,
		enableOnscreenGamepad: args.enableOnscreenGamepad,
		platform: args.platform,
		viewHost: args.viewHost,
	});

	$.view.default_font = new ConsoleFont();

	const inputMappingPerPlayer = manifest.input ?? DEFAULT_INPUT_MAPPING;
	for (const playerIndexStr of Object.keys(inputMappingPerPlayer)) {
		const playerIndex = parseInt(playerIndexStr, 10);
		const inputMapping = inputMappingPerPlayer[playerIndex];
		const pointerMapping = inputMapping.pointer
			? { ...Input.DEFAULT_POINTER_INPUT_MAPPING, ...inputMapping.pointer }
			: Input.DEFAULT_POINTER_INPUT_MAPPING;
		const resolvedMapping: InputMap = {
			...inputMapping,
			pointer: pointerMapping,
		};
		$.set_inputmap(playerIndex, resolvedMapping);
	}

	await applyWorkspaceOverridesToCart({ cart: $.cart, storage: $.platform.storage, includeServer: true });
	const runtime = BmsxConsoleRuntime.createInstance({
		playerIndex: args.startingGamepadIndex ?? 1,
		canonicalization: $.rompack.canonicalization,
		viewport,
	});

	await runtime.boot();
	$.start();
}
