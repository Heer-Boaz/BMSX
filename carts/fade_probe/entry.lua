require('cartlib/prelude')
local frame = 0
local irq_flags_addr<const> = 0x08000108
local irq_vblank<const> = 0x0010

local width<const> = 160
local height<const> = 120
local blue<const> = 0xff2044cc
local white_rgb<const> = 0x00ffffff
local black_rgb<const> = 0x00000000
local black<const> = 0xff000000
local red<const> = 0xffff2020
local green<const> = 0xff20ff20
local yellow<const> = 0xffffff20

local dispatch_irqs<const> = function()
	local flags<const> = mem[irq_flags_addr]
	if flags ~= 0 then
		irq(flags)
	end
	return flags
end

local draw_static_alpha_ladders<const> = function()
	local step_w<const> = 16
	for i = 0, 9 do
		local ab<const> = (i * 255) // 9
		local x<const> = i * step_w
		vdp_fill_rect_color(x, 78, x + step_w, 92, 20, sys_vdp_layer_world, blue)
		vdp_fill_rect_color(x, 78, x + step_w, 92, 30, sys_vdp_layer_world, (ab << 24) | white_rgb)
		vdp_fill_rect_color(x, 98, x + step_w, 112, 20, sys_vdp_layer_world, blue)
		vdp_fill_rect_color(x, 98, x + step_w, 112, 30, sys_vdp_layer_world, (ab << 24) | black_rgb)
	end
end

local draw_cart<const> = function()
	vdp_fill_rect_color(0, 0, width, height, 0, sys_vdp_layer_world, black)
	vdp_fill_rect_color(8, 8, 76, 64, 10, sys_vdp_layer_world, blue)
	vdp_fill_rect_color(84, 8, 152, 64, 10, sys_vdp_layer_world, blue)

	local ramp_frame = frame
	if ramp_frame > 20 then
		ramp_frame = 20
	end
	local ab<const> = (ramp_frame * 255) // 20
	vdp_fill_rect_color(8, 8, 76, 64, 20, sys_vdp_layer_world, (ab << 24) | white_rgb)
	vdp_fill_rect_color(84, 8, 152, 64, 20, sys_vdp_layer_world, (ab << 24) | black_rgb)

	vdp_fill_rect_color(8, 68, 76, 74, 20, sys_vdp_layer_world, red)
	vdp_fill_rect_color(78, 68, 82, 74, 20, sys_vdp_layer_world, green)
	vdp_fill_rect_color(84, 68, 152, 74, 20, sys_vdp_layer_world, yellow)
	draw_static_alpha_ladders()
end

mem[sys_inp_ctrl] = inp_ctrl_arm
local flags
repeat
	halt_until_irq
	flags = dispatch_irqs()
until (flags & irq_vblank) ~= 0

while true do
	mem[sys_inp_ctrl] = inp_ctrl_arm
	repeat
		halt_until_irq
		flags = dispatch_irqs()
	until (flags & irq_vblank) ~= 0
	vdp_stream_cursor = sys_vdp_stream_base
	draw_cart()
	vdp_stream_finish()
	do
		local used_bytes<const> = vdp_stream_cursor - sys_vdp_stream_base
		if used_bytes ~= 0 then
			mem[sys_dma_src] = sys_vdp_stream_base
			mem[sys_dma_dst] = sys_vdp_fifo
			mem[sys_dma_len] = used_bytes
			mem[sys_dma_ctrl] = dma_ctrl_start
		end
	end
	frame = frame + 1
end
