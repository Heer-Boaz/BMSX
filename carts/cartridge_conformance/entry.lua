local apu<const> = require('system/apu')
require('cartlib/prelude')

rodata transfer_source: word[4] = {
	0x01234567,
	0x89abcdef,
	0x55aa33cc,
	0xf00dcafe,
}
bss transfer_result: word[4]

local irq_mask<const>: *word = 0x08000008
local cart_select<const>: *word = 0x0801041c
local cart_status<const>: *word = 0x08010420
local slot0_board<const>: *word = 0x08010424
local slot0_ram_bytes<const>: *word = 0x08010428
local slot1_board<const>: *word = 0x0801042c
local slot1_ram_bytes<const>: *word = 0x08010430
local mailbox_data<const>: *word = 0x30f00000
local mailbox_control<const>: *word = 0x30f00004
local mailbox_status<const>: *word = 0x30f00008
local mailbox_irq_ack<const>: *word = 0x30f0000c
local cart_ram_probe<const>: *word = 0x30000000
local cart_replay_step<const>: *word = 0x30000004
local cart_rom_base<const> = 0x10000000
local irq_dma0_done<const> = 0x00000001
local irq_cartridge_slot1<const> = 0x00000400
local mailbox_control_irq_trigger<const> = 0x00000001
local mailbox_status_irq_pending<const> = 0x00000001
local dma_completion_count = 0
local mailbox_irq_count = 0

on_irq(irq_dma0_done, function()
	dma_completion_count = dma_completion_count + 1
end)
on_irq(irq_cartridge_slot1, function()
	mailbox_irq_count = mailbox_irq_count + 1
end)
*irq_mask = irq_dma0_done | irq_cartridge_slot1

assert(*cart_status == 0x00010003, 'mixed-socket boot selection mismatch')
assert(*slot0_board == 3 and *slot1_board == 3, 'cartridge board words mismatch')
assert(*slot0_ram_bytes == 256 and *slot1_ram_bytes == 256, 'cartridge RAM capacities mismatch')
*cart_select = 0
assert(mem32le[cart_rom_base + 32] == 0, 'data cartridge exposed a BLua32 image')
*cart_ram_probe = 0x10203040
*cart_select = 1
assert(mem32le[cart_rom_base + 32] ~= 0, 'boot cartridge did not expose its BLua32 header')
*cart_ram_probe = 0x50607080
*cart_select = 0
assert(*cart_ram_probe == 0x10203040, 'slot 0 cartridge RAM decode mismatch')
*cart_select = 1
assert(*cart_ram_probe == 0x50607080, 'slot 1 cartridge RAM decode mismatch')
*cart_replay_step = 0

*mailbox_data = 0x6d61696c
assert(*mailbox_data == 0x6d61696c, 'mailbox data latch mismatch')
*mailbox_control = 0x80000000 | mailbox_control_irq_trigger
assert(*mailbox_control == 0x80000000, 'mailbox control raw high bit mismatch')
while mailbox_irq_count == 0 do
	halt_until_irq
end
assert((*mailbox_status & mailbox_status_irq_pending) ~= 0, 'mailbox source latch did not assert')
*mailbox_irq_ack = 1
assert((*mailbox_status & mailbox_status_irq_pending) == 0, 'mailbox source latch did not acknowledge')
*mailbox_control = mailbox_control_irq_trigger
while mailbox_irq_count == 1 do
	halt_until_irq
end
*mailbox_irq_ack = 1

local upload_sequence<const> = dma_completion_count
apu.upload(&transfer_source, 0, 4)
while dma_completion_count == upload_sequence do
	halt_until_irq
end
local download_sequence<const> = dma_completion_count
apu.download(&transfer_result, 0, 4)
while dma_completion_count == download_sequence do
	halt_until_irq
end
assert(
	transfer_result[0] == transfer_source[0]
		and transfer_result[1] == transfer_source[1]
		and transfer_result[2] == transfer_source[2]
		and transfer_result[3] == transfer_source[3],
	'cartridge-ROM DMA/APU round trip mismatch')

local replay_irq_sequence<const> = mailbox_irq_count
print('CART-CONFORMANCE:READY')
while mailbox_irq_count == replay_irq_sequence do
	halt_until_irq
end
*mailbox_irq_ack = 1
*cart_replay_step = *cart_replay_step + 1
if *cart_replay_step == 1 then
	print('CART-CONFORMANCE:STEP1')
else
	print('CART-CONFORMANCE:UNRESTORED')
end
while true do
	halt_until_irq
end
