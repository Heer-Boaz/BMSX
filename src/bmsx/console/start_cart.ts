import { $, type BootArgs, type WorldConfiguration, shallowcopy, InputMap, } from '../index';
import { createBmsxConsoleModule } from './module';
import { ConsoleFont } from './font';
import type { BmsxCartridge, CartManifest } from '../rompack/rompack';
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
		}
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
	const platform = args.platform;
	if (!platform) {
		throw new Error('[start_cart] Platform instance not provided.');
	}

	const manifest = args.rompack.manifest;
	if (!manifest) {
		throw new Error('[start_cart] Cart manifest not found in rompack.');
	}

	const { viewport, } = deriveConsoleOptions(manifest);
	const prebuilt = args.rompack.cart;
	const chunk2lua = prebuilt.chunk2lua ? { ...prebuilt.chunk2lua } : {};
	const source2lua = prebuilt.source2lua ? { ...prebuilt.source2lua } : {};
	for (const asset of Object.values(prebuilt.lua)) {
		if (asset.chunk_name) {
			chunk2lua[asset.chunk_name] = asset;
		}
		if (asset.normalized_source_path) {
			source2lua[asset.normalized_source_path] = asset;
		}
	}
	let entry = prebuilt.entry;
	const manifestEntryId = manifest.lua?.entry_asset_id;
	if (manifestEntryId && prebuilt.lua[manifestEntryId]) {
		entry = manifestEntryId;
	}
	const module = createBmsxConsoleModule();

	const worldConfig: WorldConfiguration = {
		viewportSize: shallowcopy(viewport),
		modules: [module],
	};

	const viewHost = args.viewHost ?? platform.gameviewHost;
	if (!viewHost) {
		throw new Error('[start_cart] View host not provided by platform.');
	}

	await $.init({
		rompack: args.rompack,
		worldConfig,
		sndcontext: args.sndcontext,
		gainnode: args.gainnode,
		debug: args.debug,
		startingGamepadIndex: args.startingGamepadIndex,
		enableOnscreenGamepad: args.enableOnscreenGamepad,
		platform,
		viewHost,
	});

	$.view.default_font = new ConsoleFont();

	const inputMappingPerPlayer = manifest.input ?? DEFAULT_INPUT_MAPPING;
	for (const playerIndexStr of Object.keys(inputMappingPerPlayer)) {
		const playerIndex = parseInt(playerIndexStr, 10);
		const inputMapping = inputMappingPerPlayer[playerIndex];
		$.set_inputmap(playerIndex, inputMapping);
	}

	const cartridge: BmsxCartridge = {
		...prebuilt,
		chunk2lua,
		source2lua,
		entry,
	};
	await applyWorkspaceOverridesToCart({ rompack: args.rompack, storage: platform.storage, includeServer: true });
	const runtime = BmsxConsoleRuntime.createInstance({
		cart: cartridge,
		playerIndex: args.startingGamepadIndex ?? 1,
		canonicalization: $.rompack.canonicalization ?? 'none',
	});

	await runtime.boot();
	$.start();
}
