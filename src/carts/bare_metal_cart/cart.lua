local numeric<const>          = require('bios/common/numeric')
local camobj<const>           = require('engine/camera_object')
local cam_view_terms<const>   = camobj.cam_view_terms
local cam_proj_terms<const>   = camobj.cam_proj_terms
local cam_screen_look<const>  = camobj.cam_screen_look
local cam_move<const>         = camobj.cam_move

local vdp_stream_base<const> = sys_vdp_stream_base
local vram_primary_slot_base<const> = sys_vram_primary_slot_base
local scratch_base<const> = sys_geo_scratch_base

local vdp_dither_register<const>: *word = sys_vdp_dither
local irq_flags_register<const>: *word = sys_irq_flags
local irq_ack_register<const>: *word = sys_irq_ack
local dma_src_register<const>: *word = sys_dma_src
local dma_dst_register<const>: *word = sys_dma_dst
local dma_len_register<const>: *word = sys_dma_len
local dma_ctrl_register<const>: *word = sys_dma_ctrl
local inp_player_register<const>: *word = sys_inp_player
local inp_action_register<const>: *word = sys_inp_action
local inp_bind_register<const>: *word = sys_inp_bind
local inp_ctrl_register<const>: *word = sys_inp_ctrl
local inp_query_register<const>: *word = sys_inp_query
local inp_status_register<const>: *word = sys_inp_status

local dma_ctrl_start<const> = 1
local irq_dma_done<const> = 0x01
local irq_dma_error<const> = 0x02
local irq_vblank<const> = 0x10

local atlas_width<const> = 16
local atlas_height<const> = 16
local atlas_bytes<const> = atlas_width * atlas_height * 4
local screen_width<const> = 256
local screen_height<const> = 212
local inv_half_screen_width<const> = 1.0 / 128.0
local inv_half_screen_height<const> = 1.0 / 106.0

struct bg_vertex
	xy: f32[2]
	color: word
end

struct quad_vertex
	xyzuv: f32[4]
	color: word
end

struct mat4_vertex
	pos: f32[3]
	color: word
end

struct mat4_instance
	mvp: f32[16]
	color: word
end

struct sprite_instance
	matrix: f32[11]
	color: word
end

struct mesh_vertex
	pos: f32[3]
	normal: f32[3]
	uv: f32[2]
	color: word
	joint: word
	weight: word
end

struct morph_vertex
	pos_delta: f32[3]
	normal_delta: f32[3]
end

struct q16_matrix
	m: word[16]
end

struct bm_rpu_buffer_define_packet
	header: word
	op: word
	buffer_id: word
	byte_length: word
	usage: word
end

struct bm_rpu_buffer_upload_dma_packet
	header: word
	op: word
	buffer_id: word
	dst_byte_offset: word
	src_addr: word
	byte_length: word
end

struct bm_rpu_surface_define_packet
	header: word
	op: word
	surface_id: word
	size: word
	format_usage: word
end

struct bm_rpu_constant_bank_define_packet
	header: word
	op: word
	bank_id: word
	first_word: word
	word_count: word
end

struct bm_rpu_constant_upload_device_packet
	header: word
	op: word
	bank_id: word
	dst_word_offset: word
	source: word
	source_word_offset: word
	word_count: word
end

struct bm_rpu_begin_pass_packet
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

struct bm_rpu_end_pass_packet
	header: word
	op: word
end

struct bm_rpu_begin_draw_packet
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

struct bm_rpu_bind_stream_packet
	header: word
	op: word
	stream_slot: word
	layout_id: word
	buffer_id: word
	byte_offset: word
	step_rate: word
end

struct bm_rpu_bind_constants_packet
	header: word
	op: word
	binding_slot: word
	bank_id: word
	first_word: word
	word_count: word
end

struct bm_rpu_bind_texture_packet
	header: word
	op: word
	texture_slot: word
	surface_id: word
end

struct bm_rpu_end_draw_packet
	header: word
	op: word
end

struct bm_xf_matrix_packet_header
	header: word
	matrix_word_offset: word
end

struct bm_lpu_register_packet_header
	header: word
	first_register: word
end

struct bm_jtu_matrix_packet_header
	header: word
	matrix_word_offset: word
end

struct bm_mfu_register_packet_header
	header: word
	first_register: word
end

struct bm_surface_define_desc
	surface_id: word
	size: word
	format_usage: word
end

struct bm_buffer_define_desc
	buffer_id: word
	byte_length: word
	usage: word
	upload_src_addr: word
	upload_byte_length: word
end

struct bm_buffer_upload_desc
	buffer_id: word
	dst_byte_offset: word
	src_addr: word
	byte_length: word
end

struct bm_matrix_upload_desc
	packet_kind: word
	matrix_word_count: word
	matrix_index: word
	src_addr: word
end

struct bm_register_upload_desc
	packet_kind: word
	first_register: word
	src_addr: word
	word_count: word
end

struct bm_constant_bank_desc
	bank_id: word
	first_word: word
	word_count: word
end

struct bm_constant_device_upload_desc
	bank_id: word
	dst_word_offset: word
	source: word
	source_word_offset: word
	word_count: word
end

struct bm_pass_desc
	color_surface_id: word
	depth_surface_id: word
	viewport_xy: word
	viewport_wh: word
	pass_ops: word
	clear_color: word
	clear_depth_word: word
	first_draw: word
	draw_count: word
end

struct bm_draw_desc
	shader_variant: word
	primitive_index_type: word
	pipeline_word: word
	vertex_count: word
	instance_count: word
	index_buffer_id: word
	index_byte_offset: word
	index_count: word
	stream_first: word
	stream_count: word
	constant_first: word
	constant_count: word
	sampled_surface_first: word
	sampled_surface_count: word
end

struct bm_stream_bind_desc
	stream_slot: word
	layout_id: word
	buffer_id: word
	byte_offset: word
	step_rate: word
end

struct bm_constant_bind_desc
	binding_slot: word
	bank_id: word
	first_word: word
	word_count: word
end

struct bm_sampled_surface_bind_desc
	texture_slot: word
	surface_id: word
end

local quad_buffer<const> = 1
local background_buffer<const> = 2
local mesh_buffer<const> = 3
local instance_buffer<const> = 4
local mesh_index_buffer<const> = 5
local vector_buffer<const> = 6
local mat4_vertex_buffer<const> = 7
local mat4_instance_buffer<const> = 8
local morph_buffer<const> = 9
local scene_color_surface<const> = 4
local scene_depth_surface<const> = 5
local atlas_surface<const> = sys_rpu_surface_primary
local quad_vertex_count<const> = 4
local quad_vertex_stride<const> = sizeof(quad_vertex)
local quad_vertex_bytes<const> = quad_vertex_count * quad_vertex_stride
local background_vertex_count<const> = 12
local background_vertex_stride<const> = sizeof(bg_vertex)
local background_vertex_bytes<const> = background_vertex_count * background_vertex_stride
local vector_vertex_count<const> = 24
local vector_vertex_stride<const> = sizeof(bg_vertex)
local vector_vertex_bytes<const> = vector_vertex_count * vector_vertex_stride
local mat4_vertex_count<const> = 3
local mat4_vertex_stride<const> = sizeof(mat4_vertex)
local mat4_vertex_bytes<const> = mat4_vertex_count * mat4_vertex_stride
local mat4_instance_count<const> = 2
local mat4_instance_stride<const> = sizeof(mat4_instance)
local mat4_instance_bytes<const> = mat4_instance_count * mat4_instance_stride
local mesh_vertex_count<const> = 24
local mesh_vertex_stride<const> = sizeof(mesh_vertex)
local mesh_vertex_bytes<const> = mesh_vertex_count * mesh_vertex_stride
local mesh_index_count<const> = 24
local mesh_index_bytes<const> = mesh_index_count * 2
local sprite_instance_count<const> = 5
local present_instance_count<const> = 1
local instance_count<const> = sprite_instance_count + present_instance_count
local instance_stride<const> = sizeof(sprite_instance)
local instance_bytes<const> = instance_count * instance_stride
local present_instance_offset<const> = sprite_instance_count * instance_stride
local c0_words<const> = 16
local c1_words<const> = 68
local joint_words<const> = 384
local mfu_words<const> = 1
local c0_bytes<const> = c0_words * 4
local c1_bytes<const> = c1_words * 4
local joint_matrix_bytes<const> = sizeof(q16_matrix)
local morph_vertex_stride<const> = sizeof(morph_vertex)
local morph_vertex_bytes<const> = mesh_vertex_count * morph_vertex_stride

local quad_vertex_addr<const> = scratch_base + atlas_bytes
local background_vertex_addr<const> = quad_vertex_addr + quad_vertex_bytes
local vector_vertex_addr<const> = background_vertex_addr + background_vertex_bytes
local mat4_vertex_addr<const> = vector_vertex_addr + vector_vertex_bytes
local mat4_instance_addr<const> = mat4_vertex_addr + mat4_vertex_bytes
local mesh_vertex_addr<const> = mat4_instance_addr + mat4_instance_bytes
local mesh_index_addr<const> = mesh_vertex_addr + mesh_vertex_bytes
local instance_addr<const> = mesh_index_addr + mesh_index_bytes
local c0_addr<const> = instance_addr + instance_bytes
local c1_addr<const> = c0_addr + c0_bytes
local joint0_addr<const> = c1_addr + c1_bytes
local joint1_addr<const> = joint0_addr + joint_matrix_bytes
local mfu_addr<const> = joint1_addr + joint_matrix_bytes
local morph_vertex_addr<const> = mfu_addr + mfu_words * 4
local surface_desc_count<const> = 3
local buffer_desc_count<const> = 9
local matrix_upload_desc_count<const> = 3
local register_upload_desc_count<const> = 2
local frame_buffer_upload_desc_count<const> = 4
local constant_bank_desc_count<const> = 3
local constant_device_upload_desc_count<const> = 4
local pass_desc_count<const> = 2
local draw_desc_count<const> = 9
local stream_bind_desc_count<const> = 13
local constant_bind_desc_count<const> = 4
local sampled_surface_bind_desc_count<const> = 4
local scene_draw_first<const> = 0
local scene_draw_count<const> = 8
local present_draw_first<const> = 8
local present_draw_count<const> = 1
local surface_desc_addr<const> = morph_vertex_addr + morph_vertex_bytes
local buffer_desc_addr<const> = surface_desc_addr + surface_desc_count * sizeof(bm_surface_define_desc)
local matrix_upload_desc_addr<const> = buffer_desc_addr + buffer_desc_count * sizeof(bm_buffer_define_desc)
local register_upload_desc_addr<const> = matrix_upload_desc_addr + matrix_upload_desc_count * sizeof(bm_matrix_upload_desc)
local frame_buffer_upload_desc_addr<const> = register_upload_desc_addr + register_upload_desc_count * sizeof(bm_register_upload_desc)
local constant_bank_desc_addr<const> = frame_buffer_upload_desc_addr + frame_buffer_upload_desc_count * sizeof(bm_buffer_upload_desc)
local constant_device_upload_desc_addr<const> = constant_bank_desc_addr + constant_bank_desc_count * sizeof(bm_constant_bank_desc)
local pass_desc_addr<const> = constant_device_upload_desc_addr + constant_device_upload_desc_count * sizeof(bm_constant_device_upload_desc)
local draw_desc_addr<const> = pass_desc_addr + pass_desc_count * sizeof(bm_pass_desc)
local stream_bind_desc_addr<const> = draw_desc_addr + draw_desc_count * sizeof(bm_draw_desc)
local constant_bind_desc_addr<const> = stream_bind_desc_addr + stream_bind_desc_count * sizeof(bm_stream_bind_desc)
local sampled_surface_bind_desc_addr<const> = constant_bind_desc_addr + constant_bind_desc_count * sizeof(bm_constant_bind_desc)
local mesh_matrix_index<const> = 2
local mesh_joint_matrix_index<const> = 1

