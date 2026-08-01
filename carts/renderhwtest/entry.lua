module<entry>
local gx_gpu<const> = require('cartlib/gx/gpu')
local gx_display<const> = require('cartlib/gx/display')
local gx_primitives<const> = require('cartlib/gx/primitives')
local gx_upload<const> = require('cartlib/gx/upload')
gx_display.reset_320x240()
local irq_module<const> = require('cartlib/irq')
irq = irq_module.dispatch

bss affine_pixels: word[4]

local frame = 0
local irq_mask_register<const>: *word = 0x08000008
local input_control_register<const>: *word = 0x08000064
local irq_vblank<const> = 0x0004
local vblank_count = 0
renderhwtest_affine_ready = false
renderhwtest_draw_count = 0

local width<const>, height<const> = gx_display.size()
local framebuffer_size<const> = 320 | (240 << 16)
local background<const> = 0xff07111f
local grid_color<const> = 0xff18365a
local bar_color<const> = 0xff3dd6ff
local hot_color<const> = 0xffffd166
local line_color<const> = 0xffff5c8a
local shadow_color<const> = 0xff102030
local affine_color<const> = 0xffffffff
local affine_blend_mode<const> = gx_gpu.draw_mode_blend_half
local affine_texture_x<const> = 0
local affine_texture_y<const> = 384

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

irq_module.register(irq_vblank, function()
	vblank_count = vblank_count + 1
end)

local draw_grid<const> = function()
	for x = 0, width, 32 do
		gx_gpu.draw_line_color(x, 0, x, height, grid_color)
	end
	for y = 0, height, 32 do
		gx_gpu.draw_line_color(0, y, width, y, grid_color)
	end
end

local upload_affine_texture<const> = function()
	local pixels<const>: *word = affine_pixels
	pixels[0] = 0xffff0000
	pixels[1] = 0xff00ff00
	pixels[2] = 0xff0000ff
	pixels[3] = 0xffffffff
	gx_upload.rgba8888_to_direct16_stride(
		affine_pixels, 0, 0, 2,
		affine_texture_x, affine_texture_y,
		2, 2)
end

local draw_affine_texture<const> = function()
	gx_gpu.draw_direct16_textured_quad_color(
		affine_texture_x, affine_texture_y,
		affine_texture_x, affine_texture_y,
		affine_texture_x + 2, affine_texture_y,
		affine_texture_x, affine_texture_y + 2,
		affine_texture_x + 2, affine_texture_y + 2,
		112, 92,
		204, 110,
		90, 138,
		182, 156,
		affine_color,
		affine_blend_mode)
end

local draw_cart<const> = function()
	gx_gpu.clear_color(0, framebuffer_size, background)
	draw_grid()

	local phase<const> = frame % 160
	local x0<const> = 16 + phase
	local y0<const> = 42 + ((frame * 3) % 64)
	local x1<const> = width - 16 - phase
	local y1<const> = height - 42 - ((frame * 5) % 64)

	gx_gpu.fill_rect_color(24, 24, 96, 72, shadow_color)
	gx_gpu.fill_rect_color(20, 20, 92, 68, bar_color)
	gx_gpu.fill_rect_color(width - 92, height - 68, width - 20, height - 20, hot_color)
	gx_primitives.draw_thick_line_color(x0, y0, x1, y1, line_color, 4)
	draw_affine_texture()
	renderhwtest_draw_count = renderhwtest_draw_count + 1
end

*irq_mask_register = irq_vblank
gx_gpu.clear_color(0, framebuffer_size, background)
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
