local fixed<const> = require('cartlib/fixed')
local icu<const> = require('cartlib/input/icu')

local editor<const> = {}
editor.__index = editor

local pointer_buttons<const>: *word = icu.pointer_buttons_address
local pointer_x_q16<const>: *word = icu.pointer_x_q16_address
local pointer_y_q16<const>: *word = icu.pointer_y_q16_address
local pointer_primary_mask<const> = 0x00000001

local point_in_bounds<const> = function(x, y, left, top, right, bottom)
	return x >= left and x < right and y >= top and y < bottom
end

function editor.new()
	return setmetatable({
		pointer_x = 0,
		pointer_y = 0,
		primary_down = false,
		previous_primary_down = false,
		selected_object = nil,
		selected_component = nil,
		hover_object = nil,
		hover_component = nil,
		translating = false,
		drag_offset_x = 0,
		drag_offset_y = 0,
	}, editor)
end

function editor:set_selection(obj, comp)
	self.selected_object = obj
	self.selected_component = comp
	if obj == nil then
		self.translating = false
	end
end

function editor:object_disposed(obj)
	if self.selected_object == obj then
		self:set_selection(nil, nil)
	end
	if self.hover_object == obj then
		self.hover_object = nil
		self.hover_component = nil
	end
end

function editor:component_detached(comp)
	if self.selected_component == comp then
		self.selected_component = nil
	end
	if self.hover_component == comp then
		self.hover_component = nil
	end
end

local pick_visual<const> = function(world, x, y)
	world:_rebuild_render_visuals()
	local visuals<const> = world._render_visuals
	for visual_index = world._render_visual_count, 1, -1 do
		local visual<const> = visuals[visual_index]
		local obj<const> = visual.parent
		if obj.visible and visual.visible then
			local left<const>, top<const>, right<const>, bottom<const> = visual:edit_bounds()
			if left ~= nil and point_in_bounds(
				x,
				y,
				obj.x + left,
				obj.y + top,
				obj.x + right,
				obj.y + bottom
			) then
				return obj, visual
			end
		end
	end
	return nil, nil
end

function editor:update(world)
	local pointer_x<const> = fixed.decode_s16_16(*pointer_x_q16)
	local pointer_y<const> = fixed.decode_s16_16(*pointer_y_q16)
	local primary_down<const> = (*pointer_buttons & pointer_primary_mask) ~= 0
	self.pointer_x = pointer_x
	self.pointer_y = pointer_y
	self.primary_down = primary_down
	local hover_object<const>, hover_component<const> = pick_visual(world, pointer_x, pointer_y)
	self.hover_object = hover_object
	self.hover_component = hover_component
	if primary_down then
		if not self.previous_primary_down then
			self:set_selection(hover_object, hover_component)
			if hover_object ~= nil then
				self.translating = true
				self.drag_offset_x = pointer_x - hover_object.x
				self.drag_offset_y = pointer_y - hover_object.y
			end
		elseif self.translating then
			self.selected_object:set_pos(
				pointer_x - self.drag_offset_x,
				pointer_y - self.drag_offset_y
			)
		end
	else
		self.translating = false
	end
	self.previous_primary_down = primary_down
end

return editor
