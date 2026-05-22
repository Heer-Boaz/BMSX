local vdp_rpu_quads<const> = require('bios/vdp_rpu_quads')
local vdp_rpu<const> = require('bios/vdp_rpu')
local vdp_xf<const> = require('bios/vdp_xf')
local vdp_lpu<const> = require('bios/vdp_lpu')
local vdp_jtu<const> = require('bios/vdp_jtu')
local vdp_mfu<const> = require('bios/vdp_mfu')
local numeric<const> = require('bios/common/numeric')

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

local quad_buffer<const> = 1
local background_buffer<const> = 2
local mesh_buffer<const> = 3
local instance_buffer<const> = 4
local mesh_index_buffer<const> = 5
local vector_buffer<const> = 6
local mat4_vertex_buffer<const> = 7
local mat4_instance_buffer<const> = 8
local scene_color_surface<const> = 4
local scene_depth_surface<const> = 5
local quad_vertex_count<const> = 4
local quad_vertex_stride<const> = 20
local quad_vertex_bytes<const> = quad_vertex_count * quad_vertex_stride
local background_vertex_count<const> = 12
local background_vertex_stride<const> = 12
local background_vertex_bytes<const> = background_vertex_count * background_vertex_stride
local vector_vertex_count<const> = 24
local vector_vertex_stride<const> = 12
local vector_vertex_bytes<const> = vector_vertex_count * vector_vertex_stride
local mat4_vertex_count<const> = 3
local mat4_vertex_stride<const> = 16
local mat4_vertex_bytes<const> = mat4_vertex_count * mat4_vertex_stride
local mat4_instance_count<const> = 2
local mat4_instance_stride<const> = 68
local mat4_instance_bytes<const> = mat4_instance_count * mat4_instance_stride
local mesh_vertex_count<const> = 24
local mesh_vertex_stride<const> = 44
local mesh_vertex_bytes<const> = mesh_vertex_count * mesh_vertex_stride
local mesh_index_count<const> = 24
local mesh_index_bytes<const> = mesh_index_count * 2
local sprite_instance_count<const> = 5
local present_instance_count<const> = 1
local instance_count<const> = sprite_instance_count + present_instance_count
local instance_stride<const> = 48
local instance_bytes<const> = instance_count * instance_stride
local present_instance_offset<const> = sprite_instance_count * instance_stride
local c0_words<const> = 16
local c1_words<const> = 64
local joint_words<const> = 384
local mfu_words<const> = 1
local c0_bytes<const> = c0_words * 4
local c1_bytes<const> = c1_words * 4
local joint_matrix_bytes<const> = c0_bytes

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
local mesh_matrix_index<const> = 2
local mesh_joint_matrix_index<const> = 1

local white<const> = 0xffffffff
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
local billboard_tint_a<const> = 0xffffffff
local billboard_tint_b<const> = 0xffffffff
local mesh_tint<const> = white
local mesh_joint_word<const> = 0x00000001
local mesh_weight_word<const> = 0x000000ff

local sampler_nearest<const> = vdp_rpu.sampler(vdp_rpu.filter_nearest, vdp_rpu.filter_nearest, vdp_rpu.wrap_clamp, vdp_rpu.wrap_clamp)

