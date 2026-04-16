function init()
end

function new_game()
end

local update_cart<const> = function()
end

local draw_cart<const> = function()
end

local dispatch_irqs<const> = function()
	local flags<const> = mem[sys_irq_flags]
	if flags ~= 0 then
		irq(flags)
	end
	return flags
end

mem[sys_inp_ctrl] = inp_ctrl_arm
local flags
repeat
	halt_until_irq
	flags = dispatch_irqs()
until (flags & irq_vblank) ~= 0

while true do
	update_cart()
	mem[sys_inp_ctrl] = inp_ctrl_arm
	repeat
		halt_until_irq
		flags = dispatch_irqs()
	until (flags & irq_vblank) ~= 0
	vdp_stream_cursor = sys_vdp_stream_base
	draw_cart()
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
