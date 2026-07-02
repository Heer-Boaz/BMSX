local vdp_rpu<const> = require('system/vdp_rpu')
local sqrt<const> = require('bios/math').sqrt

local vdp_rpu_quads<const> = {}

struct rpu_quad_vertex
	xyzuv: f32[4]
	color: word
end

struct rpu_quad_instance
	matrix: f32[11]
	color: word
end

local screen_wh
local screen_width
local screen_height
local ndc_x_scale
local ndc_y_scale

local quad_vertex_stride<const> = sizeof(rpu_quad_vertex)
local quad_vertex_count<const> = 4
local quad_vertex_bytes<const> = quad_vertex_stride * quad_vertex_count
local instance_stride<const> = sizeof(rpu_quad_instance)
local instance_batch_capacity<const> = 1024
local instance_frame_capacity<const> = 1024
local instance_frame_bytes<const> = instance_stride * instance_frame_capacity
local draw_frame_capacity<const> = 1024
local surface_desc_count<const> = 3
local vram_staging_base<const> = 0x11000000
local rpu_quad_vertex_vram_addr<const> = 0
local rpu_instance_vram_addr<const> = rpu_quad_vertex_vram_addr + quad_vertex_bytes
local rpu_surface_desc_vram_addr<const> = rpu_instance_vram_addr + instance_frame_bytes
local rpu_pass_desc_vram_addr<const> = rpu_surface_desc_vram_addr + surface_desc_count * 0x00000010
local rpu_draw_desc_vram_addr<const> = rpu_pass_desc_vram_addr + 64 * 0x00000024
local rpu_stream_desc_vram_addr<const> = rpu_draw_desc_vram_addr + draw_frame_capacity * 0x0000002c
local rpu_texture_desc_vram_addr<const> = rpu_stream_desc_vram_addr + draw_frame_capacity * 2 * 0x0000000c
local rpu_texture_region_vram_addr<const> = rpu_texture_desc_vram_addr + draw_frame_capacity * 0x00000008
local rpu_system_texture_bytes<const> = 0x00048000
local rpu_primary_texture_bytes<const> = 0x00068000
local rpu_secondary_texture_bytes<const> = 0x001c0000 - rpu_texture_region_vram_addr - rpu_system_texture_bytes - rpu_primary_texture_bytes
local rpu_system_texture_vram_addr<const> = rpu_texture_region_vram_addr
local rpu_primary_texture_vram_addr<const> = rpu_system_texture_vram_addr + rpu_system_texture_bytes
local rpu_secondary_texture_vram_addr<const> = rpu_primary_texture_vram_addr + rpu_primary_texture_bytes
local quad_addr<const> = vram_staging_base + rpu_quad_vertex_vram_addr
local instance_addr<const> = vram_staging_base + rpu_instance_vram_addr
local instance_frame_end<const> = instance_addr + instance_frame_bytes
local quad_primitive_index<const> = vdp_rpu.prim_triangle_strip | (vdp_rpu.index_none << 8)
local quad_pipeline<const> = vdp_rpu.blend_alpha | (vdp_rpu.depth_lequal << 4) | (vdp_rpu.cull_none << 8) | vdp_rpu.pipe_depth_write | vdp_rpu.pipe_color_write_rgba
local white<const> = 0xffffffff
local draw_order_depth_scale<const> = 2.0 / 1048576.0
local tile_run_depth<const> = 1.0 - ((0x00000000 * 4096.0) * draw_order_depth_scale)
local slot_surface_desc<const> = {}
slot_surface_desc[0x00000002] = rpu_surface_desc_vram_addr
slot_surface_desc[0x00000000] = rpu_surface_desc_vram_addr + 0x00000010
slot_surface_desc[0x00000001] = rpu_surface_desc_vram_addr + (0x00000010 * 2)
local slot_texture_vram_addr<const> = {}
slot_texture_vram_addr[0x00000002] = rpu_system_texture_vram_addr
slot_texture_vram_addr[0x00000000] = rpu_primary_texture_vram_addr
slot_texture_vram_addr[0x00000001] = rpu_secondary_texture_vram_addr
local slot_texture_bytes<const> = {}
slot_texture_bytes[0x00000002] = rpu_system_texture_bytes
slot_texture_bytes[0x00000000] = rpu_primary_texture_bytes
slot_texture_bytes[0x00000001] = rpu_secondary_texture_bytes

local surface_width<const> = {}
local surface_height<const> = {}

local frame_active
local pending_clear
local pending_clear_color
local instance_count
local instance_batch_addr
local current_surface_desc
local pass_count
local draw_count
local current_pass_first_draw
local current_pass_ops
local current_pass_clear_color
local frame_metrics_active

