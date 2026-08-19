local base_component<const> = require('cartlib/component/base_component')

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

local sweep_x<const> = function(self, collision_world, delta_x)
	if delta_x == 0 then
		return 0
	end

	local parent<const> = self.parent
	local start_x<const> = parent.x
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
	local first_tile_y<const> = ((parent.y + self.local_top - tile_origin_y) // tile_size) + 1
	local last_tile_y<const> = ((parent.y + self.local_bottom - 1 - tile_origin_y) // tile_size) + 1

	if delta_x > 0 then
		local maximum_x<const> = self.world_right - parent.sx
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
					parent.x = tile_origin_x + ((tile_x - 1) * tile_size) - local_right
					return contact_right
				end
			end
		end
	else
		if target_x < self.world_left then
			target_x = self.world_left
			contact = contact_left
		end
		local first_tile_x<const> = ((start_x + local_left - tile_origin_x) // tile_size)
		local last_tile_x<const> = ((target_x + local_left - tile_origin_x) // tile_size) + 1
		for tile_x = first_tile_x, last_tile_x, -1 do
			for tile_y = first_tile_y, last_tile_y do
				if (collision_flags_at_tile(collision_world, tile_x, tile_y, include_elevators)
					& collision_mask) ~= 0 then
					parent.x = tile_origin_x + (tile_x * tile_size) - local_left
					return contact_left
				end
			end
		end
	end

	parent.x = target_x
	return contact
end

local sweep_y<const> = function(self, collision_world, delta_y)
	if delta_y == 0 then
		return 0
	end

	local parent<const> = self.parent
	local start_y<const> = parent.y
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
	local first_tile_x<const> = ((parent.x + self.local_left - tile_origin_x) // tile_size) + 1
	local last_tile_x<const> = ((parent.x + self.local_right - 1 - tile_origin_x) // tile_size) + 1

	if delta_y > 0 then
		local maximum_y<const> = self.world_bottom - parent.sy
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
					parent.y = tile_origin_y + ((tile_y - 1) * tile_size) - local_bottom
					return contact_down
				end
			end
		end
	else
		if target_y < self.world_top then
			target_y = self.world_top
			contact = contact_up
		end
		local first_tile_y<const> = ((start_y + local_top - tile_origin_y) // tile_size)
		local last_tile_y<const> = ((target_y + local_top - tile_origin_y) // tile_size) + 1
		for tile_y = first_tile_y, last_tile_y, -1 do
			for tile_x = first_tile_x, last_tile_x do
				if (collision_flags_at_tile(collision_world, tile_x, tile_y, include_elevators)
					& collision_mask) ~= 0 then
					parent.y = tile_origin_y + (tile_y * tile_size) - local_top
					return contact_up
				end
			end
		end
	end

	parent.y = target_y
	return contact
end

function kinematic_movement_component.new(opts, profile)
	local self<const> = setmetatable(base_component.new(opts), kinematic_movement_component)
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
	self.contacts = 0
	return self
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
-- through that component's World. Here parent is already the updated object;
-- cart composition binds its tile collision world once, before steady movement.
function kinematic_movement_component:set_collision_world(collision_world)
	self.collision_world = collision_world
end

function kinematic_movement_component:move_x(delta_x)
	local collision_world<const> = self.collision_world
	local contacts<const> = sweep_x(self, collision_world, delta_x)
	self.contacts = contacts
	return contacts
end

function kinematic_movement_component:move_y(delta_y)
	local collision_world<const> = self.collision_world
	local contacts<const> = sweep_y(self, collision_world, delta_y)
	self.contacts = contacts
	return contacts
end

function kinematic_movement_component:move(delta_x, delta_y)
	local collision_world<const> = self.collision_world
	local contacts<const> = sweep_x(self, collision_world, delta_x)
		| sweep_y(self, collision_world, delta_y)
	self.contacts = contacts
	return contacts
end

function kinematic_movement_component:has_support_ahead(direction_x, ahead, below)
	local collision_world<const> = self.collision_world
	local parent<const> = self.parent
	local world_x
	if direction_x < 0 then
		world_x = parent.x + self.local_left - ahead
	else
		world_x = parent.x + self.local_right + ahead
	end
	local tile_size<const> = collision_world.tile_size
	local tile_x<const> = ((world_x - collision_world.tile_origin_x) // tile_size) + 1
	local tile_y<const> = ((parent.y + self.local_bottom + below - collision_world.tile_origin_y)
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