local white<const> = 0xffffffff
local othercolor<const> = 0x00ffffff
local q16_one<const> = numeric.q16(1.0)
local sky_top<const> = 0xff071a3a
local sky_horizon<const> = 0xff071a3a
local ground_far<const> = 0xff071a3a
local ground_near<const> = 0xff071a3a
local vector_tint<const> = 0xfffff2a6
local mat4_tint_a<const> = 0xff001dc4
local mat4_tint_b<const> = 0xff48a6ff
local sprite_tint<const> = 0xffffffff
local parallax_far_tint<const> = 0xff00ffff
local parallax_near_tint<const> = 0xffffff00
local billboard_tint_a<const> = white
local billboard_tint_b<const> = othercolor
local mesh_tint<const> = white
local mesh_joint_word<const> = 0x00000001
local mesh_weight_word<const> = 0x000000ff

local rpu_surface_rgba_texture<const> = sys_rpu_surface_format_rgba8 | (sys_rpu_surface_usage_texture << 8)
local rpu_surface_rgba_color_texture<const> = sys_rpu_surface_format_rgba8 | ((sys_rpu_surface_usage_color | sys_rpu_surface_usage_texture) << 8)
local rpu_surface_depth<const> = sys_rpu_surface_format_depth16 | (sys_rpu_surface_usage_depth << 8)
local rpu_primitive_triangles<const> = sys_rpu_prim_triangles | (sys_rpu_index_none << 8)
local rpu_primitive_triangle_strip<const> = sys_rpu_prim_triangle_strip | (sys_rpu_index_none << 8)
local rpu_primitive_lines<const> = sys_rpu_prim_lines | (sys_rpu_index_none << 8)
local rpu_primitive_points<const> = sys_rpu_prim_points | (sys_rpu_index_none << 8)
local rpu_primitive_indexed_triangles<const> = sys_rpu_prim_triangles | (sys_rpu_index_u16 << 8)
local rpu_pipeline_opaque<const> = sys_rpu_blend_none | (sys_rpu_depth_none << 4) | (sys_rpu_cull_none << 8) | sys_rpu_pipe_color_write_rgba
local rpu_pipeline_depth_opaque<const> = sys_rpu_blend_none | (sys_rpu_depth_lequal << 4) | (sys_rpu_cull_none << 8) | sys_rpu_pipe_depth_write | sys_rpu_pipe_color_write_rgba
local rpu_pipeline_depth_alpha<const> = sys_rpu_blend_alpha | (sys_rpu_depth_lequal << 4) | (sys_rpu_cull_none << 8) | sys_rpu_pipe_depth_write | sys_rpu_pipe_color_write_rgba

local vdp_stream_cursor
vdp_stream_cursor = vdp_stream_base

local frame = 0
local sprite_x = 112
local sprite_y = 92
local sprite_step<const> = 4
local sprite_direction = 1

-- Free-fly camera: start slightly back with a small downward pitch (≈0.1 rad).
-- Mirrors a CameraObject spawned at (0, 0.1, 3) in world.ts; id auto-generated by cam_new.
local free_cam<const>     = camobj.cam_new(0.0, 0.1, 3.0, 60.0, 256.0/212.0, 0.1, 100.0)
free_cam.qx = 0.04998;  free_cam.qy = 0.0;  free_cam.qz = 0.0;  free_cam.qw = 0.99875

-- Side camera: fixed viewpoint to the right of the scene, looking at the origin.
-- Demonstrates the multi-camera / active-camera switching pattern from world.ts.
local side_cam<const>     = camobj.cam_new(5.0, 1.5, 0.0, 45.0, 256.0/212.0, 0.1, 100.0)
camobj.cam_look_at(side_cam, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0)

-- Active camera id — mirrors world._activeCameraId (Identifier = null in TypeScript).
-- nil = no camera selected yet; default lookup resolves to free_cam.
local active_cam_id = nil

local submit_current_stream<const> = function()
	if vdp_stream_cursor ~= vdp_stream_base then
		local used_bytes<const> = vdp_stream_cursor - vdp_stream_base
		*dma_src_register = vdp_stream_base
		*dma_dst_register = sys_vdp_fifo
		*dma_len_register = used_bytes
		*dma_ctrl_register = dma_ctrl_start
		vdp_stream_cursor = vdp_stream_base
	end
end

local wait_interrupt<const> = function(flag_mask)
	local flags = 0
	repeat
		halt_until_irq
		flags = *irq_flags_register
		*irq_ack_register = flags
	until (flags & flag_mask) ~= 0
end

local build_lua_atlas<const> = function()
	local px = 0
	local py = 0
	local pixels<const>: *word = scratch_base
	local wi = 0
	while py < atlas_height do
		px = 0
		while px < atlas_width do
			local dx = px - 7
			if dx < 0 then
				dx = -dx
			end
			local dy = py - 7
			if dy < 0 then
				dy = -dy
			end
			local color = 0xff071a3a
			if py >= 5 then
				color = 0xff124b7d
			end
			if py >= 11 then
				color = 0xff321a3c
			end
			if ((px * 3 + py * 5) & 15) == 0 then
				color = 0xfffff2a6
			end
			local distance<const> = dx + dy
			if distance <= 8 then
				color = 0xff18121c
			end
			if distance <= 6 then
				color = 0xffe64824
			end
			if distance <= 3 and py <= 7 then
				color = 0xffffdc62
			end
			if py >= 10 and dx <= 2 then
				color = 0xff2de6ff
			end
			pixels[wi] = color
			wi = wi + 1
			px = px + 1
		end
		py = py + 1
	end
end

local upload_atlas_to_vram<const> = function()
	*dma_src_register = scratch_base
	*dma_dst_register = vram_primary_slot_base
	*dma_len_register = atlas_bytes
	*dma_ctrl_register = dma_ctrl_start
	wait_interrupt(irq_dma_done | irq_dma_error)
end

local write_background_vertices<const> = function()
	local vertices<const>: *bg_vertex[background_vertex_count] = background_vertex_addr
	vertices[0].xy[0] = -1.0
	vertices[0].xy[1] = 1.0
	vertices[0].color = sky_top
	vertices[1].xy[0] = 1.0
	vertices[1].xy[1] = 1.0
	vertices[1].color = sky_top
	vertices[2].xy[0] = -1.0
	vertices[2].xy[1] = -0.24
	vertices[2].color = sky_horizon
	vertices[3].xy[0] = 1.0
	vertices[3].xy[1] = 1.0
	vertices[3].color = sky_top
	vertices[4].xy[0] = 1.0
	vertices[4].xy[1] = -0.24
	vertices[4].color = sky_horizon
	vertices[5].xy[0] = -1.0
	vertices[5].xy[1] = -0.24
	vertices[5].color = sky_horizon
	vertices[6].xy[0] = -1.0
	vertices[6].xy[1] = -0.24
	vertices[6].color = ground_far
	vertices[7].xy[0] = 1.0
	vertices[7].xy[1] = -0.24
	vertices[7].color = ground_far
	vertices[8].xy[0] = -1.0
	vertices[8].xy[1] = -1.0
	vertices[8].color = ground_near
	vertices[9].xy[0] = 1.0
	vertices[9].xy[1] = -0.24
	vertices[9].color = ground_far
	vertices[10].xy[0] = 1.0
	vertices[10].xy[1] = -1.0
	vertices[10].color = ground_near
	vertices[11].xy[0] = -1.0
	vertices[11].xy[1] = -1.0
	vertices[11].color = ground_near
end

local write_quad_vertices<const> = function()
	local vertices<const>: *quad_vertex[quad_vertex_count] = quad_vertex_addr
	vertices[0].xyzuv[0] = 0.0
	vertices[0].xyzuv[1] = 0.0
	vertices[0].xyzuv[2] = 0.0
	vertices[0].xyzuv[3] = 0.0
	vertices[0].color = white
	vertices[1].xyzuv[0] = 1.0
	vertices[1].xyzuv[1] = 0.0
	vertices[1].xyzuv[2] = 1.0
	vertices[1].xyzuv[3] = 0.0
	vertices[1].color = white
	vertices[2].xyzuv[0] = 0.0
	vertices[2].xyzuv[1] = 1.0
	vertices[2].xyzuv[2] = 0.0
	vertices[2].xyzuv[3] = 1.0
	vertices[2].color = white
	vertices[3].xyzuv[0] = 1.0
	vertices[3].xyzuv[1] = 1.0
	vertices[3].xyzuv[2] = 1.0
	vertices[3].xyzuv[3] = 1.0
	vertices[3].color = white
end

local write_vector_vertices<const> = function()
	local vertices<const>: *bg_vertex[vector_vertex_count] = vector_vertex_addr
	vertices[0].xy[0] = -0.88
	vertices[0].xy[1] = -0.94
	vertices[0].color = vector_tint
	vertices[1].xy[0] = 0.88
	vertices[1].xy[1] = -0.94
	vertices[1].color = vector_tint
	vertices[2].xy[0] = -0.88
	vertices[2].xy[1] = -0.90
	vertices[2].color = vector_tint
	vertices[3].xy[0] = 0.88
	vertices[3].xy[1] = -0.94
	vertices[3].color = vector_tint
	vertices[4].xy[0] = 0.88
	vertices[4].xy[1] = -0.90
	vertices[4].color = vector_tint
	vertices[5].xy[0] = -0.88
	vertices[5].xy[1] = -0.90
	vertices[5].color = vector_tint
	vertices[6].xy[0] = -0.72
	vertices[6].xy[1] = -0.78
	vertices[6].color = vector_tint
	vertices[7].xy[0] = 0.72
	vertices[7].xy[1] = -0.78
	vertices[7].color = vector_tint
	vertices[8].xy[0] = -0.72
	vertices[8].xy[1] = -0.74
	vertices[8].color = vector_tint
	vertices[9].xy[0] = 0.72
	vertices[9].xy[1] = -0.78
	vertices[9].color = vector_tint
	vertices[10].xy[0] = 0.72
	vertices[10].xy[1] = -0.74
	vertices[10].color = vector_tint
	vertices[11].xy[0] = -0.72
	vertices[11].xy[1] = -0.74
	vertices[11].color = vector_tint
	vertices[12].xy[0] = -0.92
	vertices[12].xy[1] = -0.62
	vertices[12].color = vector_tint
	vertices[13].xy[0] = -0.86
	vertices[13].xy[1] = -0.62
	vertices[13].color = vector_tint
	vertices[14].xy[0] = -0.92
	vertices[14].xy[1] = -0.56
	vertices[14].color = vector_tint
	vertices[15].xy[0] = -0.86
	vertices[15].xy[1] = -0.62
	vertices[15].color = vector_tint
	vertices[16].xy[0] = -0.86
	vertices[16].xy[1] = -0.56
	vertices[16].color = vector_tint
	vertices[17].xy[0] = -0.92
	vertices[17].xy[1] = -0.56
	vertices[17].color = vector_tint
	vertices[18].xy[0] = 0.86
	vertices[18].xy[1] = -0.62
	vertices[18].color = vector_tint
	vertices[19].xy[0] = 0.92
	vertices[19].xy[1] = -0.62
	vertices[19].color = vector_tint
	vertices[20].xy[0] = 0.86
	vertices[20].xy[1] = -0.56
	vertices[20].color = vector_tint
	vertices[21].xy[0] = 0.92
	vertices[21].xy[1] = -0.62
	vertices[21].color = vector_tint
	vertices[22].xy[0] = 0.92
	vertices[22].xy[1] = -0.56
	vertices[22].color = vector_tint
	vertices[23].xy[0] = 0.86
	vertices[23].xy[1] = -0.56
	vertices[23].color = vector_tint
