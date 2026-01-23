import { $ } from '../core/engine_core';
import { InputMap } from '../input/inputtypes';
import { LuaEnvironment } from '../lua/luaenvironment';
import { LuaError, LuaRuntimeError, LuaSyntaxError } from '../lua/luaerrors';
import { LuaInterpreter, LuaNativeFunction } from '../lua/luaruntime';
import { extractErrorMessage, LuaFunctionValue, LuaNativeValue } from '../lua/luavalue';
import { isLuaTable, LuaTable, LuaValue } from '../lua/luavalue';
import { arrayify } from '../utils/arrayify';
import { VM_API_METHOD_METADATA } from './vm_api_metadata';
import { api, BmsxVMRuntime } from './vm_runtime';
import type { VMLuaBuiltinDescriptor } from './types';

export const ENGINE_LUA_BUILTIN_FUNCTIONS: ReadonlyArray<VMLuaBuiltinDescriptor> = [
	{ name: 'define_fsm', params: ['id', 'blueprint'], signature: 'define_fsm(id, blueprint)' },
	{ name: 'define_world_object', params: ['definition'], signature: 'define_world_object(definition)' },
	{ name: 'define_service', params: ['definition'], signature: 'define_service(definition)' },
	{ name: 'define_component', params: ['definition'], signature: 'define_component(definition)' },
	{ name: 'define_effect', params: ['definition', 'opts?'], signature: 'define_effect(definition [, opts])' },
	{ name: 'new_timeline', params: ['def'], signature: 'new_timeline(def)' },
	{ name: 'timeline_range', params: ['frame_count'], signature: 'timeline_range(frame_count)' },
	{ name: 'new_timeline_range', params: ['def'], signature: 'new_timeline_range(def)' },
	{ name: 'spawn_object', params: ['definition_id', 'addons?'], signature: 'spawn_object(definition_id [, addons])' },
	{ name: 'spawn_sprite', params: ['definition_id', 'addons?'], signature: 'spawn_sprite(definition_id [, addons])' },
	{ name: 'spawn_textobject', params: ['definition_id', 'addons?'], signature: 'spawn_textobject(definition_id [, addons])' },
	{ name: 'create_service', params: ['definition_id', 'addons?'], signature: 'create_service(definition_id [, addons])' },
	{ name: 'service', params: ['id'], signature: 'service(id)' },
	{ name: 'object', params: ['id'], signature: 'object(id)' },
	{ name: 'attach_component', params: ['object_or_id', 'component_or_type'], signature: 'attach_component(object_or_id, component_or_type)' },
	{ name: 'configure_ecs', params: ['nodes'], signature: 'configure_ecs(nodes)' },
	{ name: 'apply_default_pipeline', params: [], signature: 'apply_default_pipeline()' },
	{ name: 'enlist', params: ['value'], signature: 'enlist(value)' },
	{ name: 'delist', params: ['id'], signature: 'delist(id)' },
	{ name: 'grant_effect', params: ['object_id', 'effect_id'], signature: 'grant_effect(object_id, effect_id)' },
	{ name: 'trigger_effect', params: ['object_id', 'effect_id', 'options?'], signature: 'trigger_effect(object_id, effect_id [, options])' },
	{ name: 'vdp_map_slot', params: ['slot', 'atlas_id?'], signature: 'vdp_map_slot(slot, atlas_id)', description: 'Maps an atlas resource id into a VRAM slot (slot 0=primary, 1=secondary; pass nil to clear).' },
	{ name: 'vdp_load_slot', params: ['slot', 'atlas_id'], signature: 'vdp_load_slot(slot, atlas_id)', description: 'Starts an async atlas load into a VRAM slot; BIOS maps the slot on completion; returns a job id.' },
	{ name: 'vdp_load_engine_atlas', params: [], signature: 'vdp_load_engine_atlas()', description: 'Starts an async load of the engine atlas into the engine VRAM slot; returns a job id.' },
	{ name: 'irq', params: ['flags'], signature: 'irq(flags)' },
	{ name: 'on_irq', params: ['handler?'], signature: 'on_irq(handler)', description: 'Registers a cart IRQ handler; pass nil to clear.' },
	{ name: 'on_vdp_load', params: ['handler?'], signature: 'on_vdp_load(handler)', description: 'Registers a VDP load callback; return true to skip BIOS mapping.' },
];

