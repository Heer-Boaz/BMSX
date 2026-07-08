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

local key_digit1<const> = 30
local key_digit2<const> = 31
local key_q<const> = 20
local key_e<const> = 8
local key_w<const> = 26
local key_s<const> = 22
local key_a<const> = 4
local key_d<const> = 7
local key_shift_left<const> = 225

local screen_width<const> = 320
local screen_height<const> = 240
local scene_vram_x<const> = 0
local scene_vram_y<const> = 256
local texture_addr<const> = 0x08040000
local texture_width<const> = 16
local texture_height<const> = 16
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
local gte_opcode_rtpt<const> = 0x00000030
local gte_opcode_nclip<const> = 0x00000006
local gte_opcode_avsz3<const> = 0x0000002d
local q12_one<const> = 0x00001000
local q12_rot_tunnel_sin<const> = 200
local q12_rot_tunnel_cos<const> = 4091
local q12_rot_sprite_sin<const> = 560
local q12_rot_sprite_cos<const> = 4058
local q12_rot_mesh_sin<const> = 143
local q12_rot_mesh_cos<const> = 4094
local q12_rot_post_sin<const> = 100
local q12_rot_post_cos<const> = 4095
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

local frame = 0
local sprite_x = 136
local sprite_y = 96
local sprite_step<const> = 4
local tunnel_sin_q12 = 0
local tunnel_cos_q12 = q12_one
local sprite_sin_q12 = 0
local sprite_cos_q12 = q12_one
local mesh_sin_q12 = 0
local mesh_cos_q12 = q12_one
local post_sin_q12 = 0
local post_cos_q12 = q12_one

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

local rotate_q12<const> = function(sin_q12, cos_q12, step_sin_q12, step_cos_q12)
	return ((sin_q12 * step_cos_q12 + cos_q12 * step_sin_q12) >> 12),
		((cos_q12 * step_cos_q12 - sin_q12 * step_sin_q12) >> 12)
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

local build_texture<const> = function()
	local pixels<const>: *word = texture_addr
	local py = 0
	local wi = 0
	while py < texture_height do
		local px = 0
		while px < texture_width do
			local dx = px - 7
			if dx < 0 then
				dx = 0 - dx
			end
			local dy = py - 7
			if dy < 0 then
				dy = 0 - dy
			end
			local color = 0xff211031
			if ((px * 3 + py * 5) & 7) <= 1 then
				color = 0xff2de6ff
			end
			if ((px * 5 - py * 3) & 15) == 0 then
				color = 0xfffff2a6
			end
			local distance<const> = dx + dy
			if distance <= 8 then
				color = 0xff2a123c
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

local update_input<const> = function()
	*inp_ctrl_register = 0x00000001
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
	local translate_z = 470
	if key_down(key_digit2) then
		translate_z = 560
	end
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
	if key_down(key_digit1) then
		gpu_copy_vram(scene_vram_x, scene_vram_y, 0, 0, screen_width, screen_height)
		return
	end
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
	if key_down(key_q) then
		gpu_rect(224, 24, 304, 48, color_shadow)
	end
	if key_down(key_e) then
		gpu_rect(224, 52, 304, 76, color_shadow)
	end
end

local draw_scene<const> = function()
	draw_background()
	draw_affine_tunnel()
	draw_depth_sorted_gte_mesh()
	draw_sprite()
	gpu_triangle(108, 34, 126, 54, 92, 58, 0x70ffd166)
	gpu_quad(240, 178, 286, 188, 224, 218, 286, 228, 0x583cffd8)
end

local draw_frame<const> = function()
	gpu_drawing_window(scene_vram_x, scene_vram_y, scene_vram_x + screen_width - 1, scene_vram_y + screen_height - 1)
	gpu_drawing_offset(0, scene_vram_y)
	gpu_clear_rect(scene_vram_x, scene_vram_y, screen_width, screen_height, color_black)
	draw_scene()
	gpu_drawing_window(0, 0, screen_width - 1, screen_height - 1)
	gpu_drawing_offset(0, 0)
	gpu_copy_vram(scene_vram_x, scene_vram_y, 0, 0, screen_width, screen_height)
	draw_post_pass()
	draw_vector_overlay()
end

local advance_animation<const> = function()
	tunnel_sin_q12, tunnel_cos_q12 = rotate_q12(tunnel_sin_q12, tunnel_cos_q12, q12_rot_tunnel_sin, q12_rot_tunnel_cos)
	sprite_sin_q12, sprite_cos_q12 = rotate_q12(sprite_sin_q12, sprite_cos_q12, q12_rot_sprite_sin, q12_rot_sprite_cos)
	mesh_sin_q12, mesh_cos_q12 = rotate_q12(mesh_sin_q12, mesh_cos_q12, q12_rot_mesh_sin, q12_rot_mesh_cos)
	post_sin_q12, post_cos_q12 = rotate_q12(post_sin_q12, post_cos_q12, q12_rot_post_sin, q12_rot_post_cos)
end

*irq_mask_register = irq_vblank
gpu_reset_320x240_pal()
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
