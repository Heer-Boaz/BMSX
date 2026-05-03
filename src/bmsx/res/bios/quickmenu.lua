-- quickmenu.lua
-- system quick menu (select+start)

local scratchrecordbatch<const> = require('bios/util/scratchrecordbatch')
local vdp_stream<const> = require('bios/vdp_stream')
local vdp_image<const> = require('bios/vdp_image')

local colors<const> = {
	panel = sys_palette_color(1),
	text = sys_palette_color(15),
	text_dim = sys_palette_color(14),
	title = sys_palette_color(11),
	highlight = sys_palette_color(5),
}

local state<const> = {
	open = false,
	selected = 1,
}

local menu<const> = {}

local toggle_menu<const> = function()
	state.open = not state.open
	if state.open then
		state.selected = 1
	end
end

local make_toggle<const> = function(label, key)
	return {
		kind = 'toggle',
		label = label,
		get = function()
			return $.view[key]
		end,
		set = function(value)
			$.view[key] = value
		end,
	}
end

local make_enum<const> = function(label, key, values)
	return {
		kind = 'enum',
		label = label,
		get = function()
			return $.view[key]
		end,
		set = function(value)
			$.view[key] = value
		end,
		values = values,
	}
end

local make_vdp_enum<const> = function(label, register, values)
	return {
		kind = 'enum',
		label = label,
		get = function()
			return mem[register]
		end,
		set = function(value)
			mem[register] = value
		end,
		values = values,
	}
end

local make_action<const> = function(label, action)
	return {
		kind = 'action',
		label = label,
		action = action,
	}
end

local entries<const> = {
	make_toggle('SHOW STATS', 'show_resource_usage_gizmo'),
	make_toggle('CRT POST', 'crt_postprocessing_enabled'),
	make_toggle('  NOISE', 'enable_noise'),
	make_toggle('  COLOR BLEED', 'enable_colorbleed'),
	make_toggle('  SCANLINES', 'enable_scanlines'),
	make_toggle('  BLUR', 'enable_blur'),
	make_toggle('  GLOW', 'enable_glow'),
	make_toggle('  FRINGING', 'enable_fringing'),
	make_toggle('  APERTURE', 'enable_aperture'),
	make_vdp_enum('DITHER', sys_vdp_dither, {
		{ value = 0, label = 'OFF' },
		{ value = 1, label = 'PSX' },
		{ value = 2, label = 'RGB777 OUT' },
		{ value = 3, label = 'MSX10' },
	}),
	make_action('REBOOT', reboot),
}

local entry_value_label<const> = function(entry)
	if entry.kind == 'action' then
		return nil
	end
	if entry.kind == 'toggle' then
		return entry.get() and 'ON' or 'OFF'
	end
	local value<const> = entry.get()
	for i = 1, #entry.values do
		local v<const> = entry.values[i]
		if v.value == value then
			return v.label
		end
	end
	error('quickmenu: enum value missing for ' .. entry.label)
end

local entry_value_index<const> = function(entry)
	local value<const> = entry.get()
	for i = 1, #entry.values do
		if entry.values[i].value == value then
			return i
		end
	end
	error('quickmenu: enum index missing for ' .. entry.label)
end

local entry_cycle<const> = function(entry, dir)
	if entry.kind == 'action' then
		return
	end
	if entry.kind == 'toggle' then
		entry.set(not entry.get())
		return
	end
	local idx = entry_value_index(entry)
	idx = idx + dir
	if idx < 1 then idx = #entry.values end
	if idx > #entry.values then idx = 1 end
	entry.set(entry.values[idx].value)
end

function menu.update()
	local previous_inp_player<const> = mem[sys_inp_player]
	mem[sys_inp_player] = 1
	mem[sys_inp_query] = &'select[jp] && start[jp]'
	if mem[sys_inp_status] ~= 0 then
		mem[sys_inp_consume] = &'select,start'
		toggle_menu()
	end
	if not state.open then
		mem[sys_inp_player] = previous_inp_player
		return
	end

	mem[sys_inp_query] = &'b[jp]'
	if mem[sys_inp_status] ~= 0 then
		mem[sys_inp_consume] = &'b'
		toggle_menu()
	end

	mem[sys_inp_query] = &'up[rp] || up[jp]'
	if mem[sys_inp_status] ~= 0 then
		state.selected = state.selected - 1
		if state.selected < 1 then state.selected = #entries end
		if state.selected < 1 then state.selected = 1 end
	end
	mem[sys_inp_query] = &'down[rp] || down[jp]'
	if mem[sys_inp_status] ~= 0 then
		state.selected = state.selected + 1
		if state.selected > #entries then state.selected = 1 end
		if state.selected > #entries then state.selected = #entries end
	end
	mem[sys_inp_query] = &'left[jp]'
	if mem[sys_inp_status] ~= 0 then
		entry_cycle(entries[state.selected], -1)
	end
	mem[sys_inp_query] = &'right[jp]'
	if mem[sys_inp_status] ~= 0 then
		entry_cycle(entries[state.selected], 1)
	end
	mem[sys_inp_query] = &'a[jp]'
	if mem[sys_inp_status] ~= 0 then
		mem[sys_inp_consume] = &'a'
		if entries[state.selected].kind == 'action' then
			entries[state.selected].action()
		end	
	end
	mem[sys_inp_player] = previous_inp_player
