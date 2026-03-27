local scratchrecordbatch = require('scratchrecordbatch')
local clamp_int = require('clamp_int')

local gizmo = {}
local ui_options = scratchrecordbatch.new(1):get(1)

local colors = {
	panel = 1,
	text = 15,
	text_dim = 14,
	ok = 12,
	warn = 10,
	danger = 8,
}

local function usage_color(ratio)
	if ratio >= 0.9 then return colors.danger end
	if ratio >= 0.7 then return colors.warn end
	return colors.ok
end

local function usage_percent(used, total)
	return math.floor(((used * 100) / total) + 0.5)
end

local function draw_usage_bar(label, used, total, x, y, z)
	local label_w = 28
	local bar_w = 54
	local bar_h = 5
	local bar_x = x + label_w
	local ratio = clamp_int(used / total, 0, 1)
	local fill_w = math.floor(bar_w * ratio)
	local pct = usage_percent(used, total)

	write(label, x, y - 1, z + 2, colors.text, ui_options)
	put_rectfillcolor(bar_x, y + 1, bar_x + bar_w, y + 1 + bar_h, z, colors.text_dim, ui_options)
	if fill_w > 0 then
		put_rectfillcolor(bar_x, y + 1, bar_x + fill_w, y + 1 + bar_h, z + 1, usage_color(ratio), ui_options)
	end
	write(pct .. '%', bar_x + bar_w + 4, y - 1, z + 2, colors.text, ui_options)
end

function gizmo.draw()
	if not $.view.show_resource_usage_gizmo then
		return
	end

	local x = 8
	local y = 8
	local z = 9000
	local panel_w = 112
	local panel_h = 32
	local row_h = 10

	ui_options.layer = 'ide'
	put_rectfillcolor(x - 4, y - 4, x - 4 + panel_w, y - 4 + panel_h, z, colors.panel, ui_options)
	draw_usage_bar('CPU', sys_cpu_active_cycles_used(), sys_cpu_active_cycles_granted(), x, y, z + 1)
	draw_usage_bar('RAM', sys_ram_used(), sys_ram_size, x, y + row_h, z + 1)
	draw_usage_bar('VRAM', sys_vram_used(), sys_vram_size, x, y + (row_h * 2), z + 1)
end

return gizmo
