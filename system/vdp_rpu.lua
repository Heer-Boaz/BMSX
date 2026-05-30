local numeric<const> = require('bios/common/numeric')

local vdp_rpu<const> = {}

vdp_stream_cursor = sys_vdp_stream_base

function vdp_stream_claim(count)
	local base<const> = vdp_stream_cursor
	vdp_stream_cursor = base + (count * sys_vdp_arg_stride)
	return base
end

function vdp_stream_submit_cpu_fifo()
	local end_packet<const>: *word = vdp_stream_claim(1)
	local stream<const>: *word = sys_vdp_stream_base
	local fifo<const>: *word = sys_vdp_fifo
	local fifo_ctrl<const>: *word = sys_vdp_fifo_ctrl
	*end_packet = sys_vdp_pkt_end
	local word_count<const> = (vdp_stream_cursor - sys_vdp_stream_base) // sys_vdp_arg_stride
	local index = 0
	while index < word_count do
		*fifo = stream[index]
		index = index + 1
	end
	*fifo_ctrl = sys_vdp_fifo_ctrl_seal
	vdp_stream_cursor = sys_vdp_stream_base
end

local packet_kind<const> = 0x18000000
local op_buffer_define<const> = 1
local op_buffer_upload_dma<const> = 2
local op_buffer_upload_inline<const> = 3
local op_buffer_discard<const> = 4
local op_surface_define<const> = 8
local op_constant_bank_define<const> = 16
local op_constant_upload_dma<const> = 17
local op_constant_upload_inline<const> = 18
local op_constant_upload_device<const> = 19
local op_begin_pass<const> = 32
local op_end_pass<const> = 33
local op_begin_draw<const> = 40
local op_bind_stream<const> = 41
local op_bind_constants<const> = 42
local op_bind_texture<const> = 43
local op_end_draw<const> = 44

local words_buffer_define<const> = 4
local words_buffer_upload_dma<const> = 5
local words_buffer_discard<const> = 2
local words_surface_define<const> = 4
local words_constant_bank_define<const> = 4
local words_constant_upload_dma<const> = 5
local words_constant_upload_device<const> = 6
local words_begin_pass<const> = 8
local words_end_pass<const> = 1
local words_begin_draw<const> = 9
local words_bind_stream<const> = 6
local words_bind_constants<const> = 5
local words_bind_texture<const> = 3
local words_end_draw<const> = 1
local words_buffer_upload_inline_min<const> = 4
local words_constant_upload_inline_min<const> = 4

local usage_vertex<const> = 1
local usage_index<const> = 2
local usage_constant<const> = 4
local surface_format_rgba8<const> = 0
local surface_format_depth16<const> = 1
local surface_usage_color<const> = 1
local surface_usage_depth<const> = 2
local surface_usage_texture<const> = 4
local usage_shift<const> = 8

local pass_color_clear<const> = 1
local pass_depth_clear<const> = 2
local pass_color_store<const> = 4
local pass_depth_store<const> = 8

local blend_none<const> = 0
local blend_alpha<const> = 1
local blend_add<const> = 2
local depth_none<const> = 0
local depth_less<const> = 1
local depth_lequal<const> = 2
local cull_none<const> = 0
local cull_back<const> = 1
local cull_front<const> = 2
local pipe_depth_write<const> = 0x00001000
local pipe_color_write_rgba<const> = 0x000f0000

local prim_triangles<const> = 0
local prim_triangle_strip<const> = 1
local prim_lines<const> = 2
local prim_points<const> = 3
local index_none<const> = 0
local index_u16<const> = 1
local index_u32<const> = 2
local resource_none<const> = 0xffffffff

local layout_v2_c4<const> = 0
local layout_v2_t2_c4<const> = 1
local layout_v3_c4<const> = 2
local layout_v3_t2_c4<const> = 3
local layout_v3_n3_c4<const> = 4
local layout_v3_n3_t2_c4<const> = 5
local layout_v3_n3_t2_c4_j4_w4<const> = 6
local layout_v3_dm3<const> = 8
local layout_i_affine2_trect_c4<const> = 32
local layout_i_mat4_c4<const> = 33

local shader_v2_c4<const> = 0
local shader_v2_t2_c4<const> = 1
local shader_v3_c4_c0<const> = 2
local shader_v3_t2_c4_c0<const> = 3
local shader_v3_n3_t2_c4_c0_c1<const> = 4
local shader_v3_n3_t2_c4_j4_w4_c0_c1<const> = 5
local shader_v2_t2_c4_i_affine2<const> = 6
local shader_v3_c4_i_mat4<const> = 7
local shader_variant_mask<const> = 0x00000007
local shader_flag_morph<const> = 0x00000008
local shader_flag_t1<const> = 0x00000010

