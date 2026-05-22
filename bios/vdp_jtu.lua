local vdp_stream<const> = require('bios/vdp_stream')
local vdp_jtu<const> = {}

local packet_kind<const> = 0x15000000
local matrix_words_per_matrix<const> = 16
local matrix_count<const> = 32
local matrix_packet_payload_words<const> = 1 + matrix_words_per_matrix

local header<const> = function(payload_words)
	return packet_kind | (payload_words << 16)
end

function vdp_jtu.matrix_words(matrix_index, src_addr)
	local wp = vdp_stream.claim(1 + matrix_packet_payload_words)
	mem[wp], wp = header(matrix_packet_payload_words), wp + 4
	mem[wp], wp = matrix_index * matrix_words_per_matrix, wp + 4
	local index = 0
	while index < matrix_words_per_matrix do
		mem[wp], wp = mem[src_addr + index * 4], wp + 4
		index = index + 1
	end
end

vdp_jtu.matrix_words_per_matrix = matrix_words_per_matrix
vdp_jtu.matrix_count = matrix_count

return vdp_jtu
