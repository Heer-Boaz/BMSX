local romdir<const> = require('bios/romdir')

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
local atlas_ram_base<const> = sys_geo_scratch_base

local vdp_pkt_end<const> = 0x00000000
local vdp_pkt_cmd<const> = 0x01000000
local vdp_pkt_reg1<const> = 0x02000000
local vdp_pkt_regn<const> = 0x03000000
local vdp_pkt_billboard<const> = 0x11000000
local vdp_pkt_skybox<const> = 0x12000000
local vdp_pkt_xf<const> = 0x13000000
local vdp_pkt_mfu<const> = 0x14000000
local vdp_pkt_mesh<const> = 0x16000000
local vdp_pkt_lpu<const> = 0x17000000

local vdp_billboard_payload_words<const> = 11
local vdp_skybox_payload_words<const> = 31
local vdp_xf_matrix_payload_words<const> = 17
local vdp_xf_select_payload_words<const> = 3
local vdp_mfu_weights_payload_words<const> = 3
local vdp_lpu_ambient_payload_words<const> = 6
local vdp_lpu_directional_payload_words<const> = 9
local vdp_lpu_point_payload_words<const> = 10
local vdp_mesh_payload_words<const> = 10

local vdp_cmd_clear<const> = 1
local vdp_cmd_fill_rect<const> = 2
local vdp_cmd_blit<const> = 4
local vdp_reg_src_slot<const> = 0
local vdp_reg_src_uv<const> = 1
local vdp_reg_src_wh<const> = 2
local vdp_reg_dst_x<const> = 3
local vdp_reg_geom_x0<const> = 5
local vdp_reg_draw_layer<const> = 10
local vdp_reg_draw_color<const> = 15
local vdp_reg_bg_color<const> = 16
local vdp_reg_slot_index<const> = 17

local vdp_slot_primary<const> = 0
local vdp_layer_world<const> = 0
local vdp_sbx_control_enable<const> = 1
local vdp_lpu_control_enable<const> = 1
local vdp_lpu_ambient_register<const> = 0
local vdp_lpu_directional_register<const> = 5
local vdp_lpu_point_register<const> = 37
local vdp_mdu_material_mesh_default<const> = 0xffffffff
local draw_ctrl_parallax_half<const> = 0x00800000

local q16_one<const> = 0x00010000
local xf_matrix_words<const> = 16
local xf_view_matrix<const> = 0
local xf_proj_matrix<const> = 1
local xf_model_matrix<const> = 2
local xf_view_matrix_register<const> = xf_view_matrix * xf_matrix_words
local xf_proj_matrix_register<const> = xf_proj_matrix * xf_matrix_words
local xf_model_matrix_register<const> = xf_model_matrix * xf_matrix_words
local xf_select_register<const> = 128
local xf_proj_x<const> = 0x00016f32
local xf_proj_y<const> = 0x0001bb68
local xf_proj_z<const> = 0xfffefefa
local xf_proj_w<const> = 0xffff0000
local xf_proj_zw<const> = 0xffffccb3

local dma_ctrl_start<const> = 1
local irq_dma_done<const> = 0x01
local irq_dma_error<const> = 0x02
local irq_vblank<const> = 0x10

local atlas_width<const> = 16
local atlas_height<const> = 16
local atlas_bytes<const> = atlas_width * atlas_height * 4
local morph_mesh_record<const> = romdir.cart('animatedmorphsphere')


