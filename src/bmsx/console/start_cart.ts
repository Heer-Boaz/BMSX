import { $, Input, type BootArgs, type WorldConfiguration, type KeyboardButton, type BGamepadButton, shallowcopy, } from '../index';
import { createBmsxConsoleModule } from './module';
import { createLuaConsoleCartridge } from './lua';
import { ConsoleFont } from './font';
import type { IdeThemeVariant, LifeCycleHandlerManifest, LifeCycleHandlers, ManifestInputMapping } from './types';
import { MSX2ScreenHeight } from '../index';
import { MSX2ScreenWidth } from '../index';
import type { CanonicalizationType, RomPack, Viewport } from '../rompack/rompack';

type CartManifest = {
	title?: string;
	short_name?: string;
	rom_name?: string;
	metadata?: {
		version?: string;
		persistentId?: string;
		ideTheme?: IdeThemeVariant;
	};
	console?: {
		moduleId?: string;
		playerIndex?: number;
		viewport?: Viewport;
		world?: {
			viewportSize?: Viewport;
		};
		canonicalization?: CanonicalizationType;
	};
	input?: {
		keyboard?: ManifestInputMapping;
		gamepad?: ManifestInputMapping;
	};
	lua?: {
		entryAssetId?: string;
		entry?: LifeCycleHandlers;
	};
};

const DEFAULT_META = {
	title: 'BMSX Cart',
	version: '1.0.0',
	persistentId: 'bmsx_cart',
};

const DEFAULT_MODULE_ID = 'bmsx-console';
const DEFAULT_PLAYER_INDEX = 1;
const DEFAULT_WORLD_VIEWPORT: Viewport = { width: MSX2ScreenWidth, height: MSX2ScreenHeight };

const DEFAULT_KEYBOARD_MAPPING: ManifestInputMapping = {
	console_left: ['ArrowLeft'],
	console_right: ['ArrowRight'],
	console_up: ['ArrowUp'],
	console_down: ['ArrowDown'],
	console_b: ['KeyZ'],
	console_a: ['KeyX'],
};

const DEFAULT_GAMEPAD_MAPPING: ManifestInputMapping = {
	console_left: ['left'],
	console_right: ['right'],
	console_up: ['up'],
	console_down: ['down'],
	console_b: ['b'],
	console_a: ['a'],
};

function coerceInputMapping<T extends string>(mapping: ManifestInputMapping | undefined): Record<string, T[]> {
	const result: Record<string, T[]> = {};
	if (!mapping) return result;
	for (const [action, values] of Object.entries(mapping)) {
		if (!values || values.length === 0) continue;
		result[action] = values.map(v => String(v)) as T[];
	}
	return result;
}

function buildInputMapping(manifest: CartManifest): {
	keyboard: Record<string, KeyboardButton[]>;
	gamepad: Record<string, BGamepadButton[]>;
} {
	const keyboardManifest = manifest.input?.keyboard ?? DEFAULT_KEYBOARD_MAPPING;
	const gamepadManifest = manifest.input?.gamepad ?? DEFAULT_GAMEPAD_MAPPING;
	const keyboard = coerceInputMapping<KeyboardButton>(keyboardManifest);
	const gamepad = coerceInputMapping<BGamepadButton>(gamepadManifest);

	const actions = new Set<string>([
		...Object.keys(DEFAULT_KEYBOARD_MAPPING),
		...Object.keys(DEFAULT_GAMEPAD_MAPPING),
		...Object.keys(keyboard),
		...Object.keys(gamepad),
	]);

	for (const action of actions) {
		if (!keyboard[action]) keyboard[action] = [];
		if (!gamepad[action]) gamepad[action] = [];
	}

	return { keyboard, gamepad };
}

function ensureLuaProgram(rompack: RomPack, manifest: CartManifest) {
	const placeholderId = 'placeholder';
	const placeholderSource = [
		'function new_game()',
		'end',
		'',
		'function init()',
		'end',
		'',
		'function update()',
		'end',
		'',
		'function draw()',
		'\tcls(4)',
		'end',
	].join('\n');

	const luaIds = Object.keys(rompack.lua);
	if (luaIds.length === 0) {
		rompack.lua[placeholderId] = placeholderSource;
		rompack.luaSourcePaths[placeholderId] = rompack.luaSourcePaths[placeholderId] ?? 'placeholder.lua';
	}
	const assetIds = Object.keys(rompack.lua).sort();
	const assets = assetIds.map(id => ({ asset_id: id, chunkName: id }));
	const entryAssetId = manifest.lua?.entryAssetId && rompack.lua[manifest.lua.entryAssetId] !== undefined
		? manifest.lua.entryAssetId
		: assets[0]?.asset_id;
	const entry = manifest.lua?.entry ?? {} as LifeCycleHandlerManifest;
	return {
		assets,
		entryAssetId,
		entry: {
			new_game: entry.new_game ?? 'new_game',
			init: entry.init ?? 'init',
			update: entry.update ?? 'update',
			draw: entry.draw ?? 'draw',
		},
	};
}

function deriveMetadata(manifest: CartManifest) {
	const meta = manifest.metadata ?? {};
	return {
		title: manifest.title ?? DEFAULT_META.title,
		version: meta.version ?? DEFAULT_META.version,
		persistentId: meta.persistentId ?? DEFAULT_META.persistentId,
		ideTheme: meta.ideTheme,
	};
}

function deriveConsoleOptions(manifest: CartManifest) {
	const consoleConfig = manifest.console ?? {};
	const viewport = consoleConfig.viewport ?? DEFAULT_WORLD_VIEWPORT;
	const playerIndex = Number(consoleConfig.playerIndex) || DEFAULT_PLAYER_INDEX;
	const moduleId = consoleConfig.moduleId ?? DEFAULT_MODULE_ID;
	const worldViewport = consoleConfig.world?.viewportSize ?? DEFAULT_WORLD_VIEWPORT;
	const canonicalization = consoleConfig.canonicalization;
	return {
		moduleId,
		playerIndex,
		viewport,
		worldViewport,
		canonicalization,
	};
}

export async function startCart(args: BootArgs): Promise<void> {
	const manifest = (args.rompack.manifest ?? null) as CartManifest | null;
	if (!manifest) {
		throw new Error('[start_cart] Cart manifest not found in rompack.');
	}

	const { moduleId, playerIndex, viewport, worldViewport, canonicalization } = deriveConsoleOptions(manifest);
	const meta = deriveMetadata(manifest);
	const program = ensureLuaProgram(args.rompack, manifest);
	const cartridge = createLuaConsoleCartridge({ meta, program });
	const module = createBmsxConsoleModule(cartridge, {
		moduleId,
		playerIndex,
		viewport,
		canonicalization,
	});

	const worldConfig: WorldConfiguration = {
		viewportSize: shallowcopy(worldViewport),
		modules: [module],
	};

	const platform = args.platform;
	if (!platform) {
		throw new Error('[start_cart] Platform instance not provided.');
	}

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
		startingGamepadIndex: args.startingGamepadIndex ?? null,
		enableOnscreenGamepad: args.enableOnscreenGamepad,
		platform,
		viewHost,
	});

	$.view.default_font = new ConsoleFont();

	const inputMapping = buildInputMapping(manifest);
	$.set_inputmap(playerIndex, {
		keyboard: inputMapping.keyboard,
		gamepad: inputMapping.gamepad,
		pointer: Input.clonePointerMapping(),
	});

	$.start();
}