// Keep this list in sync with runtime builtins (TS/C++) so editor metadata matches actual VM behavior.
export const DEFAULT_LUA_BUILTIN_FUNCTIONS: ReadonlyArray<VMLuaBuiltinDescriptor> = [
	{ name: 'assert', params: ['value', 'message?'], signature: 'assert(value [, message])' },
	{ name: 'error', params: ['message', 'level?'], signature: 'error(message [, level])' },
	{ name: 'getmetatable', params: ['object'], signature: 'getmetatable(object)' },
	{ name: 'ipairs', params: ['table'], signature: 'ipairs(t)' },
	{ name: 'next', params: ['table', 'index?'], signature: 'next(table [, index])' },
	{ name: 'pairs', params: ['table'], signature: 'pairs(t)' },
	{ name: 'pcall', params: ['func', 'arg...'], signature: 'pcall(f, ...)' },
	{ name: 'print', params: ['...'], signature: 'print(...)' },
	{ name: 'peek', params: ['addr'], signature: 'peek(addr)' },
	{ name: 'poke', params: ['addr', 'value'], signature: 'poke(addr, value)' },
	{ name: 'rawequal', params: ['v1', 'v2'], signature: 'rawequal(v1, v2)' },
	{ name: 'rawget', params: ['table', 'index'], signature: 'rawget(table, index)' },
	{ name: 'rawset', params: ['table', 'index', 'value'], signature: 'rawset(table, index, value)' },
	{ name: 'select', params: ['index', '...'], signature: 'select(index, ...)' },
	{ name: 'setmetatable', params: ['table', 'metatable'], signature: 'setmetatable(table, metatable)' },
	{ name: 'tonumber', params: ['value', 'base?'], signature: 'tonumber(value [, base])' },
	{ name: 'tostring', params: ['value'], signature: 'tostring(value)' },
	{ name: 'type', params: ['value'], signature: 'type(value)' },
	{ name: 'xpcall', params: ['func', 'msgh', 'arg...'], signature: 'xpcall(f, msgh, ...)' },
	{ name: 'require', params: ['moduleName'], signature: 'require(moduleName)' },
	{ name: 'table.concat', params: ['list', 'separator?', 'start?', 'end?'], signature: 'table.concat(list [, sep [, i [, j]]])' },
	{ name: 'table.insert', params: ['list', 'pos?', 'value'], signature: 'table.insert(list [, pos], value)' },
	{ name: 'table.pack', params: ['...'], signature: 'table.pack(...)' },
	{ name: 'table.remove', params: ['list', 'pos?'], signature: 'table.remove(list [, pos])' },
	{ name: 'table.sort', params: ['list', 'comp?'], signature: 'table.sort(list [, comp])' },
	{ name: 'table.unpack', params: ['list', 'i?', 'j?'], signature: 'table.unpack(list [, i [, j]])' },
	{ name: 'math.abs', params: ['x'], signature: 'math.abs(x)' },
	{ name: 'math.acos', params: ['x'], signature: 'math.acos(x)' },
	{ name: 'math.asin', params: ['x'], signature: 'math.asin(x)' },
	{ name: 'math.atan', params: ['y', 'x?'], signature: 'math.atan(y [, x])' },
	{ name: 'math.ceil', params: ['x'], signature: 'math.ceil(x)' },
	{ name: 'math.cos', params: ['x'], signature: 'math.cos(x)' },
	{ name: 'math.deg', params: ['x'], signature: 'math.deg(x)' },
	{ name: 'math.exp', params: ['x'], signature: 'math.exp(x)' },
	{ name: 'math.floor', params: ['x'], signature: 'math.floor(x)' },
	{ name: 'math.fmod', params: ['x', 'y'], signature: 'math.fmod(x, y)' },
	{ name: 'math.log', params: ['x', 'base?'], signature: 'math.log(x [, base])' },
	{ name: 'math.max', params: ['x', '...'], signature: 'math.max(x, ...)' },
	{ name: 'math.min', params: ['x', '...'], signature: 'math.min(x, ...)' },
	{ name: 'math.modf', params: ['x'], signature: 'math.modf(x)' },
	{ name: 'math.sin', params: ['x'], signature: 'math.sin(x)' },
	{ name: 'math.random', params: ['m?', 'n?'], signature: 'math.random([m [, n]])' },
	{ name: 'math.randomseed', params: ['seed?'], signature: 'math.randomseed([seed])' },
	{ name: 'math.sqrt', params: ['x'], signature: 'math.sqrt(x)' },
	{ name: 'math.rad', params: ['x'], signature: 'math.rad(x)' },
	{ name: 'math.tan', params: ['x'], signature: 'math.tan(x)' },
	{ name: 'math.tointeger', params: ['x'], signature: 'math.tointeger(x)' },
	{ name: 'math.type', params: ['x'], signature: 'math.type(x)' },
	{ name: 'math.ult', params: ['m', 'n'], signature: 'math.ult(m, n)' },
	{ name: 'math.huge', params: [], signature: 'math.huge' },
	{ name: 'math.maxinteger', params: [], signature: 'math.maxinteger' },
	{ name: 'math.mininteger', params: [], signature: 'math.mininteger' },
	{ name: 'easing.linear', params: ['t'], signature: 'easing.linear(t)' },
	{ name: 'easing.ease_in_quad', params: ['t'], signature: 'easing.ease_in_quad(t)' },
	{ name: 'easing.ease_out_quad', params: ['t'], signature: 'easing.ease_out_quad(t)' },
	{ name: 'easing.ease_in_out_quad', params: ['t'], signature: 'easing.ease_in_out_quad(t)' },
	{ name: 'easing.ease_out_back', params: ['t'], signature: 'easing.ease_out_back(t)' },
	{ name: 'easing.smoothstep', params: ['t'], signature: 'easing.smoothstep(t)' },
	{ name: 'easing.pingpong01', params: ['t'], signature: 'easing.pingpong01(t)' },
	{ name: 'easing.arc01', params: ['t'], signature: 'easing.arc01(t)' },
	{ name: 'string.byte', params: ['s', 'i?'], signature: 'string.byte(s [, i])' },
	{ name: 'string.char', params: ['...'], signature: 'string.char(...)' },
	{ name: 'string.find', params: ['s', 'pattern', 'init?'], signature: 'string.find(s, pattern [, init])' },
	{ name: 'string.match', params: ['s', 'pattern', 'init?'], signature: 'string.match(s, pattern [, init])' },
	{ name: 'string.gsub', params: ['s', 'pattern', 'repl', 'n?'], signature: 'string.gsub(s, pattern, repl [, n])' },
	{ name: 'string.gmatch', params: ['s', 'pattern'], signature: 'string.gmatch(s, pattern)' },
	{ name: 'string.format', params: ['format', '...'], signature: 'string.format(format, ...)' },
	{ name: 'string.pack', params: ['format', '...'], signature: 'string.pack(format, ...)' },
	{ name: 'string.packsize', params: ['format'], signature: 'string.packsize(format)' },
	{ name: 'string.unpack', params: ['format', 's', 'pos?'], signature: 'string.unpack(format, s [, pos])' },
	{ name: 'string.len', params: ['s'], signature: 'string.len(s)' },
	{ name: 'string.lower', params: ['s'], signature: 'string.lower(s)' },
	{ name: 'string.rep', params: ['s', 'n', 'sep?'], signature: 'string.rep(s, n [, sep])' },
	{ name: 'string.sub', params: ['s', 'i', 'j?'], signature: 'string.sub(s, i [, j])' },
	{ name: 'string.upper', params: ['s'], signature: 'string.upper(s)' },
	{ name: 'os.clock', params: [], signature: 'os.clock()' },
	{ name: 'os.date', params: ['format?', 'time?'], signature: 'os.date([format [, time]])' },
	{ name: 'os.difftime', params: ['t2', 't1?'], signature: 'os.difftime(t2 [, t1])' },
	{ name: 'os.time', params: ['table?'], signature: 'os.time([table])' },
	...ENGINE_LUA_BUILTIN_FUNCTIONS,
	{ name: 'SYS_CART_BOOTREADY', params: [], signature: 'SYS_CART_BOOTREADY', description: 'System register address; reads as 1 when the cart is ready to boot.' },
	{ name: 'SYS_BOOT_CART', params: [], signature: 'SYS_BOOT_CART', description: 'System register address; write 1 to boot the cart.' },
	{ name: 'SYS_CART_MAGIC_ADDR', params: [], signature: 'SYS_CART_MAGIC_ADDR', description: 'Cart ROM magic header address.' },
	{ name: 'SYS_CART_MAGIC', params: [], signature: 'SYS_CART_MAGIC', description: 'Cart ROM magic header value.' },
	{ name: 'SYS_VDP_DITHER', params: [], signature: 'SYS_VDP_DITHER', description: 'VDP dither register; write to this register to control dithering. Values 0=off, 1=PSX, 2=RGB565, 3=MSX10' },
	{ name: 'SYS_VDP_PRIMARY_ATLAS_ID', params: [], signature: 'SYS_VDP_PRIMARY_ATLAS_ID', description: 'VDP primary atlas id register address; write atlas id or SYS_VDP_ATLAS_NONE.' },
	{ name: 'SYS_VDP_SECONDARY_ATLAS_ID', params: [], signature: 'SYS_VDP_SECONDARY_ATLAS_ID', description: 'VDP secondary atlas id register address; write atlas id or SYS_VDP_ATLAS_NONE.' },
	{ name: 'SYS_VDP_ATLAS_NONE', params: [], signature: 'SYS_VDP_ATLAS_NONE', description: 'Sentinel atlas id meaning no mapping.' },
	{ name: 'SYS_IRQ_FLAGS', params: [], signature: 'SYS_IRQ_FLAGS', description: 'IRQ flags register address; read pending IRQ bits.' },
	{ name: 'SYS_IRQ_ACK', params: [], signature: 'SYS_IRQ_ACK', description: 'IRQ acknowledge register address; write bits to clear.' },
	{ name: 'SYS_DMA_SRC', params: [], signature: 'SYS_DMA_SRC', description: 'DMA source address register.' },
	{ name: 'SYS_DMA_DST', params: [], signature: 'SYS_DMA_DST', description: 'DMA destination address register.' },
	{ name: 'SYS_DMA_LEN', params: [], signature: 'SYS_DMA_LEN', description: 'DMA transfer length in bytes.' },
	{ name: 'SYS_DMA_CTRL', params: [], signature: 'SYS_DMA_CTRL', description: 'DMA control register; write DMA_CTRL_START to begin.' },
	{ name: 'SYS_DMA_STATUS', params: [], signature: 'SYS_DMA_STATUS', description: 'DMA status register; busy/done/error bits.' },
	{ name: 'SYS_DMA_WRITTEN', params: [], signature: 'SYS_DMA_WRITTEN', description: 'DMA written byte count register.' },
	{ name: 'SYS_IMG_SRC', params: [], signature: 'SYS_IMG_SRC', description: 'IMGDEC source address register.' },
	{ name: 'SYS_IMG_LEN', params: [], signature: 'SYS_IMG_LEN', description: 'IMGDEC source length in bytes.' },
	{ name: 'SYS_IMG_DST', params: [], signature: 'SYS_IMG_DST', description: 'IMGDEC destination address register.' },
	{ name: 'SYS_IMG_CAP', params: [], signature: 'SYS_IMG_CAP', description: 'IMGDEC destination capacity in bytes.' },
	{ name: 'SYS_IMG_CTRL', params: [], signature: 'SYS_IMG_CTRL', description: 'IMGDEC control register; write IMG_CTRL_START to begin.' },
	{ name: 'SYS_IMG_STATUS', params: [], signature: 'SYS_IMG_STATUS', description: 'IMGDEC status register; busy/done/error bits.' },
	{ name: 'SYS_IMG_WRITTEN', params: [], signature: 'SYS_IMG_WRITTEN', description: 'IMGDEC written byte count register.' },
	{ name: 'SYS_ENGINE_ROM_BASE', params: [], signature: 'SYS_ENGINE_ROM_BASE', description: 'Engine ROM base address.' },
	{ name: 'SYS_CART_ROM_BASE', params: [], signature: 'SYS_CART_ROM_BASE', description: 'Cart ROM base address.' },
	{ name: 'SYS_OVERLAY_ROM_BASE', params: [], signature: 'SYS_OVERLAY_ROM_BASE', description: 'Overlay ROM base address.' },
	{ name: 'SYS_VRAM_ENGINE_ATLAS_BASE', params: [], signature: 'SYS_VRAM_ENGINE_ATLAS_BASE', description: 'VRAM engine atlas base address.' },
	{ name: 'SYS_VRAM_PRIMARY_ATLAS_BASE', params: [], signature: 'SYS_VRAM_PRIMARY_ATLAS_BASE', description: 'VRAM primary atlas slot base address.' },
	{ name: 'SYS_VRAM_SECONDARY_ATLAS_BASE', params: [], signature: 'SYS_VRAM_SECONDARY_ATLAS_BASE', description: 'VRAM secondary atlas slot base address.' },
	{ name: 'SYS_VRAM_STAGING_BASE', params: [], signature: 'SYS_VRAM_STAGING_BASE', description: 'VRAM staging buffer base address.' },
	{ name: 'SYS_VRAM_ENGINE_ATLAS_SIZE', params: [], signature: 'SYS_VRAM_ENGINE_ATLAS_SIZE', description: 'VRAM engine atlas size in bytes.' },
	{ name: 'SYS_VRAM_PRIMARY_ATLAS_SIZE', params: [], signature: 'SYS_VRAM_PRIMARY_ATLAS_SIZE', description: 'VRAM primary atlas slot size in bytes.' },
	{ name: 'SYS_VRAM_SECONDARY_ATLAS_SIZE', params: [], signature: 'SYS_VRAM_SECONDARY_ATLAS_SIZE', description: 'VRAM secondary atlas slot size in bytes.' },
	{ name: 'SYS_VRAM_STAGING_SIZE', params: [], signature: 'SYS_VRAM_STAGING_SIZE', description: 'VRAM staging buffer size in bytes.' },
	{ name: 'IRQ_DMA_DONE', params: [], signature: 'IRQ_DMA_DONE', description: 'IRQ flag for DMA completion.' },
	{ name: 'IRQ_DMA_ERROR', params: [], signature: 'IRQ_DMA_ERROR', description: 'IRQ flag for DMA error.' },
	{ name: 'IRQ_IMG_DONE', params: [], signature: 'IRQ_IMG_DONE', description: 'IRQ flag for IMGDEC completion.' },
	{ name: 'IRQ_IMG_ERROR', params: [], signature: 'IRQ_IMG_ERROR', description: 'IRQ flag for IMGDEC error.' },
	{ name: 'DMA_CTRL_START', params: [], signature: 'DMA_CTRL_START', description: 'DMA control bit: start transfer.' },
	{ name: 'DMA_CTRL_STRICT', params: [], signature: 'DMA_CTRL_STRICT', description: 'DMA control bit: strict overflow handling.' },
	{ name: 'DMA_STATUS_BUSY', params: [], signature: 'DMA_STATUS_BUSY', description: 'DMA status bit: busy.' },
	{ name: 'DMA_STATUS_DONE', params: [], signature: 'DMA_STATUS_DONE', description: 'DMA status bit: done.' },
	{ name: 'DMA_STATUS_ERROR', params: [], signature: 'DMA_STATUS_ERROR', description: 'DMA status bit: error.' },
	{ name: 'DMA_STATUS_CLIPPED', params: [], signature: 'DMA_STATUS_CLIPPED', description: 'DMA status bit: clipped.' },
	{ name: 'IMG_CTRL_START', params: [], signature: 'IMG_CTRL_START', description: 'IMGDEC control bit: start decode.' },
	{ name: 'IMG_STATUS_BUSY', params: [], signature: 'IMG_STATUS_BUSY', description: 'IMGDEC status bit: busy.' },
	{ name: 'IMG_STATUS_DONE', params: [], signature: 'IMG_STATUS_DONE', description: 'IMGDEC status bit: done.' },
	{ name: 'IMG_STATUS_ERROR', params: [], signature: 'IMG_STATUS_ERROR', description: 'IMGDEC status bit: error.' },
	{ name: 'IMG_STATUS_CLIPPED', params: [], signature: 'IMG_STATUS_CLIPPED', description: 'IMGDEC status bit: clipped.' },
];

