local irq_mask_register<const>: *word = 0x0800010c
local irq_ack_register<const>: *word = 0x08000108
local inp_keys<const>: *word[8] = 0x0800019c
local inp_ctrl_register<const>: *word = 0x08000194
local gp0<const>: *word = 0x0801036c
local gp1<const>: *word = 0x08010370
local gte_data<const>: *word[32] = 0x08010374
local gte_control<const>: *word[32] = 0x080103f4
local gte_command<const>: *word = 0x08010474

local irq_vblank<const> = 0x10
local irq_pending_flags = 0

function irq(flags)
	irq_pending_flags = irq_pending_flags | flags
	*irq_ack_register = flags
end

local key_q<const> = 20
local key_e<const> = 8
local key_w<const> = 26
local key_s<const> = 22
local key_a<const> = 4
local key_d<const> = 7
local key_arrow_right<const> = 79
local key_arrow_left<const> = 80
local key_shift_left<const> = 225

local screen_width<const> = 320
local screen_height<const> = 240
local scene_vram_x<const> = 0
local scene_vram_y<const> = 256
local texture_addr<const> = 0x08040000
local texture_width<const> = 64
local texture_height<const> = 64
local texture_vram_x<const> = 512
local texture_vram_y<const> = 256

local gp1_reset<const> = 0x00000000
local gp1_display_enable<const> = 0x03000000
local gp1_display_start_0<const> = 0x05000000
local gp1_horizontal_320_pal<const> = 0x06c6e27e
local gp1_vertical_240_pal<const> = 0x07044c23
local gp1_display_mode_320_pal<const> = 0x08000009

local gp0_fill_rectangle<const> = 0x02000000
local gp0_draw_triangle<const> = 0x20000000
local gp0_draw_semitransparent_triangle<const> = 0x22000000
local gp0_draw_quad<const> = 0x28000000
local gp0_draw_semitransparent_quad<const> = 0x2a000000
local gp0_draw_gouraud_triangle<const> = 0x30000000
local gp0_draw_semitransparent_gouraud_triangle<const> = 0x32000000
local gp0_draw_textured_quad<const> = 0x2c000000
local gp0_draw_raw_textured_quad<const> = 0x2d000000
local gp0_draw_semitransparent_textured_quad<const> = 0x2e000000
local gp0_draw_rectangle<const> = 0x60000000
local gp0_draw_semitransparent_rectangle<const> = 0x62000000
local gp0_draw_line<const> = 0x40000000
local gp0_draw_semitransparent_line<const> = 0x42000000
local gp0_copy_vram_to_vram<const> = 0x80000000
local gp0_cpu_to_vram<const> = 0xa0000000
local gp0_draw_mode<const> = 0xe1000000
local gp0_drawing_area_top_left<const> = 0xe3000000
local gp0_drawing_area_bottom_right<const> = 0xe4000000
local gp0_drawing_offset<const> = 0xe5000000
local gp0_mask_bit_mode_0<const> = 0xe6000000

local draw_mode_blend_half<const> = 0x00000000
local draw_mode_blend_add<const> = 0x00000020
local draw_mode_texture_direct16<const> = 0x00000100

local gte_opcode_rtsf<const> = 0x00080000
local gte_opcode_lm<const> = 0x00000400
local gte_opcode_rtps<const> = 0x00000001
local gte_opcode_rtpt<const> = 0x00000030
local gte_opcode_nclip<const> = 0x00000006
local gte_opcode_dpcs<const> = 0x00000010
local gte_opcode_intpl<const> = 0x00000011
local gte_opcode_ncdt<const> = 0x00000016
local gte_opcode_nct<const> = 0x00000020
local gte_opcode_dpct<const> = 0x0000002a
local gte_opcode_avsz3<const> = 0x0000002d
local gte_opcode_avsz4<const> = 0x0000002e
local gte_opcode_ncct<const> = 0x0000003f
local q12_one<const> = 0x00001000
local q12_rot_angle_sin<const> = 201
local q12_rot_angle_cos<const> = 4091
local q12_rot_ring_sin<const> = 2896
local q12_rot_ring_cos<const> = 2896
local zsf3_third<const> = 0x00000555

local color_black<const> = 0xff05070f
local color_sky_top<const> = 0xff120028
local color_sky_mid<const> = 0xff003c7a
local color_ground<const> = 0xff3c1020
local color_grid<const> = 0xff14355f
local color_grid_hot<const> = 0xffffd166
local color_tunnel_a<const> = 0xffffffff
local color_tunnel_b<const> = 0xff3df2ff
local color_tunnel_c<const> = 0xffff7a3d
local color_shard_a<const> = 0xffffe062
local color_shard_b<const> = 0xff34e8ff
local color_shard_c<const> = 0xffff3df2
local color_shard_d<const> = 0xff7cff6b
local color_sprite<const> = 0xffffffff
local color_shadow<const> = 0x80302060
local color_post_a<const> = 0x28ffffff
local color_post_b<const> = 0x243cffd8
local color_post_c<const> = 0x24ff4058
local color_flare_a<const> = 0x80ffffff
local color_flare_b<const> = 0x703df2ff
local color_flare_c<const> = 0x70ff7a3d

local scene_baseline<const> = 1
local scene_shards<const> = 2
local scene_flare<const> = 3
local scene_particles<const> = 4
local scene_idol<const> = 5
local scene_echo<const> = 6
local scene_count<const> = 6
local frame = 0
local scene_id = scene_baseline
local arrow_left_was_down = false
local arrow_right_was_down = false
local sprite_x = 136
local sprite_y = 96
local sprite_step<const> = 4
local angle_count<const> = 128
local angle_mask<const> = 127
local tunnel_phase = 0
local sprite_phase = 0
local mesh_phase = 0
local post_phase = 0
local tunnel_sin_q12 = 0
local tunnel_cos_q12 = q12_one
local sprite_sin_q12 = 0
local sprite_cos_q12 = q12_one
local mesh_sin_q12 = 0
local mesh_cos_q12 = q12_one
local post_sin_q12 = 0
local post_cos_q12 = q12_one
local shard_words<const>: *word = 0x08044000
local shard_count<const> = 32
local shard_stride<const> = 8
local particle_words<const>: *word = 0x08045000
local particle_count<const> = 72
local particle_stride<const> = 4
local angle_words<const>: *word = 0x08046000

