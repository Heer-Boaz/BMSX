local constants = require('constants')
local combat_overlap = require('combat_overlap')
local rock = {}
rock.__index = rock

local function drop_offset_y_for_item_type(item_type)
	if item_type == 'pepernoot' or item_type == 'spyglass' then
		return constants.room.tile_size
	end
	return 0
end

function rock:bind_events()
	self.events:on({
		event_name = 'overlap',
		subscriber = self,
		handler = function(event)
			self:on_overlap(event)
		end,
	})
end

function rock:ctor()
	self.collider:apply_collision_profile('enemy')
	self:gfx('stone')
	self.sprite_component.offset = { x = 0, y = 0, z = 113 }
	self:bind_events()
end

function rock:configure_from_room_def(def, room, rock_service_id)
	self.rock_service_id = rock_service_id
	self.item_type = def.item_type
	self.max_health = constants.rock.max_health
	self.health = self.max_health
	self.break_steps = 0
	self.last_weapon_kind = ''
	self.last_weapon_hit_id = -1
	self:dispatch_state_event('reset')
end

function rock:take_weapon_hit(weapon_kind, hit_id)
	if self.last_weapon_kind == weapon_kind and self.last_weapon_hit_id == hit_id then
		return false
	end
	self.last_weapon_kind = weapon_kind
	self.last_weapon_hit_id = hit_id
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self:dispatch_state_event('break')
	end
	return true
end

function rock:begin_break()
	local drop_y = self.y + drop_offset_y_for_item_type(self.item_type)
	local room = service('castle_service.instance').current_room
	service(self.rock_service_id):on_rock_break_started(self.id, room.room_number, self.item_type, self.x, drop_y)
end

function rock:on_overlap(event)
	local player = object('player.instance')
	local contact_kind = combat_overlap.classify_player_contact(self, event, constants, player)
	if not combat_overlap.has_sword_contact(contact_kind) then
		return
	end
	self:take_weapon_hit('sword', player.sword_id)
end

function rock:finish_break()
	service(self.rock_service_id):on_rock_destroyed(self.id)
	self:mark_for_disposal()
end

local function define_rock_fsm()
	define_fsm('rock.fsm', {
		initial = 'idle',
		states = {
			idle = {
				on = {
					['break'] = '/breaking',
					['reset'] = '/idle',
				},
				entering_state = function(self)
					self:gfx('stone')
					self.collider.enabled = true
					self.visible = true
				end,
			},
				breaking = {
					on = {
						['reset'] = '/idle',
					},
					entering_state = function(self)
						self.break_steps = 0
						self:begin_break()
						self:gfx('stone_broken')
						self.collider.enabled = false
						self.visible = true
					end,
					tick = function(self)
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
		def_id = 'rock.def',
		class = rock,
		type = 'sprite',
		fsms = { 'rock.fsm' },
		defaults = {
			rock_service_id = 'rock_service.instance',
			item_type = 'none',
			max_health = constants.rock.max_health,
			health = constants.rock.max_health,
			last_weapon_kind = '',
			last_weapon_hit_id = -1,
			break_steps = 0,
		},
	})
end

return {
	rock = rock,
	define_rock_fsm = define_rock_fsm,
	register_rock_definition = register_rock_definition,
	rock_def_id = 'rock.def',
	rock_fsm_id = 'rock.fsm',
}