const DEFAULT_LUA_BUILTIN_IDENTIFIER_EXTRAS = [
	'package',
	'math.pi',
	'math.huge',
	'math.maxinteger',
	'math.mininteger',
	'SYS_BOOT_CART',
	'SYS_CART_MAGIC_ADDR',
	'SYS_CART_MAGIC',
	'SYS_VDP_DITHER',
	'SYS_VDP_PRIMARY_ATLAS_ID',
	'SYS_VDP_SECONDARY_ATLAS_ID',
	'SYS_VDP_ATLAS_NONE',
	'SYS_IRQ_FLAGS',
	'SYS_IRQ_ACK',
	'SYS_DMA_SRC',
	'SYS_DMA_DST',
	'SYS_DMA_LEN',
	'SYS_DMA_CTRL',
	'SYS_DMA_STATUS',
	'SYS_DMA_WRITTEN',
	'SYS_IMG_SRC',
	'SYS_IMG_LEN',
	'SYS_IMG_DST',
	'SYS_IMG_CAP',
	'SYS_IMG_CTRL',
	'SYS_IMG_STATUS',
	'SYS_IMG_WRITTEN',
	'SYS_ENGINE_ROM_BASE',
	'SYS_CART_ROM_BASE',
	'SYS_OVERLAY_ROM_BASE',
	'SYS_VRAM_ENGINE_ATLAS_BASE',
	'SYS_VRAM_PRIMARY_ATLAS_BASE',
	'SYS_VRAM_SECONDARY_ATLAS_BASE',
	'SYS_VRAM_STAGING_BASE',
	'SYS_VRAM_ENGINE_ATLAS_SIZE',
	'SYS_VRAM_PRIMARY_ATLAS_SIZE',
	'SYS_VRAM_SECONDARY_ATLAS_SIZE',
	'SYS_VRAM_STAGING_SIZE',
	'IRQ_DMA_DONE',
	'IRQ_DMA_ERROR',
	'IRQ_IMG_DONE',
	'IRQ_IMG_ERROR',
	'DMA_CTRL_START',
	'DMA_CTRL_STRICT',
	'DMA_STATUS_BUSY',
	'DMA_STATUS_DONE',
	'DMA_STATUS_ERROR',
	'DMA_STATUS_CLIPPED',
	'IMG_CTRL_START',
	'IMG_STATUS_BUSY',
	'IMG_STATUS_DONE',
	'IMG_STATUS_ERROR',
	'IMG_STATUS_CLIPPED',
];

