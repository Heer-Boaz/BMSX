local gx_gpu<const>        = require('system/gx_gpu')
local gx_gte<const>        = require('system/gx_gte')
local sincos_turn32<const> = require('bios/util/sincos_turn32')

local irq_mask_register<const>: *word = 0x0800010c
local irq_ack_register<const>: *word = 0x08000108
local inp_keys<const>: *word[8] = 0x0800019c
local inp_ctrl_register<const>: *word = 0x08000194

local irq_vblank<const> = 0x10
local irq_pending_flags = 0

function irq(flags)
	irq_pending_flags = irq_pending_flags | flags
	*irq_ack_register = flags
end

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
local q16_inv_scale<const> = 1.0 / 65536.0
local texture_addr<const> = 0x08040000
local texture_width<const> = 16
local texture_height<const> = 16
local texture_vram_x<const> = 512
local texture_vram_y<const> = 256
local texture_u0<const> = texture_vram_x
local texture_v0<const> = texture_vram_y
local texture_u1<const> = texture_vram_x + texture_width
local texture_v1<const> = texture_vram_y + texture_height

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

local frame = 0
local sprite_x = 136
local sprite_y = 96
local sprite_step<const> = 4

local wait_vblank<const> = function()
	while (irq_pending_flags & irq_vblank) == 0 do
		halt_until_irq
	end
	irq_pending_flags = irq_pending_flags - (irq_pending_flags & irq_vblank)
end

local key_down<const> = function(key)
	return (inp_keys[key >> 5] & (1 << (key & 31))) ~= 0
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

local upload_texture<const> = function()
	gx_gpu.upload_rgba8888_to_direct16_stride(
		texture_addr, 0, 0, texture_width,
		texture_vram_x, texture_vram_y,
		texture_width, texture_height)
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
	gx_gpu.draw_gouraud_triangle_color(
		0, 0, color_sky_top,
		screen_width, 0, color_sky_top,
		0, 146, color_sky_mid)
	gx_gpu.draw_gouraud_triangle_color(
		screen_width, 0, color_sky_top,
		screen_width, 146, color_sky_mid,
		0, 146, color_sky_mid)
	gx_gpu.draw_gouraud_triangle_color(
		0, 146, color_sky_mid,
		screen_width, 146, color_sky_mid,
		0, screen_height, color_ground)
	gx_gpu.draw_gouraud_triangle_color(
		screen_width, 146, color_sky_mid,
		screen_width, screen_height, color_ground,
		0, screen_height, color_ground)
	local y = 160
	while y < screen_height do
		gx_gpu.draw_line_color(0, y, screen_width, y + ((y - 160) >> 2), color_grid)
		y = y + 12
	end
	local x = 16
	while x < screen_width do
		gx_gpu.draw_line_color(x, 156, 160 + ((x - 160) * 3), screen_height, color_grid)
		x = x + 32
	end
end

local draw_tunnel_quad<const> = function(center_x, center_y, radius_x, radius_y, turn, color)
	local sin_q16<const>, cos_q16<const> = sincos_turn32(turn & 0xffffffff)
	local s<const> = sin_q16 * q16_inv_scale
	local c<const> = cos_q16 * q16_inv_scale
	local axis_xx<const> = c * radius_x
	local axis_xy<const> = s * radius_x
	local axis_yx<const> = (0.0 - s) * radius_y
	local axis_yy<const> = c * radius_y
	local x0<const> = center_x - axis_xx - axis_yx
	local y0<const> = center_y - axis_xy - axis_yy
	local x1<const> = center_x + axis_xx - axis_yx
	local y1<const> = center_y + axis_xy - axis_yy
	local x2<const> = center_x - axis_xx + axis_yx
	local y2<const> = center_y - axis_xy + axis_yy
	local x3<const> = center_x + axis_xx + axis_yx
	local y3<const> = center_y + axis_xy + axis_yy
	gx_gpu.draw_direct16_textured_quad_color(
		texture_vram_x, texture_vram_y,
		texture_u0, texture_v0,
		texture_u1, texture_v0,
		texture_u0, texture_v1,
		texture_u1, texture_v1,
		x0, y0,
		x1, y1,
		x2, y2,
		x3, y3,
		color)
end

local draw_affine_tunnel<const> = function()
	local tunnel_index = 0
	while tunnel_index < 12 do
		local depth<const> = 12 - tunnel_index
		local radius_x<const> = 18 + depth * 9
		local radius_y<const> = 12 + depth * 5
		local y<const> = 76 + tunnel_index * 4
		local turn<const> = frame * 71582788 + tunnel_index * 268435456
		local color = color_tunnel_a
		if (tunnel_index & 3) == 1 then
			color = color_tunnel_b
		end
		if (tunnel_index & 3) == 2 then
			color = color_tunnel_c
		end
		draw_tunnel_quad(160, y, radius_x, radius_y, turn, color)
		tunnel_index = tunnel_index + 1
	end
