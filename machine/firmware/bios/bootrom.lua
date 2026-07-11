-- bootrom.lua
-- bmsx system boot screen

require('system/msx_colors')
require('bios/base')
require('bios/os')
require('bios/table')
require('bios/string')
math = require('bios/math')
easing = require('bios/easing')
local clamp<const> = require('bios/util/clamp')
local wrap_text_lines<const> = require('bios/util/wrap_text_lines').wrap_text_lines
local gx_gpu<const> = require('system/gx_gpu')
local gx_image<const> = require('system/gx_image')
local font_module<const> = require('system/font')
local system<const> = require('bios/system')

function irq(flags)
	system.irq(flags)
end

local reset_scroll_state<const> = function(state) state.top = 0 end

local draw_glyph_line_color<const> = function(font, line, x, y, color)
	local cursor_x = x
	font_module.for_each_glyph(font, line, function(glyph)
		gx_image.blit_img_color(glyph.imgid, cursor_x, y, color)
		cursor_x = cursor_x + glyph.advance
	end)
end
local scroll_window<const> = function(lines, top, window_size)
	local visible_lines<const> = {}
	local max_scroll<const> = math.max(0, #lines - window_size)
	local clamped_top<const> = clamp(top, 0, max_scroll)
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
local irq_vblank<const> = 0x0010
local irq_mask_addr<const> = 0x0800010c
bss boot_vblank_count: word
bss boot_start: f64
local boot_scroll_state<const> = { top = 0 }
bss boot_screen_visible: word
bss boot_screen_presented: word
local render_boot_screen

local cart_header_present<const> = function(base)
	if mem[base] ~= cart_rom_magic then
		return false
	end
	local header_size<const> = mem[base + 4]
	return header_size >= cart_rom_base_header_size
end

local scroll_boot_lines<const> = function(lines, window_size, delta)
	local line_count<const> = #lines
	if line_count ~= boot_scroll_state.last_line_count then
		boot_scroll_state.last_line_count = line_count
		boot_scroll_state.top = clamp(boot_scroll_state.top, 0, line_count - window_size)
	end
	boot_scroll_state.top = clamp(boot_scroll_state.top + delta, 0, line_count - window_size)
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

local build_info<const> = function(width, height)
	local cart_entry_ready<const> = mem[cart_program_vector_addr] == cart_program_start_addr
	local vram_total<const> = 0x0026d000

	return {
		cart_entry_ready = cart_entry_ready,
		hw_cart_max = format_bytes(0x05000000),
		hw_ram_total = format_bytes(0x00400000),
		hw_vram_total = format_bytes(vram_total),
		hw_screen = tostring(width) .. 'x' .. tostring(height),
		hw_max_cycles = format_bignumbers(mem[0x08010368]),
	}
end

local divider<const> = function(line_slots)
	return string.rep('-', line_slots)
end

local build_progress_bar<const> = function(progress, width)
	local clamped<const> = clamp(progress, 0, 1)
	local filled<const> = clamp((width * clamped + 0.5) // 1, 0, width)
	return '[' .. string.rep('#', filled) .. string.rep('-', width - filled) .. ']'
end

local compute_boot_progress<const> = function(info, cart_ready, elapsed)
	local stage_count<const> = 2
	local stage_done = 0
	if *boot_screen_visible ~= 0 then
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
		{ label = 'SCREEN', value = info.hw_screen, color = color_accent },
		{ label = 'TOTAL RAM', value = info.hw_ram_total, color = color_info_total },
		{ label = 'TOTAL VRAM', value = info.hw_vram_total, color = color_info_total },
		-- { label = 'MAX CYCLES/FRAME', value = info.hw_max_cycles, color = color_accent },
	}
	local cart_specs<const> = {
		{ label = 'ROM HEADER', value = cart_present and 'FOUND' or 'MISSING', color = cart_present and color_ok or color_warn },
		{ label = 'ENTRY', value = info.cart_entry_ready and 'READY' or 'WAITING', color = info.cart_entry_ready and color_ok or color_accent },
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
		append_kv_wrapped(lines, spec.label, spec.value, spec.color, label_width, line_slots)
	end

	append_blank_line(lines)
	append_section(lines, 'BOOT STATUS', line_slots)

	if cart_present then
		local cart_ready<const> = info.cart_entry_ready
		local status<const> = cart_ready and 'CART LOADED' or 'LOADING CART'
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
	*boot_start = os.clock()
	*boot_screen_visible = 1
	*boot_screen_presented = 0
	gx_gpu.reset_320x240_pal()
	gx_gpu.clear_color(color_bg)
	reset_scroll_state(boot_scroll_state)
	system.on_irq(irq_vblank, function()
		*boot_vblank_count = *boot_vblank_count + 1
	end)
	gx_image.upload_atlas(254)
end

function new_game()
end

-- USB HID usages (page 0x07): the ICU keyboard bitmap is indexed by these.
local key_arrow_down<const> = 81
local key_arrow_up<const> = 82
local boot_repeat_initial_delay_frames<const> = 15
local boot_repeat_interval_frames<const> = 4
bss boot_input_frame: word
bss prev_arrow_down: word
bss prev_arrow_up: word
bss down_next_repeat_frame: word
bss up_next_repeat_frame: word

local key_pressed<const> = function(usage)
	local word<const> = mem[0x0800019c + ((usage >> 5) << 2)]
	return ((word >> (usage & 31)) & 1) ~= 0
end

local update_boot_screen<const> = function()
	*boot_screen_visible = 1
	*boot_input_frame = *boot_input_frame + 1
	local arrow_down<const> = key_pressed(key_arrow_down)
	local arrow_up<const> = key_pressed(key_arrow_up)
	local scroll_delta = 0
	local down_repeat = false
	if arrow_down then
		if *prev_arrow_down == 0 then
			down_repeat = true
			*down_next_repeat_frame = *boot_input_frame + boot_repeat_initial_delay_frames
		elseif *boot_input_frame >= *down_next_repeat_frame then
			down_repeat = true
			*down_next_repeat_frame = *down_next_repeat_frame + boot_repeat_interval_frames
		end
	end
	local up_repeat = false
	if arrow_up then
		if *prev_arrow_up == 0 then
			up_repeat = true
			*up_next_repeat_frame = *boot_input_frame + boot_repeat_initial_delay_frames
		elseif *boot_input_frame >= *up_next_repeat_frame then
			up_repeat = true
			*up_next_repeat_frame = *up_next_repeat_frame + boot_repeat_interval_frames
		end
	end
	if down_repeat then
		scroll_delta = 1
	elseif up_repeat then
		scroll_delta = -1
	end
	*prev_arrow_down = arrow_down and 1 or 0
	*prev_arrow_up = arrow_up and 1 or 0
	local cart_present_and_ready<const> = cart_header_present(cart_rom_base)
		and mem[cart_program_vector_addr] == cart_program_start_addr

	if cart_present_and_ready then
		print('Cart boot requested.')
		mem[irq_mask_addr] = 0
		return true
	end
	render_boot_screen(scroll_delta)
	if *boot_screen_presented == 0 then
		*boot_screen_presented = 1
	end
	return false
end

render_boot_screen = function(scroll_delta)
	local width<const>, height<const> = gx_gpu.display_size()
	local left<const> = 8
	local top<const> = content_top
	local font<const> = font_module.get('default')

	gx_gpu.clear_color(color_bg)
	gx_gpu.fill_rect_color(0, 0, width, 24, color_header_bg)
	local info<const> = build_info(width, height)
	local cart_present<const> = cart_header_present(cart_rom_base)
	local elapsed<const> = os.clock() - *boot_start
	local cursor<const> = ((elapsed * 2) % 2 == 0) and '█' or ' '
	local line_slots<const> = line_slots(width, left, font_width)
	local content_lines<const> = build_boot_content_lines(info, cart_present, cursor, elapsed, line_slots)
	local window_size<const> = window_size(height, top, line_height, 1, 1)
	local scroll_top<const>, max_scroll<const>, visible_lines<const> = scroll_boot_lines(content_lines, window_size, scroll_delta)
	local y = top + 1
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
			draw_glyph_line_color(font, text, left, y, color)
		end
		y = y + line_height
	end

	if max_scroll > 0 then
		local first_line<const> = scroll_top + 1
		local last_line<const> = scroll_top + #visible_lines
	end
end

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until *boot_vblank_count ~= 0
	*boot_vblank_count = *boot_vblank_count - 1
end

init()
mem[irq_mask_addr] = irq_vblank
new_game()
mem[0x08000194] = 0x00000001
while true do
	wait_vblank()
	local boot_complete<const> = update_boot_screen()
	if boot_complete then
		return
	end
	mem[0x08000194] = 0x00000001
end
