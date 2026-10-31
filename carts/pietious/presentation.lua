local object_2d<const> = require('cartlib/world/object_2d')
-- Scene declarations supply each presentation object's visual properties.
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local text_component<const> = require('cartlib/text/text_component')
local rectangle_visual<const> = require('cartlib/component/rectangle_component')
local font<const> = require('cartlib/font')
local presentation<const> = {}
local caption<const> = {}
setmetatable(caption, { __index = object_2d })
local rectangle<const> = {}
setmetatable(rectangle, { __index = object_2d })

function caption:ctor()
	self.text_component = self:get_component(text_component)
	self.text_component.visible = true
end

function rectangle:ctor()
	self.visual = self:get_component(rectangle_visual)
	self.visual.visible = true
end

function presentation.register()
	prefab.define({ def_id = 'pietious.sprite', class = sprite_object })
	prefab.define({ def_id = 'pietious.caption', class = caption,
		components = { function(owner) return text_component.new(owner, owner) end }, defaults = {
			font = font.get('pietious'),
			color = 0xffffffff,
		} })
	prefab.define({ def_id = 'pietious.rectangle', class = rectangle,
		components = { function(owner) return rectangle_visual.new(owner, owner) end } })
end

return presentation
