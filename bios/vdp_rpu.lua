local vdp_stream<const> = require('bios/vdp_stream')
local numeric<const> = require('bios/common/numeric')

local vdp_rpu<const> = {}

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
local words_bind_texture<const> = 4
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

local filter_nearest<const> = 0
local filter_linear<const> = 1
local wrap_clamp<const> = 0
local wrap_repeat<const> = 1

local layout_v2_c4<const> = 0
local layout_v2_t2_c4<const> = 1
local layout_v3_c4<const> = 2
local layout_v3_t2_c4<const> = 3
local layout_v3_n3_c4<const> = 4
local layout_v3_n3_t2_c4<const> = 5
local layout_v3_n3_t2_c4_j4_w4<const> = 6
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

local constant_source_xf_q16<const> = 0
local constant_source_lpu_raw<const> = 1
local constant_source_mfu_q16<const> = 2
local constant_source_jtu_q16<const> = 3

local surface_system<const> = 0
local surface_primary<const> = 1
local surface_secondary<const> = 2

local header<const> = function(payload_words)
	return packet_kind | (payload_words << 16)
end

function vdp_rpu.surface_usage(format, usage)
	return format | (usage << usage_shift)
end

function vdp_rpu.primitive_index(primitive, index_type)
	return primitive | (index_type << 8)
end

function vdp_rpu.pipeline(blend, depth, cull, depth_write, color_write_mask)
	return blend | (depth << 4) | (cull << 8) | depth_write | color_write_mask
end

function vdp_rpu.sampler(min_filter, mag_filter, wrap_u, wrap_v)
	return min_filter | (mag_filter << 2) | (wrap_u << 4) | (wrap_v << 6)
end

function vdp_rpu.buffer_define(buffer_id, byte_length, usage)
	memwrite(
		vdp_stream.claim(5),
		header(words_buffer_define),
		op_buffer_define,
		buffer_id,
		byte_length,
		usage
	)
end

function vdp_rpu.buffer_upload_dma(buffer_id, dst_byte_offset, src_addr, byte_length)
	memwrite(
		vdp_stream.claim(6),
		header(words_buffer_upload_dma),
		op_buffer_upload_dma,
		buffer_id,
		dst_byte_offset,
		src_addr,
		byte_length
	)
end

function vdp_rpu.buffer_upload_inline(buffer_id, dst_byte_offset, byte_length, ...)
	local data_words<const> = (byte_length + 3) >> 2
	memwrite(
		vdp_stream.claim(5 + data_words),
		header(words_buffer_upload_inline_min + data_words),
		op_buffer_upload_inline,
		buffer_id,
		dst_byte_offset,
		byte_length,
		...
	)
end

function vdp_rpu.buffer_discard(buffer_id)
	memwrite(
		vdp_stream.claim(3),
		header(words_buffer_discard),
		op_buffer_discard,
		buffer_id
	)
end

function vdp_rpu.surface_define(surface_id, width, height, format_usage)
	memwrite(
		vdp_stream.claim(5),
		header(words_surface_define),
		op_surface_define,
		surface_id,
		numeric.pack_low_high(width, height),
		format_usage
	)
end

function vdp_rpu.constant_bank_define(bank_id, first_word, word_count)
	memwrite(
		vdp_stream.claim(5),
		header(words_constant_bank_define),
		op_constant_bank_define,
		bank_id,
		first_word,
		word_count
	)
end

function vdp_rpu.constant_upload_dma(bank_id, dst_word_offset, src_addr, word_count)
	memwrite(
		vdp_stream.claim(6),
		header(words_constant_upload_dma),
		op_constant_upload_dma,
		bank_id,
		dst_word_offset,
		src_addr,
		word_count
	)
end

function vdp_rpu.constant_upload_inline(bank_id, dst_word_offset, word_count, ...)
	memwrite(
		vdp_stream.claim(5 + word_count),
		header(words_constant_upload_inline_min + word_count),
		op_constant_upload_inline,
		bank_id,
		dst_word_offset,
		word_count,
		...
	)
end

