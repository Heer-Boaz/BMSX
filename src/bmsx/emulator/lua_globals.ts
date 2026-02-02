import { $ } from '../core/engine_core';
import type { StackTraceFrame } from '../lua/luavalue';
import { extractErrorMessage } from '../lua/luavalue';
import { clamp01 } from '../utils/clamp';
import {
	createNativeFunction,
	isNativeFunction,
	isNativeObject,
	Table,
	type Closure,
	type NativeObject,
	type Value,
	type CPU,
} from './cpu';
import { ASSET_TABLE_ENTRY_SIZE, ASSET_TABLE_HEADER_SIZE, type Memory } from './memory';
import {
	ASSET_TABLE_SIZE,
	CART_ROM_BASE,
	CART_ROM_MAGIC_ADDR,
	CART_ROM_MAGIC,
	CART_ROM_SIZE,
	OVERLAY_ROM_BASE,
	RAM_SIZE,
	STRING_HANDLE_COUNT,
	SYSTEM_ROM_BASE,
	VRAM_PRIMARY_ATLAS_BASE,
	VRAM_PRIMARY_ATLAS_SIZE,
	VRAM_SECONDARY_ATLAS_BASE,
	VRAM_SECONDARY_ATLAS_SIZE,
	VRAM_STAGING_BASE,
	VRAM_STAGING_SIZE,
	VRAM_SYSTEM_ATLAS_BASE,
	VRAM_SYSTEM_ATLAS_SIZE,
} from './memory_map';
import {
	DMA_CTRL_START,
	DMA_CTRL_STRICT,
	DMA_STATUS_BUSY,
	DMA_STATUS_CLIPPED,
	DMA_STATUS_DONE,
	DMA_STATUS_ERROR,
	IMG_CTRL_START,
	IMG_STATUS_BUSY,
	IMG_STATUS_CLIPPED,
	IMG_STATUS_DONE,
	IMG_STATUS_ERROR,
	IO_DMA_CTRL,
	IO_DMA_DST,
	IO_DMA_LEN,
	IO_DMA_SRC,
	IO_DMA_STATUS,
	IO_DMA_WRITTEN,
	IO_IMG_CAP,
	IO_IMG_CTRL,
	IO_IMG_DST,
	IO_IMG_LEN,
	IO_IMG_SRC,
	IO_IMG_STATUS,
	IO_IMG_WRITTEN,
	IO_IRQ_ACK,
	IO_IRQ_FLAGS,
	IO_SYS_BOOT_CART,
	IO_SYS_CART_BOOTREADY,
	IO_VDP_DITHER,
	IO_VDP_PRIMARY_ATLAS_ID,
	IO_VDP_RD_DATA,
	IO_VDP_RD_MODE,
	IO_VDP_RD_STATUS,
	IO_VDP_RD_SURFACE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_SECONDARY_ATLAS_ID,
	IRQ_DMA_DONE,
	IRQ_DMA_ERROR,
	IRQ_IMG_DONE,
	IRQ_IMG_ERROR,
	VDP_ATLAS_ID_NONE,
	VDP_RD_MODE_RGBA8888,
	VDP_RD_STATUS_OVERFLOW,
	VDP_RD_STATUS_READY,
} from './io';
import { isStringValue, stringValueToString } from './string_pool';
import type { StringValue } from './string_pool';
import type { TerminalMode } from './terminal_mode';
import type { LuaMarshalContext } from './types';

export type LuaGlobalsContext = {
	api: object;
	registerGlobal: (name: string, value: Value) => void;
	internString: (value: string) => StringValue;
	requireString: (value: Value) => string;
	valueToString: (value: Value) => string;
	valueToStringValue: (value: Value) => StringValue;
	formatValue: (value: Value) => string;
	formatLuaString: (template: string, args: Value[], startIndex: number) => string;
	createApiRuntimeError: (message: string) => Error;
	buildLuaStackFrames: () => StackTraceFrame[];
	callClosure: (callee: Closure, args: Value[]) => Value[];
	nextRandom: () => number;
	setRandomSeed: (seed: number) => void;
	cpu: CPU;
	memory: Memory;
	terminal: TerminalMode;
	cycleBudgetPerFrame: number;
	luaPatternRegexCache: Map<string, RegExp>;
	acquireValueScratch: () => Value[];
	releaseValueScratch: (values: Value[]) => void;
	acquireStringScratch: () => string[];
	releaseStringScratch: (values: string[]) => void;
	buildMarshalContext: () => LuaMarshalContext;
	extendMarshalContext: (ctx: LuaMarshalContext, segment: string) => LuaMarshalContext;
	describeMarshalSegment: (key: Value) => string | null;
	getOrAssignTableId: (table: Table) => number;
	toNativeValue: (value: Value, ctx: LuaMarshalContext, visited: WeakMap<Table, unknown>) => unknown;
	toRuntimeValue: (value: unknown) => Value;
	getOrCreateNativeObject: (value: object) => NativeObject;
	getOrCreateAssetsNativeObject: () => NativeObject;
	nextNativeEntry: (target: NativeObject, key: Value) => [Value, Value] | null;
	requireModule: (name: string) => Value;
	wrapNativeResult: (result: unknown, out: Value[]) => void;
};

