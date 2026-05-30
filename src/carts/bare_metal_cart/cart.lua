local numeric<const>          = require('bios/common/numeric')
local camobj<const>           = require('engine/camera_object')
local cam_view_terms<const>   = camobj.cam_view_terms
local cam_proj_terms<const>   = camobj.cam_proj_terms
local cam_screen_look<const>  = camobj.cam_screen_look
local cam_move<const>         = camobj.cam_move

local io_vdp_dither<const> = sys_vdp_dither
local io_irq_flags<const> = sys_irq_flags
local io_irq_ack<const> = sys_irq_ack
local io_dma_src<const> = sys_dma_src
local io_dma_dst<const> = sys_dma_dst
local io_dma_len<const> = sys_dma_len
local io_dma_ctrl<const> = sys_dma_ctrl
local io_vdp_fifo<const> = sys_vdp_fifo
local vdp_stream_base<const> = sys_vdp_stream_base
local vram_primary_slot_base<const> = sys_vram_primary_slot_base
local scratch_base<const> = sys_geo_scratch_base

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

local rpu_header_buffer_define<const> = sys_rpu_packet_kind | (sys_rpu_words_buffer_define << 16)
local rpu_header_buffer_upload_dma<const> = sys_rpu_packet_kind | (sys_rpu_words_buffer_upload_dma << 16)
local rpu_header_surface_define<const> = sys_rpu_packet_kind | (sys_rpu_words_surface_define << 16)
local rpu_header_constant_bank_define<const> = sys_rpu_packet_kind | (sys_rpu_words_constant_bank_define << 16)
local rpu_header_constant_upload_device<const> = sys_rpu_packet_kind | (sys_rpu_words_constant_upload_device << 16)
local rpu_header_begin_pass<const> = sys_rpu_packet_kind | (sys_rpu_words_begin_pass << 16)
local rpu_header_end_pass<const> = sys_rpu_packet_kind | (sys_rpu_words_end_pass << 16)
local rpu_header_begin_draw<const> = sys_rpu_packet_kind | (sys_rpu_words_begin_draw << 16)
local rpu_header_bind_stream<const> = sys_rpu_packet_kind | (sys_rpu_words_bind_stream << 16)
local rpu_header_bind_constants<const> = sys_rpu_packet_kind | (sys_rpu_words_bind_constants << 16)
local rpu_header_bind_texture<const> = sys_rpu_packet_kind | (sys_rpu_words_bind_texture << 16)
local rpu_header_end_draw<const> = sys_rpu_packet_kind | (sys_rpu_words_end_draw << 16)
local xf_matrix_packet_header<const> = sys_vdp_xf_packet_kind | ((1 + sys_vdp_xf_matrix_words) << 16)
local lpu_packet_header<const> = sys_vdp_lpu_packet_kind | ((1 + c1_words) << 16)
local jtu_matrix_packet_header<const> = sys_vdp_jtu_packet_kind | ((1 + sys_vdp_jtu_matrix_words) << 16)
local mfu_packet_header<const> = sys_vdp_mfu_packet_kind | ((1 + mfu_words) << 16)
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
local sampler_nearest<const> = sys_rpu_filter_nearest | (sys_rpu_filter_nearest << 2) | (sys_rpu_wrap_clamp << 4) | (sys_rpu_wrap_clamp << 6)

local vdp_stream_cursor = vdp_stream_base

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
	local used_bytes<const> = vdp_stream_cursor - vdp_stream_base
	if used_bytes ~= 0 then
		mem[io_dma_src] = vdp_stream_base
		mem[io_dma_dst] = io_vdp_fifo
		mem[io_dma_len] = used_bytes
		mem[io_dma_ctrl] = dma_ctrl_start
	end
end

local wait_dma<const> = function()
	local flags = 0
	repeat
		halt_until_irq
		flags = mem[io_irq_flags]
		mem[io_irq_ack] = flags
	until (flags & (irq_dma_done | irq_dma_error)) ~= 0
end

local wait_vblank<const> = function()
	local flags = 0
	repeat
		halt_until_irq
		flags = mem[io_irq_flags]
		mem[io_irq_ack] = flags
	until (flags & irq_vblank) ~= 0
end

local build_lua_atlas<const> = function()
	local px = 0
	local py = 0
	local wp = scratch_base
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
			mem[wp], wp = color, wp + 4
			px = px + 1
		end
		py = py + 1
	end
end

local upload_atlas_to_vram<const> = function()
	mem[io_dma_src] = scratch_base
	mem[io_dma_dst] = vram_primary_slot_base
	mem[io_dma_len] = atlas_bytes
	mem[io_dma_ctrl] = dma_ctrl_start
	wait_dma()
end

