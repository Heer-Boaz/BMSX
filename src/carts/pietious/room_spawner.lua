local progression = require('progression')

local room_spawner = {}

function room_spawner.despawn_previous()
	for _, obj in objects_by_tag('rs') do
		obj:mark_for_disposal()
	end
end

local function spawn_rocks(room)
	for i = 1, #room.rocks do
		local def = room.rocks[i]
		if not room.destroyed_rock_ids[def.id] then
			local obj = inst('rock', {
				id = def.id,
				space_id = 'main',
				pos = { x = def.x, y = def.y, z = 140 },
				item_type = def.item_type,
			})
			obj:add_tag('rs')
		end
	end
end

local function spawn_lithographs(room)
	for i = 1, #room.lithographs do
		local def = room.lithographs[i]
		local obj = inst('lithograph', {
			id = def.id,
			space_id = 'main',
			pos = { x = def.x, y = def.y, z = 10 },
			text = def.text,
			room_number = room.room_number,
		})
		obj:add_tag('rs')
	end
end

local function spawn_shrines(room)
	for i = 1, #room.shrines do
		local def = room.shrines[i]
		local obj = inst('room_shrine', {
			id = def.id,
			space_id = 'main',
			pos = { x = def.x, y = def.y, z = 22 },
		})
		obj:add_tag('rs')
	end
end

local function spawn_draaideuren(room)
	for i = 1, #room.draaideuren do
		local def = room.draaideuren[i]
		local obj = inst('draaideur', {
			id = def.id,
			space_id = 'main',
			pos = { x = def.x, y = def.y, z = 22 },
			kind = def.kind,
		})
		obj:add_tag('rs')
	end
end

local function spawn_world_entrances(room)
	local castle = object('c')
	for i = 1, #room.world_entrances do
		local def = room.world_entrances[i]
		local entrance = inst('world_entrance', {
			id = def.id,
			space_id = 'main',
			pos = { x = def.x, y = def.y, z = 22 },
			target = def.target,
		})
		entrance:set_entrance_state(castle.world_entrance_states[def.target].state)
		entrance:add_tag('rs')
	end
end

local function spawn_items(room)
	local castle = object('c')
	local player = object('pietolon')
	for i = 1, #room.items do
		local def = room.items[i]
		local picked = progression.get(castle, 'item_picked_' .. def.id)
		local matches_conditions = progression.matches(castle, def.conditions)
		local already_owned = player.inventory_items[def.item_type]
		if not picked and matches_conditions and not already_owned then
			local obj = inst('world_item', {
				id = def.id,
				space_id = 'main',
				pos = { x = def.x, y = def.y, z = 130 },
				item_id = def.id,
				item_type = def.item_type,
			})
			obj:add_tag('rs')
		end
	end
end

local function spawn_enemies(room)
	local castle = object('c')
	for i = 1, #room.enemies do
		local def = room.enemies[i]
		local defeated = progression.get(castle, def.id)
		local matches_conditions = progression.matches(castle, def.conditions)
		if not defeated and matches_conditions then
			local obj = inst('enemy.' .. def.kind, {
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
			})
			obj:add_tag('rs')
		end
	end
end

function room_spawner.spawn_all_for_room(room)
	room_spawner.despawn_previous()
	spawn_rocks(room)
	spawn_lithographs(room)
	spawn_shrines(room)
	spawn_draaideuren(room)
	spawn_world_entrances(room)
	spawn_items(room)
	spawn_enemies(room)
end

return room_spawner