export const DEFAULT_LUA_BUILTIN_NAMES: ReadonlyArray<string> = (() => {
	const names = new Set<string>();
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = DEFAULT_LUA_BUILTIN_FUNCTIONS[index].name;
		names.add(name);
		const dot = name.indexOf('.');
		if (dot !== -1) {
			names.add(name.slice(0, dot));
		}
	}
	for (let index = 0; index < DEFAULT_LUA_BUILTIN_IDENTIFIER_EXTRAS.length; index += 1) {
		names.add(DEFAULT_LUA_BUILTIN_IDENTIFIER_EXTRAS[index]);
	}
	return Array.from(names);
})();

export function registerApiBuiltins(interpreter: LuaInterpreter): void {
	const runtime = BmsxVMRuntime.instance;
	runtime.apiFunctionNames.clear();
	const runtimeError = (message: string): LuaRuntimeError => interpreter.runtimeError(message);

	const env = interpreter.globalEnvironment;
	const setInputMapNative = new LuaNativeFunction('set_input_map', (args) => {
		if (args.length === 0 || !isLuaTable(args[0])) {
			throw runtimeError('set_input_map(mapping [, player]) requires a table as the first argument.');
		}
		const mappingTable = args[0] as LuaTable;
		const targetPlayer = args.length >= 2
			? Number(args[1])
			: runtime.playerIndex;
		const moduleId = $.lua_sources.path2lua[runtime.currentPath].source_path;
		const marshalCtx = { moduleId, path: [] };
		const mappingValue = runtime.luaJsBridge.convertFromLua(mappingTable, marshalCtx) as InputMap;
		if (!mappingValue || typeof mappingValue !== 'object') {
			throw runtimeError('set_input_map(mapping [, player]) requires mapping to be a table.');
		}
		for (const key of ['keyboard', 'gamepad', 'pointer']) {
			if (key in mappingValue) {
				const layer = mappingValue[key];
				if (layer !== undefined && layer !== null && typeof layer !== 'object') {
					throw runtimeError(`set_input_map(mapping [, player]) requires ${key} to be a table.`);
				}
				// Apply the layer mapping to the player input
				for (const [_action, bindings] of Object.entries(layer)) {
					layer.bindings = arrayify(bindings);
				}
			}
		}

		$.set_inputmap(targetPlayer, mappingValue as InputMap);
		return [];
	});

	registerLuaGlobal(env, 'set_input_map', setInputMapNative);
	registerLuaBuiltin({
		name: 'set_input_map',
		params: ['mapping', 'player?'],
		signature: 'set_input_map(mapping [, player])',
		description: 'Replaces the input bindings for the console player. The optional player argument is zero-based.',
	});

	const members = collectApiMembers();
	for (const { name, kind, descriptor } of members) {
		if (!descriptor) {
			continue;
		}
		if (kind === 'method') {
			const callable = descriptor.value;
			if (typeof callable !== 'function') {
				throw runtimeError(`API method '${name}' is not callable.`);
			}
			const params = extractFunctionParameters(callable as (...args: unknown[]) => unknown);
			const apiMetadata = VM_API_METHOD_METADATA[name];
			const optionalSet: Set<string> = new Set();
			const parameterDescriptionMap: Map<string, string> = new Map();
			if (apiMetadata?.parameters) {
				for (let index = 0; index < apiMetadata.parameters.length; index += 1) {
					const metadataParam = apiMetadata.parameters[index];
					if (!metadataParam || typeof metadataParam.name !== 'string') {
						throw runtimeError(`API method '${name}' has invalid parameter metadata.`);
					}
					if (metadataParam.optional) {
						optionalSet.add(metadataParam.name);
					}
					if (metadataParam.description !== undefined) {
						parameterDescriptionMap.set(metadataParam.name, metadataParam.description);
					}
				}
			}
			const optionalArray = optionalSet.size > 0 ? Array.from(optionalSet) : undefined;
			const parameterDescriptions = params.map(param => parameterDescriptionMap.get(param));
			const displayParams = params.map(param => (optionalSet.has(param) ? `${param}?` : param));
			const returnTypeSuffix = apiMetadata?.returnType && apiMetadata.returnType !== 'void'
				? ` -> ${apiMetadata.returnType}`
				: '';
			const signature = displayParams.length > 0
				? `${name}(${displayParams.join(', ')})${returnTypeSuffix}`
				: `${name}()${returnTypeSuffix}`;
			const native = new LuaNativeFunction(`api.${name}`, (args) => {
				const moduleId = $.lua_sources.path2lua[runtime.currentPath].source_path;
				const baseCtx = { moduleId, path: [] };
				const jsArgs = Array.from(args, (arg, index) => runtime.luaJsBridge.convertFromLua(arg, runtime.extendMarshalContext(baseCtx, `arg${index}`)));
				try {
					const target = api;
					const method = target[name];
					if (typeof method !== 'function') {
						throw new Error(`Method '${name}' is not callable.`);
					}
					const result = (method as (...inner: unknown[]) => unknown).apply(api, jsArgs);
					return wrapResultValue(result);
				} catch (error) {
					if (isLuaScriptError(error)) {
						throw error;
					}
					const message = extractErrorMessage(error);
					throw runtimeError(`[api.${name}] ${message}`);
				}
			});
			registerLuaGlobal(env, name, native);
			registerLuaBuiltin({
				name,
				params,
				signature,
				optionalParams: optionalArray,
				parameterDescriptions,
				description: apiMetadata?.description,
			});
			continue;
		}

		if (descriptor.get) {
			const getter = descriptor.get;
			const native = new LuaNativeFunction(`api.${name}`, () => {
				try {
					const value = getter.call(api);
					return wrapResultValue(value);
				} catch (error) {
					if (isLuaScriptError(error)) {
						throw error;
					}
					const message = extractErrorMessage(error);
					throw runtimeError(`[api.${name}] ${message}`);
				}
			});
			registerLuaGlobal(env, name, native);
		}
	}

	registerEngineBuiltins(interpreter);
	exposeEngineObjects(env);
}

