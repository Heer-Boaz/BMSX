require('cartlib/prelude')

local frame = 0
local irq_mask_addr<const> = 0x0800010c
local irq_vblank<const> = 0x0010
local irq_apu<const> = 0x0200
local vblank_count = 0

local width<const> = gx_display_width
local height<const> = gx_display_height
local background<const> = 0xff07111f
local grid_color<const> = 0xff18365a
local bar_color<const> = 0xff3dd6ff
local hot_color<const> = 0xffffd166
local line_color<const> = 0xffff5c8a
local shadow_color<const> = 0xff102030

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
end

mem[irq_mask_addr] = irq_vblank | irq_apu
mem[0x08000194] = 0x00000001
wait_vblank()

while true do
	mem[0x08000194] = 0x00000001
	wait_vblank()
	gx_reset_320x240_pal()
	draw_cart()
	frame = frame + 1
end
