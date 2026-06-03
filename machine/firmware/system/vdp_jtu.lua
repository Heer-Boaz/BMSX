require('system/vdp_rpu')
local vdp_jtu<const> = {}

local packet_kind<const> = 0x15000000
local matrix_words_per_matrix<const> = 16
local matrix_count<const> = 32
local matrix_packet_payload_words<const> = 1 + matrix_words_per_matrix

struct jtu_matrix_packet_header
	header: word
	matrix_word_offset: word
end

function vdp_jtu.matrix_words(matrix_index, src_addr)
	local base<const> = vdp_stream_claim(1 + matrix_packet_payload_words)
	local packet<const>: *jtu_matrix_packet_header = base
	local data<const>: *word = base + sizeof(jtu_matrix_packet_header)
	local src<const>: *word = src_addr
	packet->header = packet_kind | (matrix_packet_payload_words << 16)
	packet->matrix_word_offset = matrix_index * matrix_words_per_matrix
	local index = 0
	while index < matrix_words_per_matrix do
		data[index] = src[index]
		index = index + 1
	end
end

vdp_jtu.matrix_words_per_matrix = matrix_words_per_matrix
vdp_jtu.matrix_count = matrix_count

return vdp_jtu
