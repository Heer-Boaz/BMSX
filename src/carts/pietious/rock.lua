local constants = require('constants')
local combat_overlap = require('combat_overlap')
local rock = {}
rock.__index = rock

local dropped_item_uses_y_offset = {
        pepernoot = true,
        spyglass = true,
}

local function drop_offset_y_for_item_type(item_type)
        if item_type == nil then
                return 0
        end
        if dropped_item_uses_y_offset[item_type] then
                return constants.room.tile_size
        end
        return 0
end

function rock:ctor()
        self.collider:apply_collision_profile('enemy')
        self.collider.enabled = true
        self:gfx('stone')
end

function rock:take_weapon_hit(weapon_kind)
        local room_number = object('c').current_room_number
        self.health = self.health - 1
	if self.health <= 0 then
	        self.health = 0
	        self.events:emit('breakable.destroyed', {
	                target_id = self.id,
	                target_kind = 'rock',
	                room_number = room_number,
	                weapon_kind = weapon_kind,
	        })
	        self.events:emit('break')
	else
	        self.events:emit('combat.target_damaged', {
	                target_id = self.id,
	                target_kind = 'rock',
	                room_number = room_number,
	                weapon_kind = weapon_kind,
	        })
	end
	return true
end

function rock:begin_break()
        local room = object('room')
        room.destroyed_rock_ids[self.id] = true
        if self.item_type == nil then
                return
        end
        local player = object('pietolon')
        if player and player.inventory_items and player.inventory_items[self.item_type] then
                return
        end
        local drop_y = self.y + drop_offset_y_for_item_type(self.item_type)
        inst('world_item', {
                id = 'drop.' .. self.id,
                space_id = 'main',
                pos = { x = self.x, y = drop_y, z = 130 },
                item_id = 'drop.' .. self.id,
                item_type = self.item_type,
        })
end

local function define_rock_fsm()
        define_fsm('rock', {
                initial = 'idle',
                on = {
                        ['overlap.begin'] = function(self, _state, event)
                                local contact_kind = combat_overlap.classify_player_contact(event)
                                if contact_kind ~= 'sword' and contact_kind ~= 'projectile' then
                                        return
                                end
                                self:take_weapon_hit(contact_kind)
                        end,
                },
                states = {
                        idle = {
                                on = {
                                        ['break'] = '/breaking',
                                        ['reset'] = '/idle',
                                },
                        },
                                breaking = {
                                        on = {
                                                ['reset'] = '/idle',
                                        },
                                        entering_state = function(self)
                                                self.break_steps = 0
                                                self:begin_break()
                                                self.collider.enabled = false
                                                self:gfx('stone_broken')
                                        end,
                                        update = function(self)
                                                self.break_steps = self.break_steps + 1
                                                if self.break_steps >= constants.rock.break_steps then
                                                        self:mark_for_disposal()
                                                end
                                        end,
                                },
                        },
        })
end

local function register_rock_definition()
        define_prefab({
                def_id = 'rock',
                class = rock,
                type = 'sprite',
                fsms = { 'rock' },
                defaults = {
                        item_type = nil,
                        max_health = constants.rock.max_health,
                        health = constants.rock.max_health,
                        break_steps = 0,
                },
        })
end

return {
        rock = rock,
        define_rock_fsm = define_rock_fsm,
        register_rock_definition = register_rock_definition,
}