local write_background_vertices<const> = function()
	local vertices<const>: *bg_vertex[background_vertex_count] = background_vertex_addr
	memwrite(&vertices[0],
		{ { -1.0, 1.0 }, sky_top },
		{ { 1.0, 1.0 }, sky_top },
		{ { -1.0, -0.24 }, sky_horizon },
		{ { 1.0, 1.0 }, sky_top },
		{ { 1.0, -0.24 }, sky_horizon },
		{ { -1.0, -0.24 }, sky_horizon },
		{ { -1.0, -0.24 }, ground_far },
		{ { 1.0, -0.24 }, ground_far },
		{ { -1.0, -1.0 }, ground_near },
		{ { 1.0, -0.24 }, ground_far },
		{ { 1.0, -1.0 }, ground_near },
		{ { -1.0, -1.0 }, ground_near }
	)
end

local write_quad_vertices<const> = function()
	local vertices<const>: *quad_vertex[quad_vertex_count] = quad_vertex_addr
	memwrite(&vertices[0],
		{ { 0.0, 0.0, 0.0, 0.0 }, white },
		{ { 1.0, 0.0, 1.0, 0.0 }, white },
		{ { 0.0, 1.0, 0.0, 1.0 }, white },
		{ { 1.0, 1.0, 1.0, 1.0 }, white }
	)
end

local write_vector_vertices<const> = function()
	local vertices<const>: *bg_vertex[vector_vertex_count] = vector_vertex_addr
	memwrite(&vertices[0],
		{ { -0.88, -0.94 }, vector_tint },
		{ { 0.88, -0.94 }, vector_tint },
		{ { -0.88, -0.90 }, vector_tint },
		{ { 0.88, -0.94 }, vector_tint },
		{ { 0.88, -0.90 }, vector_tint },
		{ { -0.88, -0.90 }, vector_tint },
		{ { -0.72, -0.78 }, vector_tint },
		{ { 0.72, -0.78 }, vector_tint },
		{ { -0.72, -0.74 }, vector_tint },
		{ { 0.72, -0.78 }, vector_tint },
		{ { 0.72, -0.74 }, vector_tint },
		{ { -0.72, -0.74 }, vector_tint },
		{ { -0.92, -0.62 }, vector_tint },
		{ { -0.86, -0.62 }, vector_tint },
		{ { -0.92, -0.56 }, vector_tint },
		{ { -0.86, -0.62 }, vector_tint },
		{ { -0.86, -0.56 }, vector_tint },
		{ { -0.92, -0.56 }, vector_tint },
		{ { 0.86, -0.62 }, vector_tint },
		{ { 0.92, -0.62 }, vector_tint },
		{ { 0.86, -0.56 }, vector_tint },
		{ { 0.92, -0.62 }, vector_tint },
		{ { 0.92, -0.56 }, vector_tint },
		{ { 0.86, -0.56 }, vector_tint }
	)
end

local write_mat4_vertices<const> = function()
	local vertices<const>: *mat4_vertex[mat4_vertex_count] = mat4_vertex_addr
	memwrite(&vertices[0],
		{ { 0.0, 0.12, 0.0 }, white },
		{ { -0.10, -0.08, 0.0 }, white },
		{ { 0.10, -0.08, 0.0 }, white }
	)
end

