require('bios/vdp_rpu')
local vdp_xf<const> = {}

local packet_kind<const> = 0x13000000
local matrix_words_per_matrix<const> = 16
local matrix_count<const> = 8
local matrix_register_words<const> = matrix_words_per_matrix * matrix_count
local view_matrix_index_register<const> = matrix_register_words
local matrix_packet_payload_words<const> = 1 + matrix_words_per_matrix
local select_packet_payload_words<const> = 3

local header<const> = function(payload_words)
	return packet_kind | (payload_words << 16)
end

function vdp_xf.matrix_words(matrix_index, src_addr)
	local wp = vdp_stream_claim(1 + matrix_packet_payload_words)
	mem[wp], wp = header(matrix_packet_payload_words), wp + 4
	mem[wp], wp = matrix_index * matrix_words_per_matrix, wp + 4
	local index = 0
	while index < matrix_words_per_matrix do
		mem[wp], wp = mem[src_addr + index * 4], wp + 4
		index = index + 1
	end
end

function vdp_xf.select(view_matrix_index, projection_matrix_index)
	memwrite(
		vdp_stream_claim(1 + select_packet_payload_words),
		header(select_packet_payload_words),
		view_matrix_index_register,
		view_matrix_index,
		projection_matrix_index
	)
end

vdp_xf.matrix_words_per_matrix = matrix_words_per_matrix
vdp_xf.matrix_count = matrix_count
vdp_xf.view_matrix_index_register = view_matrix_index_register

return vdp_xf
