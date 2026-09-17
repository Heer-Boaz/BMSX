-- Scene visuals have no update loop. Controllers bind retained components;
-- placement stays on the independently authored objects.
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local text_component<const> = require('cartlib/text/text_component')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local font<const> = require('cartlib/font')
local presentation<const> = {}
local sprite<const> = {}
local caption<const> = {}
local rectangle<const> = {}

function sprite:ctor()
	local region<const> = self.region
	if region then
		self.sprite_component:set_region(region.x, region.y, region.width, region.height)
	end
end

function caption:ctor()
	local text<const> = self:get_component(text_component)
	text:set_font(font.get('pietious'))
	text.color = self.color
	text.background_color = self.background_color
	text.center_block_width = self.center_block_width
	text:set_text(self.text)
	self.text_component = text
end

local draw_rectangle<const> = function(component, draw)
	local owner<const> = component.parent
	draw:rect(owner.x, owner.y, owner.x + owner.width, owner.y + owner.height, owner.color)
end

function rectangle:ctor()
	self.visual = self:get_component(custom_visual_component)
end

function presentation.register()
	prefab.define({ def_id = 'pietious.sprite', class = sprite, base = sprite_object })
	prefab.define({ def_id = 'pietious.caption', class = caption,
		components = { text_component.new }, defaults = { color = 0xffffffff } })
	prefab.define({ def_id = 'pietious.rectangle', class = rectangle,
		components = { custom_visual_component.factory({ draw = draw_rectangle }) } })
end

return presentation
