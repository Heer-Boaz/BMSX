local dma<const> = {}

local source_addr<const>: *word = 0x08000014
local target_addr<const>: *word = 0x08000018
local length_addr<const>: *word = 0x0800001c
local control_addr<const>: *word = 0x08000020
local gx_gp0_addr<const> = 0x08010240
local control_start_strict<const> = 0x00000003

function dma.copy_to_gp0(source, byte_length)
	*source_addr = source
	*target_addr = gx_gp0_addr
	*length_addr = byte_length
	*control_addr = control_start_strict
end

return dma
