import { $ } from '../core/engine_core';
import { InputMap } from '../input/inputtypes';
import { LuaEnvironment } from '../lua/luaenvironment';
import { LuaError, LuaRuntimeError, LuaSyntaxError } from '../lua/luaerrors';
import { LuaInterpreter, LuaNativeFunction } from '../lua/luaruntime';
import { extractErrorMessage, LuaFunctionValue, LuaNativeValue } from '../lua/luavalue';
import { isLuaTable, LuaTable, LuaValue } from '../lua/luavalue';
import { arrayify } from '../utils/arrayify';
import { API_METHOD_METADATA } from './api_metadata';
import { extendMarshalContext } from './lua_js_bridge';
import { api, Runtime } from './runtime';
import type { LuaBuiltinDescriptor } from './types';

export const ENGINE_LUA_BUILTIN_FUNCTIONS: ReadonlyArray<LuaBuiltinDescriptor> = [
	{ name: 'define_fsm', params: ['id', 'blueprint'], signature: 'define_fsm(id, blueprint)' },
	{ name: 'define_prefab', params: ['definition'], signature: 'define_prefab(definition)' },
	{ name: 'define_subsystem', params: ['definition'], signature: 'define_subsystem(definition)' },
	{ name: 'define_component', params: ['definition'], signature: 'define_component(definition)' },
	{ name: 'define_effect', params: ['definition', 'opts?'], signature: 'define_effect(definition [, opts])' },
	{ name: 'inst', params: ['definition_id', 'addons?'], signature: 'inst(definition_id [, addons])' },
	{ name: 'inst_subsystem', params: ['definition_id', 'addons?'], signature: 'inst_subsystem(definition_id [, addons])' },
	{ name: 'object', params: ['id'], signature: 'object(id)' },
	{ name: 'subsystem', params: ['id'], signature: 'subsystem(id)' },
	{ name: 'add_space', params: ['space_id'], signature: 'add_space(space_id)' },
	{ name: 'set_space', params: ['space_id'], signature: 'set_space(space_id)' },
	{ name: 'get_space', params: [], signature: 'get_space()' },
	{ name: 'attach_component', params: ['object_or_id', 'component_or_type'], signature: 'attach_component(object_or_id, component_or_type)' },
	{ name: 'update', params: [], signature: 'update()' },
	{ name: 'reset', params: [], signature: 'reset()' },
	{ name: 'configure_ecs', params: ['nodes'], signature: 'configure_ecs(nodes)' },
	{ name: 'apply_default_pipeline', params: [], signature: 'apply_default_pipeline()' },
	{ name: 'enlist', params: ['value'], signature: 'enlist(value)' },
	{ name: 'delist', params: ['id'], signature: 'delist(id)' },
	{ name: 'grant_effect', params: ['object_id', 'effect_id'], signature: 'grant_effect(object_id, effect_id)' },
	{ name: 'trigger_effect', params: ['object_id', 'effect_id', 'options?'], signature: 'trigger_effect(object_id, effect_id [, options])' },
	{ name: 'vdp_map_slot', params: ['slot', 'atlas_id?'], signature: 'vdp_map_slot(slot, atlas_id)', description: 'Maps an atlas resource id into a VRAM slot (slot 0=primary, 1=secondary; pass nil to clear).' },
	{ name: 'vdp_load_slot', params: ['slot', 'atlas_id'], signature: 'vdp_load_slot(slot, atlas_id)', description: 'Starts an async atlas load into a VRAM slot; BIOS maps the slot on completion; returns a job id.' },
	{ name: 'vdp_load_sys_atlas', params: [], signature: 'vdp_load_sys_atlas()', description: 'Starts an async load of the system atlas into the system VRAM slot; returns a job id.' },
	{ name: 'irq', params: ['flags'], signature: 'irq(flags)' },
	{ name: 'on_irq', params: ['mask_or_handler', 'handler?'], signature: 'on_irq(mask_or_handler [, handler])', description: 'Registers a per-bit IRQ handler with on_irq(mask, fn), or a legacy full-flags handler with on_irq(fn).' },
	{ name: 'on_vdp_load', params: ['handler?'], signature: 'on_vdp_load(handler)', description: 'Registers a VDP load callback; return true to skip BIOS mapping.' },
	{ name: 'bool01', params: ['value'], signature: 'bool01(value)', description: 'Converts a Lua value to 0 or 1; falsy values become 0, truthy values become 1.' },
	{ name: 'clear_map', params: ['map'], signature: 'clear_map(map)', description: 'Clears all keys from a table-style map by setting each key to nil.' },
	{ name: 'deep_clone', params: ['value'], signature: 'deep_clone(value)', description: 'Recursively clones a Lua value, including tables. Note that this does not handle cycles and will error if a cycle is encountered.' },
	{ name: 'consume_axis_accum', params: ['accum', 'speed_num', 'speed_den'], signature: 'consume_axis_accum(accum, speed_num, speed_den)' },
	{ name: 'set_velocity', params: ['target', 'speed_x_num', 'speed_y_num', 'speed_den'], signature: 'set_velocity(target, speed_x_num, speed_y_num, speed_den)' },
	{ name: 'move_with_velocity', params: ['target'], signature: 'move_with_velocity(target)' },
	{ name: 'rect_overlaps', params: ['ax', 'ay', 'aw', 'ah', 'bx', 'by', 'bw', 'bh'], signature: 'rect_overlaps(ax, ay, aw, ah, bx, by, bw, bh)' },
	{ name: 'clamp_int', params: ['value', 'min_value', 'max_value'], signature: 'clamp_int(value, min_value, max_value)' },
	{ name: 'div_toward_zero', params: ['value', 'divisor'], signature: 'div_toward_zero(value, divisor)' },
	{ name: 'round_to_nearest', params: ['value'], signature: 'round_to_nearest(value)' },
	{ name: 'rol8', params: ['value'], signature: 'rol8(value)' },
	{ name: 'swap_remove', params: ['array', 'index'], signature: 'swap_remove(array, index)' },
	{ name: 'objects_by_type', params: ['type_name', 'opts?'], signature: 'objects_by_type(type_name [, opts])', description: 'Returns an iterator over all world objects whose type_name matches.' },
	{ name: 'objects_by_tag', params: ['tag', 'opts?'], signature: 'objects_by_tag(tag [, opts])', description: 'Returns an iterator over all world objects carrying the given tag.' },
	{ name: 'find_by_type', params: ['type_name', 'opts?'], signature: 'find_by_type(type_name [, opts])', description: 'Returns the first world object matching type_name, or nil.' },
	{ name: 'find_by_tag', params: ['tag', 'opts?'], signature: 'find_by_tag(tag [, opts])', description: 'Returns the first world object carrying the given tag, or nil.' },
];

