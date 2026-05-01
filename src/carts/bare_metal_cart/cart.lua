local io_vdp_dither<const> = 0x0800000c -- VDP dithering control
local io_irq_flags<const> = 0x08000084 -- IRQ flags: bit 0 = DMA done, bit 1 = DMA error, bit 4 = VBlank
local io_irq_ack<const> = 0x08000088 -- IRQ acknowledge: write 1 to bits to acknowledge corresponding IRQs
local io_dma_src<const> = 0x0800008c -- DMA source address
local io_dma_dst<const> = 0x08000090 -- DMA destination address
local io_dma_len<const> = 0x08000094 -- DMA length in bytes
local io_dma_ctrl<const> = 0x08000098 -- DMA control: write 1 to bit 0 to start DMA

local vdp_stream_base<const> = 0x0a4c0000 -- Base address for building VDP command streams in RAM before submitting via DMA
local vram_primary_slot_base<const> = 0x0b8d0000 -- Base VRAM address for the primary surface slot (slot 0)
local atlas_ram_base<const> = 0x0a440000 -- Base RAM address for building the sprite atlas before uploading to VRAM
local io_vdp_fifo<const> = 0x0800007c -- VDP FIFO: write 32-bit command words here to send to VDP immediately (bypassing DMA)

local vdp_pkt_end<const> = 0x00000000 -- End of packet stream
local vdp_pkt_cmd<const> = 0x01000000 -- Command packet: lower 16 bits = command ID, upper 8 bits = number of additional data words
local vdp_pkt_reg1<const> = 0x02000000 -- Register packet: lower 16 bits = register index, upper 8 bits = number of additional data words
local vdp_pkt_regn<const> = 0x03000000 -- Register packet with N registers: lower 16 bits = starting register index, upper 8 bits = number of registers to set (data words must be in register order)

local vdp_cmd_clear<const> = 1 -- Clear command: clears a rectangle to the current background color, parameters are in registers (see draw_frame function below)
local vdp_cmd_fill_rect<const> = 2 -- Fill rectangle command: fills a rectangle with the current draw color, parameters are in registers (see draw_frame function below)
local vdp_cmd_blit<const> = 4 -- Blit command: draws a sprite from a source slot to the destination coordinates, parameters are in registers (see draw_frame function below)

local vdp_reg_src_slot<const> = 0 -- Source slot register index (used for blit commands to specify which VRAM slot to use as the source)
local vdp_reg_src_uv<const> = 1 -- Source UV register index (used for blit commands to specify the top-left UV coordinates within the source slot)
local vdp_reg_src_wh<const> = 2 -- Source width/height register index (used for blit commands to specify the width and height of the sprite to draw from the source slot)
local vdp_reg_dst_x<const> = 3 -- Destination X coordinate register index (used for blit commands to specify the X coordinate on the screen to draw the sprite)
local vdp_reg_geom_x0<const> = 5 -- Geometry X0 register index (used for clear and fill_rect commands to specify the left edge of the rectangle)
local vdp_reg_draw_layer_prio<const> = 10 -- Draw layer and priority register index (used for all draw commands to specify which layer to draw on and the priority of the draw call)
local vdp_reg_draw_color<const> = 14 -- Draw color register index (used for fill_rect commands to specify the color to fill with, and for blit commands to specify modulation color)
local vdp_reg_bg_color<const> = 15 -- Background color register index (used for clear commands to specify the color to clear with)
local vdp_reg_slot_index<const> = 16 -- Slot index register (used for register packets to specify which VRAM slot to configure)
local vdp_slot_primary<const> = 0 -- Primary surface slot index (the main VRAM slot used for drawing sprites and backgrounds)
local vdp_layer_world<const> = 0 -- World layer index (the main layer used for drawing the game world, sprites should be drawn on this layer for correct priority handling)

local dma_ctrl_start<const> = 1 -- Control value to start a DMA transfer when written to the io_dma_ctrl register
local irq_dma_done<const> = 0x01 -- IRQ flag bit for DMA transfer completion
local irq_dma_error<const> = 0x02 -- IRQ flag bit for DMA transfer error
local irq_vblank<const> = 0x10 -- IRQ flag bit for VBlank start

local atlas_width<const> = 16 -- Width of the sprite atlas in pixels
local atlas_height<const> = 16 -- Height of the sprite atlas in pixels
local atlas_bytes<const> = atlas_width * atlas_height * 4 -- Total size of the sprite atlas in bytes (4 bytes per pixel for RGBA)

