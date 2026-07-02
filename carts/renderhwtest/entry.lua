mem[0x08000084] = 0x00000001
require('cartlib/prelude')

local frame = 0
local irq_mask_addr<const> = 0x0800010c
local irq_vblank<const> = 0x0010
local irq_apu<const> = 0x0200
local vblank_count = 0

local width<const> = 256
local height<const> = 212
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
		vdp_draw_line_color(x, 0, x, height, 20, 0x00000000, grid_color, 1)
	end
	for y = 0, height, 32 do
		vdp_draw_line_color(0, y, width, y, 20, 0x00000000, grid_color, 1)
	end
end

local draw_cart<const> = function()
	vdp_clear_color(background)
	draw_grid()

	local phase<const> = frame % 160
	local x0<const> = 16 + phase
	local y0<const> = 42 + ((frame * 3) % 64)
	local x1<const> = width - 16 - phase
	local y1<const> = height - 42 - ((frame * 5) % 64)

	vdp_fill_rect_color(24, 24, 96, 72, 30, 0x00000000, shadow_color)
	vdp_fill_rect_color(20, 20, 92, 68, 40, 0x00000000, bar_color)
	vdp_fill_rect_color(width - 92, height - 68, width - 20, height - 20, 40, 0x00000000, hot_color)
	vdp_draw_line_color(x0, y0, x1, y1, 60, 0x00000000, line_color, 4)
end

mem[irq_mask_addr] = irq_vblank | irq_apu
mem[0x08000194] = 0x00000001
wait_vblank()

while true do
	mem[0x08000194] = 0x00000001
	wait_vblank()
	vdp_stream_cursor = 0x080c0000
	draw_cart()
	vdp_stream_finish()
	do
		local used_bytes<const> = vdp_stream_cursor - 0x080c0000
		if used_bytes ~= 0 then
			mem[0x08000110] = 0x080c0000
			mem[0x08000114] = 0x0800007c
			mem[0x08000118] = used_bytes
			mem[0x0800011c] = 0x00000001
		end
	end
	frame = frame + 1
end
