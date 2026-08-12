local text_component<const> = require('cartlib/text/text_component')
local font_catalog<const> = require('cartlib/text/font_catalog')
local registry<const> = require('cartlib/registry')

local font<const> = {
	get = font_catalog.get,
	write_glyph_line = font_catalog.write_glyph_line,
}

function font.define(id, definition)
	local resolved_font<const> = font_catalog.replace(id, definition)
	if resolved_font == nil then
		return
	end
	local components<const> = registry:entries(text_component)
	for i = 1, #components do
		local component<const> = components[i]
		if component.font.id == id then
			component:set_font(resolved_font)
		end
	end
end

return font
