local base_component<const> = require('cartlib/component/base_component')
local affine2<const> = require('cartlib/math/affine2')
local spatial_hierarchy<const> = require('cartlib/world/spatial_hierarchy')

-- Synchronous axis-aligned movement for objects whose collision world is a
-- tile grid. The component owns the updated object, its collision bounds and
-- the retained contact word. Movement sweeps only newly crossed tile rows or
-- columns; valid starting placement remains the producer's responsibility.
-- This is the small BMSX equivalent of UE's MovementComponent boundary:
-- gameplay requests a move and consumes the physical result immediately.

local kinematic_movement_component<const> = {}
kinematic_movement_component.__index = kinematic_movement_component
kinematic_movement_component.unique = true
setmetatable(kinematic_movement_component, { __index = base_component })

local contact_left<const> = 0x01
local contact_right<const> = 0x02
local contact_up<const> = 0x04
local contact_down<const> = 0x08

kinematic_movement_component.contact_left = contact_left
kinematic_movement_component.contact_right = contact_right
kinematic_movement_component.contact_up = contact_up
kinematic_movement_component.contact_down = contact_down

local sweep_x<const> = function(self, collision_world, start_x, start_y, delta_x)
	if delta_x == 0 then
		return start_x, 0
	end

	local target_x = start_x + delta_x
	local contact = 0
	local local_left<const> = self.local_left
	local local_right<const> = self.local_right
	local tile_size<const> = collision_world.tile_size
	local tile_origin_x<const> = collision_world.tile_origin_x
	local tile_origin_y<const> = collision_world.tile_origin_y
	local collision_flags_at_tile<const> = collision_world.collision_flags_at_tile
	local collision_mask<const> = self.collision_mask
	local include_elevators<const> = self.include_elevators
	local first_tile_y<const> = ((start_y + self.local_top - tile_origin_y) // tile_size) + 1
	local last_tile_y<const> = ((start_y + self.local_bottom - 1 - tile_origin_y) // tile_size) + 1

	if delta_x > 0 then
		local maximum_x<const> = self.world_right - local_right
		if target_x > maximum_x then
			target_x = maximum_x
			contact = contact_right
		end
		local first_tile_x<const> = ((start_x + local_right - 1 - tile_origin_x) // tile_size) + 2
		local last_tile_x<const> = ((target_x + local_right - 1 - tile_origin_x) // tile_size) + 1
		for tile_x = first_tile_x, last_tile_x do
			for tile_y = first_tile_y, last_tile_y do
				if (collision_flags_at_tile(collision_world, tile_x, tile_y, include_elevators)
					& collision_mask) ~= 0 then
					return tile_origin_x + ((tile_x - 1) * tile_size) - local_right, contact_right
				end
			end
		end
	else
		local minimum_x<const> = self.world_left - local_left
		if target_x < minimum_x then
			target_x = minimum_x
			contact = contact_left
		end
		local first_tile_x<const> = ((start_x + local_left - tile_origin_x) // tile_size)
		local last_tile_x<const> = ((target_x + local_left - tile_origin_x) // tile_size) + 1
		for tile_x = first_tile_x, last_tile_x, -1 do
			for tile_y = first_tile_y, last_tile_y do
				if (collision_flags_at_tile(collision_world, tile_x, tile_y, include_elevators)
					& collision_mask) ~= 0 then
					return tile_origin_x + (tile_x * tile_size) - local_left, contact_left
				end
			end
		end
	end

	return target_x, contact
end

local sweep_y<const> = function(self, collision_world, start_x, start_y, delta_y)
	if delta_y == 0 then
		return start_y, 0
	end

	local target_y = start_y + delta_y
	local contact = 0
	local local_top<const> = self.local_top
	local local_bottom<const> = self.local_bottom
	local tile_size<const> = collision_world.tile_size
	local tile_origin_x<const> = collision_world.tile_origin_x
	local tile_origin_y<const> = collision_world.tile_origin_y
	local collision_flags_at_tile<const> = collision_world.collision_flags_at_tile
	local collision_mask<const> = self.collision_mask
	local include_elevators<const> = self.include_elevators
	local first_tile_x<const> = ((start_x + self.local_left - tile_origin_x) // tile_size) + 1
	local last_tile_x<const> = ((start_x + self.local_right - 1 - tile_origin_x) // tile_size) + 1

	if delta_y > 0 then
		local maximum_y<const> = self.world_bottom - local_bottom
		if target_y > maximum_y then
			target_y = maximum_y
			contact = contact_down
		end
		local first_tile_y<const> = ((start_y + local_bottom - 1 - tile_origin_y) // tile_size) + 2
		local last_tile_y<const> = ((target_y + local_bottom - 1 - tile_origin_y) // tile_size) + 1
		for tile_y = first_tile_y, last_tile_y do
			for tile_x = first_tile_x, last_tile_x do
				if (collision_flags_at_tile(collision_world, tile_x, tile_y, include_elevators)
					& collision_mask) ~= 0 then
					return tile_origin_y + ((tile_y - 1) * tile_size) - local_bottom, contact_down
				end
			end
		end
	else
		local minimum_y<const> = self.world_top - local_top
		if target_y < minimum_y then
			target_y = minimum_y
			contact = contact_up
		end
		local first_tile_y<const> = ((start_y + local_top - tile_origin_y) // tile_size)
		local last_tile_y<const> = ((target_y + local_top - tile_origin_y) // tile_size) + 1
		for tile_y = first_tile_y, last_tile_y, -1 do
			for tile_x = first_tile_x, last_tile_x do
				if (collision_flags_at_tile(collision_world, tile_x, tile_y, include_elevators)
					& collision_mask) ~= 0 then
					return tile_origin_y + (tile_y * tile_size) - local_top, contact_up
				end
			end
		end
	end

	return target_y, contact
end

function kinematic_movement_component.new(context, profile)
	local self<const> = setmetatable(base_component.new(context), kinematic_movement_component)
	self.id_local = profile.id_local
	if self.id_local == nil then self.id_local = 'movement' end
	self.local_left = profile.local_left
	self.local_top = profile.local_top
	self.local_right = profile.local_right
	self.local_bottom = profile.local_bottom
	self.world_left = profile.world_left
	self.world_top = profile.world_top
	self.world_right = profile.world_right
	self.world_bottom = profile.world_bottom
	self.collision_mask = profile.collision_mask
	self.include_elevators = profile.include_elevators
	local initial<const> = context.initial[self.id_local]
	if initial ~= nil then
		if initial.local_left ~= nil then self.local_left = initial.local_left end
		if initial.local_top ~= nil then self.local_top = initial.local_top end
		if initial.local_right ~= nil then self.local_right = initial.local_right end
		if initial.local_bottom ~= nil then self.local_bottom = initial.local_bottom end
		if initial.world_left ~= nil then self.world_left = initial.world_left end
		if initial.world_top ~= nil then self.world_top = initial.world_top end
		if initial.world_right ~= nil then self.world_right = initial.world_right end
		if initial.world_bottom ~= nil then self.world_bottom = initial.world_bottom end
		if initial.collision_mask ~= nil then self.collision_mask = initial.collision_mask end
		if initial.include_elevators ~= nil then self.include_elevators = initial.include_elevators end
		self.collision_world = initial.collision_world
	end
	self.contacts = 0
	return self
end

function kinematic_movement_component:on_attach()
	local spatial<const> = self.owner.spatial
	if spatial == nil or spatial._family ~= affine2 or not spatial._origin_only then
		error('tile kinematic movement requires root_origin Transform2D')
	end
	self.spatial = spatial
	self._write_world_origin = spatial.set_world_origin
end

function kinematic_movement_component:on_detach()
	self.spatial = nil
	self._write_world_origin = nil
end

function kinematic_movement_component.factory(profile)
	return function(opts)
		return kinematic_movement_component.new(opts, profile)
	end
end

function kinematic_movement_component:set_local_bounds(left, top, right, bottom)
	self.local_left = left
	self.local_top = top
	self.local_right = right
	self.local_bottom = bottom
end

-- UE MovementComponent binds its UpdatedComponent once and reaches collision
-- through that component's World. Here owner is already the updated object;
-- cart composition binds its tile collision world once, before steady movement.
function kinematic_movement_component:set_collision_world(collision_world)
	self.collision_world = collision_world
end

-- Evaluate an explicit candidate without publishing a pose or contact latch.
-- Scripted axes may supply a new start coordinate and a zero sweep on that axis.
function kinematic_movement_component:test_motion(start_x, start_y, delta_x, delta_y)
	local collision_world<const> = self.collision_world
	local x<const>, horizontal<const> = sweep_x(self, collision_world, start_x, start_y, delta_x)
	local y<const>, vertical<const> = sweep_y(self, collision_world, x, start_y, delta_y)
	return x, y, horizontal | vertical
end

function kinematic_movement_component:move_x(delta_x)
	local collision_world<const> = self.collision_world
	local spatial<const> = self.spatial
	if spatial._flags ~= 0 then
		spatial_hierarchy.resolve(spatial)
	end
	local start_x<const>, start_y<const> = spatial.wox, spatial.woy
	local x<const>, contacts<const> = sweep_x(self, collision_world, start_x, start_y, delta_x)
	if x ~= start_x then
		self._write_world_origin(spatial, x, start_y)
	end
	self.contacts = contacts
	return contacts
end

function kinematic_movement_component:move_y(delta_y)
	local collision_world<const> = self.collision_world
	local spatial<const> = self.spatial
	if spatial._flags ~= 0 then
		spatial_hierarchy.resolve(spatial)
	end
	local start_x<const>, start_y<const> = spatial.wox, spatial.woy
	local y<const>, contacts<const> = sweep_y(self, collision_world, start_x, start_y, delta_y)
	if y ~= start_y then
		self._write_world_origin(spatial, start_x, y)
	end
	self.contacts = contacts
	return contacts
end

function kinematic_movement_component:move(delta_x, delta_y)
	local collision_world<const> = self.collision_world
	local spatial<const> = self.spatial
	if spatial._flags ~= 0 then
		spatial_hierarchy.resolve(spatial)
	end
	local start_x<const>, start_y<const> = spatial.wox, spatial.woy
	local x<const>, horizontal_contacts<const> = sweep_x(self, collision_world, start_x, start_y, delta_x)
	local y<const>, vertical_contacts<const> = sweep_y(self, collision_world, x, start_y, delta_y)
	if x ~= start_x or y ~= start_y then
		self._write_world_origin(spatial, x, y)
	end
	local contacts<const> = horizontal_contacts | vertical_contacts
	self.contacts = contacts
	return contacts
end

function kinematic_movement_component:has_support_ahead(direction_x, ahead, below)
	local collision_world<const> = self.collision_world
	local spatial<const> = self.spatial
	if spatial._flags ~= 0 then
		spatial_hierarchy.resolve(spatial)
	end
	local world_x
	if direction_x < 0 then
		world_x = spatial.wox + self.local_left - ahead
	else
		world_x = spatial.wox + self.local_right + ahead
	end
	local tile_size<const> = collision_world.tile_size
	local tile_x<const> = ((world_x - collision_world.tile_origin_x) // tile_size) + 1
	local tile_y<const> = ((spatial.woy + self.local_bottom + below - collision_world.tile_origin_y)
		// tile_size) + 1
	local flags<const> = collision_world.collision_flags_at_tile(
		collision_world,
		tile_x,
		tile_y,
		self.include_elevators
	)
	return (flags & self.collision_mask) ~= 0
end

return kinematic_movement_component