export const ENGINE_LUA_BUILTIN_GLOBALS: ReadonlyArray<LuaBuiltinDescriptor> = [
	{ name: 'timeline', params: [], signature: 'timeline', description: 'Timeline module table (timeline.new, timeline.range, timeline.expand_frames, timeline.build_frame_sequence, timeline.build_pingpong_frames).' },
	{ name: 'eventemitter', params: [], signature: 'eventemitter', description: 'Event emitter module table (eventemitter, events_of).' },
	{ name: 'scratchbatch', params: [], signature: 'scratchbatch', description: 'Scratch batch module table (scratchbatch.new; batches support clear, push, get, reserve, for_each, iter).' },
	{ name: 'sorted_scratchbatch', params: [], signature: 'sorted_scratchbatch', description: 'Sorted scratch batch module table (sorted_scratchbatch.new; batches support clear, push, get, reserve, for_each, iter, set_compare, sort).' },
];

// Keep this list in sync with runtime builtins (TS/C++) so editor metadata matches actual runtime behavior.
export const DEFAULT_LUA_BUILTIN_FUNCTIONS: ReadonlyArray<LuaBuiltinDescriptor> = [
	{ name: 'assert', params: ['value', 'message?'], signature: 'assert(value [, message])' },
	{ name: 'error', params: ['message', 'level?'], signature: 'error(message [, level])' },
	{ name: 'getmetatable', params: ['object'], signature: 'getmetatable(object)' },
	{ name: 'ipairs', params: ['table'], signature: 'ipairs(t)' },
	{ name: 'next', params: ['table', 'index?'], signature: 'next(table [, index])' },
	{ name: 'pairs', params: ['table'], signature: 'pairs(t)' },
	{ name: 'pcall', params: ['func', 'arg...'], signature: 'pcall(f, ...)' },
	{ name: 'print', params: ['...'], signature: 'print(...)' },
	{ name: 'peek', params: ['addr'], signature: 'peek(addr)' },
	{ name: 'sys_cpu_cycles_used', params: [], signature: 'sys_cpu_cycles_used()', description: 'Cycles consumed during the last completed tick.' },
	{ name: 'sys_cpu_cycles_granted', params: [], signature: 'sys_cpu_cycles_granted()', description: 'Cycle budget granted to the last completed tick.' },
	{ name: 'sys_ram_used', params: [], signature: 'sys_ram_used()', description: 'Tracked runtime RAM usage in bytes.' },
	{ name: 'sys_vram_used', params: [], signature: 'sys_vram_used()', description: 'Tracked VRAM usage in bytes.' },
	{ name: 'poke', params: ['addr', 'value'], signature: 'poke(addr, value)' },
	{ name: 'mem_write', params: ['addr', 'packed_string'], signature: 'mem_write(addr, packed_string)', description: 'Writes a packed byte string directly into emulated memory.' },
	{ name: 'wait_vblank', params: [], signature: 'wait_vblank()', description: 'Yields execution until the next VBLANK edge.' },
	{ name: 'clock_now', params: [], signature: 'clock_now()', description: 'Returns the current platform clock value.' },
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
	{ name: 'math.sign', params: ['x'], signature: 'math.sign(x)' },
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
	...ENGINE_LUA_BUILTIN_GLOBALS,
	{ name: 'sys_cart_bootready', params: [], signature: 'sys_cart_bootready', description: 'System register address; reads as 1 when the cart is ready to boot.' },
	{ name: 'sys_boot_cart', params: [], signature: 'sys_boot_cart', description: 'System register address; write 1 to boot the cart.' },
	{ name: 'sys_cart_magic_addr', params: [], signature: 'sys_cart_magic_addr', description: 'Cart ROM magic header address.' },
	{ name: 'sys_cart_magic', params: [], signature: 'sys_cart_magic', description: 'Cart ROM magic header value.' },
	{ name: 'sys_cart_rom_size', params: [], signature: 'sys_cart_rom_size', description: 'Maximum cart ROM size in bytes.' },
	{ name: 'sys_ram_size', params: [], signature: 'sys_ram_size', description: 'Total system RAM size in bytes.' },
	{ name: 'sys_max_assets', params: [], signature: 'sys_max_assets', description: 'Maximum number of asset entries.' },
	{ name: 'sys_string_handle_count', params: [], signature: 'sys_string_handle_count', description: 'Maximum number of string handles.' },
	{ name: 'sys_max_cycles_per_frame', params: [], signature: 'sys_max_cycles_per_frame', description: 'Maximum cycles per frame.' },
	{ name: 'sys_vdp_dither', params: [], signature: 'sys_vdp_dither', description: 'VDP dither register; write to this register to control dithering. Values 0=off, 1=PSX, 2=RGB777 output, 3=MSX10' },
	{ name: 'sys_vdp_primary_atlas_id', params: [], signature: 'sys_vdp_primary_atlas_id', description: 'VDP primary atlas id register address; write atlas id or sys_vdp_atlas_none.' },
	{ name: 'sys_vdp_secondary_atlas_id', params: [], signature: 'sys_vdp_secondary_atlas_id', description: 'VDP secondary atlas id register address; write atlas id or sys_vdp_atlas_none.' },
	{ name: 'sys_vdp_atlas_none', params: [], signature: 'sys_vdp_atlas_none', description: 'Sentinel atlas id meaning no mapping.' },
	{ name: 'sys_vdp_rd_surface', params: [], signature: 'sys_vdp_rd_surface', description: 'VDP readback surface selector (0=system, 1=primary, 2=secondary).' },
	{ name: 'sys_vdp_rd_x', params: [], signature: 'sys_vdp_rd_x', description: 'VDP readback X coordinate (pixels).' },
	{ name: 'sys_vdp_rd_y', params: [], signature: 'sys_vdp_rd_y', description: 'VDP readback Y coordinate (pixels).' },
	{ name: 'sys_vdp_rd_mode', params: [], signature: 'sys_vdp_rd_mode', description: 'VDP readback mode register (0=RGBA8888).' },
	{ name: 'sys_vdp_rd_status', params: [], signature: 'sys_vdp_rd_status', description: 'VDP readback status register; READY/OVERFLOW bits.' },
	{ name: 'sys_vdp_rd_data', params: [], signature: 'sys_vdp_rd_data', description: 'VDP readback data register; read RGBA8888 per access.' },
	{ name: 'sys_vdp_status', params: [], signature: 'sys_vdp_status', description: 'VDP status register; read VBLANK bit.' },
	{ name: 'sys_vdp_rd_mode_rgba8888', params: [], signature: 'sys_vdp_rd_mode_rgba8888', description: 'VDP readback mode constant for RGBA8888.' },
	{ name: 'sys_vdp_rd_status_ready', params: [], signature: 'sys_vdp_rd_status_ready', description: 'VDP readback status bit: ready.' },
	{ name: 'sys_vdp_rd_status_overflow', params: [], signature: 'sys_vdp_rd_status_overflow', description: 'VDP readback status bit: overflow.' },
	{ name: 'sys_vdp_status_vblank', params: [], signature: 'sys_vdp_status_vblank', description: 'VDP status bit: VBLANK level.' },
	{ name: 'sys_vdp_oam_front_base', params: [], signature: 'sys_vdp_oam_front_base', description: 'VDP OAM front-base register address.' },
	{ name: 'sys_vdp_oam_back_base', params: [], signature: 'sys_vdp_oam_back_base', description: 'VDP OAM back-base register address.' },
	{ name: 'sys_vdp_oam_front_count', params: [], signature: 'sys_vdp_oam_front_count', description: 'VDP OAM front-buffer entry-count register address.' },
	{ name: 'sys_vdp_oam_back_count', params: [], signature: 'sys_vdp_oam_back_count', description: 'VDP OAM back-buffer entry-count register address.' },
	{ name: 'sys_vdp_oam_capacity', params: [], signature: 'sys_vdp_oam_capacity', description: 'VDP OAM slot-capacity register address.' },
	{ name: 'sys_vdp_oam_entry_words', params: [], signature: 'sys_vdp_oam_entry_words', description: 'VDP OAM entry-word-count register address.' },
	{ name: 'sys_vdp_oam_read_source', params: [], signature: 'sys_vdp_oam_read_source', description: 'VDP OAM read-source register address.' },
	{ name: 'sys_vdp_oam_commit_seq', params: [], signature: 'sys_vdp_oam_commit_seq', description: 'VDP OAM commit-sequence register address.' },
	{ name: 'sys_vdp_oam_cmd', params: [], signature: 'sys_vdp_oam_cmd', description: 'VDP OAM command register address.' },
	{ name: 'sys_vdp_oam_read_source_front', params: [], signature: 'sys_vdp_oam_read_source_front', description: 'VDP OAM read-source constant selecting the front buffer.' },
	{ name: 'sys_vdp_oam_read_source_back', params: [], signature: 'sys_vdp_oam_read_source_back', description: 'VDP OAM read-source constant selecting the back buffer.' },
	{ name: 'sys_vdp_oam_cmd_swap', params: [], signature: 'sys_vdp_oam_cmd_swap', description: 'VDP OAM command constant that swaps the back buffer to front.' },
	{ name: 'sys_vdp_oam_cmd_clear_back', params: [], signature: 'sys_vdp_oam_cmd_clear_back', description: 'VDP OAM command constant that clears the back-buffer count.' },
	{ name: 'sys_irq_flags', params: [], signature: 'sys_irq_flags', description: 'IRQ flags register address; read pending IRQ bits.' },
	{ name: 'sys_irq_ack', params: [], signature: 'sys_irq_ack', description: 'IRQ acknowledge register address; write bits to clear.' },
	{ name: 'sys_dma_src', params: [], signature: 'sys_dma_src', description: 'DMA source address register.' },
	{ name: 'sys_dma_dst', params: [], signature: 'sys_dma_dst', description: 'DMA destination address register.' },
	{ name: 'sys_dma_len', params: [], signature: 'sys_dma_len', description: 'DMA transfer length in bytes.' },
	{ name: 'sys_dma_ctrl', params: [], signature: 'sys_dma_ctrl', description: 'DMA control register; write dma_ctrl_start to begin.' },
	{ name: 'sys_dma_status', params: [], signature: 'sys_dma_status', description: 'DMA status register; busy/done/error bits.' },
	{ name: 'sys_dma_written', params: [], signature: 'sys_dma_written', description: 'DMA written byte count register.' },
	{ name: 'sys_img_src', params: [], signature: 'sys_img_src', description: 'IMGDEC source address register.' },
	{ name: 'sys_img_len', params: [], signature: 'sys_img_len', description: 'IMGDEC source length in bytes.' },
	{ name: 'sys_img_dst', params: [], signature: 'sys_img_dst', description: 'IMGDEC destination address register.' },
	{ name: 'sys_img_cap', params: [], signature: 'sys_img_cap', description: 'IMGDEC destination capacity in bytes.' },
	{ name: 'sys_img_ctrl', params: [], signature: 'sys_img_ctrl', description: 'IMGDEC control register; write img_ctrl_start to begin.' },
	{ name: 'sys_img_status', params: [], signature: 'sys_img_status', description: 'IMGDEC status register; busy/done/error bits.' },
	{ name: 'sys_img_written', params: [], signature: 'sys_img_written', description: 'IMGDEC written byte count register.' },
	{ name: 'sys_rom_system_base', params: [], signature: 'sys_rom_system_base', description: 'System ROM base address.' },
	{ name: 'sys_rom_cart_base', params: [], signature: 'sys_rom_cart_base', description: 'Cart ROM base address.' },
	{ name: 'sys_rom_overlay_base', params: [], signature: 'sys_rom_overlay_base', description: 'Overlay ROM base address.' },
	{ name: 'sys_rom_overlay_size', params: [], signature: 'sys_rom_overlay_size', description: 'Overlay ROM size in bytes.' },
	{ name: 'sys_vdp_oam_bank_a_base', params: [], signature: 'sys_vdp_oam_bank_a_base', description: 'Physical OAM bank A base address in emulated memory.' },
	{ name: 'sys_vdp_oam_bank_b_base', params: [], signature: 'sys_vdp_oam_bank_b_base', description: 'Physical OAM bank B base address in emulated memory.' },
	{ name: 'sys_vdp_oam_buffer_size', params: [], signature: 'sys_vdp_oam_buffer_size', description: 'VDP OAM bank size in bytes.' },
	{ name: 'sys_vdp_oam_entry_bytes', params: [], signature: 'sys_vdp_oam_entry_bytes', description: 'VDP OAM record size in bytes.' },
	{ name: 'sys_vdp_oam_slot_count', params: [], signature: 'sys_vdp_oam_slot_count', description: 'VDP OAM slot capacity.' },
	{ name: 'sys_vdp_bgmap_front_base', params: [], signature: 'sys_vdp_bgmap_front_base()', description: 'Returns the active BGMap front-bank base address.' },
	{ name: 'sys_vdp_bgmap_back_base', params: [], signature: 'sys_vdp_bgmap_back_base()', description: 'Returns the active BGMap back-bank base address.' },
	{ name: 'sys_vdp_bgmap_bank_a_base', params: [], signature: 'sys_vdp_bgmap_bank_a_base', description: 'Physical BGMap bank A base address in emulated memory.' },
	{ name: 'sys_vdp_bgmap_bank_b_base', params: [], signature: 'sys_vdp_bgmap_bank_b_base', description: 'Physical BGMap bank B base address in emulated memory.' },
	{ name: 'sys_vdp_bgmap_buffer_size', params: [], signature: 'sys_vdp_bgmap_buffer_size', description: 'VDP BGMap bank size in bytes.' },
	{ name: 'sys_vdp_bgmap_layer_size', params: [], signature: 'sys_vdp_bgmap_layer_size', description: 'VDP BGMap per-layer storage size in bytes.' },
	{ name: 'sys_vdp_bgmap_entry_bytes', params: [], signature: 'sys_vdp_bgmap_entry_bytes', description: 'VDP BGMap tile record size in bytes.' },
	{ name: 'sys_vdp_bgmap_header_bytes', params: [], signature: 'sys_vdp_bgmap_header_bytes', description: 'VDP BGMap layer-header size in bytes.' },
	{ name: 'sys_vdp_bgmap_layer_count', params: [], signature: 'sys_vdp_bgmap_layer_count', description: 'VDP BGMap layer count per bank.' },
	{ name: 'sys_vdp_bgmap_tile_capacity', params: [], signature: 'sys_vdp_bgmap_tile_capacity', description: 'VDP BGMap tile capacity per layer.' },
	{ name: 'sys_vdp_pat_front_base', params: [], signature: 'sys_vdp_pat_front_base()', description: 'Returns the active PAT front-bank base address.' },
	{ name: 'sys_vdp_pat_back_base', params: [], signature: 'sys_vdp_pat_back_base()', description: 'Returns the active PAT back-bank base address.' },
	{ name: 'sys_vdp_pat_bank_a_base', params: [], signature: 'sys_vdp_pat_bank_a_base', description: 'Physical PAT bank A base address in emulated memory.' },
	{ name: 'sys_vdp_pat_bank_b_base', params: [], signature: 'sys_vdp_pat_bank_b_base', description: 'Physical PAT bank B base address in emulated memory.' },
	{ name: 'sys_vdp_pat_buffer_size', params: [], signature: 'sys_vdp_pat_buffer_size', description: 'VDP PAT bank size in bytes.' },
	{ name: 'sys_vdp_pat_entry_bytes', params: [], signature: 'sys_vdp_pat_entry_bytes', description: 'VDP PAT record size in bytes.' },
	{ name: 'sys_vdp_pat_header_bytes', params: [], signature: 'sys_vdp_pat_header_bytes', description: 'VDP PAT header size in bytes.' },
	{ name: 'sys_vdp_pat_capacity', params: [], signature: 'sys_vdp_pat_capacity', description: 'VDP PAT record capacity.' },
	{ name: 'sys_vram_system_atlas_base', params: [], signature: 'sys_vram_system_atlas_base', description: 'VRAM system atlas base address.' },
	{ name: 'sys_vram_primary_atlas_base', params: [], signature: 'sys_vram_primary_atlas_base', description: 'VRAM primary atlas slot base address.' },
	{ name: 'sys_vram_secondary_atlas_base', params: [], signature: 'sys_vram_secondary_atlas_base', description: 'VRAM secondary atlas slot base address.' },
	{ name: 'sys_vram_staging_base', params: [], signature: 'sys_vram_staging_base', description: 'VRAM staging buffer base address.' },
	{ name: 'sys_vram_system_atlas_size', params: [], signature: 'sys_vram_system_atlas_size', description: 'VRAM system atlas size in bytes.' },
	{ name: 'sys_vram_primary_atlas_size', params: [], signature: 'sys_vram_primary_atlas_size', description: 'VRAM primary atlas slot size in bytes.' },
	{ name: 'sys_vram_secondary_atlas_size', params: [], signature: 'sys_vram_secondary_atlas_size', description: 'VRAM secondary atlas slot size in bytes.' },
	{ name: 'sys_vram_staging_size', params: [], signature: 'sys_vram_staging_size', description: 'VRAM staging buffer size in bytes.' },
	{ name: 'sys_vram_size', params: [], signature: 'sys_vram_size', description: 'Tracked total VRAM capacity in bytes.' },
	{ name: 'irq_dma_done', params: [], signature: 'irq_dma_done', description: 'IRQ flag for DMA completion.' },
	{ name: 'irq_dma_error', params: [], signature: 'irq_dma_error', description: 'IRQ flag for DMA error.' },
	{ name: 'irq_img_done', params: [], signature: 'irq_img_done', description: 'IRQ flag for IMGDEC completion.' },
	{ name: 'irq_img_error', params: [], signature: 'irq_img_error', description: 'IRQ flag for IMGDEC error.' },
	{ name: 'irq_vblank', params: [], signature: 'irq_vblank', description: 'IRQ flag for VBLANK entry.' },
	{ name: 'irq_reinit', params: [], signature: 'irq_reinit', description: 'IRQ flag for cart reinitialization events.' },
	{ name: 'irq_newgame', params: [], signature: 'irq_newgame', description: 'IRQ flag for new-game start events.' },
	{ name: 'dma_ctrl_start', params: [], signature: 'dma_ctrl_start', description: 'DMA control bit: start transfer.' },
	{ name: 'dma_ctrl_strict', params: [], signature: 'dma_ctrl_strict', description: 'DMA control bit: strict overflow handling.' },
	{ name: 'dma_status_busy', params: [], signature: 'dma_status_busy', description: 'DMA status bit: busy.' },
	{ name: 'dma_status_done', params: [], signature: 'dma_status_done', description: 'DMA status bit: done.' },
	{ name: 'dma_status_error', params: [], signature: 'dma_status_error', description: 'DMA status bit: error.' },
	{ name: 'dma_status_clipped', params: [], signature: 'dma_status_clipped', description: 'DMA status bit: clipped.' },
	{ name: 'img_ctrl_start', params: [], signature: 'img_ctrl_start', description: 'IMGDEC control bit: start decode.' },
	{ name: 'img_status_busy', params: [], signature: 'img_status_busy', description: 'IMGDEC status bit: busy.' },
	{ name: 'img_status_done', params: [], signature: 'img_status_done', description: 'IMGDEC status bit: done.' },
	{ name: 'img_status_error', params: [], signature: 'img_status_error', description: 'IMGDEC status bit: error.' },
	{ name: 'img_status_clipped', params: [], signature: 'img_status_clipped', description: 'IMGDEC status bit: clipped.' },
];

