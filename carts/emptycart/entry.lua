mem[0x08000084] = 0x00000001
require('cartlib/prelude')
local irq_mask_addr<const> = 0x0800010c
local irq_vblank<const> = 0x0010
local irq_apu<const> = 0x0200
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
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

init()
mem[irq_mask_addr] = irq_vblank | irq_apu
new_game()
mem[0x08000194] = 0x00000001
wait_vblank()

while true do
	update_cart()
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
end
