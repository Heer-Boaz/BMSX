local constants = require('constants.lua')
local components = require('components')
local engine = require('engine')

local rock = {}
rock.__index = rock

local rock_fsm_id = constants.ids.rock_fsm
local state_idle = rock_fsm_id .. ':/idle'
local state_breaking = rock_fsm_id .. ':/breaking'
local PLAYER_ID = constants.ids.player_instance

local body_sprite_component_id = 'body'
local body_collider_component_id = 'body'

local function drop_offset_y_for_item_type(item_type)
	if item_type == 'pepernoot' or item_type == 'spyglass' then
		return constants.room.tile_size
	end
	return 0
end

function rock:ensure_components()
	local body_collider = self:get_component_by_local_id('collider2dcomponent', body_collider_component_id)
	if body_collider == nil then
		body_collider = components.collider2dcomponent.new({
			parent = self,
			id_local = body_collider_component_id,
			generateoverlapevents = true,
			spaceevents = 'current',
		})
		body_collider:apply_collision_profile('enemy')
		self:add_component(body_collider)
	end

	local body_sprite = self:get_component_by_local_id('spritecomponent', body_sprite_component_id)
	if body_sprite == nil then
		body_sprite = components.spritecomponent.new({
			parent = self,
			id_local = body_sprite_component_id,
			imgid = 'stone',
			offset = { x = 0, y = 0, z = 113 },
			collider_local_id = body_collider_component_id,
		})
		self:add_component(body_sprite)
	end

	self.body_collider = body_collider
	self.body_sprite = body_sprite
end

function rock:bind_events()
	if self.events_bound then
		return
	end
	self.events_bound = true

	self.events:on({
		event_name = 'overlap.stay',
		subscriber = self,
		handler = function(event)
			self:on_overlap_stay(event)
		end,
	})
end

function rock:update_visual()
	if self.sc:matches_state_path(state_breaking) then
		self.body_sprite.imgid = 'stone_broken'
		self.body_collider.enabled = false
	else
		self.body_sprite.imgid = 'stone'
		self.body_collider.enabled = true
	end
	self.body_sprite.enabled = true
end

function rock:configure_from_room_def(def, room, rock_service_id)
	self.rock_id = def.id
	self.room_id = room.room_id
	self.space_id = room.space_id
	self.rock_service_id = rock_service_id
	self.item_type = def.item_type
	self.max_health = constants.rock.max_health
	self.health = self.max_health
	self.x = def.x
	self.y = def.y
	self.break_steps = 0
	self.break_started = false
	self.last_sword_hit_id = -1
	self.last_pepernoot_hit_id = -1
	self.sc:transition_to(state_idle)
end

function rock:take_sword_hit(sword_id)
	if sword_id <= 0 then
		return
	end
	if self.last_sword_hit_id == sword_id then
		return
	end
	self.last_sword_hit_id = sword_id
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self:begin_break()
		self.sc:transition_to(state_breaking)
	end
end

function rock:take_pepernoot_hit(pepernoot_id)
	if pepernoot_id <= 0 then
		return false
	end
	if self.last_pepernoot_hit_id == pepernoot_id then
		return false
	end
	self.last_pepernoot_hit_id = pepernoot_id
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		self:begin_break()
		self.sc:transition_to(state_breaking)
	end
	return true
end

function rock:begin_break()
	if self.break_started then
		return
	end
	self.break_started = true
	local drop_y = self.y + drop_offset_y_for_item_type(self.item_type)
	engine.service(self.rock_service_id):on_rock_break_started(self.rock_id, self.room_id, self.item_type, self.x, drop_y)
end

function rock:on_overlap_stay(event)
	if event.other_id ~= PLAYER_ID then
		return
	end

	local player = engine.object(PLAYER_ID)
	local other_collider = player:get_component_by_id(event.other_collider_id)
	if other_collider.id_local ~= constants.ids.player_sword_collider_local then
		return
	end

	if player:is_slashing() then
		self:take_sword_hit(player.sword_id)
	end
end

function rock:finish_break()
	engine.service(self.rock_service_id):on_rock_destroyed(self.rock_id)
	self.body_sprite.enabled = false
	self.body_collider.enabled = false
	self:mark_for_disposal()
end

function rock:tick()
	if not self.sc:matches_state_path(state_breaking) then
		return
	end
	self.break_steps = self.break_steps + 1
	if self.break_steps >= constants.rock.break_steps then
		self:finish_break()
		return
	end
end

local function define_rock_fsm()
	define_fsm(rock_fsm_id, {
		initial = 'boot',
		states = {
			boot = {
				entering_state = function(self)
					self.state_name = 'boot'
					self.state_variant = 'boot'
					self:ensure_components()
					self:bind_events()
					return '/idle'
				end,
			},
			idle = {
				entering_state = function(self)
					self.state_name = 'idle'
					self.state_variant = 'idle'
					self:update_visual()
				end,
			},
				breaking = {
					entering_state = function(self)
						self.state_name = 'breaking'
						self.state_variant = 'breaking'
						self.break_steps = 0
						self:begin_break()
						self:update_visual()
					end,
				},
			},
	})
end

local function register_rock_definition()
	define_world_object({
		def_id = constants.ids.rock_def,
		class = rock,
		fsms = { rock_fsm_id },
		defaults = {
				space_id = constants.spaces.castle,
				room_id = '',
				rock_id = '',
				rock_service_id = constants.ids.rock_service_instance,
			item_type = 'none',
			width = constants.rock.width,
			height = constants.rock.height,
			max_health = constants.rock.max_health,
			health = constants.rock.max_health,
			last_sword_hit_id = -1,
			last_pepernoot_hit_id = -1,
			break_steps = 0,
			break_started = false,
			events_bound = false,
			state_name = 'boot',
			state_variant = 'boot',
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
	rock_fsm_id = rock_fsm_id,
}