end

local write_mat4_vertices<const> = function()
	local vertices<const>: *mat4_vertex[mat4_vertex_count] = mat4_vertex_addr
	vertices[0].pos[0] = 0.0
	vertices[0].pos[1] = 0.12
	vertices[0].pos[2] = 0.0
	vertices[0].color = white
	vertices[1].pos[0] = -0.10
	vertices[1].pos[1] = -0.08
	vertices[1].pos[2] = 0.0
	vertices[1].color = white
	vertices[2].pos[0] = 0.10
	vertices[2].pos[1] = -0.08
	vertices[2].pos[2] = 0.0
	vertices[2].color = white
end

local write_mesh_vertices<const> = function(morph_a, morph_b)
	local top_y<const> = 0.62 + morph_a
	local bottom_y<const> = -0.62 - morph_b
	local radius_x<const> = 0.56 + morph_b
	local radius_z<const> = 0.56 + morph_a
	local mesh_uv<const> = 0.46875
	local vertices<const>: *mesh_vertex[mesh_vertex_count] = mesh_vertex_addr
	vertices[0].pos[0] = 0.0
	vertices[0].pos[1] = top_y
	vertices[0].pos[2] = 0.0
	vertices[0].normal[0] = 0.0
	vertices[0].normal[1] = top_y
	vertices[0].normal[2] = 0.0
	vertices[0].uv[0] = mesh_uv
	vertices[0].uv[1] = mesh_uv
	vertices[0].color = mesh_tint
	vertices[0].joint = mesh_joint_word
	vertices[0].weight = mesh_weight_word
	vertices[1].pos[0] = 0.0
	vertices[1].pos[1] = 0.0
	vertices[1].pos[2] = radius_z
	vertices[1].normal[0] = 0.0
	vertices[1].normal[1] = 0.0
	vertices[1].normal[2] = radius_z
	vertices[1].uv[0] = mesh_uv
	vertices[1].uv[1] = mesh_uv
	vertices[1].color = mesh_tint
	vertices[1].joint = mesh_joint_word
	vertices[1].weight = mesh_weight_word
	vertices[2].pos[0] = radius_x
	vertices[2].pos[1] = 0.0
	vertices[2].pos[2] = 0.0
	vertices[2].normal[0] = radius_x
	vertices[2].normal[1] = 0.0
	vertices[2].normal[2] = 0.0
	vertices[2].uv[0] = mesh_uv
	vertices[2].uv[1] = mesh_uv
	vertices[2].color = mesh_tint
	vertices[2].joint = mesh_joint_word
	vertices[2].weight = mesh_weight_word
	vertices[3].pos[0] = 0.0
	vertices[3].pos[1] = top_y
	vertices[3].pos[2] = 0.0
	vertices[3].normal[0] = 0.0
	vertices[3].normal[1] = top_y
	vertices[3].normal[2] = 0.0
	vertices[3].uv[0] = mesh_uv
	vertices[3].uv[1] = mesh_uv
	vertices[3].color = mesh_tint
	vertices[3].joint = mesh_joint_word
	vertices[3].weight = mesh_weight_word
	vertices[4].pos[0] = -radius_x
	vertices[4].pos[1] = 0.0
	vertices[4].pos[2] = 0.0
	vertices[4].normal[0] = -radius_x
	vertices[4].normal[1] = 0.0
	vertices[4].normal[2] = 0.0
	vertices[4].uv[0] = mesh_uv
	vertices[4].uv[1] = mesh_uv
	vertices[4].color = mesh_tint
	vertices[4].joint = mesh_joint_word
	vertices[4].weight = mesh_weight_word
	vertices[5].pos[0] = 0.0
	vertices[5].pos[1] = 0.0
	vertices[5].pos[2] = radius_z
	vertices[5].normal[0] = 0.0
	vertices[5].normal[1] = 0.0
	vertices[5].normal[2] = radius_z
	vertices[5].uv[0] = mesh_uv
	vertices[5].uv[1] = mesh_uv
	vertices[5].color = mesh_tint
	vertices[5].joint = mesh_joint_word
	vertices[5].weight = mesh_weight_word
	vertices[6].pos[0] = 0.0
	vertices[6].pos[1] = top_y
	vertices[6].pos[2] = 0.0
	vertices[6].normal[0] = 0.0
	vertices[6].normal[1] = top_y
	vertices[6].normal[2] = 0.0
	vertices[6].uv[0] = mesh_uv
	vertices[6].uv[1] = mesh_uv
	vertices[6].color = mesh_tint
	vertices[6].joint = mesh_joint_word
	vertices[6].weight = mesh_weight_word
	vertices[7].pos[0] = 0.0
	vertices[7].pos[1] = 0.0
	vertices[7].pos[2] = -radius_z
	vertices[7].normal[0] = 0.0
	vertices[7].normal[1] = 0.0
	vertices[7].normal[2] = -radius_z
	vertices[7].uv[0] = mesh_uv
	vertices[7].uv[1] = mesh_uv
	vertices[7].color = mesh_tint
	vertices[7].joint = mesh_joint_word
	vertices[7].weight = mesh_weight_word
	vertices[8].pos[0] = -radius_x
	vertices[8].pos[1] = 0.0
	vertices[8].pos[2] = 0.0
	vertices[8].normal[0] = -radius_x
	vertices[8].normal[1] = 0.0
	vertices[8].normal[2] = 0.0
	vertices[8].uv[0] = mesh_uv
	vertices[8].uv[1] = mesh_uv
	vertices[8].color = mesh_tint
	vertices[8].joint = mesh_joint_word
	vertices[8].weight = mesh_weight_word
	vertices[9].pos[0] = 0.0
	vertices[9].pos[1] = top_y
	vertices[9].pos[2] = 0.0
	vertices[9].normal[0] = 0.0
	vertices[9].normal[1] = top_y
	vertices[9].normal[2] = 0.0
	vertices[9].uv[0] = mesh_uv
	vertices[9].uv[1] = mesh_uv
	vertices[9].color = mesh_tint
	vertices[9].joint = mesh_joint_word
	vertices[9].weight = mesh_weight_word
	vertices[10].pos[0] = radius_x
	vertices[10].pos[1] = 0.0
	vertices[10].pos[2] = 0.0
	vertices[10].normal[0] = radius_x
	vertices[10].normal[1] = 0.0
	vertices[10].normal[2] = 0.0
	vertices[10].uv[0] = mesh_uv
	vertices[10].uv[1] = mesh_uv
	vertices[10].color = mesh_tint
	vertices[10].joint = mesh_joint_word
	vertices[10].weight = mesh_weight_word
	vertices[11].pos[0] = 0.0
	vertices[11].pos[1] = 0.0
	vertices[11].pos[2] = -radius_z
	vertices[11].normal[0] = 0.0
	vertices[11].normal[1] = 0.0
	vertices[11].normal[2] = -radius_z
	vertices[11].uv[0] = mesh_uv
	vertices[11].uv[1] = mesh_uv
	vertices[11].color = mesh_tint
	vertices[11].joint = mesh_joint_word
	vertices[11].weight = mesh_weight_word
	vertices[12].pos[0] = 0.0
	vertices[12].pos[1] = bottom_y
	vertices[12].pos[2] = 0.0
	vertices[12].normal[0] = 0.0
	vertices[12].normal[1] = bottom_y
	vertices[12].normal[2] = 0.0
	vertices[12].uv[0] = mesh_uv
	vertices[12].uv[1] = mesh_uv
	vertices[12].color = mesh_tint
	vertices[12].joint = mesh_joint_word
	vertices[12].weight = mesh_weight_word
	vertices[13].pos[0] = radius_x
	vertices[13].pos[1] = 0.0
	vertices[13].pos[2] = 0.0
	vertices[13].normal[0] = radius_x
	vertices[13].normal[1] = 0.0
	vertices[13].normal[2] = 0.0
	vertices[13].uv[0] = mesh_uv
	vertices[13].uv[1] = mesh_uv
	vertices[13].color = mesh_tint
	vertices[13].joint = mesh_joint_word
	vertices[13].weight = mesh_weight_word
	vertices[14].pos[0] = 0.0
	vertices[14].pos[1] = 0.0
	vertices[14].pos[2] = radius_z
	vertices[14].normal[0] = 0.0
	vertices[14].normal[1] = 0.0
	vertices[14].normal[2] = radius_z
	vertices[14].uv[0] = mesh_uv
	vertices[14].uv[1] = mesh_uv
	vertices[14].color = mesh_tint
	vertices[14].joint = mesh_joint_word
	vertices[14].weight = mesh_weight_word
	vertices[15].pos[0] = 0.0
	vertices[15].pos[1] = bottom_y
	vertices[15].pos[2] = 0.0
	vertices[15].normal[0] = 0.0
	vertices[15].normal[1] = bottom_y
	vertices[15].normal[2] = 0.0
	vertices[15].uv[0] = mesh_uv
	vertices[15].uv[1] = mesh_uv
	vertices[15].color = mesh_tint
	vertices[15].joint = mesh_joint_word
	vertices[15].weight = mesh_weight_word
	vertices[16].pos[0] = 0.0
	vertices[16].pos[1] = 0.0
	vertices[16].pos[2] = radius_z
	vertices[16].normal[0] = 0.0
	vertices[16].normal[1] = 0.0
	vertices[16].normal[2] = radius_z
	vertices[16].uv[0] = mesh_uv
	vertices[16].uv[1] = mesh_uv
	vertices[16].color = mesh_tint
	vertices[16].joint = mesh_joint_word
	vertices[16].weight = mesh_weight_word
	vertices[17].pos[0] = -radius_x
	vertices[17].pos[1] = 0.0
	vertices[17].pos[2] = 0.0
	vertices[17].normal[0] = -radius_x
	vertices[17].normal[1] = 0.0
	vertices[17].normal[2] = 0.0
	vertices[17].uv[0] = mesh_uv
	vertices[17].uv[1] = mesh_uv
	vertices[17].color = mesh_tint
	vertices[17].joint = mesh_joint_word
	vertices[17].weight = mesh_weight_word
	vertices[18].pos[0] = 0.0
	vertices[18].pos[1] = bottom_y
	vertices[18].pos[2] = 0.0
	vertices[18].normal[0] = 0.0
	vertices[18].normal[1] = bottom_y
	vertices[18].normal[2] = 0.0
	vertices[18].uv[0] = mesh_uv
	vertices[18].uv[1] = mesh_uv
	vertices[18].color = mesh_tint
	vertices[18].joint = mesh_joint_word
	vertices[18].weight = mesh_weight_word
	vertices[19].pos[0] = -radius_x
	vertices[19].pos[1] = 0.0
	vertices[19].pos[2] = 0.0
	vertices[19].normal[0] = -radius_x
	vertices[19].normal[1] = 0.0
	vertices[19].normal[2] = 0.0
	vertices[19].uv[0] = mesh_uv
	vertices[19].uv[1] = mesh_uv
	vertices[19].color = mesh_tint
	vertices[19].joint = mesh_joint_word
	vertices[19].weight = mesh_weight_word
	vertices[20].pos[0] = 0.0
	vertices[20].pos[1] = 0.0
	vertices[20].pos[2] = -radius_z
	vertices[20].normal[0] = 0.0
	vertices[20].normal[1] = 0.0
	vertices[20].normal[2] = -radius_z
	vertices[20].uv[0] = mesh_uv
	vertices[20].uv[1] = mesh_uv
	vertices[20].color = mesh_tint
	vertices[20].joint = mesh_joint_word
	vertices[20].weight = mesh_weight_word
	vertices[21].pos[0] = 0.0
	vertices[21].pos[1] = bottom_y
	vertices[21].pos[2] = 0.0
	vertices[21].normal[0] = 0.0
	vertices[21].normal[1] = bottom_y
	vertices[21].normal[2] = 0.0
	vertices[21].uv[0] = mesh_uv
	vertices[21].uv[1] = mesh_uv
	vertices[21].color = mesh_tint
	vertices[21].joint = mesh_joint_word
	vertices[21].weight = mesh_weight_word
	vertices[22].pos[0] = 0.0
	vertices[22].pos[1] = 0.0
	vertices[22].pos[2] = -radius_z
	vertices[22].normal[0] = 0.0
	vertices[22].normal[1] = 0.0
	vertices[22].normal[2] = -radius_z
	vertices[22].uv[0] = mesh_uv
	vertices[22].uv[1] = mesh_uv
	vertices[22].color = mesh_tint
	vertices[22].joint = mesh_joint_word
	vertices[22].weight = mesh_weight_word
	vertices[23].pos[0] = radius_x
	vertices[23].pos[1] = 0.0
	vertices[23].pos[2] = 0.0
	vertices[23].normal[0] = radius_x
	vertices[23].normal[1] = 0.0
	vertices[23].normal[2] = 0.0
	vertices[23].uv[0] = mesh_uv
	vertices[23].uv[1] = mesh_uv
	vertices[23].color = mesh_tint
	vertices[23].joint = mesh_joint_word
	vertices[23].weight = mesh_weight_word
