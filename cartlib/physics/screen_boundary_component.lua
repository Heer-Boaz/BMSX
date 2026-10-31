local base_component<const> = require('cartlib/component/base_component')
local affine2<const> = require('cartlib/math/affine2')
local spatial_hierarchy<const> = require('cartlib/world/spatial_hierarchy')

local screen_boundary_component<const> = {}
local empty_definition<const> = {}
screen_boundary_component.__index = screen_boundary_component
screen_boundary_component.unique = true
setmetatable(screen_boundary_component, { __index = base_component })

function screen_boundary_component.new(owner, definition)
	if definition == nil then definition = empty_definition end
	local self<const> = setmetatable(base_component.new(owner, definition), screen_boundary_component)
	self.id_local = definition.id_local
	if self.id_local == nil then self.id_local = 'boundary' end
	self.old_x = 0
	self.old_y = 0
	self.left = definition.left
	self.top = definition.top
	self.right = definition.right
	self.bottom = definition.bottom
	self.local_left = definition.local_left
	self.local_top = definition.local_top
	self.local_right = definition.local_right
	self.local_bottom = definition.local_bottom
	self._footprint_basis_revision = -1
	self.correction_committed = true
	return self
end

function screen_boundary_component.factory(definition)
	return function(owner)
		return screen_boundary_component.new(owner, definition)
	end
end

function screen_boundary_component:on_attach()
	local spatial<const> = self.owner.spatial
	if spatial == nil or spatial._family ~= affine2 then
		error('screen boundary component requires Transform2D')
	end
	self.spatial = spatial
	self._write_world_origin = spatial.set_world_origin
end

function screen_boundary_component:on_detach()
	self.spatial = nil
	self._write_world_origin = nil
end

function screen_boundary_component:set_local_bounds(left, top, right, bottom)
	self.local_left = left
	self.local_top = top
	self.local_right = right
	self.local_bottom = bottom
	self._footprint_basis_revision = -1
end

-- The physical rectangle is explicit geometry, not a visual-size fallback.
-- Translation consumes only the current origin; changed basis/source inputs
-- rebuild the four retained world-axis offsets once at this consumer boundary.
function screen_boundary_component:resolve_footprint()
	local spatial<const> = self.spatial
	if spatial._flags ~= 0 then
		spatial_hierarchy.resolve(spatial)
	end
	local revision<const> = spatial._basis_revision
	if self._footprint_basis_revision ~= revision then
		self._footprint_left, self._footprint_top, self._footprint_right, self._footprint_bottom = affine2.basis_bounds(
			spatial.wxx, spatial.wxy, spatial.wyx, spatial.wyy,
			self.local_left, self.local_top, self.local_right, self.local_bottom
		)
		self._footprint_basis_revision = revision
	end
	return spatial
end

function screen_boundary_component:resolve_leaving(_direction, _previous_position, _x, _y)
	return true
end

return screen_boundary_component
