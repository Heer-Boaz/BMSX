import { $, type BootArgs, type WorldConfiguration, shallowcopy, InputMap, Input, } from '../index';
import { createBmsxVMModule } from './module';
import { VMFont } from './font';
import type { CartManifest } from '../rompack/rompack';
import { applyWorkspaceOverridesToCart } from './workspace';
import { BmsxVMRuntime } from './vm_runtime';

const DEFAULT_INPUT_MAPPING = {
	1: {
		keyboard: {
			a: ['KeyX', 'KeyV'],
			b: ['KeyZ', 'KeyC'],
			x: ['KeyA'],
			y: ['ShiftLeft'],
			lb: ['KeyS'],
			rb: ['KeyD'],
			lt: ['KeyQ'],
			rt: ['KeyE'],
			select: ['Enter'],
			start: ['Space'],
			ls: ['KeyW'],
			rs: ['KeyF'],
			up: ['ArrowUp'],
			down: ['ArrowDown'],
			left: ['ArrowLeft'],
			right: ['ArrowRight'],
			home: ['Escape'],
			touch: ['Mouse0'],
		},
		gamepad: {
			a: ['a'],
			b: ['b'],
			x: ['x'],
			y: ['y'],
			lb: ['lb'],
			rb: ['rb'],
			lt: ['lt'],
			rt: ['rt'],
			select: ['select'],
			start: ['start'],
			ls: ['ls'],
			rs: ['rs'],
			up: ['up'],
			down: ['down'],
			left: ['left'],
			right: ['right'],
			home: ['home'],
			touch: ['touch'],
		},
		pointer: Input.DEFAULT_POINTER_INPUT_MAPPING,
	} as InputMap,
};

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
	if (!manifest) {
		throw new Error('[start_cart] Cart manifest not found in rompack.');
	}
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
	const runtime = BmsxVMRuntime.createInstance({
		playerIndex: args.startingGamepadIndex ?? 1,
		canonicalization: $.rompack.canonicalization,
		viewport,
	});

	await runtime.boot();
	$.start();
}