end

local write_mesh_indices<const> = function()
	local indices<const>: *word = mesh_index_addr
	local word_index = 0
	local index = 0
	while index < mesh_index_count do
		indices[word_index] = ((index + 1) << 16) | index
		word_index = word_index + 1
		index = index + 2
	end
end

local write_lighting_constants<const> = function()
	local words<const>: *word = c1_addr
	local floats<const>: *f32 = c1_addr
	local word_index = 0
	while word_index < c1_words do
		words[word_index] = 0
		word_index = word_index + 1
	end
	-- Ambient: words 0-3 (r, g, b, intensity)
	floats[0] = 0.15
	floats[1] = 0.15
	floats[2] = 0.20
	floats[3] = 1.0
	-- Dir light 0: words 4-11 (dir.xyz+pad, color.rgb+intensity)
	floats[4] = -0.45
	floats[5] = 0.70
	floats[6] = 0.55
	floats[7] = 0.0
	floats[8] = 1.0
	floats[9] = 0.95
	floats[10] = 0.85
	floats[11] = 0.80
	-- Dir light 1: words 12-19 (blueish fill)
	floats[12] = 0.50
	floats[13] = -0.20
	floats[14] = -0.30
	floats[15] = 0.0
	floats[16] = 0.20
	floats[17] = 0.40
	floats[18] = 0.80
	floats[19] = 0.40
	-- Point light 0: words 36-43 (pos.xyz+range, color.rgb+intensity)
	floats[36] = 1.2
	floats[37] = 0.5
	floats[38] = 0.8
	floats[39] = 3.0
	floats[40] = 1.0
	floats[41] = 0.5
	floats[42] = 0.1
	floats[43] = 0.8
end

local write_morph_deltas<const> = function()
	local phase<const> = frame % 16
	local t<const> = phase < 8 and (phase * 0.125) or (2.0 - phase * 0.125)
	local morph_dy<const> = (t - 0.5) * 0.30
	local vertices<const>: *morph_vertex = morph_vertex_addr
	local i = 0
	while i < mesh_vertex_count do
		vertices[i].pos_delta[0] = 0.0
		vertices[i].pos_delta[1] = morph_dy
		vertices[i].pos_delta[2] = 0.0
		vertices[i].normal_delta[0] = 0.0
		vertices[i].normal_delta[1] = morph_dy * 2.0
		vertices[i].normal_delta[2] = 0.0
		i = i + 1
	end
end

local write_mesh_constants<const> = function()
	-- Resolve active camera from id (mirrors world.activeCamera3D getter).
	local active<const> = active_cam_id == side_cam.id and side_cam or free_cam
	-- Projection terms (sparse perspective-family P matrix).
	local proj_fx<const>, proj_fy<const>, proj_a<const>, proj_b<const> =
		cam_proj_terms(active)
	-- View basis and translation from active camera position + quaternion.
	local rx<const>, ry<const>, rz<const>, ux<const>, uy<const>, uz<const>, fx<const>, fy<const>, fz<const>,
	      v_tx<const>, v_ty<const>, v_tz<const> = cam_view_terms(active)
	-- Model: slow Y-axis auto-rotation (column-major)
	-- col0=(mc,0,-ms,0), col1=(0,1,0,0), col2=(ms,0,mc,0), col3=(0,0,0,1)
	local model_yaw<const> = frame * 0.02
	local mc<const> = math.cos(model_yaw)
	local ms<const> = math.sin(model_yaw)
	-- VM = View * Model (column-major, pre-multiply by P below)
	-- View col-major: col0=(rx,ux,-fx,0), col1=(ry,uy,-fy,0), col2=(rz,uz,-fz,0), col3=(v_tx,v_ty,v_tz,1)
	-- VM_col0 = View * M_col0 = View * (mc, 0, -ms, 0)
	local vm_00<const> = rx * mc - rz * ms
	local vm_10<const> = ux * mc - uz * ms
	local vm_20<const> = -fx * mc + fz * ms
	-- VM_col1 = View * M_col1 = View * (0, 1, 0, 0)
	local vm_01<const> = ry
	local vm_11<const> = uy
	local vm_21<const> = -fy
	-- VM_col2 = View * M_col2 = View * (ms, 0, mc, 0)
	local vm_02<const> = rx * ms + rz * mc
	local vm_12<const> = ux * ms + uz * mc
	local vm_22<const> = -fx * ms - fz * mc
	-- VM_col3 = View * M_col3 = View * (0, 0, 0, 1) = view translation
	local vm_03<const> = v_tx
	local vm_13<const> = v_ty
	local vm_23<const> = v_tz
	-- MVP = P * VM  (P is sparse: rows 0,1 scale x,y; rows 2,3 are depth/w)
	-- P row0=[proj_fx,0,0,0], row1=[0,proj_fy,0,0], row2=[0,0,proj_a,proj_b], row3=[0,0,-1,0]
	-- Each MVP column j: (proj_fx*vm_0j, proj_fy*vm_1j, proj_a*vm_2j + proj_b*w, -vm_2j)
	-- where w=0 for cols 0-2, w=1 for col 3 (homogeneous row of VM = (0,0,0,1))
	local c0<const>: *q16_matrix = c0_addr
	c0->m[0] = numeric.q16(proj_fx * vm_00)
	c0->m[1] = numeric.q16(proj_fy * vm_10)
	c0->m[2] = numeric.q16(proj_a * vm_20)
	c0->m[3] = numeric.q16(-vm_20)
	c0->m[4] = numeric.q16(proj_fx * vm_01)
	c0->m[5] = numeric.q16(proj_fy * vm_11)
	c0->m[6] = numeric.q16(proj_a * vm_21)
	c0->m[7] = numeric.q16(-vm_21)
	c0->m[8] = numeric.q16(proj_fx * vm_02)
	c0->m[9] = numeric.q16(proj_fy * vm_12)
	c0->m[10] = numeric.q16(proj_a * vm_22)
	c0->m[11] = numeric.q16(-vm_22)
	c0->m[12] = numeric.q16(proj_fx * vm_03)
	c0->m[13] = numeric.q16(proj_fy * vm_13)
	c0->m[14] = numeric.q16(proj_a * vm_23 + proj_b)
	c0->m[15] = numeric.q16(-vm_23)
end

local write_joint_constants<const> = function()
	local joint_phase<const> = frame % 8
	local joint_translate_x<const> = (joint_phase - 4) * 0.03125
	local joints<const>: *q16_matrix[2] = joint0_addr
	joints[0].m[0] = q16_one
	joints[0].m[1] = 0
	joints[0].m[2] = 0
	joints[0].m[3] = 0
	joints[0].m[4] = 0
	joints[0].m[5] = q16_one
	joints[0].m[6] = 0
	joints[0].m[7] = 0
	joints[0].m[8] = 0
	joints[0].m[9] = 0
	joints[0].m[10] = q16_one
	joints[0].m[11] = 0
	joints[0].m[12] = 0
	joints[0].m[13] = 0
	joints[0].m[14] = 0
	joints[0].m[15] = q16_one
	joints[1].m[0] = q16_one
	joints[1].m[1] = 0
	joints[1].m[2] = 0
	joints[1].m[3] = 0
	joints[1].m[4] = 0
	joints[1].m[5] = q16_one
	joints[1].m[6] = 0
	joints[1].m[7] = 0
	joints[1].m[8] = 0
	joints[1].m[9] = 0
	joints[1].m[10] = q16_one
	joints[1].m[11] = 0
	joints[1].m[12] = numeric.q16(joint_translate_x)
	joints[1].m[13] = 0
	joints[1].m[14] = 0
	joints[1].m[15] = q16_one
end

local write_mfu_constants<const> = function()
	local mfu<const>: *word = mfu_addr
	*mfu = 0
end

local setup_camera_input<const> = function()
	*inp_player_register = 1
	*inp_action_register = &'moveforward'
	*inp_bind_register = &'KeyW'
	*inp_ctrl_register = inp_ctrl_commit
	*inp_action_register = &'movebackward'
	*inp_bind_register = &'KeyS'
	*inp_ctrl_register = inp_ctrl_commit
	*inp_action_register = &'moveleft'
	*inp_bind_register = &'KeyA'
	*inp_ctrl_register = inp_ctrl_commit
	*inp_action_register = &'moveright'
	*inp_bind_register = &'KeyD'
	*inp_ctrl_register = inp_ctrl_commit
	*inp_action_register = &'panup'
	*inp_bind_register = &'KeyR'
	*inp_ctrl_register = inp_ctrl_commit
	*inp_action_register = &'pandown'
	*inp_bind_register = &'KeyF'
	*inp_ctrl_register = inp_ctrl_commit
	*inp_action_register = &'turnleft'
	*inp_bind_register = &'KeyQ'
	*inp_ctrl_register = inp_ctrl_commit
	*inp_action_register = &'turnright'
	*inp_bind_register = &'KeyE'
	*inp_ctrl_register = inp_ctrl_commit
	*inp_action_register = &'pitchup'
	*inp_bind_register = &'KeyT'
	*inp_ctrl_register = inp_ctrl_commit
	*inp_action_register = &'pitchdown'
	*inp_bind_register = &'KeyG'
	*inp_ctrl_register = inp_ctrl_commit
	*inp_action_register = &'boost'
	*inp_bind_register = &'ShiftLeft'
	*inp_ctrl_register = inp_ctrl_commit
	-- Camera selection: 1 = free_cam, 2 = side_cam (mirrors world.activeCameraId in TS)
	*inp_action_register = &'camsel1'
	*inp_bind_register = &'Digit1'
	*inp_ctrl_register = inp_ctrl_commit
	*inp_action_register = &'camsel2'
	*inp_bind_register = &'Digit2'
	*inp_ctrl_register = inp_ctrl_commit
