module<const>

struct cartridge_manual_result
	completed: word
	boot_status: word
	selection_word: word
	selected_status: word
	ram_words: word[2]
	mail_data: word[2]
	mail_control: word[2]
	local_pending: word[2]
	first_edge: word[2]
	coalesced: word[2]
	rearmed: word[2]
	after_ack: word[2]
	data_card_rom: word
	seed_address: word
	dma_selection: word
	dma_control: word
	dma_status: word
	dma_count: word
	dma_read_end: word
	dma_write_end: word
	dma_pending: word
	requests: word[2]
	received: word[4]
	untouched: word[4]
end

bss result: cartridge_manual_result

return { result = result }
