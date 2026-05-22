local vdp_lpu<const> = {}

local packet_kind<const> = 0x17000000

local header<const> = function(payload_words)
	return packet_kind | (payload_words << 16)
end

function vdp_lpu.register_words(first_register, src_addr, word_count)
	local wp = vdp_stream_claim(2 + word_count)
	mem[wp], wp = header(1 + word_count), wp + 4
	mem[wp], wp = first_register, wp + 4
	local index = 0
	while index < word_count do
		mem[wp], wp = mem[src_addr + index * 4], wp + 4
		index = index + 1
	end
end

return vdp_lpu
