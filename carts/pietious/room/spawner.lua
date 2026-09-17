local world<const> = require('cartlib/world/world')
local progression<const> = require('cartlib/progression')
local registry<const> = require('cartlib/registry')
local shallow_copy<const> = require('cartlib/util/shallow_copy')
require('constants')

local room_spawner<const> = {}

function room_spawner.mark_all_for_disposal()
	local room_objects<const> = registry:entries('rs')
	for i = #room_objects, 1, -1 do
		room_objects[i]:mark_for_disposal()
	end
end

-- Admission is conditional in this cart. Bind the persistent room actors
-- before World activates the prefab, keeping the authored options immutable.
local spawn_member<const> = function(room, member)
	local options<const> = shallow_copy(member.options)
	options.castle = room.castle
	options.room = room
	options.player = room.player
	options.room_number = room.room_number
	options.rs_room_number = room.room_number
	local object<const> = world:spawn(member.definition_id, options)
	object:add_tag('rs')
	return object
end

local spawn_rocks<const> = function(room)
	for i = 1, #room.rocks do
		local def<const> = room.rocks[i]
		local existing<const> = registry:get(def.options.id)
		if not room.destroyed_rock_ids[def.options.id] then
			if existing == nil then
				spawn_member(room, def)
			end
		end
	end
end

local spawn_lithographs<const> = function(room)
	local instances<const> = room.lithograph_instances
	local instance_count = 0
	for i = 1, #room.lithographs do
		local def<const> = room.lithographs[i]
		local existing = registry:get(def.options.id)
		if existing == nil then
			existing = spawn_member(room, def)
		end
		instance_count = instance_count + 1
		instances[instance_count] = existing
	end
	for i = instance_count + 1, #instances do
		instances[i] = nil
	end
end

local spawn_shrines<const> = function(room)
	local instances<const> = room.shrine_instances
	for i = 1, #room.shrines do
		local def<const> = room.shrines[i]
		local existing = registry:get(def.options.id)
		if existing == nil then
			existing = spawn_member(room, def)
		end
		instances[i] = existing
	end
	for i = #room.shrines + 1, #instances do instances[i] = nil end
end

local spawn_draaideuren<const> = function(room)
	local instances<const> = room.draaideur_instances
	local instance_count = 0
	for i = 1, #room.draaideuren do
		local def<const> = room.draaideuren[i]
		local existing = registry:get(def.options.id)
		if existing == nil then
			existing = spawn_member(room, def)
		end
		instance_count = instance_count + 1
		instances[instance_count] = existing
	end
	for i = instance_count + 1, #instances do
		instances[i] = nil
	end
end

local spawn_world_entrances<const> = function(room)
	local castle<const> = room.castle
	local instances<const> = room.world_entrance_instances
	for i = 1, #room.world_entrances do
		local def<const> = room.world_entrances[i]
		local existing = registry:get(def.options.id)
		if existing == nil then
			existing = spawn_member(room, def)
			existing:set_entrance_state(castle.world_entrance_states[def.options.target].state)
		end
		instances[i] = existing
	end
	for i = #room.world_entrances + 1, #instances do instances[i] = nil end
end

local sync_item<const> = function(room, def)
	local castle<const> = room.castle
	local player<const> = room.player
	local picked<const> = progression.get(castle, 'item_picked_' .. def.options.id)
	local matches_conditions<const> = progression.matches(castle, castle._scene_filters[def])
	local already_owned<const> = player.inventory_items[def.options.item_type]
	local should_spawn<const> = not picked and matches_conditions and not already_owned
	local existing<const> = registry:get(def.options.id)
	if should_spawn then
		if existing == nil then
			spawn_member(room, def)
			return true
		end
	elseif existing ~= nil then
		existing:mark_for_disposal()
	end
end

local spawn_items<const> = function(room)
	local items<const> = room.items
	for i = 1, #items do
		sync_item(room, items[i])
	end
end

