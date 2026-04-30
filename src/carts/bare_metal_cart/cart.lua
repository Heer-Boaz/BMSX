local io_vdp_dither<const> = 0x0800000c
local io_irq_flags<const> = 0x08000084
local io_irq_ack<const> = 0x08000088
local io_dma_src<const> = 0x0800008c
local io_dma_dst<const> = 0x08000090
local io_dma_len<const> = 0x08000094
local io_dma_ctrl<const> = 0x08000098

local vdp_stream_base<const> = 0x0a4c0000
local vram_primary_slot_base<const> = 0x0b8d0000
local atlas_ram_base<const> = 0x0a440000
local io_vdp_fifo<const> = 0x0800007c

local vdp_pkt_end<const> = 0x00000000
local vdp_pkt_cmd<const> = 0x01000000
local vdp_pkt_reg1<const> = 0x02000000
local vdp_pkt_regn<const> = 0x03000000

local vdp_cmd_clear<const> = 1
local vdp_cmd_fill_rect<const> = 2
local vdp_cmd_blit<const> = 4

local vdp_reg_src_slot<const> = 0
local vdp_reg_src_uv<const> = 1
local vdp_reg_src_wh<const> = 2
local vdp_reg_dst_x<const> = 3
local vdp_reg_geom_x0<const> = 5
local vdp_reg_draw_layer_prio<const> = 10
local vdp_reg_draw_color<const> = 14
local vdp_reg_bg_color<const> = 15
local vdp_reg_slot_index<const> = 16
local vdp_slot_primary<const> = 0
local vdp_layer_world<const> = 0

local dma_ctrl_start<const> = 1
local irq_dma_done<const> = 0x01
local irq_dma_error<const> = 0x02
local irq_vblank<const> = 0x10

local atlas_width<const> = 16
local atlas_height<const> = 16
local atlas_bytes<const> = atlas_width * atlas_height * 4

local frame = 0
local sprite_x = 112
local sprite_y = 92
local sprite_step<const> = 2
local sprite_direction = 1

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

local build_lua_atlas<const> = function()
	local transparent<const> = 0x00000000
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

			local color = transparent
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

	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_bg_color, wp + 4
	mem[wp], wp = 0xff05080d, wp + 4
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_clear, wp + 4

	mem[wp], wp = vdp_pkt_regn | (4 << 16) | vdp_reg_geom_x0, wp + 4
	mem[wp], wp = 0 << 16, wp + 4
	mem[wp], wp = 82 << 16, wp + 4
	mem[wp], wp = 256 << 16, wp + 4
	mem[wp], wp = 126 << 16, wp + 4
	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_layer_prio, wp + 4
	mem[wp], wp = (vdp_layer_world & 0xff) | (8 << 8), wp + 4
	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_color, wp + 4
	mem[wp], wp = 0xff142438, wp + 4
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_fill_rect, wp + 4

	mem[wp], wp = vdp_pkt_regn | (4 << 16) | vdp_reg_geom_x0, wp + 4
	mem[wp], wp = 0 << 16, wp + 4
	mem[wp], wp = 126 << 16, wp + 4
	mem[wp], wp = 256 << 16, wp + 4
	mem[wp], wp = 212 << 16, wp + 4
	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_layer_prio, wp + 4
	mem[wp], wp = (vdp_layer_world & 0xff) | (10 << 8), wp + 4
	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_color, wp + 4
	mem[wp], wp = 0xff0d1417, wp + 4
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_fill_rect, wp + 4

	mem[wp], wp = vdp_pkt_regn | (4 << 16) | vdp_reg_geom_x0, wp + 4
	mem[wp], wp = 58 << 16, wp + 4
	mem[wp], wp = 126 << 16, wp + 4
	mem[wp], wp = 198 << 16, wp + 4
	mem[wp], wp = 212 << 16, wp + 4
	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_layer_prio, wp + 4
	mem[wp], wp = (vdp_layer_world & 0xff) | (15 << 8), wp + 4
	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_color, wp + 4
	mem[wp], wp = 0xff29333b, wp + 4
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_fill_rect, wp + 4

	local line_y = 132 + ((frame * 2) % 28)
	while line_y < 212 do
		local half_width<const> = 4 + ((line_y - 126) // 6)
		mem[wp], wp = vdp_pkt_regn | (4 << 16) | vdp_reg_geom_x0, wp + 4
		mem[wp], wp = (128 - half_width) << 16, wp + 4
		mem[wp], wp = line_y << 16, wp + 4
		mem[wp], wp = (128 + half_width) << 16, wp + 4
		mem[wp], wp = (line_y + 2) << 16, wp + 4
		mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_layer_prio, wp + 4
		mem[wp], wp = (vdp_layer_world & 0xff) | (18 << 8), wp + 4
		mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_color, wp + 4
		mem[wp], wp = 0xffd1c794, wp + 4
		mem[wp], wp = vdp_pkt_cmd | vdp_cmd_fill_rect, wp + 4
		line_y = line_y + 28
	end

	mem[wp], wp = vdp_pkt_regn | (3 << 16) | vdp_reg_src_slot, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = (atlas_width & 0xffff) | (atlas_height << 16), wp + 4

	mem[wp], wp = vdp_pkt_regn | (5 << 16) | vdp_reg_draw_layer_prio, wp + 4
	mem[wp], wp = (vdp_layer_world & 0xff) | (80 << 8), wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0x00030000, wp + 4
	mem[wp], wp = 0x00030000, wp + 4
	mem[wp], wp = 0xffffffff, wp + 4

	mem[wp], wp = vdp_pkt_regn | (2 << 16) | vdp_reg_dst_x, wp + 4
	mem[wp], wp = sprite_x << 16, wp + 4
	mem[wp], wp = sprite_y << 16, wp + 4
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_blit, wp + 4

	mem[wp], wp = vdp_pkt_end, wp + 4
	submit_stream(wp - vdp_stream_base)
	wait_dma()
end

mem[io_vdp_dither] = 0
build_lua_atlas()
configure_primary_surface()
upload_atlas_to_vram()

while true do
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
	wait_vblank()
end
