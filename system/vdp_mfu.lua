require('system/vdp_rpu')
local vdp_mfu<const> = {}

local packet_kind<const> = 0x14000000

function vdp_mfu.register_words(first_register, src_addr, word_count)
	local wp = vdp_stream_claim(2 + word_count)
	mem[wp], wp = packet_kind | ((1 + word_count) << 16), wp + 4
	mem[wp], wp = first_register, wp + 4
	local index = 0
	while index < word_count do
		mem[wp], wp = mem[src_addr + index * 4], wp + 4
		index = index + 1
	end
end

return vdp_mfu
