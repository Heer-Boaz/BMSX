local textcomponent<const> = require('cartlib/text/textcomponent')
local fontcatalog<const> = require('cartlib/text/fontcatalog')
local registry<const> = require('cartlib/registry')

local font<const> = {
	get = fontcatalog.get,
	write_glyph_line = fontcatalog.write_glyph_line,
}

function font.define(id, definition)
	local resolved_font<const> = fontcatalog.replace(id, definition)
	if resolved_font == nil then
		return
	end
	local components<const> = registry:entries(textcomponent)
	for i = 1, #components do
		local component<const> = components[i]
		if component.font.id == id then
			component:set_font(resolved_font)
		end
	end
end

return font
