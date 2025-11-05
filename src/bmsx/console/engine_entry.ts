import {
	$,
	Input,
	type BootArgs,
	type WorldConfiguration,
	type KeyboardButton,
	type BGamepadButton,
} from '../index';
import { createBmsxConsoleModule } from './module';
import { createLuaConsoleCartridge } from './lua';
import * as bmsxNamespace from '../index';
import '../../bmsxconsole/runtime/actors/lua_demo_actor';

type ManifestViewport = { width?: number; height?: number };
type ManifestWorldViewport = { x?: number; y?: number };

type ManifestInputMapping = Record<string, string[] | undefined>;

type ManifestLuaEntryPoints = {
	init?: string;
	update?: string;
	draw?: string;
};

type CartManifest = {
	title?: string;
	short_name?: string;
	rom_name?: string;
	metadata?: {
		version?: string;
		persistentId?: string;
	};
	console?: {
		moduleId?: string;
		playerIndex?: number;
		viewport?: ManifestViewport;
		world?: {
			viewportSize?: ManifestWorldViewport;
		};
		caseInsensitiveLua?: boolean;
	};
	input?: {
		keyboard?: ManifestInputMapping;
		gamepad?: ManifestInputMapping;
	};
	lua?: {
		assetId?: string;
		chunkName?: string;
		entry?: ManifestLuaEntryPoints;
	};
};

const DEFAULT_META = {
	title: 'BMSX Cart',
	version: '1.0.0',
	persistentId: 'bmsx_cart',
};

const DEFAULT_MODULE_ID = 'bmsx-console';
const DEFAULT_PLAYER_INDEX = 1;
const DEFAULT_VIEWPORT = { width: 128, height: 128 };
const DEFAULT_WORLD_VIEWPORT = { x: 256, y: 212 };

const DEFAULT_KEYBOARD_MAPPING: ManifestInputMapping = {
	console_left: ['ArrowLeft'],
	console_right: ['ArrowRight'],
	console_up: ['ArrowUp'],
	console_down: ['ArrowDown'],
	console_o: ['KeyZ'],
	console_x: ['KeyX'],
};

const DEFAULT_GAMEPAD_MAPPING: ManifestInputMapping = {
	console_left: ['left'],
	console_right: ['right'],
	console_up: ['up'],
	console_down: ['down'],
	console_o: ['b'],
	console_x: ['a'],
};

declare global {
	// eslint-disable-next-line no-var
	var bmsx: typeof import('../index');
	// eslint-disable-next-line no-var
	var h406A: (args: BootArgs) => Promise<void>;
}

const globalTarget = globalThis as typeof globalThis & { bmsx?: typeof import('../index') };
globalTarget.bmsx = bmsxNamespace;

function normalizeViewport(candidate?: ManifestViewport): { width: number; height: number } {
	const width = Number(candidate?.width) || DEFAULT_VIEWPORT.width;
	const height = Number(candidate?.height) || DEFAULT_VIEWPORT.height;
	return { width, height };
}

function normalizeWorldViewport(candidate?: ManifestWorldViewport): { x: number; y: number } {
	const x = Number(candidate?.x) || DEFAULT_WORLD_VIEWPORT.x;
	const y = Number(candidate?.y) || DEFAULT_WORLD_VIEWPORT.y;
	return { x, y };
}

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

	// Ensure every action has an array even if empty to avoid runtime checks.
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

function deriveLuaProgram(manifest: CartManifest) {
	const luaConfig = manifest.lua ?? {};
	const assetId = luaConfig.assetId;
	if (!assetId || assetId.length === 0) {
		throw new Error('[engine_entry] Cart manifest is missing lua.assetId.');
	}
	const chunkName = luaConfig.chunkName && luaConfig.chunkName.length > 0
		? luaConfig.chunkName
		: assetId;
	const entry = luaConfig.entry ?? {};
	return {
		assetId,
		chunkName,
		entry: {
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
	};
}

function deriveConsoleOptions(manifest: CartManifest) {
	const consoleConfig = manifest.console ?? {};
	const viewport = normalizeViewport(consoleConfig.viewport);
	const playerIndex = Number(consoleConfig.playerIndex) || DEFAULT_PLAYER_INDEX;
	const moduleId = consoleConfig.moduleId ?? DEFAULT_MODULE_ID;
	const caseInsensitiveLua = consoleConfig.caseInsensitiveLua;
	const worldViewport = normalizeWorldViewport(consoleConfig.world?.viewportSize);
	return {
		moduleId,
		playerIndex,
		viewport,
		worldViewport,
		caseInsensitiveLua,
	};
}

async function startCart(args: BootArgs): Promise<void> {
	const manifest = (args.rompack.manifest ?? null) as CartManifest | null;
	if (!manifest) {
		throw new Error('[engine_entry] Cart manifest not found in rompack.');
	}

	const { moduleId, playerIndex, viewport, worldViewport, caseInsensitiveLua } = deriveConsoleOptions(manifest);
	const meta = deriveMetadata(manifest);
	const program = deriveLuaProgram(manifest);
	const cartridge = createLuaConsoleCartridge({ meta, program });
	const module = createBmsxConsoleModule(cartridge, {
		moduleId,
		playerIndex,
		viewport,
		caseInsensitiveLua,
	});

	const worldConfig: WorldConfiguration = {
		viewportSize: { x: worldViewport.x, y: worldViewport.y },
		modules: [module],
	};

	const platform = args.platform;
	if (!platform) {
		throw new Error('[engine_entry] Platform instance not provided.');
	}

	const viewHost = args.viewHost ?? platform.gameviewHost;
	if (!viewHost) {
		throw new Error('[engine_entry] View host not provided by platform.');
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

	const inputMapping = buildInputMapping(manifest);
	$.setInputMap(playerIndex, {
		keyboard: inputMapping.keyboard,
		gamepad: inputMapping.gamepad,
		pointer: Input.clonePointerMapping(),
	});

	$.start();
}

globalThis.h406A = startCart;
