local string_lib<const> = string
local image<const> = require('cartlib/gx/image')
local command_list<const> = require('cartlib/gx/command_list')
local atlas<const> = require('cartlib/gx/atlas')
local byte<const> = string_lib.byte

local font_catalog<const> = {}

local definitions<const> = {}
local resolved_fonts<const> = {}

local build_default_definition<const> = function()
	local glyphs<const> = {}
	for codepoint = 0x20, 0x7e do
		glyphs[string_lib.char(codepoint)] = string_lib.format('tiny_3b_font_code_0x%02x', codepoint)
	end
	return {
		glyphs = glyphs,
		line_height = 6,
	}
end

local build_resolved_font<const> = function(id, definition)
	local advance_padding<const> = definition.advance_padding or 0
	local items<const> = {}
	local advances<const> = {}
	local sources<const> = {}
	local source_count = 0
	local uniform_size = true
	local uniform_size_word
	for glyph, imgid in pairs(definition.glyphs) do
		local source<const> = image.resolve(imgid)
		local codepoint<const> = byte(glyph)
		items[codepoint] = source
		advances[codepoint] = source.width + advance_padding
		source_count = source_count + 1
		sources[source_count] = source
		if uniform_size_word == nil then
			uniform_size_word = source._size_word
		elseif source._size_word ~= uniform_size_word then
			uniform_size = false
		end
	end
	local space<const> = items[0x20]
	if space and not items[0x09] then
		items[0x09] = space
		advances[0x09] = advances[0x20] * 4
	end
	local line_glyph<const> = items[0x41] or items[0x61] or items[0x3f]
	local uniform_writer = command_list.blit_uniform_span
	if not uniform_size then
		uniform_writer = command_list.blit_uniform_draw_mode_span
	end
	local span_binding<const> = {
		sources = sources,
		source_count = source_count,
		per_source_writer = command_list.blit_span,
		uniform_writer = uniform_writer,
	}
	atlas.bind_draw_mode_span(span_binding)
	return {
		id = id,
		items = items,
		advances = advances,
		line_height = definition.line_height or line_glyph.height,
		span_binding = span_binding,
	}
end

-- Replaces the source definition and returns the rebuilt retained font only
-- when a consumer has already resolved this identity.
function font_catalog.replace(id, definition)
	definitions[id] = definition
	local previous<const> = resolved_fonts[id]
	if previous == nil then
		return nil
	end
	atlas.unbind_draw_mode_span(previous.span_binding)
	local replacement<const> = build_resolved_font(id, definition)
	resolved_fonts[id] = replacement
	return replacement
end

function font_catalog.get(id)
	local resolved_font = resolved_fonts[id]
	if resolved_font == nil then
		local definition = definitions[id]
		if definition == nil and id == 'default' then
			definition = build_default_definition()
			definitions[id] = definition
		end
		resolved_font = build_resolved_font(id, definition)
		resolved_fonts[id] = resolved_font
	end
	return resolved_font
end

function font_catalog.write_glyph_range(resolved_font, text, first_byte, last_byte, target)
	local items<const> = resolved_font.items
	local advances<const> = resolved_font.advances
	local fallback<const> = items[0x3f]
	local fallback_advance<const> = advances[0x3f]
	local length<const> = last_byte - first_byte + 1
	local x_offsets = target.x_offsets
	if x_offsets == nil then
		x_offsets = {}
		target.x_offsets = x_offsets
	end
	local width = 0
	for index = 1, length do
		local codepoint<const> = byte(text, first_byte + index - 1)
		local glyph<const> = items[codepoint] or fallback
		target[index] = glyph
		x_offsets[index] = width
		width = width + (advances[codepoint] or fallback_advance)
	end
	for index = length + 1, #target do
		target[index] = nil
	end
	target.glyph_count = length
	target.visible_count = length
	return width
end

return font_catalog