end

local update_camera<const> = function()
	*inp_player_register = 1
	-- Camera selection (mirrors world.activeCameraId setter in TypeScript)
	*inp_query_register = &'camsel1[p]'
	if *inp_status_register ~= 0 then active_cam_id = free_cam.id end
	*inp_query_register = &'camsel2[p]'
	if *inp_status_register ~= 0 then active_cam_id = side_cam.id end
	-- Resolve active camera from id (mirrors world.activeCamera3D getter).
	local active<const> = active_cam_id == side_cam.id and side_cam or free_cam
	-- Speed settings
	local yaw_step = 0.035
	local pitch_step = 0.035
	local move = 0.075
	*inp_query_register = &'boost[p]'
	if *inp_status_register ~= 0 then
		yaw_step = 0.055
		pitch_step = 0.055
		move = 0.18
	end
	-- Rotation: screen-space look (yaw around camera-up, pitch around camera-right)
	local dyaw = 0.0
	local dpitch = 0.0
	*inp_query_register = &'turnleft[p]'
	if *inp_status_register ~= 0 then dyaw = yaw_step end
	*inp_query_register = &'turnright[p]'
	if *inp_status_register ~= 0 then dyaw = -yaw_step end
	*inp_query_register = &'pitchup[p]'
	if *inp_status_register ~= 0 then dpitch = pitch_step end
	*inp_query_register = &'pitchdown[p]'
	if *inp_status_register ~= 0 then dpitch = -pitch_step end
	if dyaw ~= 0.0 or dpitch ~= 0.0 then
		cam_screen_look(active, dyaw, dpitch, 0.0)
	end
	-- Translation: accumulate per-axis amounts, then apply in one cam_move call.
	-- cam_move calls q_basis once internally, covering all three body axes.
	local dfwd   = 0.0
	local dright = 0.0
	local dup    = 0.0
	*inp_query_register = &'moveforward[p]'
	if *inp_status_register ~= 0 then dfwd = move end
	*inp_query_register = &'movebackward[p]'
	if *inp_status_register ~= 0 then dfwd = -move end
	*inp_query_register = &'moveleft[p]'
	if *inp_status_register ~= 0 then dright = -move end
	*inp_query_register = &'moveright[p]'
	if *inp_status_register ~= 0 then dright = move end
	*inp_query_register = &'panup[p]'
	if *inp_status_register ~= 0 then dup = move end
	*inp_query_register = &'pandown[p]'
	if *inp_status_register ~= 0 then dup = -move end
	if dfwd ~= 0.0 or dright ~= 0.0 or dup ~= 0.0 then
		cam_move(active, dfwd, dright, dup)
	end
end

local write_instances<const> = function()
	local instances<const>: *sprite_instance[instance_count] = instance_addr
	local parallax_x<const> = -32.0 + ((frame % 96) * 0.5)
	local parallax_phase<const> = (frame % 16) * 4
	local billboard_phase<const> = (frame % 8) * 4
	local parallax_near_x<const> = -256.0 + parallax_phase * 2
	local billboard_x_a<const> = 54.0 + billboard_phase
	local billboard_y_a<const> = 114.0
	local billboard_x_b<const> = 174.0 - billboard_phase
	local billboard_y_b<const> = 70.0
	instances[0].matrix[0] = 512.0 * inv_half_screen_width
	instances[0].matrix[1] = 0.0
	instances[0].matrix[2] = parallax_x * inv_half_screen_width - 1.0
	instances[0].matrix[3] = 0.70
	instances[0].matrix[4] = 0.0
	instances[0].matrix[5] = -96.0 * inv_half_screen_height
	instances[0].matrix[6] = 1.0 - 24.0 * inv_half_screen_height
	instances[0].matrix[7] = 0.0
	instances[0].matrix[8] = 0.0
	instances[0].matrix[9] = 1.0
	instances[0].matrix[10] = 1.0
	instances[0].color = parallax_far_tint
	instances[1].matrix[0] = 512.0 * inv_half_screen_width
	instances[1].matrix[1] = 0.0
	instances[1].matrix[2] = parallax_near_x * inv_half_screen_width - 1.0
	instances[1].matrix[3] = 0.42
	instances[1].matrix[4] = 0.0
	instances[1].matrix[5] = -64.0 * inv_half_screen_height
	instances[1].matrix[6] = 1.0 - 48.0 * inv_half_screen_height
	instances[1].matrix[7] = 0.0
	instances[1].matrix[8] = 0.0
	instances[1].matrix[9] = 1.0
	instances[1].matrix[10] = 1.0
	instances[1].color = parallax_near_tint
	instances[2].matrix[0] = 48.0 * inv_half_screen_width
	instances[2].matrix[1] = 0.0
	instances[2].matrix[2] = sprite_x * inv_half_screen_width - 1.0
	instances[2].matrix[3] = 0.20
	instances[2].matrix[4] = 0.0
	instances[2].matrix[5] = -48.0 * inv_half_screen_height
	instances[2].matrix[6] = 1.0 - sprite_y * inv_half_screen_height
	instances[2].matrix[7] = 0.0
	instances[2].matrix[8] = 0.0
	instances[2].matrix[9] = 1.0
	instances[2].matrix[10] = 1.0
	instances[2].color = sprite_tint
	instances[3].matrix[0] = 38.0 * inv_half_screen_width
	instances[3].matrix[1] = 0.0
	instances[3].matrix[2] = billboard_x_a * inv_half_screen_width - 1.0
	instances[3].matrix[3] = 0.12
	instances[3].matrix[4] = 0.0
	instances[3].matrix[5] = -38.0 * inv_half_screen_height
	instances[3].matrix[6] = 1.0 - billboard_y_a * inv_half_screen_height
	instances[3].matrix[7] = 0.0
	instances[3].matrix[8] = 0.0
	instances[3].matrix[9] = 1.0
	instances[3].matrix[10] = 1.0
	instances[3].color = billboard_tint_a
	instances[4].matrix[0] = 32.0 * inv_half_screen_width
	instances[4].matrix[1] = 0.0
	instances[4].matrix[2] = billboard_x_b * inv_half_screen_width - 1.0
	instances[4].matrix[3] = 0.14
	instances[4].matrix[4] = 0.0
	instances[4].matrix[5] = -32.0 * inv_half_screen_height
	instances[4].matrix[6] = 1.0 - billboard_y_b * inv_half_screen_height
	instances[4].matrix[7] = 0.0
	instances[4].matrix[8] = 0.0
	instances[4].matrix[9] = 1.0
	instances[4].matrix[10] = 1.0
	instances[4].color = billboard_tint_b
	instances[5].matrix[0] = 2.0
	instances[5].matrix[1] = 0.0
	instances[5].matrix[2] = -1.0
	instances[5].matrix[3] = 0.0
	instances[5].matrix[4] = 0.0
	instances[5].matrix[5] = -2.0
	instances[5].matrix[6] = 1.0
	instances[5].matrix[7] = 0.0
	instances[5].matrix[8] = 0.0
	instances[5].matrix[9] = 1.0
	instances[5].matrix[10] = 1.0
	instances[5].color = white
end

local write_mat4_instances<const> = function()
	-- Resolve active camera from id (mirrors world.activeCamera3D getter).
	local active<const> = active_cam_id == side_cam.id and side_cam or free_cam
	-- Projection terms from active camera.
	local proj_fx<const>, proj_fy<const>, proj_a<const>, proj_b<const> =
		cam_proj_terms(active)
	-- View basis and translation from active camera.
	local crx<const>, cry<const>, crz<const>, cux<const>, cuy<const>, cuz<const>, cfx<const>, cfy<const>, cfz<const>,
	      v_tx<const>, v_ty<const>, v_tz<const> = cam_view_terms(active)
	-- Precomputed P*V col0-2 components (shared, scale applied per-instance below)
	-- P * V_col0 = P*(crx,cux,-cfx,0) = (proj_fx*crx, proj_fy*cux, -proj_a*cfx, cfx)
	-- P * V_col1 = P*(cry,cuy,-cfy,0) = (proj_fx*cry, proj_fy*cuy, -proj_a*cfy, cfy)
	-- P * V_col2 = P*(crz,cuz,-cfz,0) = (proj_fx*crz, proj_fy*cuz, -proj_a*cfz, cfz)
	local pvc0r0<const> = proj_fx * crx
	local pvc0r1<const> = proj_fy * cux
	local pvc0r2<const> = -proj_a * cfx
	local pvc0r3<const> = cfx
	local pvc1r0<const> = proj_fx * cry
	local pvc1r1<const> = proj_fy * cuy
	local pvc1r2<const> = -proj_a * cfy
	local pvc1r3<const> = cfy
	local pvc2r0<const> = proj_fx * crz
	local pvc2r1<const> = proj_fy * cuz
	local pvc2r2<const> = -proj_a * cfz
	local pvc2r3<const> = cfz
	-- Instance 1: identity rotation, world pos (-0.72, 0.58, 0)
	-- VM_col3 = V * (wx,wy,wz,1): each component uses dot of view row with world pos
	local wx1<const>  = -0.72
	local wy1<const>  = 0.58
	local wz1<const>  = 0.0
	local vm1_03<const> = crx * wx1 + cry * wy1 + crz * wz1 + v_tx
	local vm1_13<const> = cux * wx1 + cuy * wy1 + cuz * wz1 + v_ty
	local vm1_23<const> = -cfx * wx1 - cfy * wy1 - cfz * wz1 + v_tz
	-- Instance 2: scale(0.72,0.72,1), world pos (0.72, 0.50, 0)
	local sc2<const>  = 0.72
	local wx2<const>  = 0.72
	local wy2<const>  = 0.50
	local wz2<const>  = 0.0
	local vm2_03<const> = crx * wx2 + cry * wy2 + crz * wz2 + v_tx
	local vm2_13<const> = cux * wx2 + cuy * wy2 + cuz * wz2 + v_ty
	local vm2_23<const> = -cfx * wx2 - cfy * wy2 - cfz * wz2 + v_tz
	local mat4_instances<const>: *mat4_instance[mat4_instance_count] = mat4_instance_addr
	-- Instance 1 MVP (column-major: [col0,col1,col2,col3], each 4 floats = [r0,r1,r2,r3])
	mat4_instances[0].mvp[0] = pvc0r0
	mat4_instances[0].mvp[1] = pvc0r1
	mat4_instances[0].mvp[2] = pvc0r2
	mat4_instances[0].mvp[3] = pvc0r3
	mat4_instances[0].mvp[4] = pvc1r0
	mat4_instances[0].mvp[5] = pvc1r1
	mat4_instances[0].mvp[6] = pvc1r2
	mat4_instances[0].mvp[7] = pvc1r3
	mat4_instances[0].mvp[8] = pvc2r0
	mat4_instances[0].mvp[9] = pvc2r1
	mat4_instances[0].mvp[10] = pvc2r2
	mat4_instances[0].mvp[11] = pvc2r3
	mat4_instances[0].mvp[12] = proj_fx * vm1_03
	mat4_instances[0].mvp[13] = proj_fy * vm1_13
	mat4_instances[0].mvp[14] = proj_a * vm1_23 + proj_b
	mat4_instances[0].mvp[15] = -vm1_23
	mat4_instances[0].color = mat4_tint_a
	-- Instance 2 MVP: xy scale applied to cols 0 and 1
	mat4_instances[1].mvp[0] = pvc0r0 * sc2
	mat4_instances[1].mvp[1] = pvc0r1 * sc2
	mat4_instances[1].mvp[2] = pvc0r2 * sc2
	mat4_instances[1].mvp[3] = pvc0r3 * sc2
	mat4_instances[1].mvp[4] = pvc1r0 * sc2
	mat4_instances[1].mvp[5] = pvc1r1 * sc2
	mat4_instances[1].mvp[6] = pvc1r2 * sc2
	mat4_instances[1].mvp[7] = pvc1r3 * sc2
	mat4_instances[1].mvp[8] = pvc2r0
	mat4_instances[1].mvp[9] = pvc2r1
	mat4_instances[1].mvp[10] = pvc2r2
	mat4_instances[1].mvp[11] = pvc2r3
	mat4_instances[1].mvp[12] = proj_fx * vm2_03
	mat4_instances[1].mvp[13] = proj_fy * vm2_13
	mat4_instances[1].mvp[14] = proj_a * vm2_23 + proj_b
	mat4_instances[1].mvp[15] = -vm2_23
	mat4_instances[1].color = mat4_tint_b
