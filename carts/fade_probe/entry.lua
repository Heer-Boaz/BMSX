local gx_gpu<const> = require('system/gx_gpu')
gx_gpu.reset_320x240_pal()
require('cartlib/prelude')
local frame = 0
local irq_mask_register<const>: *word = 0x0800010c
local inp_ctrl_register<const>: *word = 0x08000194
local irq_vblank<const> = 0x0010
local irq_apu<const> = 0x0200
local vblank_count = 0

local blue<const> = 0xff2044cc
local white<const> = 0xffffffff
local black<const> = 0xff000000
local purple<const> = 0xff402080
local red<const> = 0xffff2020
local green<const> = 0xff20ff20
local yellow<const> = 0xffffff20
local cyan<const> = 0xff20ffff
local column_w<const> = 68

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

on_irq(irq_vblank, function()
	vblank_count = vblank_count + 1
end)

local draw_blend_probe<const> = function(x, y, bg, fg, draw_mode)
	gx_fill_rect_color(x, y, x + column_w, y + 44, bg)
	gx_set_draw_mode(draw_mode)
	gx_fill_rect_semitrans_color(x, y, x + column_w, y + 44, fg)
end

local draw_mode_row<const> = function(y, bg, fg)
	draw_blend_probe(8, y, bg, fg, gx_draw_mode_blend_half)
	draw_blend_probe(84, y, bg, fg, gx_draw_mode_blend_add)
	draw_blend_probe(160, y, bg, fg, gx_draw_mode_blend_subtract)
	draw_blend_probe(236, y, bg, fg, gx_draw_mode_blend_quarter)
end

local draw_mode_guides<const> = function()
	gx_fill_rect_color(8, 72, 76, 80, red)
	gx_fill_rect_color(84, 72, 152, 80, green)
	gx_fill_rect_color(160, 72, 228, 80, yellow)
	gx_fill_rect_color(236, 72, 304, 80, cyan)
	gx_fill_rect_color(8, 148, 76, 156, red)
	gx_fill_rect_color(84, 148, 152, 156, green)
	gx_fill_rect_color(160, 148, 228, 156, yellow)
	gx_fill_rect_color(236, 148, 304, 156, cyan)
end

local draw_cart<const> = function()
	gx_clear_color(black)

	if frame >= 20 then
		draw_mode_row(20, blue, white)
		draw_mode_row(96, purple, red)
	else
		gx_fill_rect_color(8, 20, 76, 64, blue)
		gx_fill_rect_color(84, 20, 152, 64, blue)
		gx_fill_rect_color(160, 20, 228, 64, blue)
		gx_fill_rect_color(236, 20, 304, 64, blue)
		gx_fill_rect_color(8, 96, 76, 140, purple)
		gx_fill_rect_color(84, 96, 152, 140, purple)
		gx_fill_rect_color(160, 96, 228, 140, purple)
		gx_fill_rect_color(236, 96, 304, 140, purple)
	end

	draw_mode_guides()
end

*irq_mask_register = irq_vblank | irq_apu
*inp_ctrl_register = 0x00000001
wait_vblank()

while true do
	*inp_ctrl_register = 0x00000001
	wait_vblank()
	draw_cart()
	frame = frame + 1
end
