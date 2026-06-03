require('system/vdp_rpu')
local vdp_lpu<const> = {}

local packet_kind<const> = 0x17000000

struct lpu_register_packet_header
	header: word
	first_register: word
end

function vdp_lpu.register_words(first_register, src_addr, word_count)
	local base<const> = vdp_stream_claim(2 + word_count)
	local packet<const>: *lpu_register_packet_header = base
	local data<const>: *word = base + sizeof(lpu_register_packet_header)
	local src<const>: *word = src_addr
	packet->header = packet_kind | ((1 + word_count) << 16)
	packet->first_register = first_register
	local index = 0
	while index < word_count do
		data[index] = src[index]
		index = index + 1
	end
end

return vdp_lpu