end

local write_vdp_command_descriptors<const> = function()
	local surfaces<const>: *bm_surface_define_desc[surface_desc_count] = surface_desc_addr
	surfaces[0].surface_id = atlas_surface
	surfaces[0].size = atlas_width | (atlas_height << 16)
	surfaces[0].format_usage = rpu_surface_rgba_texture
	surfaces[1].surface_id = scene_color_surface
	surfaces[1].size = screen_width | (screen_height << 16)
	surfaces[1].format_usage = rpu_surface_rgba_color_texture
	surfaces[2].surface_id = scene_depth_surface
	surfaces[2].size = screen_width | (screen_height << 16)
	surfaces[2].format_usage = rpu_surface_depth

	local buffers<const>: *bm_buffer_define_desc[buffer_desc_count] = buffer_desc_addr
	buffers[0].buffer_id = quad_buffer
	buffers[0].byte_length = quad_vertex_bytes
	buffers[0].usage = sys_rpu_usage_vertex
	buffers[0].upload_src_addr = quad_vertex_addr
	buffers[0].upload_byte_length = quad_vertex_bytes
	buffers[1].buffer_id = background_buffer
	buffers[1].byte_length = background_vertex_bytes
	buffers[1].usage = sys_rpu_usage_vertex
	buffers[1].upload_src_addr = background_vertex_addr
	buffers[1].upload_byte_length = background_vertex_bytes
	buffers[2].buffer_id = vector_buffer
	buffers[2].byte_length = vector_vertex_bytes
	buffers[2].usage = sys_rpu_usage_vertex
	buffers[2].upload_src_addr = vector_vertex_addr
	buffers[2].upload_byte_length = vector_vertex_bytes
	buffers[3].buffer_id = mat4_vertex_buffer
	buffers[3].byte_length = mat4_vertex_bytes
	buffers[3].usage = sys_rpu_usage_vertex
	buffers[3].upload_src_addr = mat4_vertex_addr
	buffers[3].upload_byte_length = mat4_vertex_bytes
	buffers[4].buffer_id = mat4_instance_buffer
	buffers[4].byte_length = mat4_instance_bytes
	buffers[4].usage = sys_rpu_usage_vertex
	buffers[4].upload_src_addr = 0
	buffers[4].upload_byte_length = 0
	buffers[5].buffer_id = mesh_buffer
	buffers[5].byte_length = mesh_vertex_bytes
	buffers[5].usage = sys_rpu_usage_vertex
	buffers[5].upload_src_addr = 0
	buffers[5].upload_byte_length = 0
	buffers[6].buffer_id = mesh_index_buffer
	buffers[6].byte_length = mesh_index_bytes
	buffers[6].usage = sys_rpu_usage_index
	buffers[6].upload_src_addr = mesh_index_addr
	buffers[6].upload_byte_length = mesh_index_bytes
	buffers[7].buffer_id = morph_buffer
	buffers[7].byte_length = morph_vertex_bytes
	buffers[7].usage = sys_rpu_usage_vertex
	buffers[7].upload_src_addr = 0
	buffers[7].upload_byte_length = 0
	buffers[8].buffer_id = instance_buffer
	buffers[8].byte_length = instance_bytes
	buffers[8].usage = sys_rpu_usage_vertex
	buffers[8].upload_src_addr = 0
	buffers[8].upload_byte_length = 0

	local matrix_uploads<const>: *bm_matrix_upload_desc[matrix_upload_desc_count] = matrix_upload_desc_addr
	matrix_uploads[0].packet_kind = sys_vdp_xf_packet_kind
	matrix_uploads[0].matrix_word_count = sys_vdp_xf_matrix_words
	matrix_uploads[0].matrix_index = mesh_matrix_index
	matrix_uploads[0].src_addr = c0_addr
	matrix_uploads[1].packet_kind = sys_vdp_jtu_packet_kind
	matrix_uploads[1].matrix_word_count = sys_vdp_jtu_matrix_words
	matrix_uploads[1].matrix_index = 0
	matrix_uploads[1].src_addr = joint0_addr
	matrix_uploads[2].packet_kind = sys_vdp_jtu_packet_kind
	matrix_uploads[2].matrix_word_count = sys_vdp_jtu_matrix_words
	matrix_uploads[2].matrix_index = mesh_joint_matrix_index
	matrix_uploads[2].src_addr = joint1_addr

	local register_uploads<const>: *bm_register_upload_desc[register_upload_desc_count] = register_upload_desc_addr
	register_uploads[0].packet_kind = sys_vdp_lpu_packet_kind
	register_uploads[0].first_register = 0
	register_uploads[0].src_addr = c1_addr
	register_uploads[0].word_count = c1_words
	register_uploads[1].packet_kind = sys_vdp_mfu_packet_kind
	register_uploads[1].first_register = 0
	register_uploads[1].src_addr = mfu_addr
	register_uploads[1].word_count = mfu_words

	local frame_uploads<const>: *bm_buffer_upload_desc[frame_buffer_upload_desc_count] = frame_buffer_upload_desc_addr
	frame_uploads[0].buffer_id = mesh_buffer
	frame_uploads[0].dst_byte_offset = 0
	frame_uploads[0].src_addr = mesh_vertex_addr
	frame_uploads[0].byte_length = mesh_vertex_bytes
	frame_uploads[1].buffer_id = morph_buffer
	frame_uploads[1].dst_byte_offset = 0
	frame_uploads[1].src_addr = morph_vertex_addr
	frame_uploads[1].byte_length = morph_vertex_bytes
	frame_uploads[2].buffer_id = mat4_instance_buffer
	frame_uploads[2].dst_byte_offset = 0
	frame_uploads[2].src_addr = mat4_instance_addr
	frame_uploads[2].byte_length = mat4_instance_bytes
	frame_uploads[3].buffer_id = instance_buffer
	frame_uploads[3].dst_byte_offset = 0
	frame_uploads[3].src_addr = instance_addr
	frame_uploads[3].byte_length = instance_bytes

	local constant_banks<const>: *bm_constant_bank_desc[constant_bank_desc_count] = constant_bank_desc_addr
	constant_banks[0].bank_id = 0
	constant_banks[0].first_word = 0
	constant_banks[0].word_count = c0_words
	constant_banks[1].bank_id = 1
	constant_banks[1].first_word = c0_words
	constant_banks[1].word_count = c1_words
	constant_banks[2].bank_id = 2
	constant_banks[2].first_word = c0_words + c1_words
	constant_banks[2].word_count = joint_words

	local device_uploads<const>: *bm_constant_device_upload_desc[constant_device_upload_desc_count] = constant_device_upload_desc_addr
	device_uploads[0].bank_id = 0
	device_uploads[0].dst_word_offset = 0
	device_uploads[0].source = sys_rpu_constant_source_xf_q16
	device_uploads[0].source_word_offset = mesh_matrix_index * sys_vdp_xf_matrix_words
	device_uploads[0].word_count = c0_words
	device_uploads[1].bank_id = 1
	device_uploads[1].dst_word_offset = 0
	device_uploads[1].source = sys_rpu_constant_source_lpu_raw
	device_uploads[1].source_word_offset = 0
	device_uploads[1].word_count = c1_words
	device_uploads[2].bank_id = 1
	device_uploads[2].dst_word_offset = 8
	device_uploads[2].source = sys_rpu_constant_source_mfu_q16
	device_uploads[2].source_word_offset = 0
	device_uploads[2].word_count = mfu_words
	device_uploads[3].bank_id = 2
	device_uploads[3].dst_word_offset = 0
	device_uploads[3].source = sys_rpu_constant_source_jtu_q16
	device_uploads[3].source_word_offset = 0
	device_uploads[3].word_count = joint_words

	local passes<const>: *bm_pass_desc[pass_desc_count] = pass_desc_addr
	passes[0].color_surface_id = scene_color_surface
	passes[0].depth_surface_id = scene_depth_surface
	passes[0].viewport_xy = 0
	passes[0].viewport_wh = screen_width | (screen_height << 16)
	passes[0].pass_ops = sys_rpu_pass_color_clear | sys_rpu_pass_depth_clear
	passes[0].clear_color = 0xff071a3a
	passes[0].clear_depth_word = 0xffffffff
	passes[0].first_draw = scene_draw_first
	passes[0].draw_count = scene_draw_count
	passes[1].color_surface_id = sys_rpu_resource_none
	passes[1].depth_surface_id = sys_rpu_resource_none
	passes[1].viewport_xy = 0
	passes[1].viewport_wh = screen_width | (screen_height << 16)
	passes[1].pass_ops = 0
	passes[1].clear_color = 0
	passes[1].clear_depth_word = 0
	passes[1].first_draw = present_draw_first
	passes[1].draw_count = present_draw_count

	local draws<const>: *bm_draw_desc[draw_desc_count] = draw_desc_addr
	draws[0].shader_variant = sys_rpu_shader_v2_c4
	draws[0].primitive_index_type = rpu_primitive_triangles
	draws[0].pipeline_word = rpu_pipeline_opaque
	draws[0].vertex_count = background_vertex_count
	draws[0].instance_count = 1
	draws[0].index_buffer_id = sys_rpu_resource_none
	draws[0].index_byte_offset = 0
	draws[0].index_count = 0
	draws[0].stream_first = 0
	draws[0].stream_count = 1
	draws[0].constant_first = 0
	draws[0].constant_count = 0
	draws[0].sampled_surface_first = 0
	draws[0].sampled_surface_count = 0
	draws[1].shader_variant = sys_rpu_shader_v2_c4
	draws[1].primitive_index_type = rpu_primitive_triangles
	draws[1].pipeline_word = rpu_pipeline_opaque
	draws[1].vertex_count = vector_vertex_count
	draws[1].instance_count = 1
	draws[1].index_buffer_id = sys_rpu_resource_none
	draws[1].index_byte_offset = 0
	draws[1].index_count = 0
	draws[1].stream_first = 1
	draws[1].stream_count = 1
	draws[1].constant_first = 0
	draws[1].constant_count = 0
	draws[1].sampled_surface_first = 0
	draws[1].sampled_surface_count = 0
	draws[2].shader_variant = sys_rpu_shader_v2_c4
	draws[2].primitive_index_type = rpu_primitive_lines
	draws[2].pipeline_word = rpu_pipeline_opaque
	draws[2].vertex_count = 2
	draws[2].instance_count = 1
	draws[2].index_buffer_id = sys_rpu_resource_none
	draws[2].index_byte_offset = 0
	draws[2].index_count = 0
	draws[2].stream_first = 2
	draws[2].stream_count = 1
	draws[2].constant_first = 0
	draws[2].constant_count = 0
	draws[2].sampled_surface_first = 0
	draws[2].sampled_surface_count = 0
	draws[3].shader_variant = sys_rpu_shader_v2_c4
	draws[3].primitive_index_type = rpu_primitive_points
	draws[3].pipeline_word = rpu_pipeline_depth_alpha
	draws[3].vertex_count = 1
	draws[3].instance_count = 1
	draws[3].index_buffer_id = sys_rpu_resource_none
	draws[3].index_byte_offset = 0
	draws[3].index_count = 0
	draws[3].stream_first = 3
	draws[3].stream_count = 1
	draws[3].constant_first = 0
	draws[3].constant_count = 0
	draws[3].sampled_surface_first = 0
	draws[3].sampled_surface_count = 0
	draws[4].shader_variant = sys_rpu_shader_v2_t2_c4_i_affine2
	draws[4].primitive_index_type = rpu_primitive_triangle_strip
	draws[4].pipeline_word = rpu_pipeline_depth_opaque
	draws[4].vertex_count = quad_vertex_count
	draws[4].instance_count = sprite_instance_count
	draws[4].index_buffer_id = sys_rpu_resource_none
	draws[4].index_byte_offset = 0
	draws[4].index_count = 0
	draws[4].stream_first = 4
	draws[4].stream_count = 2
	draws[4].constant_first = 0
	draws[4].constant_count = 0
	draws[4].sampled_surface_first = 0
	draws[4].sampled_surface_count = 1
	draws[5].shader_variant = sys_rpu_shader_v3_c4_i_mat4
	draws[5].primitive_index_type = rpu_primitive_triangles
	draws[5].pipeline_word = rpu_pipeline_depth_opaque
	draws[5].vertex_count = mat4_vertex_count
	draws[5].instance_count = mat4_instance_count
	draws[5].index_buffer_id = sys_rpu_resource_none
	draws[5].index_byte_offset = 0
	draws[5].index_count = 0
	draws[5].stream_first = 6
	draws[5].stream_count = 2
	draws[5].constant_first = 0
	draws[5].constant_count = 0
	draws[5].sampled_surface_first = 0
	draws[5].sampled_surface_count = 0
	draws[6].shader_variant = sys_rpu_shader_v3_c4_c0
	draws[6].primitive_index_type = rpu_primitive_triangles
	draws[6].pipeline_word = rpu_pipeline_depth_opaque
	draws[6].vertex_count = mat4_vertex_count
	draws[6].instance_count = 1
	draws[6].index_buffer_id = sys_rpu_resource_none
	draws[6].index_byte_offset = 0
	draws[6].index_count = 0
	draws[6].stream_first = 8
	draws[6].stream_count = 1
	draws[6].constant_first = 0
	draws[6].constant_count = 1
	draws[6].sampled_surface_first = 0
	draws[6].sampled_surface_count = 0
	draws[7].shader_variant = sys_rpu_shader_v3_n3_t2_c4_j4_w4_c0_c1 | sys_rpu_shader_flag_morph | sys_rpu_shader_flag_t1
	draws[7].primitive_index_type = rpu_primitive_indexed_triangles
	draws[7].pipeline_word = rpu_pipeline_depth_opaque
	draws[7].vertex_count = mesh_vertex_count
	draws[7].instance_count = 1
	draws[7].index_buffer_id = mesh_index_buffer
	draws[7].index_byte_offset = 0
	draws[7].index_count = mesh_index_count
	draws[7].stream_first = 9
	draws[7].stream_count = 2
	draws[7].constant_first = 1
	draws[7].constant_count = 3
	draws[7].sampled_surface_first = 1
	draws[7].sampled_surface_count = 2
	draws[8].shader_variant = sys_rpu_shader_v2_t2_c4_i_affine2
	draws[8].primitive_index_type = rpu_primitive_triangle_strip
	draws[8].pipeline_word = rpu_pipeline_opaque
	draws[8].vertex_count = quad_vertex_count
	draws[8].instance_count = present_instance_count
	draws[8].index_buffer_id = sys_rpu_resource_none
	draws[8].index_byte_offset = 0
	draws[8].index_count = 0
	draws[8].stream_first = 11
	draws[8].stream_count = 2
	draws[8].constant_first = 0
	draws[8].constant_count = 0
	draws[8].sampled_surface_first = 3
	draws[8].sampled_surface_count = 1

	local streams<const>: *bm_stream_bind_desc[stream_bind_desc_count] = stream_bind_desc_addr
	streams[0].stream_slot = 0
	streams[0].layout_id = sys_rpu_layout_v2_c4
	streams[0].buffer_id = background_buffer
	streams[0].byte_offset = 0
	streams[0].step_rate = 0
	streams[1].stream_slot = 0
	streams[1].layout_id = sys_rpu_layout_v2_c4
	streams[1].buffer_id = vector_buffer
	streams[1].byte_offset = 0
	streams[1].step_rate = 0
	streams[2].stream_slot = 0
	streams[2].layout_id = sys_rpu_layout_v2_c4
	streams[2].buffer_id = vector_buffer
	streams[2].byte_offset = vector_vertex_stride * 2
	streams[2].step_rate = 0
	streams[3].stream_slot = 0
	streams[3].layout_id = sys_rpu_layout_v2_c4
	streams[3].buffer_id = vector_buffer
	streams[3].byte_offset = vector_vertex_stride * 2
	streams[3].step_rate = 0
	streams[4].stream_slot = 0
	streams[4].layout_id = sys_rpu_layout_v2_t2_c4
	streams[4].buffer_id = quad_buffer
	streams[4].byte_offset = 0
	streams[4].step_rate = 0
	streams[5].stream_slot = 1
	streams[5].layout_id = sys_rpu_layout_i_affine2_trect_c4
	streams[5].buffer_id = instance_buffer
	streams[5].byte_offset = 0
	streams[5].step_rate = 1
	streams[6].stream_slot = 0
	streams[6].layout_id = sys_rpu_layout_v3_c4
	streams[6].buffer_id = mat4_vertex_buffer
	streams[6].byte_offset = 0
	streams[6].step_rate = 0
	streams[7].stream_slot = 1
	streams[7].layout_id = sys_rpu_layout_i_mat4_c4
	streams[7].buffer_id = mat4_instance_buffer
	streams[7].byte_offset = 0
	streams[7].step_rate = 1
	streams[8].stream_slot = 0
	streams[8].layout_id = sys_rpu_layout_v3_c4
	streams[8].buffer_id = mat4_vertex_buffer
	streams[8].byte_offset = 0
	streams[8].step_rate = 0
	streams[9].stream_slot = 0
	streams[9].layout_id = sys_rpu_layout_v3_n3_t2_c4_j4_w4
	streams[9].buffer_id = mesh_buffer
	streams[9].byte_offset = 0
	streams[9].step_rate = 0
	streams[10].stream_slot = 2
	streams[10].layout_id = sys_rpu_layout_v3_dm3
	streams[10].buffer_id = morph_buffer
	streams[10].byte_offset = 0
	streams[10].step_rate = 0
	streams[11].stream_slot = 0
	streams[11].layout_id = sys_rpu_layout_v2_t2_c4
	streams[11].buffer_id = quad_buffer
	streams[11].byte_offset = 0
	streams[11].step_rate = 0
	streams[12].stream_slot = 1
	streams[12].layout_id = sys_rpu_layout_i_affine2_trect_c4
	streams[12].buffer_id = instance_buffer
	streams[12].byte_offset = present_instance_offset
	streams[12].step_rate = 1

	local constants<const>: *bm_constant_bind_desc[constant_bind_desc_count] = constant_bind_desc_addr
	constants[0].binding_slot = 0
	constants[0].bank_id = 0
	constants[0].first_word = 0
	constants[0].word_count = c0_words
	constants[1].binding_slot = 0
	constants[1].bank_id = 0
	constants[1].first_word = 0
	constants[1].word_count = c0_words
	constants[2].binding_slot = 1
	constants[2].bank_id = 2
	constants[2].first_word = 0
	constants[2].word_count = joint_words
	constants[3].binding_slot = 2
	constants[3].bank_id = 1
	constants[3].first_word = 0
	constants[3].word_count = c1_words

	local sampled_surface_binds<const>: *bm_sampled_surface_bind_desc[sampled_surface_bind_desc_count] = sampled_surface_bind_desc_addr
	sampled_surface_binds[0].texture_slot = 0
	sampled_surface_binds[0].surface_id = atlas_surface
	sampled_surface_binds[1].texture_slot = 0
	sampled_surface_binds[1].surface_id = atlas_surface
	sampled_surface_binds[2].texture_slot = 1
	sampled_surface_binds[2].surface_id = atlas_surface
	sampled_surface_binds[3].texture_slot = 0
	sampled_surface_binds[3].surface_id = scene_color_surface
