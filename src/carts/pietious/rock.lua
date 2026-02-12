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
	self.rock_id = def.id
	self.room_number = room.room_number
	self.space_id = room.space_id
	self.rock_service_id = rock_service_id
	self.item_type = def.item_type
	self.max_health = constants.rock.max_health
	self.health = self.max_health
	self.x = def.x
	self.y = def.y
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
	service(self.rock_service_id):on_rock_break_started(self.rock_id, self.room_number, self.item_type, self.x, drop_y)
end

function rock:on_overlap(event)
	if event.other_id ~= constants.ids.player_instance then
		return
	end

	local player = object(constants.ids.player_instance)
	local other_collider = player:get_component_by_id(event.other_collider_id)
	if other_collider.id_local ~= constants.ids.player_sword_collider_local then
		return
	end

	if player:has_tag('g.sw') then
		self:take_weapon_hit('sword', player.sword_id)
	end
end

function rock:finish_break()
	service(self.rock_service_id):on_rock_destroyed(self.rock_id)
	self.body_sprite.enabled = false
	self.body_collider.enabled = false
	self:mark_for_disposal()
end

local function define_rock_fsm()
	define_fsm(constants.ids.rock_fsm, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.state_name = 'boot'
					self.body_collider = components.collider2dcomponent.new({
						parent = self,
						id_local = 'body',
						generateoverlapevents = true,
						spaceevents = 'current',
					})
					self.body_collider:apply_collision_profile('enemy')
					self:add_component(self.body_collider)
					self.body_sprite = components.spritecomponent.new({
						parent = self,
						id_local = 'body',
						imgid = 'stone',
						offset = { x = 0, y = 0, z = 113 },
						collider_local_id = 'body',
					})
					self:add_component(self.body_sprite)
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
					self.state_name = 'idle'
					self.body_sprite.imgid = 'stone'
					self.body_collider.enabled = true
					self.body_sprite.enabled = true
				end,
			},
				breaking = {
					on = {
						['reset'] = '/idle',
					},
					entering_state = function(self)
						self.state_name = 'breaking'
						self.break_steps = 0
						self:begin_break()
						self.body_sprite.imgid = 'stone_broken'
						self.body_collider.enabled = false
						self.body_sprite.enabled = true
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
	define_world_object({
		def_id = constants.ids.rock_def,
		class = rock,
		fsms = { constants.ids.rock_fsm },
			defaults = {
				space_id = constants.spaces.castle,
				room_number = 0,
				rock_id = '',
			rock_service_id = constants.ids.rock_service_instance,
			item_type = 'none',
			width = constants.rock.width,
			height = constants.rock.height,
			max_health = constants.rock.max_health,
			health = constants.rock.max_health,
			last_weapon_kind = '',
			last_weapon_hit_id = -1,
			break_steps = 0,
			state_name = 'boot',
			registrypersistent = false,
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
