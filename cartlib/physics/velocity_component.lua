local base_component<const> = require('cartlib/component/base_component')
local clock<const> = require('cartlib/clock')
local affine2<const> = require('cartlib/math/affine2')
local velocity<const> = require('cartlib/velocity')
local spatial_hierarchy<const> = require('cartlib/world/spatial_hierarchy')

local velocity_component<const> = {}
velocity_component.__index = velocity_component
velocity_component.unique = true
velocity_component._tick_clocks = clock.gameplay
setmetatable(velocity_component, { __index = base_component })

function velocity_component.new(context, id_local)
	local self<const> = setmetatable(base_component.new(context), velocity_component)
	if id_local == nil then id_local = 'velocity' end
	self.id_local = id_local
	self.speed_x_num = 0
	self.speed_y_num = 0
	self.speed_den = 1
	self.speed_accum_x = 0
	self.speed_accum_y = 0
	local initial<const> = context.initial[self.id_local]
	if initial ~= nil then
		if initial.speed_x_num ~= nil then self.speed_x_num = initial.speed_x_num end
		if initial.speed_y_num ~= nil then self.speed_y_num = initial.speed_y_num end
		if initial.speed_den ~= nil then self.speed_den = initial.speed_den end
		if initial.speed_accum_x ~= nil then self.speed_accum_x = initial.speed_accum_x end
		if initial.speed_accum_y ~= nil then self.speed_accum_y = initial.speed_accum_y end
	end
	self.motion_committed = true
	return self
end

function velocity_component:on_attach()
	local spatial<const> = self.owner.spatial
	if spatial == nil or spatial._family ~= affine2 then
		error('velocity component requires Transform2D')
	end
	self.spatial = spatial
	self._write_world_origin = spatial.set_world_origin
end

function velocity_component:on_detach()
	self.spatial = nil
	self._write_world_origin = nil
end

-- A singular committed parent can reject the world-space request. That is
-- not a collision and does not consume the candidate integration remainder.
function velocity_component:move()
	local speed_den<const> = self.speed_den
	local dx, dy, next_accum_x, next_accum_y
	if speed_den == 1 then
		dx = self.speed_accum_x + self.speed_x_num
		dy = self.speed_accum_y + self.speed_y_num
		next_accum_x = 0
		next_accum_y = 0
	else
		dx, next_accum_x = velocity.consume_axis_accum(self.speed_accum_x, self.speed_x_num, speed_den)
		dy, next_accum_y = velocity.consume_axis_accum(self.speed_accum_y, self.speed_y_num, speed_den)
	end
	if dx ~= 0 or dy ~= 0 then
		local spatial<const> = self.spatial
		if spatial._flags ~= 0 then
			spatial_hierarchy.resolve(spatial)
		end
		local committed<const> = self._write_world_origin(spatial, spatial.wox + dx, spatial.woy + dy)
		self.motion_committed = committed
		if not committed then
			return false
		end
	else
		self.motion_committed = true
	end
	self.speed_accum_x = next_accum_x
	self.speed_accum_y = next_accum_y
	return true
end

return velocity_component
