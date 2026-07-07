require('cartlib/prelude')

bss affine_pixels: word[4]

local frame = 0
local irq_mask_register<const>: *word = 0x0800010c
local input_control_register<const>: *word = 0x08000194
local irq_vblank<const> = 0x0010
local irq_apu<const> = 0x0200
local vblank_count = 0
renderhwtest_affine_ready = false
renderhwtest_draw_count = 0

local width<const> = gx_display_width
local height<const> = gx_display_height
local background<const> = 0xff07111f
local grid_color<const> = 0xff18365a
local bar_color<const> = 0xff3dd6ff
local hot_color<const> = 0xffffd166
local line_color<const> = 0xffff5c8a
local shadow_color<const> = 0xff102030
local affine_color<const> = 0xffffffff
local affine_texture_x<const> = 0
local affine_texture_y<const> = 384

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

on_irq(irq_vblank, function()
	vblank_count = vblank_count + 1
end)

local draw_grid<const> = function()
	for x = 0, width, 32 do
		gx_draw_line_color(x, 0, x, height, grid_color)
	end
	for y = 0, height, 32 do
		gx_draw_line_color(0, y, width, y, grid_color)
	end
end

local upload_affine_texture<const> = function()
	local pixels<const>: *word = affine_pixels
	pixels[0] = 0xffff0000
	pixels[1] = 0xff00ff00
	pixels[2] = 0xff0000ff
	pixels[3] = 0xffffffff
	gx_upload_rgba8888_to_direct16_stride(
		affine_pixels, 0, 0, 2,
		affine_texture_x, affine_texture_y,
		2, 2)
end

local draw_affine_texture<const> = function()
	gx_draw_direct16_textured_quad_color(
		affine_texture_x, affine_texture_y,
		affine_texture_x, affine_texture_y,
		affine_texture_x + 2, affine_texture_y,
		affine_texture_x, affine_texture_y + 2,
		affine_texture_x + 2, affine_texture_y + 2,
		112, 92,
		204, 110,
		90, 138,
		182, 156,
		affine_color)
end

local draw_cart<const> = function()
	gx_clear_color(background)
	draw_grid()

	local phase<const> = frame % 160
	local x0<const> = 16 + phase
	local y0<const> = 42 + ((frame * 3) % 64)
	local x1<const> = width - 16 - phase
	local y1<const> = height - 42 - ((frame * 5) % 64)

	gx_fill_rect_color(24, 24, 96, 72, shadow_color)
	gx_fill_rect_color(20, 20, 92, 68, bar_color)
	gx_fill_rect_color(width - 92, height - 68, width - 20, height - 20, hot_color)
	gx_draw_line_color(x0, y0, x1, y1, line_color)
	draw_affine_texture()
	renderhwtest_draw_count = renderhwtest_draw_count + 1
end

*irq_mask_register = irq_vblank | irq_apu
gx_reset_320x240_pal()
gx_clear_color(background)
upload_affine_texture()
renderhwtest_affine_ready = true
*input_control_register = 0x00000001
wait_vblank()

while true do
	*input_control_register = 0x00000001
	wait_vblank()
	draw_cart()
	frame = frame + 1
end
