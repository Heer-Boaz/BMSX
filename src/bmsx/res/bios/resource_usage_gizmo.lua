require('bios/msx_colors')
local scratchrecordbatch<const> = require('bios/util/scratchrecordbatch')
local vdp_stream<const> = require('bios/vdp_stream')
local vdp_image<const> = require('bios/vdp_image')
local font_module<const> = require('bios/font')

local gizmo<const> = {}
local label_w<const> = 28
local bar_w<const> = 54
local bar_h<const> = 5
local x<const> = 8
local bar_x<const> = x + label_w
local y<const> = 8
local z<const> = 9000
local panel_w<const> = 112
local panel_h<const> = 42
local row_h<const> = 10
local font<const> = get_default_font()

local colors<const> = {
	panel = msx_color_black,
	text = msx_color_white,
	text_dim = msx_color_grey,
	ok = msx_color_dark_green,
	warn = msx_color_dark_yellow,
	danger = msx_color_medium_red,
}

local draw_glyph_line_color<const> = function(font, line, x, y, z, layer, color)
	local cursor_x = x
	font_module.for_each_glyph(font, line, function(glyph)
		vdp_image.write_glyph_color(glyph, cursor_x, y, z, layer, color)
		cursor_x = cursor_x + glyph.advance
	end)
end

local usage_color<const> = function(ratio)
	if ratio >= 0.9 then return colors.danger end
	if ratio >= 0.7 then return colors.warn end
	return colors.ok
end

local usage_percent<const> = function(used, total)
	return (((used * 100) / total) + 0.5) // 1
end

local draw_usage_bar<const> = function(label, used, total, x, y, z, font, fill_color_override)
	local ratio<const> = clamp_int(used / total, 0, 1)
	local fill_w<const> = (bar_w * ratio) // 1
	local pct<const> = usage_percent(used, total)
	local text_y<const> = y + 1
	local text_z<const> = z + 2
	local label_color<const> = colors.text_dim
	local pct_color<const> = colors.text
	local fill_color = usage_color(used / total)
	if fill_color_override then
		fill_color = fill_color_override
	end
	local label_len<const> = #label
	local pct_text<const> = tostring(pct) .. '%'
	local pct_len<const> = #pct_text

	vdp_stream.fill_rect_color(bar_x, y + 1, bar_x + bar_w, y + 1 + bar_h, z, sys_vdp_layer_ide, label_color)
	if fill_w > 0 then
		vdp_stream.fill_rect_color(bar_x, y + 1, bar_x + fill_w, y + 1 + bar_h, z + 1, sys_vdp_layer_ide, fill_color)
	end

	if label_len > 0 then
		draw_glyph_line_color(font, label, x, text_y, text_z, sys_vdp_layer_ide, label_color)
	end

	if pct_len > 0 then
		draw_glyph_line_color(font, pct_text, bar_x + bar_w + 1, text_y, text_z, sys_vdp_layer_ide, pct_color)
	end
end

function gizmo.draw()
	if not $.view.show_resource_usage_gizmo then
		return
	end

	local vdp_work_last<const> = sys_vdp_work_units_last()
	local vdp_budget<const> = math.max(1, (((sys_vdp_work_units_per_sec() * 1000000) / machine_manifest.ufps) + 0.5) // 1)
	local vdp_held<const> = sys_vdp_frame_held() ~= 0
	local vdp_fill_color

	vdp_stream.fill_rect_color(x - 4, y - 4, x - 4 + panel_w, y - 4 + panel_h, z, sys_vdp_layer_ide, colors.panel)
	draw_usage_bar('CPU', sys_cpu_cycles_used(), sys_cpu_cycles_granted(), x, y, z + 1, font)
	draw_usage_bar('RAM', sys_ram_used(), sys_ram_size, x, y + row_h, z + 1, font)
	draw_usage_bar('VRAM', sys_vram_used(), sys_vram_size, x, y + (row_h * 2), z + 1, font)
	if vdp_held then
		vdp_fill_color = colors.danger
	end
	draw_usage_bar('VDP', vdp_work_last, vdp_budget, x, y + (row_h * 3), z + 1, font, vdp_fill_color)
end

return gizmo
