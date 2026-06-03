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
local op_exec_pass_list<const> = 64
local op_seal_frame<const> = 65
local words_exec_pass_list<const> = 2
local words_seal_frame<const> = 1

local resource_none<const> = 0xffffffff
local surface_format_rgba8<const> = 0
local surface_format_depth16<const> = 1
local surface_desc_bytes<const> = 16
local stream_desc_bytes<const> = 12
local constant_desc_bytes<const> = 12
local texture_desc_bytes<const> = 8
local draw_desc_bytes<const> = 44
local pass_desc_bytes<const> = 36

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

struct rpu_exec_pass_list_packet
	header: word
	op: word
	pass_desc_addr: word
end

struct rpu_seal_frame_packet
	header: word
	op: word
end

function vdp_rpu.exec_pass_list(pass_count, pass_desc_addr)
	local packet<const>: *rpu_exec_pass_list_packet = vdp_stream_claim(sizeof(rpu_exec_pass_list_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_exec_pass_list << 16)
	packet->op = op_exec_pass_list | (pass_count << 8)
	packet->pass_desc_addr = pass_desc_addr
end

function vdp_rpu.seal_frame()
	local packet<const>: *rpu_seal_frame_packet = vdp_stream_claim(sizeof(rpu_seal_frame_packet) // sys_vdp_arg_stride)
	packet->header = packet_kind | (words_seal_frame << 16)
	packet->op = op_seal_frame
end

vdp_rpu.packet_kind = packet_kind
vdp_rpu.op_exec_pass_list = op_exec_pass_list
vdp_rpu.op_seal_frame = op_seal_frame
vdp_rpu.words_exec_pass_list = words_exec_pass_list
vdp_rpu.words_seal_frame = words_seal_frame
vdp_rpu.resource_none = resource_none
vdp_rpu.surface_format_rgba8 = surface_format_rgba8
vdp_rpu.surface_format_depth16 = surface_format_depth16
vdp_rpu.surface_desc_bytes = surface_desc_bytes
vdp_rpu.stream_desc_bytes = stream_desc_bytes
vdp_rpu.constant_desc_bytes = constant_desc_bytes
vdp_rpu.texture_desc_bytes = texture_desc_bytes
vdp_rpu.draw_desc_bytes = draw_desc_bytes
vdp_rpu.pass_desc_bytes = pass_desc_bytes
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

return vdp_rpu