local frame = 0
local sprite_x = 112
local sprite_y = 92
local sprite_step<const> = 4
local sprite_direction = 1

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
	local wp = background_vertex_addr
	memwritef32(wp,
		-1.0,
		1.0
	)
	wp = wp + 8
	mem[wp], wp = sky_top, wp + 4
	memwritef32(wp,
		1.0,
		1.0
	)
	wp = wp + 8
	mem[wp], wp = sky_top, wp + 4
	memwritef32(wp,
		-1.0,
		-0.24
	)
	wp = wp + 8
	mem[wp], wp = sky_horizon, wp + 4
	memwritef32(wp,
		1.0,
		1.0
	)
	wp = wp + 8
	mem[wp], wp = sky_top, wp + 4
	memwritef32(wp,
		1.0,
		-0.24
	)
	wp = wp + 8
	mem[wp], wp = sky_horizon, wp + 4
	memwritef32(wp,
		-1.0,
		-0.24
	)
	wp = wp + 8
	mem[wp], wp = sky_horizon, wp + 4
	memwritef32(wp,
		-1.0,
		-0.24
	)
	wp = wp + 8
	mem[wp], wp = ground_far, wp + 4
	memwritef32(wp,
		1.0,
		-0.24
	)
	wp = wp + 8
	mem[wp], wp = ground_far, wp + 4
	memwritef32(wp,
		-1.0,
		-1.0
	)
	wp = wp + 8
	mem[wp], wp = ground_near, wp + 4
	memwritef32(wp,
		1.0,
		-0.24
	)
	wp = wp + 8
	mem[wp], wp = ground_far, wp + 4
	memwritef32(wp,
		1.0,
		-1.0
	)
	wp = wp + 8
	mem[wp], wp = ground_near, wp + 4
	memwritef32(wp,
		-1.0,
		-1.0
	)
	wp = wp + 8
	mem[wp], wp = ground_near, wp + 4
end

local write_quad_vertices<const> = function()
	local wp = quad_vertex_addr
	memwritef32(wp,
		0.0,
		0.0,
		0.0,
		0.0
	)
	wp = wp + 16
	mem[wp], wp = white, wp + 4
	memwritef32(wp,
		1.0,
		0.0,
		1.0,
		0.0
	)
	wp = wp + 16
	mem[wp], wp = white, wp + 4
	memwritef32(wp,
		0.0,
		1.0,
		0.0,
		1.0
	)
	wp = wp + 16
	mem[wp], wp = white, wp + 4
	memwritef32(wp,
		1.0,
		1.0,
		1.0,
		1.0
	)
	wp = wp + 16
	mem[wp], wp = white, wp + 4
end

