-- bootrom.lua
-- bmsx system boot screen

local textflow = require("textflow")

local boot_delay = 2.0
local font_width = 6
local line_height = 8
local content_top = 32

local color_bg = 4
local color_header_bg = 7
local color_header_text = 1
local color_text = 15
local color_muted = 14
local color_accent = 15
local color_section = 1
local color_warn = 9
local color_ok = 15
local color_info_total = 15

local SYSTEM_ROM_BASE = 0x00000000
local CART_ROM_BASE = 0x01000000
local CART_ROM_MAGIC = 0x58534D42

local boot_start = os.clock()
local boot_requested = false
local sys_atlas_ready = false
local sys_atlas_failed = false
local boot_scroll_state = textflow.new_scroll_state()
local boot_screen_visible = false
local render_boot_screen = nil

local function read_cart_header(base)
	if peek(base) ~= CART_ROM_MAGIC then
		return nil
	end
	return {
		header_size = peek(base + 4),
		manifest_off = peek(base + 8),
		manifest_len = peek(base + 12),
		toc_off = peek(base + 16),
		toc_len = peek(base + 20),
		data_off = peek(base + 24),
		data_len = peek(base + 28),
	}
end

local function cart_boot_ready()
	return peek(sys_cart_bootready) ~= 0
end

local function format_viewport_label(viewport)
	if not viewport then
		return nil
	end
	local w = viewport.width or viewport.x
	local h = viewport.height or viewport.y
	if not w or not h then
		return nil
	end
	return tostring(w) .. 'x' .. tostring(h)
end

local function flatten_manifest(manifest, root_path)
	if not manifest then
		return nil
	end
	local machine = manifest.machine or {}
	local specs = machine.specs or {}
	local cpu = specs.cpu or {}
	return {
		title = manifest.title,
		short_name = manifest.short_name,
		rom_name = manifest.rom_name,
		entry_path = manifest.lua and manifest.lua.entry_path or nil,
		namespace = machine.namespace,
		viewport = format_viewport_label(machine.viewport),
		canonicalization = machine.canonicalization,
		input = manifest.input,
		root = root_path,
		cpu_freq_hz = cpu.cpu_freq_hz,
		ufps = machine.ufps,
	}
end

local function display_text(value)
	if value == nil or value == '' then
		return '--'
	end
	return value
end

local function format_cpu_mhz_from_hz(value)
	local hz = tonumber(value)
	if hz == nil then
		return '--'
	end
	local mhz_int = math.floor(hz / 1000000)
	local mhz_frac = math.floor((hz % 1000000) / 1000)
	return string.format('%d.%03d', mhz_int, mhz_frac)
end

local function is_valid_cpu_freq_hz(value)
	if value == nil or value == '' then
		return false
	end
	local num = tonumber(value)
	return num ~= nil and num > 0 and num == math.floor(num)
end

local function is_valid_ufps(value)
	if value == nil or value == '' then
		return false
	end
	local num = tonumber(value)
	return num ~= nil and num > 0 and num == math.floor(num)
end

