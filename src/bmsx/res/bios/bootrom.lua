-- bootrom.lua
-- bmsx system boot screen

local textflow = require('textflow')

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

local boot_status_labels = { 'STATUS', 'BOOT STATUS', 'BITCAST SELFTEST', 'PROGRAM PRECHECK' }

local system_rom_base = 0x00000000
local cart_rom_base = 0x01000000
local cart_rom_magic = 0x58534d42

local boot_start
local boot_requested
local sys_atlas_ready
local sys_atlas_failed
local boot_scroll_state = textflow.new_scroll_state()
local boot_screen_visible = false
local boot_screen_presented
local render_boot_screen

local function read_cart_header(base)
	if peek(base) ~= cart_rom_magic then
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
	local ready = peek(sys_cart_bootready)
	return ready ~= 0
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
		entry_path = manifest.lua and manifest.lua.entry_path,
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
	if value == nil then
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
	if value == nil then
		return false
	end
	local num = tonumber(value)
	return num ~= nil and num > 0 and num == math.floor(num)
end

local function is_valid_ufps(value)
	if value == nil then
		return false
	end
	local num = tonumber(value)
	return num ~= nil and num > 0 and num == math.floor(num)
end

local cart_manifest_validators = {
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
	for i = 1, #cart_manifest_validators do
		cart_manifest_validators[i](cart_manifest, errors)
	end
	return errors
end

local rom_toc_magic = 0x434f5442
local rom_toc_header_size = 48
local rom_toc_entry_size = 80
local rom_toc_invalid_u32 = 0xffffffff
local rom_asset_type_data = 3
local program_asset_id = '__program__'

local bin_version = 0xa1
local bin_tag_null = 0
local bin_tag_true = 1
local bin_tag_false = 2
local bin_tag_f64 = 3
local bin_tag_str = 4
local bin_tag_arr = 5
local bin_tag_ref = 6
local bin_tag_obj = 7
local bin_tag_bin = 8
local bin_tag_int = 9
local bin_tag_f32 = 10
local bin_tag_set = 11

local precheck_cache_key
local precheck_errors
local precheck_stderr_message
local precheck_stderr_reported
local system_program_summary_cache_key = nil
local system_program_summary_cache = nil
local bitcast_selftest_ok
local bitcast_selftest_status
local bitcast_selftest_error
local bitcast_selftest_logged
local cart_start_failed_logged
local builtin_reader_read_f32 = reader_read_f32
local builtin_reader_read_f64 = reader_read_f64
local read_rom_program_const_pool
local read_rom_program_asset_summary

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

local function get_cached_system_program_summary()
	local sys_header = read_cart_header(system_rom_base)
	if not sys_header then
		return nil, nil
	end
	local key = build_precheck_key(sys_header)
	if system_program_summary_cache_key ~= key then
		system_program_summary_cache_key = key
		system_program_summary_cache = read_rom_program_asset_summary(system_rom_base, sys_header)
	end
	return sys_header, system_program_summary_cache
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
	if tag == bin_tag_null or tag == bin_tag_true or tag == bin_tag_false then
		return
	end
	if tag == bin_tag_f64 then
		reader_skip_bytes(reader, 8, 'f64')
		return
	end
	if tag == bin_tag_f32 then
		reader_skip_bytes(reader, 4, 'f32')
		return
	end
	if tag == bin_tag_int then
		reader_read_varint(reader, 'int')
		return
	end
	if tag == bin_tag_str then
		local length = reader_read_varuint(reader, 'string length')
		reader_skip_bytes(reader, length, 'string')
		return
	end
	if tag == bin_tag_arr or tag == bin_tag_set then
		local count = reader_read_varuint(reader, 'array length')
		for i = 1, count do
			local value_tag = reader_read_u8(reader, 'array tag')
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
		return
	end
	if tag == bin_tag_ref then
		reader_read_varuint(reader, 'ref id')
		return
	end
	if tag == bin_tag_obj then
		local count = reader_read_varuint(reader, 'object property count')
		for i = 1, count do
			reader_read_prop_key(reader, prop_names, 'object property id')
			local value_tag = reader_read_u8(reader, 'object value tag')
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
		return
	end
	if tag == bin_tag_bin then
		local length = reader_read_varuint(reader, 'binary length')
		reader_skip_bytes(reader, length, 'binary payload')
		return
	end
	error('Unsupported bin tag ' .. tostring(tag) .. '.')
end

local function reader_read_const_value(reader, prop_names)
	local tag = reader_read_u8(reader, 'const value tag')
	if tag == bin_tag_null then
		return { kind = 'nil' }
	end
	if tag == bin_tag_true then
		return { kind = 'bool', value = true }
	end
	if tag == bin_tag_false then
		return { kind = 'bool', value = false }
	end
	if tag == bin_tag_int then
		return { kind = 'num', value = reader_read_varint(reader, 'const int') }
	end
	if tag == bin_tag_f32 then
		return { kind = 'num', value = reader_read_f32(reader, 'const f32') }
	end
	if tag == bin_tag_f64 then
		return { kind = 'num', value = reader_read_f64(reader, 'const f64') }
	end
	if tag == bin_tag_str then
		return { kind = 'str', value = reader_read_string(reader, 'const string') }
	end
	reader_skip_value_from_tag(reader, prop_names, tag)
	return { kind = 'unsupported' }
end

local function reader_read_const_pool(reader, prop_names)
	local tag = reader_read_u8(reader, 'constPool tag')
	if tag ~= bin_tag_arr then
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
	if tag ~= bin_tag_obj then
		error('Program payload must be an object.')
	end
	local prop_count = reader_read_varuint(reader, 'program property count')
	local const_pool
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
	if version ~= bin_version then
		error('Unsupported binary payload version.')
	end
	local prop_count = reader_read_varuint(reader, 'property count')
	local prop_names = {}
	for i = 1, prop_count do
		prop_names[i] = reader_read_string(reader, 'property name')
	end
	local root_tag = reader_read_u8(reader, 'root tag')
	if root_tag ~= bin_tag_obj then
		error('Program root must be an object.')
	end
	local root_prop_count = reader_read_varuint(reader, 'root property count')
	local const_pool
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
	if offset == rom_toc_invalid_u32 or length == 0 then
		return ''
	end
	assert_range(offset, length, string_table_size, 'toc string table')
	local reader = new_reader(string_table_base + offset, length, 'toc string')
	return reader_read_raw_string(reader, length, 'toc string')
end

local function find_program_payload_range(rom_base, header)
	if header.toc_len < rom_toc_header_size then
		error('ROM TOC is too small.')
	end
	local toc_base = rom_base + header.toc_off
	local toc_magic = peek(toc_base + 0)
	if toc_magic ~= rom_toc_magic then
		error('Invalid ROM TOC magic.')
	end
	local toc_header_size = peek(toc_base + 4)
	if toc_header_size ~= rom_toc_header_size then
		error('Unexpected ROM TOC header size.')
	end
	local entry_size = peek(toc_base + 8)
	if entry_size ~= rom_toc_entry_size then
		error('Unexpected ROM TOC entry size.')
	end
	local entry_count = peek(toc_base + 12)
	local entry_offset = peek(toc_base + 16)
	if entry_offset ~= rom_toc_header_size then
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
		if type_id == rom_asset_type_data then
			local resid_offset = peek(entry + 16)
			local resid_length = peek(entry + 20)
			local asset_id = read_toc_string(string_table_base, string_table_length, resid_offset, resid_length)
			if asset_id == program_asset_id then
				local payload_start = peek(entry + 40)
				local payload_end = peek(entry + 44)
				if payload_start == rom_toc_invalid_u32 or payload_end == rom_toc_invalid_u32 or payload_end <= payload_start then
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

local function reader_read_number_from_tag(reader, tag, label)
	if tag == bin_tag_int then
		return reader_read_varint(reader, label)
	end
	if tag == bin_tag_f32 then
		return reader_read_f32(reader, label)
	end
	if tag == bin_tag_f64 then
		return reader_read_f64(reader, label)
	end
	error((label or reader.label) .. ' must be a number.')
end

local function reader_read_string_from_tag(reader, tag, label)
	if tag ~= bin_tag_str then
		error((label or reader.label) .. ' must be a string.')
	end
	return reader_read_string(reader, label)
end

local function reader_read_non_negative_integer_from_tag(reader, tag, label)
	local value = reader_read_number_from_tag(reader, tag, label)
	if value ~= math.floor(value) then
		error((label or reader.label) .. ' must be an integer.')
	end
	if value < 0 then
		error((label or reader.label) .. ' must be non-negative.')
	end
	return value
end

local function reader_read_binary_range_from_tag(reader, tag, label)
	if tag ~= bin_tag_bin then
		error((label or reader.label) .. ' must be binary.')
	end
	local length = reader_read_varuint(reader, (label or reader.label) .. ' length')
	local start = reader.base + reader.pos
	reader_skip_bytes(reader, length, label)
	return {
		start = start,
		size = length,
	}
end

local function reader_read_object_property_count(reader, tag, label)
	if tag ~= bin_tag_obj then
		error((label or reader.label) .. ' must be an object.')
	end
	return reader_read_varuint(reader, (label or reader.label) .. ' property count')
end

local function reader_read_array_length(reader, tag, label)
	if tag ~= bin_tag_arr then
		error((label or reader.label) .. ' must be an array.')
	end
	return reader_read_varuint(reader, (label or reader.label) .. ' count')
end

local function reader_skip_array(reader, prop_names, tag, label)
	local count = reader_read_array_length(reader, tag, label)
	for i = 1, count do
		local value_tag = reader_read_u8(reader, (label or reader.label) .. ' item tag')
		reader_skip_value_from_tag(reader, prop_names, value_tag)
	end
	return count
end

local function begin_program_asset_payload_reader(rom_base, header)
	local payload = find_program_payload_range(rom_base, header)
	local payload_size = payload['end'] - payload.start
	local reader = new_reader(rom_base + payload.start, payload_size, 'program asset payload')
	local version = reader_read_u8(reader, 'bin version')
	if version ~= bin_version then
		error('Unsupported binary payload version.')
	end
	local prop_count = reader_read_varuint(reader, 'property count')
	local prop_names = {}
	for i = 1, prop_count do
		prop_names[i] = reader_read_string(reader, 'property name')
	end
	local root_tag = reader_read_u8(reader, 'root tag')
	if root_tag ~= bin_tag_obj then
		error('Program asset root must be an object.')
	end
	local root_prop_count = reader_read_varuint(reader, 'root property count')
	return reader, prop_names, root_prop_count
end

local function read_program_asset_core_summary_from_reader(reader, prop_names, root_prop_count)
	local summary = {
		entry_proto_index = nil,
		code_range = nil,
		const_pool_count = nil,
		proto_count = nil,
	}
	for i = 1, root_prop_count do
		local key = reader_read_prop_key(reader, prop_names, 'root property id')
		local value_tag = reader_read_u8(reader, 'root value tag')
		if key == 'entryProtoIndex' then
			summary.entry_proto_index = reader_read_non_negative_integer_from_tag(reader, value_tag, 'ProgramAsset.entryProtoIndex')
		elseif key == 'program' then
			local prop_count = reader_read_object_property_count(reader, value_tag, 'ProgramAsset.program')
			for j = 1, prop_count do
				local program_key = reader_read_prop_key(reader, prop_names, 'program property id')
				local program_tag = reader_read_u8(reader, 'program value tag')
				if program_key == 'code' then
					summary.code_range = reader_read_binary_range_from_tag(reader, program_tag, 'ProgramAsset.program.code')
				elseif program_key == 'constPool' then
					summary.const_pool_count = reader_skip_array(reader, prop_names, program_tag, 'ProgramAsset.program.constPool')
				elseif program_key == 'protos' then
					summary.proto_count = reader_skip_array(reader, prop_names, program_tag, 'ProgramAsset.program.protos')
				else
					reader_skip_value_from_tag(reader, prop_names, program_tag)
				end
			end
		else
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	return summary
end

read_rom_program_asset_summary = function(rom_base, header)
	local reader, prop_names, root_prop_count = begin_program_asset_payload_reader(rom_base, header)
	return read_program_asset_core_summary_from_reader(reader, prop_names, root_prop_count)
end

local function make_program_precheck_failure(scope, detail, stderr)
	return {
		title = scope .. ' PROGRAM ASSET IS INVALID',
		detail = detail,
		stderr = stderr,
	}
end

local function validate_program_asset_core(summary, scope)
	if summary.entry_proto_index == nil then
		return make_program_precheck_failure(scope, 'ENTRYPROTOINDEX IS MISSING', '[ProgramLinker] ' .. scope .. ' program asset is missing entryProtoIndex.')
	end
	if summary.code_range == nil then
		return make_program_precheck_failure(scope, 'PROGRAM.CODE IS MISSING', '[ProgramLinker] ' .. scope .. ' program asset is missing program.code.')
	end
	if summary.const_pool_count == nil then
		return make_program_precheck_failure(scope, 'PROGRAM.CONSTPOOL IS MISSING', '[ProgramLinker] ' .. scope .. ' program asset is missing program.constPool.')
	end
	if summary.proto_count == nil then
		return make_program_precheck_failure(scope, 'PROGRAM.PROTOS IS MISSING', '[ProgramLinker] ' .. scope .. ' program asset is missing program.protos.')
	end
	if (summary.code_range.size % 4) ~= 0 then
		return make_program_precheck_failure(scope, 'PROGRAM.CODE BYTECOUNT IS MISALIGNED', '[ProgramLinker] ' .. scope .. ' program code length is not divisible by 4.')
	end
	summary.instruction_count = summary.code_range.size / 4
	if summary.entry_proto_index >= summary.proto_count then
		return make_program_precheck_failure(
			scope,
			'ENTRYPROTOINDEX ' .. tostring(summary.entry_proto_index) .. ' EXCEEDS PROTO COUNT ' .. tostring(summary.proto_count),
			'[ProgramLinker] ' .. scope .. ' entryProtoIndex exceeds proto count.'
		)
	end
	return nil
end

local function read_module_proto_entry(reader, prop_names, tag)
	local prop_count = reader_read_object_property_count(reader, tag, 'ProgramAsset.moduleProtos[]')
	local path = nil
	local proto_index = nil
	for i = 1, prop_count do
		local key = reader_read_prop_key(reader, prop_names, 'ProgramAsset.moduleProtos[] property id')
		local value_tag = reader_read_u8(reader, 'ProgramAsset.moduleProtos[] value tag')
		if key == 'path' then
			path = reader_read_string_from_tag(reader, value_tag, 'ProgramAsset.moduleProtos[].path')
		elseif key == 'protoIndex' then
			proto_index = reader_read_non_negative_integer_from_tag(reader, value_tag, 'ProgramAsset.moduleProtos[].protoIndex')
		else
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	return path, proto_index
end

local function validate_module_protos_array(reader, prop_names, tag, summary, scope)
	local count = reader_read_array_length(reader, tag, 'ProgramAsset.moduleProtos')
	for i = 1, count do
		local item_tag = reader_read_u8(reader, 'ProgramAsset.moduleProtos item tag')
		local path, proto_index = read_module_proto_entry(reader, prop_names, item_tag)
		if path == nil or #path == 0 then
			return make_program_precheck_failure(scope, 'MODULEPROTO PATH IS MISSING', '[ProgramLinker] ' .. scope .. ' moduleProtos entry is missing path.')
		end
		if proto_index == nil then
			return make_program_precheck_failure(scope, 'MODULEPROTO PROTOINDEX IS MISSING', '[ProgramLinker] ' .. scope .. ' moduleProtos entry is missing protoIndex.')
		end
		if proto_index >= summary.proto_count then
			return make_program_precheck_failure(
				scope,
				'MODULEPROTO ' .. path .. ' TARGETS PROTO ' .. tostring(proto_index) .. ' OUT OF RANGE',
				'[ProgramLinker] ' .. scope .. ' moduleProtos entry points outside the proto table.'
			)
		end
	end
	return nil
end

local function read_module_alias_entry(reader, prop_names, tag)
	local prop_count = reader_read_object_property_count(reader, tag, 'ProgramAsset.moduleAliases[]')
	local alias = nil
	local path = nil
	for i = 1, prop_count do
		local key = reader_read_prop_key(reader, prop_names, 'ProgramAsset.moduleAliases[] property id')
		local value_tag = reader_read_u8(reader, 'ProgramAsset.moduleAliases[] value tag')
		if key == 'alias' then
			alias = reader_read_string_from_tag(reader, value_tag, 'ProgramAsset.moduleAliases[].alias')
		elseif key == 'path' then
			path = reader_read_string_from_tag(reader, value_tag, 'ProgramAsset.moduleAliases[].path')
		else
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	return alias, path
end

local function validate_module_aliases_array(reader, prop_names, tag, summary, scope, required_alias)
	local count = reader_read_array_length(reader, tag, 'ProgramAsset.moduleAliases')
	local found_required_alias = required_alias == nil
	for i = 1, count do
		local item_tag = reader_read_u8(reader, 'ProgramAsset.moduleAliases item tag')
		local alias, path = read_module_alias_entry(reader, prop_names, item_tag)
		if alias == nil or #alias == 0 then
			return make_program_precheck_failure(scope, 'MODULEALIAS ALIAS IS MISSING', '[ProgramLinker] ' .. scope .. ' moduleAliases entry is missing alias.')
		end
		if path == nil or #path == 0 then
			return make_program_precheck_failure(scope, 'MODULEALIAS PATH IS MISSING', '[ProgramLinker] ' .. scope .. ' moduleAliases entry is missing path.')
		end
		if required_alias and alias == required_alias then
			found_required_alias = true
		end
	end
	if required_alias and not found_required_alias then
		return {
			title = scope .. ' PROGRAM MISSING ' .. string.upper(required_alias),
			detail = 'ALIAS "' .. required_alias .. '" WAS NOT FOUND',
			stderr = '[ProgramLinker] ' .. scope .. ' program asset is missing alias "' .. required_alias .. '".',
		}
	end
	return nil
end

local function read_const_reloc_entry(reader, prop_names, tag)
	local prop_count = reader_read_object_property_count(reader, tag, 'ProgramAsset.link.constRelocs[]')
	local word_index = nil
	local kind = nil
	local const_index = nil
	for i = 1, prop_count do
		local key = reader_read_prop_key(reader, prop_names, 'ProgramAsset.link.constRelocs[] property id')
		local value_tag = reader_read_u8(reader, 'ProgramAsset.link.constRelocs[] value tag')
		if key == 'wordIndex' then
			word_index = reader_read_non_negative_integer_from_tag(reader, value_tag, 'ProgramAsset.link.constRelocs[].wordIndex')
		elseif key == 'kind' then
			kind = reader_read_string_from_tag(reader, value_tag, 'ProgramAsset.link.constRelocs[].kind')
		elseif key == 'constIndex' then
			const_index = reader_read_non_negative_integer_from_tag(reader, value_tag, 'ProgramAsset.link.constRelocs[].constIndex')
		else
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	return word_index, kind, const_index
end

local function validate_const_relocs_array(reader, prop_names, tag, summary, scope)
	local count = reader_read_array_length(reader, tag, 'ProgramAsset.link.constRelocs')
	for i = 1, count do
		local item_tag = reader_read_u8(reader, 'ProgramAsset.link.constRelocs item tag')
		local word_index, kind, const_index = read_const_reloc_entry(reader, prop_names, item_tag)
		local reloc_id = tostring(i - 1)
		if word_index == nil then
			return make_program_precheck_failure(scope, 'CONSTRELOC ' .. reloc_id .. ' IS MISSING WORDINDEX', '[ProgramLinker] ' .. scope .. ' const reloc is missing wordIndex.')
		end
		if kind == nil then
			return make_program_precheck_failure(scope, 'CONSTRELOC ' .. reloc_id .. ' IS MISSING KIND', '[ProgramLinker] ' .. scope .. ' const reloc is missing kind.')
		end
		if kind ~= 'bx' and kind ~= 'rk_b' and kind ~= 'rk_c' then
			return make_program_precheck_failure(scope, 'CONSTRELOC ' .. reloc_id .. ' HAS INVALID KIND ' .. kind, '[ProgramLinker] ' .. scope .. ' const reloc has invalid kind "' .. kind .. '".')
		end
		if const_index == nil then
			return make_program_precheck_failure(scope, 'CONSTRELOC ' .. reloc_id .. ' IS MISSING CONSTINDEX', '[ProgramLinker] ' .. scope .. ' const reloc is missing constIndex.')
		end
		if word_index < 0 or word_index >= summary.instruction_count then
			return make_program_precheck_failure(
				scope,
				'CONSTRELOC ' .. reloc_id .. ' TARGETS WORD ' .. tostring(word_index) .. ' OUT OF RANGE',
				'[ProgramLinker] ' .. scope .. ' const reloc targets a word outside program.code.'
			)
		end
		if const_index >= summary.const_pool_count then
			return make_program_precheck_failure(
				scope,
				'CONSTRELOC ' .. reloc_id .. ' TARGETS CONST ' .. tostring(const_index) .. ' OUT OF RANGE',
				'[ProgramLinker] ' .. scope .. ' const reloc targets a const index outside program.constPool.'
			)
		end
	end
	return nil
end

local function validate_program_link_object(reader, prop_names, tag, summary, scope)
	local prop_count = reader_read_object_property_count(reader, tag, 'ProgramAsset.link')
	local saw_const_relocs = false
	for i = 1, prop_count do
		local key = reader_read_prop_key(reader, prop_names, 'ProgramAsset.link property id')
		local value_tag = reader_read_u8(reader, 'ProgramAsset.link value tag')
		if key == 'constRelocs' then
			saw_const_relocs = true
			local failure = validate_const_relocs_array(reader, prop_names, value_tag, summary, scope)
			if failure then
				return failure
			end
		else
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	if not saw_const_relocs then
		return make_program_precheck_failure(scope, 'LINK.CONSTRELOCS IS MISSING', '[ProgramLinker] ' .. scope .. ' program asset is missing link.constRelocs.')
	end
	return nil
end

local function validate_program_asset_details(rom_base, header, summary, params)
	local scope = params.scope
	local required_alias = params.required_alias
	local reader, prop_names, root_prop_count = begin_program_asset_payload_reader(rom_base, header)
	local saw_module_aliases = false
	local saw_link = false
	for i = 1, root_prop_count do
		local key = reader_read_prop_key(reader, prop_names, 'root property id')
		local value_tag = reader_read_u8(reader, 'root value tag')
		if key == 'moduleProtos' then
			local failure = validate_module_protos_array(reader, prop_names, value_tag, summary, scope)
			if failure then
				return failure
			end
		elseif key == 'moduleAliases' then
			saw_module_aliases = true
			local failure = validate_module_aliases_array(reader, prop_names, value_tag, summary, scope, required_alias)
			if failure then
				return failure
			end
		elseif key == 'link' then
			saw_link = true
			local failure = validate_program_link_object(reader, prop_names, value_tag, summary, scope)
			if failure then
				return failure
			end
		else
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	if not saw_module_aliases then
		return make_program_precheck_failure(scope, 'MODULEALIASES IS MISSING', '[ProgramLinker] ' .. scope .. ' program asset is missing moduleAliases.')
	end
	if not saw_link then
		return make_program_precheck_failure(scope, 'LINK IS MISSING', '[ProgramLinker] ' .. scope .. ' program asset is missing link.')
	end
	return nil
end

local function compute_program_link_errors(cart_header)
	local errors = {}
	local sys_header, system_summary = get_cached_system_program_summary()
	if not sys_header then
		errors[#errors + 1] = 'SYSTEM ROM HEADER IS INVALID'
		return errors, '[ProgramLinker] Missing system ROM header.'
	end
	local failure = validate_program_asset_core(system_summary, 'SYSTEM')
	if failure then
		errors[#errors + 1] = failure.title
		errors[#errors + 1] = failure.detail
		return errors, failure.stderr
	end
	failure = validate_program_asset_details(system_rom_base, sys_header, system_summary, {
		scope = 'SYSTEM',
		required_alias = 'bios/engine',
	})
	if failure then
		errors[#errors + 1] = failure.title
		errors[#errors + 1] = failure.detail
		return errors, failure.stderr
	end
	local cart_summary = read_rom_program_asset_summary(cart_rom_base, cart_header)
	failure = validate_program_asset_core(cart_summary, 'CART')
	if failure then
		errors[#errors + 1] = failure.title
		errors[#errors + 1] = failure.detail
		return errors, failure.stderr
	end
	failure = validate_program_asset_details(cart_rom_base, cart_header, cart_summary, {
		scope = 'CART',
	})
	if failure then
		errors[#errors + 1] = failure.title
		errors[#errors + 1] = failure.detail
		return errors, failure.stderr
	end
	return errors, nil
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
	for i = 1, #link_errors do
		errors[#errors + 1] = link_errors[i]
	end
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
	local mb = kb * 1024645
	if value >= mb then
		local scaled = value / mb
		if scaled == math.floor(scaled) then
			return string.format('%d MB', scaled)
		end
		return string.format('%.1f MB', scaled)
	end
	if value >= kb then
		local scaled = value / kb
		if scaled == math.floor(scaled) then
			return string.format('%d KB', scaled)
		end
		return string.format('%.1f KB', scaled)
	end
	return tostring(value) .. ' B'
end

local function format_bignumbers(value)
	if value >= 1000000 then
		local scaled = value / 1000000
		if scaled == math.floor(scaled) then
			return string.format('%dM', scaled)
		end
		return string.format('%.1fM', scaled)
	end
	if value >= 1000 then
		local scaled = value / 1000
		if scaled == math.floor(scaled) then
			return string.format('%dK', scaled)
		end
		return string.format('%.1fK', scaled)
	end
	return tostring(value)
end

local function build_info()
	local cart_header = read_cart_header(cart_rom_base)
	local cart_manifest_raw = cart_manifest
	local cart_root_path = assets and assets.project_root_path
	local cart_manifest = cart_header and flatten_manifest(cart_manifest_raw, cart_root_path)
	local sys_header = read_cart_header(system_rom_base)
	local sys_manifest_raw = sys_manifest
	local sys_manifest = sys_header and flatten_manifest(sys_manifest_raw, nil)

	local cart_title = cart_manifest and display_text(cart_manifest.title) or '--'
	-- local cart_short = cart_manifest and display_text(cart_manifest.short_name) or '--'
	local cart_rom = cart_manifest and display_text(cart_manifest.rom_name) or '--'
	-- local cart_ns = cart_manifest and display_text(cart_manifest.namespace) or '--'
	local cart_view_label = cart_manifest and display_text(cart_manifest.viewport) or '--'
	-- local cart_canon = cart_manifest and display_text(cart_manifest.canonicalization) or '--'
	-- local cart_entry = cart_manifest and display_text(cart_manifest.entry_path) or '--'
	-- local cart_input = cart_manifest and display_text(cart_manifest.input) or '--'
	local cart_cpu_raw = cart_manifest and cart_manifest.cpu_freq_hz
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
	local clamped = clamp_int(progress, 0, 1)
	local filled = clamp_int(math.floor(width * clamped + 0.5), 0, width)
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
	local wrapped = textflow.wrap_prefixed(value, line_slots, (first_prefix), ((next_prefix or first_prefix)))
	for i = 1, #wrapped do
		lines[#lines + 1] = { text = wrapped[i], color = color }
	end
end

local function append_kv_wrapped(lines, label, value, color, label_width, line_slots)
	local first_prefix = string.format('%-' .. label_width .. 's : ', label)
	local next_prefix = string.rep(' ', label_width) .. '   '
	local wrapped = textflow.wrap_prefixed(value, line_slots, first_prefix, next_prefix)
	for i = 1, #wrapped do
		lines[#lines + 1] = { text = wrapped[i], color = color }
	end
end

local function append_blank_line(lines)
	lines[#lines + 1] = { text = '' }
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
		{ label = 'CPU MHZ', value = info.cart_cpu_mhz, color = color_accent },
		{ label = 'TOTAL RAM', value = info.hw_ram_total, color = color_info_total },
		{ label = 'TOTAL VRAM', value = info.hw_vram_total, color = color_info_total },
		{ label = 'VIEWPORT', value = info.cart_view, color = color_info_total },
		-- { label = 'MAX ASSETS', value = info.hw_max_assets, color = color_accent },
		-- { label = 'MAX STRING ENTRIES', value = info.hw_max_strings, color = color_accent },
		-- { label = 'MAX CYCLES/FRAME', value = info.hw_max_cycles, color = color_accent },
	}
	local cart_specs = {
		-- { label = 'CART ROM', value = info.cart_rom, color = color_accent },
		{ label = 'CART NAME', value = info.cart_title, color = color_ok },
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
	for i = 1, #boot_status_labels do
		local len = #boot_status_labels[i]
		if len > label_width then label_width = len end
	end

	append_section(lines, 'SYSTEM SPECS', line_slots)
	for i = 1, #hw_specs do
		local spec = hw_specs[i]
		append_kv_wrapped(lines, spec.label, spec.value, spec.color, label_width, line_slots)
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
	local precheck_color
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
	boot_screen_presented = false
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
	local scroll_delta = action_triggered('down[rp]') and 1 or (action_triggered('up[rp]') and -1 or 0)
	render_boot_screen(scroll_delta)
	if not boot_screen_presented then
		boot_screen_presented = true
	end
	local cart_header = read_cart_header(cart_rom_base)
	local cart_manifest_raw = cart_manifest
	local cart_root_path = assets and assets.project_root_path
	local cart_manifest_value = cart_header and flatten_manifest(cart_manifest_raw, cart_root_path)
	ensure_program_link_precheck(cart_header)
	local cart_errors = collect_cart_precheck_errors(cart_header, cart_manifest_value)
	local cart_has_errors = cart_header and #cart_errors > 0
	local _, _, precheck_done = get_program_precheck_status(cart_header)

	if not cart_has_errors then
		local cart_valid = cart_header
			and #cart_errors == 0
			and bitcast_selftest_ok
			and precheck_done
		local cart_present_and_ready = peek(cart_rom_base) == cart_rom_magic
			and cart_boot_ready()
			and cart_valid

		if cart_present_and_ready and not boot_requested and elapsed_seconds() >= boot_delay and sys_atlas_ready and not sys_atlas_failed then
			boot_requested = true
			print('[BootRom] Requesting cart boot.')
			poke(sys_boot_cart, 1)
		end
	end
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
	local cart_present = peek(cart_rom_base) == cart_rom_magic
	local elapsed = elapsed_seconds()
	local cursor = (math.floor(elapsed * 2) % 2 == 0) and '█' or ' '
	local line_slots = textflow.line_slots(width, left, font_width)
	local content_lines = build_boot_content_lines(info, cart_present, cursor, elapsed, line_slots)
	local window_size = textflow.window_size(display_height(), top, line_height, 1, 1)
	local scroll_top, max_scroll, visible_lines = scroll_boot_lines(content_lines, window_size, scroll_delta)
	local y = top

	for i = 1, #visible_lines do
		local line = visible_lines[i]
		write(line.text, left, y, 0, line.color or color_text)
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