end


local initialize_vdp_resources<const> = function()
	write_quad_vertices()
	write_background_vertices()
	write_vector_vertices()
	write_mat4_vertices()
	write_mesh_indices()
	write_lighting_constants()
	write_vdp_command_descriptors()
	local wp = vdp_stream_base
	local surfaces<const>: *bm_surface_define_desc[surface_desc_count] = surface_desc_addr
	local surface_index = 0
	while surface_index < surface_desc_count do
		local desc<const>: *bm_surface_define_desc = &surfaces[surface_index]
		local packet<const>: *bm_rpu_surface_define_packet = wp
		packet->header = sys_rpu_packet_kind | (sys_rpu_words_surface_define << 16)
		packet->op = sys_rpu_op_surface_define
		packet->surface_id = desc->surface_id
		packet->size = desc->size
		packet->format_usage = desc->format_usage
		wp = wp + sizeof(bm_rpu_surface_define_packet)
		surface_index = surface_index + 1
	end
	local buffers<const>: *bm_buffer_define_desc[buffer_desc_count] = buffer_desc_addr
	local buffer_index = 0
	while buffer_index < buffer_desc_count do
		local desc<const>: *bm_buffer_define_desc = &buffers[buffer_index]
		local define_packet<const>: *bm_rpu_buffer_define_packet = wp
		define_packet->header = sys_rpu_packet_kind | (sys_rpu_words_buffer_define << 16)
		define_packet->op = sys_rpu_op_buffer_define
		define_packet->buffer_id = desc->buffer_id
		define_packet->byte_length = desc->byte_length
		define_packet->usage = desc->usage
		wp = wp + sizeof(bm_rpu_buffer_define_packet)
		if desc->upload_byte_length ~= 0 then
			local upload_packet<const>: *bm_rpu_buffer_upload_dma_packet = wp
			upload_packet->header = sys_rpu_packet_kind | (sys_rpu_words_buffer_upload_dma << 16)
			upload_packet->op = sys_rpu_op_buffer_upload_dma
			upload_packet->buffer_id = desc->buffer_id
			upload_packet->dst_byte_offset = 0
			upload_packet->src_addr = desc->upload_src_addr
			upload_packet->byte_length = desc->upload_byte_length
			wp = wp + sizeof(bm_rpu_buffer_upload_dma_packet)
		end
		buffer_index = buffer_index + 1
	end
	local end_packet<const>: *word = wp
	*end_packet = sys_vdp_pkt_end
	wp = wp + sys_vdp_arg_stride
	vdp_stream_cursor = wp
	submit_current_stream()
	wait_interrupt(irq_dma_done | irq_dma_error)