local CART_MANIFEST_VALIDATORS = {
	function(manifest, errors)
		if not is_valid_cpu_freq_hz(manifest.cpu_freq_hz) then
			errors[#errors + 1] = 'MACHINE.CPU_FREQ_HZ IS MISSING OR INVALID'
		end
	end,
	function(manifest, errors)
		if not is_valid_ufps(manifest.ufps) then
			errors[#errors + 1] = 'MACHINE.UFPS IS MISSING OR INVALID'
		end
	end,
}

local function collect_cart_manifest_errors(cart_manifest)
	local errors = {}
	if not cart_manifest then
		errors[#errors + 1] = 'CART MANIFEST IS MISSING'
		return errors
	end
	for i = 1, #CART_MANIFEST_VALIDATORS do
		CART_MANIFEST_VALIDATORS[i](cart_manifest, errors)
	end
	return errors
end

local ROM_TOC_MAGIC = 0x434f5442
local ROM_TOC_HEADER_SIZE = 48
local ROM_TOC_ENTRY_SIZE = 80
local ROM_TOC_INVALID_U32 = 0xffffffff
local ROM_ASSET_TYPE_DATA = 3
local PROGRAM_ASSET_ID = '__program__'

local BIN_VERSION = 0xA1
local BIN_TAG_NULL = 0
local BIN_TAG_TRUE = 1
local BIN_TAG_FALSE = 2
local BIN_TAG_F64 = 3
local BIN_TAG_STR = 4
local BIN_TAG_ARR = 5
local BIN_TAG_REF = 6
local BIN_TAG_OBJ = 7
local BIN_TAG_BIN = 8
local BIN_TAG_INT = 9
local BIN_TAG_F32 = 10
local BIN_TAG_SET = 11

local precheck_cache_key = nil
local precheck_errors = {}
local precheck_stderr_message = nil
local precheck_stderr_reported = false
local system_const_pool_cache_key = nil
local system_const_pool_cache = nil
local bitcast_selftest_ok = false
local bitcast_selftest_status = 'NOT RUN'
local bitcast_selftest_error = nil
local bitcast_selftest_logged = false
local cart_start_failed_logged = false
local builtin_reader_read_f32 = reader_read_f32
local builtin_reader_read_f64 = reader_read_f64
local read_rom_program_const_pool

local function clear_precheck_cache()
	precheck_cache_key = nil
	precheck_errors = {}
	precheck_stderr_message = nil
	precheck_stderr_reported = false
end

local function refresh_atlas_load_state()
	local status = peek(sys_img_status)
	if (status & img_status_done) ~= 0 then
		sys_atlas_ready = true
	end
	if (status & img_status_error) ~= 0 then
		sys_atlas_failed = true
	end
end

local function build_precheck_key(header)
	return tostring(header.header_size)
		.. ':' .. tostring(header.manifest_off)
		.. ':' .. tostring(header.manifest_len)
		.. ':' .. tostring(header.toc_off)
		.. ':' .. tostring(header.toc_len)
		.. ':' .. tostring(header.data_off)
		.. ':' .. tostring(header.data_len)
end

local function get_cached_system_const_pool()
	local sys_header = read_cart_header(SYSTEM_ROM_BASE)
	if not sys_header then
		return nil, nil
	end
	local key = build_precheck_key(sys_header)
	if system_const_pool_cache_key ~= key then
		system_const_pool_cache_key = key
		system_const_pool_cache = read_rom_program_const_pool(SYSTEM_ROM_BASE, sys_header)
	end
	return sys_header, system_const_pool_cache
end

local function assert_range(offset, length, total, label)
	if offset < 0 or length < 0 or (offset + length) > total then
		error('Invalid ROM ' .. label .. ' range.')
	end
end

local function new_reader(base, size, label)
	return {
		base = base,
		size = size,
		pos = 0,
		label = label,
	}
end

local function reader_require(reader, length, label)
	if reader.pos + length > reader.size then
		error((label or reader.label) .. ' out of bounds.')
	end
end

local function reader_read_u8(reader, label)
	reader_require(reader, 1, label)
	local addr = reader.base + reader.pos
	local out = peek8(addr)
	reader.pos = reader.pos + 1
	return out
end

local function reader_skip_bytes(reader, length, label)
	reader_require(reader, length, label)
	reader.pos = reader.pos + length
end

local function reader_read_varuint(reader, label)
	local result = 0
	local shift = 0
	while true do
		local byte = reader_read_u8(reader, label)
		result = result | ((byte & 0x7f) << shift)
		if (byte & 0x80) == 0 then
			return result
		end
		shift = shift + 7
		if shift > 63 then
			error((label or reader.label) .. ' varuint is too large.')
		end
	end
end

local function reader_read_varint(reader, label)
	local raw = reader_read_varuint(reader, label)
	local value = raw >> 1
	if (raw & 1) ~= 0 then
		return -value - 1
	end
	return value
end

local function reader_read_raw_string(reader, length, label)
	if length == 0 then
		return ''
	end
	reader_require(reader, length, label)
	local parts = {}
	local remaining = length
	while remaining > 0 do
		local chunk_len = math.min(120, remaining)
		local chunk = ''
		for i = 1, chunk_len do
			chunk = chunk .. string.char(reader_read_u8(reader, label))
		end
		parts[#parts + 1] = chunk
		remaining = remaining - chunk_len
	end
	return table.concat(parts)
end

local function reader_read_string(reader, label)
	local length = reader_read_varuint(reader, label)
	return reader_read_raw_string(reader, length, label)
end

local function reader_read_u32le(reader, label)
	reader_require(reader, 4, label)
	local addr = reader.base + reader.pos
	local out = peek32le(addr)
	reader.pos = reader.pos + 4
	return out
end

local function reader_read_f32(reader, label)
	reader_require(reader, 4, label)
	local addr = reader.base + reader.pos
	local out = builtin_reader_read_f32(addr)
	reader.pos = reader.pos + 4
	return out
end

local function reader_read_f64(reader, label)
	reader_require(reader, 8, label)
	local addr = reader.base + reader.pos
	local out = builtin_reader_read_f64(addr)
	reader.pos = reader.pos + 8
	return out
end

local function selftest_bitcast_builtins()
	local ok, err = pcall(function()
		if type(builtin_reader_read_f32) ~= 'function' then
			error('reader_read_f32 missing')
		end
		if type(builtin_reader_read_f64) ~= 'function' then
			error('reader_read_f64 missing')
		end
		if type(u64_to_f64) ~= 'function' then
			error('u64_to_f64 missing')
		end
		if type(u32_to_f32) ~= 'function' then
			error('u32_to_f32 missing')
		end
		-- f64 1.0 = 0x3ff0000000000000 (hi, lo)
		assert(u64_to_f64(0x3ff00000, 0x00000000) == 1.0)
		-- f32 1.0 = 0x3f800000
		assert(u32_to_f32(0x3f800000) == 1.0)
		-- -0.0 keeps sign bit in IEEE754
		local neg_zero = u64_to_f64(0x80000000, 0x00000000)
		assert(neg_zero == 0.0 and (1.0 / neg_zero) == -math.huge)
		-- +inf
		assert(u64_to_f64(0x7ff00000, 0x00000000) == math.huge)
		-- qNaN: NaN is the only value not equal to itself
		local nan = u64_to_f64(0x7ff80000, 0x00000000)
		assert(nan ~= nan)
	end)
	bitcast_selftest_ok = ok
	if ok then
		bitcast_selftest_status = 'OK'
		bitcast_selftest_error = nil
		return
	end
	bitcast_selftest_status = 'FAILED'
	bitcast_selftest_error = tostring(err)
	if not bitcast_selftest_logged then
		bitcast_selftest_logged = true
		print('[BootRom] Bitcast selftest failed: ' .. bitcast_selftest_error)
		pcall(function()
			error('[BootRom] Bitcast selftest failed: ' .. bitcast_selftest_error)
		end)
	end
end

local function reader_read_prop_key(reader, prop_names, label)
	local prop_id = reader_read_varuint(reader, label)
	local index = prop_id + 1
	local key = prop_names[index]
	if key == nil then
		error((label or reader.label) .. ' invalid property id ' .. tostring(prop_id) .. '.')
	end
	return key
end

local function reader_skip_value_from_tag(reader, prop_names, tag)
	if tag == BIN_TAG_NULL or tag == BIN_TAG_TRUE or tag == BIN_TAG_FALSE then
		return
	end
	if tag == BIN_TAG_F64 then
		reader_skip_bytes(reader, 8, 'f64')
		return
	end
	if tag == BIN_TAG_F32 then
		reader_skip_bytes(reader, 4, 'f32')
		return
	end
	if tag == BIN_TAG_INT then
		reader_read_varint(reader, 'int')
		return
	end
	if tag == BIN_TAG_STR then
		local length = reader_read_varuint(reader, 'string length')
		reader_skip_bytes(reader, length, 'string')
		return
	end
	if tag == BIN_TAG_ARR or tag == BIN_TAG_SET then
		local count = reader_read_varuint(reader, 'array length')
		for i = 1, count do
			local value_tag = reader_read_u8(reader, 'array tag')
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
		return
	end
	if tag == BIN_TAG_REF then
		reader_read_varuint(reader, 'ref id')
		return
	end
	if tag == BIN_TAG_OBJ then
		local count = reader_read_varuint(reader, 'object property count')
		for i = 1, count do
			reader_read_prop_key(reader, prop_names, 'object property id')
			local value_tag = reader_read_u8(reader, 'object value tag')
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
		return
	end
	if tag == BIN_TAG_BIN then
		local length = reader_read_varuint(reader, 'binary length')
		reader_skip_bytes(reader, length, 'binary payload')
		return
	end
	error('Unsupported bin tag ' .. tostring(tag) .. '.')
end

local function reader_read_const_value(reader, prop_names)
	local tag = reader_read_u8(reader, 'const value tag')
	if tag == BIN_TAG_NULL then
		return { kind = 'nil' }
	end
	if tag == BIN_TAG_TRUE then
		return { kind = 'bool', value = true }
	end
	if tag == BIN_TAG_FALSE then
		return { kind = 'bool', value = false }
	end
	if tag == BIN_TAG_INT then
		return { kind = 'num', value = reader_read_varint(reader, 'const int') }
	end
	if tag == BIN_TAG_F32 then
		return { kind = 'num', value = reader_read_f32(reader, 'const f32') }
	end
	if tag == BIN_TAG_F64 then
		return { kind = 'num', value = reader_read_f64(reader, 'const f64') }
	end
	if tag == BIN_TAG_STR then
		return { kind = 'str', value = reader_read_string(reader, 'const string') }
	end
	reader_skip_value_from_tag(reader, prop_names, tag)
	return { kind = 'unsupported' }
end

local function reader_read_const_pool(reader, prop_names)
	local tag = reader_read_u8(reader, 'constPool tag')
	if tag ~= BIN_TAG_ARR then
		error('Program constPool must be an array.')
	end
	local count = reader_read_varuint(reader, 'constPool count')
	local out = {}
	for i = 1, count do
		out[i] = reader_read_const_value(reader, prop_names)
	end
	return out
end

local function reader_read_program_const_pool(reader, prop_names)
	local tag = reader_read_u8(reader, 'program tag')
	if tag ~= BIN_TAG_OBJ then
		error('Program payload must be an object.')
	end
	local prop_count = reader_read_varuint(reader, 'program property count')
	local const_pool = nil
	for i = 1, prop_count do
		local key = reader_read_prop_key(reader, prop_names, 'program property id')
		if key == 'constPool' then
			const_pool = reader_read_const_pool(reader, prop_names)
		else
			local value_tag = reader_read_u8(reader, 'program value tag')
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	if const_pool == nil then
		error('Program payload is missing constPool.')
	end
	return const_pool
end

local function read_program_const_pool_payload(base, size)
	local reader = new_reader(base, size, 'program payload')
	local version = reader_read_u8(reader, 'bin version')
	if version ~= BIN_VERSION then
		error('Unsupported binary payload version.')
	end
	local prop_count = reader_read_varuint(reader, 'property count')
	local prop_names = {}
	for i = 1, prop_count do
		prop_names[i] = reader_read_string(reader, 'property name')
	end
	local root_tag = reader_read_u8(reader, 'root tag')
	if root_tag ~= BIN_TAG_OBJ then
		error('Program root must be an object.')
	end
	local root_prop_count = reader_read_varuint(reader, 'root property count')
	local const_pool = nil
	for i = 1, root_prop_count do
		local key = reader_read_prop_key(reader, prop_names, 'root property id')
		if key == 'program' then
			const_pool = reader_read_program_const_pool(reader, prop_names)
		else
			local value_tag = reader_read_u8(reader, 'root value tag')
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	if const_pool == nil then
		error('Program root is missing program.constPool.')
	end
	return const_pool
end

local function read_toc_string(string_table_base, string_table_size, offset, length)
	if offset == ROM_TOC_INVALID_U32 or length == 0 then
		return ''
	end
	assert_range(offset, length, string_table_size, 'toc string table')
	local reader = new_reader(string_table_base + offset, length, 'toc string')
	return reader_read_raw_string(reader, length, 'toc string')
end

local function find_program_payload_range(rom_base, header)
	if header.toc_len < ROM_TOC_HEADER_SIZE then
		error('ROM TOC is too small.')
	end
	local toc_base = rom_base + header.toc_off
	local toc_magic = peek(toc_base + 0)
	if toc_magic ~= ROM_TOC_MAGIC then
		error('Invalid ROM TOC magic.')
	end
	local toc_header_size = peek(toc_base + 4)
	if toc_header_size ~= ROM_TOC_HEADER_SIZE then
		error('Unexpected ROM TOC header size.')
	end
	local entry_size = peek(toc_base + 8)
	if entry_size ~= ROM_TOC_ENTRY_SIZE then
		error('Unexpected ROM TOC entry size.')
	end
	local entry_count = peek(toc_base + 12)
	local entry_offset = peek(toc_base + 16)
	if entry_offset ~= ROM_TOC_HEADER_SIZE then
		error('Unexpected ROM TOC entry offset.')
	end
	local string_table_offset = peek(toc_base + 20)
	local string_table_length = peek(toc_base + 24)
	local entries_bytes = entry_count * entry_size
	local expected_string_offset = entry_offset + entries_bytes
	if string_table_offset ~= expected_string_offset then
		error('Unexpected ROM TOC string table offset.')
	end
	assert_range(entry_offset, entries_bytes, header.toc_len, 'toc entries')
	assert_range(string_table_offset, string_table_length, header.toc_len, 'toc string table')
	local string_table_base = toc_base + string_table_offset
	for index = 0, entry_count - 1 do
		local entry = toc_base + entry_offset + (index * entry_size)
		local type_id = peek(entry + 8)
		if type_id == ROM_ASSET_TYPE_DATA then
			local resid_offset = peek(entry + 16)
			local resid_length = peek(entry + 20)
			local asset_id = read_toc_string(string_table_base, string_table_length, resid_offset, resid_length)
			if asset_id == PROGRAM_ASSET_ID then
				local payload_start = peek(entry + 40)
				local payload_end = peek(entry + 44)
				if payload_start == ROM_TOC_INVALID_U32 or payload_end == ROM_TOC_INVALID_U32 or payload_end <= payload_start then
					error('Program asset is missing payload range.')
				end
				assert_range(payload_start, payload_end - payload_start, header.data_off + header.data_len, 'program payload')
				return {
					start = payload_start,
					['end'] = payload_end,
				}
			end
		end
	end
	error('Program asset "__program__" was not found in ROM TOC.')
end

read_rom_program_const_pool = function(rom_base, header)
	local payload = find_program_payload_range(rom_base, header)
	local payload_size = payload['end'] - payload.start
	return read_program_const_pool_payload(rom_base + payload.start, payload_size)
end

local function compute_program_link_errors(cart_header)
	return {}, nil
end

local function report_precheck_stderr_once()
	if precheck_stderr_message and not precheck_stderr_reported then
		precheck_stderr_reported = true
		print(precheck_stderr_message)
		pcall(function()
			error(precheck_stderr_message)
		end)
	end
end

local function ensure_program_link_precheck(cart_header)
	if not cart_header then
		clear_precheck_cache()
		return {}
	end
	if not boot_screen_visible then
		return {}
	end
	if not bitcast_selftest_ok then
		return {
			'BITCAST BUILTIN SELFTEST FAILED',
			bitcast_selftest_error or 'BITCAST BUILTIN CONTRACT FAILURE',
		}
	end
	local key = build_precheck_key(cart_header)
	if precheck_cache_key ~= key then
		precheck_cache_key = key
		precheck_errors = {}
		precheck_stderr_message = nil
		precheck_stderr_reported = false
		local ok, errors_or_message, stderr_message = pcall(compute_program_link_errors, cart_header)
		if ok then
			precheck_errors = errors_or_message
			precheck_stderr_message = stderr_message
		else
			local message = tostring(errors_or_message)
			precheck_errors = {
				'PROGRAM PRECHECK FAILED',
				message,
			}
			precheck_stderr_message = '[ProgramLinker] Cart precheck failed: ' .. message
		end
	end
	report_precheck_stderr_once()
	return precheck_errors
end

local function copy_errors(out, src)
	for i = 1, #src do
		out[#out + 1] = src[i]
	end
end

local function collect_cached_program_link_errors(cart_header)
	if not cart_header then
		return {}
	end
	local key = build_precheck_key(cart_header)
	if precheck_cache_key ~= key then
		return {}
	end
	return precheck_errors
end

local function collect_cart_precheck_errors(cart_header, cart_manifest)
	if not cart_header then
		clear_precheck_cache()
		return {}
	end
	local errors = collect_cart_manifest_errors(cart_manifest)
	if not bitcast_selftest_ok then
		errors[#errors + 1] = 'BITCAST BUILTIN SELFTEST FAILED'
		errors[#errors + 1] = bitcast_selftest_error or 'BITCAST BUILTIN CONTRACT FAILURE'
		return errors
	end
	local link_errors = collect_cached_program_link_errors(cart_header)
	copy_errors(errors, link_errors)
	return errors
end

local function get_program_precheck_status(cart_header)
	if not cart_header then
		return 'NO CART', nil, true
	end
	if not bitcast_selftest_ok then
		return 'FAILED', bitcast_selftest_error or 'BITCAST BUILTIN CONTRACT FAILURE', true
	end
	local key = build_precheck_key(cart_header)
	if precheck_cache_key == key then
		if #precheck_errors > 0 then
			return 'FAILED', precheck_errors[1], true
		end
		return 'OK', nil, true
	end
	if not boot_screen_visible then
		return 'PENDING', 'WAITING FOR BOOT SCREEN', false
	end
	return 'PENDING', 'PROGRAM PRECHECK NOT RUN', false
end

local function consume_boot_scroll_delta()
	local delta = 0
	if action_triggered('down[jp]', 1) then
		delta = delta + 1
		consume_action('down')
	end
	if action_triggered('up[jp]', 1) then
		delta = delta - 1
		consume_action('up')
	end
	return delta
end

local function scroll_boot_lines(lines, window_size, delta)
	local line_count = #lines
	if line_count ~= boot_scroll_state.last_line_count then
		boot_scroll_state.last_line_count = line_count
		boot_scroll_state.top = textflow.clamp_scroll(boot_scroll_state.top, line_count, window_size)
	end
	boot_scroll_state.top = textflow.clamp_scroll(boot_scroll_state.top + delta, line_count, window_size)
	local scroll_top, max_scroll, visible_lines = textflow.scroll_window(lines, boot_scroll_state.top, window_size)
	boot_scroll_state.top = scroll_top
	return scroll_top, max_scroll, visible_lines
end

local function elapsed_seconds()
	return os.clock() - boot_start
end

local function center_x(text, width)
	-- center text in given width, but ensure that the result is dividable by font_width
	return math.floor((width - (#text * font_width)) / 2 / font_width) * font_width
end

local function format_bytes(value)
	local kb = 1024
	local mb = kb * 1024
	if value >= mb then
		local scaled = value / mb
		if scaled == math.floor(scaled) then
			return string.format("%d MB", scaled)
		end
		return string.format("%.1f MB", scaled)
	end
	if value >= kb then
		local scaled = value / kb
		if scaled == math.floor(scaled) then
			return string.format("%d KB", scaled)
		end
		return string.format("%.1f KB", scaled)
	end
	return tostring(value) .. " B"
end

local function format_bignumbers(value)
	if value >= 1000000 then
		local scaled = value / 1000000
		if scaled == math.floor(scaled) then
			return string.format("%dM", scaled)
		end
		return string.format("%.1fM", scaled)
	end
	if value >= 1000 then
		local scaled = value / 1000
		if scaled == math.floor(scaled) then
			return string.format("%dK", scaled)
		end
		return string.format("%.1fK", scaled)
	end
	return tostring(value)
end

local function build_info()
	local cart_header = read_cart_header(CART_ROM_BASE)
	local cart_manifest_raw = cart_manifest
	local cart_root_path = assets and assets.project_root_path or nil
	local cart_manifest = cart_header and flatten_manifest(cart_manifest_raw, cart_root_path) or nil
	local sys_header = read_cart_header(SYSTEM_ROM_BASE)
	local sys_manifest_raw = sys_manifest
	local sys_manifest = sys_header and flatten_manifest(sys_manifest_raw, nil) or nil

	local cart_title = cart_manifest and display_text(cart_manifest.title) or '--'
	-- local cart_short = cart_manifest and display_text(cart_manifest.short_name) or '--'
	local cart_rom = cart_manifest and display_text(cart_manifest.rom_name) or '--'
	-- local cart_ns = cart_manifest and display_text(cart_manifest.namespace) or '--'
	local cart_view_label = cart_manifest and display_text(cart_manifest.viewport) or '--'
	-- local cart_canon = cart_manifest and display_text(cart_manifest.canonicalization) or '--'
	-- local cart_entry = cart_manifest and display_text(cart_manifest.entry_path) or '--'
	-- local cart_input = cart_manifest and display_text(cart_manifest.input) or '--'
	local cart_cpu_raw = cart_manifest and cart_manifest.cpu_freq_hz or nil
	local cart_cpu_label = format_cpu_mhz_from_hz(cart_cpu_raw)
	local cart_errors = collect_cart_precheck_errors(cart_header, cart_manifest)
	local cart_has_errors = #cart_errors > 0
	local precheck_status, precheck_detail, precheck_done = get_program_precheck_status(cart_header)

	local sys_title = sys_manifest and display_text(sys_manifest.title) or '--'
	local sys_rom = sys_manifest and display_text(sys_manifest.rom_name) or '--'
	-- local sys_ns = sys_manifest and display_text(sys_manifest.namespace) or '--'
	local sys_view_label = sys_manifest and display_text(sys_manifest.viewport) or '--'
	-- local sys_canon = sys_manifest and display_text(sys_manifest.canonicalization) or '--'
	-- local sys_entry = sys_manifest and display_text(sys_manifest.entry_path) or '--'
	local vram_total = sys_vram_system_atlas_size + sys_vram_primary_atlas_size + sys_vram_secondary_atlas_size + sys_vram_staging_size

	return {
		sys_title = sys_title,
		sys_rom = sys_rom,
		-- sys_ns = sys_ns,
		sys_view = sys_view_label,
		-- sys_canon = sys_canon,
		-- sys_entry = sys_entry,
		cart_title = cart_title,
		-- cart_short = cart_short,
		cart_rom = cart_rom,
		-- cart_ns = cart_ns,
		cart_view = cart_view_label,
		-- cart_canon = cart_canon,
		-- cart_entry = cart_entry,
		-- cart_input = cart_input,
		cart_cpu_mhz = cart_cpu_label,
		cart_errors = cart_errors,
		cart_has_errors = cart_has_errors,
		root = cart_manifest and display_text(cart_manifest.root) or '--',
		hw_cart_max = format_bytes(sys_cart_rom_size),
		hw_ram_total = format_bytes(sys_ram_size),
		hw_vram_total = format_bytes(vram_total),
		hw_max_assets = format_bignumbers(sys_max_assets),
		hw_max_strings = format_bignumbers(sys_string_handle_count),
		hw_max_cycles = format_bignumbers(sys_max_cycles_per_frame),
		bitcast_selftest_ok = bitcast_selftest_ok,
		bitcast_selftest_status = bitcast_selftest_status,
		bitcast_selftest_error = bitcast_selftest_error,
		precheck_status = precheck_status,
		precheck_detail = precheck_detail,
		precheck_done = precheck_done,
	}
end

local function divider(line_slots)
	return string.rep('—', line_slots)
end

local function build_progress_bar(progress, width)
	local clamped = progress
	if clamped < 0 then clamped = 0 end
	if clamped > 1 then clamped = 1 end
	local filled = math.floor(width * clamped + 0.5)
	if filled < 0 then filled = 0 end
	if filled > width then filled = width end
	return '[' .. string.rep('#', filled) .. string.rep('-', width - filled) .. ']'
end

local function compute_boot_progress(info, cart_ready, elapsed)
	local stage_count = 5
	local stage_done = 0
	if boot_screen_visible then
		stage_done = stage_done + 1
	end
	if info.bitcast_selftest_ok then
		stage_done = stage_done + 1
	end
	if sys_atlas_ready and not sys_atlas_failed then
		stage_done = stage_done + 1
	end
	if info.precheck_done then
		stage_done = stage_done + 1
	end
	if cart_ready then
		stage_done = stage_done + 1
	end
	local stage_progress = stage_done / stage_count
	local time_progress = elapsed / boot_delay
	if time_progress < 0 then time_progress = 0 end
	if time_progress > 1 then time_progress = 1 end
	return (stage_progress * 0.8) + (time_progress * 0.2)
end

local function append_wrapped_line(lines, value, color, line_slots, first_prefix, next_prefix)
	local wrapped = textflow.wrap_prefixed(value, line_slots, first_prefix or '', next_prefix or first_prefix or '')
	for i = 1, #wrapped do
		lines[#lines + 1] = { text = wrapped[i], color = color }
	end
end

local function append_kv_wrapped(lines, label, value, color, label_width, line_slots)
	local first_prefix = string.format("%-" .. label_width .. "s : ", label)
	local next_prefix = string.rep(' ', label_width) .. '   '
	local wrapped = textflow.wrap_prefixed(value, line_slots, first_prefix, next_prefix)
	for i = 1, #wrapped do
		lines[#lines + 1] = { text = wrapped[i], color = color }
	end
end

local function append_blank_line(lines)
	lines[#lines + 1] = { text = '', color = color_text }
end

local function append_section(lines, title, line_slots)
	append_wrapped_line(lines, title, color_section, line_slots, '', '')
	append_wrapped_line(lines, divider(line_slots), color_section, line_slots, '', '')
end

local function build_boot_content_lines(info, cart_present, cursor, elapsed, line_slots)
	local lines = {}
	local cart_has_errors = cart_present and info.cart_has_errors
	local hw_specs = {
		{ label = 'MAX CART ROM', value = info.hw_cart_max, color = color_accent },
		{ label = 'TOTAL RAM', value = info.hw_ram_total, color = color_info_total },
		{ label = 'TOTAL VRAM', value = info.hw_vram_total, color = color_info_total },
		{ label = 'MAX ASSETS', value = info.hw_max_assets, color = color_accent },
		{ label = 'MAX STRING ENTRIES', value = info.hw_max_strings, color = color_accent },
		{ label = 'MAX CYCLES/FRAME', value = info.hw_max_cycles, color = color_accent },
	}
	local cart_specs = {
		{ label = 'CART ROM', value = info.cart_rom, color = color_accent },
		{ label = 'CART NAME', value = info.cart_title, color = color_ok },
		{ label = 'VIEWPORT', value = info.cart_view, color = color_info_total },
		{ label = 'CPU MHZ', value = info.cart_cpu_mhz, color = color_accent },
	}
	local label_width = 0
	for i = 1, #hw_specs do
		local len = #hw_specs[i].label
		if len > label_width then label_width = len end
	end
	for i = 1, #cart_specs do
		local len = #cart_specs[i].label
		if len > label_width then label_width = len end
	end
	local status_labels = { 'STATUS', 'BOOT STATUS', 'BITCAST SELFTEST', 'PROGRAM PRECHECK' }
	for i = 1, #status_labels do
		local len = #status_labels[i]
		if len > label_width then label_width = len end
	end

	append_section(lines, 'SYSTEM SPECS', line_slots)
	for i = 1, #hw_specs do
		local spec = hw_specs[i]
		append_kv_wrapped(lines, spec.label, spec.value, spec.color or color_text, label_width, line_slots)
	end

	append_blank_line(lines)
	append_section(lines, 'CARTRIDGE', line_slots)
	for i = 1, #cart_specs do
		local spec = cart_specs[i]
		append_kv_wrapped(lines, spec.label, spec.value, spec.color or color_text, label_width, line_slots)
	end

	append_blank_line(lines)
	append_section(lines, 'BOOT STATUS', line_slots)
	local bitcast_color = info.bitcast_selftest_ok and color_ok or color_warn
	append_kv_wrapped(lines, 'BITCAST SELFTEST', info.bitcast_selftest_status, bitcast_color, label_width, line_slots)
	local precheck_color = color_accent
	if info.precheck_status == 'OK' then
		precheck_color = color_ok
	elseif info.precheck_status == 'FAILED' then
		precheck_color = color_warn
	end
	append_kv_wrapped(lines, 'PROGRAM PRECHECK', info.precheck_status, precheck_color, label_width, line_slots)

	if cart_has_errors then
		local error_lines = textflow.wrap_entries(info.cart_errors, line_slots, '- ', '  ')
		append_blank_line(lines)
		for i = 1, #error_lines do
			lines[#lines + 1] = { text = error_lines[i], color = color_warn }
		end
		append_wrapped_line(lines, 'BOOT BLOCKED ' .. cursor, color_warn, line_slots, '', '')
		return lines
	end

	if not info.bitcast_selftest_ok and info.bitcast_selftest_error then
		append_wrapped_line(lines, 'DETAIL: ' .. info.bitcast_selftest_error, color_muted, line_slots, '', '')
	elseif info.precheck_detail then
		append_wrapped_line(lines, 'DETAIL: ' .. info.precheck_detail, color_muted, line_slots, '', '')
	end

	if cart_present then
		local cart_ready = cart_boot_ready()
		if not cart_ready and not boot_requested and elapsed >= boot_delay and sys_atlas_ready and not sys_atlas_failed then
			if not cart_start_failed_logged then
				cart_start_failed_logged = true
				print('[BootRom] Cart start failed: cart_boot_ready=0 while BIOS remained active.')
			end
			append_wrapped_line(lines, 'BOOT BLOCKED: CART START FAILED', color_warn, line_slots, '', '')
			append_wrapped_line(lines, 'CHECK HOST LOG / REBUILD BIOS + CART TOGETHER', color_muted, line_slots, '', '')
			return lines
		end
		local status = cart_ready and 'CART LOADED' or (boot_requested and 'STARTING CART' or 'LOADING CART')
		local status_color = cart_ready and color_ok or color_accent
		append_wrapped_line(lines, status, status_color, line_slots, '', '')
		local bar_width = line_slots - 3
		if bar_width < 1 then bar_width = 1 end
		local bar = build_progress_bar(compute_boot_progress(info, cart_ready, elapsed), bar_width)
		append_wrapped_line(lines, bar .. cursor, color_text, line_slots, '', '')
	else
		append_wrapped_line(lines, 'NO CART DETECTED ' .. cursor, color_warn, line_slots, '', '')
	end
	return lines
end

function init()
	boot_start = os.clock()
	boot_requested = false
	boot_screen_visible = true
	sys_atlas_ready = false
	sys_atlas_failed = false
	clear_precheck_cache()
	bitcast_selftest_ok = false
	bitcast_selftest_status = 'NOT RUN'
	bitcast_selftest_error = nil
	bitcast_selftest_logged = false
	cart_start_failed_logged = false
	textflow.reset_scroll_state(boot_scroll_state)
	on_irq(irq_img_done, function()
		sys_atlas_ready = true
	end)
	on_irq(irq_img_error, function()
		sys_atlas_failed = true
	end)
	on_irq(irq_reinit, function()
		init()
	end)
	on_irq(irq_newgame, function()
		new_game()
	end)
	vdp_load_sys_atlas()
	refresh_atlas_load_state()
	selftest_bitcast_builtins()
end

function new_game()
end

function update()
	refresh_atlas_load_state()
	boot_screen_visible = true
	local scroll_delta = consume_boot_scroll_delta()
	local cart_header = read_cart_header(CART_ROM_BASE)
	local cart_manifest_raw = cart_manifest
	local cart_root_path = assets and assets.project_root_path or nil
	local cart_manifest_value = cart_header and flatten_manifest(cart_manifest_raw, cart_root_path) or nil
	ensure_program_link_precheck(cart_header)
	local cart_errors = collect_cart_precheck_errors(cart_header, cart_manifest_value)
	local cart_has_errors = cart_header and #cart_errors > 0
	local _, _, precheck_done = get_program_precheck_status(cart_header)

	if not cart_has_errors then
		local cart_valid = cart_header
			and #cart_errors == 0
			and bitcast_selftest_ok
			and precheck_done
		local cart_present_and_ready = peek(CART_ROM_BASE) == CART_ROM_MAGIC
			and cart_boot_ready()
			and cart_valid

		if cart_present_and_ready and not boot_requested and elapsed_seconds() >= boot_delay and sys_atlas_ready and not sys_atlas_failed then
			boot_requested = true
			print('[BootRom] Requesting cart boot.')
			poke(sys_boot_cart, 1)
		end
	end

	render_boot_screen(scroll_delta)
end

render_boot_screen = function(scroll_delta)
	refresh_atlas_load_state()
	local width = display_width()
	local left = 8
	local top = content_top

	cls(color_bg)
	put_rectfill(0, 0, width, 24, 0, color_header_bg)
	write('BMSX BIOS', center_x('BMSX BIOS', width), 8, 0, color_header_text)
	local info = build_info()
	local cart_present = peek(CART_ROM_BASE) == CART_ROM_MAGIC
	local elapsed = elapsed_seconds()
	local cursor = (math.floor(elapsed * 2) % 2 == 0) and '█' or ' '
	local line_slots = textflow.line_slots(width, left, font_width)
	local content_lines = build_boot_content_lines(info, cart_present, cursor, elapsed, line_slots)
	local window_size = textflow.window_size(display_height(), top, line_height, 1, 1)
	local scroll_top, max_scroll, visible_lines = scroll_boot_lines(content_lines, window_size, scroll_delta)
	local y = top

	for i = 1, #visible_lines do
		local line = visible_lines[i]
		write(line.text, left, y, 0, line.color)
		y = y + line_height
	end

	if max_scroll > 0 then
		local first_line = scroll_top + 1
		local last_line = scroll_top + #visible_lines
		write('UP/DOWN: SCROLL ' .. first_line .. '-' .. last_line .. '/' .. #content_lines, left, display_height() - line_height, 0, color_muted)
	end
end

local function service_irqs()
	local flags = peek(sys_irq_flags)
	if flags ~= 0 then
		irq(flags)
	end
end

while true do
	wait_vblank()
	service_irqs()
	update()
end
