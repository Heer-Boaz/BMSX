local font<const> = require('cartlib/font')
local prefab<const> = require('cartlib/world/prefab')
local text_component<const> = require('cartlib/text/text_component')
local nemesis_font<const> = require('nemesis_font')

local caption<const> = { definition_id = 'nemesis_s.presentation.caption' }

function caption:ctor()
	local text<const> = self:get_component(text_component)
	text:set_glyph_visible_height(0)
	self.text_component = text
	text.visible = true
end

function caption.register()
	prefab.define({
		def_id = caption.definition_id,
		class = caption,
		spatial = { family = '2d', authority = 'affine' },
		components = { function(owner) return text_component.new(owner, owner) end },
		defaults = {
			font = font.get(nemesis_font.font_id),
			text = '',
		},
	})
end

return caption
