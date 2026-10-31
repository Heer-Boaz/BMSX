local base_component<const> = require('cartlib/component/base_component')

local visual_component<const> = {}
visual_component.__index = visual_component
visual_component.is_visual = true
setmetatable(visual_component, { __index = base_component })

local empty_input<const> = {}

-- Configuration belongs to this visual. Admission consumes the borrowed
-- values directly; the component retains its own scalar state.
function visual_component.new(owner, configuration, id_local, defaults)
	local self<const>, input<const> = base_component.new(owner, configuration)
	setmetatable(self, visual_component)
	local definition<const> = defaults or empty_input
	self.id_local = id_local
	local enabled = input.enabled
	if enabled == nil then enabled = definition.enabled end
	self.enabled = enabled == nil or enabled
	local visible = input.visible
	if visible == nil then visible = definition.visible end
	self.visible = visible == nil or visible
	local order = input.order
	if order == nil then order = definition.order end
	self.order = order or 0
	local presentation_order = input.presentation_order
	if presentation_order == nil then presentation_order = definition.presentation_order end
	self.presentation_order = presentation_order or 0
	self.draw = nil
	return self, input
end

-- Visual producers publish their retained draw datapath directly. A nil
-- datapath means that the attached component has no current render work; it
-- remains enabled and queryable but does not enter the space's visual view.
function visual_component:set_draw_function(draw_function)
	if self.draw == draw_function then
		return self
	end
	self.draw = draw_function
	if self._active_space ~= nil then
		self.owner.world:reconcile_component(self)
	end
	return self
end

function visual_component:set_order(order)
	if self.order == order then return self end
	self.order = order
	if self._active_visual_index ~= nil
	and self._active_space == self.owner.world._active_space then
		self.owner.world:visual_order_changed()
	end
	return self
end

function visual_component:set_presentation_order(order)
	if self.presentation_order == order then return self end
	self.presentation_order = order
	if self._active_visual_index ~= nil
	and self._active_space == self.owner.world._active_space then
		self.owner.world:visual_order_changed()
	end
	return self
end

visual_component.timeline_channels = {
	protected = { order = true, presentation_order = true },
	properties = {
		order = visual_component.set_order,
		presentation_order = visual_component.set_presentation_order,
	},
}

return visual_component
