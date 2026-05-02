local io_vdp_dither<const> = sys_vdp_dither -- VDP dithering control
local io_irq_flags<const> = sys_irq_flags -- IRQ flags: bit 0 = DMA done, bit 1 = DMA error, bit 4 = VBlank
local io_irq_ack<const> = sys_irq_ack -- IRQ acknowledge: write 1 to bits to acknowledge corresponding IRQs
local io_dma_src<const> = sys_dma_src -- DMA source address
local io_dma_dst<const> = sys_dma_dst -- DMA destination address
local io_dma_len<const> = sys_dma_len -- DMA length in bytes
local io_dma_ctrl<const> = sys_dma_ctrl -- DMA control: write 1 to bit 0 to start DMA

local vdp_stream_base<const> = sys_vdp_stream_base -- Base address for building VDP command streams in RAM before submitting via DMA
local vram_primary_slot_base<const> = sys_vram_primary_slot_base -- Base VRAM address for the primary surface slot (slot 0)
local atlas_ram_base<const> = sys_geo_scratch_base -- Base RAM address for building the sprite atlas before uploading to VRAM
local io_vdp_fifo<const> = sys_vdp_fifo -- VDP FIFO: write 32-bit command words here to send to VDP immediately (bypassing DMA)

local vdp_pkt_end<const> = 0x00000000 -- End of packet stream
local vdp_pkt_cmd<const> = 0x01000000 -- Command packet: lower 16 bits = command ID, upper 8 bits = number of additional data words
local vdp_pkt_reg1<const> = 0x02000000 -- Register packet: lower 16 bits = register index, upper 8 bits = number of additional data words
local vdp_pkt_regn<const> = 0x03000000 -- Register packet with N registers: lower 16 bits = starting register index, upper 8 bits = number of registers to set (data words must be in register order)
local vdp_pkt_billboard<const> = 0x11000000 -- BILLBOARD packet: BBU command-stream packet, followed by fixed hardware words
local vdp_pkt_skybox<const> = 0x12000000 -- SKYBOX packet: SBX command-stream packet, followed by control and six face-source records
local vdp_billboard_payload_words<const> = 10 -- BILLBOARD payload: layer/priority, slot, uv, wh, x, y, z, size, color, control
local vdp_skybox_payload_words<const> = 31 -- SKYBOX payload: control plus six faces of slot/u/v/w/h

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
local vdp_sbx_control_enable<const> = 1 -- SBX control bit: enable the live skybox face state when latched into a frame
local draw_ctrl_parallax_half<const> = 0x00800000 -- DRAW_CTRL: PMU bank 0, parallax weight +0.5 in signed Q8.8
local q16_one<const> = 0x00010000 -- Q16.16 value 1.0, used directly in VDP command words

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
local camera_view<const> = { -- Active 3D camera view matrix; updated in-place so SBX skybox lookup visibly rotates.
	1, 0, 0, 0,
	0, 1, 0, 0,
	0, 0, 1, 0,
	0, 0, 0, 1,
}
local camera_proj<const> = { -- Perspective projection for SBX/BBU demonstration; command ABI remains raw VDP words.
	1.4342, 0, 0, 0,
	0, 1.7321, 0, 0,
	0, 0, -1.0040, -1,
	0, 0, -0.2004, 0,
}
local camera_eye<const> = { 0, 0, 0 }

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

local update_skybox_camera<const> = function()
	local angle<const> = frame * 0.035
	local c<const> = math.cos(angle)
	local s<const> = math.sin(angle)
	camera_view[1] = c
	camera_view[2] = 0
	camera_view[3] = -s
	camera_view[4] = 0
	camera_view[5] = 0
	camera_view[6] = 1
	camera_view[7] = 0
	camera_view[8] = 0
	camera_view[9] = s
	camera_view[10] = 0
	camera_view[11] = c
	camera_view[12] = 0
	camera_view[13] = 0
	camera_view[14] = 0
	camera_view[15] = 0
	camera_view[16] = 1
	set_camera(camera_view, camera_proj, camera_eye)
end

