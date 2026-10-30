-- Scene declarations configure concrete visual slots before any ctor runs.
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local text_component<const> = require('cartlib/text/text_component')
local rectangle_visual<const> = require('cartlib/component/rectangle_component')
local font<const> = require('cartlib/font')
local presentation<const> = {}
local caption<const> = {}
local rectangle<const> = {}

function caption:ctor()
	self.text_component = self:get_component(text_component)
end

function rectangle:ctor()
	self.visual = self:get_component(rectangle_visual)
end

function presentation.register()
	prefab.define({ def_id = 'pietious.sprite', class = sprite_object,
		spatial = { family = '2d', authority = 'affine' } })
	prefab.define({ def_id = 'pietious.caption', class = caption,
		spatial = { family = '2d', authority = 'affine' },
		components = { text_component.new }, initial = { text = { font = font.get('pietious'), color = 0xffffffff } } })
	prefab.define({ def_id = 'pietious.rectangle', class = rectangle,
		spatial = { family = '2d', authority = 'affine' },
		components = { rectangle_visual.new } })
end

return presentation
