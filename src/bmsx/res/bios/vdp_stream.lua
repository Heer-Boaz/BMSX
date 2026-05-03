local vdp_stream<const> = {}

local vdp_pkt_end<const> = 0x00000000
local vdp_pkt_cmd<const> = 0x01000000
local vdp_pkt_reg1<const> = 0x02000000
local vdp_pkt_regn<const> = 0x03000000

local vdp_cmd_clear<const> = 1
local vdp_cmd_fill_rect<const> = 2
local vdp_cmd_draw_line<const> = 3
local vdp_cmd_blit<const> = 4

local vdp_reg_src_slot<const> = 0
local vdp_reg_dst_x<const> = 3
local vdp_reg_geom_x0<const> = 5
local vdp_reg_line_width<const> = 9
local vdp_reg_draw_layer_prio<const> = 10
local vdp_reg_draw_ctrl<const> = 11
local vdp_reg_draw_color<const> = 14
local vdp_reg_bg_color<const> = 15

local q16_scale<const> = 0x00010000
local q8_scale<const> = 0x00000100

local trunc<const> = function(value)
	if value < 0 then
		return -((-value) // 1)
	end
	return value // 1
end

local q16<const> = function(value)
	return (trunc(value * q16_scale)) & 0xffffffff
end

local color_byte<const> = function(value)
	return ((value * 255 + 0.5) // 1) & 0xff
end

local color_word<const> = function(r, g, b, a)
	return (color_byte(a) << 24) | (color_byte(r) << 16) | (color_byte(g) << 8) | color_byte(b)
end

local layer_priority<const> = function(layer, z)
	return (layer & 0xff) | ((trunc(z) & 0xffff) << 8)
end

local draw_ctrl_word<const> = function(flip_flags, parallax_weight)
	return (flip_flags & 0xffff) | ((trunc(parallax_weight * q8_scale) & 0xffff) << 16)
end

local pack_low_high<const> = function(low, high)
	return (low & 0xffff) | ((high & 0xffff) << 16)
end

function vdp_stream.finish()
	if vdp_stream_cursor ~= sys_vdp_stream_base then
		mem[vdp_stream_claim_words(1)] = vdp_pkt_end
	end
end

function vdp_stream.clear_rgba(r, g, b, a)
	memwrite(
		vdp_stream_claim_words(3),
		vdp_pkt_reg1 | vdp_reg_bg_color,
		color_word(r, g, b, a),
		vdp_pkt_cmd | vdp_cmd_clear
	)
end

function vdp_stream.fill_rect_rgba(x0, y0, x1, y1, z, layer, r, g, b, a)
	memwrite(
		vdp_stream_claim_words(10),
		vdp_pkt_regn | (4 << 16) | vdp_reg_geom_x0,
		q16(x0),
		q16(y0),
		q16(x1),
		q16(y1),
		vdp_pkt_reg1 | vdp_reg_draw_layer_prio,
		layer_priority(layer, z),
		vdp_pkt_reg1 | vdp_reg_draw_color,
		color_word(r, g, b, a),
		vdp_pkt_cmd | vdp_cmd_fill_rect
	)
end

function vdp_stream.draw_line_rgba(x0, y0, x1, y1, z, layer, r, g, b, a, thickness)
	memwrite(
		vdp_stream_claim_words(11),
		vdp_pkt_regn | (5 << 16) | vdp_reg_geom_x0,
		q16(x0),
		q16(y0),
		q16(x1),
		q16(y1),
		q16(thickness),
		vdp_pkt_reg1 | vdp_reg_draw_layer_prio,
		layer_priority(layer, z),
		vdp_pkt_reg1 | vdp_reg_draw_color,
		color_word(r, g, b, a),
		vdp_pkt_cmd | vdp_cmd_draw_line
	)
end

function vdp_stream.blit_source_rgba(slot, u, v, w, h, x, y, z, layer, scale_x, scale_y, flip_flags, r, g, b, a, parallax_weight)
	memwrite(
		vdp_stream_claim_words(16),
		vdp_pkt_regn | (3 << 16) | vdp_reg_src_slot,
		slot,
		pack_low_high(u, v),
		pack_low_high(w, h),
		vdp_pkt_regn | (2 << 16) | vdp_reg_dst_x,
		q16(x),
		q16(y),
		vdp_pkt_reg1 | vdp_reg_draw_layer_prio,
		layer_priority(layer, z),
		vdp_pkt_regn | (3 << 16) | vdp_reg_draw_ctrl,
		draw_ctrl_word(flip_flags, parallax_weight),
		q16(scale_x),
		q16(scale_y),
		vdp_pkt_reg1 | vdp_reg_draw_color,
		color_word(r, g, b, a),
		vdp_pkt_cmd | vdp_cmd_blit
	)
end

return vdp_stream
