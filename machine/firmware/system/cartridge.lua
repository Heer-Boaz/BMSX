local cartridge<const> = {}

cartridge.select_addr = 0x0801041c
cartridge.status_addr = 0x08010420
cartridge.slot0_board_addr = 0x08010424
cartridge.slot0_ram_bytes_addr = 0x08010428
cartridge.slot1_board_addr = 0x0801042c
cartridge.slot1_ram_bytes_addr = 0x08010430
cartridge.rom_base = 0x10000000
cartridge.ram_base = 0x30000000
cartridge.mmio_base = 0x30f00000
cartridge.mailbox_data_offset = 0x00
cartridge.mailbox_control_offset = 0x04
cartridge.mailbox_status_offset = 0x08
cartridge.mailbox_irq_ack_offset = 0x0c
cartridge.mailbox_control_irq_trigger = 0x00000001
cartridge.mailbox_control_dreq_read = 0x00000002
cartridge.mailbox_control_dreq_write = 0x00000004
cartridge.mailbox_status_irq_pending = 0x00000001

return cartridge
