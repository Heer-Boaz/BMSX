local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local prefab<const> = require('cartlib/world/prefab')

local curtain<const> = { definition_id = 'nemesis_s.presentation.curtain' }

local draw_blinds<const> = function(component, draw)
	local owner<const> = component.parent
	local x<const> = owner.x + component.offset_x
	local y<const> = owner.y + component.offset_y
	if owner.count == 8 then
		draw:rect(x, y, x + owner.sx, y + owner.sy, 0xff000000)
		return
	end
	for row = 0, owner.sy - 1, 8 do
		draw:rect(x, y + row, x + owner.sx, y + row + owner.count, 0xff000000)
	end
end

local draw_window<const> = function(component, draw)
	local owner<const> = component.parent
	local x<const> = owner.x + component.offset_x
	local y<const> = owner.y + component.offset_y
	draw:rect(x, y, x + owner.sx, y + owner.opening_end, 0xff000000)
	draw:rect(x, y + owner.opening_start, x + owner.sx, y + owner.opening_bottom, 0xff000000)
end

-- Choose the draw producer only when the sequence changes mode.
function curtain:set_mode(mode)
	if mode == 0 then
		self.visual:set_draw_function(nil)
	elseif mode == 1 then
		self.visual:set_draw_function(draw_blinds)
	else
		self.visual:set_draw_function(draw_window)
	end
end

function curtain:ctor()
	self.visual = self:get_component(custom_visual_component, 'curtain')
	self:set_mode(self.mode)
end

function curtain.register()
	prefab.define({
		def_id = curtain.definition_id,
		class = curtain,
		components = { custom_visual_component.factory({ id_local = 'curtain' }) },
		defaults = { mode = 0, count = 0 },
	})
end

return curtain
