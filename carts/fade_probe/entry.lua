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
local blend_probe_bg<const> = 0xff402080
local red<const> = 0xffff2020
local green<const> = 0xff20ff20
local yellow<const> = 0xffffff20

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

on_irq(irq_vblank, function()
	vblank_count = vblank_count + 1
end)

local draw_static_blend_ladders<const> = function()
	local step_w<const> = 32
	for i = 0, 9 do
		local x<const> = i * step_w
		gx_fill_rect_color(x, 156, x + step_w, 184, blue)
		gx_fill_rect_half_color(x, 156, x + step_w, 184, white)
		gx_fill_rect_color(x, 196, x + step_w, 224, blend_probe_bg)
		gx_fill_rect_half_color(x, 196, x + step_w, 224, black)
	end
end

local draw_cart<const> = function()
	gx_clear_color(black)
	gx_fill_rect_color(16, 16, 144, 128, blue)
	gx_fill_rect_color(176, 16, 304, 128, blue)

	if frame >= 20 then
		gx_fill_rect_half_color(16, 16, 144, 128, white)
		gx_fill_rect_half_color(176, 16, 304, 128, black)
	end

	gx_fill_rect_color(16, 136, 144, 148, red)
	gx_fill_rect_color(152, 136, 168, 148, green)
	gx_fill_rect_color(176, 136, 304, 148, yellow)
	draw_static_blend_ladders()
end

*irq_mask_register = irq_vblank | irq_apu
*inp_ctrl_register = 0x00000001
wait_vblank()

while true do
	*inp_ctrl_register = 0x00000001
	wait_vblank()
	gx_reset_320x240_pal()
	draw_cart()
	frame = frame + 1
end
