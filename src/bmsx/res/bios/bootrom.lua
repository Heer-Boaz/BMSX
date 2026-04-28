-- bootrom.lua
-- bmsx system boot screen

local clamp_int<const> = require('bios/util/clamp_int')
local wrap_text_lines<const> = require('bios/util/wrap_text_lines')

local reset_scroll_state<const> = function(state) state.top = 0 end
local scroll_window<const> = function(lines, top, window_size)
	local visible_lines<const> = {}
	local max_scroll<const> = math.max(0, #lines - window_size)
	local clamped_top<const> = clamp_int(top, 0, max_scroll)
	for i = 1, window_size do
		local idx<const> = clamped_top + i
		if idx <= #lines then
			table.insert(visible_lines, lines[idx])
		else
			table.insert(visible_lines, '')
		end
	end
	return visible_lines, max_scroll, #visible_lines
end
local line_slots<const> = function(width, left_margin, char_width)
	return (width - left_margin) // char_width
end
local window_size<const> = function(height, top_margin, line_height, top_padding, bottom_padding)
	local available_height<const> = height - top_margin - top_padding - bottom_padding
	return math.max(1, available_height // line_height)
end

local font_width<const> = 6
local line_height<const> = 8
local content_top<const> = 32
local cart_rom_base_header_size<const> = 32
local cart_rom_header_size<const> = 64

local color_bg<const> = 4
local color_header_bg<const> = 7
local color_header_text<const> = 1
local color_text<const> = 15
local color_muted<const> = 14
local color_accent<const> = 15
local color_section<const> = 1
local color_warn<const> = 9
local color_ok<const> = 15
local color_info_total<const> = 15

local boot_status_labels<const> = { 'STATUS', 'BOOT STATUS', 'BITCAST SELFTEST', 'PROGRAM PRECHECK' }
local program_const_reloc_kind_lookup<const> = { bx = true, rk_b = true, rk_c = true, gl = true, sys = true }
local program_const_reloc_const_pool_lookup<const> = { bx = true, rk_b = true, rk_c = true }

local system_rom_base<const> = 0x00000000
local cart_rom_base<const> = 0x01000000
local cart_rom_magic<const> = 0x58534d42

local boot_start
local boot_requested
local system_slot_ready
local system_slot_failed
local boot_scroll_state<const> = { top = 0 }
local boot_screen_visible = false
local boot_screen_presented
local render_boot_screen

local read_cart_header<const> = function(base)
	if mem[base] ~= cart_rom_magic then
		return nil
	end
	local header_size<const> = mem[base + 4]
	if header_size < cart_rom_base_header_size then
		return nil
	end
	local has_extended_header<const> = header_size >= cart_rom_header_size
	return {
		header_size = header_size,
		manifest_off = mem[base + 8],
		manifest_len = mem[base + 12],
		toc_off = mem[base + 16],
		toc_len = mem[base + 20],
		data_off = mem[base + 24],
		data_len = mem[base + 28],
		program_boot_version = has_extended_header and mem[base + 32] or 0,
		program_boot_flags = has_extended_header and mem[base + 36] or 0,
		program_entry_proto_index = has_extended_header and mem[base + 40] or 0,
		program_code_byte_count = has_extended_header and mem[base + 44] or 0,
		program_const_pool_count = has_extended_header and mem[base + 48] or 0,
		program_proto_count = has_extended_header and mem[base + 52] or 0,
			program_reserved0 = has_extended_header and mem[base + 56] or 0,
		program_const_reloc_count = has_extended_header and mem[base + 60] or 0,
	}
end

local cart_boot_ready<const> = function()
	local ready<const> = mem[sys_cart_bootready]
	return ready ~= 0
end

local format_render_size_label<const> = function(render_size)
	if not render_size then
		return nil
	end
	local w<const> = render_size.width
	local h<const> = render_size.height
	if not w or not h then
		return nil
	end
	return tostring(w) .. 'x' .. tostring(h)
end

local flatten_manifest<const> = function(manifest, root_path)
	if not manifest then
		return nil
	end
	local machine<const> = manifest.machine
	local specs<const> = machine.specs
	local cpu<const> = specs.cpu
	return {
		title = manifest.title,
		short_name = manifest.short_name,
		rom_name = manifest.rom_name,
		entry_path = manifest.lua and manifest.lua.entry_path,
		namespace = machine.namespace,
		render_size = format_render_size_label(machine.render_size),
		input = manifest.input,
		root = root_path,
		cpu_freq_hz = cpu.cpu_freq_hz,
		ufps = machine.ufps,
	}
end

local flatten_machine_manifest<const> = function(machine)
	if not machine then
		return nil
	end
	local cpu<const> = machine.specs and machine.specs.cpu
	return {
		namespace = machine.namespace,
		render_size = format_render_size_label(machine.render_size),
		cpu_freq_hz = cpu.cpu_freq_hz,
		ufps = machine.ufps,
	}
end

local format_cpu_mhz_from_hz<const> = function(value)
	local hz<const> = tonumber(value)
	if hz == nil then
		return '--'
	end
	local mhz_int<const> = hz // 1000000
	local mhz_frac<const> = (hz % 1000000) // 1000
	return string.format('%d.%03d', mhz_int, mhz_frac)
end

local is_valid_cpu_freq_hz<const> = function(value)
	if value == nil then
		return false
	end
	local num<const> = tonumber(value)
	return num ~= nil and num > 0 and num == (num // 1)
end

local is_valid_ufps<const> = function(value)
	if value == nil then
		return false
	end
	local num<const> = tonumber(value)
	return num ~= nil and num > 0 and num == (num // 1)
end

local cart_manifest_validators<const> = {
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

local collect_cart_manifest_errors<const> = function(cart_manifest)
	local errors<const> = {}
	if not cart_manifest then
		errors[#errors + 1] = 'CART MANIFEST IS MISSING'
		return errors
	end
	for i = 1, #cart_manifest_validators do
		cart_manifest_validators[i](cart_manifest, errors)
	end
	return errors
end

local toc_magic<const> = 0x434f5442
local toc_header_size<const> = 48
local toc_entry_size<const> = 88
local toc_invalid_u32<const> = 0xffffffff
local rom_asset_type_data<const> = 3
local program_asset_id<const> = '__program__'
local program_boot_header_version<const> = 1
local bin_version<const> = 0xa1
local bin_tag_null<const> = 0
local bin_tag_true<const> = 1
local bin_tag_false<const> = 2
local bin_tag_f64<const> = 3
local bin_tag_str<const> = 4
local bin_tag_arr<const> = 5
local bin_tag_ref<const> = 6
local bin_tag_obj<const> = 7
local bin_tag_bin<const> = 8
local bin_tag_int<const> = 9
local bin_tag_f32<const> = 10
local bin_tag_set<const> = 11

local precheck_cache_key
local precheck_errors
local precheck_stderr_message
local precheck_stderr_reported
local precheck_running
local precheck_co_thread
local precheck_co_target_key
local precheck_step_budget<const> = 16384
local precheck_phase_order<const> = {
	'read_system_summary',
	'validate_system_core',
	'validate_system_details',
	'read_cart_summary',
	'validate_cart_core',
	'validate_cart_details',
}
local precheck_phase_labels<const> = {
	read_system_summary = 'READ SYSTEM SUMMARY',
	validate_system_core = 'VALIDATE SYSTEM CORE',
	validate_system_details = 'VALIDATE SYSTEM DETAILS',
	read_cart_summary = 'READ CART SUMMARY',
	validate_cart_core = 'VALIDATE CART CORE',
	validate_cart_details = 'VALIDATE CART DETAILS',
}
local system_program_summary_cache_key = nil
local system_program_summary_cache = nil
local bitcast_selftest_ok
local bitcast_selftest_status
local bitcast_selftest_error
local bitcast_selftest_logged
local cart_start_failed_logged
local read_rom_program_const_pool
local read_rom_program_asset_summary
local validate_program_asset_core
local validate_program_asset_details
local validate_program_boot_asset
local begin_program_asset_summary_step_state
local step_program_asset_summary_step_state
local get_program_asset_summary_step_progress
local begin_program_asset_details_step_state
local step_program_asset_details_step_state
local get_program_asset_details_step_progress
local clear_precheck_cache<const> = function()
	precheck_cache_key = nil
	precheck_errors = {}
	precheck_stderr_message = nil
	precheck_stderr_reported = false
	precheck_co_thread = nil
	precheck_co_target_key = nil
	precheck_running = false
end
clear_precheck_cache()

local build_precheck_key<const> = function(header)
	return tostring(header.header_size)
		.. ':' .. tostring(header.manifest_off)
		.. ':' .. tostring(header.manifest_len)
		.. ':' .. tostring(header.toc_off)
		.. ':' .. tostring(header.toc_len)
		.. ':' .. tostring(header.data_off)
		.. ':' .. tostring(header.data_len)
		.. ':' .. tostring(header.program_boot_version)
		.. ':' .. tostring(header.program_boot_flags)
		.. ':' .. tostring(header.program_entry_proto_index)
		.. ':' .. tostring(header.program_code_byte_count)
		.. ':' .. tostring(header.program_const_pool_count)
		.. ':' .. tostring(header.program_proto_count)
			.. ':' .. tostring(header.program_reserved0)
		.. ':' .. tostring(header.program_const_reloc_count)
end

local get_precheck_phase_index<const> = function(phase)
	for i = 1, #precheck_phase_order do
		if precheck_phase_order[i] == phase then
			return i
		end
	end
	return 1
end

local get_precheck_phase_label<const> = function(phase)
	return precheck_phase_labels[phase] or tostring(phase)
end

local reset_precheck_step_budget<const> = function(job)
	job.remaining_steps = precheck_step_budget
end

local consume_precheck_step<const> = function(job)
	if job.remaining_steps <= 0 then
		return false
	end
	job.remaining_steps = job.remaining_steps - 1
	return true
end

local start_program_link_precheck_job<const> = function(cart_header, key)
	precheck_co_target_key = key
	precheck_errors = {}
	precheck_stderr_message = nil
	precheck_stderr_reported = false
	precheck_running = true
	precheck_co_thread = {
		cart_header = cart_header,
		phase = 'read_system_summary',
	}
end

local finish_program_link_precheck<const> = function(errors, stderr_message)
	precheck_running = false
	precheck_cache_key = precheck_co_target_key
	precheck_co_thread = nil
	precheck_co_target_key = nil
	precheck_errors = errors
	precheck_stderr_message = stderr_message
end

local finish_program_link_precheck_from_failure<const> = function(failure)
	local errors<const> = {}
	errors[#errors + 1] = failure.title
	errors[#errors + 1] = failure.detail
	finish_program_link_precheck(errors, failure.stderr)
end

local run_staged_program_link_precheck_job<const> = function()
	local job<const> = precheck_co_thread
	if job == nil then
		return
	end
	local ok<const>, err<const> = pcall(function()
		if job.phase == 'read_system_summary' then
			local sys_header<const> = read_cart_header(system_rom_base)
			if not sys_header then
				finish_program_link_precheck({
					'SYSTEM ROM HEADER IS INVALID',
				}, '[ProgramLinker] Missing system ROM header.')
				return
			end
			job.system_header = sys_header
			local system_key<const> = build_precheck_key(sys_header)
			if system_program_summary_cache_key == system_key and system_program_summary_cache ~= nil then
				job.system_summary = system_program_summary_cache
				job.phase = 'validate_system_core'
				return
			end
			if job.system_summary_state == nil then
				job.system_summary_state = begin_program_asset_summary_step_state(system_rom_base, sys_header)
			end
			local done<const>, summary<const> = step_program_asset_summary_step_state(job.system_summary_state, job)
			if not done then
				return
			end
			job.system_summary_state = nil
			job.system_summary = summary
			system_program_summary_cache_key = system_key
			system_program_summary_cache = summary
			job.phase = 'validate_system_core'
		elseif job.phase == 'validate_system_core' then
			local failure<const> = validate_program_asset_core(job.system_summary, 'SYSTEM')
			if failure then
				finish_program_link_precheck_from_failure(failure)
				return
			end
			job.phase = 'validate_system_details'
		elseif job.phase == 'validate_system_details' then
				if job.system_details_state == nil then
					job.system_details_state = begin_program_asset_details_step_state(system_rom_base, job.system_header, job.system_summary, {
						scope = 'SYSTEM',
					})
				end
			local done<const>, failure<const> = step_program_asset_details_step_state(job.system_details_state, job)
			if done == nil then
				finish_program_link_precheck_from_failure(failure)
				return
			end
			if not done then
				return
			end
			job.system_details_state = nil
			job.phase = 'read_cart_summary'
		elseif job.phase == 'read_cart_summary' then
			if job.cart_summary_state == nil then
				job.cart_summary_state = begin_program_asset_summary_step_state(cart_rom_base, job.cart_header)
			end
			local done<const>, summary<const> = step_program_asset_summary_step_state(job.cart_summary_state, job)
			if not done then
				return
			end
			job.cart_summary_state = nil
			job.cart_summary = summary
			job.phase = 'validate_cart_core'
		elseif job.phase == 'validate_cart_core' then
			local failure<const> = validate_program_asset_core(job.cart_summary, 'CART')
			if failure then
				finish_program_link_precheck_from_failure(failure)
				return
			end
			job.phase = 'validate_cart_details'
		elseif job.phase == 'validate_cart_details' then
			if job.cart_details_state == nil then
				job.cart_details_state = begin_program_asset_details_step_state(cart_rom_base, job.cart_header, job.cart_summary, {
					scope = 'CART',
				})
			end
			local done<const>, failure<const> = step_program_asset_details_step_state(job.cart_details_state, job)
			if done == nil then
				finish_program_link_precheck_from_failure(failure)
				return
			end
			if not done then
				return
			end
			job.cart_details_state = nil
			finish_program_link_precheck({}, nil)
			return
		else
			finish_program_link_precheck({
				'PROGRAM PRECHECK FAILED',
			}, '[ProgramLinker] Cart precheck entered invalid phase: ' .. tostring(job.phase))
			return
		end
	end)
	if not ok then
		finish_program_link_precheck({
			'PROGRAM PRECHECK FAILED',
			tostring(err),
		}, '[ProgramLinker] Cart precheck failed: ' .. tostring(err))
	end
end

local run_program_link_precheck_job<const> = function()
	if precheck_co_thread == nil then
		return
	end
	reset_precheck_step_budget(precheck_co_thread)
	run_staged_program_link_precheck_job()
end

local assert_range<const> = function(offset, length, total, label)
	if offset < 0 or length < 0 or (offset + length) > total then
		error('Invalid ROM ' .. label .. ' range.')
	end
end

local new_reader<const> = function(base, size, label)
	return {
		base = base,
		size = size,
		pos = 0,
		label = label,
	}
end

local reader_require<const> = function(reader, length, label)
	if reader.pos + length > reader.size then
		error((label or reader.label) .. ' out of bounds.')
	end
end

local reader_read_u8<const> = function(reader, label)
	reader_require(reader, 1, label)
	local addr<const> = reader.base + reader.pos
	local out<const> = mem8[addr]
	reader.pos = reader.pos + 1
	return out
end

local reader_skip_bytes<const> = function(reader, length, label)
	reader_require(reader, length, label)
	reader.pos = reader.pos + length
end

local reader_read_varuint<const> = function(reader, label)
	local result = 0
	local shift = 0
	while true do
		local byte<const> = reader_read_u8(reader, label)
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

local reader_read_varint<const> = function(reader, label)
	local raw<const> = reader_read_varuint(reader, label)
	local value<const> = raw >> 1
	if (raw & 1) ~= 0 then
		return -value - 1
	end
	return value
end

local reader_read_raw_string<const> = function(reader, length, label)
	if length == 0 then
		return ''
	end
	reader_require(reader, length, label)
	local parts<const> = {}
	local remaining = length
	while remaining > 0 do
		local chunk_len<const> = math.min(120, remaining)
		local chunk = ''
		for i = 1, chunk_len do
			chunk = chunk .. string.char(reader_read_u8(reader, label))
		end
		parts[#parts + 1] = chunk
		remaining = remaining - chunk_len
	end
	return table.concat(parts)
end

local reader_read_string<const> = function(reader, label)
	local length<const> = reader_read_varuint(reader, label)
	return reader_read_raw_string(reader, length, label)
end

local reader_read_u32le<const> = function(reader, label)
	reader_require(reader, 4, label)
	local addr<const> = reader.base + reader.pos
	local out<const> = mem32le[addr]
	reader.pos = reader.pos + 4
	return out
end

local selftest_bitcast_builtins<const> = function()
	local ok<const>, err<const> = pcall(function()
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
		local neg_zero<const> = u64_to_f64(0x80000000, 0x00000000)
		assert(neg_zero == 0.0 and (1.0 / neg_zero) == -math.huge)
		-- +inf
		assert(u64_to_f64(0x7ff00000, 0x00000000) == math.huge)
		-- qNaN: NaN is the only value not equal to itself
		local nan<const> = u64_to_f64(0x7ff80000, 0x00000000)
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

local reader_read_prop_key<const> = function(reader, prop_names, label)
	local prop_id<const> = reader_read_varuint(reader, label)
	local index<const> = prop_id + 1
	local key<const> = prop_names[index]
	if key == nil then
		error((label or reader.label) .. ' invalid property id ' .. tostring(prop_id) .. '.')
	end
	return key
end

local reader_skip_value_from_tag<const> = function(reader, prop_names, tag)
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
		local length<const> = reader_read_varuint(reader, 'string length')
		reader_skip_bytes(reader, length, 'string')
		return
	end
	if tag == bin_tag_arr or tag == bin_tag_set then
		local count<const> = reader_read_varuint(reader, 'array length')
		for i = 1, count do
			local value_tag<const> = reader_read_u8(reader, 'array tag')
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
		return
	end
	if tag == bin_tag_ref then
		reader_read_varuint(reader, 'ref id')
		return
	end
	if tag == bin_tag_obj then
		local count<const> = reader_read_varuint(reader, 'object property count')
		for i = 1, count do
			reader_read_prop_key(reader, prop_names, 'object property id')
			local value_tag<const> = reader_read_u8(reader, 'object value tag')
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
		return
	end
	if tag == bin_tag_bin then
		local length<const> = reader_read_varuint(reader, 'binary length')
		reader_skip_bytes(reader, length, 'binary payload')
		return
	end
	error('Unsupported bin tag ' .. tostring(tag) .. '.')
end

local new_skip_value_state<const> = function(reader, prop_names, tag)
	return {
		reader = reader,
		prop_names = prop_names,
		stack = {
			{ kind = 'value', tag = tag },
		},
	}
end

local new_skip_array_items_state<const> = function(reader, prop_names, count)
	return {
		reader = reader,
		prop_names = prop_names,
		stack = {
			{ kind = 'array', remaining = count, total = count },
		},
	}
end

local new_skip_object_properties_state<const> = function(reader, prop_names, count)
	return {
		reader = reader,
		prop_names = prop_names,
		stack = {
			{ kind = 'object', remaining = count, total = count },
		},
	}
end

local step_skip_state<const> = function(skip_state, job)
	local reader<const> = skip_state.reader
	local prop_names<const> = skip_state.prop_names
	while consume_precheck_step(job) do
		local stack<const> = skip_state.stack
		local frame<const> = stack[#stack]
		if frame == nil then
			return true
		end
		if frame.kind == 'value' then
			local tag<const> = frame.tag
			if tag == bin_tag_null or tag == bin_tag_true or tag == bin_tag_false then
				stack[#stack] = nil
			elseif tag == bin_tag_f64 then
				reader_skip_bytes(reader, 8, 'f64')
				stack[#stack] = nil
			elseif tag == bin_tag_f32 then
				reader_skip_bytes(reader, 4, 'f32')
				stack[#stack] = nil
			elseif tag == bin_tag_int then
				reader_read_varint(reader, 'int')
				stack[#stack] = nil
			elseif tag == bin_tag_str then
				local length<const> = reader_read_varuint(reader, 'string length')
				reader_skip_bytes(reader, length, 'string')
				stack[#stack] = nil
			elseif tag == bin_tag_arr or tag == bin_tag_set then
				local count<const> = reader_read_varuint(reader, 'array length')
				frame.kind = 'array'
				frame.remaining = count
				frame.total = count
			elseif tag == bin_tag_ref then
				reader_read_varuint(reader, 'ref id')
				stack[#stack] = nil
			elseif tag == bin_tag_obj then
				local count<const> = reader_read_varuint(reader, 'object property count')
				frame.kind = 'object'
				frame.remaining = count
				frame.total = count
			elseif tag == bin_tag_bin then
				local length<const> = reader_read_varuint(reader, 'binary length')
				reader_skip_bytes(reader, length, 'binary payload')
				stack[#stack] = nil
			else
				error('Unsupported bin tag ' .. tostring(tag) .. '.')
			end
		elseif frame.kind == 'array' then
			if frame.remaining <= 0 then
				stack[#stack] = nil
			else
				frame.remaining = frame.remaining - 1
				local value_tag<const> = reader_read_u8(reader, 'array tag')
				stack[#stack + 1] = { kind = 'value', tag = value_tag }
			end
		elseif frame.kind == 'object' then
			if frame.remaining <= 0 then
				stack[#stack] = nil
			else
				frame.remaining = frame.remaining - 1
				reader_read_prop_key(reader, prop_names, 'object property id')
				local value_tag<const> = reader_read_u8(reader, 'object value tag')
				stack[#stack + 1] = { kind = 'value', tag = value_tag }
			end
		else
			error('Unsupported skip frame kind ' .. tostring(frame.kind) .. '.')
		end
	end
	return false
end

local get_skip_state_progress<const> = function(skip_state)
	local frame<const> = skip_state.stack[1]
	if frame == nil then
		return 1
	end
	if frame.total == nil or frame.total <= 0 then
		return 0
	end
	return (frame.total - frame.remaining) / frame.total
end

local reader_read_const_value<const> = function(reader, prop_names)
	local tag<const> = reader_read_u8(reader, 'const value tag')
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
		reader_require(reader, 4, 'const f32')
		local addr<const> = reader.base + reader.pos
		local value<const> = memf32le[addr]
		reader.pos = reader.pos + 4
		return { kind = 'num', value = value }
	end
	if tag == bin_tag_f64 then
		reader_require(reader, 8, 'const f64')
		local addr<const> = reader.base + reader.pos
		local value<const> = memf64le[addr]
		reader.pos = reader.pos + 8
		return { kind = 'num', value = value }
	end
	if tag == bin_tag_str then
		return { kind = 'str', value = reader_read_string(reader, 'const string') }
	end
	reader_skip_value_from_tag(reader, prop_names, tag)
	return { kind = 'unsupported' }
end

local reader_read_const_pool<const> = function(reader, prop_names)
	local tag<const> = reader_read_u8(reader, 'constPool tag')
	if tag ~= bin_tag_arr then
		error('Program constPool must be an array.')
	end
	local count<const> = reader_read_varuint(reader, 'constPool count')
	local out<const> = {}
	for i = 1, count do
		out[i] = reader_read_const_value(reader, prop_names)
	end
	return out
end

local reader_read_program_const_pool<const> = function(reader, prop_names)
	local tag<const> = reader_read_u8(reader, 'program tag')
	if tag ~= bin_tag_obj then
		error('Program payload must be an object.')
	end
	local prop_count<const> = reader_read_varuint(reader, 'program property count')
	local const_pool
	for i = 1, prop_count do
		local key<const> = reader_read_prop_key(reader, prop_names, 'program property id')
		if key == 'constPool' then
			const_pool = reader_read_const_pool(reader, prop_names)
		else
			local value_tag<const> = reader_read_u8(reader, 'program value tag')
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	if const_pool == nil then
		error('Program payload is missing constPool.')
	end
	return const_pool
end

local read_program_const_pool_payload<const> = function(base, size)
	local reader<const> = new_reader(base, size, 'program payload')
	local version<const> = reader_read_u8(reader, 'bin version')
	if version ~= bin_version then
		error('Unsupported binary payload version.')
	end
	local prop_count<const> = reader_read_varuint(reader, 'property count')
	local prop_names<const> = {}
	for i = 1, prop_count do
		prop_names[i] = reader_read_string(reader, 'property name')
	end
	local root_tag<const> = reader_read_u8(reader, 'root tag')
	if root_tag ~= bin_tag_obj then
		error('Program root must be an object.')
	end
	local root_prop_count<const> = reader_read_varuint(reader, 'root property count')
	local const_pool
	for i = 1, root_prop_count do
		local key<const> = reader_read_prop_key(reader, prop_names, 'root property id')
		if key == 'program' then
			const_pool = reader_read_program_const_pool(reader, prop_names)
		else
			local value_tag<const> = reader_read_u8(reader, 'root value tag')
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	if const_pool == nil then
		error('Program root is missing program.constPool.')
	end
	return const_pool
end

local read_toc_string<const> = function(string_table_base, string_table_size, offset, length)
	if offset == toc_invalid_u32 or length == 0 then
		return ''
	end
	assert_range(offset, length, string_table_size, 'toc string table')
	local reader<const> = new_reader(string_table_base + offset, length, 'toc string')
	return reader_read_raw_string(reader, length, 'toc string')
end

local find_data_asset_payload_range<const> = function(rom_base, header, target_asset_id)
	if header.toc_len < toc_header_size then
		error('ROM TOC is too small.')
	end
	local toc_base<const> = rom_base + header.toc_off
	local toc_magic<const> = mem[toc_base + 0]
	if toc_magic ~= toc_magic then
		error('Invalid ROM TOC magic.')
	end
	local toc_header_size<const> = mem[toc_base + 4]
	if toc_header_size ~= toc_header_size then
		error('Unexpected ROM TOC header size.')
	end
	local entry_size<const> = mem[toc_base + 8]
	if entry_size ~= toc_entry_size then
		error('Unexpected ROM TOC entry size.')
	end
	local entry_count<const> = mem[toc_base + 12]
	local entry_offset<const> = mem[toc_base + 16]
	if entry_offset ~= toc_header_size then
		error('Unexpected ROM TOC entry offset.')
	end
	local string_table_offset<const> = mem[toc_base + 20]
	local string_table_length<const> = mem[toc_base + 24]
	local entries_bytes<const> = entry_count * entry_size
	local expected_string_offset<const> = entry_offset + entries_bytes
	if string_table_offset ~= expected_string_offset then
		error('Unexpected ROM TOC string table offset.')
	end
	assert_range(entry_offset, entries_bytes, header.toc_len, 'toc entries')
	assert_range(string_table_offset, string_table_length, header.toc_len, 'toc string table')
	local string_table_base<const> = toc_base + string_table_offset
	for index = 0, entry_count - 1 do
		local entry<const> = toc_base + entry_offset + (index * entry_size)
		local type_id<const> = mem[entry + 8]
		if type_id == rom_asset_type_data then
			local resid_offset<const> = mem[entry + 16]
			local resid_length<const> = mem[entry + 20]
			local asset_id<const> = read_toc_string(string_table_base, string_table_length, resid_offset, resid_length)
			if asset_id == target_asset_id then
				local payload_start<const> = mem[entry + 40]
				local payload_end<const> = mem[entry + 44]
				if payload_start == toc_invalid_u32 or payload_end == toc_invalid_u32 or payload_end <= payload_start then
					error('Data asset "' .. target_asset_id .. '" is missing payload range.')
				end
				assert_range(payload_start, payload_end - payload_start, header.data_off + header.data_len, target_asset_id .. ' payload')
				return {
					start = payload_start,
					['end'] = payload_end,
				}
			end
		end
	end
	error('Data asset "' .. target_asset_id .. '" was not found in ROM TOC.')
end

local find_program_payload_range<const> = function(rom_base, header)
	return find_data_asset_payload_range(rom_base, header, program_asset_id)
end

read_rom_program_const_pool = function(rom_base, header)
	local payload<const> = find_program_payload_range(rom_base, header)
	local payload_size<const> = payload['end'] - payload.start
	return read_program_const_pool_payload(rom_base + payload.start, payload_size)
end

local reader_read_number_from_tag<const> = function(reader, tag, label)
	if tag == bin_tag_int then
		return reader_read_varint(reader, label)
	end
	if tag == bin_tag_f32 then
		reader_require(reader, 4, label)
		local addr<const> = reader.base + reader.pos
		local value<const> = memf32le[addr]
		reader.pos = reader.pos + 4
		return value
	end
	if tag == bin_tag_f64 then
		reader_require(reader, 8, label)
		local addr<const> = reader.base + reader.pos
		local value<const> = memf64le[addr]
		reader.pos = reader.pos + 8
		return value
	end
	error((label or reader.label) .. ' must be a number.')
end

local reader_read_string_from_tag<const> = function(reader, tag, label)
	if tag ~= bin_tag_str then
		error((label or reader.label) .. ' must be a string.')
	end
	return reader_read_string(reader, label)
end

local reader_read_non_negative_integer_from_tag<const> = function(reader, tag, label)
	local value<const> = reader_read_number_from_tag(reader, tag, label)
	if value ~= (value // 1) then
		error((label or reader.label) .. ' must be an integer.')
	end
	if value < 0 then
		error((label or reader.label) .. ' must be non-negative.')
	end
	return value
end

local reader_read_binary_range_from_tag<const> = function(reader, tag, label)
	if tag ~= bin_tag_bin then
		error((label or reader.label) .. ' must be binary.')
	end
	local length<const> = reader_read_varuint(reader, (label or reader.label) .. ' length')
	local start<const> = reader.base + reader.pos
	reader_skip_bytes(reader, length, label)
	return {
		start = start,
		size = length,
	}
end

local reader_read_object_property_count<const> = function(reader, tag, label)
	if tag ~= bin_tag_obj then
		error((label or reader.label) .. ' must be an object.')
	end
	return reader_read_varuint(reader, (label or reader.label) .. ' property count')
end

local reader_read_array_length<const> = function(reader, tag, label)
	if tag ~= bin_tag_arr then
		error((label or reader.label) .. ' must be an array.')
	end
	return reader_read_varuint(reader, (label or reader.label) .. ' count')
end

local reader_skip_array<const> = function(reader, prop_names, tag, label)
	local count<const> = reader_read_array_length(reader, tag, label)
	for i = 1, count do
		local value_tag<const> = reader_read_u8(reader, (label or reader.label) .. ' item tag')
		reader_skip_value_from_tag(reader, prop_names, value_tag)
	end
	return count
end

local begin_program_asset_payload_reader<const> = function(rom_base, header)
	local payload<const> = find_program_payload_range(rom_base, header)
	local payload_size<const> = payload['end'] - payload.start
	local reader<const> = new_reader(rom_base + payload.start, payload_size, 'program image payload')
	local version<const> = reader_read_u8(reader, 'bin version')
	if version ~= bin_version then
		error('Unsupported binary payload version.')
	end
	local prop_count<const> = reader_read_varuint(reader, 'property count')
	local prop_names<const> = {}
	for i = 1, prop_count do
		prop_names[i] = reader_read_string(reader, 'property name')
	end
	local root_tag<const> = reader_read_u8(reader, 'root tag')
	if root_tag ~= bin_tag_obj then
		error('Program asset root must be an object.')
	end
	local root_prop_count<const> = reader_read_varuint(reader, 'root property count')
	return reader, prop_names, root_prop_count
end

local read_program_asset_core_summary_from_reader<const> = function(reader, prop_names, root_prop_count)
	local summary<const> = {
		entry_proto_index = nil,
		code_range = nil,
		const_pool_count = nil,
		proto_count = nil,
	}
	for i = 1, root_prop_count do
		local key<const> = reader_read_prop_key(reader, prop_names, 'root property id')
		local value_tag<const> = reader_read_u8(reader, 'root value tag')
		if key == 'entryProtoIndex' then
			summary.entry_proto_index = reader_read_non_negative_integer_from_tag(reader, value_tag, 'ProgramImage.entryProtoIndex')
		elseif key == 'program' then
			local prop_count<const> = reader_read_object_property_count(reader, value_tag, 'ProgramImage.program')
			for j = 1, prop_count do
				local program_key<const> = reader_read_prop_key(reader, prop_names, 'program property id')
				local program_tag<const> = reader_read_u8(reader, 'program value tag')
				if program_key == 'code' then
					summary.code_range = reader_read_binary_range_from_tag(reader, program_tag, 'ProgramImage.program.code')
				elseif program_key == 'constPool' then
					summary.const_pool_count = reader_skip_array(reader, prop_names, program_tag, 'ProgramImage.program.constPool')
				elseif program_key == 'protos' then
					summary.proto_count = reader_skip_array(reader, prop_names, program_tag, 'ProgramImage.program.protos')
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

begin_program_asset_summary_step_state = function(rom_base, header)
	local reader<const>, prop_names<const>, root_prop_count<const> = begin_program_asset_payload_reader(rom_base, header)
	return {
		reader = reader,
		prop_names = prop_names,
		root_prop_count = root_prop_count,
		root_index = 1,
		program_prop_count = nil,
		program_index = 1,
		skip = nil,
		skip_target = nil,
		summary = {
			entry_proto_index = nil,
			code_range = nil,
			const_pool_count = nil,
			proto_count = nil,
		},
	}
end

step_program_asset_summary_step_state = function(state, job)
	local reader<const> = state.reader
	local prop_names<const> = state.prop_names
	while true do
		if state.skip ~= nil then
			if not step_skip_state(state.skip, job) then
				return false
			end
			state.skip = nil
			if state.skip_target == 'program' then
				state.program_index = state.program_index + 1
			else
				state.root_index = state.root_index + 1
			end
			state.skip_target = nil
		elseif state.program_prop_count ~= nil then
			if state.program_index > state.program_prop_count then
				state.program_prop_count = nil
				state.program_index = 1
				state.root_index = state.root_index + 1
			else
				if not consume_precheck_step(job) then
					return false
				end
				local program_key<const> = reader_read_prop_key(reader, prop_names, 'program property id')
				local program_tag<const> = reader_read_u8(reader, 'program value tag')
				if program_key == 'code' then
					state.summary.code_range = reader_read_binary_range_from_tag(reader, program_tag, 'ProgramImage.program.code')
					state.program_index = state.program_index + 1
				elseif program_key == 'constPool' then
					local count<const> = reader_read_array_length(reader, program_tag, 'ProgramImage.program.constPool')
					state.summary.const_pool_count = count
					state.skip = new_skip_array_items_state(reader, prop_names, count)
					state.skip_target = 'program'
				elseif program_key == 'protos' then
					local count<const> = reader_read_array_length(reader, program_tag, 'ProgramImage.program.protos')
					state.summary.proto_count = count
					state.skip = new_skip_array_items_state(reader, prop_names, count)
					state.skip_target = 'program'
				else
					state.skip = new_skip_value_state(reader, prop_names, program_tag)
					state.skip_target = 'program'
				end
			end
		else
			if state.root_index > state.root_prop_count then
				return true, state.summary
			end
			if not consume_precheck_step(job) then
				return false
			end
			local key<const> = reader_read_prop_key(reader, prop_names, 'root property id')
			local value_tag<const> = reader_read_u8(reader, 'root value tag')
			if key == 'entryProtoIndex' then
				state.summary.entry_proto_index = reader_read_non_negative_integer_from_tag(reader, value_tag, 'ProgramImage.entryProtoIndex')
				state.root_index = state.root_index + 1
			elseif key == 'program' then
				state.program_prop_count = reader_read_object_property_count(reader, value_tag, 'ProgramImage.program')
				state.program_index = 1
			else
				state.skip = new_skip_value_state(reader, prop_names, value_tag)
				state.skip_target = 'root'
			end
		end
	end
end

get_program_asset_summary_step_progress = function(state)
	if state.root_prop_count <= 0 then
		return 1
	end
	local root_progress<const> = state.root_index - 1
	local root_scale<const> = 1 / state.root_prop_count
	if state.skip ~= nil then
		local skip_progress<const> = get_skip_state_progress(state.skip)
		if state.skip_target == 'program' and state.program_prop_count ~= nil and state.program_prop_count > 0 then
			local program_progress<const> = ((state.program_index - 1) + skip_progress) / state.program_prop_count
			return clamp_int((root_progress + program_progress) * root_scale, 0, 1)
		end
		return clamp_int((root_progress + skip_progress) * root_scale, 0, 1)
	end
	if state.program_prop_count ~= nil and state.program_prop_count > 0 then
		local program_progress<const> = (state.program_index - 1) / state.program_prop_count
		return clamp_int((root_progress + program_progress) * root_scale, 0, 1)
	end
	return clamp_int(root_progress * root_scale, 0, 1)
end

read_rom_program_asset_summary = function(rom_base, header)
	local reader<const>, prop_names<const>, root_prop_count<const> = begin_program_asset_payload_reader(rom_base, header)
	return read_program_asset_core_summary_from_reader(reader, prop_names, root_prop_count)
end

local make_program_precheck_failure<const> = function(scope, detail, stderr)
	return {
		title = scope .. ' PROGRAM ASSET IS INVALID',
		detail = detail,
		stderr = stderr,
	}
end

validate_program_asset_core = function(summary, scope)
	if summary.entry_proto_index == nil then
		return make_program_precheck_failure(scope, 'ENTRYPROTOINDEX IS MISSING', '[ProgramLinker] ' .. scope .. ' program image is missing entryProtoIndex.')
	end
	if summary.code_range == nil then
		return make_program_precheck_failure(scope, 'PROGRAM.CODE IS MISSING', '[ProgramLinker] ' .. scope .. ' program image is missing program.code.')
	end
	if summary.const_pool_count == nil then
		return make_program_precheck_failure(scope, 'PROGRAM.CONSTPOOL IS MISSING', '[ProgramLinker] ' .. scope .. ' program image is missing program.constPool.')
	end
	if summary.proto_count == nil then
		return make_program_precheck_failure(scope, 'PROGRAM.PROTOS IS MISSING', '[ProgramLinker] ' .. scope .. ' program image is missing program.protos.')
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

validate_program_boot_asset = function(summary, scope, params)
	if summary.program_boot_version ~= program_boot_header_version then
		return make_program_precheck_failure(
			scope,
			'PROGRAM.BOOT.VERSION ' .. tostring(summary.program_boot_version) .. ' IS UNSUPPORTED',
			'[ProgramLinker] ' .. scope .. ' cart header program boot version is unsupported.'
		)
	end
	if (summary.program_code_byte_count % 4) ~= 0 then
		return make_program_precheck_failure(scope, 'PROGRAM.BOOT.CODEBYTECOUNT IS MISALIGNED', '[ProgramLinker] ' .. scope .. ' cart header program codeByteCount is not divisible by 4.')
	end
	if summary.program_entry_proto_index >= summary.program_proto_count then
		return make_program_precheck_failure(
			scope,
			'PROGRAM.BOOT.ENTRYPROTOINDEX ' .. tostring(summary.program_entry_proto_index) .. ' EXCEEDS PROTO COUNT ' .. tostring(summary.program_proto_count),
			'[ProgramLinker] ' .. scope .. ' cart header program entryProtoIndex exceeds proto count.'
		)
	end
	return nil
end

local read_module_proto_entry<const> = function(reader, prop_names, tag)
	local prop_count<const> = reader_read_object_property_count(reader, tag, 'ProgramImage.moduleProtos[]')
	local path = nil
	local proto_index = nil
	for i = 1, prop_count do
		local key<const> = reader_read_prop_key(reader, prop_names, 'ProgramImage.moduleProtos[] property id')
		local value_tag<const> = reader_read_u8(reader, 'ProgramImage.moduleProtos[] value tag')
		if key == 'path' then
			path = reader_read_string_from_tag(reader, value_tag, 'ProgramImage.moduleProtos[].path')
		elseif key == 'protoIndex' then
			proto_index = reader_read_non_negative_integer_from_tag(reader, value_tag, 'ProgramImage.moduleProtos[].protoIndex')
		else
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	return path, proto_index
end

local validate_module_protos_array<const> = function(reader, prop_names, tag, summary, scope)
	local count<const> = reader_read_array_length(reader, tag, 'ProgramImage.moduleProtos')
	for i = 1, count do
		local item_tag<const> = reader_read_u8(reader, 'ProgramImage.moduleProtos item tag')
		local path<const>, proto_index<const> = read_module_proto_entry(reader, prop_names, item_tag)
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

local read_const_reloc_entry<const> = function(reader, prop_names, tag)
	local prop_count<const> = reader_read_object_property_count(reader, tag, 'ProgramImage.link.constRelocs[]')
	local word_index = nil
	local kind = nil
	local const_index = nil
	for i = 1, prop_count do
		local key<const> = reader_read_prop_key(reader, prop_names, 'ProgramImage.link.constRelocs[] property id')
		local value_tag<const> = reader_read_u8(reader, 'ProgramImage.link.constRelocs[] value tag')
		if key == 'wordIndex' then
			word_index = reader_read_non_negative_integer_from_tag(reader, value_tag, 'ProgramImage.link.constRelocs[].wordIndex')
		elseif key == 'kind' then
			kind = reader_read_string_from_tag(reader, value_tag, 'ProgramImage.link.constRelocs[].kind')
		elseif key == 'constIndex' then
			const_index = reader_read_non_negative_integer_from_tag(reader, value_tag, 'ProgramImage.link.constRelocs[].constIndex')
		else
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	return word_index, kind, const_index
end

local validate_const_relocs_array<const> = function(reader, prop_names, tag, summary, scope)
	local count<const> = reader_read_array_length(reader, tag, 'ProgramImage.link.constRelocs')
	for i = 1, count do
		local item_tag<const> = reader_read_u8(reader, 'ProgramImage.link.constRelocs item tag')
		local word_index<const>, kind<const>, const_index<const> = read_const_reloc_entry(reader, prop_names, item_tag)
		local reloc_id<const> = tostring(i - 1)
		if word_index == nil then
			return make_program_precheck_failure(scope, 'CONSTRELOC ' .. reloc_id .. ' IS MISSING WORDINDEX', '[ProgramLinker] ' .. scope .. ' const reloc is missing wordIndex.')
		end
		if kind == nil then
			return make_program_precheck_failure(scope, 'CONSTRELOC ' .. reloc_id .. ' IS MISSING KIND', '[ProgramLinker] ' .. scope .. ' const reloc is missing kind.')
		end
		if not program_const_reloc_kind_lookup[kind] then
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
		if program_const_reloc_const_pool_lookup[kind] and const_index >= summary.const_pool_count then
			return make_program_precheck_failure(
				scope,
				'CONSTRELOC ' .. reloc_id .. ' TARGETS CONST ' .. tostring(const_index) .. ' OUT OF RANGE',
				'[ProgramLinker] ' .. scope .. ' const reloc targets a const index outside program.constPool.'
			)
		end
	end
	return nil
end

local validate_program_link_object<const> = function(reader, prop_names, tag, summary, scope)
	local prop_count<const> = reader_read_object_property_count(reader, tag, 'ProgramImage.link')
	local saw_const_relocs = false
	for i = 1, prop_count do
		local key<const> = reader_read_prop_key(reader, prop_names, 'ProgramImage.link property id')
		local value_tag<const> = reader_read_u8(reader, 'ProgramImage.link value tag')
		if key == 'constRelocs' then
			saw_const_relocs = true
			local failure<const> = validate_const_relocs_array(reader, prop_names, value_tag, summary, scope)
			if failure then
				return failure
			end
		else
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	if not saw_const_relocs then
		return make_program_precheck_failure(scope, 'LINK.CONSTRELOCS IS MISSING', '[ProgramLinker] ' .. scope .. ' program image is missing link.constRelocs.')
	end
	return nil
end

local get_object_entry_state_progress<const> = function(state)
	if state.prop_count <= 0 then
		return 1
	end
	local progress = state.prop_index - 1
	if state.skip ~= nil then
		progress = progress + get_skip_state_progress(state.skip)
	end
	return clamp_int(progress / state.prop_count, 0, 1)
end

local new_module_proto_entry_state<const> = function(reader, prop_names, tag)
	return {
		reader = reader,
		prop_names = prop_names,
		prop_count = reader_read_object_property_count(reader, tag, 'ProgramImage.moduleProtos[]'),
		prop_index = 1,
		path = nil,
		proto_index = nil,
		skip = nil,
	}
end

local step_module_proto_entry_state<const> = function(state, job)
	while true do
		if state.skip ~= nil then
			if not step_skip_state(state.skip, job) then
				return false
			end
			state.skip = nil
			state.prop_index = state.prop_index + 1
		else
			if state.prop_index > state.prop_count then
				return true
			end
			if not consume_precheck_step(job) then
				return false
			end
			local key<const> = reader_read_prop_key(state.reader, state.prop_names, 'ProgramImage.moduleProtos[] property id')
			local value_tag<const> = reader_read_u8(state.reader, 'ProgramImage.moduleProtos[] value tag')
			if key == 'path' then
				state.path = reader_read_string_from_tag(state.reader, value_tag, 'ProgramImage.moduleProtos[].path')
				state.prop_index = state.prop_index + 1
			elseif key == 'protoIndex' then
				state.proto_index = reader_read_non_negative_integer_from_tag(state.reader, value_tag, 'ProgramImage.moduleProtos[].protoIndex')
				state.prop_index = state.prop_index + 1
			else
				state.skip = new_skip_value_state(state.reader, state.prop_names, value_tag)
			end
		end
	end
end

local new_module_protos_array_state<const> = function(reader, prop_names, tag, summary, scope)
	return {
		reader = reader,
		prop_names = prop_names,
		count = reader_read_array_length(reader, tag, 'ProgramImage.moduleProtos'),
		index = 1,
		entry = nil,
		summary = summary,
		scope = scope,
	}
end

local step_module_protos_array_state<const> = function(state, job)
	while true do
		if state.entry ~= nil then
			local done<const> = step_module_proto_entry_state(state.entry, job)
			if not done then
				return false
			end
			if state.entry.path == nil or #state.entry.path == 0 then
				return nil, make_program_precheck_failure(state.scope, 'MODULEPROTO PATH IS MISSING', '[ProgramLinker] ' .. state.scope .. ' moduleProtos entry is missing path.')
			end
			if state.entry.proto_index == nil then
				return nil, make_program_precheck_failure(state.scope, 'MODULEPROTO PROTOINDEX IS MISSING', '[ProgramLinker] ' .. state.scope .. ' moduleProtos entry is missing protoIndex.')
			end
			if state.entry.proto_index >= state.summary.proto_count then
				return nil, make_program_precheck_failure(
					state.scope,
					'MODULEPROTO ' .. state.entry.path .. ' TARGETS PROTO ' .. tostring(state.entry.proto_index) .. ' OUT OF RANGE',
					'[ProgramLinker] ' .. state.scope .. ' moduleProtos entry points outside the proto table.'
				)
			end
			state.entry = nil
			state.index = state.index + 1
		else
			if state.index > state.count then
				return true
			end
			if not consume_precheck_step(job) then
				return false
			end
			local item_tag<const> = reader_read_u8(state.reader, 'ProgramImage.moduleProtos item tag')
			state.entry = new_module_proto_entry_state(state.reader, state.prop_names, item_tag)
		end
	end
end

local get_module_protos_array_progress<const> = function(state)
	if state.count <= 0 then
		return 1
	end
	local progress = state.index - 1
	if state.entry ~= nil then
		progress = progress + get_object_entry_state_progress(state.entry)
	end
	return clamp_int(progress / state.count, 0, 1)
end

local new_const_reloc_entry_state<const> = function(reader, prop_names, tag)
	return {
		reader = reader,
		prop_names = prop_names,
		prop_count = reader_read_object_property_count(reader, tag, 'ProgramImage.link.constRelocs[]'),
		prop_index = 1,
		word_index = nil,
		kind = nil,
		const_index = nil,
		skip = nil,
	}
end

local step_const_reloc_entry_state<const> = function(state, job)
	while true do
		if state.skip ~= nil then
			if not step_skip_state(state.skip, job) then
				return false
			end
			state.skip = nil
			state.prop_index = state.prop_index + 1
		else
			if state.prop_index > state.prop_count then
				return true
			end
			if not consume_precheck_step(job) then
				return false
			end
			local key<const> = reader_read_prop_key(state.reader, state.prop_names, 'ProgramImage.link.constRelocs[] property id')
			local value_tag<const> = reader_read_u8(state.reader, 'ProgramImage.link.constRelocs[] value tag')
			if key == 'wordIndex' then
				state.word_index = reader_read_non_negative_integer_from_tag(state.reader, value_tag, 'ProgramImage.link.constRelocs[].wordIndex')
				state.prop_index = state.prop_index + 1
			elseif key == 'kind' then
				state.kind = reader_read_string_from_tag(state.reader, value_tag, 'ProgramImage.link.constRelocs[].kind')
				state.prop_index = state.prop_index + 1
			elseif key == 'constIndex' then
				state.const_index = reader_read_non_negative_integer_from_tag(state.reader, value_tag, 'ProgramImage.link.constRelocs[].constIndex')
				state.prop_index = state.prop_index + 1
			else
				state.skip = new_skip_value_state(state.reader, state.prop_names, value_tag)
			end
		end
	end
end

local new_const_relocs_array_state<const> = function(reader, prop_names, tag, summary, scope)
	return {
		reader = reader,
		prop_names = prop_names,
		count = reader_read_array_length(reader, tag, 'ProgramImage.link.constRelocs'),
		index = 1,
		entry = nil,
		summary = summary,
		scope = scope,
	}
end

local step_const_relocs_array_state<const> = function(state, job)
	while true do
		if state.entry ~= nil then
			local done<const> = step_const_reloc_entry_state(state.entry, job)
			if not done then
				return false
			end
			local reloc_id<const> = tostring(state.index - 1)
			if state.entry.word_index == nil then
				return nil, make_program_precheck_failure(state.scope, 'CONSTRELOC ' .. reloc_id .. ' IS MISSING WORDINDEX', '[ProgramLinker] ' .. state.scope .. ' const reloc is missing wordIndex.')
			end
			if state.entry.kind == nil then
				return nil, make_program_precheck_failure(state.scope, 'CONSTRELOC ' .. reloc_id .. ' IS MISSING KIND', '[ProgramLinker] ' .. state.scope .. ' const reloc is missing kind.')
			end
			if not program_const_reloc_kind_lookup[state.entry.kind] then
				return nil, make_program_precheck_failure(state.scope, 'CONSTRELOC ' .. reloc_id .. ' HAS INVALID KIND ' .. state.entry.kind, '[ProgramLinker] ' .. state.scope .. ' const reloc has invalid kind "' .. state.entry.kind .. '".')
			end
			if state.entry.const_index == nil then
				return nil, make_program_precheck_failure(state.scope, 'CONSTRELOC ' .. reloc_id .. ' IS MISSING CONSTINDEX', '[ProgramLinker] ' .. state.scope .. ' const reloc is missing constIndex.')
			end
			if state.entry.word_index < 0 or state.entry.word_index >= state.summary.instruction_count then
				return nil, make_program_precheck_failure(
					state.scope,
					'CONSTRELOC ' .. reloc_id .. ' TARGETS WORD ' .. tostring(state.entry.word_index) .. ' OUT OF RANGE',
					'[ProgramLinker] ' .. state.scope .. ' const reloc targets a word outside program.code.'
				)
			end
			if program_const_reloc_const_pool_lookup[state.entry.kind] and state.entry.const_index >= state.summary.const_pool_count then
				return nil, make_program_precheck_failure(
					state.scope,
					'CONSTRELOC ' .. reloc_id .. ' TARGETS CONST ' .. tostring(state.entry.const_index) .. ' OUT OF RANGE',
					'[ProgramLinker] ' .. state.scope .. ' const reloc targets a const index outside program.constPool.'
				)
			end
			state.entry = nil
			state.index = state.index + 1
		else
			if state.index > state.count then
				return true
			end
			if not consume_precheck_step(job) then
				return false
			end
			local item_tag<const> = reader_read_u8(state.reader, 'ProgramImage.link.constRelocs item tag')
			state.entry = new_const_reloc_entry_state(state.reader, state.prop_names, item_tag)
		end
	end
end

local get_const_relocs_array_progress<const> = function(state)
	if state.count <= 0 then
		return 1
	end
	local progress = state.index - 1
	if state.entry ~= nil then
		progress = progress + get_object_entry_state_progress(state.entry)
	end
	return clamp_int(progress / state.count, 0, 1)
end

local new_link_object_state<const> = function(reader, prop_names, tag, summary, scope)
	return {
		reader = reader,
		prop_names = prop_names,
		prop_count = reader_read_object_property_count(reader, tag, 'ProgramImage.link'),
		prop_index = 1,
		saw_const_relocs = false,
		const_relocs = nil,
		skip = nil,
		summary = summary,
		scope = scope,
	}
end

local step_link_object_state<const> = function(state, job)
	while true do
		if state.const_relocs ~= nil then
			local done<const>, failure<const> = step_const_relocs_array_state(state.const_relocs, job)
			if done == nil then
				return nil, failure
			end
			if not done then
				return false
			end
			state.const_relocs = nil
			state.prop_index = state.prop_index + 1
		elseif state.skip ~= nil then
			if not step_skip_state(state.skip, job) then
				return false
			end
			state.skip = nil
			state.prop_index = state.prop_index + 1
		else
			if state.prop_index > state.prop_count then
				if not state.saw_const_relocs then
					return nil, make_program_precheck_failure(state.scope, 'LINK.CONSTRELOCS IS MISSING', '[ProgramLinker] ' .. state.scope .. ' program image is missing link.constRelocs.')
				end
				return true
			end
			if not consume_precheck_step(job) then
				return false
			end
			local key<const> = reader_read_prop_key(state.reader, state.prop_names, 'ProgramImage.link property id')
			local value_tag<const> = reader_read_u8(state.reader, 'ProgramImage.link value tag')
			if key == 'constRelocs' then
				state.saw_const_relocs = true
				state.const_relocs = new_const_relocs_array_state(state.reader, state.prop_names, value_tag, state.summary, state.scope)
			else
				state.skip = new_skip_value_state(state.reader, state.prop_names, value_tag)
			end
		end
	end
end

local get_link_object_state_progress<const> = function(state)
	if state.prop_count <= 0 then
		return 1
	end
	local progress = state.prop_index - 1
	if state.const_relocs ~= nil then
		progress = progress + get_const_relocs_array_progress(state.const_relocs)
	elseif state.skip ~= nil then
		progress = progress + get_skip_state_progress(state.skip)
	end
	return clamp_int(progress / state.prop_count, 0, 1)
end

begin_program_asset_details_step_state = function(rom_base, header, summary, params)
	local reader<const>, prop_names<const>, root_prop_count<const> = begin_program_asset_payload_reader(rom_base, header)
	return {
		reader = reader,
		prop_names = prop_names,
		root_prop_count = root_prop_count,
		root_index = 1,
		summary = summary,
		scope = params.scope,
		saw_link = false,
		module_protos = nil,
		link = nil,
		skip = nil,
	}
end

step_program_asset_details_step_state = function(state, job)
	while true do
		if state.module_protos ~= nil then
			local done<const>, failure<const> = step_module_protos_array_state(state.module_protos, job)
			if done == nil then
				return nil, failure
			end
			if not done then
				return false
			end
			state.module_protos = nil
			state.root_index = state.root_index + 1
		elseif state.link ~= nil then
			local done<const>, failure<const> = step_link_object_state(state.link, job)
			if done == nil then
				return nil, failure
			end
			if not done then
				return false
			end
			state.link = nil
			state.root_index = state.root_index + 1
		elseif state.skip ~= nil then
			if not step_skip_state(state.skip, job) then
				return false
			end
			state.skip = nil
			state.root_index = state.root_index + 1
		else
			if state.root_index > state.root_prop_count then
				if not state.saw_link then
					return nil, make_program_precheck_failure(state.scope, 'LINK IS MISSING', '[ProgramLinker] ' .. state.scope .. ' program image is missing link.')
				end
				return true
			end
			if not consume_precheck_step(job) then
				return false
			end
			local key<const> = reader_read_prop_key(state.reader, state.prop_names, 'root property id')
			local value_tag<const> = reader_read_u8(state.reader, 'root value tag')
			if key == 'moduleProtos' then
				state.module_protos = new_module_protos_array_state(state.reader, state.prop_names, value_tag, state.summary, state.scope)
			elseif key == 'link' then
				state.saw_link = true
				state.link = new_link_object_state(state.reader, state.prop_names, value_tag, state.summary, state.scope)
			else
				state.skip = new_skip_value_state(state.reader, state.prop_names, value_tag)
			end
		end
	end
end

get_program_asset_details_step_progress = function(state)
	if state.root_prop_count <= 0 then
		return 1
	end
	local progress = state.root_index - 1
	if state.module_protos ~= nil then
		progress = progress + get_module_protos_array_progress(state.module_protos)
		elseif state.link ~= nil then
			progress = progress + get_link_object_state_progress(state.link)
	elseif state.skip ~= nil then
		progress = progress + get_skip_state_progress(state.skip)
	end
	return clamp_int(progress / state.root_prop_count, 0, 1)
end

validate_program_asset_details = function(rom_base, header, summary, params)
	local scope<const> = params.scope
	local reader<const>, prop_names<const>, root_prop_count<const> = begin_program_asset_payload_reader(rom_base, header)
	local saw_link = false
	for i = 1, root_prop_count do
		local key<const> = reader_read_prop_key(reader, prop_names, 'root property id')
		local value_tag<const> = reader_read_u8(reader, 'root value tag')
		if key == 'moduleProtos' then
			local failure<const> = validate_module_protos_array(reader, prop_names, value_tag, summary, scope)
			if failure then
				return failure
			end
		elseif key == 'link' then
			saw_link = true
			local failure<const> = validate_program_link_object(reader, prop_names, value_tag, summary, scope)
			if failure then
				return failure
			end
		else
			reader_skip_value_from_tag(reader, prop_names, value_tag)
		end
	end
	if not saw_link then
		return make_program_precheck_failure(scope, 'LINK IS MISSING', '[ProgramLinker] ' .. scope .. ' program image is missing link.')
	end
	return nil
end

local compute_program_link_errors<const> = function(cart_header)
	local errors<const> = {}
	local sys_header<const> = read_cart_header(system_rom_base)
	if not sys_header then
		errors[#errors + 1] = 'SYSTEM ROM HEADER IS INVALID'
		return errors, '[ProgramLinker] Missing system ROM header.'
	end
	local failure = validate_program_boot_asset(sys_header, 'SYSTEM', nil)
	if failure then
		errors[#errors + 1] = failure.title
		errors[#errors + 1] = failure.detail
		return errors, failure.stderr
	end
	failure = validate_program_boot_asset(cart_header, 'CART', nil)
	if failure then
		errors[#errors + 1] = failure.title
		errors[#errors + 1] = failure.detail
		return errors, failure.stderr
	end
	return errors, nil
end

local report_precheck_stderr_once<const> = function()
	if precheck_stderr_message and not precheck_stderr_reported then
		precheck_stderr_reported = true
		print(precheck_stderr_message)
		pcall(function()
			error(precheck_stderr_message)
		end)
	end
end

local ensure_program_link_precheck<const> = function(cart_header)
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
	local key<const> = build_precheck_key(cart_header)
	if precheck_cache_key == key then
		return precheck_errors
	end
	precheck_co_target_key = key
	local ok<const>, errors<const>, stderr_message<const> = pcall(compute_program_link_errors, cart_header)
	if not ok then
		finish_program_link_precheck({
			'PROGRAM PRECHECK FAILED',
			tostring(errors),
		}, '[ProgramLinker] Cart precheck failed: ' .. tostring(errors))
	else
		finish_program_link_precheck(errors, stderr_message)
	end
	report_precheck_stderr_once()
	return precheck_errors
end

local collect_cached_program_link_errors<const> = function(cart_header)
	if not cart_header then
		return {}
	end
	local key<const> = build_precheck_key(cart_header)
	if precheck_cache_key ~= key then
		return {}
	end
	return precheck_errors
end

local collect_cart_precheck_errors<const> = function(cart_header, cart_manifest)
	if not cart_header then
		clear_precheck_cache()
		return {}
	end
	local errors<const> = collect_cart_manifest_errors(cart_manifest)
	local host_fault_flags<const> = mem[sys_host_fault_flags]
	if (host_fault_flags & sys_host_fault_flag_active) ~= 0 and (host_fault_flags & sys_host_fault_flag_startup_blocking) ~= 0 then
		local host_fault_stage<const> = mem[sys_host_fault_stage]
		if host_fault_stage == sys_host_fault_stage_startup_refresh then
			errors[#errors + 1] = 'HOST STARTUP AUDIO REFRESH FAILED'
		else
			errors[#errors + 1] = 'HOST STARTUP FAULT'
		end
		local host_fault_message<const> = sys_host_fault_message()
		if host_fault_message ~= nil and #host_fault_message > 0 then
			errors[#errors + 1] = host_fault_message
		end
	end
	if not bitcast_selftest_ok then
		errors[#errors + 1] = 'BITCAST BUILTIN SELFTEST FAILED'
		errors[#errors + 1] = bitcast_selftest_error or 'BITCAST BUILTIN CONTRACT FAILURE'
		return errors
	end
	local link_errors<const> = collect_cached_program_link_errors(cart_header)
	for i = 1, #link_errors do
		errors[#errors + 1] = link_errors[i]
	end
	return errors
end

local get_program_precheck_status<const> = function(cart_header)
	if not cart_header then
		return 'NO CART', nil, true
	end
	if not bitcast_selftest_ok then
		return 'FAILED', bitcast_selftest_error or 'BITCAST BUILTIN CONTRACT FAILURE', true
	end
	local key<const> = build_precheck_key(cart_header)
	if precheck_cache_key == key then
		if #precheck_errors > 0 then
			return 'FAILED', precheck_errors[1], true
		end
		return 'OK', nil, true
	end
	if not boot_screen_visible then
		return 'PENDING', 'WAITING FOR BOOT SCREEN', false
	end
	return 'PENDING', 'PROGRAM BOOT HEADER NOT READ', false
end

local get_program_precheck_progress<const> = function(cart_header)
	if not cart_header then
		return 0, 0, 1, 'NO CART'
	end
	local key<const> = build_precheck_key(cart_header)
	if precheck_cache_key == key then
		return 1, 1, 1, 'DONE'
	end
	if not boot_screen_visible then
		return 0, 1, 1, 'WAITING FOR BOOT SCREEN'
	end
	return 0, 1, 1, 'READING PROGRAM BOOT HEADER'
end

local scroll_boot_lines<const> = function(lines, window_size, delta)
	local line_count<const> = #lines
	if line_count ~= boot_scroll_state.last_line_count then
		boot_scroll_state.last_line_count = line_count
		boot_scroll_state.top = clamp_int(boot_scroll_state.top, 0, line_count - window_size)
	end
	boot_scroll_state.top = clamp_int(boot_scroll_state.top + delta, 0, line_count - window_size)
	local visible_lines<const>, max_scroll<const> = scroll_window(lines, boot_scroll_state.top, window_size)
	local scroll_top<const> = boot_scroll_state.top
	boot_scroll_state.top = scroll_top
	return scroll_top, max_scroll, visible_lines
end

local center_x<const> = function(text, width)
	-- center text in given width, but ensure that the result is dividable by font_width
	return (((width - (string.len(text) * font_width)) // 2) // font_width) * font_width
end

local format_bytes<const> = function(value)
	local kb<const> = 1024
	local mb<const> = kb * 1024645
	if value >= mb then
		local scaled<const> = value / mb
		if scaled == (scaled // 1) then
			return string.format('%d MB', scaled)
		end
		return string.format('%.1f MB', scaled)
	end
	if value >= kb then
		local scaled<const> = value / kb
		if scaled == (scaled // 1) then
			return string.format('%d KB', scaled)
		end
		return string.format('%.1f KB', scaled)
	end
	return tostring(value) .. ' B'
end

local format_bignumbers<const> = function(value)
	if value >= 1000000 then
		local scaled<const> = value / 1000000
		if scaled == (scaled // 1) then
			return string.format('%dM', scaled)
		end
		return string.format('%.1fM', scaled)
	end
	if value >= 1000 then
		local scaled<const> = value / 1000
		if scaled == (scaled // 1) then
			return string.format('%dK', scaled)
		end
		return string.format('%.1fK', scaled)
	end
	return tostring(value)
end

local build_info<const> = function()
	local cart_header<const> = read_cart_header(cart_rom_base)
	local cart_manifest_raw<const> = cart_manifest
	local cart_root_path<const> = cart_project_root_path
	local cart_manifest<const> = cart_header and flatten_manifest(cart_manifest_raw, cart_root_path)
	local machine_manifest<const> = flatten_machine_manifest(machine_manifest)

	local cart_title<const> = cart_manifest and cart_manifest.title or '--'
	-- local cart_short = cart_manifest and cart_manifest.short_name or '--'
	local cart_rom<const> = cart_manifest and cart_manifest.rom_name or '--'
	-- local cart_ns = cart_manifest and cart_manifest.namespace or '--'
	local cart_view_label<const> = cart_manifest and cart_manifest.render_size or '--'
	-- local cart_entry = cart_manifest and cart_manifest.entry_path or '--'
	-- local cart_input = cart_manifest and cart_manifest.input or '--'
	local cart_cpu_raw<const> = cart_manifest and cart_manifest.cpu_freq_hz
	local cart_cpu_label<const> = format_cpu_mhz_from_hz(cart_cpu_raw)
	local cart_errors<const> = collect_cart_precheck_errors(cart_header, cart_manifest)
	local cart_has_errors<const> = #cart_errors > 0
	local precheck_status<const>, precheck_detail<const>, precheck_done<const> = get_program_precheck_status(cart_header)
	local precheck_progress<const>, precheck_phase_index<const>, precheck_phase_total<const>, precheck_phase_label<const> = get_program_precheck_progress(cart_header)

	local machine_view_label<const> = machine_manifest and machine_manifest.render_size or '--'
	local machine_cpu_raw<const> = machine_manifest and machine_manifest.cpu_freq_hz
	local machine_cpu_label<const> = format_cpu_mhz_from_hz(machine_cpu_raw)
	local vram_total<const> = sys_vram_system_slot_size + sys_vram_primary_slot_size + sys_vram_secondary_slot_size + sys_vram_framebuffer_size + sys_vram_staging_size

	return {
		machine_view = machine_view_label,
		machine_cpu_mhz = machine_cpu_label,
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
		root = cart_root_path and cart_root_path or '--',
		hw_cart_max = format_bytes(sys_cart_rom_size),
		hw_ram_total = format_bytes(sys_ram_size),
		hw_vram_total = format_bytes(vram_total),
		hw_max_cycles = format_bignumbers(sys_max_cycles_per_frame),
		bitcast_selftest_ok = bitcast_selftest_ok,
		bitcast_selftest_status = bitcast_selftest_status,
			bitcast_selftest_error = bitcast_selftest_error,
			precheck_status = precheck_status,
			precheck_detail = precheck_detail,
			precheck_done = precheck_done,
			precheck_progress = precheck_progress,
			precheck_phase_index = precheck_phase_index,
			precheck_phase_total = precheck_phase_total,
			precheck_phase_label = precheck_phase_label,
		}
end

local divider<const> = function(line_slots)
	return string.rep('-', line_slots)
end

local build_progress_bar<const> = function(progress, width)
	local clamped<const> = clamp_int(progress, 0, 1)
	local filled<const> = clamp_int((width * clamped + 0.5) // 1, 0, width)
	return '[' .. string.rep('#', filled) .. string.rep('-', width - filled) .. ']'
end

local compute_boot_progress<const> = function(info, cart_ready, elapsed)
	local stage_count<const> = 5
	local stage_done = 0
	if boot_screen_visible then
		stage_done = stage_done + 1
	end
	if info.bitcast_selftest_ok then
		stage_done = stage_done + 1
	end
	if system_slot_ready and not system_slot_failed then
		stage_done = stage_done + 1
	end
	stage_done = stage_done + info.precheck_progress
	if cart_ready then
		stage_done = stage_done + 1
	end
	return stage_done / stage_count
end

local append_wrapped_line<const> = function(lines, value, color, line_slots, first_prefix, next_prefix)
	local wrapped<const> = wrap_text_lines(value, line_slots, first_prefix, next_prefix or first_prefix)
	for i = 1, #wrapped do
		lines[#lines + 1] = { text = wrapped[i], color = color }
	end
end

local append_kv_wrapped<const> = function(lines, label, value, color, label_width, line_slots)
	local first_prefix<const> = string.format('%-' .. label_width .. 's : ', label)
	local next_prefix<const> = string.rep(' ', label_width) .. '   '
	local wrapped<const> = wrap_text_lines(value, line_slots, first_prefix, next_prefix)
	for i = 1, #wrapped do
		lines[#lines + 1] = { text = wrapped[i], color = color }
	end
end

local append_blank_line<const> = function(lines)
	lines[#lines + 1] = { text = '' }
end

local append_section<const> = function(lines, title, line_slots)
	append_wrapped_line(lines, title, color_section, line_slots, '', '')
	append_wrapped_line(lines, divider(line_slots), color_section, line_slots, '', '')
end

local build_boot_content_lines<const> = function(info, cart_present, cursor, elapsed, line_slots)
	local lines<const> = {}
	local cart_has_errors<const> = cart_present and info.cart_has_errors
	local hw_specs<const> = {
		{ label = 'MAX CART ROM', value = info.hw_cart_max, color = color_accent },
		{ label = 'CPU MHZ', value = info.machine_cpu_mhz, color = color_accent },
		{ label = 'TOTAL RAM', value = info.hw_ram_total, color = color_info_total },
		{ label = 'TOTAL VRAM', value = info.hw_vram_total, color = color_info_total },
		{ label = 'VIEWPORT', value = info.machine_view, color = color_info_total },
		-- { label = 'MAX CYCLES/FRAME', value = info.hw_max_cycles, color = color_accent },
	}
	local cart_specs<const> = {
		-- { label = 'CART ROM', value = info.cart_rom, color = color_accent },
		{ label = 'CART NAME', value = info.cart_title, color = color_ok },
	}
	local label_width = 0
	for i = 1, #hw_specs do
		local len<const> = #hw_specs[i].label
		if len > label_width then label_width = len end
	end
	for i = 1, #cart_specs do
		local len<const> = #cart_specs[i].label
		if len > label_width then label_width = len end
	end
	for i = 1, #boot_status_labels do
		local len<const> = #boot_status_labels[i]
		if len > label_width then label_width = len end
	end

	append_section(lines, 'SYSTEM SPECS', line_slots)
	for i = 1, #hw_specs do
		local spec<const> = hw_specs[i]
		append_kv_wrapped(lines, spec.label, spec.value, spec.color, label_width, line_slots)
	end

	append_blank_line(lines)
	append_section(lines, 'CARTRIDGE', line_slots)
	for i = 1, #cart_specs do
		local spec<const> = cart_specs[i]
		append_kv_wrapped(lines, spec.label, spec.value, spec.color or color_text, label_width, line_slots)
	end

	append_blank_line(lines)
	append_section(lines, 'BOOT STATUS', line_slots)
	local bitcast_color<const> = info.bitcast_selftest_ok and color_ok or color_warn
	append_kv_wrapped(lines, 'BITCAST SELFTEST', info.bitcast_selftest_status, bitcast_color, label_width, line_slots)
	local precheck_color
	if info.precheck_status == 'OK' then
		precheck_color = color_ok
	elseif info.precheck_status == 'FAILED' then
		precheck_color = color_warn
	else
		precheck_color = color_muted
	end
	append_kv_wrapped(lines, 'PROGRAM PRECHECK', info.precheck_status, precheck_color, label_width, line_slots)
	if not info.precheck_done then
		local phase_label<const> = tostring(info.precheck_phase_index) .. '/' .. tostring(info.precheck_phase_total) .. ' ' .. info.precheck_phase_label
		append_kv_wrapped(lines, 'PRECHECK PHASE', phase_label, color_muted, label_width, line_slots)
		local precheck_bar_width = line_slots - 2
		if precheck_bar_width < 1 then precheck_bar_width = 1 end
		append_wrapped_line(lines, build_progress_bar(info.precheck_progress, precheck_bar_width), color_muted, line_slots, '', '')
	end

	if cart_has_errors then
		append_blank_line(lines)
		for idx, entry in ipairs(info.cart_errors) do
			local text<const> = type(entry) == 'string' and entry or tostring(entry)
			local prefix<const> = '' -- (idx == 1) and '- ' or '  '
			local error_lines<const> = wrap_text_lines(text, line_slots, prefix, '  ')
			for i = 1, #error_lines do
				lines[#lines + 1] = { text = error_lines[i], color = color_warn }
			end
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
		local cart_ready<const> = cart_boot_ready()
		if not cart_ready and not boot_requested and system_slot_ready and not system_slot_failed then
			if not cart_start_failed_logged then
				cart_start_failed_logged = true
				print('[BootRom] Cart start failed: cart_boot_ready=0 while BIOS remained active.')
			end
			append_wrapped_line(lines, 'BOOT BLOCKED: CART START FAILED', color_warn, line_slots, '', '')
			append_wrapped_line(lines, 'CHECK HOST LOG / REBUILD BIOS + CART TOGETHER', color_muted, line_slots, '', '')
			return lines
		end
		local status<const> = cart_ready and 'CART LOADED' or (boot_requested and 'STARTING CART' or 'LOADING CART')
		local status_color<const> = cart_ready and color_ok or color_accent
		append_wrapped_line(lines, status, status_color, line_slots, '', '')
		local bar_width = line_slots - 3
		if bar_width < 1 then bar_width = 1 end
		local bar<const> = build_progress_bar(compute_boot_progress(info, cart_ready, elapsed), bar_width)
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
	system_slot_ready = false
	system_slot_failed = false
	clear_precheck_cache()
	bitcast_selftest_ok = false
	bitcast_selftest_status = 'NOT RUN'
	bitcast_selftest_error = nil
	bitcast_selftest_logged = false
	cart_start_failed_logged = false
	reset_scroll_state(boot_scroll_state)
	on_irq(irq_img_done, function()
		system_slot_ready = true
	end)
	on_irq(irq_img_error, function()
		system_slot_failed = true
	end)
	on_irq(irq_reinit, function()
		init()
	end)
	on_irq(irq_newgame, function()
		new_game()
	end)
	vdp_load_system_slot()
	selftest_bitcast_builtins()
end

function new_game()
end

local update_boot_screen<const> = function()
	boot_screen_visible = true
	mem[sys_inp_player] = 1
	mem[sys_inp_query] = &'down[rp]'
	local scroll_delta = mem[sys_inp_status] ~= 0 and 1 or 0
	if scroll_delta == 0 then
		mem[sys_inp_query] = &'up[rp]'
		if mem[sys_inp_status] ~= 0 then
			scroll_delta = -1
		end
	end
	render_boot_screen(scroll_delta)
	if not boot_screen_presented then
		boot_screen_presented = true
	end
	local cart_header<const> = read_cart_header(cart_rom_base)
	local cart_manifest_raw<const> = cart_manifest
	local cart_root_path<const> = cart_project_root_path
	local cart_manifest_value<const> = cart_header and flatten_manifest(cart_manifest_raw, cart_root_path)
	ensure_program_link_precheck(cart_header)
	local cart_errors<const> = collect_cart_precheck_errors(cart_header, cart_manifest_value)
	local cart_has_errors<const> = cart_header and #cart_errors > 0
	local _<const>, _<const>, precheck_done<const> = get_program_precheck_status(cart_header)

	if not cart_has_errors then
		local cart_valid<const> = cart_header
			and #cart_errors == 0
			and bitcast_selftest_ok
			and precheck_done
		local cart_present_and_ready<const> = mem[cart_rom_base] == cart_rom_magic
			and cart_boot_ready()
			and cart_valid

		if cart_present_and_ready and not boot_requested and system_slot_ready and not system_slot_failed then
			boot_requested = true
			print('Cart boot requested.')
			mem[sys_boot_cart] = 1
		end
	end
end

render_boot_screen = function(scroll_delta)
	local width<const> = display_width()
	local height<const> = display_height()
	local left<const> = 8
	local top<const> = content_top
	local font<const> = get_default_font()
	local font_id<const> = font.id

	do local c<const> = sys_palette_color(color_bg);memwrite(vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 4), sys_vdp_cmd_clear, 4, 0, c.r, c.g, c.b, c.a) end
	do local c<const> = sys_palette_color(color_header_bg);memwrite(vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 10), sys_vdp_cmd_fill_rect, 10, 0, 0, 0, width, 24, 0, sys_vdp_layer_world, c.r, c.g, c.b, c.a) end
	local info<const> = build_info()
	local cart_present<const> = mem[cart_rom_base] == cart_rom_magic
	local elapsed<const> = os.clock() - boot_start
	local cursor<const> = ((elapsed * 2) % 2 == 0) and '█' or ' '
	local line_slots<const> = line_slots(width, left, font_width)
	local content_lines<const> = build_boot_content_lines(info, cart_present, cursor, elapsed, line_slots)
	local window_size<const> = window_size(display_height(), top, line_height, 1, 1)
	local scroll_top<const>, max_scroll<const>, visible_lines<const> = scroll_boot_lines(content_lines, window_size, scroll_delta)
	local y = top + 1
	local text_z<const> = 1

	for i = 1, #visible_lines do
		local line<const> = visible_lines[i]
		local text
		local line_color
		if type(line) == 'table' then
			text = line.text
			line_color = line.color
		else
			text = line
			line_color = color_text
		end
		if string.len(text) > 0 then
			local color<const> = sys_palette_color(line_color or color_text)
			memwrite(
				vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 17),
				sys_vdp_cmd_glyph_run,
				17,
				0,
				text,
				left,
				y,
				text_z,
				font_id,
				0,
				0x7fffffff,
				sys_vdp_layer_world,
				color.r,
				color.g,
				color.b,
				color.a,
				0,
				0,
				0,
				0,
				0
			)
		end
		y = y + line_height
	end

	if max_scroll > 0 then
		local first_line<const> = scroll_top + 1
		local last_line<const> = scroll_top + #visible_lines
	end
end

local service_irqs<const> = function()
	local flags<const> = mem[sys_irq_flags]
	if flags ~= 0 then
		irq(flags)
	end
	return flags
end

mem[sys_inp_ctrl] = inp_ctrl_arm
while true do
	local flags
	repeat
		halt_until_irq
		flags = service_irqs()
	until (flags & irq_vblank) ~= 0
	mem[sys_inp_player] = 1
	vdp_stream_cursor = sys_vdp_stream_base
	update_boot_screen()
	do local used_bytes<const> = vdp_stream_cursor - sys_vdp_stream_base
		if used_bytes ~= 0 then
			mem[sys_dma_src] = sys_vdp_stream_base
			mem[sys_dma_dst] = sys_vdp_fifo
			mem[sys_dma_len] = used_bytes
			mem[sys_dma_ctrl] = dma_ctrl_start
		end
	end
	mem[sys_inp_ctrl] = inp_ctrl_arm
end
