local dma<const> = {}

local source_addr<const>: *word = 0x08000014
local target_addr<const>: *word = 0x08000018
local length_addr<const>: *word = 0x0800001c
local control_addr<const>: *word = 0x08000020
local status_addr<const>: *word = 0x08000024
local gx_gp0_addr<const> = 0x08010240
local control_start_strict<const> = 0x00000003
local ticket_shift<const> = 8
local ticket_mask<const> = 0x00ffffff
local ticket_half_range<const> = 0x00800000

function dma.copy_to_gp0(source, byte_length)
	*source_addr = source
	*target_addr = gx_gp0_addr
	*length_addr = byte_length
	*control_addr = control_start_strict
	return (*control_addr >> ticket_shift) & ticket_mask
end

function dma.has_completed(ticket)
	local completed<const> = (*status_addr >> ticket_shift) & ticket_mask
	return ((completed - ticket) & ticket_mask) < ticket_half_range
end

return dma