local setup_camera_input<const> = function()
	mem[sys_inp_player] = 1
	mem[sys_inp_action] = &'moveforward'
	mem[sys_inp_bind] = &'k:KeyW,g:x'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'movebackward'
	mem[sys_inp_bind] = &'k:KeyS,g:y'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'turnleft'
	mem[sys_inp_bind] = &'k:KeyA,g:left'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'turnright'
	mem[sys_inp_bind] = &'k:KeyD,g:right'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'panleft'
	mem[sys_inp_bind] = &'k:KeyQ,g:lb'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'panright'
	mem[sys_inp_bind] = &'k:KeyE,g:rb'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'panup'
	mem[sys_inp_bind] = &'k:KeyR,g:home'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'pandown'
	mem[sys_inp_bind] = &'k:KeyF,g:select'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'pitchup'
	mem[sys_inp_bind] = &'k:KeyT,g:up'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'pitchdown'
	mem[sys_inp_bind] = &'k:KeyG,g:down'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'rotateleft'
	mem[sys_inp_bind] = &'k:Digit1,g:lt'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'rotateright'
	mem[sys_inp_bind] = &'k:Digit3,g:rt'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'fire'
	mem[sys_inp_bind] = &'k:ShiftLeft,g:a'
	mem[sys_inp_ctrl] = inp_ctrl_commit
	mem[sys_inp_action] = &'mouselook'
	mem[sys_inp_bind] = &'k:pointer_delta'
	mem[sys_inp_ctrl] = inp_ctrl_commit
end

local frame = 0
local sprite_x = 112
local sprite_y = 92
local sprite_step<const> = 2
local sprite_direction = 1
local cam_x = 0.0
local cam_y = 0.2
local cam_z = 4.5
local cam_yaw = 0.0
local cam_pitch = 0.0

local submit_stream<const> = function(byte_length)
	mem[io_dma_src] = vdp_stream_base
	mem[io_dma_dst] = io_vdp_fifo
	mem[io_dma_len] = byte_length
	mem[io_dma_ctrl] = dma_ctrl_start
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

local update_camera<const> = function()
	mem[sys_inp_player] = 1
	local yaw_step = 0.035
	local pitch_step = 0.028
	mem[sys_inp_query] = &'fire[p]'
	if mem[sys_inp_status] ~= 0 then
		yaw_step = 0.055
		pitch_step = 0.045
	end
	mem[sys_inp_query] = &'mouselook[p]'
	if mem[sys_inp_status] ~= 0 then
		local mouse_x<const> = u32_to_i32(mem[sys_inp_value_x]) / q16_one
		local mouse_y<const> = u32_to_i32(mem[sys_inp_value_y]) / q16_one
		cam_yaw = cam_yaw - mouse_x * 0.0025
		cam_pitch = cam_pitch - mouse_y * 0.0025
	end
	mem[sys_inp_query] = &'turnleft[p]'
	if mem[sys_inp_status] ~= 0 then
		cam_yaw = cam_yaw + yaw_step
	end
	mem[sys_inp_query] = &'turnright[p]'
	if mem[sys_inp_status] ~= 0 then
		cam_yaw = cam_yaw - yaw_step
	end
	mem[sys_inp_query] = &'pitchup[p]'
	if mem[sys_inp_status] ~= 0 then
		cam_pitch = cam_pitch + pitch_step
	end
	mem[sys_inp_query] = &'pitchdown[p]'
	if mem[sys_inp_status] ~= 0 then
		cam_pitch = cam_pitch - pitch_step
	end
	if cam_pitch > 1.2 then
		cam_pitch = 1.2
	end
	if cam_pitch < -1.2 then
		cam_pitch = -1.2
	end

	local move = 0.075
	mem[sys_inp_query] = &'fire[p]'
	if mem[sys_inp_status] ~= 0 then
		move = 0.18
	end
	local sy<const> = math.sin(cam_yaw)
	local cy<const> = math.cos(cam_yaw)
	local sp<const> = math.sin(cam_pitch)
	local cp<const> = math.cos(cam_pitch)
	local fx<const> = sy * cp
	local fy<const> = sp
	local fz<const> = -cy * cp
	local rx<const> = cy
	local rz<const> = sy
	mem[sys_inp_query] = &'moveforward[p]'
	if mem[sys_inp_status] ~= 0 then
		cam_x = cam_x + fx * move
		cam_y = cam_y + fy * move
		cam_z = cam_z + fz * move
	end
	mem[sys_inp_query] = &'movebackward[p]'
	if mem[sys_inp_status] ~= 0 then
		cam_x = cam_x - fx * move
		cam_y = cam_y - fy * move
		cam_z = cam_z - fz * move
	end
	mem[sys_inp_query] = &'panup[p]'
	if mem[sys_inp_status] ~= 0 then
		cam_y = cam_y + move
	end
	mem[sys_inp_query] = &'pandown[p]'
	if mem[sys_inp_status] ~= 0 then
		cam_y = cam_y - move
	end
	mem[sys_inp_query] = &'panleft[p]'
	if mem[sys_inp_status] ~= 0 then
		cam_x = cam_x - rx * move
		cam_z = cam_z - rz * move
	end
	mem[sys_inp_query] = &'panright[p]'
	if mem[sys_inp_status] ~= 0 then
		cam_x = cam_x + rx * move
		cam_z = cam_z + rz * move
	end