instance_count = 0
instance_batch_addr = instance_addr
current_surface_desc = vdp_rpu.resource_none
pass_count = 0
draw_count = 0
frame_metrics_active = false

local refresh_screen_metrics<const> = function()
	screen_wh = mem[0x08000088]
	screen_width = screen_wh & 0xffff
	screen_height = screen_wh >> 16
	ndc_x_scale = 2.0 / screen_width
	ndc_y_scale = 2.0 / screen_height
end

refresh_screen_metrics()

local begin_frame_metrics<const> = function()
	if frame_metrics_active then
		return
	end
	refresh_screen_metrics()
	frame_metrics_active = true
end

local write_quad_vertices<const> = function()
	local vertices<const>: *rpu_quad_vertex[quad_vertex_count] = quad_addr
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

local write_surface_desc<const> = function(slot)
	local surface_desc_addr<const> = slot_surface_desc[slot]
	local texture_vram_addr<const> = slot_texture_vram_addr[slot]
	local width<const> = surface_width[surface_desc_addr]
	local height<const> = surface_height[surface_desc_addr]
	local word_base<const> = (surface_desc_addr - rpu_surface_desc_vram_addr) // 4
	local surface_words<const>: *word = vram_staging_base + rpu_surface_desc_vram_addr
	surface_words[word_base] = texture_vram_addr
	surface_words[word_base + 1] = (width * 4) | (width << 16)
	surface_words[word_base + 2] = height | (vdp_rpu.surface_format_rgba8 << 16)
	surface_words[word_base + 3] = 0
end

local end_pass<const> = function()
	local pass_words<const>: *word = vram_staging_base + rpu_pass_desc_vram_addr
	local word_base<const> = (pass_count * 0x00000024) // 4
	pass_words[word_base] = 0
	pass_words[word_base + 1] = 0
	pass_words[word_base + 2] = 0
	pass_words[word_base + 3] = screen_width | (screen_height << 16)
	pass_words[word_base + 4] = current_pass_ops
	pass_words[word_base + 5] = current_pass_clear_color
	pass_words[word_base + 6] = 0xffffffff
	pass_words[word_base + 7] = rpu_draw_desc_vram_addr + current_pass_first_draw * 0x0000002c
	pass_words[word_base + 8] = draw_count - current_pass_first_draw
	pass_count = pass_count + 1
	frame_active = nil
end

local begin_pass<const> = function()
	if frame_active then
		return
	end
	local pass_ops = vdp_rpu.pass_depth_clear
	local clear_color
	if pending_clear then
		pass_ops = pass_ops | vdp_rpu.pass_color_clear
		clear_color = pending_clear_color
		pending_clear = nil
	else
		clear_color = 0
	end
	current_pass_first_draw = draw_count
	current_pass_ops = pass_ops
	current_pass_clear_color = clear_color
	frame_active = true
end

local flush_instances<const> = function()
	if instance_count == 0 then
		return
	end
	local byte_length<const> = instance_count * instance_stride
	local draw_word_base<const> = (draw_count * 0x0000002c) // 4
	local stream_word_base<const> = (draw_count * 2 * 0x0000000c) // 4
	local texture_word_base<const> = (draw_count * 0x00000008) // 4
	local instance_batch_vram_addr<const> = instance_batch_addr - vram_staging_base
	local texture_count = 0
	begin_pass()
	if current_surface_desc ~= vdp_rpu.resource_none then
		texture_count = 1
	end
	local draw_words<const>: *word = vram_staging_base + rpu_draw_desc_vram_addr
	draw_words[draw_word_base] = vdp_rpu.shader_v2_t2_c4_i_affine2 | ((quad_primitive_index & 0xff) << 16)
	draw_words[draw_word_base + 1] = quad_pipeline
	draw_words[draw_word_base + 2] = quad_vertex_count
	draw_words[draw_word_base + 3] = instance_count
	draw_words[draw_word_base + 4] = 0
	draw_words[draw_word_base + 5] = 0
	draw_words[draw_word_base + 6] = ((quad_primitive_index >> 8) & 0xff) | (2 << 8) | (texture_count << 24)
	draw_words[draw_word_base + 7] = rpu_stream_desc_vram_addr + draw_count * 2 * 0x0000000c
	draw_words[draw_word_base + 8] = 0
	draw_words[draw_word_base + 9] = rpu_texture_desc_vram_addr + draw_count * 0x00000008
	draw_words[draw_word_base + 10] = 0
	local stream_words<const>: *word = vram_staging_base + rpu_stream_desc_vram_addr
	stream_words[stream_word_base] = rpu_quad_vertex_vram_addr
	stream_words[stream_word_base + 1] = quad_vertex_bytes
	stream_words[stream_word_base + 2] = vdp_rpu.layout_v2_t2_c4
	stream_words[stream_word_base + 3] = instance_batch_vram_addr
	stream_words[stream_word_base + 4] = byte_length
	stream_words[stream_word_base + 5] = vdp_rpu.layout_i_affine2_trect_c4 | (1 << 16) | (1 << 24)
	if texture_count ~= 0 then
		local texture_words<const>: *word = vram_staging_base + rpu_texture_desc_vram_addr
		texture_words[texture_word_base] = current_surface_desc
		texture_words[texture_word_base + 1] = 0
	end
	draw_count = draw_count + 1
	instance_batch_addr = instance_batch_addr + byte_length
	instance_count = 0
