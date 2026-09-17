local progression<const> = require('cartlib/progression')
require('constants')

local room_spawner<const> = {}

-- Conditional admission consumes the immutable definition and the session
-- model. The live scene owns members and procedural children alike.
local spawn_member<const> = function(room, member)
	return room.scene:spawn_member(member, {
		castle = room.castle, room = room, player = room.player,
		room_number = room.room_number, item_id = member.member_id,
	})
end

local spawn_rocks<const> = function(room)
	for i = 1, #room.rocks do
		local member<const> = room.rocks[i]
		if not room.progress.destroyed_rocks[member.member_id] then
			spawn_member(room, member)
		end
	end
end

local spawn_static_members<const> = function(room, definitions, instances)
	for i = 1, #definitions do
		instances[i] = spawn_member(room, definitions[i])
	end
end

local spawn_world_entrances<const> = function(room)
	for i = 1, #room.world_entrances do
		local member<const> = room.world_entrances[i]
		local instance<const> = spawn_member(room, member)
		instance:set_entrance_state(room.castle.session.world_entrances[member.options.target].state)
		room.world_entrance_instances[i] = instance
	end
end

local sync_item<const> = function(room, def)
	local castle<const> = room.castle
	local player<const> = room.player
	local picked<const> = progression.get(castle, 'item_picked_' .. def.member_id)
	local matches_conditions<const> = progression.matches(castle, castle._scene_filters[def])
	local already_owned<const> = player.status.inventory_items[def.options.item_type]
	local should_spawn<const> = not picked and matches_conditions and not already_owned
	local existing<const> = room.scene.members[def.member_id]
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
		local defeated<const> = def.retain_defeat_in_region and progression.get(castle, def.member_id)
		local matches_conditions<const> = progression.matches(castle, castle._scene_filters[def])
		local should_spawn<const> = not defeated and matches_conditions
		if should_spawn then
			local instance<const> = spawn_member(room, def)
			if def.blocks_room_collision then
				wall_count = wall_count + 1
				walls[wall_count] = instance
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
			local wall<const> = room.scene.members[def.member_id]
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
		if def.member_id ~= source_id then
			local existing<const> = room.scene.members[def.member_id]
			local defeated<const> = def.retain_defeat_in_region and progression.get(castle, def.member_id)
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
		if room.progress.destroyed_rocks[def.member_id] then
			local item_id<const> = 'drop.' .. def.member_id
			local picked<const> = progression.get(castle, 'item_picked_' .. item_id)
			local already_owned<const> = player.status.inventory_items[item_type]
			if not picked and not already_owned then
				room.scene:spawn('world_item', {
					space_id = 'main',
					room = room,
					player = player,
					pos = { x = def.options.pos.x, y = def.options.pos.y + world_item_drop_offset_y[item_type], z = 130 },
					item_id = item_id,
					item_type = item_type,
				}, item_id)
			end
		end
	end
end

local spawn_rock_drops<const> = function(room)
	for id, drop in pairs(room.castle.session.region_drops) do
		if drop.scene_id == room.scene_id then
			room.scene:spawn('world_item', {
				space_id = 'main',
				room = room,
				player = room.player,
				pos = { x = drop.x, y = drop.y, z = 130 },
				item_id = id,
				item_type = drop.item_type,
				rock_drop_id = id,
			}, id)
		end
	end
end

function room_spawner.populate(room)
	spawn_rocks(room)
	spawn_destroyed_rock_inventory_items(room)
	spawn_rock_drops(room)
	spawn_static_members(room, room.lithographs, room.lithograph_instances)
	spawn_static_members(room, room.shrines, room.shrine_instances)
	spawn_static_members(room, room.draaideuren, room.draaideur_instances)
	spawn_world_entrances(room)
	spawn_items(room)
	spawn_enemies(room)
end

return room_spawner
