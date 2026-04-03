local scratchrecordbatch<const> = require('scratchrecordbatch')

local gizmo<const> = {}

local colors<const> = {
	panel = sys_palette_color(1),
	text = sys_palette_color(15),
	text_dim = sys_palette_color(14),
	ok = sys_palette_color(12),
	warn = sys_palette_color(10),
	danger = sys_palette_color(8),
}

local usage_color<const> = function(ratio)
	if ratio >= 0.9 then return colors.danger end
	if ratio >= 0.7 then return colors.warn end
	return colors.ok
end

local usage_percent<const> = function(used, total)
	return math.floor(((used * 100) / total) + 0.5)
end

local draw_usage_bar<const> = function(label, used, total, x, y, z, font_id, fill_color_override)
	local label_w<const> = 28
	local bar_w<const> = 54
	local bar_h<const> = 5
	local bar_x<const> = x + label_w
	local ratio<const> = clamp_int(used / total, 0, 1)
	local fill_w<const> = math.floor(bar_w * ratio)
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

	memwrite(vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 10), sys_vdp_cmd_fill_rect, 10, 0, bar_x, y + 1, bar_x + bar_w, y + 1 + bar_h, z, sys_vdp_layer_ide, label_color.r, label_color.g, label_color.b, label_color.a)
	if fill_w > 0 then
		memwrite(vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 10), sys_vdp_cmd_fill_rect, 10, 0, bar_x, y + 1, bar_x + fill_w, y + 1 + bar_h, z + 1, sys_vdp_layer_ide, fill_color.r, fill_color.g, fill_color.b, fill_color.a)
	end

	if label_len > 0 then
		memwrite(vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 17), sys_vdp_cmd_glyph_run, 17, 0, label, x, text_y, text_z, font_id, 0, 2147483647, sys_vdp_layer_ide, label_color.r, label_color.g, label_color.b, label_color.a, 0, 0, 0, 0, 0)
	end

	if pct_len > 0 then
		-- print(pct_text)
		memwrite(vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 17), sys_vdp_cmd_glyph_run, 17, 0, pct_text, bar_x + bar_w + 1, text_y, text_z, font_id, 0, 2147483647, sys_vdp_layer_ide, pct_color.r, pct_color.g, pct_color.b, pct_color.a, 0, 0, 0, 0, 0)
	end
end

function gizmo.draw()
	if not $.view.show_resource_usage_gizmo then
		return
	end

	local x<const> = 8
	local y<const> = 8
	local z<const> = 9000
	local panel_w<const> = 112
	local panel_h<const> = 42
	local row_h<const> = 10
	local font_id<const> = get_default_font().id
	local vdp_work_last<const> = sys_vdp_work_units_last()
	local vdp_budget<const> = math.max(1, math.floor(((sys_vdp_work_units_per_sec() * 1000000) / machine_manifest.ufps) + 0.5))
	local vdp_held<const> = sys_vdp_frame_held() ~= 0
	local vdp_fill_color

	memwrite(
		vdp_stream_claim_words(sys_vdp_stream_packet_header_words + 10),
		sys_vdp_cmd_fill_rect,
		10,
		0,
		x - 4,
		y - 4,
		x - 4 + panel_w,
		y - 4 + panel_h,
		z,
		sys_vdp_layer_ide,
		colors.panel.r,
		colors.panel.g,
		colors.panel.b,
		colors.panel.a
	)
	draw_usage_bar('CPU', sys_cpu_cycles_used(), sys_cpu_cycles_granted(), x, y, z + 1, font_id)
	draw_usage_bar('RAM', sys_ram_used(), sys_ram_size, x, y + row_h, z + 1, font_id)
	draw_usage_bar('VRAM', sys_vram_used(), sys_vram_size, x, y + (row_h * 2), z + 1, font_id)
	if vdp_held then
		vdp_fill_color = colors.danger
	end
	draw_usage_bar('VDP', vdp_work_last, vdp_budget, x, y + (row_h * 3), z + 1, font_id, vdp_fill_color)
end

return gizmo
