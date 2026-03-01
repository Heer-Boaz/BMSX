local progression = require('progression')

local room_spawner = {}

local function spawn_rocks(room)
	for i = 1, #room.rocks do
		local def = room.rocks[i]
		local instance = object(def.id)
		if room.destroyed_rock_ids[def.id] then
			if instance ~= nil then
				instance:mark_for_disposal()
			end
		elseif instance == nil then
			inst('rock', {
				id = def.id,
				space_id = 'main',
				pos = { x = def.x, y = def.y, z = 140 },
				item_type = def.item_type,
			})
		end
	end
end

local function spawn_lithographs(room)
	for i = 1, #room.lithographs do
		local def = room.lithographs[i]
		if object(def.id) == nil then
			inst('lithograph', {
				id = def.id,
				space_id = 'main',
				pos = { x = def.x, y = def.y, z = 10 },
				text = def.text,
				room_number = room.room_number,
			})
		end
	end
end

local function spawn_shrines(room)
	for i = 1, #room.shrines do
		local def = room.shrines[i]
		if object(def.id) == nil then
			inst('room_shrine', {
				id = def.id,
				space_id = 'main',
				pos = { x = def.x, y = def.y, z = 22 },
			})
		end
	end
end

local function spawn_draaideuren(room)
	for i = 1, #room.draaideuren do
		local def = room.draaideuren[i]
		if object(def.id) == nil then
			inst('draaideur', {
				id = def.id,
				space_id = 'main',
				pos = { x = def.x, y = def.y, z = 22 },
				kind = def.kind,
			})
		end
	end
end

local function spawn_world_entrances(room)
	local castle = object('c')
	for i = 1, #room.world_entrances do
		local def = room.world_entrances[i]
		local entrance = object(def.id)
		if entrance == nil then
			entrance = inst('world_entrance', {
				id = def.id,
				space_id = 'main',
				pos = { x = def.x, y = def.y, z = 22 },
				target = def.target,
			})
		end
		entrance:set_entrance_state(castle.world_entrance_states[def.target].state)
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
		local instance = object(def.id)
		if picked or not matches_conditions or already_owned then
			if instance ~= nil then
				instance:mark_for_disposal()
			end
		elseif instance == nil then
			inst('world_item', {
				id = def.id,
				space_id = 'main',
				pos = { x = def.x, y = def.y, z = 130 },
				item_id = def.id,
				item_type = def.item_type,
			})
		end
	end
end

local function spawn_enemies(room)
	local castle = object('c')
	for i = 1, #room.enemies do
		local def = room.enemies[i]
		local defeated = progression.get(castle, def.id)
		local matches_conditions = progression.matches(castle, def.conditions)
		local instance = object(def.id)
		if defeated or not matches_conditions then
			if instance ~= nil then
				instance:mark_for_disposal()
			end
		elseif instance == nil then
			inst('enemy.' .. def.kind, {
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
		end
	end
end

function room_spawner.spawn_all_for_room(room)
	spawn_rocks(room)
	spawn_lithographs(room)
	spawn_shrines(room)
	spawn_draaideuren(room)
	spawn_world_entrances(room)
	spawn_items(room)
	spawn_enemies(room)
end

return room_spawner
