local string_lib<const> = string
local image<const> = require('cartlib/gx/image')
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
	for glyph, imgid in pairs(definition.glyphs) do
		local source<const> = image.resolve(imgid)
		items[byte(glyph)] = {
			texture = source._texture,
			blit_span = source._blit_span,
			source_x = source.source_x,
			source_y = source.source_y,
			size_word = source._size_word,
			width = source.width,
			height = source.height,
			advance = source.width + advance_padding,
		}
	end
	local space<const> = items[0x20]
	if space and not items[0x09] then
		items[0x09] = {
			texture = space.texture,
			blit_span = space.blit_span,
			source_x = space.source_x,
			source_y = space.source_y,
			size_word = space.size_word,
			width = space.width,
			height = space.height,
			advance = space.advance * 4,
		}
	end
	local line_glyph<const> = items[0x41] or items[0x61] or items[0x3f]
	return {
		id = id,
		items = items,
		line_height = definition.line_height or line_glyph.height,
		advance_padding = advance_padding,
	}
end

-- Replaces the source definition and returns the rebuilt retained font only
-- when a consumer has already resolved this identity.
function font_catalog.replace(id, definition)
	definitions[id] = definition
	if resolved_fonts[id] == nil then
		return nil
	end
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

function font_catalog.write_glyph_line(resolved_font, line, target)
	local items<const> = resolved_font.items
	local fallback<const> = items[0x3f]
	local length<const> = #line
	local x_offsets = target.x_offsets
	if x_offsets == nil then
		x_offsets = {}
		target.x_offsets = x_offsets
	end
	local runs = target.runs
	if runs == nil then
		runs = {}
		target.runs = runs
	end
	local width = 0
	local run_count = 0
	local run
	for index = 1, length do
		local glyph<const> = items[byte(line, index)] or fallback
		target[index] = glyph
		x_offsets[index] = width
		if run == nil or run.texture ~= glyph.texture or run.blit_span ~= glyph.blit_span then
			run_count = run_count + 1
			run = runs[run_count]
			if run == nil then
				run = {}
				runs[run_count] = run
			end
			run.texture = glyph.texture
			run.blit_span = glyph.blit_span
			run.first_index = index
		end
		run.last_index = index
		width = width + glyph.advance
	end
	for index = length + 1, #target do
		target[index] = nil
	end
	target.glyph_count = length
	target.visible_count = length
	target.run_count = run_count
	return width
end

return font_catalog