local wait_vblank<const> = function()
	while (irq_pending_flags & irq_vblank) == 0 do
		halt_until_irq
	end
	irq_pending_flags = irq_pending_flags - (irq_pending_flags & irq_vblank)
end

local key_down<const> = function(key)
	return (inp_keys[key >> 5] & (1 << (key & 31))) ~= 0
end

local argb_to_gp0_rgb<const> = function(color)
	return ((color & 0x00ff0000) >> 16) | (color & 0x0000ff00) | ((color & 0x000000ff) << 16)
end

local argb_to_gp0_modulated_rgb<const> = function(color)
	local alpha<const> = (color >> 24) & 0x000000ff
	return ((((color >> 16) & 0x000000ff) * alpha) // 255)
		| (((((color >> 8) & 0x000000ff) * alpha) // 255) << 8)
		| ((((color & 0x000000ff) * alpha) // 255) << 16)
end

local xy<const> = function(x, y)
	return (x & 0x0000ffff) | ((y & 0x0000ffff) << 16)
end

local wh<const> = function(width, height)
	return (width & 0x0000ffff) | ((height & 0x0000ffff) << 16)
end

local uv<const> = function(u, v)
	return (u & 0x000000ff) | ((v & 0x000000ff) << 8)
end

local pack_i16_pair<const> = function(lo, hi)
	return (lo & 0x0000ffff) | ((hi & 0x0000ffff) << 16)
end

local unpack_sx<const> = function(sxy)
	local value<const> = sxy & 0x0000ffff
	return value >= 0x00008000 and value - 0x00010000 or value
end

local unpack_sy<const> = function(sxy)
	local value<const> = (sxy >> 16) & 0x0000ffff
	return value >= 0x00008000 and value - 0x00010000 or value
end

local gte_rgb_to_argb<const> = function(rgb)
	return 0xff000000 | ((rgb & 0x000000ff) << 16) | (rgb & 0x0000ff00) | ((rgb & 0x00ff0000) >> 16)
end

local rotate_q12<const> = function(sin_q12, cos_q12, step_sin_q12, step_cos_q12)
	return ((sin_q12 * step_cos_q12 + cos_q12 * step_sin_q12) >> 12),
		((cos_q12 * step_cos_q12 - sin_q12 * step_sin_q12) >> 12)
end

local build_angle_table<const> = function()
	local sin_q12 = 0
	local cos_q12 = q12_one
	local angle = 0
	while angle < angle_count do
		local word_base<const> = angle << 1
		angle_words[word_base] = sin_q12
		angle_words[word_base + 1] = cos_q12
		sin_q12, cos_q12 = rotate_q12(sin_q12, cos_q12, q12_rot_angle_sin, q12_rot_angle_cos)
		angle = angle + 1
	end
end

local update_animation_vectors<const> = function()
	local tunnel_base<const> = tunnel_phase << 1
	tunnel_sin_q12 = angle_words[tunnel_base]
	tunnel_cos_q12 = angle_words[tunnel_base + 1]
	local sprite_base<const> = sprite_phase << 1
	sprite_sin_q12 = angle_words[sprite_base]
	sprite_cos_q12 = angle_words[sprite_base + 1]
	local mesh_base<const> = mesh_phase << 1
	mesh_sin_q12 = angle_words[mesh_base]
	mesh_cos_q12 = angle_words[mesh_base + 1]
	local post_base<const> = post_phase << 1
	post_sin_q12 = angle_words[post_base]
	post_cos_q12 = angle_words[post_base + 1]
end

local direct16_from_rgba8888<const> = function(color)
	if (color & 0xff000000) == 0 then
		return 0
	end
	return ((color & 0x000000f8) >> 3)
		| ((color & 0x0000f800) >> 6)
		| ((color & 0x00f80000) >> 9)
		| 0x00008000
end

local gpu_draw_mode_for_page<const> = function(page_x, page_y, blend_mode)
	return draw_mode_texture_direct16
		| blend_mode
		| ((page_x >> 6) & 0x0000000f)
		| ((page_y & 0x00000100) >> 4)
end

local gpu_drawing_window<const> = function(x0, y0, x1, y1)
	*gp0 = gp0_drawing_area_top_left | (x0 & 0x000003ff) | ((y0 & 0x000003ff) << 10)
	*gp0 = gp0_drawing_area_bottom_right | (x1 & 0x000003ff) | ((y1 & 0x000003ff) << 10)
end

local gpu_drawing_offset<const> = function(x, y)
	*gp0 = gp0_drawing_offset | (x & 0x000007ff) | ((y & 0x000007ff) << 11)
end

local gpu_reset_320x240_pal<const> = function()
	*gp1 = gp1_reset
	*gp1 = gp1_display_mode_320_pal
	*gp1 = gp1_display_start_0
	*gp1 = gp1_horizontal_320_pal
	*gp1 = gp1_vertical_240_pal
	*gp0 = gp0_draw_mode | draw_mode_blend_half
	gpu_drawing_window(0, 0, screen_width - 1, screen_height - 1)
	gpu_drawing_offset(0, 0)
	*gp0 = gp0_mask_bit_mode_0
	*gp1 = gp1_display_enable
end

local gpu_clear_rect<const> = function(x, y, width, height, color)
	*gp0 = gp0_fill_rectangle | argb_to_gp0_rgb(color)
	*gp0 = xy(x, y)
	*gp0 = wh(width, height)
end

local gpu_copy_vram<const> = function(source_x, source_y, target_x, target_y, width, height)
	*gp0 = gp0_copy_vram_to_vram
	*gp0 = xy(source_x, source_y)
	*gp0 = xy(target_x, target_y)
	*gp0 = wh(width, height)
end

local gpu_rect<const> = function(x0, y0, x1, y1, color)
	local alpha<const> = color & 0xff000000
	if alpha == 0xff000000 then
		*gp0 = gp0_draw_rectangle | argb_to_gp0_rgb(color)
	else
		*gp0 = gp0_draw_semitransparent_rectangle | argb_to_gp0_modulated_rgb(color)
	end
	*gp0 = xy(x0, y0)
	*gp0 = wh(x1 - x0, y1 - y0)
end

local gpu_line<const> = function(x0, y0, x1, y1, color)
	local alpha<const> = color & 0xff000000
	if alpha == 0xff000000 then
		*gp0 = gp0_draw_line | argb_to_gp0_rgb(color)
	else
		*gp0 = gp0_draw_semitransparent_line | argb_to_gp0_modulated_rgb(color)
	end
	*gp0 = xy(x0, y0)
	*gp0 = xy(x1, y1)
end

local gpu_triangle<const> = function(x0, y0, x1, y1, x2, y2, color)
	local alpha<const> = color & 0xff000000
	if alpha == 0xff000000 then
		*gp0 = gp0_draw_triangle | argb_to_gp0_rgb(color)
	else
		*gp0 = gp0_draw_semitransparent_triangle | argb_to_gp0_modulated_rgb(color)
	end
	*gp0 = xy(x0, y0)
	*gp0 = xy(x1, y1)
	*gp0 = xy(x2, y2)
end

local gpu_quad<const> = function(x0, y0, x1, y1, x2, y2, x3, y3, color)
	local alpha<const> = color & 0xff000000
	if alpha == 0xff000000 then
		*gp0 = gp0_draw_quad | argb_to_gp0_rgb(color)
	else
		*gp0 = gp0_draw_semitransparent_quad | argb_to_gp0_modulated_rgb(color)
	end
	*gp0 = xy(x0, y0)
	*gp0 = xy(x1, y1)
	*gp0 = xy(x2, y2)
	*gp0 = xy(x3, y3)
end

local gpu_gouraud_triangle<const> = function(x0, y0, color0, x1, y1, color1, x2, y2, color2)
	*gp0 = gp0_draw_gouraud_triangle | argb_to_gp0_rgb(color0)
	*gp0 = xy(x0, y0)
	*gp0 = argb_to_gp0_rgb(color1)
	*gp0 = xy(x1, y1)
	*gp0 = argb_to_gp0_rgb(color2)
	*gp0 = xy(x2, y2)
end

local gpu_semitransparent_gouraud_triangle<const> = function(x0, y0, color0, x1, y1, color1, x2, y2, color2)
	*gp0 = gp0_draw_semitransparent_gouraud_triangle | argb_to_gp0_rgb(color0)
	*gp0 = xy(x0, y0)
	*gp0 = argb_to_gp0_rgb(color1)
	*gp0 = xy(x1, y1)
	*gp0 = argb_to_gp0_rgb(color2)
	*gp0 = xy(x2, y2)
end

local gpu_direct16_textured_quad<const> = function(
		page_x, page_y,
		u0, v0, u1, v1, u2, v2, u3, v3,
		x0, y0, x1, y1, x2, y2, x3, y3,
		color, blend_mode)
	local draw_mode<const> = gpu_draw_mode_for_page(page_x, page_y, blend_mode)
	*gp0 = gp0_draw_mode | draw_mode
	if color == 0xffffffff then
		*gp0 = gp0_draw_raw_textured_quad | 0x00808080
	else
		local alpha<const> = color & 0xff000000
		if alpha == 0xff000000 then
			*gp0 = gp0_draw_textured_quad | argb_to_gp0_rgb(color)
		else
			*gp0 = gp0_draw_semitransparent_textured_quad | argb_to_gp0_modulated_rgb(color)
		end
	end
	*gp0 = xy(x0, y0)
	*gp0 = uv(u0, v0)
	*gp0 = xy(x1, y1)
	*gp0 = uv(u1, v1) | (draw_mode << 16)
	*gp0 = xy(x2, y2)
	*gp0 = uv(u2, v2)
	*gp0 = xy(x3, y3)
	*gp0 = uv(u3, v3)
end

local upload_texture<const> = function()
	*gp0 = gp0_cpu_to_vram
	*gp0 = xy(texture_vram_x, texture_vram_y)
	*gp0 = wh(texture_width, texture_height)
	local pixels<const>: *word = texture_addr
	local pixel_index = 0
	while pixel_index < texture_width * texture_height do
		local lo<const> = direct16_from_rgba8888(pixels[pixel_index])
		local hi<const> = direct16_from_rgba8888(pixels[pixel_index + 1])
		*gp0 = lo | (hi << 16)
		pixel_index = pixel_index + 2
	end
end

local gte_write_y_rotation_translation<const> = function(sin_q12, cos_q12, tx, ty, tz)
	gte_control[0] = pack_i16_pair(cos_q12, 0)
	gte_control[1] = pack_i16_pair(sin_q12, 0)
	gte_control[2] = pack_i16_pair(q12_one, 0)
	gte_control[3] = pack_i16_pair(0 - sin_q12, 0)
	gte_control[4] = cos_q12
	gte_control[5] = tx
	gte_control[6] = ty
	gte_control[7] = tz
end

local gte_project_face<const> = function(x0, y0, z0, x1, y1, z1, x2, y2, z2)
	gte_data[0] = pack_i16_pair(x0, y0)
	gte_data[1] = z0 & 0x0000ffff
	gte_data[2] = pack_i16_pair(x1, y1)
	gte_data[3] = z1 & 0x0000ffff
	gte_data[4] = pack_i16_pair(x2, y2)
	gte_data[5] = z2 & 0x0000ffff
	*gte_command = gte_opcode_rtsf | gte_opcode_rtpt
	*gte_command = gte_opcode_nclip
	local nclip<const> = gte_data[24]
	*gte_command = gte_opcode_avsz3
	local sxy0<const> = gte_data[12]
	local sxy1<const> = gte_data[13]
	local sxy2<const> = gte_data[14]
	return unpack_sx(sxy0), unpack_sy(sxy0),
		unpack_sx(sxy1), unpack_sy(sxy1),
		unpack_sx(sxy2), unpack_sy(sxy2),
		gte_data[7], nclip
end

local gte_project_quad<const> = function(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3)
	gte_data[0] = pack_i16_pair(x0, y0)
	gte_data[1] = z0 & 0x0000ffff
	gte_data[2] = pack_i16_pair(x1, y1)
	gte_data[3] = z1 & 0x0000ffff
	gte_data[4] = pack_i16_pair(x2, y2)
	gte_data[5] = z2 & 0x0000ffff
	*gte_command = gte_opcode_rtsf | gte_opcode_rtpt
	*gte_command = gte_opcode_nclip
	local nclip<const> = gte_data[24]
	local sxy0<const> = gte_data[12]
	local sxy1<const> = gte_data[13]
	local sxy2<const> = gte_data[14]
	gte_data[0] = pack_i16_pair(x3, y3)
	gte_data[1] = z3 & 0x0000ffff
	*gte_command = gte_opcode_rtsf | gte_opcode_rtps
	*gte_command = gte_opcode_avsz4
	local sxy3<const> = gte_data[14]
	return unpack_sx(sxy0), unpack_sy(sxy0),
		unpack_sx(sxy1), unpack_sy(sxy1),
		unpack_sx(sxy2), unpack_sy(sxy2),
		unpack_sx(sxy3), unpack_sy(sxy3),
		gte_data[7], nclip
end

local gte_project_point<const> = function(x, y, z)
	gte_data[0] = pack_i16_pair(x, y)
	gte_data[1] = z & 0x0000ffff
	*gte_command = gte_opcode_rtsf | gte_opcode_rtps
	local sxy<const> = gte_data[14]
	return unpack_sx(sxy), unpack_sy(sxy), gte_data[19]
end

local gte_write_lighting_matrices<const> = function()
	gte_control[8] = pack_i16_pair(3072, 0 - 768)
	gte_control[9] = pack_i16_pair(1536, 512)
	gte_control[10] = pack_i16_pair(3584, 768)
	gte_control[11] = pack_i16_pair(0 - 1024, 1024)
	gte_control[12] = 3072
	gte_control[13] = 0x00000018
	gte_control[14] = 0x00000010
	gte_control[15] = 0x00000028
	gte_control[16] = pack_i16_pair(4096, 1024)
	gte_control[17] = pack_i16_pair(512, 512)
	gte_control[18] = pack_i16_pair(3584, 1024)
	gte_control[19] = pack_i16_pair(768, 512)
	gte_control[20] = 4096
	gte_control[21] = 0x00000012
	gte_control[22] = 0x00000028
	gte_control[23] = 0x00000050
end

local build_texture<const> = function()
	local pixels<const>: *word = texture_addr
	local py = 0
	local wi = 0
	while py < texture_height do
		local px = 0
		while px < texture_width do
			local dx = px - 31
			if dx < 0 then
				dx = 0 - dx
			end
			local dy = py - 31
			if dy < 0 then
				dy = 0 - dy
			end
			local distance<const> = dx + dy
			local color = 0xff150a28
			if ((px * 5 + py * 3) & 15) <= 2 then
				color = 0xff2de6ff
			end
			if ((px * 7 - py * 5) & 31) <= 2 then
				color = 0xfffff2a6
			end
			if distance <= 36 then
				color = 0xff2a123c
			end
			if distance <= 25 then
				color = 0xffe64824
			end
			if distance <= 12 then
				color = 0xffffdc62
			end
			if ((px + py + frame) & 7) == 0 then
				color = 0xffffffff
			end
			pixels[wi] = color
			wi = wi + 1
			px = px + 1
		end
		py = py + 1
	end
end

local update_input<const> = function()
	*inp_ctrl_register = 0x00000001
	local arrow_left_down<const> = key_down(key_arrow_left)
	local arrow_right_down<const> = key_down(key_arrow_right)
	if arrow_left_down and not arrow_left_was_down then
		scene_id = scene_id - 1
		if scene_id < scene_baseline then
			scene_id = scene_count
		end
	end
	if arrow_right_down and not arrow_right_was_down then
		scene_id = scene_id + 1
		if scene_id > scene_count then
			scene_id = scene_id - scene_count
		end
	end
	arrow_left_was_down = arrow_left_down
	arrow_right_was_down = arrow_right_down
	local step = sprite_step
	if key_down(key_shift_left) then
		step = sprite_step + 3
	end
	if key_down(key_a) then
		sprite_x = sprite_x - step
	end
	if key_down(key_d) then
		sprite_x = sprite_x + step
	end
	if key_down(key_w) then
		sprite_y = sprite_y - step
	end
	if key_down(key_s) then
		sprite_y = sprite_y + step
	end
	if sprite_x < 24 then
		sprite_x = 24
	end
	if sprite_x > screen_width - 24 then
		sprite_x = screen_width - 24
	end
	if sprite_y < 24 then
		sprite_y = 24
	end
	if sprite_y > screen_height - 24 then
		sprite_y = screen_height - 24
	end
end

local draw_background<const> = function()
	gpu_gouraud_triangle(0, 0, color_sky_top, screen_width, 0, color_sky_top, 0, 146, color_sky_mid)
	gpu_gouraud_triangle(screen_width, 0, color_sky_top, screen_width, 146, color_sky_mid, 0, 146, color_sky_mid)
	gpu_gouraud_triangle(0, 146, color_sky_mid, screen_width, 146, color_sky_mid, 0, screen_height, color_ground)
	gpu_gouraud_triangle(screen_width, 146, color_sky_mid, screen_width, screen_height, color_ground, 0, screen_height, color_ground)
	local y = 160
	while y < screen_height do
		gpu_line(0, y, screen_width, y + ((y - 160) >> 2), color_grid)
		y = y + 12
	end
	local x = 16
	while x < screen_width do
		gpu_line(x, 156, 160 + ((x - 160) * 3), screen_height, color_grid)
		x = x + 32
	end
end

local draw_tunnel_quad<const> = function(center_x, center_y, radius_x, radius_y, sin_q12, cos_q12, color)
	local axis_xx<const> = (cos_q12 * radius_x) >> 12
	local axis_xy<const> = (sin_q12 * radius_x) >> 12
	local axis_yx<const> = ((0 - sin_q12) * radius_y) >> 12
	local axis_yy<const> = (cos_q12 * radius_y) >> 12
	local x0<const> = center_x - axis_xx - axis_yx
	local y0<const> = center_y - axis_xy - axis_yy
	local x1<const> = center_x + axis_xx - axis_yx
	local y1<const> = center_y + axis_xy - axis_yy
	local x2<const> = center_x - axis_xx + axis_yx
	local y2<const> = center_y - axis_xy + axis_yy
	local x3<const> = center_x + axis_xx + axis_yx
	local y3<const> = center_y + axis_xy + axis_yy
	gpu_direct16_textured_quad(
		texture_vram_x, texture_vram_y,
		0, 0, texture_width, 0, 0, texture_height, texture_width, texture_height,
		x0, y0, x1, y1, x2, y2, x3, y3,
		color, draw_mode_blend_half)
end

local draw_affine_tunnel<const> = function()
	local ring_sin = tunnel_sin_q12
	local ring_cos = tunnel_cos_q12
	local tunnel_index = 0
	while tunnel_index < 12 do
		local depth<const> = 12 - tunnel_index
		local radius_x<const> = 18 + depth * 9
		local radius_y<const> = 12 + depth * 5
		local y<const> = 76 + tunnel_index * 4
		local color = color_tunnel_a
		if (tunnel_index & 3) == 1 then
			color = color_tunnel_b
		end
		if (tunnel_index & 3) == 2 then
			color = color_tunnel_c
		end
		draw_tunnel_quad(160, y, radius_x, radius_y, ring_sin, ring_cos, color)
		ring_sin, ring_cos = rotate_q12(ring_sin, ring_cos, q12_rot_ring_sin, q12_rot_ring_cos)
		tunnel_index = tunnel_index + 1
	end
end

local draw_sprite<const> = function()
	draw_tunnel_quad(sprite_x, sprite_y, 24, 24, sprite_sin_q12, sprite_cos_q12, color_sprite)
	gpu_line(sprite_x - 30, sprite_y, sprite_x + 30, sprite_y, color_grid_hot)
	gpu_line(sprite_x, sprite_y - 30, sprite_x, sprite_y + 30, color_grid_hot)
end

local draw_projected_triangle<const> = function(
		sx0, sy0, sx1, sy1, sx2, sy2, nclip,
		color0, color1, color2)
	if (nclip & 0x80000000) == 0 then
		gpu_gouraud_triangle(sx0, sy0, color0, sx1, sy1, color1, sx2, sy2, color2)
	else
		gpu_gouraud_triangle(sx0, sy0, color2, sx1, sy1, color1, sx2, sy2, color0)
	end
end

local draw_depth_sorted_gte_mesh<const> = function()
	local translate_z<const> = 470
	gte_control[29] = zsf3_third
	gte_control[24] = 160 << 16
	gte_control[25] = 106 << 16
	gte_control[26] = 256
	gte_write_y_rotation_translation(mesh_sin_q12, mesh_cos_q12, -48, -8, translate_z)
	local ax0<const>, ay0<const>, ax1<const>, ay1<const>, ax2<const>, ay2<const>, adepth<const>, anclip<const> =
		gte_project_face(0, -72, 0, -78, 58, 76, 78, 58, 76)
	gte_write_y_rotation_translation(0 - mesh_sin_q12, mesh_cos_q12, 52, 8, translate_z - 34)
	local bx0<const>, by0<const>, bx1<const>, by1<const>, bx2<const>, by2<const>, bdepth<const>, bnclip<const> =
		gte_project_face(0, -64, 0, 76, 48, 72, 0, 62, -86)
	if adepth > bdepth then
		draw_projected_triangle(ax0, ay0, ax1, ay1, ax2, ay2, anclip, color_shard_a, color_shard_b, color_shard_c)
		draw_projected_triangle(bx0, by0, bx1, by1, bx2, by2, bnclip, color_shard_c, color_shard_d, color_shard_a)
	else
		draw_projected_triangle(bx0, by0, bx1, by1, bx2, by2, bnclip, color_shard_c, color_shard_d, color_shard_a)
		draw_projected_triangle(ax0, ay0, ax1, ay1, ax2, ay2, anclip, color_shard_a, color_shard_b, color_shard_c)
	end
	gte_write_y_rotation_translation(mesh_sin_q12, mesh_cos_q12, 0, 18, translate_z + 72)
	local cx0<const>, cy0<const>, cx1<const>, cy1<const>, cx2<const>, cy2<const>, cdepth<const>, cnclip<const> =
		gte_project_face(0, -42, 0, -50, 34, 52, 50, 34, 52)
	local dx0<const>, dy0<const>, dx1<const>, dy1<const>, dx2<const>, dy2<const>, ddepth<const>, dnclip<const> =
		gte_project_face(0, -42, 0, 50, 34, 52, 0, 34, -60)
	if cdepth > ddepth then
		draw_projected_triangle(cx0, cy0, cx1, cy1, cx2, cy2, cnclip, color_shard_d, color_shard_b, color_shard_a)
		draw_projected_triangle(dx0, dy0, dx1, dy1, dx2, dy2, dnclip, color_shard_c, color_shard_a, color_shard_b)
	else
		draw_projected_triangle(dx0, dy0, dx1, dy1, dx2, dy2, dnclip, color_shard_c, color_shard_a, color_shard_b)
		draw_projected_triangle(cx0, cy0, cx1, cy1, cx2, cy2, cnclip, color_shard_d, color_shard_b, color_shard_a)
	end
end

local draw_post_quad<const> = function(center_x, center_y, radius_x, radius_y, sin_q12, cos_q12, color)
	local axis_xx<const> = (cos_q12 * radius_x) >> 12
	local axis_xy<const> = (sin_q12 * radius_x) >> 12
	local axis_yx<const> = ((0 - sin_q12) * radius_y) >> 12
	local axis_yy<const> = (cos_q12 * radius_y) >> 12
	gpu_direct16_textured_quad(
		64, scene_vram_y,
		0, 48, 191, 48, 0, 191, 191, 191,
		center_x - axis_xx - axis_yx, center_y - axis_xy - axis_yy,
		center_x + axis_xx - axis_yx, center_y + axis_xy - axis_yy,
		center_x - axis_xx + axis_yx, center_y - axis_xy + axis_yy,
		center_x + axis_xx + axis_yx, center_y + axis_xy + axis_yy,
		color, draw_mode_blend_half)
end

local draw_post_pass<const> = function()
	local s0<const> = post_sin_q12
	local c0<const> = post_cos_q12
	draw_post_quad(160, 120, 122, 90, s0, c0, color_post_a)
	local s1<const>, c1<const> = rotate_q12(s0, c0, q12_rot_ring_sin, q12_rot_ring_cos)
	draw_post_quad(160, 120, 138, 100, s1, c1, color_post_b)
	local s2<const>, c2<const> = rotate_q12(s1, c1, q12_rot_ring_sin, q12_rot_ring_cos)
	draw_post_quad(160, 120, 154, 110, s2, c2, color_post_c)
end

local draw_vector_overlay<const> = function()
	local phase<const> = frame % 160
	gpu_line(22, 204, 298, 204, color_grid_hot)
	gpu_line(22, 214, 298, 214, color_grid)
	gpu_line(22 + phase, 198, 22 + phase, 220, color_grid_hot)
	gpu_line(26, 28, 82, 28, color_grid_hot)
	gpu_line(26, 28, 26, 66, color_grid_hot)
	gpu_line(82, 28, 82, 66, color_grid)
	gpu_line(26, 66, 82, 66, color_grid)
	local marker = 0
	while marker < scene_count do
		local marker_x<const> = 30 + marker * 9
		local marker_color = color_grid
		if marker + 1 == scene_id then
			marker_color = color_grid_hot
		end
		gpu_rect(marker_x, 34, marker_x + 5, 42, marker_color)
		marker = marker + 1
	end
	if key_down(key_q) then
		gpu_rect(224, 24, 304, 48, color_shadow)
	end
	if key_down(key_e) then
		gpu_rect(224, 52, 304, 76, color_shadow)
	end
end

local stage_projected_shard<const> = function(shard_index, burst)
	local group<const> = shard_index & 7
	local layer<const> = shard_index >> 3
	local sx_sign = 1
	if (group & 1) == 0 then
		sx_sign = -1
	end
	local sy_sign = 1
	if (group & 2) == 0 then
		sy_sign = -1
	end
	local sz_sign = 1
	if (group & 4) == 0 then
		sz_sign = -1
	end
	local tx<const> = sx_sign * (14 + burst + layer * 7) + (layer - 1) * 18
	local ty<const> = sy_sign * (8 + (burst >> 1)) + (layer - 2) * 5
	local tz<const> = 420 + layer * 28 + sz_sign * burst
	gte_write_y_rotation_translation(mesh_sin_q12, mesh_cos_q12, tx, ty, tz)
	local local_x0<const> = 0
	local local_y0<const> = -28 - layer * 2
	local local_z0<const> = sz_sign * 8
	local local_x1<const> = sx_sign * (22 + layer * 3)
	local local_y1<const> = 18
	local local_z1<const> = sz_sign * 18
	local local_x2<const> = 0 - sx_sign * (16 + ((group & 3) << 1))
	local local_y2<const> = 18 + sy_sign * 3
	local local_z2<const> = 0 - sz_sign * 20
	local sx0<const>, sy0<const>, sx1<const>, sy1<const>, sx2<const>, sy2<const>, depth<const>, nclip<const> =
		gte_project_face(local_x0, local_y0, local_z0, local_x1, local_y1, local_z1, local_x2, local_y2, local_z2)
	local word_base<const> = shard_index * shard_stride
	shard_words[word_base] = pack_i16_pair(sx0, sy0)
	shard_words[word_base + 1] = pack_i16_pair(sx1, sy1)
	shard_words[word_base + 2] = pack_i16_pair(sx2, sy2)
	shard_words[word_base + 3] = depth
	shard_words[word_base + 4] = nclip
	shard_words[word_base + 5] = color_shard_a
	shard_words[word_base + 6] = group < 4 and color_shard_b or color_shard_c
	shard_words[word_base + 7] = (layer & 1) == 0 and color_shard_d or color_grid_hot
end

local draw_staged_shards<const> = function()
	local bucket = 7
	while bucket >= 0 do
		local shard_index = 0
		while shard_index < shard_count do
			local word_base<const> = shard_index * shard_stride
			local depth<const> = shard_words[word_base + 3]
			if ((depth >> 5) & 7) == bucket then
				local sxy0<const> = shard_words[word_base]
				local sxy1<const> = shard_words[word_base + 1]
				local sxy2<const> = shard_words[word_base + 2]
				local nclip<const> = shard_words[word_base + 4]
				local color0<const> = shard_words[word_base + 5]
				local color1<const> = shard_words[word_base + 6]
				local color2<const> = shard_words[word_base + 7]
				if (nclip & 0x80000000) == 0 then
					gpu_semitransparent_gouraud_triangle(
						unpack_sx(sxy0), unpack_sy(sxy0), color0,
						unpack_sx(sxy1), unpack_sy(sxy1), color1,
						unpack_sx(sxy2), unpack_sy(sxy2), color2)
				else
					gpu_semitransparent_gouraud_triangle(
						unpack_sx(sxy0), unpack_sy(sxy0), color2,
						unpack_sx(sxy1), unpack_sy(sxy1), color1,
						unpack_sx(sxy2), unpack_sy(sxy2), color0)
				end
			end
			shard_index = shard_index + 1
		end
		bucket = bucket - 1
	end
end

local draw_exploding_crystal_shards<const> = function()
	local phase<const> = frame % 160
	local burst = phase
	if burst > 80 then
		burst = 160 - burst
	end
	gte_control[29] = zsf3_third
	gte_control[24] = 160 << 16
	gte_control[25] = 108 << 16
	gte_control[26] = 260
	local shard_index = 0
	while shard_index < shard_count do
		stage_projected_shard(shard_index, burst)
		shard_index = shard_index + 1
	end
	draw_staged_shards()
	gpu_rect(118 - (burst >> 2), 70 - (burst >> 3), 202 + (burst >> 2), 142 + (burst >> 3), 0x24ffffff)
end

local draw_tera_flare_panel<const> = function(layer, angle_sin, angle_cos, next_sin, next_cos, radius_outer, radius_inner, z_wave, color)
	local outer_x0<const> = (angle_cos * radius_outer) >> 12
	local outer_y0<const> = (angle_sin * radius_outer) >> 12
	local outer_x1<const> = (next_cos * radius_outer) >> 12
	local outer_y1<const> = (next_sin * radius_outer) >> 12
	local inner_x0<const> = (angle_cos * radius_inner) >> 12
	local inner_y0<const> = (angle_sin * radius_inner) >> 12
	local inner_x1<const> = (next_cos * radius_inner) >> 12
	local inner_y1<const> = (next_sin * radius_inner) >> 12
	local z0<const> = (angle_sin * z_wave) >> 12
	local z1<const> = (next_sin * z_wave) >> 12
	local sx0<const>, sy0<const>, sx1<const>, sy1<const>, sx2<const>, sy2<const>, sx3<const>, sy3<const>, depth<const>, nclip<const> =
		gte_project_quad(outer_x0, outer_y0, z0, outer_x1, outer_y1, z1, inner_x0, inner_y0, z0 - 12, inner_x1, inner_y1, z1 - 12)
	local u<const> = (frame + layer * 17) & 31
	if (nclip & 0x80000000) == 0 then
		gpu_direct16_textured_quad(
			texture_vram_x, texture_vram_y,
			u, 0, u + 32, 0, u, 32, u + 32, 32,
			sx0, sy0, sx1, sy1, sx2, sy2, sx3, sy3,
			color, draw_mode_blend_add)
	else
		gpu_direct16_textured_quad(
			texture_vram_x, texture_vram_y,
			u + 32, 0, u, 0, u + 32, 32, u, 32,
			sx1, sy1, sx0, sy0, sx3, sy3, sx2, sy2,
			color, draw_mode_blend_add)
	end
end

local draw_tera_flare_energy_sphere<const> = function()
	local phase<const> = frame % 128
	local pulse<const> = phase < 64 and phase or 128 - phase
	gte_control[30] = 0x00000400
	gte_control[24] = 160 << 16
	gte_control[25] = 110 << 16
	gte_control[26] = 245
	local layer = 0
	while layer < 4 do
		local layer_sin = post_sin_q12
		local layer_cos = post_cos_q12
		local l = 0
		while l < layer do
			layer_sin, layer_cos = rotate_q12(layer_sin, layer_cos, q12_rot_ring_sin, q12_rot_ring_cos)
			l = l + 1
		end
		gte_write_y_rotation_translation(layer_sin, layer_cos, 0, 0, 430 + layer * 32)
		local angle_sin = layer_sin
		local angle_cos = layer_cos
		local panel = 0
		while panel < 8 do
			local next_sin<const>, next_cos<const> = rotate_q12(angle_sin, angle_cos, q12_rot_ring_sin, q12_rot_ring_cos)
			local outer<const> = 46 + layer * 18 + pulse
			local inner<const> = outer - 20
			local color = color_flare_a
			if (layer & 3) == 1 then
				color = color_flare_b
			end
			if (layer & 3) == 2 then
				color = color_flare_c
			end
			draw_tera_flare_panel(layer, angle_sin, angle_cos, next_sin, next_cos, outer, inner, 36 + layer * 12, color)
			angle_sin = next_sin
			angle_cos = next_cos
			panel = panel + 1
		end
		layer = layer + 1
	end
	gpu_rect(132 - (pulse >> 2), 84 - (pulse >> 2), 188 + (pulse >> 2), 136 + (pulse >> 2), 0x34ffffff)
end

local stage_depth_cued_particle<const> = function(particle_index)
	local lane<const> = particle_index & 7
	local bank<const> = particle_index >> 3
	local phase<const> = (frame * 3 + particle_index * 13) & 127
	local x<const> = (((lane * 41 + bank * 17 + phase) & 63) - 32) * 2
	local y<const> = ((bank * 29 + lane * 11 + frame) & 63) - 32
	local z<const> = 36 + phase * 3 + bank * 14
	local sx<const>, sy<const>, sz<const> = gte_project_point(x, y, z)
	local fade = 4096 - (sz << 2)
	if fade < 384 then
		fade = 384
	end
	if fade > 4096 then
		fade = 4096
	end
	gte_control[21] = 0x00000010
	gte_control[22] = 0x00000028
	gte_control[23] = 0x00000058
	gte_data[8] = fade
	if (particle_index & 3) == 0 then
		gte_data[20] = 0x001060ff
		gte_data[21] = 0x0040c8ff
		gte_data[22] = 0x00ffffff
		*gte_command = gte_opcode_rtsf | gte_opcode_lm | gte_opcode_dpct
	elseif (particle_index & 1) == 0 then
		gte_data[6] = 0x0030c8ff
		*gte_command = gte_opcode_rtsf | gte_opcode_lm | gte_opcode_dpcs
		*gte_command = gte_opcode_rtsf | gte_opcode_lm | gte_opcode_intpl
	else
		gte_data[6] = 0x00ffe060
		*gte_command = gte_opcode_rtsf | gte_opcode_lm | gte_opcode_dpcs
	end
	local depth = sz
	if (particle_index & 3) == 2 then
		*gte_command = gte_opcode_avsz3
		depth = gte_data[7]
	end
	local word_base<const> = particle_index * particle_stride
	particle_words[word_base] = pack_i16_pair(sx, sy)
	particle_words[word_base + 1] = depth
	particle_words[word_base + 2] = 0xb0000000 | (gte_rgb_to_argb(gte_data[22]) & 0x00ffffff) | 0x00101828
	particle_words[word_base + 3] = 2 + (fade >> 10)
end

local draw_staged_particles<const> = function()
	local bucket = 15
	while bucket >= 0 do
		local particle_index = 0
		while particle_index < particle_count do
			local word_base<const> = particle_index * particle_stride
			local depth<const> = particle_words[word_base + 1]
			if ((depth >> 5) & 15) == bucket then
				local sxy<const> = particle_words[word_base]
				local x<const> = unpack_sx(sxy)
				local y<const> = unpack_sy(sxy)
				local color<const> = particle_words[word_base + 2]
				local size<const> = particle_words[word_base + 3]
				gpu_line(x - size * 4, y - size, x + size, y + size, color)
				gpu_rect(x - size, y - size, x + size + 1, y + size + 1, color)
			end
			particle_index = particle_index + 1
		end
		bucket = bucket - 1
	end
end

local draw_depth_cued_particle_storm<const> = function()
	gte_control[24] = 160 << 16
	gte_control[25] = 110 << 16
	gte_control[26] = 235
	gte_control[27] = 0 - 96
	gte_control[28] = 0x01000000
	gte_control[29] = zsf3_third
	gte_write_y_rotation_translation(tunnel_sin_q12, tunnel_cos_q12, 0, 0, 190)
	local particle_index = 0
	while particle_index < particle_count do
		stage_depth_cued_particle(particle_index)
		particle_index = particle_index + 1
	end
	gpu_rect(138, 88, 182, 132, 0x2820f0ff)
	gpu_line(84, 120, 236, 120, 0x70ffffff)
	draw_staged_particles()
end

local draw_idol_face<const> = function(
		x0, y0, z0, x1, y1, z1, x2, y2, z2,
		nx0, ny0, nz0, nx1, ny1, nz1, nx2, ny2, nz2,
		command, color_word, depth_cue)
	gte_data[0] = pack_i16_pair(nx0, ny0)
	gte_data[1] = nz0 & 0x0000ffff
	gte_data[2] = pack_i16_pair(nx1, ny1)
	gte_data[3] = nz1 & 0x0000ffff
	gte_data[4] = pack_i16_pair(nx2, ny2)
	gte_data[5] = nz2 & 0x0000ffff
	gte_data[6] = color_word
	gte_data[8] = depth_cue
	*gte_command = gte_opcode_rtsf | gte_opcode_lm | command
	local color0<const> = gte_rgb_to_argb(gte_data[20])
	local color1<const> = gte_rgb_to_argb(gte_data[21])
	local color2<const> = gte_rgb_to_argb(gte_data[22])
	local sx0<const>, sy0<const>, sx1<const>, sy1<const>, sx2<const>, sy2<const>, depth<const>, nclip<const> =
		gte_project_face(x0, y0, z0, x1, y1, z1, x2, y2, z2)
	draw_projected_triangle(sx0, sy0, sx1, sy1, sx2, sy2, nclip, color0, color1, color2)
end

local draw_gouraud_lit_idol<const> = function()
	gte_control[24] = 160 << 16
	gte_control[25] = 108 << 16
	gte_control[26] = 270
	gte_write_y_rotation_translation(mesh_sin_q12, mesh_cos_q12, 0, 4, 440)
	gte_write_lighting_matrices()
	local angle_sin = mesh_sin_q12
	local angle_cos = mesh_cos_q12
	local panel = 0
	while panel < 8 do
		local next_sin<const>, next_cos<const> = rotate_q12(angle_sin, angle_cos, q12_rot_ring_sin, q12_rot_ring_cos)
		local ring_x0<const> = (angle_cos * 56) >> 12
		local ring_z0<const> = (angle_sin * 56) >> 12
		local ring_x1<const> = (next_cos * 56) >> 12
		local ring_z1<const> = (next_sin * 56) >> 12
		local command = gte_opcode_nct
		local color_word = 0x00ffa0ff
		if (panel & 3) == 1 then
			command = gte_opcode_ncdt
			color_word = 0x00e8ff80
		end
		if (panel & 3) == 2 then
			command = gte_opcode_ncct
			color_word = 0x0080e8ff
		end
		local depth_cue<const> = 0x00000400 + (panel << 8)
		draw_idol_face(
			0, -68, 0, ring_x0, -6, ring_z0, ring_x1, -6, ring_z1,
			0, -4096, 0, angle_cos, -1024, angle_sin, next_cos, -1024, next_sin,
			command, color_word, depth_cue)
		draw_idol_face(
			0, 66, 0, ring_x1, -6, ring_z1, ring_x0, -6, ring_z0,
			0, 4096, 0, next_cos, 1024, next_sin, angle_cos, 1024, angle_sin,
			command, color_word, depth_cue)
		angle_sin = next_sin
		angle_cos = next_cos
		panel = panel + 1
	end
	gpu_line(112, 166, 208, 166, 0x80ffffff)
	gpu_line(128, 176, 192, 176, 0x70ffd166)
end

local draw_scene<const> = function()
	draw_background()
	if scene_id == scene_shards then
		draw_exploding_crystal_shards()
	elseif scene_id == scene_flare then
		draw_tera_flare_energy_sphere()
	elseif scene_id == scene_particles then
		draw_depth_cued_particle_storm()
	elseif scene_id == scene_idol then
		draw_gouraud_lit_idol()
	else
		draw_affine_tunnel()
		draw_depth_sorted_gte_mesh()
		draw_sprite()
		gpu_triangle(108, 34, 126, 54, 92, 58, 0x70ffd166)
		gpu_quad(240, 178, 286, 188, 224, 218, 286, 228, 0x583cffd8)
	end
end

local draw_frame<const> = function()
	gpu_drawing_window(scene_vram_x, scene_vram_y, scene_vram_x + screen_width - 1, scene_vram_y + screen_height - 1)
	gpu_drawing_offset(0, scene_vram_y)
	gpu_clear_rect(scene_vram_x, scene_vram_y, screen_width, screen_height, color_black)
	draw_scene()
	gpu_drawing_window(0, 0, screen_width - 1, screen_height - 1)
	gpu_drawing_offset(0, 0)
	gpu_copy_vram(scene_vram_x, scene_vram_y, 0, 0, screen_width, screen_height)
	if scene_id == scene_echo then
		draw_post_pass()
	end
	draw_vector_overlay()
end

local advance_animation<const> = function()
	tunnel_phase = (tunnel_phase + 1) & angle_mask
	sprite_phase = (sprite_phase + 3) & angle_mask
	mesh_phase = (mesh_phase + 1) & angle_mask
	post_phase = (post_phase + 1) & angle_mask
	update_animation_vectors()
end

*irq_mask_register = irq_vblank
gpu_reset_320x240_pal()
build_angle_table()
update_animation_vectors()
build_texture()
upload_texture()
wait_vblank()

while true do
	wait_vblank()
	update_input()
	draw_frame()
	advance_animation()
	frame = frame + 1
end