function vdp_rpu.constant_upload_device(bank_id, dst_word_offset, source, source_word_offset, word_count)
	memwrite(
		vdp_stream.claim(7),
		header(words_constant_upload_device),
		op_constant_upload_device,
		bank_id,
		dst_word_offset,
		source,
		source_word_offset,
		word_count
	)
end

function vdp_rpu.begin_pass(color_surface_id, depth_surface_id, viewport_x, viewport_y, viewport_w, viewport_h, pass_ops, clear_color, clear_depth_word)
	memwrite(
		vdp_stream.claim(9),
		header(words_begin_pass),
		op_begin_pass,
		color_surface_id,
		depth_surface_id,
		numeric.pack_low_high(viewport_x, viewport_y),
		numeric.pack_low_high(viewport_w, viewport_h),
		pass_ops,
		clear_color,
		clear_depth_word
	)
end

function vdp_rpu.end_pass()
	memwrite(
		vdp_stream.claim(2),
		header(words_end_pass),
		op_end_pass
	)
end

function vdp_rpu.begin_draw(shader_variant, primitive_index_type, pipeline_word, vertex_count, instance_count, index_buffer_id, index_byte_offset, index_count)
	memwrite(
		vdp_stream.claim(10),
		header(words_begin_draw),
		op_begin_draw,
		shader_variant,
		primitive_index_type,
		pipeline_word,
		vertex_count,
		instance_count,
		index_buffer_id,
		index_byte_offset,
		index_count
	)
end

function vdp_rpu.bind_stream(stream_slot, layout_id, buffer_id, byte_offset, step_rate)
	memwrite(
		vdp_stream.claim(7),
		header(words_bind_stream),
		op_bind_stream,
		stream_slot,
		layout_id,
		buffer_id,
		byte_offset,
		step_rate
	)
end

function vdp_rpu.bind_constants(binding_slot, bank_id, first_word, word_count)
	memwrite(
		vdp_stream.claim(6),
		header(words_bind_constants),
		op_bind_constants,
		binding_slot,
		bank_id,
		first_word,
		word_count
	)
end

function vdp_rpu.bind_texture(texture_slot, surface_id, sampler_word)
	memwrite(
		vdp_stream.claim(5),
		header(words_bind_texture),
		op_bind_texture,
		texture_slot,
		surface_id,
		sampler_word
	)
end

function vdp_rpu.end_draw()
	memwrite(
		vdp_stream.claim(2),
		header(words_end_draw),
		op_end_draw
	)
end


vdp_rpu.usage_vertex = usage_vertex
vdp_rpu.usage_index = usage_index
vdp_rpu.usage_constant = usage_constant
vdp_rpu.surface_format_rgba8 = surface_format_rgba8
vdp_rpu.surface_format_depth16 = surface_format_depth16
vdp_rpu.surface_usage_color = surface_usage_color
vdp_rpu.surface_usage_depth = surface_usage_depth
vdp_rpu.surface_usage_texture = surface_usage_texture
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
vdp_rpu.filter_nearest = filter_nearest
vdp_rpu.filter_linear = filter_linear
vdp_rpu.wrap_clamp = wrap_clamp
vdp_rpu.wrap_repeat = wrap_repeat
vdp_rpu.layout_v2_c4 = layout_v2_c4
vdp_rpu.layout_v2_t2_c4 = layout_v2_t2_c4
vdp_rpu.layout_v3_c4 = layout_v3_c4
vdp_rpu.layout_v3_t2_c4 = layout_v3_t2_c4
vdp_rpu.layout_v3_n3_c4 = layout_v3_n3_c4
vdp_rpu.layout_v3_n3_t2_c4 = layout_v3_n3_t2_c4
vdp_rpu.layout_v3_n3_t2_c4_j4_w4 = layout_v3_n3_t2_c4_j4_w4
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
vdp_rpu.constant_source_xf_q16 = constant_source_xf_q16
vdp_rpu.constant_source_lpu_raw = constant_source_lpu_raw
vdp_rpu.constant_source_mfu_q16 = constant_source_mfu_q16
vdp_rpu.constant_source_jtu_q16 = constant_source_jtu_q16
vdp_rpu.surface_system = surface_system
vdp_rpu.surface_primary = surface_primary
vdp_rpu.surface_secondary = surface_secondary

return vdp_rpu
