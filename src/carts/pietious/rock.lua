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

function rock:bind_events()
	self.events:on({
		event_name = 'overlap.begin',
		subscriber = self,
		handler = function(event)
			self:on_overlap(event)
		end,
	})
end

function rock:ctor()
	self.collider:apply_collision_profile('enemy')
	self.collider.enabled = true
	self:gfx('stone')
	self:bind_events()
end

function rock:configure_from_room_def(def, room)
	self.item_type = def.item_type
	self.max_health = constants.rock.max_health
	self.health = self.max_health
	self.break_steps = 0
	self.events:emit('reset')
end

function rock:take_weapon_hit(weapon_kind)
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self.events:emit('break')
	else
		object('c').events:emit('foedamage')
	end
	return true
end

function rock:begin_break()
	local drop_y = self.y + drop_offset_y_for_item_type(self.item_type)
	local room = object('c').current_room
	object('room'):on_rock_break_started(self.id, room.room_number, self.item_type, self.x, drop_y)
end

function rock:on_overlap(event)
	local contact_kind = combat_overlap.classify_player_contact(event)
	if contact_kind ~= 'sword' and contact_kind ~= 'projectile' then
		return
	end
	self:take_weapon_hit(contact_kind)
end

function rock:finish_break()
	object('room'):on_rock_destroyed(self.id)
	self:mark_for_disposal()
end

local function define_rock_fsm()
	define_fsm('rock', {
		initial = 'idle',
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
					end,
					update = function(self)
						self.break_steps = self.break_steps + 1
						if self.break_steps >= constants.rock.break_steps then
							self:finish_break()
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
