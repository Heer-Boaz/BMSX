-- tile_collision.lua
-- Tile-collision ECS system.

local tile_collision_component<const> = require('cartlib/collision/tile_collision_component')
local system<const> = require('cartlib/world/system')
local tick_group<const> = require('cartlib/world/tick_group')


local clear_map<const> = require('cartlib/util/clear_map')

local tile_collision_component_type<const> = tile_collision_component.type_name

local tile_collision_system<const> = {}
tile_collision_system.__index = tile_collision_system
setmetatable(tile_collision_system, { __index = system })

local emit_tilecollision_event<const> = function(owner, component, event_type, phase, collision_key, payload)
	payload.phase = phase
	payload.component_id = component.id
	payload.component_local_id = component.id_local
	payload.collision_key = collision_key
	owner.events:emit(event_type, payload)
end

function tile_collision_system.new(world)
	local self<const> = setmetatable(system.new(tick_group.physics, 45), tile_collision_system)
	self.components = world:_active_component_view(tile_collision_component_type)
	return self
end

function tile_collision_system:update()
	local components<const> = self.components.items
	for i = #components, 1, -1 do
		local component<const> = components[i]
		local obj<const> = component.parent
		local current_payload<const> = component.current_payload
		local previous_payload<const> = component.previous_payload
		clear_map(current_payload)
		local current_key<const> = component.query(component, obj, current_payload)
		local previous_key<const> = component.previous_collision_key
		if current_key == nil then
			if previous_key ~= nil then
				emit_tilecollision_event(obj, component, component.end_event_type, 'end', previous_key, previous_payload)
				component.previous_collision_key = nil
			end
		else
			if previous_key == nil then
				emit_tilecollision_event(obj, component, component.begin_event_type, 'begin', current_key, current_payload)
			elseif previous_key ~= current_key then
				emit_tilecollision_event(obj, component, component.end_event_type, 'end', previous_key, previous_payload)
				emit_tilecollision_event(obj, component, component.begin_event_type, 'begin', current_key, current_payload)
			else
				emit_tilecollision_event(obj, component, component.stay_event_type, 'stay', current_key, current_payload)
			end
			component.previous_payload = current_payload
			component.current_payload = previous_payload
			component.previous_collision_key = current_key
		end
	end
end

return tile_collision_system