local constant_source_xf_q16<const> = 0
local constant_source_lpu_raw<const> = 1
local constant_source_mfu_q16<const> = 2
local constant_source_jtu_q16<const> = 3

local surface_system<const> = 0
local surface_primary<const> = 1
local surface_secondary<const> = 2

struct rpu_buffer_define_packet
	header: word
	op: word
	buffer_id: word
	byte_length: word
	usage: word
end

struct rpu_buffer_upload_dma_packet
	header: word
	op: word
	buffer_id: word
	dst_byte_offset: word
	src_addr: word
	byte_length: word
end

struct rpu_buffer_upload_inline_header
	header: word
	op: word
	buffer_id: word
	dst_byte_offset: word
	byte_length: word
end

struct rpu_buffer_discard_packet
	header: word
	op: word
	buffer_id: word
end

struct rpu_surface_define_packet
	header: word
	op: word
	surface_id: word
	size: word
	format_usage: word
end

struct rpu_constant_bank_define_packet
	header: word
	op: word
	bank_id: word
	first_word: word
	word_count: word
end

struct rpu_constant_upload_dma_packet
	header: word
	op: word
	bank_id: word
	dst_word_offset: word
	src_addr: word
	word_count: word
end

struct rpu_constant_upload_inline_header
	header: word
	op: word
	bank_id: word
	dst_word_offset: word
	word_count: word
end

struct rpu_constant_upload_device_packet
	header: word
	op: word
	bank_id: word
	dst_word_offset: word
	source: word
	source_word_offset: word
	word_count: word
end

struct rpu_begin_pass_packet
	header: word
	op: word
	color_surface_id: word
	depth_surface_id: word
	viewport_xy: word
	viewport_wh: word
	pass_ops: word
	clear_color: word
	clear_depth_word: word
end

struct rpu_end_pass_packet
	header: word
	op: word
end

struct rpu_begin_draw_packet
	header: word
	op: word
	shader_variant: word
	primitive_index_type: word
	pipeline_word: word
	vertex_count: word
	instance_count: word
	index_buffer_id: word
	index_byte_offset: word
	index_count: word
end

struct rpu_bind_stream_packet
	header: word
	op: word
	stream_slot: word
	layout_id: word
	buffer_id: word
	byte_offset: word
	step_rate: word
end

struct rpu_bind_constants_packet
	header: word
	op: word
	binding_slot: word
	bank_id: word
	first_word: word
	word_count: word
end

struct rpu_bind_texture_packet
	header: word
	op: word
	texture_slot: word
	surface_id: word
end

struct rpu_end_draw_packet
	header: word
	op: word
end

