import { $, type BootArgs, type InputMap, type WorldConfiguration, shallowcopy, } from '../index';
import { createBmsxVMModule } from './module';
import { VMFont, VMFontVariant } from './font';
import type { CartManifest } from '../rompack/rompack';
import { applyWorkspaceOverridesToCart } from './workspace';
import { BmsxVMRuntime } from './vm_runtime';
export const DEFAULT_VM_FONT_VARIANT: VMFontVariant = 'msx';

function deriveVMOptions(manifest: CartManifest) {
	const vmConfig = manifest.vm;
	const viewport = vmConfig.viewport;
	const canonicalization = vmConfig.canonicalization;
	return {
		viewport,
		canonicalization,
	};
}

export async function startCart(args: BootArgs): Promise<void> {
	const manifest = args.rompack.manifest;
	const { viewport, } = deriveVMOptions(manifest);
	const module = createBmsxVMModule();

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

	$.view.default_font = new VMFont();

	const inputMappingPerPlayer = manifest.input ?? { 1: { keyboard: null, gamepad: null, pointer: null } as InputMap }; // Default to player 1 with no custom mapping if none specified. The PlayerInput will fill in defaults. It will also fill in defaults for other players if needed (and distinguish between player 1 and others for keyboard so that player 1 gets the default keyboard mapping).
	for (const playerIndexStr of Object.keys(inputMappingPerPlayer)) {
		const playerIndex = parseInt(playerIndexStr, 10);
		const inputMapping = inputMappingPerPlayer[playerIndex];
		$.set_inputmap(playerIndex, inputMapping);
	}

	await applyWorkspaceOverridesToCart({ cart: $.cart, storage: $.platform.storage, includeServer: true });
	const runtime = BmsxVMRuntime.createInstance({
		playerIndex: args.startingGamepadIndex ?? 1,
		canonicalization: manifest.vm.canonicalization,
		viewport,
	});

	await runtime.boot();
	$.start();
}
