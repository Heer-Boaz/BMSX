local gx_gpu<const> = {}

local gp0<const>: *word = 0x0801036c
local gp1<const>: *word = 0x08010370

local gp1_reset<const> = 0x00000000
local gp1_display_enable<const> = 0x03000000
local gp1_display_start_0<const> = 0x05000000
local gp1_horizontal_320_pal<const> = 0x06c6e27e
local gp1_vertical_240_pal<const> = 0x07044c23
local gp1_display_mode_320_pal<const> = 0x08000009

local gp0_fill_rectangle<const> = 0x02000000
local gp0_draw_rectangle<const> = 0x60000000
local gp0_draw_line<const> = 0x40000000
local gp0_drawing_area_top_left_0<const> = 0xe3000000
local gp0_drawing_area_bottom_right_320x240<const> = 0xe403bd3f
local gp0_drawing_offset_0<const> = 0xe5000000
local gp0_mask_bit_mode_0<const> = 0xe6000000

local display_width<const> = 320
local display_height<const> = 240

local argb_to_gp0_rgb<const> = function(color)
	return ((color & 0x00ff0000) >> 16) | (color & 0x0000ff00) | ((color & 0x000000ff) << 16)
end

local xy<const> = function(x, y)
	return (x & 0x0000ffff) | ((y & 0x0000ffff) << 16)
end

local wh<const> = function(width, height)
	return (width & 0x0000ffff) | ((height & 0x0000ffff) << 16)
end

function gx_gpu.reset_320x240_pal()
	*gp1 = gp1_reset
	*gp1 = gp1_display_mode_320_pal
	*gp1 = gp1_display_start_0
	*gp1 = gp1_horizontal_320_pal
	*gp1 = gp1_vertical_240_pal
	*gp0 = gp0_drawing_area_top_left_0
	*gp0 = gp0_drawing_area_bottom_right_320x240
	*gp0 = gp0_drawing_offset_0
	*gp0 = gp0_mask_bit_mode_0
	*gp1 = gp1_display_enable
end

function gx_gpu.clear_color(color)
	*gp0 = gp0_fill_rectangle | argb_to_gp0_rgb(color)
	*gp0 = 0x00000000
	*gp0 = wh(display_width, display_height)
end

function gx_gpu.fill_rect_color(x0, y0, x1, y1, color)
	*gp0 = gp0_draw_rectangle | argb_to_gp0_rgb(color)
	*gp0 = xy(x0, y0)
	*gp0 = wh(x1 - x0, y1 - y0)
end

function gx_gpu.draw_line_color(x0, y0, x1, y1, color)
	*gp0 = gp0_draw_line | argb_to_gp0_rgb(color)
	*gp0 = xy(x0, y0)
	*gp0 = xy(x1, y1)
end

gx_gpu.display_width = display_width
gx_gpu.display_height = display_height

return gx_gpu
