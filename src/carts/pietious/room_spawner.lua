
local progression<const> = require('progression')
local constants<const> = require('constants')

local room_spawner<const> = {}

local spawn_rocks<const> = function(room)
	for i = 1, #room.rocks do
		local def<const> = room.rocks[i]
		local existing<const> = oget(def.id)
		if not room.destroyed_rock_ids[def.id] then
			if existing == nil then
				local obj<const> = inst('rock', {
					id = def.id,
					space_id = 'main',
					pos = { x = def.x, y = def.y, z = 140 },
					item_type = def.item_type,
					rs_room_number = room.room_number,
				})
				obj:add_tag('rs')
			end
		end
	end
end

local spawn_lithographs<const> = function(room)
	for i = 1, #room.lithographs do
		local def<const> = room.lithographs[i]
		local existing<const> = oget(def.id)
		if existing == nil then
			local obj<const> = inst('lithograph', {
				id = def.id,
				space_id = 'main',
				pos = { x = def.x, y = def.y, z = 10 },
				text = def.text,
				room_number = oget('c').current_room_number,
				rs_room_number = room.room_number,
			})
			obj:add_tag('rs')
		end
	end
end

local spawn_shrines<const> = function(room)
	for i = 1, #room.shrines do
		local def<const> = room.shrines[i]
		local existing<const> = oget(def.id)
		if existing == nil then
			local obj<const> = inst('room_shrine', {
				id = def.id,
				space_id = 'main',
				pos = { x = def.x, y = def.y, z = 22 },
				rs_room_number = room.room_number,
			})
			obj:add_tag('rs')
		end
	end
end

local spawn_draaideuren<const> = function(room)
	for i = 1, #room.draaideuren do
		local def<const> = room.draaideuren[i]
		local existing<const> = oget(def.id)
		if existing == nil then
			local obj<const> = inst('draaideur', {
				id = def.id,
				space_id = 'main',
				pos = { x = def.x, y = def.y, z = 22 },
				kind = def.kind,
				rs_room_number = room.room_number,
			})
			obj:add_tag('rs')
		end
	end
end

local spawn_world_entrances<const> = function(room)
	local castle<const> = oget('c')
	for i = 1, #room.world_entrances do
		local def<const> = room.world_entrances[i]
		local existing<const> = oget(def.id)
		if existing == nil then
			local entrance<const> = inst('world_entrance', {
				id = def.id,
				space_id = 'main',
				pos = { x = def.x, y = def.y, z = 22 },
				target = def.target,
				rs_room_number = room.room_number,
			})
			entrance:set_entrance_state(castle.world_entrance_states[def.target].state)
			entrance:add_tag('rs')
		end
	end
end

local spawn_items<const> = function(room)
	local castle<const> = oget('c')
	local player<const> = oget('pietolon')
	for i = 1, #room.items do
		local def<const> = room.items[i]
		local picked<const> = progression.get(castle, 'item_picked_' .. def.id)
		local matches_conditions<const> = progression.matches(castle, def.conditions)
		local already_owned<const> = player.inventory_items[def.item_type]

		local should_spawn<const> = not picked and matches_conditions and not already_owned
		local existing<const> = oget(def.id)
		if should_spawn then
			if existing == nil then
				local obj<const> = inst('world_item', {
					id = def.id,
					space_id = 'main',
					pos = { x = def.x, y = def.y, z = 130 },
					item_id = def.id,
					item_type = def.item_type,
					rs_room_number = room.room_number,
				})
				obj:add_tag('rs')
			end
		else
			if existing ~= nil then
				existing:mark_for_disposal()
			end
		end
	end
end

local spawn_enemies<const> = function(room)
	local castle<const> = oget('c')
	for i = 1, #room.enemies do
		local def<const> = room.enemies[i]
		local defeated<const> = progression.get(castle, def.id)
		local matches_conditions<const> = progression.matches(castle, def.conditions)

		local should_spawn<const> = not defeated and matches_conditions
		local existing<const> = oget(def.id)
		if should_spawn then
			if existing == nil then
				local obj<const> = inst('enemy.' .. def.kind, {
					id = def.id,
					space_id = 'main',
					pos = { x = def.x, y = def.y, z = 140 },
					trigger = def.trigger,
					conditions = def.conditions,
					damage = def.damage,
					health = def.health,
					max_health = def.health,
					direction = def.direction,
					speed_x_num = def.speedx,
					speed_y_num = def.speedy,
					width_tiles = def.width_tiles,
					height_tiles = def.height_tiles,
					tiletype = def.tiletype,
					rs_room_number = room.room_number,
				})
				obj:add_tag('rs')
			end
		else
			if existing ~= nil then
				existing:mark_for_disposal()
			end
		end
	end
end

local spawn_destroyed_rock_inventory_items<const> = function(room)
	local castle<const> = oget('c')
	local player<const> = oget('pietolon')
	for i = 1, #room.inventory_rocks do
		local def<const> = room.inventory_rocks[i]
		local item_type<const> = def.item_type
		if room.destroyed_rock_ids[def.id] then
			local item_id<const> = 'drop.' .. def.id
			local picked<const> = progression.get(castle, 'item_picked_' .. item_id)
			local already_owned<const> = player.inventory_items[item_type]
			if not picked and not already_owned and oget(item_id) == nil then
				local obj<const> = inst('world_item', {
					id = item_id,
					space_id = 'main',
					pos = { x = def.x, y = def.y + constants.world_item.drop_offset_y[item_type], z = 130 },
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
		if drop.room_number == room.room_number and oget(id) == nil then
			local obj<const> = inst('world_item', {
				id = id,
				space_id = 'main',
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
	for obj in all_objects_by_tag('rs') do
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

function room_spawner.despawn_previous()
	local i = 0
	for obj in all_objects_by_tag('rs') do
		obj:mark_for_disposal()
		i = i + 1
	end
end

return room_spawner
