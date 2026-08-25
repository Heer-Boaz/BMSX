local gp0<const> = require('cartlib/gx/gp0')
local imgdec<const> = require('cartlib/gx/imgdec')
local rom_dir<const> = require('cartlib/rom_dir')
local vram<const> = require('cartlib/gx/vram')

local atlas<const> = {}
local atlas_by_id<const> = {}
local oldest_resident
local newest_resident
local texture_page_span<const> = gp0.texture_page_span
local palette4_page_word_span<const> = texture_page_span >> 2
local palette4_clut_word_count<const> = 16

atlas.fixed_direct16 = {
	mode = gp0.texture_mode_direct16,
	x = 0,
	y = 0,
	_draw_mode_span_bindings = {},
}
local refresh_direct16_source<const> = function(texture, source)
	local source_x<const> = texture.x + source.source_x
	local source_y<const> = texture.y + source.source_y
	source._blit_draw_mode = gp0.direct16_draw_mode(
		source_x, source_y, gp0.draw_mode_blend_half)
	source._blit_uv_word = gp0.uv(source_x, source_y)
end

local refresh_palette4_source<const> = function(texture, source)
	local source_x<const> = source.source_x
	local source_y<const> = texture.y + source.source_y
	source._blit_draw_mode = gp0.palette4_draw_mode(
		texture.x, source_x, source_y, gp0.draw_mode_blend_half)
	source._blit_uv_word = gp0.uv_clut(
		source_x, source_y, texture.clut_x, texture.clut_y)
end

local refresh_draw_mode_span_binding<const> = function(binding)
	local sources<const> = binding.sources
	local source<const> = sources[1]
	local draw_mode<const> = source._blit_draw_mode
	for source_index = 2, binding.source_count do
		if sources[source_index]._blit_draw_mode ~= draw_mode then
			binding.writer = binding.per_source_writer
			binding.uniform_draw_mode_source = nil
			return
		end
	end
	binding.writer = binding.uniform_writer
	binding.uniform_draw_mode_source = source
end

-- Semantic texture identity survives until residency admission. Admission
-- publishes the selected raw placement before programming IMGDEC; rendering
-- may therefore observe old, partial or uninitialized VRAM while transfer is
-- still in flight.

function atlas.resolve(atlas_id)
	local texture<const> = atlas_by_id[atlas_id]
	if texture then
		return texture
	end
	local resource<const> = rom_dir.texture(atlas_id)
	local meta<const> = resource.texturemeta
	local allocation_width = meta.word_width
	local allocation_height = meta.height
	local x_alignment = texture_page_span
	if meta.mode == gp0.texture_mode_palette4 then
		if allocation_width < palette4_clut_word_count then
			allocation_width = palette4_clut_word_count
		end
		allocation_height = allocation_height + 1
		x_alignment = palette4_page_word_span
	end
	local resolved<const> = {
		source_addr = resource.addr,
		stream_word_count = resource.len >> 2,
		texture_word_count = meta.texture_word_count,
		clut_word_count = meta.clut_word_count,
		mode = meta.mode,
		word_width = meta.word_width,
		height = meta.height,
		x = 0,
		y = 0,
		clut_x = 0,
		clut_y = 0,
		_allocation_width = allocation_width,
		_allocation_height = allocation_height,
		_x_alignment = x_alignment,
		_allocation = nil,
		_sources = {},
		_source_count = 0,
		_draw_mode_span_bindings = {},
	}
	atlas_by_id[atlas_id] = resolved
	return resolved
end

-- Resolved images retain placement-dependent packet words. Texture admission
-- refreshes those words once, before IMGDEC starts, so every renderer consumes
-- the newly published destination directly without rebuilding page or CLUT
-- state for each draw.
function atlas.bind_source(texture, source)
	local source_count<const> = texture._source_count + 1
	texture._source_count = source_count
	texture._sources[source_count] = source
	if texture.mode == gp0.texture_mode_palette4 then
		refresh_palette4_source(texture, source)
	else
		refresh_direct16_source(texture, source)
	end
end

-- Fixed BIOS atlas sources are admitted once and never need a relocation
-- reverse-list entry.
function atlas.bind_fixed_source(texture, source)
	refresh_direct16_source(texture, source)
end

