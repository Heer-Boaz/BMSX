require('cartlib/prelude')

local frame = 0
local irq_vblank<const> = 0x0010
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
	local observed<const> = vblank_count
	repeat
		halt_until_irq
	until vblank_count ~= observed
end

on_irq(irq_vblank, function()
	vblank_count = vblank_count + 1
end)

local draw_grid<const> = function()
	for x = 0, width, 32 do
		vdp_draw_line_color(x, 0, x, height, 20, sys_vdp_layer_world, grid_color, 1)
	end
	for y = 0, height, 32 do
		vdp_draw_line_color(0, y, width, y, 20, sys_vdp_layer_world, grid_color, 1)
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

	vdp_fill_rect_color(24, 24, 96, 72, 30, sys_vdp_layer_world, shadow_color)
	vdp_fill_rect_color(20, 20, 92, 68, 40, sys_vdp_layer_world, bar_color)
	vdp_fill_rect_color(width - 92, height - 68, width - 20, height - 20, 40, sys_vdp_layer_world, hot_color)
	vdp_draw_line_color(x0, y0, x1, y1, 60, sys_vdp_layer_world, line_color, 4)
end

mem[sys_inp_ctrl] = inp_ctrl_arm
wait_vblank()

while true do
	mem[sys_inp_ctrl] = inp_ctrl_arm
	wait_vblank()
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
