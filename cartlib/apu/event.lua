module<const>

-- Raw APU completion-latch contract. Consumers bind these addresses as typed
-- pointers once; the const module leaves IRQ reads as direct mapped loads.
return {
	kind_address = 0x0800017c,
	slot_address = 0x08000180,
	source_address = 0x08000184,
	kind_slot_ended = 0x00000001,
}
