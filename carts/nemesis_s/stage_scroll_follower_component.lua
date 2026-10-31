local base_component<const> = require('cartlib/component/base_component')

local stage_scroll_follower_component<const> = {}
stage_scroll_follower_component.__index = stage_scroll_follower_component
setmetatable(stage_scroll_follower_component, { __index = base_component })

function stage_scroll_follower_component.new(owner)
	return setmetatable(base_component.new(owner), stage_scroll_follower_component)
end

function stage_scroll_follower_component:on_attach()
	local spatial<const> = self.owner.spatial
	self.spatial = spatial
	self._write_world_origin = spatial.set_world_origin
	self.owner.stage_scroll_follower = self
end

function stage_scroll_follower_component:on_detach()
	self.spatial = nil
	self._write_world_origin = nil
	if self.owner.stage_scroll_follower == self then
		self.owner.stage_scroll_follower = nil
	end
end

return stage_scroll_follower_component
