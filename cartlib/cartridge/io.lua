module<const>

-- Raw cartridge-bus register and aperture contract. Both sockets expose the
-- same ROM, RAM and board-MMIO windows; CART_SELECT chooses only the CPU data
-- view while DMA request selectors carry an explicit socket override.
return {
	select_address = 0x08010420,
	status_address = 0x08010424,
	slot0_board_address = 0x08010428,
	slot0_ram_byte_count_address = 0x0801042c,
	slot1_board_address = 0x08010430,
	slot1_ram_byte_count_address = 0x08010434,
	rom_address = 0x10000000,
	ram_address = 0x30000000,
	mmio_address = 0x30f00000,
	rom_header_board_id_word = 18,

	board_ram = 0x00000001,
	board_mailbox = 0x00000002,

	mailbox_data_offset = 0x00000000,
	mailbox_control_offset = 0x00000004,
	mailbox_status_offset = 0x00000008,
	mailbox_irq_ack_offset = 0x0000000c,
	mailbox_control_irq_trigger = 0x00000001,
	mailbox_control_dreq_read = 0x00000002,
	mailbox_control_dreq_write = 0x00000004,
	mailbox_status_irq_pending = 0x00000001,
}