-- A draw-mode span binding retains the sources consumed by one packet run.
-- Texture relocation refreshes the binding after its source words, so the
-- renderer can select a uniform state writer once per run instead of comparing
-- state for every packet. Spans crossing texture pages retain the stateful
-- writer when a resident atlas is relocated.
function atlas.bind_draw_mode_span(binding)
	local textures<const> = {}
	local texture_count = 0
	local sources<const> = binding.sources
	for source_index = 1, binding.source_count do
		local texture<const> = sources[source_index]._texture
		local texture_index = 1
		while texture_index <= texture_count and textures[texture_index] ~= texture do
			texture_index = texture_index + 1
		end
		if texture_index > texture_count then
			texture_count = texture_index
			textures[texture_index] = texture
			local bindings<const> = texture._draw_mode_span_bindings
			bindings[#bindings + 1] = binding
		end
	end
	binding.textures = textures
	binding.texture_count = texture_count
	refresh_draw_mode_span_binding(binding)
end

function atlas.unbind_draw_mode_span(binding)
	local textures<const> = binding.textures
	for texture_index = 1, binding.texture_count do
		local bindings<const> = textures[texture_index]._draw_mode_span_bindings
		for binding_index = 1, #bindings do
			if bindings[binding_index] == binding then
				bindings[binding_index] = bindings[#bindings]
				bindings[#bindings] = nil
				break
			end
		end
	end
end

local load_texture<const> = function(texture, allocation)
	local destination<const> = allocation.x | (allocation.y << 16)
	texture.x = destination & 0x0000ffff
	texture.y = destination >> 16
	local clut = 0
	local refresh_source = refresh_direct16_source
	if texture.mode == gp0.texture_mode_palette4 then
		local clut_destination<const> = allocation.x | ((allocation.y + texture.height) << 16)
		texture.clut_x = clut_destination & 0x0000ffff
		texture.clut_y = clut_destination >> 16
		clut = clut_destination
		refresh_source = refresh_palette4_source
	end
	local sources<const> = texture._sources
	for source_index = 1, texture._source_count do
		refresh_source(texture, sources[source_index])
	end
	local span_bindings<const> = texture._draw_mode_span_bindings
	for binding_index = 1, #span_bindings do
		refresh_draw_mode_span_binding(span_bindings[binding_index])
	end
	imgdec.upload(
		texture.source_addr,
		texture.stream_word_count,
		texture.texture_word_count,
		texture.clut_word_count,
		destination,
		texture.word_width | (texture.height << 16),
		clut)
end

local unlink_resident<const> = function(texture)
	local previous<const> = texture._resident_previous
	local next_texture<const> = texture._resident_next
	if previous == nil then
		oldest_resident = next_texture
	else
		previous._resident_next = next_texture
	end
	if next_texture == nil then
		newest_resident = previous
	else
		next_texture._resident_previous = previous
	end
	texture._resident_previous = nil
	texture._resident_next = nil
end

local retain_recently_used<const> = function(texture)
	if texture == newest_resident then return end
	if texture._resident_previous ~= nil or texture == oldest_resident then
		unlink_resident(texture)
	end
	texture._resident_previous = newest_resident
	if newest_resident == nil then
		oldest_resident = texture
	else
		newest_resident._resident_next = texture
	end
	newest_resident = texture
end

local evict_oldest<const> = function()
	local texture<const> = oldest_resident
	if texture == nil then
		error('GX texture does not fit the installed 1024x1024 word store.')
	end
	unlink_resident(texture)
	vram.release(texture._allocation)
	texture._allocation = nil
end

local replace_resident_allocation<const> = function(replacement)
	local texture = oldest_resident
	while texture ~= nil do
		local next_texture<const> = texture._resident_next
		local allocation<const> = vram.replace(
			texture._allocation,
			replacement._allocation_width,
			replacement._allocation_height,
			replacement._x_alignment,
			texture_page_span
		)
		if allocation ~= nil then
			unlink_resident(texture)
			texture._allocation = nil
			return allocation
		end
		texture = next_texture
	end
	return nil
end

function atlas.load(atlas_id)
	local texture<const> = atlas.resolve(atlas_id)
	local allocation = texture._allocation
	if allocation ~= nil then
		retain_recently_used(texture)
		return
	end
	allocation = vram.allocate(
		texture._allocation_width,
		texture._allocation_height,
		texture._x_alignment,
		texture_page_span
	)
	while allocation == nil do
		allocation = replace_resident_allocation(texture)
		if allocation == nil then
			evict_oldest()
			allocation = vram.allocate(
				texture._allocation_width,
				texture._allocation_height,
				texture._x_alignment,
				texture_page_span
			)
		end
	end
	texture._allocation = allocation
	retain_recently_used(texture)
	load_texture(texture, allocation)
end

return atlas