end


local draw_frame<const> = function()
	local morph_phase<const> = frame % 32
	local morph_t<const> = morph_phase < 16 and (morph_phase / 16.0) or (2.0 - morph_phase / 16.0)
	local morph_a<const> = morph_t * 0.22
	local morph_b<const> = (1.0 - morph_t) * 0.16
	write_mesh_vertices(morph_a, morph_b)
	write_morph_deltas()
	write_mesh_constants()
	write_joint_constants()
	write_mfu_constants()
	write_instances()
	write_mat4_instances()
	local wp = vdp_stream_base
	local matrix_uploads<const>: *bm_matrix_upload_desc[matrix_upload_desc_count] = matrix_upload_desc_addr
	local matrix_upload_index = 0
	while matrix_upload_index < matrix_upload_desc_count do
		local desc<const>: *bm_matrix_upload_desc = &matrix_uploads[matrix_upload_index]
		local packet<const>: *bm_xf_matrix_packet_header = wp
		local data<const>: *word = wp + sizeof(bm_xf_matrix_packet_header)
		local src<const>: *word = desc->src_addr
		packet->header = desc->packet_kind | ((1 + desc->matrix_word_count) << 16)
		packet->matrix_word_offset = desc->matrix_index * desc->matrix_word_count
		local word_index = 0
		while word_index < desc->matrix_word_count do
			data[word_index] = src[word_index]
			word_index = word_index + 1
		end
		wp = wp + ((2 + desc->matrix_word_count) * sys_vdp_arg_stride)
		matrix_upload_index = matrix_upload_index + 1
	end
	local register_uploads<const>: *bm_register_upload_desc[register_upload_desc_count] = register_upload_desc_addr
	local register_upload_index = 0
	while register_upload_index < register_upload_desc_count do
		local desc<const>: *bm_register_upload_desc = &register_uploads[register_upload_index]
		local packet<const>: *bm_lpu_register_packet_header = wp
		local data<const>: *word = wp + sizeof(bm_lpu_register_packet_header)
		local src<const>: *word = desc->src_addr
		packet->header = desc->packet_kind | ((1 + desc->word_count) << 16)
		packet->first_register = desc->first_register
		local word_index = 0
		while word_index < desc->word_count do
			data[word_index] = src[word_index]
			word_index = word_index + 1
		end
		wp = wp + ((2 + desc->word_count) * sys_vdp_arg_stride)
		register_upload_index = register_upload_index + 1
	end
	local frame_uploads<const>: *bm_buffer_upload_desc[frame_buffer_upload_desc_count] = frame_buffer_upload_desc_addr
	local frame_upload_index = 0
	while frame_upload_index < frame_buffer_upload_desc_count do
		local desc<const>: *bm_buffer_upload_desc = &frame_uploads[frame_upload_index]
		local packet<const>: *bm_rpu_buffer_upload_dma_packet = wp
		packet->header = sys_rpu_packet_kind | (sys_rpu_words_buffer_upload_dma << 16)
		packet->op = sys_rpu_op_buffer_upload_dma
		packet->buffer_id = desc->buffer_id
		packet->dst_byte_offset = desc->dst_byte_offset
		packet->src_addr = desc->src_addr
		packet->byte_length = desc->byte_length
		wp = wp + sizeof(bm_rpu_buffer_upload_dma_packet)
		frame_upload_index = frame_upload_index + 1
	end
	local constant_banks<const>: *bm_constant_bank_desc[constant_bank_desc_count] = constant_bank_desc_addr
	local constant_bank_index = 0
	while constant_bank_index < constant_bank_desc_count do
		local desc<const>: *bm_constant_bank_desc = &constant_banks[constant_bank_index]
		local packet<const>: *bm_rpu_constant_bank_define_packet = wp
		packet->header = sys_rpu_packet_kind | (sys_rpu_words_constant_bank_define << 16)
		packet->op = sys_rpu_op_constant_bank_define
		packet->bank_id = desc->bank_id
		packet->first_word = desc->first_word
		packet->word_count = desc->word_count
		wp = wp + sizeof(bm_rpu_constant_bank_define_packet)
		constant_bank_index = constant_bank_index + 1
	end
	local device_uploads<const>: *bm_constant_device_upload_desc[constant_device_upload_desc_count] = constant_device_upload_desc_addr
	local device_upload_index = 0
	while device_upload_index < constant_device_upload_desc_count do
		local desc<const>: *bm_constant_device_upload_desc = &device_uploads[device_upload_index]
		local packet<const>: *bm_rpu_constant_upload_device_packet = wp
		packet->header = sys_rpu_packet_kind | (sys_rpu_words_constant_upload_device << 16)
		packet->op = sys_rpu_op_constant_upload_device
		packet->bank_id = desc->bank_id
		packet->dst_word_offset = desc->dst_word_offset
		packet->source = desc->source
		packet->source_word_offset = desc->source_word_offset
		packet->word_count = desc->word_count
		wp = wp + sizeof(bm_rpu_constant_upload_device_packet)
		device_upload_index = device_upload_index + 1
	end
	local passes<const>: *bm_pass_desc[pass_desc_count] = pass_desc_addr
	local draws<const>: *bm_draw_desc[draw_desc_count] = draw_desc_addr
	local streams<const>: *bm_stream_bind_desc[stream_bind_desc_count] = stream_bind_desc_addr
	local constants<const>: *bm_constant_bind_desc[constant_bind_desc_count] = constant_bind_desc_addr
	local sampled_surface_binds<const>: *bm_sampled_surface_bind_desc[sampled_surface_bind_desc_count] = sampled_surface_bind_desc_addr
	local pass_index = 0
	while pass_index < pass_desc_count do
		local pass<const>: *bm_pass_desc = &passes[pass_index]
		local pass_packet<const>: *bm_rpu_begin_pass_packet = wp
		pass_packet->header = sys_rpu_packet_kind | (sys_rpu_words_begin_pass << 16)
		pass_packet->op = sys_rpu_op_begin_pass
		pass_packet->color_surface_id = pass->color_surface_id
		pass_packet->depth_surface_id = pass->depth_surface_id
		pass_packet->viewport_xy = pass->viewport_xy
		pass_packet->viewport_wh = pass->viewport_wh
		pass_packet->pass_ops = pass->pass_ops
		pass_packet->clear_color = pass->clear_color
		pass_packet->clear_depth_word = pass->clear_depth_word
		wp = wp + sizeof(bm_rpu_begin_pass_packet)
		local draw_index = pass->first_draw
		local draw_end<const> = draw_index + pass->draw_count
		while draw_index < draw_end do
			local draw<const>: *bm_draw_desc = &draws[draw_index]
			local draw_packet<const>: *bm_rpu_begin_draw_packet = wp
			draw_packet->header = sys_rpu_packet_kind | (sys_rpu_words_begin_draw << 16)
			draw_packet->op = sys_rpu_op_begin_draw
			draw_packet->shader_variant = draw->shader_variant
			draw_packet->primitive_index_type = draw->primitive_index_type
			draw_packet->pipeline_word = draw->pipeline_word
			draw_packet->vertex_count = draw->vertex_count
			draw_packet->instance_count = draw->instance_count
			draw_packet->index_buffer_id = draw->index_buffer_id
			draw_packet->index_byte_offset = draw->index_byte_offset
			draw_packet->index_count = draw->index_count
			wp = wp + sizeof(bm_rpu_begin_draw_packet)
			local stream_index = draw->stream_first
			local stream_end<const> = stream_index + draw->stream_count
			while stream_index < stream_end do
				local stream<const>: *bm_stream_bind_desc = &streams[stream_index]
				local packet<const>: *bm_rpu_bind_stream_packet = wp
				packet->header = sys_rpu_packet_kind | (sys_rpu_words_bind_stream << 16)
				packet->op = sys_rpu_op_bind_stream
				packet->stream_slot = stream->stream_slot
				packet->layout_id = stream->layout_id
				packet->buffer_id = stream->buffer_id
				packet->byte_offset = stream->byte_offset
				packet->step_rate = stream->step_rate
				wp = wp + sizeof(bm_rpu_bind_stream_packet)
				stream_index = stream_index + 1
			end
			local constant_index = draw->constant_first
			local constant_end<const> = constant_index + draw->constant_count
			while constant_index < constant_end do
				local constant<const>: *bm_constant_bind_desc = &constants[constant_index]
				local packet<const>: *bm_rpu_bind_constants_packet = wp
				packet->header = sys_rpu_packet_kind | (sys_rpu_words_bind_constants << 16)
				packet->op = sys_rpu_op_bind_constants
				packet->binding_slot = constant->binding_slot
				packet->bank_id = constant->bank_id
				packet->first_word = constant->first_word
				packet->word_count = constant->word_count
				wp = wp + sizeof(bm_rpu_bind_constants_packet)
				constant_index = constant_index + 1
			end
			local sampled_surface_index = draw->sampled_surface_first
			local sampled_surface_end<const> = sampled_surface_index + draw->sampled_surface_count
			while sampled_surface_index < sampled_surface_end do
				local sampled_surface_bind<const>: *bm_sampled_surface_bind_desc = &sampled_surface_binds[sampled_surface_index]
				local packet<const>: *bm_rpu_bind_texture_packet = wp
				packet->header = sys_rpu_packet_kind | (sys_rpu_words_bind_texture << 16)
				packet->op = sys_rpu_op_bind_texture
				packet->texture_slot = sampled_surface_bind->texture_slot
				packet->surface_id = sampled_surface_bind->surface_id
				wp = wp + sizeof(bm_rpu_bind_texture_packet)
				sampled_surface_index = sampled_surface_index + 1
			end
			local end_draw_packet<const>: *bm_rpu_end_draw_packet = wp
			end_draw_packet->header = sys_rpu_packet_kind | (sys_rpu_words_end_draw << 16)
			end_draw_packet->op = sys_rpu_op_end_draw
			wp = wp + sizeof(bm_rpu_end_draw_packet)
			draw_index = draw_index + 1
		end
		local end_pass_packet<const>: *bm_rpu_end_pass_packet = wp
		end_pass_packet->header = sys_rpu_packet_kind | (sys_rpu_words_end_pass << 16)
		end_pass_packet->op = sys_rpu_op_end_pass
		wp = wp + sizeof(bm_rpu_end_pass_packet)
		pass_index = pass_index + 1
	end
	local end_packet<const>: *word = wp
	*end_packet = sys_vdp_pkt_end
	wp = wp + sys_vdp_arg_stride
	vdp_stream_cursor = wp
	submit_current_stream()
	wait_interrupt(irq_dma_done | irq_dma_error)
end


*vdp_dither_register = 0
build_lua_atlas()
initialize_vdp_resources()
upload_atlas_to_vram()
setup_camera_input()
*inp_ctrl_register = inp_ctrl_arm

while true do
	wait_interrupt(irq_vblank)
	frame = frame + 1
	sprite_x = sprite_x + (sprite_direction * sprite_step)
	if sprite_x >= 184 then
		sprite_x = 184
		sprite_direction = -sprite_direction
	end
	if sprite_x <= 24 then
		sprite_x = 24
		sprite_direction = -sprite_direction
	end
	sprite_y = 88 + ((frame // 12) % 4)
	update_camera()
	draw_frame()
	*inp_ctrl_register = inp_ctrl_arm
end