local spawn_enemies<const> = function(room)
	local castle<const> = room.castle
	local walls<const> = room.wall_instances
	local wall_count = 0
	for i = 1, #room.enemies do
		local def<const> = room.enemies[i]
		local defeated<const> = def.retain_defeat_in_region and progression.get(castle, def.options.id)
		local matches_conditions<const> = progression.matches(castle, castle._scene_filters[def])
		local should_spawn<const> = not defeated and matches_conditions
		local existing = registry:get(def.options.id)
		if should_spawn then
			if existing == nil then
				existing = spawn_member(room, def)
			end
			if def.blocks_room_collision then
				wall_count = wall_count + 1
				walls[wall_count] = existing
			end
		else
			if existing ~= nil then
				existing:mark_for_disposal()
			end
		end
	end
	for i = wall_count + 1, #walls do
		walls[i] = nil
	end
end

local rebuild_wall_instances<const> = function(room)
	local walls<const> = room.wall_instances
	local wall_defs<const> = room.wall_enemies
	local wall_count = 0
	for i = 1, #wall_defs do
		local def<const> = wall_defs[i]
		if progression.matches(room.castle, room.castle._scene_filters[def]) then
			local wall<const> = registry:get(def.options.id)
			if wall ~= nil then
				wall_count = wall_count + 1
				walls[wall_count] = wall
			end
		end
	end
	for i = wall_count + 1, #walls do
		walls[i] = nil
	end
end

function room_spawner.reconcile_condition(room, condition, source_id)
	local castle<const> = room.castle
	local dependency<const> = room.condition_dependencies[condition]
	local enemies<const> = dependency.enemies
	for i = 1, #enemies do
		local def<const> = enemies[i]
		if def.options.id ~= source_id then
			local existing<const> = registry:get(def.options.id)
			local defeated<const> = def.retain_defeat_in_region and progression.get(castle, def.options.id)
			local should_spawn<const> = not defeated and progression.matches(castle, castle._scene_filters[def])
			if should_spawn then
				if existing == nil then
					spawn_member(room, def)
				end
			elseif existing ~= nil then
				existing:mark_for_disposal()
			end
		end
	end
	local items<const> = dependency.items
	for i = 1, #items do
		local def<const> = items[i]
		if sync_item(room, def) and def.reveal_event ~= nil then
			castle.events:emit(def.reveal_event)
		end
	end
	if dependency.affects_walls then
		rebuild_wall_instances(room)
	end
end

local spawn_destroyed_rock_inventory_items<const> = function(room)
	local castle<const> = room.castle
	local player<const> = room.player
	for i = 1, #room.inventory_rocks do
		local def<const> = room.inventory_rocks[i]
		local item_type<const> = def.options.item_type
		if room.destroyed_rock_ids[def.options.id] then
			local item_id<const> = 'drop.' .. def.options.id
			local picked<const> = progression.get(castle, 'item_picked_' .. item_id)
			local already_owned<const> = player.inventory_items[item_type]
			if not picked and not already_owned and registry:get(item_id) == nil then
				local obj<const> = world:spawn('world_item', {
					id = item_id,
					space_id = 'main',
					room = room,
					player = player,
					pos = { x = def.options.pos.x, y = def.options.pos.y + world_item_drop_offset_y[item_type], z = 130 },
					item_id = item_id,
					item_type = item_type,
					rs_room_number = room.room_number,
				})
				obj:add_tag('rs')
			end
		end
	end
end

local spawn_rock_drops<const> = function(room)
	for id, drop in pairs(room.rock_drops) do
		if drop.room_number == room.room_number and registry:get(id) == nil then
			local obj<const> = world:spawn('world_item', {
				id = id,
				space_id = 'main',
				room = room,
				player = room.player,
				pos = { x = drop.x, y = drop.y, z = 130 },
				item_id = id,
				item_type = drop.item_type,
				rock_drop_id = id,
				rs_room_number = room.room_number,
			})
			obj:add_tag('rs')
		end
	end
end

function room_spawner.spawn_all_for_room(room)
	local room_objects<const> = registry:entries('rs')
	for i = #room_objects, 1, -1 do
		local obj<const> = room_objects[i]
		if obj.rs_room_number ~= room.room_number then
			obj:mark_for_disposal()
		end
	end
	spawn_rocks(room)
	spawn_destroyed_rock_inventory_items(room)
	spawn_rock_drops(room)
	spawn_lithographs(room)
	spawn_shrines(room)
	spawn_draaideuren(room)
	spawn_world_entrances(room)
	spawn_items(room)
	spawn_enemies(room)
end

return room_spawner
