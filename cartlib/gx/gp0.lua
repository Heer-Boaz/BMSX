module<const>

local drawing_offset<const> = 0xe5000000
local signed_coordinate_extent<const> = 0x400

local argb_to_rgb<const> = function(color)
	return ((color & 0x00ff0000) >> 16) | (color & 0x0000ff00) | ((color & 0x000000ff) << 16)
end

local argb_to_texture_rgb<const> = function(color)
	return (((((color >> 16) & 0x000000ff) * 128) + 127) // 255)
		| ((((((color >> 8) & 0x000000ff) * 128) + 127) // 255) << 8)
		| (((((color & 0x000000ff) * 128) + 127) // 255) << 16)
end

local pair16<const> = function(first, second)
	local rounded_first
	if first >= 0 then
		rounded_first = (first + 0.5) // 1
	else
		rounded_first = -(((-first) + 0.5) // 1)
	end
	local rounded_second
	if second >= 0 then
		rounded_second = (second + 0.5) // 1
	else
		rounded_second = -(((-second) + 0.5) // 1)
	end
	return (rounded_first & 0x0000ffff) | ((rounded_second & 0x0000ffff) << 16)
end

local drawing_offset_word<const> = function(x, y)
	local rounded_x
	if x >= 0 then
		rounded_x = (x + 0.5) // 1
	else
		rounded_x = -(((-x) + 0.5) // 1)
	end
	local rounded_y
	if y >= 0 then
		rounded_y = (y + 0.5) // 1
	else
		rounded_y = -(((-y) + 0.5) // 1)
	end
	return drawing_offset | (rounded_x & 0x000007ff) | ((rounded_y & 0x000007ff) << 11)
end

local uv<const> = function(u, v)
	return (u & 0x000000ff) | ((v & 0x000000ff) << 8)
end

local uv_texpage<const> = function(u, v, draw_mode)
	return (u & 0x000000ff) | ((v & 0x000000ff) << 8) | (draw_mode << 16)
end

local texture_mode_palette4<const> = 0x00000000
local texture_mode_direct16<const> = 0x00000002

local direct16_draw_mode<const> = function(source_x, source_y, blend_mode)
	return (texture_mode_direct16 << 7) | blend_mode | (((source_x >> 8) & 0x00000003) << 2) | ((source_y & 0x00000100) >> 4) | ((source_y & 0x00000200) << 2)
end

local palette4_draw_mode<const> = function(texture_x, source_x, source_y, blend_mode)
	local page_x<const> = texture_x + ((source_x >> 8) << 6)
	return (texture_mode_palette4 << 7) | blend_mode | ((page_x >> 6) & 0x0000000f) | ((source_y & 0x00000100) >> 4) | ((source_y & 0x00000200) << 2)
end

local uv_clut<const> = function(u, v, clut_x, clut_y)
	return (u & 0x000000ff) | ((v & 0x000000ff) << 8) | ((((clut_x >> 4) & 0x0000003f) | ((clut_y & 0x000003ff) << 6)) << 16)
end

return {
	nop = 0x00000000,
	fill_rectangle = 0x02000000,
	draw_rectangle = 0x60000000,
	draw_triangle = 0x20000000,
	draw_quad = 0x28000000,
	draw_semitransparent_quad = 0x2a000000,
	draw_gouraud_triangle = 0x30000000,
	draw_textured_quad = 0x2c000000,
	draw_raw_textured_quad = 0x2d000000,
	draw_textured_rectangle = 0x64000000,
	draw_raw_textured_rectangle = 0x65000000,
	draw_raw_textured_rectangle_1x1 = 0x6d000000,
	draw_raw_textured_rectangle_8x8 = 0x75000000,
	draw_raw_textured_rectangle_16x16 = 0x7d000000,
	draw_semitransparent_rectangle = 0x62000000,
	draw_line = 0x40000000,
	irq_request = 0x1f000000,
	vram_to_vram = 0x80000000,
	draw_mode = 0xe1000000,
	drawing_area_top_left = 0xe3000000,
	drawing_area_bottom_right = 0xe4000000,
	drawing_offset = drawing_offset,
	mask_bit_mode = 0xe6000000,

	draw_mode_blend_half = 0x00000000,
	draw_mode_blend_add = 0x00000020,
	draw_mode_blend_subtract = 0x00000040,
	draw_mode_blend_quarter = 0x00000060,
	texture_mode_palette4 = texture_mode_palette4,
	texture_mode_direct16 = texture_mode_direct16,
	draw_mode_texture_rectangle_x_flip = 0x00001000,
	draw_mode_texture_rectangle_y_flip = 0x00002000,
	modulated_texture_opcode_mask = 0xfe000000,
	rectangle_size_1x1 = 0x00010001,
	rectangle_size_8x8 = 0x00080008,
	rectangle_size_16x16 = 0x00100010,
	texture_page_span = 256,
	signed_coordinate_extent = signed_coordinate_extent,
	argb_to_rgb = argb_to_rgb,
	argb_to_texture_rgb = argb_to_texture_rgb,
	pair16 = pair16,
	drawing_offset_word = drawing_offset_word,
	uv = uv,
	uv_texpage = uv_texpage,
	uv_clut = uv_clut,
	direct16_draw_mode = direct16_draw_mode,
	palette4_draw_mode = palette4_draw_mode,
}