function vdp_rpu.buffer_define(buffer_id, byte_length, usage)
	local packet<const>: *rpu_buffer_define_packet = vdp_stream_claim(sizeof(rpu_buffer_define_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_buffer_define << 16)
	packet->op = op_buffer_define
	packet->buffer_id = buffer_id
	packet->byte_length = byte_length
	packet->usage = usage
end

function vdp_rpu.buffer_upload_dma(buffer_id, dst_byte_offset, src_addr, byte_length)
	local packet<const>: *rpu_buffer_upload_dma_packet = vdp_stream_claim(sizeof(rpu_buffer_upload_dma_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_buffer_upload_dma << 16)
	packet->op = op_buffer_upload_dma
	packet->buffer_id = buffer_id
	packet->dst_byte_offset = dst_byte_offset
	packet->src_addr = src_addr
	packet->byte_length = byte_length
end

function vdp_rpu.buffer_upload_inline(buffer_id, dst_byte_offset, byte_length, ...)
	local data_words<const> = (byte_length + 3) >> 2
	local base<const> = vdp_stream_claim((sizeof(rpu_buffer_upload_inline_header) // sys_vdp_arg_stride) + data_words)
	local packet<const>: *rpu_buffer_upload_inline_header = base
	local data<const>: *word = base + sizeof(rpu_buffer_upload_inline_header)
	packet->header = packet_kind | ((words_buffer_upload_inline_min + data_words) << 16)
	packet->op = op_buffer_upload_inline
	packet->buffer_id = buffer_id
	packet->dst_byte_offset = dst_byte_offset
	packet->byte_length = byte_length
	local index = 0
	while index < data_words do
		data[index] = select(index + 1, ...)
		index = index + 1
	end
end

function vdp_rpu.buffer_discard(buffer_id)
	local packet<const>: *rpu_buffer_discard_packet = vdp_stream_claim(sizeof(rpu_buffer_discard_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_buffer_discard << 16)
	packet->op = op_buffer_discard
	packet->buffer_id = buffer_id
end

function vdp_rpu.surface_define(surface_id, width, height, format_usage)
	local packet<const>: *rpu_surface_define_packet = vdp_stream_claim(sizeof(rpu_surface_define_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_surface_define << 16)
	packet->op = op_surface_define
	packet->surface_id = surface_id
	packet->size = numeric.pack_low_high(width, height)
	packet->format_usage = format_usage
end

function vdp_rpu.constant_bank_define(bank_id, first_word, word_count)
	local packet<const>: *rpu_constant_bank_define_packet = vdp_stream_claim(sizeof(rpu_constant_bank_define_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_constant_bank_define << 16)
	packet->op = op_constant_bank_define
	packet->bank_id = bank_id
	packet->first_word = first_word
	packet->word_count = word_count
end

function vdp_rpu.constant_upload_dma(bank_id, dst_word_offset, src_addr, word_count)
	local packet<const>: *rpu_constant_upload_dma_packet = vdp_stream_claim(sizeof(rpu_constant_upload_dma_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_constant_upload_dma << 16)
	packet->op = op_constant_upload_dma
	packet->bank_id = bank_id
	packet->dst_word_offset = dst_word_offset
	packet->src_addr = src_addr
	packet->word_count = word_count
end

function vdp_rpu.constant_upload_inline(bank_id, dst_word_offset, word_count, ...)
	local base<const> = vdp_stream_claim((sizeof(rpu_constant_upload_inline_header) // sys_vdp_arg_stride) + word_count)
	local packet<const>: *rpu_constant_upload_inline_header = base
	local data<const>: *word = base + sizeof(rpu_constant_upload_inline_header)
	packet->header = packet_kind | ((words_constant_upload_inline_min + word_count) << 16)
	packet->op = op_constant_upload_inline
	packet->bank_id = bank_id
	packet->dst_word_offset = dst_word_offset
	packet->word_count = word_count
	local index = 0
	while index < word_count do
		data[index] = select(index + 1, ...)
		index = index + 1
	end
end

function vdp_rpu.constant_upload_device(bank_id, dst_word_offset, source, source_word_offset, word_count)
	local packet<const>: *rpu_constant_upload_device_packet = vdp_stream_claim(sizeof(rpu_constant_upload_device_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_constant_upload_device << 16)
	packet->op = op_constant_upload_device
	packet->bank_id = bank_id
	packet->dst_word_offset = dst_word_offset
	packet->source = source
	packet->source_word_offset = source_word_offset
	packet->word_count = word_count
end

function vdp_rpu.begin_pass(color_surface_id, depth_surface_id, viewport_x, viewport_y, viewport_w, viewport_h, pass_ops, clear_color, clear_depth_word)
	local packet<const>: *rpu_begin_pass_packet = vdp_stream_claim(sizeof(rpu_begin_pass_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_begin_pass << 16)
	packet->op = op_begin_pass
	packet->color_surface_id = color_surface_id
	packet->depth_surface_id = depth_surface_id
	packet->viewport_xy = numeric.pack_low_high(viewport_x, viewport_y)
	packet->viewport_wh = numeric.pack_low_high(viewport_w, viewport_h)
	packet->pass_ops = pass_ops
	packet->clear_color = clear_color
	packet->clear_depth_word = clear_depth_word
end

function vdp_rpu.end_pass()
	local packet<const>: *rpu_end_pass_packet = vdp_stream_claim(sizeof(rpu_end_pass_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_end_pass << 16)
	packet->op = op_end_pass
end

function vdp_rpu.begin_draw(shader_variant, primitive_index_type, pipeline_word, vertex_count, instance_count, index_buffer_id, index_byte_offset, index_count)
	local packet<const>: *rpu_begin_draw_packet = vdp_stream_claim(sizeof(rpu_begin_draw_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_begin_draw << 16)
	packet->op = op_begin_draw
	packet->shader_variant = shader_variant
	packet->primitive_index_type = primitive_index_type
	packet->pipeline_word = pipeline_word
	packet->vertex_count = vertex_count
	packet->instance_count = instance_count
	packet->index_buffer_id = index_buffer_id
	packet->index_byte_offset = index_byte_offset
	packet->index_count = index_count
end

function vdp_rpu.bind_stream(stream_slot, layout_id, buffer_id, byte_offset, step_rate)
	local packet<const>: *rpu_bind_stream_packet = vdp_stream_claim(sizeof(rpu_bind_stream_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_bind_stream << 16)
	packet->op = op_bind_stream
	packet->stream_slot = stream_slot
	packet->layout_id = layout_id
	packet->buffer_id = buffer_id
	packet->byte_offset = byte_offset
	packet->step_rate = step_rate
end

function vdp_rpu.bind_constants(binding_slot, bank_id, first_word, word_count)
	local packet<const>: *rpu_bind_constants_packet = vdp_stream_claim(sizeof(rpu_bind_constants_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_bind_constants << 16)
	packet->op = op_bind_constants
	packet->binding_slot = binding_slot
	packet->bank_id = bank_id
	packet->first_word = first_word
	packet->word_count = word_count
end

function vdp_rpu.bind_texture(texture_slot, surface_id)
	local packet<const>: *rpu_bind_texture_packet = vdp_stream_claim(sizeof(rpu_bind_texture_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_bind_texture << 16)
	packet->op = op_bind_texture
	packet->texture_slot = texture_slot
	packet->surface_id = surface_id
end

function vdp_rpu.end_draw()
	local packet<const>: *rpu_end_draw_packet = vdp_stream_claim(sizeof(rpu_end_draw_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_end_draw << 16)
	packet->op = op_end_draw
end


vdp_rpu.usage_vertex = usage_vertex
vdp_rpu.usage_index = usage_index
vdp_rpu.usage_constant = usage_constant
vdp_rpu.surface_format_rgba8 = surface_format_rgba8
vdp_rpu.surface_format_depth16 = surface_format_depth16
vdp_rpu.surface_usage_color = surface_usage_color
vdp_rpu.surface_usage_depth = surface_usage_depth
vdp_rpu.surface_usage_texture = surface_usage_texture
vdp_rpu.usage_shift = usage_shift
vdp_rpu.pass_color_clear = pass_color_clear
vdp_rpu.pass_depth_clear = pass_depth_clear
vdp_rpu.pass_color_store = pass_color_store
vdp_rpu.pass_depth_store = pass_depth_store
vdp_rpu.blend_none = blend_none
vdp_rpu.blend_alpha = blend_alpha
vdp_rpu.blend_add = blend_add
vdp_rpu.depth_none = depth_none
vdp_rpu.depth_less = depth_less
vdp_rpu.depth_lequal = depth_lequal
vdp_rpu.cull_none = cull_none
vdp_rpu.cull_back = cull_back
vdp_rpu.cull_front = cull_front
vdp_rpu.pipe_depth_write = pipe_depth_write
vdp_rpu.pipe_color_write_rgba = pipe_color_write_rgba
vdp_rpu.prim_triangles = prim_triangles
vdp_rpu.prim_triangle_strip = prim_triangle_strip
vdp_rpu.prim_lines = prim_lines
vdp_rpu.prim_points = prim_points
vdp_rpu.index_none = index_none
vdp_rpu.index_u16 = index_u16
vdp_rpu.index_u32 = index_u32
vdp_rpu.resource_none = resource_none
vdp_rpu.layout_v2_c4 = layout_v2_c4
vdp_rpu.layout_v2_t2_c4 = layout_v2_t2_c4
vdp_rpu.layout_v3_c4 = layout_v3_c4
vdp_rpu.layout_v3_t2_c4 = layout_v3_t2_c4
vdp_rpu.layout_v3_n3_c4 = layout_v3_n3_c4
vdp_rpu.layout_v3_n3_t2_c4 = layout_v3_n3_t2_c4
vdp_rpu.layout_v3_n3_t2_c4_j4_w4 = layout_v3_n3_t2_c4_j4_w4
vdp_rpu.layout_v3_dm3 = layout_v3_dm3
vdp_rpu.layout_i_affine2_trect_c4 = layout_i_affine2_trect_c4
vdp_rpu.layout_i_mat4_c4 = layout_i_mat4_c4
vdp_rpu.shader_v2_c4 = shader_v2_c4
vdp_rpu.shader_v2_t2_c4 = shader_v2_t2_c4
vdp_rpu.shader_v3_c4_c0 = shader_v3_c4_c0
vdp_rpu.shader_v3_t2_c4_c0 = shader_v3_t2_c4_c0
vdp_rpu.shader_v3_n3_t2_c4_c0_c1 = shader_v3_n3_t2_c4_c0_c1
vdp_rpu.shader_v3_n3_t2_c4_j4_w4_c0_c1 = shader_v3_n3_t2_c4_j4_w4_c0_c1
vdp_rpu.shader_v2_t2_c4_i_affine2 = shader_v2_t2_c4_i_affine2
vdp_rpu.shader_v3_c4_i_mat4 = shader_v3_c4_i_mat4
vdp_rpu.shader_variant_mask = shader_variant_mask
vdp_rpu.shader_flag_morph = shader_flag_morph
vdp_rpu.shader_flag_t1 = shader_flag_t1
vdp_rpu.constant_source_xf_q16 = constant_source_xf_q16
vdp_rpu.constant_source_lpu_raw = constant_source_lpu_raw
vdp_rpu.constant_source_mfu_q16 = constant_source_mfu_q16
vdp_rpu.constant_source_jtu_q16 = constant_source_jtu_q16
vdp_rpu.surface_system = surface_system
vdp_rpu.surface_primary = surface_primary
vdp_rpu.surface_secondary = surface_secondary

return vdp_rpu