function registerEngineBuiltins(interpreter: LuaInterpreter): void {
	const runtime = BmsxVMRuntime.instance;
	const env = interpreter.globalEnvironment;
	const requireName = runtime.canonicalizeIdentifier('require');
	const callEngineMember = (name: string, args: ReadonlyArray<LuaValue>): ReadonlyArray<LuaValue> => {
		const requireFn = interpreter.getGlobal(requireName) as LuaFunctionValue;
		const engineValue = requireFn.call(['engine']);
		const engineTable = engineValue[0] as LuaTable;
		const member = engineTable.get(runtime.canonicalizeIdentifier(name)) as LuaFunctionValue;
		return member.call(args);
	};
	for (let index = 0; index < ENGINE_LUA_BUILTIN_FUNCTIONS.length; index += 1) {
		const name = ENGINE_LUA_BUILTIN_FUNCTIONS[index].name;
		const native = new LuaNativeFunction(name, (args) => callEngineMember(name, args));
		registerLuaGlobal(env, name, native);
	}
}

export function registerLuaBuiltin(metadata: VMLuaBuiltinDescriptor): void {
	const runtime = BmsxVMRuntime.instance;
	const normalizedName = runtime.canonicalizeIdentifier(metadata.name.trim());
	if (normalizedName.length === 0) {
		throw new Error(`Invalid Lua builtin name for '${normalizedName}'.`);
	}
	const params: string[] = [];
	const optionalSet: Set<string> = new Set();
	const normalizedDescriptions: (string)[] = [];
	const sourceParams = Array.isArray(metadata.params) ? metadata.params : [];
	const sourceDescriptions = Array.isArray(metadata.parameterDescriptions) ? metadata.parameterDescriptions : [];
	for (let index = 0; index < sourceParams.length; index += 1) {
		const raw = sourceParams[index];
		const description = index < sourceDescriptions.length ? sourceDescriptions[index] : null;
		if (typeof raw !== 'string' || raw.trim().length === 0) {
			throw new Error(`Invalid Lua builtin parameter at index ${index} for '${normalizedName}'.`);
		}
		if (raw === '...' || raw.endsWith('...')) {
			params.push(raw);
			normalizedDescriptions.push(description);
			continue;
		}
		if (raw.endsWith('?')) {
			const base = raw.slice(0, -1);
			if (base.length > 0) {
				params.push(base);
				normalizedDescriptions.push(description);
				optionalSet.add(base);
			}
			continue;
		}
		params.push(raw);
		normalizedDescriptions.push(description);
	}
	if (Array.isArray(metadata.optionalParams)) {
		for (let index = 0; index < metadata.optionalParams.length; index += 1) {
			const name = metadata.optionalParams[index];
			if (typeof name !== 'string' || name.length === 0) {
				throw new Error(`Invalid Lua optional parameter at index ${index} for '${normalizedName}'.`);
			}
			optionalSet.add(name);
		}
	}
	const signature = typeof metadata.signature === 'string' ? metadata.signature : normalizedName;
	const optionalParams = optionalSet.size > 0 ? Array.from(optionalSet) : undefined;
	const descriptor: VMLuaBuiltinDescriptor = {
		name: normalizedName,
		params,
		signature,
		optionalParams,
		parameterDescriptions: normalizedDescriptions,
		description: metadata.description,
	};
	runtime.luaBuiltinMetadata.set(normalizedName, descriptor);
}

