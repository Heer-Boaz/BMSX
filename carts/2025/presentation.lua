local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local text_object<const> = require('cartlib/text/text_object')
local surface_component<const> = require('cartlib/component/surface_component')
local custom_visual_component<const> = require('cartlib/component/custom_visual_component')

local presentation<const> = {
	sprite = 'p3.sprite', text = 'p3.text', surface = 'p3.surface',
	rectangle = 'p3.rectangle', overlay = 'p3.overlay',
}
local sprite<const> = {}
local surface<const> = {}
local text<const> = {}
local rectangle<const> = {}

-- Animation keeps a per-instance anchor; changing a scene never edits a shared
-- definition or loses its placement when the next combat starts.
function sprite:onspawn()
	self.home_x, self.home_y, self.home_z = self.x, self.y, self.z
end
surface.onspawn = sprite.onspawn

function surface:ctor()
	self.surface_component = self:get_component(surface_component)
	if self.imgid then self.surface_component:set_imgid(self.imgid) end
end

function text:onspawn()
	-- TextObject consumes a world-space layout rectangle. Scenes author that
	-- rectangle locally, so placement is converted once, at admission.
	local bounds<const> = self.dimensions
	self:set_dimensions({
		left = self.x + bounds.left, right = self.x + bounds.right,
		top = self.y + bounds.top, bottom = self.y + bounds.bottom,
	})
end

function rectangle:ctor()
	self.visual = self:get_component(custom_visual_component)
end

local draw_rectangle<const> = function(component, draw)
	local owner<const> = component.parent
	local x<const>, y<const> = owner.x + component.offset_x, owner.y + component.offset_y
	draw:rect(x, y, x + owner.width, y + owner.height, owner.color)
end

local draw_overlay<const> = function(component, draw)
	local owner<const> = component.parent
	local x<const>, y<const> = owner.x, owner.y
	if owner.color ~= 0 then
		draw:rect(x, y, x + owner.width, y + owner.height, owner.color)
	end
	if owner.blend_color ~= 0 then
		draw:mode(owner.blend_mode)
		draw:semitransparent_rect(x, y, x + owner.width, y + owner.height, owner.blend_color)
	end
end

function presentation.register()
	prefab.define({ def_id = presentation.sprite, class = sprite, base = sprite_object })
	prefab.define({ def_id = presentation.text, class = text, base = text_object })
	prefab.define({ def_id = presentation.surface, class = surface, components = { surface_component.new } })
	prefab.define({ def_id = presentation.rectangle, class = rectangle,
		components = { custom_visual_component.factory({ draw = draw_rectangle }) } })
	prefab.define({ def_id = presentation.overlay, class = rectangle,
		components = { custom_visual_component.factory({ draw = draw_overlay }) } })
end

return presentation
