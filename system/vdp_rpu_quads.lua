local vdp_rpu<const> = require('system/vdp_rpu')

local vdp_rpu_quads<const> = {}

local screen_width<const> = machine_manifest.render_size.width
local screen_height<const> = machine_manifest.render_size.height
local ndc_x_scale<const> = 2.0 / screen_width
local ndc_y_scale<const> = 2.0 / screen_height

local quad_buffer<const> = 900
local instance_buffer<const> = 901
local quad_vertex_stride<const> = 20
local quad_vertex_count<const> = 4
local quad_vertex_bytes<const> = quad_vertex_stride * quad_vertex_count
local instance_stride<const> = 48
local instance_capacity<const> = 1024
local instance_bytes<const> = instance_stride * instance_capacity
local quad_addr<const> = sys_geo_scratch_base + sys_geo_scratch_size - 0x10000
local instance_addr<const> = quad_addr + quad_vertex_bytes
local white<const> = 0xffffffff
local draw_order_depth_scale<const> = 2.0 / 1048576.0
local tile_run_depth<const> = 1.0 - ((sys_vdp_layer_world * 4096.0) * draw_order_depth_scale)
local slot_surface<const> = {}
slot_surface[sys_vdp_slot_system] = vdp_rpu.surface_system
slot_surface[sys_vdp_slot_primary] = vdp_rpu.surface_primary
slot_surface[sys_vdp_slot_secondary] = vdp_rpu.surface_secondary

local surface_width<const> = {}
local surface_height<const> = {}

local frame_active
local pending_clear
local pending_clear_color
local instance_count
local current_surface

instance_count = 0
current_surface = vdp_rpu.resource_none

local write_quad_vertices<const> = function()
	local wp = quad_addr
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

local define_static_resources<const> = function()
	write_quad_vertices()
	vdp_rpu.buffer_define(quad_buffer, quad_vertex_bytes, vdp_rpu.usage_vertex)
	vdp_rpu.buffer_upload_dma(quad_buffer, 0, quad_addr, quad_vertex_bytes)
	vdp_rpu.buffer_define(instance_buffer, instance_bytes, vdp_rpu.usage_vertex)
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
	vdp_rpu.begin_pass(vdp_rpu.resource_none, vdp_rpu.resource_none, 0, 0, screen_width, screen_height, pass_ops, clear_color, 0xffffffff)
	frame_active = true
end

local flush_instances<const> = function()
	if instance_count == 0 then
		return
	end
	begin_pass()
	vdp_rpu.buffer_upload_dma(instance_buffer, 0, instance_addr, instance_count * instance_stride)
	vdp_rpu.begin_draw(vdp_rpu.shader_v2_t2_c4_i_affine2, vdp_rpu.primitive_index(vdp_rpu.prim_triangle_strip, vdp_rpu.index_none), vdp_rpu.pipeline(vdp_rpu.blend_alpha, vdp_rpu.depth_lequal, vdp_rpu.cull_none, vdp_rpu.pipe_depth_write, vdp_rpu.pipe_color_write_rgba), quad_vertex_count, instance_count, vdp_rpu.resource_none, 0, 0)
	vdp_rpu.bind_stream(0, vdp_rpu.layout_v2_t2_c4, quad_buffer, 0, 0)
	vdp_rpu.bind_stream(1, vdp_rpu.layout_i_affine2_trect_c4, instance_buffer, 0, 1)
	if current_surface ~= vdp_rpu.resource_none then
		vdp_rpu.bind_texture(0, current_surface, vdp_rpu.sampler(vdp_rpu.filter_nearest, vdp_rpu.filter_nearest, vdp_rpu.wrap_clamp, vdp_rpu.wrap_clamp))
	end
	vdp_rpu.end_draw()
	instance_count = 0
end

local switch_surface<const> = function(surface_id)
	if current_surface == surface_id then
		return
	end
	flush_instances()
	current_surface = surface_id
end