end

local switch_surface<const> = function(surface_desc_addr)
	if current_surface_desc == surface_desc_addr then
		return
	end
	flush_instances()
	current_surface_desc = surface_desc_addr
end

local write_instance<const> = function(origin_x, origin_y, depth_z, axis_xx, axis_xy, axis_yx, axis_yy, u0, v0, du, dv, color)
	if instance_count == instance_batch_capacity then
		flush_instances()
	end
	local wp<const> = instance_batch_addr + instance_count * instance_stride
	if wp == instance_frame_end then
		error('VDP RPU quad instance staging exhausted.')
	end
	local instance<const>: *rpu_quad_instance = wp
	instance->matrix[0] = axis_xx
	instance->matrix[1] = axis_xy
	instance->matrix[2] = origin_x
	instance->matrix[3] = depth_z
	instance->matrix[4] = axis_yx
	instance->matrix[5] = axis_yy
	instance->matrix[6] = origin_y
	instance->matrix[7] = u0
	instance->matrix[8] = v0
	instance->matrix[9] = du
	instance->matrix[10] = dv
	instance->color = (color & 0xff00ff00) | ((color & 0x00ff0000) >> 16) | ((color & 0x000000ff) << 16)
	instance_count = instance_count + 1
end

function vdp_rpu_quads.set_slot_dim(slot, width, height)
	local surface_desc_addr<const> = slot_surface_desc[slot]
	surface_width[surface_desc_addr] = width
	surface_height[surface_desc_addr] = height
	write_quad_vertices()
	write_surface_desc(slot)
	return vram_staging_base + slot_texture_vram_addr[slot], slot_texture_bytes[slot]
end

function vdp_rpu_quads.clear_color(color)
	begin_frame_metrics()
	if instance_count ~= 0 then
		flush_instances()
	end
	if frame_active then
		end_pass()
	end
	pending_clear = true
	pending_clear_color = color
end

function vdp_rpu_quads.fill_rect_color(x0, y0, x1, y1, z, layer, color)
	begin_frame_metrics()
	switch_surface(vdp_rpu.resource_none)
	write_instance(
		x0 * ndc_x_scale - 1.0,
		1.0 - y0 * ndc_y_scale,
		1.0 - (((layer * 4096.0) + z) * draw_order_depth_scale),
		(x1 - x0) * ndc_x_scale,
		0.0,
		0.0,
		-(y1 - y0) * ndc_y_scale,
		0.0,
		0.0,
		1.0,
		1.0,
		color
	)
end

function vdp_rpu_quads.draw_line_color(x0, y0, x1, y1, z, layer, color, thickness)
	begin_frame_metrics()
	local dx<const> = x1 - x0
	local dy<const> = y1 - y0
	local half<const> = thickness * 0.5
	if dx == 0 and dy == 0 then
		switch_surface(vdp_rpu.resource_none)
		write_instance(
			(x0 - half) * ndc_x_scale - 1.0,
			1.0 - (y0 - half) * ndc_y_scale,
			1.0 - (((layer * 4096.0) + z) * draw_order_depth_scale),
			thickness * ndc_x_scale,
			0.0,
			0.0,
			-thickness * ndc_y_scale,
			0.0,
			0.0,
			1.0,
			1.0,
			color
		)
		return
	end
	local length<const> = sqrt(dx * dx + dy * dy)
	local tangent_x<const> = dx / length
	local tangent_y<const> = dy / length
	local normal_x<const> = -tangent_y
	local normal_y<const> = tangent_x
	switch_surface(vdp_rpu.resource_none)
	write_instance(
		(x0 - tangent_x * half - normal_x * half) * ndc_x_scale - 1.0,
		1.0 - (y0 - tangent_y * half - normal_y * half) * ndc_y_scale,
		1.0 - (((layer * 4096.0) + z) * draw_order_depth_scale),
		(dx + tangent_x * thickness) * ndc_x_scale,
		-(dy + tangent_y * thickness) * ndc_y_scale,
		normal_x * thickness * ndc_x_scale,
		-normal_y * thickness * ndc_y_scale,
		0.0,
		0.0,
		1.0,
		1.0,
		color
	)