end

local build_lua_atlas<const> = function()
	local sky_top<const> = 0xff071a3a
	local sky_mid<const> = 0xff124b7d
	local sky_low<const> = 0xff321a3c
	local star<const> = 0xfffff2a6
	local outline<const> = 0xff18121c
	local body<const> = 0xffe64824
	local light<const> = 0xffffdc62
	local core<const> = 0xff2de6ff
	local py = 0
	while py < atlas_height do
		local px = 0
		while px < atlas_width do
			local dx = px - 7
			if dx < 0 then
				dx = -dx
			end
			local dy = py - 7
			if dy < 0 then
				dy = -dy
			end
			local color = sky_top
			if py >= 5 then
				color = sky_mid
			end
			if py >= 11 then
				color = sky_low
			end
			if ((px * 3 + py * 5) & 15) == 0 then
				color = star
			end
			local distance<const> = dx + dy
			if distance <= 8 then
				color = outline
			end
			if distance <= 6 then
				color = body
			end
			if distance <= 3 and py <= 7 then
				color = light
			end
			if py >= 10 and dx <= 2 then
				color = core
			end
			mem[atlas_ram_base + ((py * atlas_width + px) * 4)] = color
			px = px + 1
		end
		py = py + 1
	end
end

local configure_primary_surface<const> = function()
	local wp = vdp_stream_base
	mem[wp], wp = vdp_pkt_regn | (2 << 16) | vdp_reg_slot_index, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4
	mem[wp], wp = (atlas_width & 0xffff) | (atlas_height << 16), wp + 4
	mem[wp], wp = vdp_pkt_end, wp + 4
	submit_stream(wp - vdp_stream_base)
	wait_dma()
end

local upload_atlas_to_vram<const> = function()
	mem[io_dma_src] = atlas_ram_base
	mem[io_dma_dst] = vram_primary_slot_base
	mem[io_dma_len] = atlas_bytes
	mem[io_dma_ctrl] = dma_ctrl_start
	wait_dma()
end

