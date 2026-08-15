local gp0<const> = require('cartlib/gx/gp0')
local imgdec<const> = require('cartlib/gx/imgdec')
local rom_dir<const> = require('cartlib/rom_dir')
local texture_bindings<const> = require('bmsx/texture_bindings')

local gx_texture<const> = {}
local texture_by_id<const> = {}
gx_texture.fixed_direct16 = {
	mode = gp0.texture_mode_direct16,
	x = 0,
	y = 0,
	_draw_mode_span_bindings = {},
}
local binding_pools<const> = {}
local placement_pools<const> = texture_bindings.placement_pools
for pool_index = 1, #placement_pools do
	binding_pools[pool_index] = {
		placement_words = placement_pools[pool_index],
		next_index = 1,
	}
end

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

function gx_texture.resolve(texture_id)
	local texture<const> = texture_by_id[texture_id]
	if texture then
		return texture
	end
	local resource<const> = rom_dir.texture(texture_id)
	local meta<const> = resource.texturemeta
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
		binding_pool = binding_pools[texture_bindings.pool_index_by_texture[texture_id]],
		_sources = {},
		_source_count = 0,
		_draw_mode_span_bindings = {},
	}
	texture_by_id[texture_id] = resolved
	return resolved
end

-- Resolved images retain placement-dependent packet words. Texture admission
-- refreshes those words once, before IMGDEC starts, so every renderer consumes
-- the newly published destination directly without rebuilding page or CLUT
-- state for each draw.
function gx_texture.bind_source(texture, source)
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
function gx_texture.bind_fixed_source(texture, source)
	refresh_direct16_source(texture, source)
end

-- A draw-mode span binding retains the sources consumed by one packet run.
-- Texture relocation refreshes the binding after its source words, so the
-- renderer can select a uniform state writer once per run instead of comparing
-- state for every packet. Spans crossing texture pages retain the stateful
-- writer; upload_raw may move a span between those representations.
function gx_texture.bind_draw_mode_span(binding)
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

function gx_texture.unbind_draw_mode_span(binding)
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

local resolve_image_texture<const> = function(imgid)
	return gx_texture.resolve(rom_dir.image(imgid).imgmeta.gx_texture_resid)
end

local upload_texture<const> = function(texture, destination, clut_destination)
	texture.x = destination & 0x0000ffff
	texture.y = destination >> 16
	local clut = 0
	local refresh_source = refresh_direct16_source
	if texture.mode == gp0.texture_mode_palette4 then
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

function gx_texture.upload(imgid)
	local texture<const> = resolve_image_texture(imgid)
	local pool<const> = texture.binding_pool
	local placement_words<const> = pool.placement_words
	local placement_index<const> = pool.next_index
	local next_index<const> = placement_index + 2
	pool.next_index = next_index > #placement_words and 1 or next_index
	upload_texture(texture, placement_words[placement_index], placement_words[placement_index + 1])
end

function gx_texture.upload_raw(imgid, destination, clut_destination)
	upload_texture(resolve_image_texture(imgid), destination, clut_destination)
end

return gx_texture
