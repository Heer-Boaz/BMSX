-- quickmenu.lua
-- system quick menu (select+start)

local menu = {}

local colors = {
	panel = 1,
	text = 15,
	text_dim = 14,
	title = 11,
	highlight = 5,
}

local state = {
	open = false,
	selected = 1,
	audio_paused = false,
}

local function toggle_menu()
	state.open = not state.open
	if state.open then
		state.selected = 1
		if not state.audio_paused then
			pause_audio()
			state.audio_paused = true
		end
	else
		if state.audio_paused then
			resume_audio()
			state.audio_paused = false
		end
	end
end

local function make_toggle(label, key)
	return {
		kind = "toggle",
		label = label,
		get = function()
			return $.view[key]
		end,
		set = function(value)
			$.view[key] = value
		end,
	}
end

local function make_enum(label, key, values)
	return {
		kind = "enum",
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

local function make_vdp_enum(label, register, values)
	return {
		kind = "enum",
		label = label,
		get = function()
			return peek(register)
		end,
		set = function(value)
			poke(register, value)
		end,
		values = values,
	}
end

local function make_action(label, action)
	return {
		kind = "action",
		label = label,
		action = action,
	}
end

local entries = {
	make_toggle("CRT POST", "crt_postprocessing_enabled"),
	make_toggle("NOISE", "enable_noise"),
	make_toggle("COLOR BLEED", "enable_colorbleed"),
	make_toggle("SCANLINES", "enable_scanlines"),
	make_toggle("BLUR", "enable_blur"),
	make_toggle("GLOW", "enable_glow"),
	make_toggle("FRINGING", "enable_fringing"),
	make_toggle("APERTURE", "enable_aperture"),
	make_vdp_enum("DITHER", SYS_VDP_DITHER, {
		{ value = 0, label = "OFF" },
		{ value = 1, label = "PSX" },
		{ value = 2, label = "RGB565" },
		{ value = 3, label = "MSX10" },
	}),
	make_action("REBOOT", reboot),
}

local function entry_value_label(entry)
	if entry.kind == "action" then
		return ""
	end
	if entry.kind == "toggle" then
		return entry.get() and "ON" or "OFF"
	end
	local value = entry.get()
	for i = 1, #entry.values do
		local v = entry.values[i]
		if v.value == value then
			return v.label
		end
	end
	error("quickmenu: enum value missing for " .. entry.label)
end

local function entry_value_index(entry)
	local value = entry.get()
	for i = 1, #entry.values do
		if entry.values[i].value == value then
			return i
		end
	end
	error("quickmenu: enum index missing for " .. entry.label)
end

local function entry_cycle(entry, dir)
	if entry.kind == "action" then
		if dir ~= 0 then
			entry.action()
		end
		return
	end
	if entry.kind == "toggle" then
		entry.set(not entry.get())
		return
	end
	local idx = entry_value_index(entry)
	idx = idx + dir
	if idx < 1 then idx = #entry.values end
	if idx > #entry.values then idx = 1 end
	entry.set(entry.values[idx].value)
end

function menu.update(_dt)
	if action_triggered('&wp{5}(select, start)', 1) then
		$.consume_action(1, 'select')
		$.consume_action(1, 'start')
		toggle_menu()
	end
	if not state.open then
		return
	end

	if action_triggered('b[jp]', 1) then
		toggle_menu()
		$.consume_action(1, 'b')
	end

	if action_triggered('up[jp]', 1) then
		state.selected = state.selected - 1
		if state.selected < 1 then state.selected = #entries end
		$.consume_action(1, 'up')
	end
	if action_triggered('down[jp]', 1) then
		state.selected = state.selected + 1
		if state.selected > #entries then state.selected = 1 end
		$.consume_action(1, 'down')
	end
	if action_triggered('left[jp]', 1) then
		entry_cycle(entries[state.selected], -1)
		$.consume_action(1, 'left')
	end
	if action_triggered('right[jp]', 1) then
		entry_cycle(entries[state.selected], 1)
		$.consume_action(1, 'right')
	end
	if action_triggered('a[jp]', 1) then
		entry_cycle(entries[state.selected], 1)
		$.consume_action(1, 'a')
	end
end

function menu.draw()
	if not state.open then
		return
	end
	local w = display_width()
	local h = display_height()
	local title = "BMSX OPTIONS"
	local font_w = 6
	local font_h = 8
	local scale = 2
	local padding = 8
	local line_h = (font_h * scale) + 4
	local title_h = line_h
	local title_gap = 6
	local lines = #entries > 0 and #entries or 1
	local max_chars = #title
	-- if #footer > max_chars then max_chars = #footer end
	for i = 1, #entries do
		local entry = entries[i]
		local value = entry_value_label(entry)
		local line = entry.label
		if value ~= "-" and value ~= "" then
			line = line .. ": " .. value
		end
		if #line > max_chars then max_chars = #line end
	end
	local box_lines = lines + 1
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
	local box_y = title_h + title_gap
	local x = math.floor((w - menu_w) / 2)
	local y = math.floor((h - box_h) / 2) - box_y
	if x < 0 then x = 0 end
	if y < 0 then y = 0 end
	local z = 10000

	put_rectfillcolor(x, y + box_y, x + menu_w, y + box_y + box_h, z, colors.panel, { layer = 'ui' })
	write(title, x + padding, y, z, colors.title, { layer = 'ui' })

	local row_y = y + box_y + padding
	for i = 1, #entries do
		local entry = entries[i]
		if i == state.selected then
			put_rectfillcolor(x, row_y - 2, x + menu_w, row_y + line_h, z, colors.highlight, { layer = 'ui' })
		end
		local value = entry_value_label(entry)
		local line = entry.label
		if value ~= "-" and value ~= "" then
			line = line .. ": " .. value
		end
		write(line, x + padding, row_y, z, colors.text, { layer = 'ui' })
		row_y = row_y + line_h
	end

end

function menu.is_open()
	return state.open
end

return menu