local draw_frame<const> = function()
	local wp = vdp_stream_base
	local sy<const> = math.sin(cam_yaw)
	local cy<const> = math.cos(cam_yaw)
	local sp<const> = math.sin(cam_pitch)
	local cp<const> = math.cos(cam_pitch)
	local fx<const> = sy * cp
	local fy<const> = sp
	local fz<const> = -cy * cp
	local rx<const> = cy
	local ry<const> = 0.0
	local rz<const> = sy
	local ux<const> = -sy * sp
	local uy<const> = cp
	local uz<const> = cy * sp
	local tx<const> = -(rx * cam_x + ry * cam_y + rz * cam_z)
	local ty<const> = -(ux * cam_x + uy * cam_y + uz * cam_z)
	local tz<const> = fx * cam_x + fy * cam_y + fz * cam_z
	local model_yaw<const> = frame * 0.025
	local model_pitch<const> = frame * 0.014
	local mc<const> = math.cos(model_yaw)
	local ms<const> = math.sin(model_yaw)
	local pc<const> = math.cos(model_pitch)
	local ps<const> = math.sin(model_pitch)
	local model_scale<const> = 0x00300000
	local model_00<const> = ((mc * model_scale) // 1) & 0xffffffff
	local model_01<const> = ((ms * ps * model_scale) // 1) & 0xffffffff
	local model_02<const> = ((ms * pc * model_scale) // 1) & 0xffffffff
	local model_10<const> = 0
	local model_11<const> = ((pc * model_scale) // 1) & 0xffffffff
	local model_12<const> = ((-ps * model_scale) // 1) & 0xffffffff
	local model_20<const> = ((-ms * model_scale) // 1) & 0xffffffff
	local model_21<const> = ((mc * ps * model_scale) // 1) & 0xffffffff
	local model_22<const> = ((mc * pc * model_scale) // 1) & 0xffffffff
	local morph_weight_a<const> = (((math.sin(frame * 0.08) + 1.0) * 0x8000) // 1) & 0xffffffff
	local morph_weight_b<const> = (((math.sin(frame * 0.11 + 1.7) + 1.0) * 0x6000) // 1) & 0xffffffff
	local point_x<const> = ((math.sin(frame * 0.04) * 0x00020000) // 1) & 0xffffffff
	local point_z<const> = ((-2.5 * q16_one + math.cos(frame * 0.04) * 0x00010000) // 1) & 0xffffffff

	mem[wp], wp = vdp_pkt_xf | (vdp_xf_matrix_payload_words << 16), wp + 4
	mem[wp], wp = xf_view_matrix_register, wp + 4
	mem[wp], wp = ((rx * q16_one) // 1) & 0xffffffff, wp + 4
	mem[wp], wp = ((ux * q16_one) // 1) & 0xffffffff, wp + 4
	mem[wp], wp = ((-fx * q16_one) // 1) & 0xffffffff, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = ((ry * q16_one) // 1) & 0xffffffff, wp + 4
	mem[wp], wp = ((uy * q16_one) // 1) & 0xffffffff, wp + 4
	mem[wp], wp = ((-fy * q16_one) // 1) & 0xffffffff, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = ((rz * q16_one) // 1) & 0xffffffff, wp + 4
	mem[wp], wp = ((uz * q16_one) // 1) & 0xffffffff, wp + 4
	mem[wp], wp = ((-fz * q16_one) // 1) & 0xffffffff, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = ((tx * q16_one) // 1) & 0xffffffff, wp + 4
	mem[wp], wp = ((ty * q16_one) // 1) & 0xffffffff, wp + 4
	mem[wp], wp = ((tz * q16_one) // 1) & 0xffffffff, wp + 4
	mem[wp], wp = q16_one, wp + 4

	mem[wp], wp = vdp_pkt_xf | (vdp_xf_matrix_payload_words << 16), wp + 4
	mem[wp], wp = xf_proj_matrix_register, wp + 4
	mem[wp], wp = xf_proj_x, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = xf_proj_y, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = xf_proj_z, wp + 4
	mem[wp], wp = xf_proj_w, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = xf_proj_zw, wp + 4
	mem[wp], wp = 0, wp + 4

	mem[wp], wp = vdp_pkt_xf | (vdp_xf_matrix_payload_words << 16), wp + 4
	mem[wp], wp = xf_model_matrix_register, wp + 4
	mem[wp], wp = model_00, wp + 4
	mem[wp], wp = model_01, wp + 4
	mem[wp], wp = model_02, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = model_10, wp + 4
	mem[wp], wp = model_11, wp + 4
	mem[wp], wp = model_12, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = model_20, wp + 4
	mem[wp], wp = model_21, wp + 4
	mem[wp], wp = model_22, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = q16_one, wp + 4

	mem[wp], wp = vdp_pkt_xf | (vdp_xf_select_payload_words << 16), wp + 4
	mem[wp], wp = xf_select_register, wp + 4
	mem[wp], wp = xf_view_matrix, wp + 4
	mem[wp], wp = xf_proj_matrix, wp + 4

	mem[wp], wp = vdp_pkt_lpu | (vdp_lpu_ambient_payload_words << 16), wp + 4
	mem[wp], wp = vdp_lpu_ambient_register, wp + 4
	mem[wp], wp = vdp_lpu_control_enable, wp + 4
	mem[wp], wp = 0x00003800, wp + 4
	mem[wp], wp = 0x00004300, wp + 4
	mem[wp], wp = 0x00005700, wp + 4
	mem[wp], wp = 0x00004000, wp + 4
	mem[wp], wp = vdp_pkt_lpu | (vdp_lpu_directional_payload_words << 16), wp + 4
	mem[wp], wp = vdp_lpu_directional_register, wp + 4
	mem[wp], wp = vdp_lpu_control_enable, wp + 4
	mem[wp], wp = 0xffff8ccd, wp + 4
	mem[wp], wp = 0xffff2e14, wp + 4
	mem[wp], wp = 0xffffa667, wp + 4
	mem[wp], wp = q16_one, wp + 4
	mem[wp], wp = 0x0000eb85, wp + 4
	mem[wp], wp = 0x0000c7ae, wp + 4
	mem[wp], wp = 0x00014000, wp + 4
	mem[wp], wp = vdp_pkt_lpu | (vdp_lpu_point_payload_words << 16), wp + 4
	mem[wp], wp = vdp_lpu_point_register, wp + 4
	mem[wp], wp = vdp_lpu_control_enable, wp + 4
	mem[wp], wp = point_x, wp + 4
	mem[wp], wp = 0x00018000, wp + 4
	mem[wp], wp = point_z, wp + 4
	mem[wp], wp = 0x00050000, wp + 4
	mem[wp], wp = 0x00008000, wp + 4
	mem[wp], wp = 0x0000d000, wp + 4
	mem[wp], wp = q16_one, wp + 4
	mem[wp], wp = 0x00010000, wp + 4

	mem[wp], wp = vdp_pkt_skybox | (vdp_skybox_payload_words << 16), wp + 4
	mem[wp], wp = vdp_sbx_control_enable, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = atlas_width, wp + 4
	mem[wp], wp = atlas_height, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4
	mem[wp], wp = 4, wp + 4
	mem[wp], wp = 4, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4

	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_bg_color, wp + 4
	mem[wp], wp = 0x0005080d, wp + 4
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_clear, wp + 4
	mem[wp], wp = vdp_pkt_regn | (4 << 16) | vdp_reg_geom_x0, wp + 4
	mem[wp], wp = 0 << 16, wp + 4
	mem[wp], wp = 132 << 16, wp + 4
	mem[wp], wp = 256 << 16, wp + 4
	mem[wp], wp = 212 << 16, wp + 4
	mem[wp], wp = vdp_pkt_regn | (2 << 16) | vdp_reg_draw_layer, wp + 4
	mem[wp], wp = vdp_layer_world, wp + 4
	mem[wp], wp = 10, wp + 4
	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_color, wp + 4
	mem[wp], wp = 0x70101824, wp + 4
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_fill_rect, wp + 4

	local line_y = 136 + ((frame * 2) % 24)
	while line_y < 212 do
		local half_width<const> = 4 + ((line_y - 132) // 5)
		mem[wp], wp = vdp_pkt_regn | (4 << 16) | vdp_reg_geom_x0, wp + 4
		mem[wp], wp = (128 - half_width) << 16, wp + 4
		mem[wp], wp = line_y << 16, wp + 4
		mem[wp], wp = (128 + half_width) << 16, wp + 4
		mem[wp], wp = (line_y + 2) << 16, wp + 4
		mem[wp], wp = vdp_pkt_regn | (2 << 16) | vdp_reg_draw_layer, wp + 4
		mem[wp], wp = vdp_layer_world, wp + 4
		mem[wp], wp = 18, wp + 4
		mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_color, wp + 4
		mem[wp], wp = 0xffd1c794, wp + 4
		mem[wp], wp = vdp_pkt_cmd | vdp_cmd_fill_rect, wp + 4
		line_y = line_y + 28
	end

	mem[wp], wp = vdp_pkt_regn | (3 << 16) | vdp_reg_src_slot, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = (atlas_width & 0xffff) | (atlas_height << 16), wp + 4
	mem[wp], wp = vdp_pkt_regn | (6 << 16) | vdp_reg_draw_layer, wp + 4
	mem[wp], wp = vdp_layer_world, wp + 4
	mem[wp], wp = 80, wp + 4
	mem[wp], wp = draw_ctrl_parallax_half, wp + 4
	mem[wp], wp = 0x00030000, wp + 4
	mem[wp], wp = 0x00030000, wp + 4
	mem[wp], wp = 0xffffffff, wp + 4
	mem[wp], wp = vdp_pkt_regn | (2 << 16) | vdp_reg_dst_x, wp + 4
	mem[wp], wp = sprite_x << 16, wp + 4
	mem[wp], wp = sprite_y << 16, wp + 4
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_blit, wp + 4

	local billboard_shift<const> = ((frame % 64) - 32) * 1024
	mem[wp], wp = vdp_pkt_billboard | (vdp_billboard_payload_words << 16), wp + 4
	mem[wp], wp = vdp_layer_world, wp + 4
	mem[wp], wp = 32, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = (atlas_width & 0xffff) | (atlas_height << 16), wp + 4
	mem[wp], wp = 0xffff0000 + billboard_shift, wp + 4
	mem[wp], wp = 0x00006000, wp + 4
	mem[wp], wp = 0xfffc0000, wp + 4
	mem[wp], wp = 0x0000c000, wp + 4
	mem[wp], wp = 0xffffd060, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = vdp_pkt_billboard | (vdp_billboard_payload_words << 16), wp + 4
	mem[wp], wp = vdp_layer_world, wp + 4
	mem[wp], wp = 36, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = (atlas_width & 0xffff) | (atlas_height << 16), wp + 4
	mem[wp], wp = 0x00010000 - billboard_shift, wp + 4
	mem[wp], wp = 0xffffe000, wp + 4
	mem[wp], wp = 0xfffc8000, wp + 4
	mem[wp], wp = 0x0000a000, wp + 4
	mem[wp], wp = 0xff60e6ff, wp + 4
	mem[wp], wp = 0, wp + 4

	mem[wp], wp = vdp_pkt_mfu | (vdp_mfu_weights_payload_words << 16), wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = morph_weight_a, wp + 4
	mem[wp], wp = morph_weight_b, wp + 4
	mem[wp], wp = vdp_pkt_mesh | (vdp_mesh_payload_words << 16), wp + 4
	mem[wp], wp = morph_mesh_record.token_lo, wp + 4
	mem[wp], wp = morph_mesh_record.token_hi, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = vdp_mdu_material_mesh_default, wp + 4
	mem[wp], wp = xf_model_matrix, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0xfff5f8ff, wp + 4
	mem[wp], wp = 2 << 16, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4

	mem[wp], wp = vdp_pkt_end, wp + 4
	submit_stream(wp - vdp_stream_base)
	wait_dma()
end

mem[io_vdp_dither] = 0
mem[sys_vdp_pmu_bank] = 0
mem[sys_vdp_pmu_x] = 0
mem[sys_vdp_pmu_y] = 16 << 16
mem[sys_vdp_pmu_scale_x] = q16_one
mem[sys_vdp_pmu_scale_y] = q16_one
mem[sys_vdp_pmu_ctrl] = 0
build_lua_atlas()
configure_primary_surface()
upload_atlas_to_vram()
setup_camera_input()
mem[sys_inp_ctrl] = inp_ctrl_arm

while true do
	wait_vblank()
	update_camera()
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
	mem[sys_inp_ctrl] = inp_ctrl_arm
end