local write_instance<const> = function(origin_x, origin_y, depth_z, axis_xx, axis_xy, axis_yx, axis_yy, u0, v0, du, dv, color)
	if instance_count == instance_capacity then
		flush_instances()
	end
	local wp = instance_addr + instance_count * instance_stride
	memwritef32(wp,
		axis_xx,
		axis_xy,
		origin_x,
		depth_z,
		axis_yx,
		axis_yy,
		origin_y,
		u0,
		v0,
		du,
		dv
	)
	wp = wp + 44
	mem[wp] = color
	instance_count = instance_count + 1
end

local queue_quad<const> = function(surface_id, u0, v0, du, dv, x, y, width, height, z, layer, color)
	switch_surface(surface_id)
	write_instance(
		x * ndc_x_scale - 1.0,
		1.0 - y * ndc_y_scale,
		1.0 - (((layer * 4096.0) + z) * draw_order_depth_scale),
		width * ndc_x_scale,
		0.0,
		0.0,
		-height * ndc_y_scale,
		u0,
		v0,
		du,
		dv,
		color
	)
end

function vdp_rpu_quads.set_slot_dim(slot, width, height)
	local surface_id<const> = slot_surface[slot]
	surface_width[surface_id] = width
	surface_height[surface_id] = height
end

function vdp_rpu_quads.submit_slot_resources(slot)
	vdp_stream_reset()
	define_static_resources()
	local surface_id<const> = slot_surface[slot]
	vdp_rpu.surface_define(surface_id, surface_width[surface_id], surface_height[surface_id], vdp_rpu.surface_usage(vdp_rpu.surface_format_rgba8, vdp_rpu.surface_usage_texture))
	vdp_stream_submit_cpu_fifo()
end

function vdp_rpu_quads.clear_color(color)
	if instance_count ~= 0 then
		flush_instances()
	end
	if frame_active then
		vdp_rpu.end_pass()
		frame_active = nil
	end
	pending_clear = true
	pending_clear_color = color
end

function vdp_rpu_quads.fill_rect_color(x0, y0, x1, y1, z, layer, color)
	queue_quad(vdp_rpu.resource_none, 0.0, 0.0, 1.0, 1.0, x0, y0, x1 - x0, y1 - y0, z, layer, color)
end

function vdp_rpu_quads.draw_line_color(x0, y0, x1, y1, z, layer, color, thickness)
	local dx<const> = x1 - x0
	local dy<const> = y1 - y0
	local half<const> = thickness * 0.5
	if dx == 0 and dy == 0 then
		queue_quad(vdp_rpu.resource_none, 0.0, 0.0, 1.0, 1.0, x0 - half, y0 - half, thickness, thickness, z, layer, color)
		return
	end
	local length<const> = math.sqrt(dx * dx + dy * dy)
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

function vdp_rpu_quads.blit_source_color(slot, u, v, w, h, x, y, z, layer, scale_x, scale_y, flip_flags, color)
	local surface_id<const> = slot_surface[slot]
	local inv_w<const> = 1.0 / surface_width[surface_id]
	local inv_h<const> = 1.0 / surface_height[surface_id]
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
	queue_quad(surface_id, u0, v0, du, dv, x, y, w * scale_x, h * scale_y, z, layer, color)
end

function vdp_rpu_quads.tile_run_sources(sources, tile_count, cols, tile_size, origin_x, origin_y, empty_source)
	local index = 1
	while index <= tile_count do
		local source<const> = sources[index]
		if source ~= empty_source then
			local surface_id<const> = slot_surface[source.slot]
			switch_surface(surface_id)
			local inv_w<const> = 1.0 / surface_width[surface_id]
			local inv_h<const> = 1.0 / surface_height[surface_id]
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
		vdp_rpu.end_pass()
		frame_active = nil
	end
	pending_clear = nil
	pending_clear_color = nil
	instance_count = 0
	current_surface = vdp_rpu.resource_none
	if vdp_stream_cursor ~= sys_vdp_stream_base then
		mem[vdp_stream_claim(1)] = sys_vdp_pkt_end
	end
end

return vdp_rpu_quads
