local constants = require('constants')
local components = require('components')
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
	local room = service(constants.ids.castle_service_instance).current_room
	service(self.rock_service_id):on_rock_break_started(self.id, room.room_number, self.item_type, self.x, drop_y)
end

function rock:on_overlap(event)
	if event.other_id ~= constants.ids.player_instance then
		return
	end

	local player = object(constants.ids.player_instance)
	if player:has_tag('g.sw') then
		self:take_weapon_hit('sword', player.sword_id)
	end
end

function rock:finish_break()
	service(self.rock_service_id):on_rock_destroyed(self.id)
	self:mark_for_disposal()
end

local function define_rock_fsm()
	define_fsm(constants.ids.rock_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.body_collider = components.collider2dcomponent.new({
						parent = self,
						id_local = 'body',
						generateoverlapevents = true,
						spaceevents = 'current',
					})
					self.body_collider:apply_collision_profile('enemy')
					self:add_component(self.body_collider)
					self:gfx('stone')
					self.sprite_component.offset = { x = 0, y = 0, z = 113 }
					self.visible = false
					self:bind_events()
					return '/idle'
				end,
			},
			idle = {
				on = {
					['break'] = '/breaking',
					['reset'] = '/idle',
				},
				entering_state = function(self)
					self:gfx('stone')
					self.body_collider.enabled = true
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
						self.body_collider.enabled = false
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
		def_id = constants.ids.rock_def,
		class = rock,
		type = 'sprite',
		fsms = { constants.ids.rock_fsm },
			defaults = {
			rock_service_id = constants.ids.rock_service_instance,
			item_type = 'none',
			max_health = constants.rock.max_health,
			health = constants.rock.max_health,
			last_weapon_kind = '',
			last_weapon_hit_id = -1,
			break_steps = 0,
			tick_enabled = true,
		},
	})
end

return {
	rock = rock,
	define_rock_fsm = define_rock_fsm,
	register_rock_definition = register_rock_definition,
	rock_def_id = constants.ids.rock_def,
	rock_fsm_id = constants.ids.rock_fsm,
}