local write_mesh_vertices<const> = function(morph_a, morph_b)
	local top_y<const> = 0.62 + morph_a
	local bottom_y<const> = -0.62 - morph_b
	local radius_x<const> = 0.56 + morph_b
	local radius_z<const> = 0.56 + morph_a
	local mesh_uv<const> = 0.46875
	local vertices<const>: *mesh_vertex[mesh_vertex_count] = mesh_vertex_addr
	memwrite(&vertices[0],
		{ { 0.0, top_y, 0.0 }, { 0.0, top_y, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, 0.0, radius_z }, { 0.0, 0.0, radius_z }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { radius_x, 0.0, 0.0 }, { radius_x, 0.0, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, top_y, 0.0 }, { 0.0, top_y, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { -radius_x, 0.0, 0.0 }, { -radius_x, 0.0, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, 0.0, radius_z }, { 0.0, 0.0, radius_z }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, top_y, 0.0 }, { 0.0, top_y, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, 0.0, -radius_z }, { 0.0, 0.0, -radius_z }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { -radius_x, 0.0, 0.0 }, { -radius_x, 0.0, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, top_y, 0.0 }, { 0.0, top_y, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { radius_x, 0.0, 0.0 }, { radius_x, 0.0, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, 0.0, -radius_z }, { 0.0, 0.0, -radius_z }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, bottom_y, 0.0 }, { 0.0, bottom_y, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { radius_x, 0.0, 0.0 }, { radius_x, 0.0, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, 0.0, radius_z }, { 0.0, 0.0, radius_z }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, bottom_y, 0.0 }, { 0.0, bottom_y, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, 0.0, radius_z }, { 0.0, 0.0, radius_z }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { -radius_x, 0.0, 0.0 }, { -radius_x, 0.0, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, bottom_y, 0.0 }, { 0.0, bottom_y, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { -radius_x, 0.0, 0.0 }, { -radius_x, 0.0, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, 0.0, -radius_z }, { 0.0, 0.0, -radius_z }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, bottom_y, 0.0 }, { 0.0, bottom_y, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { 0.0, 0.0, -radius_z }, { 0.0, 0.0, -radius_z }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word },
		{ { radius_x, 0.0, 0.0 }, { radius_x, 0.0, 0.0 }, { mesh_uv, mesh_uv }, mesh_tint, mesh_joint_word, mesh_weight_word }
	)
end

local write_mesh_indices<const> = function()
	local wp = mesh_index_addr
	local index = 0
	while index < mesh_index_count do
		mem[wp], wp = ((index + 1) << 16) | index, wp + 4
		index = index + 2
	end
end

local write_lighting_constants<const> = function()
	local wp = c1_addr
	local end_addr<const> = c1_addr + c1_bytes
	while wp < end_addr do
		mem[wp], wp = 0, wp + 4
	end
	-- Ambient: words 0-3 (r, g, b, intensity)
	wp = c1_addr
	memwritef32(wp, 0.15, 0.15, 0.20, 1.0)
	wp = wp + 16
	-- Dir light 0: words 4-11 (dir.xyz+pad, color.rgb+intensity)
	memwritef32(wp, -0.45, 0.70, 0.55, 0.0, 1.0, 0.95, 0.85, 0.80)
	wp = wp + 32
	-- Dir light 1: words 12-19 (blueish fill)
	memwritef32(wp, 0.50, -0.20, -0.30, 0.0, 0.20, 0.40, 0.80, 0.40)
	-- Point light 0: words 36-43 (pos.xyz+range, color.rgb+intensity)
	wp = c1_addr + 36 * 4
	memwritef32(wp, 1.2, 0.5, 0.8, 3.0, 1.0, 0.5, 0.1, 0.8)
end

local write_morph_deltas<const> = function()
	local phase<const> = frame % 16
	local t<const> = phase < 8 and (phase * 0.125) or (2.0 - phase * 0.125)
	local morph_dy<const> = (t - 0.5) * 0.30
	local wp = morph_vertex_addr
	local i = 0
	while i < mesh_vertex_count do
		memwritef32(wp, 0.0, morph_dy, 0.0, 0.0, morph_dy * 2.0, 0.0)
		wp = wp + morph_vertex_stride
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
	memwrite(c0_addr,
		numeric.q16(proj_fx * vm_00),
		numeric.q16(proj_fy * vm_10),
		numeric.q16(proj_a  * vm_20),
		numeric.q16(-vm_20),
		numeric.q16(proj_fx * vm_01),
		numeric.q16(proj_fy * vm_11),
		numeric.q16(proj_a  * vm_21),
		numeric.q16(-vm_21),
		numeric.q16(proj_fx * vm_02),
		numeric.q16(proj_fy * vm_12),
		numeric.q16(proj_a  * vm_22),
		numeric.q16(-vm_22),
		numeric.q16(proj_fx * vm_03),
		numeric.q16(proj_fy * vm_13),
		numeric.q16(proj_a  * vm_23 + proj_b),
		numeric.q16(-vm_23)
	)
end

local write_joint_constants<const> = function()
	local joint_phase<const> = frame % 8
	local joint_translate_x<const> = (joint_phase - 4) * 0.03125
	local joints<const>: *q16_matrix[2] = joint0_addr
	memwrite(&joints[0],
		{ q16_one, 0, 0, 0, 0, q16_one, 0, 0, 0, 0, q16_one, 0, 0, 0, 0, q16_one },
		{ q16_one, 0, 0, 0, 0, q16_one, 0, 0, 0, 0, q16_one, 0, numeric.q16(joint_translate_x), 0, 0, q16_one }
	)
end

local write_mfu_constants<const> = function()
	mem[mfu_addr] = 0
end

local setup_camera_input<const> = function()
	mem[sys_inp_player] = 1
	mem[sys_inp_action] = &'moveforward'
	mem[sys_inp_bind] = &'KeyW'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'movebackward'
	mem[sys_inp_bind] = &'KeyS'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'moveleft'
	mem[sys_inp_bind] = &'KeyA'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'moveright'
	mem[sys_inp_bind] = &'KeyD'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'panup'
	mem[sys_inp_bind] = &'KeyR'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'pandown'
	mem[sys_inp_bind] = &'KeyF'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'turnleft'
	mem[sys_inp_bind] = &'KeyQ'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'turnright'
	mem[sys_inp_bind] = &'KeyE'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'pitchup'
	mem[sys_inp_bind] = &'KeyT'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'pitchdown'
	mem[sys_inp_bind] = &'KeyG'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'boost'
	mem[sys_inp_bind] = &'ShiftLeft'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	-- Camera selection: 1 = free_cam, 2 = side_cam (mirrors world.activeCameraId in TS)
	mem[sys_inp_action] = &'camsel1'
	mem[sys_inp_bind] = &'Digit1'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'camsel2'
	mem[sys_inp_bind] = &'Digit2'
	mem[sys_inp_ctrl] = inp_ctrl_commit
end

local update_camera<const> = function()
	mem[sys_inp_player] = 1
	-- Camera selection (mirrors world.activeCameraId setter in TypeScript)
	mem[sys_inp_query] = &'camsel1[p]'
	if mem[sys_inp_status] ~= 0 then active_cam_id = free_cam.id end
	mem[sys_inp_query] = &'camsel2[p]'
	if mem[sys_inp_status] ~= 0 then active_cam_id = side_cam.id end
	-- Resolve active camera from id (mirrors world.activeCamera3D getter).
	local active<const> = active_cam_id == side_cam.id and side_cam or free_cam
	-- Speed settings
	local yaw_step = 0.035
	local pitch_step = 0.035
	local move = 0.075
	mem[sys_inp_query] = &'boost[p]'
	if mem[sys_inp_status] ~= 0 then
		yaw_step = 0.055
		pitch_step = 0.055
		move = 0.18
	end
	-- Rotation: screen-space look (yaw around camera-up, pitch around camera-right)
	local dyaw = 0.0
	local dpitch = 0.0
	mem[sys_inp_query] = &'turnleft[p]'
	if mem[sys_inp_status] ~= 0 then dyaw = yaw_step end
	mem[sys_inp_query] = &'turnright[p]'
	if mem[sys_inp_status] ~= 0 then dyaw = -yaw_step end
	mem[sys_inp_query] = &'pitchup[p]'
	if mem[sys_inp_status] ~= 0 then dpitch = pitch_step end
	mem[sys_inp_query] = &'pitchdown[p]'
	if mem[sys_inp_status] ~= 0 then dpitch = -pitch_step end
	if dyaw ~= 0.0 or dpitch ~= 0.0 then
		cam_screen_look(active, dyaw, dpitch, 0.0)
	end
	-- Translation: accumulate per-axis amounts, then apply in one cam_move call.
	-- cam_move calls q_basis once internally, covering all three body axes.
	local dfwd   = 0.0
	local dright = 0.0
	local dup    = 0.0
	mem[sys_inp_query] = &'moveforward[p]'
	if mem[sys_inp_status] ~= 0 then dfwd = move end
	mem[sys_inp_query] = &'movebackward[p]'
	if mem[sys_inp_status] ~= 0 then dfwd = -move end
	mem[sys_inp_query] = &'moveleft[p]'
	if mem[sys_inp_status] ~= 0 then dright = -move end
	mem[sys_inp_query] = &'moveright[p]'
	if mem[sys_inp_status] ~= 0 then dright = move end
	mem[sys_inp_query] = &'panup[p]'
	if mem[sys_inp_status] ~= 0 then dup = move end
	mem[sys_inp_query] = &'pandown[p]'
	if mem[sys_inp_status] ~= 0 then dup = -move end
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
	memwrite(&instances[0],
		{ { 512.0 * inv_half_screen_width, 0.0, parallax_x * inv_half_screen_width - 1.0, 0.70, 0.0, -96.0 * inv_half_screen_height, 1.0 - 24.0 * inv_half_screen_height, 0.0, 0.0, 1.0, 1.0 }, parallax_far_tint },
		{ { 512.0 * inv_half_screen_width, 0.0, parallax_near_x * inv_half_screen_width - 1.0, 0.42, 0.0, -64.0 * inv_half_screen_height, 1.0 - 48.0 * inv_half_screen_height, 0.0, 0.0, 1.0, 1.0 }, parallax_near_tint },
		{ { 48.0 * inv_half_screen_width, 0.0, sprite_x * inv_half_screen_width - 1.0, 0.20, 0.0, -48.0 * inv_half_screen_height, 1.0 - sprite_y * inv_half_screen_height, 0.0, 0.0, 1.0, 1.0 }, sprite_tint },
		{ { 38.0 * inv_half_screen_width, 0.0, billboard_x_a * inv_half_screen_width - 1.0, 0.12, 0.0, -38.0 * inv_half_screen_height, 1.0 - billboard_y_a * inv_half_screen_height, 0.0, 0.0, 1.0, 1.0 }, billboard_tint_a },
		{ { 32.0 * inv_half_screen_width, 0.0, billboard_x_b * inv_half_screen_width - 1.0, 0.14, 0.0, -32.0 * inv_half_screen_height, 1.0 - billboard_y_b * inv_half_screen_height, 0.0, 0.0, 1.0, 1.0 }, billboard_tint_b },
		{ { 2.0, 0.0, -1.0, 0.0, 0.0, -2.0, 1.0, 0.0, 0.0, 1.0, 1.0 }, white }
	)
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
	memwritef32(&mat4_instances[0].mvp[0],
		pvc0r0,                    -- col0 r0
		pvc0r1,                    -- col0 r1
		pvc0r2,                    -- col0 r2
		pvc0r3,                    -- col0 r3
		pvc1r0,                    -- col1 r0
		pvc1r1,                    -- col1 r1
		pvc1r2,                    -- col1 r2
		pvc1r3,                    -- col1 r3
		pvc2r0,                    -- col2 r0
		pvc2r1,                    -- col2 r1
		pvc2r2,                    -- col2 r2
		pvc2r3,                    -- col2 r3
		proj_fx * vm1_03,          -- col3 r0
		proj_fy * vm1_13,          -- col3 r1
		proj_a  * vm1_23 + proj_b, -- col3 r2
		-vm1_23                    -- col3 r3
	)
	mat4_instances[0].color = mat4_tint_a
	-- Instance 2 MVP: xy scale applied to cols 0 and 1
	memwritef32(&mat4_instances[1].mvp[0],
		pvc0r0 * sc2,              -- col0 r0
		pvc0r1 * sc2,              -- col0 r1
		pvc0r2 * sc2,              -- col0 r2
		pvc0r3 * sc2,              -- col0 r3
		pvc1r0 * sc2,              -- col1 r0
		pvc1r1 * sc2,              -- col1 r1
		pvc1r2 * sc2,              -- col1 r2
		pvc1r3 * sc2,              -- col1 r3
		pvc2r0,                    -- col2 r0 (z scale = 1)
		pvc2r1,                    -- col2 r1
		pvc2r2,                    -- col2 r2
		pvc2r3,                    -- col2 r3
		proj_fx * vm2_03,          -- col3 r0
		proj_fy * vm2_13,          -- col3 r1
		proj_a  * vm2_23 + proj_b, -- col3 r2
		-vm2_23                    -- col3 r3
	)
	mat4_instances[1].color = mat4_tint_b
end

local initialize_vdp_resources<const> = function()
	write_quad_vertices()
	write_background_vertices()
	write_vector_vertices()
	write_mat4_vertices()
	write_mesh_indices()
	write_lighting_constants()
	local wp = vdp_stream_base
	memwrite(wp, rpu_header_surface_define, sys_rpu_op_surface_define, sys_rpu_surface_primary, atlas_width | (atlas_height << 16), rpu_surface_rgba_texture)
	wp = wp + 20
	memwrite(wp, rpu_header_surface_define, sys_rpu_op_surface_define, scene_color_surface, screen_width | (screen_height << 16), rpu_surface_rgba_color_texture)
	wp = wp + 20
	memwrite(wp, rpu_header_surface_define, sys_rpu_op_surface_define, scene_depth_surface, screen_width | (screen_height << 16), rpu_surface_depth)
	wp = wp + 20
	memwrite(wp, rpu_header_buffer_define, sys_rpu_op_buffer_define, quad_buffer, quad_vertex_bytes, sys_rpu_usage_vertex)
	wp = wp + 20
	memwrite(wp, rpu_header_buffer_upload_dma, sys_rpu_op_buffer_upload_dma, quad_buffer, 0, quad_vertex_addr, quad_vertex_bytes)
	wp = wp + 24
	memwrite(wp, rpu_header_buffer_define, sys_rpu_op_buffer_define, background_buffer, background_vertex_bytes, sys_rpu_usage_vertex)
	wp = wp + 20
	memwrite(wp, rpu_header_buffer_upload_dma, sys_rpu_op_buffer_upload_dma, background_buffer, 0, background_vertex_addr, background_vertex_bytes)
	wp = wp + 24
	memwrite(wp, rpu_header_buffer_define, sys_rpu_op_buffer_define, vector_buffer, vector_vertex_bytes, sys_rpu_usage_vertex)
	wp = wp + 20
	memwrite(wp, rpu_header_buffer_upload_dma, sys_rpu_op_buffer_upload_dma, vector_buffer, 0, vector_vertex_addr, vector_vertex_bytes)
	wp = wp + 24
	memwrite(wp, rpu_header_buffer_define, sys_rpu_op_buffer_define, mat4_vertex_buffer, mat4_vertex_bytes, sys_rpu_usage_vertex)
	wp = wp + 20
	memwrite(wp, rpu_header_buffer_upload_dma, sys_rpu_op_buffer_upload_dma, mat4_vertex_buffer, 0, mat4_vertex_addr, mat4_vertex_bytes)
	wp = wp + 24
	memwrite(wp, rpu_header_buffer_define, sys_rpu_op_buffer_define, mat4_instance_buffer, mat4_instance_bytes, sys_rpu_usage_vertex)
	wp = wp + 20
	memwrite(wp, rpu_header_buffer_define, sys_rpu_op_buffer_define, mesh_buffer, mesh_vertex_bytes, sys_rpu_usage_vertex)
	wp = wp + 20
	memwrite(wp, rpu_header_buffer_define, sys_rpu_op_buffer_define, mesh_index_buffer, mesh_index_bytes, sys_rpu_usage_index)
	wp = wp + 20
	memwrite(wp, rpu_header_buffer_upload_dma, sys_rpu_op_buffer_upload_dma, mesh_index_buffer, 0, mesh_index_addr, mesh_index_bytes)
	wp = wp + 24
	memwrite(wp, rpu_header_buffer_define, sys_rpu_op_buffer_define, morph_buffer, morph_vertex_bytes, sys_rpu_usage_vertex)
	wp = wp + 20
	memwrite(wp, rpu_header_buffer_define, sys_rpu_op_buffer_define, instance_buffer, instance_bytes, sys_rpu_usage_vertex)
	wp = wp + 20
	mem[wp], wp = sys_vdp_pkt_end, wp + 4
	vdp_stream_cursor = wp
	submit_current_stream()
	wait_dma()
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
	mem[wp], wp = xf_matrix_packet_header, wp + 4
	mem[wp], wp = mesh_matrix_index * sys_vdp_xf_matrix_words, wp + 4
	local index = 0
	while index < sys_vdp_xf_matrix_words do
		mem[wp], wp = mem[c0_addr + index * 4], wp + 4
		index = index + 1
	end
	mem[wp], wp = lpu_packet_header, wp + 4
	mem[wp], wp = 0, wp + 4
	index = 0
	while index < c1_words do
		mem[wp], wp = mem[c1_addr + index * 4], wp + 4
		index = index + 1
	end
	mem[wp], wp = jtu_matrix_packet_header, wp + 4
	mem[wp], wp = 0, wp + 4
	index = 0
	while index < sys_vdp_jtu_matrix_words do
		mem[wp], wp = mem[joint0_addr + index * 4], wp + 4
		index = index + 1
	end
	mem[wp], wp = jtu_matrix_packet_header, wp + 4
	mem[wp], wp = mesh_joint_matrix_index * sys_vdp_jtu_matrix_words, wp + 4
	index = 0
	while index < sys_vdp_jtu_matrix_words do
		mem[wp], wp = mem[joint1_addr + index * 4], wp + 4
		index = index + 1
	end
	mem[wp], wp = mfu_packet_header, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = mem[mfu_addr], wp + 4
	memwrite(wp, rpu_header_buffer_upload_dma, sys_rpu_op_buffer_upload_dma, mesh_buffer, 0, mesh_vertex_addr, mesh_vertex_bytes)
	wp = wp + 24
	memwrite(wp, rpu_header_buffer_upload_dma, sys_rpu_op_buffer_upload_dma, morph_buffer, 0, morph_vertex_addr, morph_vertex_bytes)
	wp = wp + 24
	memwrite(wp, rpu_header_buffer_upload_dma, sys_rpu_op_buffer_upload_dma, mat4_instance_buffer, 0, mat4_instance_addr, mat4_instance_bytes)
	wp = wp + 24
	memwrite(wp, rpu_header_buffer_upload_dma, sys_rpu_op_buffer_upload_dma, instance_buffer, 0, instance_addr, instance_bytes)
	wp = wp + 24
	memwrite(wp, rpu_header_constant_bank_define, sys_rpu_op_constant_bank_define, 0, 0, c0_words)
	wp = wp + 20
	memwrite(wp, rpu_header_constant_bank_define, sys_rpu_op_constant_bank_define, 1, c0_words, c1_words)
	wp = wp + 20
	memwrite(wp, rpu_header_constant_bank_define, sys_rpu_op_constant_bank_define, 2, c0_words + c1_words, joint_words)
	wp = wp + 20
	memwrite(wp, rpu_header_constant_upload_device, sys_rpu_op_constant_upload_device, 0, 0, sys_rpu_constant_source_xf_q16, mesh_matrix_index * sys_vdp_xf_matrix_words, c0_words)
	wp = wp + 28
	memwrite(wp, rpu_header_constant_upload_device, sys_rpu_op_constant_upload_device, 1, 0, sys_rpu_constant_source_lpu_raw, 0, c1_words)
	wp = wp + 28
	memwrite(wp, rpu_header_constant_upload_device, sys_rpu_op_constant_upload_device, 2, 0, sys_rpu_constant_source_jtu_q16, 0, joint_words)
	wp = wp + 28
	memwrite(wp, rpu_header_begin_pass, sys_rpu_op_begin_pass, scene_color_surface, scene_depth_surface, 0, screen_width | (screen_height << 16), sys_rpu_pass_color_clear | sys_rpu_pass_depth_clear, 0xff071a3a, 0xffffffff)
	wp = wp + 36
	memwrite(wp, rpu_header_begin_draw, sys_rpu_op_begin_draw, sys_rpu_shader_v2_c4, rpu_primitive_triangles, rpu_pipeline_opaque, background_vertex_count, 1, sys_rpu_resource_none, 0, 0)
	wp = wp + 40
	memwrite(wp, rpu_header_bind_stream, sys_rpu_op_bind_stream, 0, sys_rpu_layout_v2_c4, background_buffer, 0, 0)
	wp = wp + 28
	memwrite(wp, rpu_header_end_draw, sys_rpu_op_end_draw)
	wp = wp + 8
	memwrite(wp, rpu_header_begin_draw, sys_rpu_op_begin_draw, sys_rpu_shader_v2_c4, rpu_primitive_triangles, rpu_pipeline_opaque, vector_vertex_count, 1, sys_rpu_resource_none, 0, 0)
	wp = wp + 40
	memwrite(wp, rpu_header_bind_stream, sys_rpu_op_bind_stream, 0, sys_rpu_layout_v2_c4, vector_buffer, 0, 0)
	wp = wp + 28
	memwrite(wp, rpu_header_end_draw, sys_rpu_op_end_draw)
	wp = wp + 8
	memwrite(wp, rpu_header_begin_draw, sys_rpu_op_begin_draw, sys_rpu_shader_v2_c4, rpu_primitive_lines, rpu_pipeline_opaque, 2, 1, sys_rpu_resource_none, 0, 0)
	wp = wp + 40
	memwrite(wp, rpu_header_bind_stream, sys_rpu_op_bind_stream, 0, sys_rpu_layout_v2_c4, vector_buffer, vector_vertex_stride * 2, 0)
	wp = wp + 28
	memwrite(wp, rpu_header_end_draw, sys_rpu_op_end_draw)
	wp = wp + 8
	memwrite(wp, rpu_header_begin_draw, sys_rpu_op_begin_draw, sys_rpu_shader_v2_c4, rpu_primitive_points, rpu_pipeline_depth_alpha, 1, 1, sys_rpu_resource_none, 0, 0)
	wp = wp + 40
	memwrite(wp, rpu_header_bind_stream, sys_rpu_op_bind_stream, 0, sys_rpu_layout_v2_c4, vector_buffer, vector_vertex_stride * 2, 0)
	wp = wp + 28
	memwrite(wp, rpu_header_end_draw, sys_rpu_op_end_draw)
	wp = wp + 8
	memwrite(wp, rpu_header_begin_draw, sys_rpu_op_begin_draw, sys_rpu_shader_v2_t2_c4_i_affine2, rpu_primitive_triangle_strip, rpu_pipeline_depth_opaque, quad_vertex_count, sprite_instance_count, sys_rpu_resource_none, 0, 0)
	wp = wp + 40
	memwrite(wp, rpu_header_bind_stream, sys_rpu_op_bind_stream, 0, sys_rpu_layout_v2_t2_c4, quad_buffer, 0, 0)
	wp = wp + 28
	memwrite(wp, rpu_header_bind_stream, sys_rpu_op_bind_stream, 1, sys_rpu_layout_i_affine2_trect_c4, instance_buffer, 0, 1)
	wp = wp + 28
	memwrite(wp, rpu_header_bind_texture, sys_rpu_op_bind_texture, 0, sys_rpu_surface_primary, sampler_nearest)
	wp = wp + 20
	memwrite(wp, rpu_header_end_draw, sys_rpu_op_end_draw)
	wp = wp + 8
	memwrite(wp, rpu_header_begin_draw, sys_rpu_op_begin_draw, sys_rpu_shader_v3_c4_i_mat4, rpu_primitive_triangles, rpu_pipeline_depth_opaque, mat4_vertex_count, mat4_instance_count, sys_rpu_resource_none, 0, 0)
	wp = wp + 40
	memwrite(wp, rpu_header_bind_stream, sys_rpu_op_bind_stream, 0, sys_rpu_layout_v3_c4, mat4_vertex_buffer, 0, 0)
	wp = wp + 28
	memwrite(wp, rpu_header_bind_stream, sys_rpu_op_bind_stream, 1, sys_rpu_layout_i_mat4_c4, mat4_instance_buffer, 0, 1)
	wp = wp + 28
	memwrite(wp, rpu_header_end_draw, sys_rpu_op_end_draw)
	wp = wp + 8
	memwrite(wp, rpu_header_begin_draw, sys_rpu_op_begin_draw, sys_rpu_shader_v3_c4_c0, rpu_primitive_triangles, rpu_pipeline_depth_opaque, mat4_vertex_count, 1, sys_rpu_resource_none, 0, 0)
	wp = wp + 40
	memwrite(wp, rpu_header_bind_stream, sys_rpu_op_bind_stream, 0, sys_rpu_layout_v3_c4, mat4_vertex_buffer, 0, 0)
	wp = wp + 28
	memwrite(wp, rpu_header_bind_constants, sys_rpu_op_bind_constants, 0, 0, 0, c0_words)
	wp = wp + 24
	memwrite(wp, rpu_header_end_draw, sys_rpu_op_end_draw)
	wp = wp + 8
	memwrite(wp, rpu_header_begin_draw, sys_rpu_op_begin_draw, sys_rpu_shader_v3_n3_t2_c4_j4_w4_c0_c1 | sys_rpu_shader_flag_morph | sys_rpu_shader_flag_t1, rpu_primitive_indexed_triangles, rpu_pipeline_depth_opaque, mesh_vertex_count, 1, mesh_index_buffer, 0, mesh_index_count)
	wp = wp + 40
	memwrite(wp, rpu_header_bind_stream, sys_rpu_op_bind_stream, 0, sys_rpu_layout_v3_n3_t2_c4_j4_w4, mesh_buffer, 0, 0)
	wp = wp + 28
	memwrite(wp, rpu_header_bind_stream, sys_rpu_op_bind_stream, 2, sys_rpu_layout_v3_dm3, morph_buffer, 0, 0)
	wp = wp + 28
	memwrite(wp, rpu_header_bind_constants, sys_rpu_op_bind_constants, 0, 0, 0, c0_words)
	wp = wp + 24
	memwrite(wp, rpu_header_bind_constants, sys_rpu_op_bind_constants, 1, 2, 0, joint_words)
	wp = wp + 24
	memwrite(wp, rpu_header_bind_constants, sys_rpu_op_bind_constants, 2, 1, 0, c1_words)
	wp = wp + 24
	memwrite(wp, rpu_header_bind_texture, sys_rpu_op_bind_texture, 0, sys_rpu_surface_primary, sampler_nearest)
	wp = wp + 20
	memwrite(wp, rpu_header_bind_texture, sys_rpu_op_bind_texture, 1, sys_rpu_surface_primary, sampler_nearest)
	wp = wp + 20
	memwrite(wp, rpu_header_end_draw, sys_rpu_op_end_draw)
	wp = wp + 8
	memwrite(wp, rpu_header_end_pass, sys_rpu_op_end_pass)
	wp = wp + 8
	memwrite(wp, rpu_header_begin_pass, sys_rpu_op_begin_pass, sys_rpu_resource_none, sys_rpu_resource_none, 0, screen_width | (screen_height << 16), 0, 0, 0)
	wp = wp + 36
	memwrite(wp, rpu_header_begin_draw, sys_rpu_op_begin_draw, sys_rpu_shader_v2_t2_c4_i_affine2, rpu_primitive_triangle_strip, rpu_pipeline_opaque, quad_vertex_count, present_instance_count, sys_rpu_resource_none, 0, 0)
	wp = wp + 40
	memwrite(wp, rpu_header_bind_stream, sys_rpu_op_bind_stream, 0, sys_rpu_layout_v2_t2_c4, quad_buffer, 0, 0)
	wp = wp + 28
	memwrite(wp, rpu_header_bind_stream, sys_rpu_op_bind_stream, 1, sys_rpu_layout_i_affine2_trect_c4, instance_buffer, present_instance_offset, 1)
	wp = wp + 28
	memwrite(wp, rpu_header_bind_texture, sys_rpu_op_bind_texture, 0, scene_color_surface, sampler_nearest)
	wp = wp + 20
	memwrite(wp, rpu_header_end_draw, sys_rpu_op_end_draw)
	wp = wp + 8
	memwrite(wp, rpu_header_end_pass, sys_rpu_op_end_pass)
	wp = wp + 8
	mem[wp], wp = sys_vdp_pkt_end, wp + 4
	vdp_stream_cursor = wp
	submit_current_stream()
	wait_dma()
end

mem[io_vdp_dither] = 0
build_lua_atlas()
initialize_vdp_resources()
upload_atlas_to_vram()
setup_camera_input()
mem[sys_inp_ctrl] = inp_ctrl_arm

while true do
	wait_vblank()
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
	mem[sys_inp_ctrl] = inp_ctrl_arm
end