function extractFunctionParameters(fn: (...args: unknown[]) => unknown): string[] {
	const source = Function.prototype.toString.call(fn);
	const openIndex = source.indexOf('(');
	if (openIndex === -1) {
		return [];
	}
	let index = openIndex + 1;
	let depth = 1;
	let closeIndex = source.length;
	while (index < source.length) {
		const ch = source.charAt(index);
		if (ch === '(') {
			depth += 1;
		} else if (ch === ')') {
			depth -= 1;
			if (depth === 0) {
				closeIndex = index;
				break;
			}
		}
		index += 1;
	}
	if (depth !== 0 || closeIndex <= openIndex) {
		return [];
	}
	const slice = source.slice(openIndex + 1, closeIndex);
	const withoutBlockComments = slice.replace(/\/\*[\s\S]*?\*\//g, '');
	const withoutLineComments = withoutBlockComments.replace(/\/\/.*$/gm, '');
	const rawTokens = withoutLineComments.split(',');
	const names: string[] = [];
	for (let i = 0; i < rawTokens.length; i += 1) {
		const token = rawTokens[i].trim();
		if (token.length === 0) {
			continue;
		}
		names.push(sanitizeParameterName(token, i));
	}
	return names;
}

function sanitizeParameterName(token: string, index: number): string {
	let candidate = token.trim();
	if (candidate.length === 0) {
		return `arg${index + 1}`;
	}
	if (candidate.startsWith('...')) {
		return '...';
	}
	const equalsIndex = candidate.indexOf('=');
	if (equalsIndex >= 0) {
		candidate = candidate.slice(0, equalsIndex).trim();
	}
	const colonIndex = candidate.indexOf(':');
	if (colonIndex >= 0) {
		candidate = candidate.slice(0, colonIndex).trim();
	}
	const bracketIndex = Math.max(candidate.indexOf('{'), candidate.indexOf('['));
	if (bracketIndex !== -1) {
		return `arg${index + 1}`;
	}
	const sanitized = candidate.replace(/[^A-Za-z0-9_]/g, '');
	if (sanitized.length === 0) {
		return `arg${index + 1}`;
	}
	return sanitized;
}

export function seedDefaultLuaBuiltins(): void {
	DEFAULT_LUA_BUILTIN_FUNCTIONS.forEach(registerLuaBuiltin);
}

export function registerLuaGlobal(env: LuaEnvironment, name: string, value: LuaValue): void {
	const runtime = BmsxVMRuntime.instance;
	const key = runtime.canonicalizeIdentifier(name);
	env.set(key, value);
	runtime.apiFunctionNames.add(key);
}

function wrapResultValue(value: unknown): ReadonlyArray<LuaValue> {
	if (Array.isArray(value)) {
		if (value.every((entry) => isLuaValue(entry))) {
			return value as LuaValue[];
		}
		return value.map((entry) => BmsxVMRuntime.instance.luaJsBridge.toLua(entry));
	}
	if (value === undefined) {
		return [];
	}
	const luaValue = BmsxVMRuntime.instance.luaJsBridge.toLua(value);
	return [luaValue];
}

function isLuaValue(value: unknown): value is LuaValue {
	if (value === null) {
		return true;
	}
	if (typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
		return true;
	}
	if (isLuaTable(value)) {
		return true;
	}
	if (value instanceof LuaNativeValue) {
		return true;
	}
	if (value && typeof value === 'object' && 'call' in (value as Record<string, unknown>)) {
		const candidate = value as { call?: unknown };
		return typeof candidate.call === 'function';
	}
	return false;
}

export function isLuaScriptError(error: unknown): error is LuaError | LuaRuntimeError | LuaSyntaxError {
	return error instanceof LuaError || error instanceof LuaRuntimeError || error instanceof LuaSyntaxError;
}

function exposeEngineObjects(env: LuaEnvironment): void {
	const entries: Array<[string, any]> = [
		['$', $],
	];
	for (const [name, object] of entries) {
		registerLuaGlobal(env, name, new LuaNativeValue(object));
	}
}

function collectApiMembers(): Array<{ name: string; kind: 'method' | 'getter'; descriptor: PropertyDescriptor }> {
	const map = new Map<string, { kind: 'method' | 'getter'; descriptor: PropertyDescriptor }>();
	let prototype: object = Object.getPrototypeOf(api);
	while (prototype && prototype !== Object.prototype) {
		for (const name of Object.getOwnPropertyNames(prototype)) {
			if (name === 'constructor') continue;
			const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
			if (!descriptor || map.has(name)) continue;
			if (typeof descriptor.value === 'function') {
				map.set(name, { kind: 'method', descriptor });
			}
			else if (descriptor.get) {
				map.set(name, { kind: 'getter', descriptor });
			}
		}
		prototype = Object.getPrototypeOf(prototype);
	}
	return Array.from(map.entries(), ([name, value]) => ({ name, kind: value.kind, descriptor: value.descriptor }));
}
