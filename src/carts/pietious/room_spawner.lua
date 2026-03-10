
local progression = require('progression')

local room_spawner = {}

local function spawn_rocks(room)
        for i = 1, #room.rocks do
                local def = room.rocks[i]
                local existing = object(def.id)
                if not room.destroyed_rock_ids[def.id] then
                        if existing == nil then
                                local obj = inst('rock', {
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

local function spawn_lithographs(room)
        for i = 1, #room.lithographs do
                local def = room.lithographs[i]
                local existing = object(def.id)
                if existing == nil then
                        local obj = inst('lithograph', {
                                id = def.id,
                                space_id = 'main',
                                pos = { x = def.x, y = def.y, z = 10 },
                                text = def.text,
                                room_number = object('c').current_room_number,
                                rs_room_number = room.room_number,
                        })
                        obj:add_tag('rs')
                end
        end
end

local function spawn_shrines(room)
        for i = 1, #room.shrines do
                local def = room.shrines[i]
                local existing = object(def.id)
                if existing == nil then
                        local obj = inst('room_shrine', {
                                id = def.id,
                                space_id = 'main',
                                pos = { x = def.x, y = def.y, z = 22 },
                                rs_room_number = room.room_number,
                        })
                        obj:add_tag('rs')
                end
        end
end

local function spawn_draaideuren(room)
        for i = 1, #room.draaideuren do
                local def = room.draaideuren[i]
                local existing = object(def.id)
                if existing == nil then
                        local obj = inst('draaideur', {
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

local function spawn_world_entrances(room)
        local castle = object('c')
        for i = 1, #room.world_entrances do
                local def = room.world_entrances[i]
                local existing = object(def.id)
                if existing == nil then
                        local entrance = inst('world_entrance', {
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

local function spawn_items(room)
        local castle = object('c')
        local player = object('pietolon')
        for i = 1, #room.items do
                local def = room.items[i]
                local picked = progression.get(castle, 'item_picked_' .. def.id)
                local matches_conditions = progression.matches(castle, def.conditions)
                local already_owned = player.inventory_items and player.inventory_items[def.item_type]
                
                local should_spawn = not picked and matches_conditions and not already_owned
                local existing = object(def.id)
                if should_spawn then
                        if existing == nil then
                                local obj = inst('world_item', {
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

local function spawn_enemies(room)
        local castle = object('c')
        for i = 1, #room.enemies do
                local def = room.enemies[i]
                local defeated = progression.get(castle, def.id)
                local matches_conditions = progression.matches(castle, def.conditions)
                
                local should_spawn = not defeated and matches_conditions
                local existing = object(def.id)
                if should_spawn then
                        if existing == nil then
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

function room_spawner.spawn_all_for_room(room)
        for obj in objects_by_tag('rs') do
                if obj.rs_room_number ~= room.room_number then
                        obj:mark_for_disposal()
                end
        end
        spawn_rocks(room)
        spawn_lithographs(room)
        spawn_shrines(room)
        spawn_draaideuren(room)
        spawn_world_entrances(room)
        spawn_items(room)
        spawn_enemies(room)
end

function room_spawner.despawn_previous()
	local i = 0
	for obj in objects_by_tag("rs") do
		obj:mark_for_disposal()
		i = i + 1
	end
end

return room_spawner