local build_lua_atlas<const> = function()
	local sky_top<const> = 0xff071a3a -- Opaque sky color used by SBX and BBU samples
	local sky_mid<const> = 0xff124b7d -- Opaque mid-tone color used by SBX and BBU samples
	local sky_low<const> = 0xff321a3c -- Opaque lower atlas color used by SBX and BBU samples
	local star<const> = 0xfffff2a6 -- Bright atlas pixels so the skybox and billboards show high-contrast texels
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

	mem[wp], wp = vdp_pkt_skybox | (vdp_skybox_payload_words << 16), wp + 4 -- SBX SKYBOX packet: live face words are latched and validated when the frame is sealed
	mem[wp], wp = vdp_sbx_control_enable, wp + 4 -- Enable the six-face skybox for this frame
	mem[wp], wp = vdp_slot_primary, wp + 4 -- +X: upper-left atlas quadrant
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4 -- -X: upper-right atlas quadrant
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4 -- +Y: lower-left atlas quadrant
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4 -- -Y: lower-right atlas quadrant
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4 -- +Z: whole atlas
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = atlas_width, wp + 4
	mem[wp], wp = atlas_height, wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4 -- -Z: center atlas sample
	mem[wp], wp = 4, wp + 4
	mem[wp], wp = 4, wp + 4
	mem[wp], wp = 8, wp + 4
	mem[wp], wp = 8, wp + 4

	mem[wp], wp = vdp_pkt_reg1 | vdp_reg_bg_color, wp + 4 -- Set the background color register for the clear command
	mem[wp], wp = 0x0005080d, wp + 4 -- Transparent DEX clear: the SBX skybox remains visible behind 2D framebuffer work
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
	mem[wp], wp = draw_ctrl_parallax_half, wp + 4 -- DRAW_CTRL: no flip, PMU bank 0, DEX parallax weight +0.5
	mem[wp], wp = 0x00030000, wp + 4 -- DRAW_SCALE_X: 3.0 in Q16.16
	mem[wp], wp = 0x00030000, wp + 4 -- DRAW_SCALE_Y: 3.0 in Q16.16
	mem[wp], wp = 0xffffffff, wp + 4 -- DRAW_COLOR: modulation color set to white with full alpha

	mem[wp], wp = vdp_pkt_regn | (2 << 16) | vdp_reg_dst_x, wp + 4 -- Set multiple registers starting at the destination X coordinate register for the blit command to specify where to draw the sprite on the screen
	mem[wp], wp = sprite_x << 16, wp + 4 -- Set the destination X coordinate for the sprite
	mem[wp], wp = sprite_y << 16, wp + 4 -- Set the destination Y coordinate for the sprite
	mem[wp], wp = vdp_pkt_cmd | vdp_cmd_blit, wp + 4 -- Issue the blit command to draw the sprite

		local billboard_shift<const> = ((frame % 64) - 32) * 1024 -- Visible Q16.16 animation term around the active 3D camera center
	mem[wp], wp = vdp_pkt_billboard | (vdp_billboard_payload_words << 16), wp + 4 -- BBU BILLBOARD packet: fixed-point position and size in the active billboard coordinate space
	mem[wp], wp = (vdp_layer_world & 0xff) | (32 << 8), wp + 4 -- Layer/priority word
	mem[wp], wp = vdp_slot_primary, wp + 4 -- Texture slot sampled by the billboard
	mem[wp], wp = 0, wp + 4 -- Source U/V packed as two u16 words
	mem[wp], wp = (atlas_width & 0xffff) | (atlas_height << 16), wp + 4 -- Source W/H packed as two u16 words
		mem[wp], wp = 0xffff0000 + billboard_shift, wp + 4 -- X = -1.0 plus a small Q16.16 animation offset
		mem[wp], wp = 0x00006000, wp + 4 -- Y = +0.375 in signed Q16.16
		mem[wp], wp = 0xfffc0000, wp + 4 -- Z = -4.0 in signed Q16.16, in front of the perspective camera
		mem[wp], wp = 0x0000c000, wp + 4 -- Size = 0.75 in unsigned Q16.16 under the active camera
	mem[wp], wp = 0xffffd060, wp + 4 -- AARRGGBB billboard modulation color
	mem[wp], wp = 0, wp + 4 -- Reserved BBU control word

	mem[wp], wp = vdp_pkt_billboard | (vdp_billboard_payload_words << 16), wp + 4 -- Second BBU billboard, same atlas slot but different fixed-point world position
	mem[wp], wp = (vdp_layer_world & 0xff) | (36 << 8), wp + 4
	mem[wp], wp = vdp_slot_primary, wp + 4
	mem[wp], wp = 0, wp + 4
	mem[wp], wp = (atlas_width & 0xffff) | (atlas_height << 16), wp + 4
		mem[wp], wp = 0x00010000 - billboard_shift, wp + 4 -- X = +1.0 minus the same Q16.16 animation offset
		mem[wp], wp = 0xffffe000, wp + 4 -- Y = -0.125 in signed Q16.16
		mem[wp], wp = 0xfffc8000, wp + 4 -- Z = -3.5 in signed Q16.16
		mem[wp], wp = 0x0000a000, wp + 4 -- Size = 0.625 in unsigned Q16.16 under the active camera
	mem[wp], wp = 0xff60e6ff, wp + 4
	mem[wp], wp = 0, wp + 4

	mem[wp], wp = vdp_pkt_end, wp + 4 -- End of packet stream
	submit_stream(wp - vdp_stream_base) -- Submit the command stream via DMA to draw the frame, which includes clearing the screen, drawing the background rectangles and lines, and finally drawing the sprite on top
	wait_dma() -- Wait for the DMA transfer to complete before proceeding, ensuring the entire frame is drawn before we try to draw the next frame or update any variables for animation (like sprite_x)
end

mem[io_vdp_dither] = 0
mem[sys_vdp_pmu_bank] = 0
mem[sys_vdp_pmu_x] = 0
mem[sys_vdp_pmu_y] = 16 << 16 -- VDP PMU bank 0: +16px Y, so DRAW_CTRL +0.5 resolves to +8px Y
mem[sys_vdp_pmu_scale_x] = 0x00010000
mem[sys_vdp_pmu_scale_y] = 0x00010000
mem[sys_vdp_pmu_ctrl] = 0
build_lua_atlas()
configure_primary_surface()
upload_atlas_to_vram()

while true do
	frame = frame + 1
	update_skybox_camera()
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