export function seedLuaGlobals(ctx: LuaGlobalsContext): void {
	const isTruthy = (value: Value): boolean => value !== null && value !== false;
	const callClosureValue = (callee: Value, args: Value[], out: Value[]): void => {
		if (isNativeFunction(callee)) {
			callee.invoke(args, out);
			return;
		}
		const results = ctx.callClosure(callee as Closure, args);
		out.length = 0;
		for (let index = 0; index < results.length; index += 1) {
			out.push(results[index]);
		}
	};
	const key = (name: string): StringValue => ctx.internString(name);
	const setKey = (table: Table, name: string, value: Value): void => {
		table.set(key(name), value);
	};
	const smoothstep01 = (value: number): number => {
		const x = clamp01(value);
		return x * x * (3 - (2 * x));
	};
	const pingpong01 = (value: number): number => {
		const p = ((value % 2) + 2) % 2;
		return p < 1 ? p : (2 - p);
	};
	const maxSafeInteger = 9007199254740991;
	const radToDeg = 180 / Math.PI;
	const degToRad = Math.PI / 180;

	const typeOfValue = (value: Value): StringValue => {
		if (value === null) {
			return ctx.internString('nil');
		}
		if (typeof value === 'boolean') {
			return ctx.internString('boolean');
		}
		if (typeof value === 'number') {
			return ctx.internString('number');
		}
		if (isStringValue(value)) {
			return ctx.internString('string');
		}
		if (value instanceof Table) {
			return ctx.internString('table');
		}
		if (isNativeFunction(value)) {
			return ctx.internString('function');
		}
		if (isNativeObject(value)) {
			return ctx.internString('native');
		}
		return ctx.internString('function');
	};

	const translateLuaPatternEscape = (token: string, inClass: boolean): string => {
		switch (token) {
			case 'a':
				return inClass ? 'A-Za-z' : '[A-Za-z]';
			case 'd':
				return inClass ? '0-9' : '\\d';
			case 'l':
				return inClass ? 'a-z' : '[a-z]';
			case 'u':
				return inClass ? 'A-Z' : '[A-Z]';
			case 'w':
				return inClass ? 'A-Za-z0-9_' : '[A-Za-z0-9_]';
			case 'x':
				return inClass ? 'A-Fa-f0-9' : '[A-Fa-f0-9]';
			case 'z':
				return '\\x00';
			case 'c':
				return inClass ? '\\x00-\\x1F\\x7F' : '[\\x00-\\x1F\\x7F]';
			case 'g':
				return inClass ? '\\x21-\\x7E' : '[\\x21-\\x7E]';
			case 's':
				return '\\s';
			case 'p': {
				const punctuation = '!\"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
				const escaped = punctuation.replace(/[\\\-\]]/g, '\\$&');
				return inClass ? escaped : `[${escaped}]`;
			}
			case '%':
				return '%';
			default:
				return `\\${token}`;
		}
	};

	const buildLuaPatternRegexSource = (pattern: string): string => {
		let output = '';
		let inClass = false;
		for (let index = 0; index < pattern.length; index += 1) {
			const ch = pattern.charAt(index);
			if (inClass) {
				if (ch === ']') {
					inClass = false;
					output += ']';
					continue;
				}
				if (ch === '%') {
					index += 1;
					if (index >= pattern.length) {
						throw ctx.createApiRuntimeError('string.gmatch invalid pattern.');
					}
					output += translateLuaPatternEscape(pattern.charAt(index), true);
					continue;
				}
				if (ch === '\\') {
					output += '\\\\';
					continue;
				}
				output += ch;
				continue;
			}
			if (ch === '[') {
				inClass = true;
				output += '[';
				continue;
			}
			if (ch === '%') {
				index += 1;
				if (index >= pattern.length) {
					throw ctx.createApiRuntimeError('string.gmatch invalid pattern.');
				}
				output += translateLuaPatternEscape(pattern.charAt(index), false);
				continue;
			}
			if (ch === '-') {
				output += '*?';
				continue;
			}
			if (ch === '^') {
				output += index === 0 ? '^' : '\\^';
				continue;
			}
			if (ch === '$') {
				output += index === pattern.length - 1 ? '$' : '\\$';
				continue;
			}
			if (ch === '(' || ch === ')' || ch === '.' || ch === '+' || ch === '*' || ch === '?') {
				output += ch;
				continue;
			}
			if (ch === '|' || ch === '{' || ch === '}' || ch === '\\') {
				output += `\\${ch}`;
				continue;
			}
			output += ch;
		}
		if (inClass) {
			throw ctx.createApiRuntimeError('string.gmatch invalid pattern.');
		}
		return output;
	};

	const getLuaPatternRegex = (pattern: string): RegExp => {
		const cached = ctx.luaPatternRegexCache.get(pattern);
		if (cached) {
			return cached;
		}
		const source = buildLuaPatternRegexSource(pattern);
		const regex = new RegExp(source);
		ctx.luaPatternRegexCache.set(pattern, regex);
		return regex;
	};

	const createNativeArrayFromTable = (table: Table, context: LuaMarshalContext): unknown[] => {
		const tableId = ctx.getOrAssignTableId(table);
		const tableContext = ctx.extendMarshalContext(context, `table${tableId}`);
		const entries = table.entriesArray();
		const output: unknown[] = [];
		for (let index = 0; index < entries.length; index += 1) {
			const [keyValue, value] = entries[index];
			if (typeof keyValue === 'number' && Number.isInteger(keyValue) && keyValue >= 1) {
				output[keyValue - 1] = ctx.toNativeValue(value, ctx.extendMarshalContext(tableContext, String(keyValue)), new WeakMap());
				continue;
			}
			const segment = ctx.describeMarshalSegment(keyValue);
			const nextContext = segment ? ctx.extendMarshalContext(tableContext, segment) : tableContext;
			output.push(ctx.toNativeValue(value, nextContext, new WeakMap()));
		}
		return output;
	};

	const collectApiMembers = (): Array<{ name: string; kind: 'method' | 'getter'; descriptor: PropertyDescriptor }> => {
		const map = new Map<string, { kind: 'method' | 'getter'; descriptor: PropertyDescriptor }>();
		let prototype: object = Object.getPrototypeOf(ctx.api);
		while (prototype && prototype !== Object.prototype) {
			for (const name of Object.getOwnPropertyNames(prototype)) {
				if (name === 'constructor') continue;
				const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
				if (!descriptor || map.has(name)) continue;
				if (typeof descriptor.value === 'function') {
					map.set(name, { kind: 'method', descriptor });
				} else if (descriptor.get) {
					map.set(name, { kind: 'getter', descriptor });
				}
			}
			prototype = Object.getPrototypeOf(prototype);
		}
		return Array.from(map.entries(), ([name, value]) => ({ name, kind: value.kind, descriptor: value.descriptor }));
	};

	const exposeObjects = (): void => {
		const entries: Array<[string, object]> = [
			['world', $.world],
			['game', $],
			['$', $],
			['registry', $.registry],
		];
		for (const [name, object] of entries) {
			ctx.registerGlobal(name, ctx.getOrCreateNativeObject(object));
		}
		ctx.registerGlobal('assets', ctx.getOrCreateAssetsNativeObject());
		ctx.registerGlobal('cart_manifest', ctx.toRuntimeValue($.assets.manifest));
		ctx.registerGlobal('sys_manifest', ctx.toRuntimeValue($.engine_layer.index.manifest));
	};

	const mathTable = new Table(0, 0);
	setKey(mathTable, 'abs', createNativeFunction('math.abs', (args, out) => {
		const value = args[0] as number;
		out.push(Math.abs(value));
	}));
	setKey(mathTable, 'acos', createNativeFunction('math.acos', (args, out) => {
		out.push(Math.acos(args[0] as number));
	}));
	setKey(mathTable, 'asin', createNativeFunction('math.asin', (args, out) => {
		out.push(Math.asin(args[0] as number));
	}));
	setKey(mathTable, 'atan', createNativeFunction('math.atan', (args, out) => {
		const y = args[0] as number;
		if (args.length > 1) {
			out.push(Math.atan2(y, args[1] as number));
			return;
		}
		out.push(Math.atan(y));
	}));
	setKey(mathTable, 'ceil', createNativeFunction('math.ceil', (args, out) => {
		const value = args[0] as number;
		out.push(Math.ceil(value));
	}));
	setKey(mathTable, 'cos', createNativeFunction('math.cos', (args, out) => {
		out.push(Math.cos(args[0] as number));
	}));
	setKey(mathTable, 'deg', createNativeFunction('math.deg', (args, out) => {
		out.push((args[0] as number) * radToDeg);
	}));
	setKey(mathTable, 'exp', createNativeFunction('math.exp', (args, out) => {
		out.push(Math.exp(args[0] as number));
	}));
	setKey(mathTable, 'floor', createNativeFunction('math.floor', (args, out) => {
		const value = args[0] as number;
		out.push(Math.floor(value));
	}));
	setKey(mathTable, 'fmod', createNativeFunction('math.fmod', (args, out) => {
		out.push((args[0] as number) % (args[1] as number));
	}));
	setKey(mathTable, 'log', createNativeFunction('math.log', (args, out) => {
		const value = args[0] as number;
		if (args.length > 1) {
			const base = args[1] as number;
			out.push(Math.log(value) / Math.log(base));
			return;
		}
		out.push(Math.log(value));
	}));
	setKey(mathTable, 'max', createNativeFunction('math.max', (args, out) => {
		let result = args[0] as number;
		for (let index = 1; index < args.length; index += 1) {
			const value = args[index] as number;
			if (value > result) {
				result = value;
			}
		}
		out.push(result);
	}));
	setKey(mathTable, 'min', createNativeFunction('math.min', (args, out) => {
		let result = args[0] as number;
		for (let index = 1; index < args.length; index += 1) {
			const value = args[index] as number;
			if (value < result) {
				result = value;
			}
		}
		out.push(result);
	}));
	setKey(mathTable, 'modf', createNativeFunction('math.modf', (args, out) => {
		const value = args[0] as number;
		const intPart = Math.trunc(value);
		out.push(intPart, value - intPart);
	}));
	setKey(mathTable, 'rad', createNativeFunction('math.rad', (args, out) => {
		out.push((args[0] as number) * degToRad);
	}));
	setKey(mathTable, 'sin', createNativeFunction('math.sin', (args, out) => {
		out.push(Math.sin(args[0] as number));
	}));
	setKey(mathTable, 'sqrt', createNativeFunction('math.sqrt', (args, out) => {
		const value = args[0] as number;
		out.push(Math.sqrt(value));
	}));
	setKey(mathTable, 'tan', createNativeFunction('math.tan', (args, out) => {
		out.push(Math.tan(args[0] as number));
	}));
	setKey(mathTable, 'tointeger', createNativeFunction('math.tointeger', (args, out) => {
		const value = args.length > 0 ? args[0] : null;
		if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
			out.push(null);
			return;
		}
		out.push(value);
	}));
	setKey(mathTable, 'type', createNativeFunction('math.type', (args, out) => {
		const value = args.length > 0 ? args[0] : null;
		if (typeof value !== 'number') {
			out.push(null);
			return;
		}
		if (Number.isInteger(value)) {
			out.push(ctx.internString('integer'));
			return;
		}
		out.push(ctx.internString('float'));
	}));
	setKey(mathTable, 'ult', createNativeFunction('math.ult', (args, out) => {
		const left = (args[0] as number) >>> 0;
		const right = (args[1] as number) >>> 0;
		out.push(left < right);
	}));
	setKey(mathTable, 'random', createNativeFunction('math.random', (args, out) => {
		const randomValue = ctx.nextRandom();
		if (args.length === 0) {
			out.push(randomValue);
			return;
		}
		if (args.length === 1) {
			const upper = Math.floor(args[0] as number);
			if (upper < 1) {
				throw ctx.createApiRuntimeError('math.random upper bound must be positive.');
			}
			out.push(Math.floor(randomValue * upper) + 1);
			return;
		}
		const lower = Math.floor(args[0] as number);
		const upper = Math.floor(args[1] as number);
		if (upper < lower) {
			throw ctx.createApiRuntimeError('math.random upper bound must be greater than or equal to lower bound.');
		}
		const span = upper - lower + 1;
		out.push(lower + Math.floor(randomValue * span));
	}));
	setKey(mathTable, 'randomseed', createNativeFunction('math.randomseed', (args, out) => {
		const seedValue = args.length > 0 ? (args[0] as number) : $.platform.clock.now();
		ctx.setRandomSeed(Math.floor(seedValue) >>> 0);
		out.length = 0;
	}));
	setKey(mathTable, 'huge', Number.POSITIVE_INFINITY);
	setKey(mathTable, 'maxinteger', maxSafeInteger);
	setKey(mathTable, 'mininteger', -maxSafeInteger);
	setKey(mathTable, 'pi', Math.PI);

	const easingTable = new Table(0, 0);
	setKey(easingTable, 'linear', createNativeFunction('easing.linear', (args, out) => {
		out.push(clamp01(args[0] as number));
	}));
	setKey(easingTable, 'ease_in_quad', createNativeFunction('easing.ease_in_quad', (args, out) => {
		const x = clamp01(args[0] as number);
		out.push(x * x);
	}));
	setKey(easingTable, 'ease_out_quad', createNativeFunction('easing.ease_out_quad', (args, out) => {
		const x = clamp01(1 - (args[0] as number));
		out.push(1 - (x * x));
	}));
	setKey(easingTable, 'ease_in_out_quad', createNativeFunction('easing.ease_in_out_quad', (args, out) => {
		const x = clamp01(args[0] as number);
		if (x < 0.5) {
			out.push(2 * x * x);
			return;
		}
		const y = (-2 * x) + 2;
		out.push(1 - ((y * y) / 2));
	}));
	setKey(easingTable, 'ease_out_back', createNativeFunction('easing.ease_out_back', (args, out) => {
		const x = clamp01(args[0] as number);
		const c1 = 1.70158;
		const c3 = c1 + 1;
		out.push(1 + (c3 * Math.pow(x - 1, 3)) + (c1 * Math.pow(x - 1, 2)));
	}));
	setKey(easingTable, 'smoothstep', createNativeFunction('easing.smoothstep', (args, out) => {
		out.push(smoothstep01(args[0] as number));
	}));
	setKey(easingTable, 'pingpong01', createNativeFunction('easing.pingpong01', (args, out) => {
		out.push(pingpong01(args[0] as number));
	}));
	setKey(easingTable, 'arc01', createNativeFunction('easing.arc01', (args, out) => {
		const value = args[0] as number;
		if (value <= 0.5) {
			out.push(smoothstep01(value * 2));
			return;
		}
		out.push(smoothstep01((1 - value) * 2));
	}));

	ctx.registerGlobal('math', mathTable);
	ctx.registerGlobal('easing', easingTable);
	ctx.registerGlobal('sys_boot_cart', IO_SYS_BOOT_CART);
	ctx.registerGlobal('sys_cart_bootready', IO_SYS_CART_BOOTREADY);
	ctx.registerGlobal('sys_cart_magic_addr', CART_ROM_MAGIC_ADDR);
	ctx.registerGlobal('sys_cart_magic', CART_ROM_MAGIC);
	ctx.registerGlobal('sys_cart_rom_size', CART_ROM_SIZE);
	ctx.registerGlobal('sys_ram_size', RAM_SIZE);
	const maxAssets = Math.floor((ASSET_TABLE_SIZE - ASSET_TABLE_HEADER_SIZE) / ASSET_TABLE_ENTRY_SIZE);
	ctx.registerGlobal('sys_max_assets', maxAssets);
	ctx.registerGlobal('sys_string_handle_count', STRING_HANDLE_COUNT);
	ctx.registerGlobal('sys_max_cycles_per_frame', ctx.cycleBudgetPerFrame);
	ctx.registerGlobal('sys_vdp_dither', IO_VDP_DITHER);
	ctx.registerGlobal('sys_vdp_primary_atlas_id', IO_VDP_PRIMARY_ATLAS_ID);
	ctx.registerGlobal('sys_vdp_secondary_atlas_id', IO_VDP_SECONDARY_ATLAS_ID);
	ctx.registerGlobal('sys_vdp_atlas_none', VDP_ATLAS_ID_NONE);
	ctx.registerGlobal('sys_vdp_rd_surface', IO_VDP_RD_SURFACE);
	ctx.registerGlobal('sys_vdp_rd_x', IO_VDP_RD_X);
	ctx.registerGlobal('sys_vdp_rd_y', IO_VDP_RD_Y);
	ctx.registerGlobal('sys_vdp_rd_mode', IO_VDP_RD_MODE);
	ctx.registerGlobal('sys_vdp_rd_status', IO_VDP_RD_STATUS);
	ctx.registerGlobal('sys_vdp_rd_data', IO_VDP_RD_DATA);
	ctx.registerGlobal('sys_vdp_rd_mode_rgba8888', VDP_RD_MODE_RGBA8888);
	ctx.registerGlobal('sys_vdp_rd_status_ready', VDP_RD_STATUS_READY);
	ctx.registerGlobal('sys_vdp_rd_status_overflow', VDP_RD_STATUS_OVERFLOW);
	ctx.registerGlobal('sys_irq_flags', IO_IRQ_FLAGS);
	ctx.registerGlobal('sys_irq_ack', IO_IRQ_ACK);
	ctx.registerGlobal('sys_dma_src', IO_DMA_SRC);
	ctx.registerGlobal('sys_dma_dst', IO_DMA_DST);
	ctx.registerGlobal('sys_dma_len', IO_DMA_LEN);
	ctx.registerGlobal('sys_dma_ctrl', IO_DMA_CTRL);
	ctx.registerGlobal('sys_dma_status', IO_DMA_STATUS);
	ctx.registerGlobal('sys_dma_written', IO_DMA_WRITTEN);
	ctx.registerGlobal('sys_img_src', IO_IMG_SRC);
	ctx.registerGlobal('sys_img_len', IO_IMG_LEN);
	ctx.registerGlobal('sys_img_dst', IO_IMG_DST);
	ctx.registerGlobal('sys_img_cap', IO_IMG_CAP);
	ctx.registerGlobal('sys_img_ctrl', IO_IMG_CTRL);
	ctx.registerGlobal('sys_img_status', IO_IMG_STATUS);
	ctx.registerGlobal('sys_img_written', IO_IMG_WRITTEN);
	ctx.registerGlobal('sys_rom_system_base', SYSTEM_ROM_BASE);
	ctx.registerGlobal('sys_rom_cart_base', CART_ROM_BASE);
	ctx.registerGlobal('sys_rom_overlay_base', OVERLAY_ROM_BASE);
	ctx.registerGlobal('sys_rom_overlay_size', ctx.memory.getOverlayRomSize());
	ctx.registerGlobal('sys_vram_system_atlas_base', VRAM_SYSTEM_ATLAS_BASE);
	ctx.registerGlobal('sys_vram_primary_atlas_base', VRAM_PRIMARY_ATLAS_BASE);
	ctx.registerGlobal('sys_vram_secondary_atlas_base', VRAM_SECONDARY_ATLAS_BASE);
	ctx.registerGlobal('sys_vram_staging_base', VRAM_STAGING_BASE);
	ctx.registerGlobal('sys_vram_system_atlas_size', VRAM_SYSTEM_ATLAS_SIZE);
	ctx.registerGlobal('sys_vram_primary_atlas_size', VRAM_PRIMARY_ATLAS_SIZE);
	ctx.registerGlobal('sys_vram_secondary_atlas_size', VRAM_SECONDARY_ATLAS_SIZE);
	ctx.registerGlobal('sys_vram_staging_size', VRAM_STAGING_SIZE);
	ctx.registerGlobal('irq_dma_done', IRQ_DMA_DONE);
	ctx.registerGlobal('irq_dma_error', IRQ_DMA_ERROR);
	ctx.registerGlobal('irq_img_done', IRQ_IMG_DONE);
	ctx.registerGlobal('irq_img_error', IRQ_IMG_ERROR);
	ctx.registerGlobal('dma_ctrl_start', DMA_CTRL_START);
	ctx.registerGlobal('dma_ctrl_strict', DMA_CTRL_STRICT);
	ctx.registerGlobal('dma_status_busy', DMA_STATUS_BUSY);
	ctx.registerGlobal('dma_status_done', DMA_STATUS_DONE);
	ctx.registerGlobal('dma_status_error', DMA_STATUS_ERROR);
	ctx.registerGlobal('dma_status_clipped', DMA_STATUS_CLIPPED);
	ctx.registerGlobal('img_ctrl_start', IMG_CTRL_START);
	ctx.registerGlobal('img_status_busy', IMG_STATUS_BUSY);
	ctx.registerGlobal('img_status_done', IMG_STATUS_DONE);
	ctx.registerGlobal('img_status_error', IMG_STATUS_ERROR);
	ctx.registerGlobal('img_status_clipped', IMG_STATUS_CLIPPED);
	ctx.registerGlobal('peek', createNativeFunction('peek', (args, out) => {
		const address = args[0] as number;
		out.push(ctx.memory.readValue(address));
	}));
	ctx.registerGlobal('poke', createNativeFunction('poke', (args, out) => {
		const address = args[0] as number;
		ctx.memory.writeValue(address, args[1]);
		out.length = 0;
	}));
	ctx.registerGlobal('type', createNativeFunction('type', (args, out) => {
		const value = args.length > 0 ? args[0] : null;
		out.push(typeOfValue(value));
	}));
	ctx.registerGlobal('tostring', createNativeFunction('tostring', (args, out) => {
		const value = args.length > 0 ? args[0] : null;
		out.push(ctx.valueToStringValue(value));
	}));
	ctx.registerGlobal('tonumber', createNativeFunction('tonumber', (args, out) => {
		if (args.length === 0) {
			out.push(null);
			return;
		}
		const value = args[0];
		if (typeof value === 'number') {
			out.push(value);
			return;
		}
		if (isStringValue(value)) {
			const text = stringValueToString(value);
			if (args.length >= 2) {
				const baseValue = Math.floor(args[1] as number);
				if (baseValue >= 2 && baseValue <= 36) {
					const parsed = parseInt(text.trim(), baseValue);
					out.push(Number.isFinite(parsed) ? parsed : null);
					return;
				}
			}
			const converted = Number(text);
			out.push(Number.isFinite(converted) ? converted : null);
			return;
		}
		out.push(null);
	}));
	ctx.registerGlobal('assert', createNativeFunction('assert', (args, out) => {
		const condition = args.length > 0 ? args[0] : null;
		if (!isTruthy(condition)) {
			const message = args.length > 1 ? ctx.valueToString(args[1]) : 'assertion failed!';
			throw ctx.createApiRuntimeError(message);
		}
		for (let index = 0; index < args.length; index += 1) {
			out.push(args[index]);
		}
	}));
	ctx.registerGlobal('error', createNativeFunction('error', (args, out) => {
		void out;
		const message = args.length > 0 ? ctx.valueToString(args[0]) : 'error';
		throw ctx.createApiRuntimeError(message);
	}));
	ctx.registerGlobal('setmetatable', createNativeFunction('setmetatable', (args, out) => {
		const target = args[0] as Table;
		const metatable = args.length > 1 ? (args[1] as Table) : null;
		target.setMetatable(metatable);
		out.push(target);
	}));
	ctx.registerGlobal('getmetatable', createNativeFunction('getmetatable', (args, out) => {
		const target = args[0] as Table;
		out.push(target.getMetatable());
	}));
	ctx.registerGlobal('rawequal', createNativeFunction('rawequal', (args, out) => {
		out.push(args[0] === args[1]);
	}));
	ctx.registerGlobal('rawget', createNativeFunction('rawget', (args, out) => {
		const target = args[0] as Table;
		const keyValue = args.length > 1 ? args[1] : null;
		out.push(target.get(keyValue));
	}));
	ctx.registerGlobal('rawset', createNativeFunction('rawset', (args, out) => {
		const target = args[0] as Table;
		const keyValue = args[1];
		const value = args.length > 2 ? args[2] : null;
		target.set(keyValue, value);
		out.push(target);
	}));
	ctx.registerGlobal('select', createNativeFunction('select', (args, out) => {
		const index = args[0];
		const count = args.length - 1;
		if (isStringValue(index) && stringValueToString(index) === '#') {
			out.push(count);
			return;
		}
		const start = (index as number) >= 0
			? (index as number)
			: count + (index as number) + 1;
		for (let i = start; i <= count; i += 1) {
			out.push(args[i]);
		}
	}));
	ctx.registerGlobal('pcall', createNativeFunction('pcall', (args, out) => {
		const fn = args[0];
		const callArgs: Value[] = [];
		for (let index = 1; index < args.length; index += 1) {
			callArgs.push(args[index]);
		}
		try {
			callClosureValue(fn, callArgs, out);
			out.unshift(true);
		} catch (error) {
			out.length = 0;
			out.push(false, ctx.internString(extractErrorMessage(error)));
		}
	}));
	ctx.registerGlobal('xpcall', createNativeFunction('xpcall', (args, out) => {
		const fn = args[0];
		const handler = args[1];
		const callArgs: Value[] = [];
		for (let index = 2; index < args.length; index += 1) {
			callArgs.push(args[index]);
		}
		try {
			callClosureValue(fn, callArgs, out);
			out.unshift(true);
		} catch (error) {
			const handlerArgs: Value[] = [ctx.internString(extractErrorMessage(error))];
			callClosureValue(handler, handlerArgs, out);
			out.unshift(false);
		}
	}));
	ctx.registerGlobal('require', createNativeFunction('require', (args, out) => {
		const moduleName = ctx.requireString(args[0]).trim();
		out.push(ctx.requireModule(moduleName));
	}));
	ctx.registerGlobal('array', createNativeFunction('array', (args, out) => {
		const ctxBase = ctx.buildMarshalContext();
		let result: unknown[] = [];
		if (args.length === 1 && args[0] instanceof Table) {
			result = createNativeArrayFromTable(args[0], ctxBase);
		} else {
			result = new Array(args.length);
			for (let index = 0; index < args.length; index += 1) {
				result[index] = ctx.toNativeValue(args[index], ctxBase, new WeakMap());
			}
		}
		out.push(ctx.getOrCreateNativeObject(result));
	}));
	ctx.registerGlobal('print', createNativeFunction('print', (args, out) => {
		const parts: string[] = [];
		for (let index = 0; index < args.length; index += 1) {
			parts.push(ctx.formatValue(args[index]));
		}
		const text = parts.length === 0 ? '' : parts.join('\t');
		ctx.terminal.appendStdout(text);
		// eslint-disable-next-line no-console
		console.log(text);
		out.length = 0;
	}));

	const utf8CodepointCount = (text: string): number => {
		let count = 0;
		for (const _char of text) {
			count += 1;
		}
		return count;
	};

	const utf8CodepointIndexToUnitIndex = (text: string, codepointIndex: number): number => {
		if (codepointIndex <= 1) {
			return 0;
		}
		let unitIndex = 0;
		let current = 1;
		for (const char of text) {
			if (current === codepointIndex) {
				return unitIndex;
			}
			unitIndex += char.length;
			current += 1;
		}
		return unitIndex;
	};

	const stringTable = new Table(0, 0);
	setKey(stringTable, 'len', createNativeFunction('string.len', (args, out) => {
		const value = args[0] as StringValue;
		out.push(ctx.cpu.getStringPool().codepointCount(value));
	}));
	setKey(stringTable, 'upper', createNativeFunction('string.upper', (args, out) => {
		const text = ctx.requireString(args[0]);
		out.push(ctx.internString(text.toUpperCase()));
	}));
	setKey(stringTable, 'lower', createNativeFunction('string.lower', (args, out) => {
		const text = ctx.requireString(args[0]);
		out.push(ctx.internString(text.toLowerCase()));
	}));
	setKey(stringTable, 'rep', createNativeFunction('string.rep', (args, out) => {
		const text = ctx.requireString(args[0]);
		const count = Math.floor(args.length > 1 ? (args[1] as number) : 1);
		if (count <= 0) {
			out.push(ctx.internString(''));
			return;
		}
		const hasSeparator = args.length > 2 && args[2] !== null;
		const separator = hasSeparator ? ctx.requireString(args[2]) : '';
		let output = '';
		if (hasSeparator) {
			for (let index = 0; index < count; index += 1) {
				if (index > 0) {
					output += separator;
				}
				output += text;
			}
		} else {
			for (let index = 0; index < count; index += 1) {
				output += text;
			}
		}
		out.push(ctx.internString(output));
	}));
	setKey(stringTable, 'sub', createNativeFunction('string.sub', (args, out) => {
		const value = args[0] as StringValue;
		const text = stringValueToString(value);
		const length = ctx.cpu.getStringPool().codepointCount(value);
		const normalizeIndex = (valueNumber: number): number => {
			const integer = Math.floor(valueNumber);
			if (integer > 0) {
				return integer;
			}
			if (integer < 0) {
				return length + integer + 1;
			}
			return 1;
		};
		const startArg = args.length > 1 ? (args[1] as number) : 1;
		const endArg = args.length > 2 ? (args[2] as number) : length;
		let startIndex = normalizeIndex(startArg);
		let endIndex = normalizeIndex(endArg);
		if (startIndex < 1) {
			startIndex = 1;
		}
		if (endIndex > length) {
			endIndex = length;
		}
		if (endIndex < startIndex) {
			out.push(ctx.internString(''));
			return;
		}
		const startUnit = utf8CodepointIndexToUnitIndex(text, startIndex);
		const endUnit = utf8CodepointIndexToUnitIndex(text, endIndex + 1);
		out.push(ctx.internString(text.slice(startUnit, endUnit)));
	}));
	setKey(stringTable, 'find', createNativeFunction('string.find', (args, out) => {
		const sourceValue = args[0] as StringValue;
		const source = stringValueToString(sourceValue);
		const pattern = args.length > 1 ? stringValueToString(args[1] as StringValue) : '';
		const length = ctx.cpu.getStringPool().codepointCount(sourceValue);
		const normalizeIndex = (valueNumber: number): number => {
			const integer = Math.floor(valueNumber);
			if (integer > 0) {
				return integer;
			}
			if (integer < 0) {
				return length + integer + 1;
			}
			return 1;
		};
		const startIndex = args.length > 2 ? normalizeIndex(args[2] as number) : 1;
		if (startIndex > length) {
			out.push(null);
			return;
		}
		const startUnit = utf8CodepointIndexToUnitIndex(source, startIndex);
		const plain = args.length > 3 && args[3] === true;
		if (plain) {
			const position = source.indexOf(pattern, Math.max(0, startUnit));
			if (position === -1) {
				out.push(null);
				return;
			}
			const first = utf8CodepointCount(source.slice(0, position)) + 1;
			const last = utf8CodepointCount(source.slice(0, position + pattern.length));
			out.push(first, last);
			return;
		}
		const regex = getLuaPatternRegex(pattern);
		const slice = source.slice(Math.max(0, startUnit));
		const match = regex.exec(slice);
		if (!match) {
			out.push(null);
			return;
		}
		const matchStartUnit = startUnit + match.index;
		const matchEndUnit = matchStartUnit + match[0].length;
		const first = utf8CodepointCount(source.slice(0, matchStartUnit)) + 1;
		const last = utf8CodepointCount(source.slice(0, matchEndUnit));
		if (match.length > 1) {
			out.push(first, last);
			for (let index = 1; index < match.length; index += 1) {
				const value = match[index];
				out.push(value === undefined ? null : ctx.internString(value));
			}
			return;
		}
		out.push(first, last);
	}));
	setKey(stringTable, 'match', createNativeFunction('string.match', (args, out) => {
		const sourceValue = args[0] as StringValue;
		const source = stringValueToString(sourceValue);
		const pattern = args.length > 1 ? stringValueToString(args[1] as StringValue) : '';
		const length = ctx.cpu.getStringPool().codepointCount(sourceValue);
		const normalizeIndex = (valueNumber: number): number => {
			const integer = Math.floor(valueNumber);
			if (integer > 0) {
				return integer;
			}
			if (integer < 0) {
				return length + integer + 1;
			}
			return 1;
		};
		const startIndex = args.length > 2 ? normalizeIndex(args[2] as number) : 1;
		if (startIndex > length) {
			out.push(null);
			return;
		}
		const regex = getLuaPatternRegex(pattern);
		const startUnit = utf8CodepointIndexToUnitIndex(source, startIndex);
		const slice = source.slice(Math.max(0, startUnit));
		const match = regex.exec(slice);
		if (!match) {
			out.push(null);
			return;
		}
		if (match.length > 1) {
			for (let index = 1; index < match.length; index += 1) {
				const value = match[index];
				out.push(value === undefined ? null : ctx.internString(value));
			}
			return;
		}
		out.push(ctx.internString(match[0]));
	}));
	setKey(stringTable, 'gsub', createNativeFunction('string.gsub', (args, out) => {
		const source = ctx.requireString(args[0]);
		const pattern = args.length > 1 ? ctx.requireString(args[1]) : '';
		const replacement = args.length > 2 ? args[2] : ctx.internString('');
		const maxReplacements = args.length > 3 && args[3] !== null
			? Math.max(0, Math.floor(args[3] as number))
			: Number.POSITIVE_INFINITY;

		const regex = getLuaPatternRegex(pattern);

		let count = 0;
		let result = '';
		let searchIndex = 0;
		let lastIndex = 0;
		const fnArgs = ctx.acquireValueScratch();
		const fnResults = ctx.acquireValueScratch();
		try {
			const renderReplacement = (match: RegExpExecArray): string => {
				if (isStringValue(replacement) || typeof replacement === 'number') {
					const template = isStringValue(replacement) ? stringValueToString(replacement) : String(replacement);
					return template.replace(/%([0-9%])/g, (_full, token) => {
						if (token === '%') {
							return '%';
						}
						const index = parseInt(token, 10);
						if (!Number.isFinite(index)) {
							return token;
						}
						if (index === 0) {
							return match[0] ?? '';
						}
						const value = match[index];
						return value === undefined ? '' : value;
					});
				}
				if (replacement instanceof Table) {
					if (match.length > 1 && match[1] === undefined) {
						return match[0];
					}
					const keyValue = match.length > 1
						? ctx.internString(match[1])
						: ctx.internString(match[0]);
					const mapped = replacement.get(keyValue);
					return mapped === null ? match[0] : ctx.valueToString(mapped);
				}
				if (isNativeFunction(replacement) || (replacement !== null && typeof replacement === 'object' && 'protoIndex' in replacement)) {
					fnArgs.length = 0;
					fnResults.length = 0;
					if (match.length > 1) {
						for (let index = 1; index < match.length; index += 1) {
							const value = match[index];
							fnArgs.push(value === undefined ? null : ctx.internString(value));
						}
						if (fnArgs.length === 0) {
							fnArgs.push(ctx.internString(match[0]));
						}
					} else {
						fnArgs.push(ctx.internString(match[0]));
					}
					callClosureValue(replacement, fnArgs, fnResults);
					const value = fnResults.length > 0 ? fnResults[0] : null;
					if (value === null || value === false) {
						return match[0];
					}
					return ctx.valueToString(value);
				}
				throw ctx.createApiRuntimeError('string.gsub replacement must be a string, number, function, or table.');
			};

			while (count < maxReplacements) {
				if (searchIndex > source.length) {
					break;
				}
				const match = regex.exec(source.slice(searchIndex));
				if (!match) {
					break;
				}
				const start = searchIndex + match.index;
				const end = start + match[0].length;
				result += source.slice(lastIndex, start);
				result += renderReplacement(match);
				lastIndex = end;
				count += 1;
				if (match[0].length === 0) {
					searchIndex = end + 1;
				} else {
					searchIndex = end;
				}
			}

			result += source.slice(lastIndex);
			out.push(ctx.internString(result), count);
		} finally {
			ctx.releaseValueScratch(fnResults);
			ctx.releaseValueScratch(fnArgs);
		}
	}));
	setKey(stringTable, 'gmatch', createNativeFunction('string.gmatch', (args, out) => {
		const source = ctx.requireString(args[0]);
		const pattern = args.length > 1 ? ctx.requireString(args[1]) : '';
		const regex = getLuaPatternRegex(pattern);
		const state = { index: 0 };
		const iterator = createNativeFunction('string.gmatch.iterator', (_args, iterOut) => {
			if (state.index > source.length) {
				iterOut.push(null);
				return;
			}
			const match = regex.exec(source.slice(state.index));
			if (!match) {
				iterOut.push(null);
				return;
			}
			const matchStart = state.index + match.index;
			const matchEnd = matchStart + match[0].length;
			if (match[0].length === 0) {
				state.index = matchEnd + 1;
			} else {
				state.index = matchEnd;
			}
			if (match.length > 1) {
				for (let index = 1; index < match.length; index += 1) {
					const value = match[index];
					iterOut.push(value === undefined ? null : ctx.internString(value));
				}
				return;
			}
			iterOut.push(ctx.internString(match[0]));
		});
		out.push(iterator);
	}));
	setKey(stringTable, 'byte', createNativeFunction('string.byte', (args, out) => {
		const source = ctx.requireString(args[0]);
		const positionArg = args.length > 1 ? (args[1] as number) : 1;
		const position = Math.floor(positionArg);
		if (position < 1) {
			out.push(null);
			return;
		}
		let current = 1;
		for (const char of source) {
			if (current === position) {
				out.push(char.codePointAt(0) as number);
				return;
			}
			current += 1;
		}
		out.push(null);
	}));
	setKey(stringTable, 'char', createNativeFunction('string.char', (args, out) => {
		if (args.length === 0) {
			out.push(ctx.internString(''));
			return;
		}
		let result = '';
		for (let index = 0; index < args.length; index += 1) {
			const code = args[index] as number;
			result += String.fromCodePoint(Math.floor(code));
		}
		out.push(ctx.internString(result));
	}));
	setKey(stringTable, 'format', createNativeFunction('string.format', (args, out) => {
		const template = ctx.requireString(args[0]);
		const formatted = ctx.formatLuaString(template, args, 1);
		out.push(ctx.internString(formatted));
	}));
	ctx.registerGlobal('string', stringTable);

	const tableLibrary = new Table(0, 0);
	setKey(tableLibrary, 'insert', createNativeFunction('table.insert', (args, out) => {
		const target = args[0] as Table;
		let position: number;
		let value: Value;
		if (args.length === 2) {
			value = args[1];
			position = target.length() + 1;
		} else {
			position = Math.floor(args[1] as number);
			value = args[2];
		}
		const length = target.length();
		for (let index = length; index >= position; index -= 1) {
			target.set(index + 1, target.get(index));
		}
		target.set(position, value);
		out.length = 0;
	}));
	setKey(tableLibrary, 'remove', createNativeFunction('table.remove', (args, out) => {
		const target = args[0] as Table;
		const position = args.length > 1 ? Math.floor(args[1] as number) : target.length();
		const length = target.length();
		const removed = target.get(position);
		for (let index = position; index < length; index += 1) {
			target.set(index, target.get(index + 1));
		}
		target.set(length, null);
		if (removed !== null) {
			out.push(removed);
		}
	}));
	setKey(tableLibrary, 'concat', createNativeFunction('table.concat', (args, out) => {
		const target = args[0] as Table;
		const separator = args.length > 1 ? ctx.requireString(args[1]) : '';
		const length = target.length();
		const normalizeIndex = (valueNumber: number, fallback: number): number => {
			const integer = Math.floor(valueNumber);
			if (integer > 0) {
				return integer;
			}
			if (integer < 0) {
				return length + integer + 1;
			}
			return fallback;
		};
		const startIndex = args.length > 2 ? normalizeIndex(args[2] as number, 1) : 1;
		const endIndex = args.length > 3 ? normalizeIndex(args[3] as number, length) : length;
		if (endIndex < startIndex) {
			out.push(ctx.internString(''));
			return;
		}
		const parts = ctx.acquireStringScratch();
		try {
			for (let index = startIndex; index <= endIndex; index += 1) {
				const value = target.get(index);
				parts.push(value === null ? '' : ctx.valueToString(value));
			}
			out.push(ctx.internString(parts.join(separator)));
		} finally {
			ctx.releaseStringScratch(parts);
		}
	}));
	setKey(tableLibrary, 'pack', createNativeFunction('table.pack', (args, out) => {
		const target = new Table(args.length, 1);
		for (let index = 0; index < args.length; index += 1) {
			target.set(index + 1, args[index]);
		}
		target.set(key('n'), args.length);
		out.push(target);
	}));
	setKey(tableLibrary, 'unpack', createNativeFunction('table.unpack', (args, out) => {
		const target = args[0] as Table;
		const length = target.length();
		const normalizeIndex = (valueNumber: number, fallback: number): number => {
			const integer = Math.floor(valueNumber);
			if (integer > 0) {
				return integer;
			}
			if (integer < 0) {
				return length + integer + 1;
			}
			return fallback;
		};
		const startIndex = args.length > 1 ? normalizeIndex(args[1] as number, 1) : 1;
		const endIndex = args.length > 2 ? normalizeIndex(args[2] as number, length) : length;
		if (endIndex < startIndex) {
			return;
		}
		for (let index = startIndex; index <= endIndex; index += 1) {
			out.push(target.get(index));
		}
	}));
	setKey(tableLibrary, 'sort', createNativeFunction('table.sort', (args, out) => {
		const target = args[0] as Table;
		const comparator = args.length > 1 ? args[1] : null;
		const length = target.length();
		const values = ctx.acquireValueScratch();
		const comparatorArgs = ctx.acquireValueScratch();
		const comparatorResults = ctx.acquireValueScratch();
		try {
			values.length = length;
			for (let index = 1; index <= length; index += 1) {
				values[index - 1] = target.get(index);
			}
			comparatorArgs.length = 2;
			comparatorArgs[0] = null;
			comparatorArgs[1] = null;
			values.sort((left, right) => {
				if (comparator !== null) {
					comparatorArgs[0] = left;
					comparatorArgs[1] = right;
					comparatorResults.length = 0;
					callClosureValue(comparator, comparatorArgs, comparatorResults);
					return comparatorResults[0] === true ? -1 : 1;
				}
				if (typeof left === 'number' && typeof right === 'number') {
					return left - right;
				}
				if (isStringValue(left) && isStringValue(right)) {
					if (left === right) {
						return 0;
					}
					return stringValueToString(left) < stringValueToString(right) ? -1 : 1;
				}
				throw ctx.createApiRuntimeError('table.sort comparison expects numbers or strings.');
			});
			for (let index = 1; index <= length; index += 1) {
				target.set(index, values[index - 1]);
			}
			out.push(target);
		} finally {
			ctx.releaseValueScratch(comparatorResults);
			ctx.releaseValueScratch(comparatorArgs);
			ctx.releaseValueScratch(values);
		}
	}));
	ctx.registerGlobal('table', tableLibrary);

	const osTable = new Table(0, 0);
	const formatOsDate = (format: string, date: Date): string => {
		const pad = (value: number, size: number): string => {
			let text = Math.floor(value).toString();
			while (text.length < size) {
				text = `0${text}`;
			}
			return text;
		};
		const weekdaysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		const weekdaysLong = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const monthsLong = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
		const year = date.getFullYear();
		const month = date.getMonth() + 1;
		const day = date.getDate();
		const hour = date.getHours();
		const min = date.getMinutes();
		const sec = date.getSeconds();
		const ydayStart = new Date(year, 0, 1);
		const yday = Math.floor((date.getTime() - ydayStart.getTime()) / 86400000) + 1;
		const wday = date.getDay();
		const hour12 = hour % 12 === 0 ? 12 : hour % 12;
		const ampm = hour < 12 ? 'AM' : 'PM';
		let output = '';
		for (let index = 0; index < format.length; index += 1) {
			const ch = format.charAt(index);
			if (ch !== '%') {
				output += ch;
				continue;
			}
			index += 1;
			const code = format.charAt(index);
			switch (code) {
				case 'Y':
					output += pad(year, 4);
					break;
				case 'y':
					output += pad(year % 100, 2);
					break;
				case 'm':
					output += pad(month, 2);
					break;
				case 'd':
					output += pad(day, 2);
					break;
				case 'H':
					output += pad(hour, 2);
					break;
				case 'M':
					output += pad(min, 2);
					break;
				case 'S':
					output += pad(sec, 2);
					break;
				case 'I':
					output += pad(hour12, 2);
					break;
				case 'p':
					output += ampm;
					break;
				case 'a':
					output += weekdaysShort[wday];
					break;
				case 'A':
					output += weekdaysLong[wday];
					break;
				case 'b':
					output += monthsShort[month - 1];
					break;
				case 'B':
					output += monthsLong[month - 1];
					break;
				case 'j':
					output += pad(yday, 3);
					break;
				case 'w':
					output += wday.toString();
					break;
				case 'c':
					output += date.toLocaleString();
					break;
				case 'x':
					output += date.toLocaleDateString();
					break;
				case 'X':
					output += date.toLocaleTimeString();
					break;
				case 'Z': {
					const tz = date.toTimeString();
					const start = tz.indexOf('(');
					const end = tz.lastIndexOf(')');
					if (start !== -1 && end !== -1 && end > start) {
						output += tz.slice(start + 1, end);
					} else {
						output += 'UTC';
					}
					break;
				}
				case '%':
					output += '%';
					break;
				default:
					output += `%${code}`;
					break;
			}
		}
		return output;
	};
	const buildOsDateTable = (date: Date): Table => {
		const year = date.getFullYear();
		const ydayStart = new Date(year, 0, 1);
		const yday = Math.floor((date.getTime() - ydayStart.getTime()) / 86400000) + 1;
		const jan = new Date(year, 0, 1);
		const jul = new Date(year, 6, 1);
		const isDst = date.getTimezoneOffset() < Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
		const table = new Table(0, 9);
		setKey(table, 'year', year);
		setKey(table, 'month', date.getMonth() + 1);
		setKey(table, 'day', date.getDate());
		setKey(table, 'hour', date.getHours());
		setKey(table, 'min', date.getMinutes());
		setKey(table, 'sec', date.getSeconds());
		setKey(table, 'wday', date.getDay() + 1);
		setKey(table, 'yday', yday);
		setKey(table, 'isdst', isDst);
		return table;
	};
	setKey(osTable, 'clock', createNativeFunction('os.clock', (_args, out) => {
		out.push($.platform.clock.now() / 1000);
	}));
	setKey(osTable, 'time', createNativeFunction('os.time', (args, out) => {
		if (args.length > 0 && args[0] !== null) {
			const table = args[0] as Table;
			const year = table.get(key('year')) as number;
			const month = table.get(key('month')) as number;
			const day = table.get(key('day')) as number;
			const hour = table.get(key('hour')) as number;
			const min = table.get(key('min')) as number;
			const sec = table.get(key('sec')) as number;
			const date = new Date(year, month - 1, day, hour, min, sec);
			out.push(Math.floor(date.getTime() / 1000));
			return;
		}
		out.push(Math.floor(Date.now() / 1000));
	}));
	setKey(osTable, 'difftime', createNativeFunction('os.difftime', (args, out) => {
		const t2 = args[0] as number;
		const t1 = args[1] as number;
		out.push(t2 - t1);
	}));
	setKey(osTable, 'date', createNativeFunction('os.date', (args, out) => {
		const format = args.length > 0 && args[0] !== null ? ctx.requireString(args[0]) : '%c';
		const timeValue = args.length > 1 && args[1] !== null ? (args[1] as number) * 1000 : Date.now();
		const date = new Date(timeValue);
		if (format === '*t') {
			out.push(buildOsDateTable(date));
			return;
		}
		out.push(ctx.internString(formatOsDate(format, date)));
	}));
	ctx.registerGlobal('os', osTable);

	const nextFn = createNativeFunction('next', (args, out) => {
		const target = args[0];
		const keyValue = args.length > 1 ? args[1] : null;
		if (target instanceof Table) {
			const entry = target.nextEntry(keyValue);
			if (entry === null) {
				out.push(null);
				return;
			}
			out.push(entry[0], entry[1]);
			return;
		}
		if (isNativeObject(target)) {
			const entry = ctx.nextNativeEntry(target, keyValue);
			if (entry === null) {
				out.push(null);
				return;
			}
			out.push(entry[0], entry[1]);
			return;
		}
		throw ctx.createApiRuntimeError('next expects a table or native object.');
	});
	const ipairsIterator = createNativeFunction('ipairs.iterator', (args, out) => {
		const target = args[0];
		const index = args[1] as number;
		const nextIndex = Math.floor(index) + 1;
		if (target instanceof Table) {
			const value = target.get(nextIndex);
			if (value === null) {
				out.push(null);
				return;
			}
			out.push(nextIndex, value);
			return;
		}
		if (isNativeObject(target)) {
			const raw = target.raw as object;
			if (Array.isArray(raw)) {
				const value = (raw as unknown[])[nextIndex - 1];
				if (value === undefined || value === null) {
					out.push(null);
					return;
				}
				out.push(nextIndex, ctx.toRuntimeValue(value));
				return;
			}
			const value = (raw as Record<string, unknown>)[String(nextIndex)];
			if (value === undefined || value === null) {
				out.push(null);
				return;
			}
			out.push(nextIndex, ctx.toRuntimeValue(value));
			return;
		}
		throw ctx.createApiRuntimeError('ipairs expects a table or native object.');
	});
	ctx.registerGlobal('next', nextFn);
	ctx.registerGlobal('pairs', createNativeFunction('pairs', (args, out) => {
		const target = args[0];
		if (!(target instanceof Table) && !isNativeObject(target)) {
			const stack = ctx.buildLuaStackFrames()
				.map(frame => `${frame.source ?? '<unknown>'}:${frame.line ?? '?'}:${frame.column ?? '?'}`)
				.join(' <- ');
			throw ctx.createApiRuntimeError(`pairs expects a table or native object (got ${ctx.formatValue(target)}). stack=${stack}`);
		}
		out.push(nextFn, target, null);
	}));
	ctx.registerGlobal('ipairs', createNativeFunction('ipairs', (args, out) => {
		const target = args[0];
		if (!(target instanceof Table) && !isNativeObject(target)) {
			throw ctx.createApiRuntimeError('ipairs expects a table or native object.');
		}
		out.push(ipairsIterator, target, 0);
	}));

	const members = collectApiMembers();
	for (const { name, kind, descriptor } of members) {
		if (kind === 'method') {
			const callable = descriptor.value as (...args: unknown[]) => unknown;
			const native = createNativeFunction(`api.${name}`, (args, out) => {
				const ctxBase = ctx.buildMarshalContext();
				const visited = new WeakMap<Table, unknown>();
				const jsArgs: unknown[] = [];
				for (let index = 0; index < args.length; index += 1) {
					const nextCtx = ctx.extendMarshalContext(ctxBase, `arg${index}`);
					jsArgs.push(ctx.toNativeValue(args[index], nextCtx, visited));
				}
				try {
					const result = callable.apply(ctx.api, jsArgs);
					ctx.wrapNativeResult(result, out);
				} catch (error) {
					const message = extractErrorMessage(error);
					throw ctx.createApiRuntimeError(`[api.${name}] ${message}`);
				}
			});
			ctx.registerGlobal(name, native);
			continue;
		}
		if (descriptor.get) {
			const getter = descriptor.get;
			const native = createNativeFunction(`api.${name}`, (_args, out) => {
				try {
					const result = getter.call(ctx.api);
					ctx.wrapNativeResult(result, out);
				} catch (error) {
					const message = extractErrorMessage(error);
					throw ctx.createApiRuntimeError(`[api.${name}] ${message}`);
				}
			});
			ctx.registerGlobal(name, native);
		}
	}

	exposeObjects();
}