local write_vector_vertices<const> = function()
	local wp = vector_vertex_addr
	memwritef32(wp,
		-0.88,
		-0.94
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		0.88,
		-0.94
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		-0.88,
		-0.90
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		0.88,
		-0.94
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		0.88,
		-0.90
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		-0.88,
		-0.90
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		-0.72,
		-0.78
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		0.72,
		-0.78
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		-0.72,
		-0.74
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		0.72,
		-0.78
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		0.72,
		-0.74
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		-0.72,
		-0.74
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		-0.92,
		-0.62
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		-0.86,
		-0.62
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		-0.92,
		-0.56
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		-0.86,
		-0.62
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		-0.86,
		-0.56
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		-0.92,
		-0.56
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		0.86,
		-0.62
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		0.92,
		-0.62
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		0.86,
		-0.56
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		0.92,
		-0.62
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		0.92,
		-0.56
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
	memwritef32(wp,
		0.86,
		-0.56
	)
	wp = wp + 8
	mem[wp], wp = vector_tint, wp + 4
end

local write_mat4_vertices<const> = function()
	local wp = mat4_vertex_addr
	memwritef32(wp,
		0.0,
		0.12,
		0.0
	)
	wp = wp + 12
	mem[wp], wp = white, wp + 4
	memwritef32(wp,
		-0.10,
		-0.08,
		0.0
	)
	wp = wp + 12
	mem[wp], wp = white, wp + 4
	memwritef32(wp,
		0.10,
		-0.08,
		0.0
	)
	wp = wp + 12
	mem[wp], wp = white, wp + 4
end

local write_mesh_vertices<const> = function(morph_a, morph_b)
	local top_y<const> = 0.62 + morph_a
	local bottom_y<const> = -0.62 - morph_b
	local radius_x<const> = 0.56 + morph_b
	local radius_z<const> = 0.56 + morph_a
	local mesh_uv<const> = 0.46875
	local wp = mesh_vertex_addr
	memwritef32(wp,
		0.0,
		top_y,
		0.0,
		0.0,
		top_y,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		0.0,
		radius_z,
		0.0,
		0.0,
		radius_z,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		radius_x,
		0.0,
		0.0,
		radius_x,
		0.0,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		top_y,
		0.0,
		0.0,
		top_y,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		-radius_x,
		0.0,
		0.0,
		-radius_x,
		0.0,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		0.0,
		radius_z,
		0.0,
		0.0,
		radius_z,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		top_y,
		0.0,
		0.0,
		top_y,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		0.0,
		-radius_z,
		0.0,
		0.0,
		-radius_z,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		-radius_x,
		0.0,
		0.0,
		-radius_x,
		0.0,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		top_y,
		0.0,
		0.0,
		top_y,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		radius_x,
		0.0,
		0.0,
		radius_x,
		0.0,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		0.0,
		-radius_z,
		0.0,
		0.0,
		-radius_z,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		bottom_y,
		0.0,
		0.0,
		bottom_y,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		radius_x,
		0.0,
		0.0,
		radius_x,
		0.0,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		0.0,
		radius_z,
		0.0,
		0.0,
		radius_z,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		bottom_y,
		0.0,
		0.0,
		bottom_y,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		0.0,
		radius_z,
		0.0,
		0.0,
		radius_z,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		-radius_x,
		0.0,
		0.0,
		-radius_x,
		0.0,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		bottom_y,
		0.0,
		0.0,
		bottom_y,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		-radius_x,
		0.0,
		0.0,
		-radius_x,
		0.0,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		0.0,
		-radius_z,
		0.0,
		0.0,
		-radius_z,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		bottom_y,
		0.0,
		0.0,
		bottom_y,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		0.0,
		0.0,
		-radius_z,
		0.0,
		0.0,
		-radius_z,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
	memwritef32(wp,
		radius_x,
		0.0,
		0.0,
		radius_x,
		0.0,
		0.0,
		mesh_uv,
		mesh_uv
	)
	wp = wp + 32
	mem[wp], wp = mesh_tint, wp + 4
	mem[wp], wp = mesh_joint_word, wp + 4
	mem[wp], wp = mesh_weight_word, wp + 4
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
	wp = c1_addr
	memwritef32(wp,
		-0.45,
		0.70,
		0.55,
		0.0,
		1.0,
		1.0,
		1.0,
		1.0,
		0.0,
		0.0,
		0.0,
		0.0
	)
	wp = wp + 48
end

local write_mesh_constants<const> = function()
	local mesh_phase<const> = frame % 16
	local mesh_translate_x<const> = 0.125 + mesh_phase * 0.03125
	local scale<const> = 1.0
	memwrite(c0_addr,
		numeric.q16(scale), 0, 0, 0,
		0, numeric.q16(scale), 0, 0,
		0, 0, numeric.q16(scale), 0,
		numeric.q16(mesh_translate_x), numeric.q16(0.05), 0, numeric.q16(1.0)
	)
end

local write_joint_constants<const> = function()
	local joint_phase<const> = frame % 8
	local joint_translate_x<const> = (joint_phase - 4) * 0.03125
	local wp = joint0_addr
	mem[wp], wp = q16_one, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = q16_one, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = q16_one, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = q16_one, wp + 4
	wp = joint1_addr
	mem[wp], wp = q16_one, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = q16_one, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = q16_one, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = numeric.q16(joint_translate_x), wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = q16_one, wp + 4
end

local write_mfu_constants<const> = function()
	mem[mfu_addr] = 0
end

local write_instances<const> = function()
	local wp = instance_addr
	local parallax_x<const> = -32.0 + ((frame % 96) * 0.5)
	local parallax_phase<const> = (frame % 16) * 4
	local billboard_phase<const> = (frame % 8) * 4
	local parallax_near_x<const> = -256.0 + parallax_phase * 2
	local billboard_x_a<const> = 54.0 + billboard_phase
	local billboard_y_a<const> = 114.0
	local billboard_x_b<const> = 174.0 - billboard_phase
	local billboard_y_b<const> = 70.0
	memwritef32(wp,
		512.0 * inv_half_screen_width,
		0.0,
		parallax_x * inv_half_screen_width - 1.0,
		0.70,
		0.0,
		-96.0 * inv_half_screen_height,
		1.0 - 24.0 * inv_half_screen_height,
		0.0,
		0.0,
		1.0,
		1.0
	)
	wp = wp + 44
	mem[wp], wp = parallax_far_tint, wp + 4
	memwritef32(wp,
		512.0 * inv_half_screen_width,
		0.0,
		parallax_near_x * inv_half_screen_width - 1.0,
		0.42,
		0.0,
		-64.0 * inv_half_screen_height,
		1.0 - 48.0 * inv_half_screen_height,
		0.0,
		0.0,
		1.0,
		1.0
	)
	wp = wp + 44
	mem[wp], wp = parallax_near_tint, wp + 4
	memwritef32(wp,
		48.0 * inv_half_screen_width,
		0.0,
		sprite_x * inv_half_screen_width - 1.0,
		0.20,
		0.0,
		-48.0 * inv_half_screen_height,
		1.0 - sprite_y * inv_half_screen_height,
		0.0,
		0.0,
		1.0,
		1.0
	)
	wp = wp + 44
	mem[wp], wp = sprite_tint, wp + 4
	memwritef32(wp,
		38.0 * inv_half_screen_width,
		0.0,
		billboard_x_a * inv_half_screen_width - 1.0,
		0.12,
		0.0,
		-38.0 * inv_half_screen_height,
		1.0 - billboard_y_a * inv_half_screen_height,
		0.0,
		0.0,
		1.0,
		1.0
	)
	wp = wp + 44
	mem[wp], wp = billboard_tint_a, wp + 4
	memwritef32(wp,
		32.0 * inv_half_screen_width,
		0.0,
		billboard_x_b * inv_half_screen_width - 1.0,
		0.14,
		0.0,
		-32.0 * inv_half_screen_height,
		1.0 - billboard_y_b * inv_half_screen_height,
		0.0,
		0.0,
		1.0,
		1.0
	)
	wp = wp + 44
	mem[wp], wp = billboard_tint_b, wp + 4
	memwritef32(wp,
		2.0,
		0.0,
		-1.0,
		0.0,
		0.0,
		-2.0,
		1.0,
		0.0,
		0.0,
		1.0,
		1.0
	)
	wp = wp + 44
	mem[wp], wp = white, wp + 4
end

local write_mat4_instances<const> = function()
	local bob<const> = 0.0
	local wp = mat4_instance_addr
	memwritef32(wp,
		1.0,
		0.0,
		0.0,
		0.0,
		0.0,
		1.0,
		0.0,
		0.0,
		0.0,
		0.0,
		1.0,
		0.0,
		-0.72,
		0.58 + bob,
		0.0,
		1.0
	)
	wp = wp + 64
	mem[wp], wp = mat4_tint_a, wp + 4
	memwritef32(wp,
		0.72,
		0.0,
		0.0,
		0.0,
		0.0,
		0.72,
		0.0,
		0.0,
		0.0,
		0.0,
		1.0,
		0.0,
		0.72,
		0.50 - bob,
		0.0,
		1.0
	)
	wp = wp + 64
	mem[wp], wp = mat4_tint_b, wp + 4
end

local initialize_vdp_resources<const> = function()
	write_quad_vertices()
	write_background_vertices()
	write_vector_vertices()
	write_mat4_vertices()
	write_mesh_indices()
	write_lighting_constants()
	vdp_stream_cursor = vdp_stream_base
	vdp_rpu_quads.set_slot_dim(sys_vdp_slot_primary, atlas_width, atlas_height)
	vdp_rpu.surface_define(vdp_rpu.surface_primary, atlas_width, atlas_height, vdp_rpu.surface_usage(vdp_rpu.surface_format_rgba8, vdp_rpu.surface_usage_texture))
	vdp_rpu.surface_define(scene_color_surface, screen_width, screen_height, vdp_rpu.surface_usage(vdp_rpu.surface_format_rgba8, vdp_rpu.surface_usage_color | vdp_rpu.surface_usage_texture))
	vdp_rpu.surface_define(scene_depth_surface, screen_width, screen_height, vdp_rpu.surface_usage(vdp_rpu.surface_format_depth16, vdp_rpu.surface_usage_depth))
	vdp_rpu.buffer_define(quad_buffer, quad_vertex_bytes, vdp_rpu.usage_vertex)
	vdp_rpu.buffer_upload_dma(quad_buffer, 0, quad_vertex_addr, quad_vertex_bytes)
	vdp_rpu.buffer_define(background_buffer, background_vertex_bytes, vdp_rpu.usage_vertex)
	vdp_rpu.buffer_upload_dma(background_buffer, 0, background_vertex_addr, background_vertex_bytes)
	vdp_rpu.buffer_define(vector_buffer, vector_vertex_bytes, vdp_rpu.usage_vertex)
	vdp_rpu.buffer_upload_dma(vector_buffer, 0, vector_vertex_addr, vector_vertex_bytes)
	vdp_rpu.buffer_define(mat4_vertex_buffer, mat4_vertex_bytes, vdp_rpu.usage_vertex)
	vdp_rpu.buffer_upload_dma(mat4_vertex_buffer, 0, mat4_vertex_addr, mat4_vertex_bytes)
	vdp_rpu.buffer_define(mat4_instance_buffer, mat4_instance_bytes, vdp_rpu.usage_vertex)
	vdp_rpu.buffer_define(mesh_buffer, mesh_vertex_bytes, vdp_rpu.usage_vertex)
	vdp_rpu.buffer_define(mesh_index_buffer, mesh_index_bytes, vdp_rpu.usage_index)
	vdp_rpu.buffer_upload_dma(mesh_index_buffer, 0, mesh_index_addr, mesh_index_bytes)
	vdp_rpu.buffer_define(instance_buffer, instance_bytes, vdp_rpu.usage_vertex)
	vdp_rpu_quads.finish_frame()
	submit_current_stream()
	wait_dma()
end

local draw_frame<const> = function()
	local morph_a<const> = 0.0
	local morph_b<const> = 0.0
	write_mesh_vertices(morph_a, morph_b)
	write_mesh_constants()
	write_joint_constants()
	write_mfu_constants()
	write_instances()
	write_mat4_instances()
	vdp_stream_cursor = vdp_stream_base
	vdp_xf.matrix_words(mesh_matrix_index, c0_addr)
	vdp_lpu.register_words(0, c1_addr, c1_words)
	vdp_jtu.matrix_words(0, joint0_addr)
	vdp_jtu.matrix_words(mesh_joint_matrix_index, joint1_addr)
	vdp_mfu.register_words(0, mfu_addr, mfu_words)
	vdp_rpu.buffer_upload_dma(mesh_buffer, 0, mesh_vertex_addr, mesh_vertex_bytes)
	vdp_rpu.buffer_upload_dma(mat4_instance_buffer, 0, mat4_instance_addr, mat4_instance_bytes)
	vdp_rpu.buffer_upload_dma(instance_buffer, 0, instance_addr, instance_bytes)
	vdp_rpu.constant_bank_define(0, 0, c0_words)
	vdp_rpu.constant_bank_define(1, c0_words, c1_words)
	vdp_rpu.constant_bank_define(2, c0_words + c1_words, joint_words)
	vdp_rpu.constant_upload_device(0, 0, vdp_rpu.constant_source_xf_q16, mesh_matrix_index * vdp_xf.matrix_words_per_matrix, c0_words)
	vdp_rpu.constant_upload_device(1, 0, vdp_rpu.constant_source_lpu_raw, 0, c1_words)
	vdp_rpu.constant_upload_device(1, 8, vdp_rpu.constant_source_mfu_q16, 0, mfu_words)
	vdp_rpu.constant_upload_device(2, 0, vdp_rpu.constant_source_jtu_q16, 0, joint_words)
	vdp_rpu.begin_pass(scene_color_surface, scene_depth_surface, 0, 0, screen_width, screen_height, vdp_rpu.pass_color_clear | vdp_rpu.pass_depth_clear, 0xff071a3a, 0xffffffff)
	vdp_rpu.begin_draw(vdp_rpu.shader_v2_c4, vdp_rpu.primitive_index(vdp_rpu.prim_triangles, vdp_rpu.index_none), vdp_rpu.pipeline(vdp_rpu.blend_none, vdp_rpu.depth_none, vdp_rpu.cull_none, 0, vdp_rpu.pipe_color_write_rgba), background_vertex_count, 1, vdp_rpu.resource_none, 0, 0)
	vdp_rpu.bind_stream(0, vdp_rpu.layout_v2_c4, background_buffer, 0, 0)
	vdp_rpu.end_draw()
	vdp_rpu.begin_draw(vdp_rpu.shader_v2_c4, vdp_rpu.primitive_index(vdp_rpu.prim_triangles, vdp_rpu.index_none), vdp_rpu.pipeline(vdp_rpu.blend_none, vdp_rpu.depth_none, vdp_rpu.cull_none, 0, vdp_rpu.pipe_color_write_rgba), vector_vertex_count, 1, vdp_rpu.resource_none, 0, 0)
	vdp_rpu.bind_stream(0, vdp_rpu.layout_v2_c4, vector_buffer, 0, 0)
	vdp_rpu.end_draw()
	vdp_rpu.begin_draw(vdp_rpu.shader_v2_c4, vdp_rpu.primitive_index(vdp_rpu.prim_lines, vdp_rpu.index_none), vdp_rpu.pipeline(vdp_rpu.blend_none, vdp_rpu.depth_none, vdp_rpu.cull_none, 0, vdp_rpu.pipe_color_write_rgba), 2, 1, vdp_rpu.resource_none, 0, 0)
	vdp_rpu.bind_stream(0, vdp_rpu.layout_v2_c4, vector_buffer, vector_vertex_stride * 2, 0)
	vdp_rpu.end_draw()
	vdp_rpu.begin_draw(vdp_rpu.shader_v2_c4, vdp_rpu.primitive_index(vdp_rpu.prim_points, vdp_rpu.index_none), vdp_rpu.pipeline(vdp_rpu.blend_alpha, vdp_rpu.depth_lequal, vdp_rpu.cull_none, vdp_rpu.pipe_depth_write, vdp_rpu.pipe_color_write_rgba), 1, 1, vdp_rpu.resource_none, 0, 0)
	vdp_rpu.bind_stream(0, vdp_rpu.layout_v2_c4, vector_buffer, vector_vertex_stride * 2, 0)
	vdp_rpu.end_draw()
	vdp_rpu.begin_draw(vdp_rpu.shader_v2_t2_c4_i_affine2, vdp_rpu.primitive_index(vdp_rpu.prim_triangle_strip, vdp_rpu.index_none), vdp_rpu.pipeline(vdp_rpu.blend_none, vdp_rpu.depth_lequal, vdp_rpu.cull_none, vdp_rpu.pipe_depth_write, vdp_rpu.pipe_color_write_rgba), quad_vertex_count, sprite_instance_count, vdp_rpu.resource_none, 0, 0)
	vdp_rpu.bind_stream(0, vdp_rpu.layout_v2_t2_c4, quad_buffer, 0, 0)
	vdp_rpu.bind_stream(1, vdp_rpu.layout_i_affine2_trect_c4, instance_buffer, 0, 1)
	vdp_rpu.bind_texture(0, vdp_rpu.surface_primary, sampler_nearest)
	vdp_rpu.end_draw()
	vdp_rpu.begin_draw(vdp_rpu.shader_v3_c4_i_mat4, vdp_rpu.primitive_index(vdp_rpu.prim_triangles, vdp_rpu.index_none), vdp_rpu.pipeline(vdp_rpu.blend_none, vdp_rpu.depth_none, vdp_rpu.cull_none, 0, vdp_rpu.pipe_color_write_rgba), mat4_vertex_count, mat4_instance_count, vdp_rpu.resource_none, 0, 0)
	vdp_rpu.bind_stream(0, vdp_rpu.layout_v3_c4, mat4_vertex_buffer, 0, 0)
	vdp_rpu.bind_stream(1, vdp_rpu.layout_i_mat4_c4, mat4_instance_buffer, 0, 1)
	vdp_rpu.end_draw()
	vdp_rpu.begin_draw(vdp_rpu.shader_v3_c4_c0, vdp_rpu.primitive_index(vdp_rpu.prim_triangles, vdp_rpu.index_none), vdp_rpu.pipeline(vdp_rpu.blend_none, vdp_rpu.depth_none, vdp_rpu.cull_none, 0, vdp_rpu.pipe_color_write_rgba), mat4_vertex_count, 1, vdp_rpu.resource_none, 0, 0)
	vdp_rpu.bind_stream(0, vdp_rpu.layout_v3_c4, mat4_vertex_buffer, 0, 0)
	vdp_rpu.bind_constants(0, 0, 0, c0_words)
	vdp_rpu.end_draw()
	vdp_rpu.begin_draw(vdp_rpu.shader_v3_n3_t2_c4_j4_w4_c0_c1, vdp_rpu.primitive_index(vdp_rpu.prim_triangles, vdp_rpu.index_u16), vdp_rpu.pipeline(vdp_rpu.blend_none, vdp_rpu.depth_none, vdp_rpu.cull_none, 0, vdp_rpu.pipe_color_write_rgba), mesh_vertex_count, 1, mesh_index_buffer, 0, mesh_index_count)
	vdp_rpu.bind_stream(0, vdp_rpu.layout_v3_n3_t2_c4_j4_w4, mesh_buffer, 0, 0)
	vdp_rpu.bind_constants(0, 0, 0, c0_words)
	vdp_rpu.bind_constants(1, 2, 0, joint_words)
	vdp_rpu.bind_constants(2, 1, 0, c1_words)
	vdp_rpu.bind_texture(0, vdp_rpu.surface_primary, sampler_nearest)
	vdp_rpu.end_draw()
	vdp_rpu.end_pass()
	vdp_rpu.begin_pass(vdp_rpu.resource_none, vdp_rpu.resource_none, 0, 0, screen_width, screen_height, 0, 0, 0)
	vdp_rpu.begin_draw(vdp_rpu.shader_v2_t2_c4_i_affine2, vdp_rpu.primitive_index(vdp_rpu.prim_triangle_strip, vdp_rpu.index_none), vdp_rpu.pipeline(vdp_rpu.blend_none, vdp_rpu.depth_none, vdp_rpu.cull_none, 0, vdp_rpu.pipe_color_write_rgba), quad_vertex_count, present_instance_count, vdp_rpu.resource_none, 0, 0)
	vdp_rpu.bind_stream(0, vdp_rpu.layout_v2_t2_c4, quad_buffer, 0, 0)
	vdp_rpu.bind_stream(1, vdp_rpu.layout_i_affine2_trect_c4, instance_buffer, present_instance_offset, 1)
	vdp_rpu.bind_texture(0, scene_color_surface, sampler_nearest)
	vdp_rpu.end_draw()
	vdp_rpu.end_pass()
	vdp_rpu_quads.finish_frame()
	submit_current_stream()
	wait_dma()
end

mem[io_vdp_dither] = 0
build_lua_atlas()
initialize_vdp_resources()
upload_atlas_to_vram()

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
	draw_frame()
end