end

local draw_sprite<const> = function()
	local turn<const> = frame * 143165576
	draw_tunnel_quad(sprite_x, sprite_y, 24, 24, turn, color_sprite)
	gx_gpu.draw_line_color(sprite_x - 30, sprite_y, sprite_x + 30, sprite_y, color_grid_hot)
	gx_gpu.draw_line_color(sprite_x, sprite_y - 30, sprite_x, sprite_y + 30, color_grid_hot)
end

local draw_face<const> = function(x0, y0, z0, x1, y1, z1, x2, y2, z2, color0, color1, color2)
	local sx0<const>, sy0<const>, sz0<const>,
		sx1<const>, sy1<const>, sz1<const>,
		sx2<const>, sy2<const>, sz2<const> = gx_gte.rtpt(x0, y0, z0, x1, y1, z1, x2, y2, z2)
	local shade0<const> = sz0 > sz1 and color0 or color1
	local shade1<const> = sz1 > sz2 and color1 or color2
	local shade2<const> = sz2 > sz0 and color2 or color0
	gx_gpu.draw_gouraud_triangle_color(sx0, sy0, shade0, sx1, sy1, shade1, sx2, sy2, shade2)
end

local draw_gte_shard<const> = function()
	local sin_q16<const>, cos_q16<const> = sincos_turn32((frame * 59652323) & 0xffffffff)
	local sin_q12<const> = sin_q16 >> 4
	local cos_q12<const> = cos_q16 >> 4
	local translate_z = 430
	if key_down(key_digit2) then
		translate_z = 540
	end
	gx_gte.set_y_rotation_translation(sin_q12, cos_q12, 0, -10, translate_z)
	gx_gte.set_screen_offset(160, 106)
	gx_gte.set_projection_h(256)
	draw_face(0, -72, 0, -78, 58, 76, 78, 58, 76, color_shard_a, color_shard_b, color_shard_c)
	draw_face(0, -72, 0, 78, 58, 76, 0, 58, -86, color_shard_a, color_shard_c, color_shard_d)
	draw_face(0, -72, 0, 0, 58, -86, -78, 58, 76, color_shard_a, color_shard_d, color_shard_b)
	draw_face(-78, 58, 76, 0, 58, -86, 78, 58, 76, color_shard_b, color_shard_d, color_shard_c)
end

local draw_second_gte_shard<const> = function()
	local sin_q16<const>, cos_q16<const> = sincos_turn32(((0 - frame) * 89478485) & 0xffffffff)
	local sin_q12<const> = sin_q16 >> 4
	local cos_q12<const> = cos_q16 >> 4
	gx_gte.set_y_rotation_translation(sin_q12, cos_q12, -92, 18, 520)
	gx_gte.set_screen_offset(160, 112)
	gx_gte.set_projection_h(220)
	draw_face(0, -42, 0, -50, 34, 52, 50, 34, 52, color_shard_c, color_shard_d, color_shard_a)
	draw_face(0, -42, 0, 50, 34, 52, 0, 34, -60, color_shard_c, color_shard_a, color_shard_b)
	draw_face(0, -42, 0, 0, 34, -60, -50, 34, 52, color_shard_c, color_shard_b, color_shard_d)
	draw_face(-50, 34, 52, 0, 34, -60, 50, 34, 52, color_shard_d, color_shard_b, color_shard_a)
end

local draw_vector_overlay<const> = function()
	local phase<const> = frame % 160
	gx_gpu.draw_line_color(22, 204, 298, 204, color_grid_hot)
	gx_gpu.draw_line_color(22, 214, 298, 214, color_grid)
	gx_gpu.draw_line_color(22 + phase, 198, 22 + phase, 220, color_grid_hot)
	gx_gpu.draw_line_color(26, 28, 82, 28, color_grid_hot)
	gx_gpu.draw_line_color(26, 28, 26, 66, color_grid_hot)
	gx_gpu.draw_line_color(82, 28, 82, 66, color_grid)
	gx_gpu.draw_line_color(26, 66, 82, 66, color_grid)
	if key_down(key_q) then
		gx_gpu.fill_rect_semitrans_color(224, 24, 304, 48, color_shadow)
	end
	if key_down(key_e) then
		gx_gpu.fill_rect_semitrans_color(224, 52, 304, 76, color_shadow)
	end
end

local draw_frame<const> = function()
	gx_gpu.clear_color(color_black)
	draw_background()
	draw_affine_tunnel()
	draw_gte_shard()
	draw_second_gte_shard()
	draw_sprite()
	draw_vector_overlay()
end

*irq_mask_register = irq_vblank
gx_gpu.reset_320x240_pal()
build_texture()
upload_texture()
wait_vblank()

while true do
	wait_vblank()
	update_input()
	draw_frame()
	frame = frame + 1
end
