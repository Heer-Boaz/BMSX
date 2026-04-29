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

local vdp_cmd_clear<const> = 0x10
local vdp_cmd_fill_rect<const> = 0x11
local vdp_cmd_blit<const> = 0x12
local vdp_cmd_config_surface<const> = 0x16
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

local emit_clear<const> = function(cursor, r, g, b, a)
	memwrite(cursor, vdp_cmd_clear, 4, 0, r, g, b, a)
	return cursor + 28
end

local emit_rect<const> = function(cursor, x0, y0, x1, y1, z, r, g, b, a)
	memwrite(cursor, vdp_cmd_fill_rect, 10, 0, x0, y0, x1, y1, z, vdp_layer_world, r, g, b, a)
	return cursor + 52
end

local emit_config_surface<const> = function(cursor, slot, width, height)
	memwrite(cursor, vdp_cmd_config_surface, 3, 0, slot, width, height)
	return cursor + 24
end

local emit_blit<const> = function(cursor, slot, u, v, w, h, x, y, z, scale)
	memwrite(
		cursor,
		vdp_cmd_blit,
		17,
		0,
		slot,
		u,
		v,
		w,
		h,
		x,
		y,
		z,
		vdp_layer_world,
		scale,
		scale,
		0,
		1.0,
		1.0,
		1.0,
		1.0,
		0.0
	)
	return cursor + 80
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
	local config_cursor = vdp_stream_base
	config_cursor = emit_config_surface(config_cursor, vdp_slot_primary, atlas_width, atlas_height)
	submit_stream(config_cursor - vdp_stream_base)
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
	local draw_cursor = vdp_stream_base
	draw_cursor = emit_clear(draw_cursor, 0.02, 0.03, 0.05, 1.0)
	draw_cursor = emit_rect(draw_cursor, 0, 82, 256, 126, 8, 0.08, 0.14, 0.22, 1.0)
	draw_cursor = emit_rect(draw_cursor, 0, 126, 256, 212, 10, 0.05, 0.08, 0.09, 1.0)
	draw_cursor = emit_rect(draw_cursor, 58, 126, 198, 212, 15, 0.16, 0.20, 0.23, 1.0)

	local line_y = 132 + ((frame * 2) % 28)
	while line_y < 212 do
		local half_width<const> = 4 + ((line_y - 126) // 6)
		draw_cursor = emit_rect(draw_cursor, 128 - half_width, line_y, 128 + half_width, line_y + 2, 18, 0.82, 0.78, 0.58, 1.0)
		line_y = line_y + 28
	end

	draw_cursor = emit_blit(draw_cursor, vdp_slot_primary, 0, 0, atlas_width, atlas_height, sprite_x, sprite_y, 80, 3.0)
	submit_stream(draw_cursor - vdp_stream_base)
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
