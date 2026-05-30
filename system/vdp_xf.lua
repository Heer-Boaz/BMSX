require('system/vdp_rpu')
local vdp_xf<const> = {}

local packet_kind<const> = 0x13000000
local matrix_words_per_matrix<const> = 16
local matrix_count<const> = 8
local matrix_register_words<const> = matrix_words_per_matrix * matrix_count
local view_matrix_index_register<const> = matrix_register_words
local matrix_packet_payload_words<const> = 1 + matrix_words_per_matrix
local select_packet_payload_words<const> = 3

struct xf_matrix_packet_header
	header: word
	matrix_word_offset: word
end

struct xf_select_packet
	header: word
	register: word
	view_matrix_index: word
	projection_matrix_index: word
end

function vdp_xf.matrix_words(matrix_index, src_addr)
	local base<const> = vdp_stream_claim(1 + matrix_packet_payload_words)
	local packet<const>: *xf_matrix_packet_header = base
	local data<const>: *word = base + sizeof(xf_matrix_packet_header)
	local src<const>: *word = src_addr
	packet->header = packet_kind | (matrix_packet_payload_words << 16)
	packet->matrix_word_offset = matrix_index * matrix_words_per_matrix
	local index = 0
	while index < matrix_words_per_matrix do
		data[index] = src[index]
		index = index + 1
	end
end

function vdp_xf.select(view_matrix_index, projection_matrix_index)
	local packet<const>: *xf_select_packet = vdp_stream_claim(sizeof(xf_select_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (select_packet_payload_words << 16)
	packet->register = view_matrix_index_register
	packet->view_matrix_index = view_matrix_index
	packet->projection_matrix_index = projection_matrix_index
end

vdp_xf.matrix_words_per_matrix = matrix_words_per_matrix
vdp_xf.matrix_count = matrix_count
vdp_xf.view_matrix_index_register = view_matrix_index_register

return vdp_xf
