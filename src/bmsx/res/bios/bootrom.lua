-- bootrom.lua
-- bmsx system boot screen

require('bios/msx_colors')
local clamp_int<const> = require('bios/util/clamp_int')
local wrap_text_lines<const> = require('bios/util/wrap_text_lines')
local vdp_stream<const> = require('bios/vdp_stream')
local vdp_image<const> = require('bios/vdp_image')
local font_module<const> = require('bios/font')

local reset_scroll_state<const> = function(state) state.top = 0 end

local draw_glyph_line_color<const> = function(font, line, x, y, z, layer, color)
	local cursor_x = x
	font_module.for_each_glyph(font, line, function(glyph)
		vdp_image.write_glyph_color(glyph, cursor_x, y, z, layer, color)
		cursor_x = cursor_x + glyph.advance
	end)
end
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

local color_bg<const> = msx_color_dark_blue
local color_header_bg<const> = msx_color_cyan
local color_text<const> = msx_color_white
local color_accent<const> = msx_color_white
local color_section<const> = msx_color_black
local color_warn<const> = msx_color_light_red
local color_ok<const> = msx_color_white
local color_info_total<const> = msx_color_white

local boot_status_labels<const> = { 'STATUS', 'BOOT STATUS' }

local system_rom_base<const> = 0x00000000
local cart_rom_base<const> = 0x01000000
local cart_program_start_addr<const> = 0x10080000
local cart_program_vector_addr<const> = cart_program_start_addr - 4
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
	return {
		header_size = header_size,
		manifest_off = mem[base + 8],
		manifest_len = mem[base + 12],
		toc_off = mem[base + 16],
		toc_len = mem[base + 20],
		data_off = mem[base + 24],
		data_len = mem[base + 28],
	}
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
	local cart_entry_ready<const> = mem[cart_program_vector_addr] == cart_program_start_addr

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
		cart_entry_ready = cart_entry_ready,
		root = cart_root_path and cart_root_path or '--',
		hw_cart_max = format_bytes(sys_cart_rom_size),
		hw_ram_total = format_bytes(sys_ram_size),
		hw_vram_total = format_bytes(vram_total),
		hw_max_cycles = format_bignumbers(sys_max_cycles_per_frame),
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
	local stage_count<const> = 3
	local stage_done = 0
	if boot_screen_visible then
		stage_done = stage_done + 1
	end
	if system_slot_ready and not system_slot_failed then
		stage_done = stage_done + 1
	end
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

	if cart_present then
		local cart_ready<const> = info.cart_entry_ready
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

	local cart_present_and_ready<const> = cart_header
		and mem[cart_rom_base] == cart_rom_magic
		and mem[cart_program_vector_addr] == cart_program_start_addr

	if cart_present_and_ready and not boot_requested and system_slot_ready and not system_slot_failed then
		boot_requested = true
		print('Cart boot requested.')
		mem[sys_boot_cart] = 1
	end
end

render_boot_screen = function(scroll_delta)
	local width<const> = machine_manifest.render_size.width
	local height<const> = machine_manifest.render_size.height
	local left<const> = 8
	local top<const> = content_top
	local font<const> = font_module.get('default')

	vdp_stream.clear_color(color_bg)
	vdp_stream.fill_rect_color(0, 0, width, 24, 0, sys_vdp_layer_world, color_header_bg)
	local info<const> = build_info()
	local cart_present<const> = mem[cart_rom_base] == cart_rom_magic
	local elapsed<const> = os.clock() - boot_start
	local cursor<const> = ((elapsed * 2) % 2 == 0) and '█' or ' '
	local line_slots<const> = line_slots(width, left, font_width)
	local content_lines<const> = build_boot_content_lines(info, cart_present, cursor, elapsed, line_slots)
	local window_size<const> = window_size(machine_manifest.render_size.height, top, line_height, 1, 1)
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
			local color<const> = line_color or color_text
			draw_glyph_line_color(font, text, left, y, text_z, sys_vdp_layer_world, color)
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
	vdp_stream.finish()
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
