require('cartlib/prelude')
local irq_vblank<const> = 0x0010
local vblank_count = 0

function init()
	on_irq(irq_vblank, function()
		vblank_count = vblank_count + 1
	end)
end

function new_game()
end

local update_cart<const> = function()
end

local draw_cart<const> = function()
end

local wait_vblank<const> = function()
	local observed<const> = vblank_count
	repeat
		halt_until_irq
	until vblank_count ~= observed
end

init()
new_game()
mem[sys_inp_ctrl] = inp_ctrl_arm
wait_vblank()

while true do
	update_cart()
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
end