local frame = 0 -- Frame counter used for animating the sprite and background
local sprite_x = 112 -- Initial X coordinate of the sprite
local sprite_y = 92 -- Initial Y coordinate of the sprite
local sprite_step<const> = 2 -- Number of pixels the sprite moves horizontally each frame
local sprite_direction = 1 -- Initial horizontal movement direction of the sprite (1 = right, -1 = left)

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
	local transparent<const> = 0x00000000 -- Fully transparent pixel (used for the background of the sprite atlas)
	local outline<const> = 0xff18121c -- Dark outline color (used for the outer edge of the sprite)
	local body<const> = 0xffe64824 -- Main body color (used for the inner area of the sprite)
	local light<const> = 0xffffdc62 -- Highlight color (used for the top area of the sprite to give a sense of lighting)
	local core<const> = 0xff2de6ff -- Core color (used for the center of the sprite to give a sense of depth and focus)

	local py = 0 -- Y coordinate for iterating over the pixels of the atlas
	while py < atlas_height do -- Iterate over each pixel row of the atlas
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

local configure_primary_surface<const> = function() -- Configure the primary surface slot in VRAM with the dimensions of the sprite atlas so we can blit from it later. This is done by building a short command stream in RAM and submitting it via DMA.
	local wp = vdp_stream_base -- Write pointer for building the command stream in RAM
	mem[wp], wp = vdp_pkt_regn | (2 << 16) | vdp_reg_slot_index, wp + 4 -- Packet to set multiple registers starting at the slot index register
	mem[wp], wp = vdp_slot_primary, wp + 4 -- Set the slot index to the primary slot (slot 0)
	mem[wp], wp = (atlas_width & 0xffff) | (atlas_height << 16), wp + 4 -- Set the width and height of the slot to match the dimensions of the sprite atlas
	mem[wp], wp = vdp_pkt_end, wp + 4 -- End of packet stream
	submit_stream(wp - vdp_stream_base) -- Submit the command stream via DMA to configure the primary surface slot
	wait_dma() -- Wait for the DMA transfer to complete before proceeding, ensuring the slot is configured before we try to use it for drawing sprites
end

local upload_atlas_to_vram<const> = function() -- Upload the sprite atlas pixel data from RAM to VRAM using DMA. This is done by setting up the DMA source and destination addresses and length, then starting the DMA transfer and waiting for it to complete.
	mem[io_dma_src] = atlas_ram_base -- Set the DMA source address to the base of the sprite atlas in RAM where we built the pixel data
	mem[io_dma_dst] = vram_primary_slot_base -- Set the DMA destination address to the base of the primary surface slot in VRAM where we want the atlas to be uploaded
	mem[io_dma_len] = atlas_bytes -- Set the DMA length to the total size of the sprite atlas in bytes (width * height * 4 bytes per pixel)
	mem[io_dma_ctrl] = dma_ctrl_start -- Start the DMA transfer by writing the control value to the DMA control register
	wait_dma() -- Wait for the DMA transfer to complete before proceeding, ensuring the atlas is fully uploaded to VRAM before we try to draw with it
end

