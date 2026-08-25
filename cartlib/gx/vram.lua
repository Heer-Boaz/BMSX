local gx_display<const> = require('cartlib/gx/display')

local vram<const> = {}

local vram_width<const> = 1024
local vram_height<const> = 1024
local texture_page_span<const> = 256
local palette4_page_word_span<const> = 64
local palette4_clut_word_count<const> = 16

local system_reservation<const> = {
	x = 704,
	y = 720,
	width = 320,
	height = 304,
	_allocation_index = 1,
}

local allocations<const> = { system_reservation }
local allocation_count

local align_at_or_after<const> = function(value, alignment)
	return value + (-value % alignment)
end

local overlaps<const> = function(x, y, width, height, allocation)
	return x < allocation.x + allocation.width
		and allocation.x < x + width
		and y < allocation.y + allocation.height
		and allocation.y < y + height
end

local allocate<const> = function(width, height, x_alignment, y_alignment, replaced)
	local selected_x
	local selected_y
	for y_edge_index = 0, allocation_count do
		local y = 0
		if y_edge_index ~= 0 then
			local edge<const> = allocations[y_edge_index]
			y = align_at_or_after(edge.y + edge.height, y_alignment)
		end
		if y + height <= vram_height then
			for x_edge_index = 0, allocation_count do
				local x = 0
				if x_edge_index ~= 0 then
					local edge<const> = allocations[x_edge_index]
					x = align_at_or_after(edge.x + edge.width, x_alignment)
				end
				if x + width <= vram_width then
					local occupied = false
					for allocation_index = 1, allocation_count do
						local allocation<const> = allocations[allocation_index]
						if allocation ~= replaced
						and overlaps(x, y, width, height, allocation) then
							occupied = true
							break
						end
					end
					if not occupied
					and (selected_y == nil or y < selected_y or (y == selected_y and x < selected_x)) then
						selected_x = x
						selected_y = y
					end
				end
			end
		end
	end
	if selected_y == nil then return nil end
	local allocation = replaced
	if allocation == nil then
		local index<const> = allocation_count + 1
		allocation = { _allocation_index = index }
		allocations[index] = allocation
		allocation_count = index
	end
	allocation.x = selected_x
	allocation.y = selected_y
	allocation.width = width
	allocation.height = height
	return allocation
end

local texture_layout<const> = function(word_width, height, palette4)
	local width = word_width
	local allocation_height = height
	local x_alignment = texture_page_span
	if palette4 then
		if width < palette4_clut_word_count then
			width = palette4_clut_word_count
		end
		allocation_height = allocation_height + 1
		x_alignment = palette4_page_word_span
	end
	return width, allocation_height, x_alignment
end

local finish_texture_allocation<const> = function(allocation, texture_height, palette4)
	allocation.destination = allocation.x | (allocation.y << 16)
	if palette4 then
		allocation.clut_destination = allocation.x | ((allocation.y + texture_height) << 16)
	else
		allocation.clut_destination = 0
	end
	return allocation
end

function vram.configure(framebuffer_count)
	allocation_count = 1
	local page_size<const> = gx_display.read_size_word()
	local page_width<const> = page_size & 0x0000ffff
	local page_height<const> = page_size >> 16
	local page_1<const> = allocate(page_width, page_height, 1, 1)
	local page_2 = page_1
	if framebuffer_count == 2 then
		page_2 = allocate(page_width, page_height, 1, 1)
	end
	vram.page_size = page_size
	vram.page_1 = page_1.x | (page_1.y << 16)
	vram.page_2 = page_2.x | (page_2.y << 16)
	return vram.page_1, vram.page_2, page_size
end

function vram.allocate_texture(word_width, height, palette4)
	local width<const>, allocation_height<const>, x_alignment<const> = texture_layout(
		word_width, height, palette4)
	local allocation<const> = allocate(
		width,
		allocation_height,
		x_alignment,
		texture_page_span,
		nil
	)
	if allocation == nil then return nil end
	return finish_texture_allocation(allocation, height, palette4)
end

-- Reuses one cache allocation only when removing that allocation creates a
-- valid placement. Other retained allocations never need to be released just
-- to discover whether this replacement fits.
function vram.replace_texture(allocation, word_width, height, palette4)
	local width<const>, allocation_height<const>, x_alignment<const> = texture_layout(
		word_width, height, palette4)
	local replacement<const> = allocate(
		width,
		allocation_height,
		x_alignment,
		texture_page_span,
		allocation
	)
	if replacement == nil then return nil end
	return finish_texture_allocation(replacement, height, palette4)
end

function vram.release(allocation)
	local index<const> = allocation._allocation_index
	local last<const> = allocations[allocation_count]
	allocations[index] = last
	last._allocation_index = index
	allocations[allocation_count] = nil
	allocation_count = allocation_count - 1
	allocation._allocation_index = nil
end

return vram
