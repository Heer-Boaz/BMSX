import { $, Input, type BootArgs, type WorldConfiguration, type KeyboardButton, type BGamepadButton, shallowcopy, } from '../index';
import { createBmsxConsoleModule } from './module';
import { ConsoleFont } from './font';
import type { ManifestInputMapping } from './types';
import type { BmsxCartridge, LifeCycleHandlers } from 'bmsx/rompack/rompack';
import { MSX2ScreenHeight } from '../index';
import { MSX2ScreenWidth } from '../index';
import type { CanonicalizationType, RomLuaAsset, RomPack, Viewport } from '../rompack/rompack';
import { IdeThemeVariant } from './ide/types';

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
	persistent_id: 'bmsx_cart',
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

function ensureLuaProgram(rompack: RomPack, manifest: CartManifest): string {
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

	let luaAssets: RomLuaAsset[] = Object.values(rompack.lua);
	if (luaAssets.length === 0) {
		const placeholder: RomLuaAsset = {
			resid: placeholderId,
			type: 'lua',
			src: placeholderSource,
			source_path: 'placeholder.lua',
			chunk_name: '@placeholder.lua',
		};
		rompack.lua[placeholderId] = placeholder;
		luaAssets = [placeholder];
	}
	for (const asset of luaAssets) {
		if (!asset.chunk_name || asset.chunk_name.length === 0) {
			const path = asset.source_path;
			asset.chunk_name = path && path.length > 0 ? `@${path}` : `@lua/${asset.resid}`;
		}
		if (!asset.normalized_source_path || asset.normalized_source_path.length === 0) {
			asset.normalized_source_path = asset.source_path && asset.source_path.length > 0 ? asset.source_path : asset.resid;
		}
	}
	const manifestEntryId = manifest.lua?.entryAssetId;
	const entryAsset = (manifestEntryId && rompack.lua[manifestEntryId])
		? rompack.lua[manifestEntryId]
		: luaAssets[0];
	return entryAsset.resid;
}

function deriveMetadata(manifest: CartManifest) {
	const meta = manifest.metadata ?? {};
	return {
		title: manifest.title ?? DEFAULT_META.title,
		persistent_id: meta.persistentId ?? DEFAULT_META.persistent_id,
		ide_theme: meta.ideTheme,
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
	const entry = ensureLuaProgram(args.rompack, manifest);
	const chunk2lua: Record<string, RomLuaAsset> = {};
	const source2lua: Record<string, RomLuaAsset> = {};
	for (const asset of Object.values(args.rompack.lua)) {
		if (asset.chunk_name) {
			chunk2lua[asset.chunk_name] = asset;
		}
		if (asset.normalized_source_path) {
			source2lua[asset.normalized_source_path] = asset;
		}
	}
	const cartridge: BmsxCartridge = {
		meta,
		lua: args.rompack.lua,
		chunk2lua,
		source2lua,
		entry,
		new_game: null,
		init(): void {},
		update(): void {},
		draw(): void {},
	};
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
