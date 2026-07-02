mem[0x08000084] = 0x00000002
require('cartlib/prelude')
local frame = 0
local irq_mask_addr<const> = 0x0800010c
local irq_vblank<const> = 0x0010
local irq_apu<const> = 0x0200
local vblank_count = 0

local width<const> = 160
local height<const> = 120
local blue<const> = 0xff2044cc
local white_rgb<const> = 0x00ffffff
local black_rgb<const> = 0x00000000
local black<const> = 0xff000000
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

local draw_static_alpha_ladders<const> = function()
	local step_w<const> = 16
	for i = 0, 9 do
		local ab<const> = (i * 255) // 9
		local x<const> = i * step_w
		vdp_fill_rect_color(x, 78, x + step_w, 92, 20, 0x00000000, blue)
		vdp_fill_rect_color(x, 78, x + step_w, 92, 30, 0x00000000, (ab << 24) | white_rgb)
		vdp_fill_rect_color(x, 98, x + step_w, 112, 20, 0x00000000, blue)
		vdp_fill_rect_color(x, 98, x + step_w, 112, 30, 0x00000000, (ab << 24) | black_rgb)
	end
end

local draw_cart<const> = function()
	vdp_fill_rect_color(0, 0, width, height, 0, 0x00000000, black)
	vdp_fill_rect_color(8, 8, 76, 64, 10, 0x00000000, blue)
	vdp_fill_rect_color(84, 8, 152, 64, 10, 0x00000000, blue)

	local ramp_frame = frame
	if ramp_frame > 20 then
		ramp_frame = 20
	end
	local ab<const> = (ramp_frame * 255) // 20
	vdp_fill_rect_color(8, 8, 76, 64, 20, 0x00000000, (ab << 24) | white_rgb)
	vdp_fill_rect_color(84, 8, 152, 64, 20, 0x00000000, (ab << 24) | black_rgb)

	vdp_fill_rect_color(8, 68, 76, 74, 20, 0x00000000, red)
	vdp_fill_rect_color(78, 68, 82, 74, 20, 0x00000000, green)
	vdp_fill_rect_color(84, 68, 152, 74, 20, 0x00000000, yellow)
	draw_static_alpha_ladders()
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
