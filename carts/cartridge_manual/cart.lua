module<entry>

local state<const> = require('results')
local result<const>: *cartridge_manual_result = state.result
local irq_flags<const>: *word = 0x08000000
local irq_ack<const>: *word = 0x08000004
local irq_mask<const>: *word = 0x08000008
local dma_read<const>: *word = 0x0800000c
local dma_write<const>: *word = 0x08000010
local dma_count<const>: *word = 0x08000014
local dma_control<const>: *word = 0x08000018
local dma_status<const>: *word = 0x0800001c
local dma_trigger<const>: *word = 0x08000020
local cart_select<const>: *word = 0x08010420
local cart_status<const>: *word = 0x08010424
local card_rom<const>: *word = 0x10000000
local card_ram<const>: *word = 0x30000000
local mail_data<const>: *word = 0x30f00000
local mail_control<const>: *word = 0x30f00004
local mail_status<const>: *word = 0x30f00008
local mail_ack<const>: *word = 0x30f0000c

rodata seed: word[4] = {
	0x01234567, 0x89abcdef, 0x55aa33cc, 0xf00dcafe,
}

-- Own DMA0, both mailboxes and card-RAM bytes0..31 on both sockets.
-- Mask delivery and poll raw pending bits; do not install a DMA service.
*irq_mask = 0
*irq_ack = 0x00000601
result.boot_status = *cart_status
*cart_select = 0x80000001
result.selection_word = *cart_select
result.selected_status = *cart_status
result.data_card_rom = card_rom[0]

*cart_select = 0
card_ram[0] = 0x10203040
*cart_select = 1
card_ram[0] = 0x50607080

for slot = 0, 1 do
	*cart_select = slot
	result.ram_words[slot] = card_ram[0]
	local source_bit<const> = 0x00000200 << slot
	*mail_data = 0x6d61696c | slot
	*mail_control = 0x80000001
	result.mail_data[slot] = *mail_data
	result.mail_control[slot] = *mail_control
	result.local_pending[slot] = *mail_status
	result.first_edge[slot] = *irq_flags & source_bit
	-- Central ACK alone does not rearm the card's local edge latch.
	*irq_ack = source_bit
	*mail_control = 0x80000001
	result.coalesced[slot] = *irq_flags & source_bit
	*mail_ack = 1
	*mail_control = 0x80000001
	result.rearmed[slot] = *irq_flags & source_bit
	*mail_ack = 1
	*irq_ack = source_bit
	result.after_ack[slot] = *mail_status
end

-- Slot0 READ request, slot1 WRITE request. No FIFO is implied.
*cart_select = 0
*mail_control = 2
result.requests[0] = *mail_control
*cart_select = 1
*mail_control = 4
result.requests[1] = *mail_control
result.seed_address = seed
*dma_read = seed
*dma_write = 0x30000010
*dma_count = 4
-- Block4; READ_REQUEST8; WRITE_REQUEST9; increment both addresses.
*dma_control = 0x00000e63
*dma_trigger = 1
while (*dma_status & 1) ~= 0 do
end
result.dma_selection = *cart_select
result.dma_control = *dma_control
result.dma_status = *dma_status
result.dma_count = *dma_count
result.dma_read_end = *dma_read
result.dma_write_end = *dma_write
result.dma_pending = *irq_flags & 1
for index = 0, 3 do
	result.received[index] = card_ram[4 + index]
end
*mail_control = 0
*cart_select = 0
*mail_control = 0
for index = 0, 3 do
	result.untouched[index] = card_ram[4 + index]
end
*irq_ack = 0x00000601
result.completed = 1

while true do
	halt_until_irq
end