local draw_frame<const> = function()
	local wp = vdp_stream_base -- Write pointer for building the VDP command stream in RAM for this frame

	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_bg_color, wp + 4 -- Set the background color register for the clear command
	mem[wp], wp = 0xff05080d, wp + 4 -- Set the background color to a dark reddish color for the clear command
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_clear, wp + 4 -- Issue a clear command to clear the entire screen to the background color we just set, parameters for the clear command are specified in registers (see below)

	mem[wp], wp = vdp_pkt_regn | (4 << 16) | vdp_reg_geom_x0, wp + 4 -- Set multiple geometry registers for the first filled rectangle (the dark red background area)
	mem[wp], wp = 0 << 16, wp + 4 -- X0 = 0 (left edge of the rectangle)
	mem[wp], wp = 82 << 16, wp + 4 -- Y0 = 82 (top edge of the rectangle)
	mem[wp], wp = 256 << 16, wp + 4 -- X1 = 256 (right edge of the rectangle, covering the entire width of the screen)
	mem[wp], wp = 126 << 16, wp + 4 -- Y1 = 126 (bottom edge of the rectangle, creating a horizontal band across the screen)
	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_layer_prio, wp + 4 -- Set the draw layer and priority for this rectangle
	mem[wp], wp = (vdp_layer_world & 0xff) | (8 << 8), wp + 4 -- Draw on the world layer with priority 8 (lower priority than the sprite which will be drawn later)
	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_color, wp + 4 -- Set the draw color register for the fill_rect command
	mem[wp], wp = 0xff142438, wp + 4 -- Set the draw color to a slightly lighter dark red for the filled rectangle
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_fill_rect, wp + 4 -- Issue a fill rectangle command to draw the dark red background area, parameters for the fill_rect command are specified in registers (see above)

	mem[wp], wp = vdp_pkt_regn | (4 << 16) | vdp_reg_geom_x0, wp + 4 -- Set multiple geometry registers for the second filled rectangle (the dark blue background area below the red band)
	mem[wp], wp = 0 << 16, wp + 4 -- X0 = 0 (left edge of the rectangle)
	mem[wp], wp = 126 << 16, wp + 4 -- Y0 = 126 (top edge of the rectangle, starting where the red band ends)
	mem[wp], wp = 256 << 16, wp + 4 -- X1 = 256 (right edge of the rectangle, covering the entire width of the screen)
	mem[wp], wp = 212 << 16, wp + 4 -- Y1 = 212 (bottom edge of the rectangle, creating a horizontal band across the screen below the red band)
	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_layer_prio, wp + 4 -- Set the draw layer and priority for this rectangle
	mem[wp], wp = (vdp_layer_world & 0xff) | (10 << 8), wp + 4 -- Draw on the world layer with priority 10 (lower priority than the sprite which will be drawn later)
	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_color, wp + 4 -- Set the draw color register for the fill_rect command
	mem[wp], wp = 0xff0d1417, wp + 4 -- Set the draw color to a slightly lighter dark blue for the filled rectangle
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_fill_rect, wp + 4 -- Issue a fill rectangle command to draw the dark blue background area, parameters for the fill_rect command are specified in registers (see above)

	mem[wp], wp = vdp_pkt_regn | (4 << 16) | vdp_reg_geom_x0, wp + 4 -- Set multiple geometry registers for the third filled rectangle (the thin blue line that separates the red and blue areas)
	mem[wp], wp = 58 << 16, wp + 4 -- X0 = 58 (left edge of the rectangle, creating a gap on the left side of the screen)
	mem[wp], wp = 126 << 16, wp + 4 -- Y0 = 126 (top edge of the rectangle, starting where the red band ends)
	mem[wp], wp = 198 << 16, wp + 4 -- X1 = 198 (right edge of the rectangle, creating a gap on the right side of the screen)
	mem[wp], wp = 212 << 16, wp + 4 -- Y1 = 212 (bottom edge of the rectangle, matching the bottom edge of the blue band)
	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_layer_prio, wp + 4 -- Set the draw layer and priority for this rectangle
	mem[wp], wp = (vdp_layer_world & 0xff) | (15 << 8), wp + 4 -- Draw on the world layer with priority 15 (higher priority than the other background rectangles, but still lower than the sprite which will be drawn later)
	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_color, wp + 4 -- Set the draw color register for the fill_rect command
	mem[wp], wp = 0xff29333b, wp + 4 -- Set the draw color to a dark blue-gray for the thin line separating the red and blue areas
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_fill_rect, wp + 4 -- Issue a fill rectangle command to draw the thin line separating the red and blue areas, parameters for the fill_rect command are specified in registers (see above)

	local line_y = 132 + ((frame * 2) % 28) -- Y coordinate for the moving horizontal line, oscillates between 132 and 158 over time to create a simple animation effect on the background
	while line_y < 212 do -- Draw multiple horizontal lines moving down the screen, starting from line_y and spaced 28 pixels apart, until we reach the bottom of the blue area at Y=212
		local half_width<const> = 4 + ((line_y - 126) // 6) -- Calculate the half width of the line based on its Y coordinate, creating a simple perspective effect where lines closer to the bottom of the screen are wider
		mem[wp], wp = vdp_pkt_regn | (4 << 16) | vdp_reg_geom_x0, wp + 4 -- Set multiple geometry registers for the moving horizontal line
		mem[wp], wp = (128 - half_width) << 16, wp + 4 -- X0 = center of the screen minus half the width of the line, creating a line that expands outward from the center as it moves down the screen
		mem[wp], wp = line_y << 16, wp + 4 -- Y0 = line_y (the current Y coordinate of the line)
		mem[wp], wp = (128 + half_width) << 16, wp + 4 -- X1 = center of the screen plus half the width of the line, creating a line that expands outward from the center as it moves down the screen
		mem[wp], wp = (line_y + 2) << 16, wp + 4 -- Y1 = line_y + 2 (the line is 2 pixels tall)
		mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_layer_prio, wp + 4 -- Set the draw layer and priority for the moving horizontal line
		mem[wp], wp = (vdp_layer_world & 0xff) | (18 << 8), wp + 4 -- Draw on the world layer with priority 18 (higher than all the background rectangles, but still lower than the sprite which will be drawn later)
		mem[wp], wp = vdp_pkt_reg1 | vdp_reg_draw_color, wp + 4 -- Set the draw color register for the fill_rect command
		mem[wp], wp = 0xffd1c794, wp + 4 -- Set the draw color to a light tan for the moving horizontal lines to create a sense of depth and movement on the background
		mem[wp], wp = vdp_pkt_cmd | vdp_cmd_fill_rect, wp + 4 -- Issue a fill rectangle command to draw the moving horizontal line, parameters for the fill_rect command are specified in registers (see above)
		line_y = line_y + 28 -- Move the Y coordinate down by 28 pixels for the next line, creating evenly spaced lines as they move down the screen
	end

	mem[wp], wp = vdp_pkt_regn | (3 << 16) | vdp_reg_src_slot, wp + 4 -- Set multiple registers starting at the source slot register for the blit command to draw the sprite
	mem[wp], wp = vdp_slot_primary, wp + 4 -- Set the source slot to the primary slot where we uploaded the sprite atlas
	mem[wp], wp = 0, wp + 4 -- Set the source UV coordinates to (0,0) to start drawing from the top-left corner of the atlas
	mem[wp], wp = (atlas_width & 0xffff) | (atlas_height << 16), wp + 4 -- Set the source width and height to match the dimensions of the sprite atlas, so we draw the entire atlas as a single sprite

	mem[wp], wp = vdp_pkt_regn | (5 << 16) | vdp_reg_draw_layer_prio, wp + 4 -- Set multiple registers starting at the draw layer and priority register for the blit command to draw the sprite
	mem[wp], wp = (vdp_layer_world & 0xff) | (80 << 8), wp + 4 -- Draw on the world layer with priority 80 (higher than all the background elements to ensure the sprite is drawn on top)
	mem[wp], wp = 0x00008000, wp + 4 -- DRAW_CTRL: parallax +0.5
	mem[wp], wp = 0x00030000, wp + 4 -- DRAW_CTRL: priority mask to ensure the sprite's pixels are drawn over all background elements, but still allow for future sprites with higher priority to be drawn on top if needed
	mem[wp], wp = 0x00030000, wp + 4 -- DRAW_CTRL: shadow/highlight mask to enable shadows and highlights for the sprite based on the colors in the atlas (this allows us to use the different colors in the atlas to create a sense of depth and lighting on the sprite without needing multiple draw calls or complex shaders)
	mem[wp], wp = 0xffffffff, wp + 4 -- DRAW_CTRL: modulation color set to white with full alpha, so the colors from the atlas are not altered when drawn (if we wanted to tint the sprite we could change this modulation color)

	mem[wp], wp = vdp_pkt_regn | (2 << 16) | vdp_reg_dst_x, wp + 4 -- Set multiple registers starting at the destination X coordinate register for the blit command to specify where to draw the sprite on the screen
	mem[wp], wp = sprite_x << 16, wp + 4 -- Set the destination X coordinate for the sprite
	mem[wp], wp = sprite_y << 16, wp + 4 -- Set the destination Y coordinate for the sprite
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_blit, wp + 4 -- Issue the blit command to draw the sprite

	mem[wp], wp = vdp_pkt_end, wp + 4 -- End of packet stream
	submit_stream(wp - vdp_stream_base) -- Submit the command stream via DMA to draw the frame, which includes clearing the screen, drawing the background rectangles and lines, and finally drawing the sprite on top
	wait_dma() -- Wait for the DMA transfer to complete before proceeding, ensuring the entire frame is drawn before we try to draw the next frame or update any variables for animation (like sprite_x)
end

mem[io_vdp_dither] = 0
set_sprite_parallax_rig(4, 1.15, 0, 0, 16, 1, 1, 0, 0.6)
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