end

function menu.draw()
	if not state.open then
		return
	end
	local w<const> = display_width()
	local h<const> = display_height()
	local title<const> = 'BMSX OPTIONS'
	local font_w<const> = 6
	local font_h<const> = 8
	local scale = 2
	local padding<const> = 8
	local line_h = (font_h * scale) + 4
	local title_h = line_h
	local title_gap = 6
	local lines<const> = #entries > 0 and #entries or 1
	local max_chars = string.len(title)
	-- if #footer > max_chars then max_chars = #footer end
	for i = 1, #entries do
		local entry<const> = entries[i]
		local value<const> = entry_value_label(entry)
		local line = entry.label
		if value ~= nil then
			line = line .. ': ' .. value
		end
		local line_len<const> = string.len(line)
		if line_len > max_chars then max_chars = line_len end
	end
	local box_lines<const> = lines + 1
	local box_w = (max_chars * font_w * scale) + (padding * 2)
	local box_h = (box_lines * line_h) + (padding * 2)
	local menu_w = box_w
	local menu_h = title_h + title_gap + box_h
	if menu_w > w - 20 or menu_h > h - 20 then
		scale = 1
		line_h = (font_h * scale) + 3
		title_h = line_h
		title_gap = 4
		box_w = (max_chars * font_w * scale) + (padding * 2)
		box_h = (box_lines * line_h) + (padding * 2)
		menu_w = box_w
		menu_h = title_h + title_gap + box_h
	end
	if menu_w > w - 10 then menu_w = w - 10 end
	if menu_h > h - 10 then menu_h = h - 10 end
	local box_y<const> = title_h + title_gap
	local x = (w - menu_w) // 2
	local y = ((h - box_h) // 2) - box_y
	if x < 0 then x = 0 end
	if y < 0 then y = 0 end
	local z<const> = 10000
	vdp_stream.fill_rect_rgba(x, y + box_y, x + menu_w, y + box_y + box_h, z, sys_vdp_layer_ui, colors.panel.r, colors.panel.g, colors.panel.b, colors.panel.a)
	local font<const> = get_default_font()
	local text_z<const> = z + 1
	local title_len<const> = string.len(title)
	local title_x<const> = x + ((menu_w - (title_len * font_w)) // 2)
	local title_y<const> = y + ((title_h - font_h) // 2)
	if title_len > 0 then
		vdp_image.write_glyph_line_rgba(font, title, title_x, title_y, text_z, sys_vdp_layer_ui, colors.title.r, colors.title.g, colors.title.b, colors.title.a, 0, 0, 0, 0, 0)
	end

	local row_y = y + box_y + padding
	for i = 1, #entries do
		local entry<const> = entries[i]
		if i == state.selected then
			vdp_stream.fill_rect_rgba(x, row_y - 2, x + menu_w, row_y + line_h, z, sys_vdp_layer_ui, colors.highlight.r, colors.highlight.g, colors.highlight.b, colors.highlight.a)
		end
		local value<const> = entry_value_label(entry)
		local line = entry.label
		if value ~= nil then
			line = line .. ': ' .. value
		end
		local text_color<const> = i == state.selected and colors.text or colors.text_dim
		local text_x<const> = x + padding
		local text_y<const> = row_y + ((line_h - font_h) // 2)
		local line_len<const> = string.len(line)
		if line_len > 0 then
			vdp_image.write_glyph_line_rgba(font, line, text_x, text_y, text_z, sys_vdp_layer_ui, text_color.r, text_color.g, text_color.b, text_color.a, 0, 0, 0, 0, 0)
		end
		row_y = row_y + line_h
	end

end

function menu.is_open()
	return state.open
end

return menu