end

function vdp_rpu_quads.blit_source_affine_color(slot, u, v, w, h, origin_x, origin_y, z, layer, axis_xx, axis_xy, axis_yx, axis_yy, flip_flags, color)
	begin_frame_metrics()
	local surface_desc_addr<const> = slot_surface_desc[slot]
	local inv_w<const> = 1.0 / surface_width[surface_desc_addr]
	local inv_h<const> = 1.0 / surface_height[surface_desc_addr]
	local u0 = u * inv_w
	local v0 = v * inv_h
	local du = w * inv_w
	local dv = h * inv_h
	if (flip_flags & 1) ~= 0 then
		u0 = u0 + du
		du = -du
	end
	if (flip_flags & 2) ~= 0 then
		v0 = v0 + dv
		dv = -dv
	end
	switch_surface(surface_desc_addr)
	write_instance(
		origin_x * ndc_x_scale - 1.0,
		1.0 - origin_y * ndc_y_scale,
		1.0 - (((layer * 4096.0) + z) * draw_order_depth_scale),
		axis_xx * ndc_x_scale,
		axis_xy * ndc_x_scale,
		-axis_yx * ndc_y_scale,
		-axis_yy * ndc_y_scale,
		u0,
		v0,
		du,
		dv,
		color
	)
end

function vdp_rpu_quads.blit_source_color(slot, u, v, w, h, x, y, z, layer, scale_x, scale_y, flip_flags, color)
	begin_frame_metrics()
	local texture_surface_desc_addr<const> = slot_surface_desc[slot]
	local inv_w<const> = 1.0 / surface_width[texture_surface_desc_addr]
	local inv_h<const> = 1.0 / surface_height[texture_surface_desc_addr]
	local u0 = u * inv_w
	local v0 = v * inv_h
	local du = w * inv_w
	local dv = h * inv_h
	if (flip_flags & 1) ~= 0 then
		u0 = u0 + du
		du = -du
	end
	if (flip_flags & 2) ~= 0 then
		v0 = v0 + dv
		dv = -dv
	end
	switch_surface(texture_surface_desc_addr)
	write_instance(
		x * ndc_x_scale - 1.0,
		1.0 - y * ndc_y_scale,
		1.0 - (((layer * 4096.0) + z) * draw_order_depth_scale),
		w * scale_x * ndc_x_scale,
		0.0,
		0.0,
		-(h * scale_y) * ndc_y_scale,
		u0,
		v0,
		du,
		dv,
		color
	)
end

function vdp_rpu_quads.tile_run_sources(sources, tile_count, cols, tile_size, origin_x, origin_y, empty_source)
	begin_frame_metrics()
	local index = 1
	while index <= tile_count do
		local source<const> = sources[index]
		if source ~= empty_source then
			local surface_desc_addr<const> = slot_surface_desc[source.slot]
			switch_surface(surface_desc_addr)
			local inv_w<const> = 1.0 / surface_width[surface_desc_addr]
			local inv_h<const> = 1.0 / surface_height[surface_desc_addr]
			local tile_index<const> = index - 1
			local tile_x<const> = tile_index % cols
			local tile_y<const> = tile_index // cols
			write_instance(
				(origin_x + (tile_x * tile_size)) * ndc_x_scale - 1.0,
				1.0 - (origin_y + (tile_y * tile_size)) * ndc_y_scale,
				tile_run_depth,
				source.w * ndc_x_scale,
				0.0,
				0.0,
				-source.h * ndc_y_scale,
				source.u * inv_w,
				source.v * inv_h,
				source.w * inv_w,
				source.h * inv_h,
				white
			)
		end
		index = index + 1
	end
end

function vdp_rpu_quads.finish_frame()
	if instance_count ~= 0 then
		flush_instances()
	elseif pending_clear then
		begin_pass()
	end
	if frame_active then
		end_pass()
	end
	pending_clear = nil
	pending_clear_color = nil
	instance_count = 0
	instance_batch_addr = instance_addr
	current_surface_desc = vdp_rpu.resource_none
	if pass_count ~= 0 then
		vdp_rpu.exec_pass_list(pass_count, rpu_pass_desc_vram_addr)
		vdp_rpu.seal_frame()
		local end_packet<const>: *word = vdp_stream_claim(1)
		*end_packet = 0x00000000
	end
	pass_count = 0
	draw_count = 0
	frame_metrics_active = false
end

return vdp_rpu_quads