const DEFAULT_LUA_BUILTIN_IDENTIFIER_EXTRAS = [
	'package',
	'math.pi',
	'math.huge',
	'math.maxinteger',
	'math.mininteger',
	'sys_boot_cart',
	'sys_cart_bootready',
	'sys_cart_magic_addr',
	'sys_cart_magic',
	'sys_cart_rom_size',
	'sys_ram_size',
	'sys_max_assets',
	'sys_string_handle_count',
	'sys_max_cycles_per_frame',
	'sys_vdp_dither',
	'sys_vdp_primary_atlas_id',
	'sys_vdp_secondary_atlas_id',
	'sys_vdp_atlas_none',
	'sys_vdp_rd_surface',
	'sys_vdp_rd_x',
	'sys_vdp_rd_y',
	'sys_vdp_rd_mode',
	'sys_vdp_rd_status',
	'sys_vdp_rd_data',
	'sys_vdp_status',
	'sys_vdp_rd_mode_rgba8888',
	'sys_vdp_rd_status_ready',
	'sys_vdp_rd_status_overflow',
	'sys_vdp_status_vblank',
	'sys_vdp_oam_front_base',
	'sys_vdp_oam_back_base',
	'sys_vdp_oam_front_count',
	'sys_vdp_oam_back_count',
	'sys_vdp_oam_capacity',
	'sys_vdp_oam_entry_words',
	'sys_vdp_oam_read_source',
	'sys_vdp_oam_commit_seq',
	'sys_vdp_oam_cmd',
	'sys_vdp_oam_read_source_front',
	'sys_vdp_oam_read_source_back',
	'sys_vdp_oam_cmd_swap',
	'sys_vdp_oam_cmd_clear_back',
	'sys_irq_flags',
	'sys_irq_ack',
	'sys_dma_src',
	'sys_dma_dst',
	'sys_dma_len',
	'sys_dma_ctrl',
	'sys_dma_status',
	'sys_dma_written',
	'sys_img_src',
	'sys_img_len',
	'sys_img_dst',
	'sys_img_cap',
	'sys_img_ctrl',
	'sys_img_status',
	'sys_img_written',
	'sys_rom_system_base',
	'sys_rom_cart_base',
	'sys_rom_overlay_base',
	'sys_rom_overlay_size',
	'sys_vdp_oam_bank_a_base',
	'sys_vdp_oam_bank_b_base',
	'sys_vdp_oam_buffer_size',
	'sys_vdp_oam_entry_bytes',
	'sys_vdp_oam_slot_count',
	'sys_vdp_bgmap_front_base',
	'sys_vdp_bgmap_back_base',
	'sys_vdp_bgmap_bank_a_base',
	'sys_vdp_bgmap_bank_b_base',
	'sys_vdp_bgmap_buffer_size',
	'sys_vdp_bgmap_layer_size',
	'sys_vdp_bgmap_entry_bytes',
	'sys_vdp_bgmap_header_bytes',
	'sys_vdp_bgmap_layer_count',
	'sys_vdp_bgmap_tile_capacity',
	'sys_vdp_pat_front_base',
	'sys_vdp_pat_back_base',
	'sys_vdp_pat_bank_a_base',
	'sys_vdp_pat_bank_b_base',
	'sys_vdp_pat_buffer_size',
	'sys_vdp_pat_entry_bytes',
	'sys_vdp_pat_header_bytes',
	'sys_vdp_pat_capacity',
	'sys_vram_system_atlas_base',
	'sys_vram_primary_atlas_base',
	'sys_vram_secondary_atlas_base',
	'sys_vram_staging_base',
	'sys_vram_system_atlas_size',
	'sys_vram_primary_atlas_size',
	'sys_vram_secondary_atlas_size',
	'sys_vram_staging_size',
	'sys_vram_size',
	'irq_dma_done',
	'irq_dma_error',
	'irq_img_done',
	'irq_img_error',
	'irq_vblank',
	'dma_ctrl_start',
	'dma_ctrl_strict',
	'dma_status_busy',
	'dma_status_done',
	'dma_status_error',
	'dma_status_clipped',
	'img_ctrl_start',
	'img_status_busy',
	'img_status_done',
	'img_status_error',
	'img_status_clipped',
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
	const runtime = Runtime.instance;
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
				: 1;
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
			const apiMetadata = API_METHOD_METADATA[name];
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
				const jsArgs = Array.from(args, (arg, index) => runtime.luaJsBridge.convertFromLua(arg, extendMarshalContext(baseCtx, `arg${index}`)));
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
	const runtime = Runtime.instance;
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

export function registerLuaBuiltin(metadata: LuaBuiltinDescriptor): void {
	const runtime = Runtime.instance;
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
	const descriptor: LuaBuiltinDescriptor = {
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
	const runtime = Runtime.instance;
	const key = runtime.canonicalizeIdentifier(name);
	env.set(key, value);
	runtime.apiFunctionNames.add(key);
}

function wrapResultValue(value: unknown): ReadonlyArray<LuaValue> {
	if (Array.isArray(value)) {
		if (value.every((entry) => isLuaValue(entry))) {
			return value as LuaValue[];
		}
		return value.map((entry) => Runtime.instance.luaJsBridge.toLua(entry));
	}
	if (value === undefined) {
		return [];
	}
	const luaValue = Runtime.instance.luaJsBridge.toLua(value);
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
