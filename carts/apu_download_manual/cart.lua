module<entry>

local state<const> = require('results')
local result<const>: *apu_download_result = state.result
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local dma_read<const>: *word = 0x0800000c
local dma_write<const>: *word = 0x08000010
local dma_count<const>: *word = 0x08000014
local dma_control<const>: *word = 0x08000018
local dma_status<const>: *word = 0x0800001c
local dma_trigger<const>: *word = 0x08000020
local apu_status<const>: *word = 0x08000178
local transfer_address<const>: *word = 0x080001e8
local transfer_data<const>: *word = 0x080001ec
local transfer_control<const>: *word = 0x080001f0

rodata counts: word[2] = { 20, 4 }
rodata offsets: word[2] = { 0, 0x40 }

-- Own DMA0, the APU transfer ports and sample-RAM bytes0..159. No voices.
-- Poll DMA directly; no interrupt callback or cartlib DMA service owns it.
*irq_mask = 0
*transfer_control = 0
*transfer_address = 0
*transfer_control = 1
for index = 0, 39 do
	*transfer_data = 0x5a000000 | index
end

for phase = 0, 1 do
	*transfer_control = 0
	*transfer_address = offsets[phase]
	*irq_ack = 0x00000001
	*dma_read = 0x080001ec
	*dma_write = &result.received[phase * 20]
	*dma_count = counts[phase]
	-- Fixed APU_READ source, incrementing FORCE destination, block16.
	*dma_control = 0x00003c12
	*dma_trigger = 1
	*transfer_control = 3
	while (*dma_status & 0x00000001) ~= 0 do
	end
	result.apu_after_dma[phase] = *apu_status
	result.dma_status[phase] = *dma_status
	result.remaining[phase] = *dma_count
	result.pending[phase] = *irq_flags & 0x00000001
	-- Requested RAM receipt is complete. Do not wait for surplus prefetch.
	*transfer_control = 0
	result.apu_after_stop[phase] = *apu_status
	result.mode_after_stop[phase] = *transfer_control
	result.completed_phase = phase + 1
end

while true do
	halt_until_irq
end
