local constants = require('constants')
local progression = require('progression')
local room_object_pool = require('room_object_pool')
local world_instance = require('world').instance

local enemy_service = {}

function enemy_service:sync_enemy_instance(enemy_def, force_reset_from_room_template)
	return self.enemy_pool:use(enemy_def, {
		force_reset_from_room_template = force_reset_from_room_template,
	})
end

function enemy_service:clear_enemy_state()
	clear_map(self.enemies_by_id)
	clear_map(self.active_enemy_ids)
	clear_map(self.active_enemy_ids_scratch)
	self.enemies_hidden_for_shrine = false
end

function enemy_service:despawn_active_enemies()
	self:for_each_active_enemy_instance(function(instance)
		world_instance:despawn(instance)
	end)
	self:clear_enemy_state()
end

function enemy_service:commit_active_enemy_ids(next_active_ids)
	local previous_active_ids = self.active_enemy_ids
	self.active_enemy_ids = next_active_ids
	self.active_enemy_ids_scratch = previous_active_ids
	self.enemy_pool.active_ids = previous_active_ids
	clear_map(previous_active_ids)
end

function enemy_service:for_each_active_enemy_instance(visitor)
	for id in pairs(self.active_enemy_ids) do
		visitor(self.enemies_by_id[id], id)
	end
end

function enemy_service:hide_active_enemies_for_shrine_transition()
	self.enemies_hidden_for_shrine = true
	self:for_each_active_enemy_instance(function(instance)
		instance:set_space('transition')
	end)
end

function enemy_service:restore_active_enemies_after_shrine_transition()
	self.enemies_hidden_for_shrine = false
	self:for_each_active_enemy_instance(function(instance)
		instance:set_space('main')
	end)
end

function enemy_service:refresh_current_room_enemies(force_reset_from_room_template)
	local castle = object('c')
	local room = castle.current_room
	local enemy_defs = room.enemies
	local next_active_ids = self.active_enemy_ids_scratch
	local previous_active_ids = self.active_enemy_ids
	self.enemy_pool.active_ids = next_active_ids
	self.enemy_pool:begin_cycle()

	for i = 1, #enemy_defs do
		local enemy_def = enemy_defs[i]
		local enemy_id = enemy_def.id
		if not progression.matches(castle, enemy_def.conditions) then
			goto continue
		end
		if not force_reset_from_room_template and previous_active_ids[enemy_id] then
			local live_instance = object(enemy_id)
			if live_instance ~= nil then
				self.enemies_by_id[enemy_id] = live_instance
				self.enemy_pool:mark_active(enemy_id)
				goto continue
			end
		end
		self:sync_enemy_instance(enemy_def, force_reset_from_room_template)
		::continue::
	end

	self.enemy_pool:end_cycle()
	self:commit_active_enemy_ids(next_active_ids)
end

function enemy_service:bind_enemy_events()
	self.events:on({
		event = 'shrine_transition_enter',
		subscriber = self,
		handler = function()
			self:hide_active_enemies_for_shrine_transition()
		end,
	})
	self.events:on({
		event = 'shrine_transition_exit',
		subscriber = self,
		handler = function()
			self:restore_active_enemies_after_shrine_transition()
		end,
	})

	self.events:on({
		event = 'enemy.defeated',
		subscriber = self,
		handler = function(event)
			local enemy_id = event.enemy_id
			self.enemies_by_id[enemy_id] = nil
			self.active_enemy_ids[enemy_id] = nil
			self.active_enemy_ids_scratch[enemy_id] = nil
			self.enemy_pool:deactivate_id(enemy_id)

			if event.trigger then
				self.events:emit('room.condition_set', {
					room_number = event.room_number,
					condition = event.trigger,
				})
			end
		end,
	})
end

function enemy_service:ctor()
	self.enemies_by_id = {}
	self.active_enemy_ids = {}
	self.active_enemy_ids_scratch = {}
	self.enemies_hidden_for_shrine = false
	self.enemy_pool = room_object_pool.new({
		instances_by_id = self.enemies_by_id,
		active_ids = self.active_enemy_ids_scratch,
		create_instance = function(definition)
			return inst('enemy.' .. definition.kind, {
				id = definition.id,
				pos = { x = definition.x, y = definition.y, z = 140 },
				trigger = definition.trigger,
				conditions = definition.conditions,
				damage = definition.damage,
				health = definition.health,
				max_health = definition.health,
				direction = definition.direction,
				speed_x_num = definition.speedx,
				speed_y_num = definition.speedy,
				width_tiles = definition.width_tiles,
				height_tiles = definition.height_tiles,
				tiletype = definition.tiletype,
			})
		end,
		sync_instance = function(instance, definition, context, was_active)
			local should_reset = context.force_reset_from_room_template or (not was_active)
			instance:set_space('main')
			instance.trigger = definition.trigger
			instance.conditions = definition.conditions
			instance.damage = definition.damage
			instance.width_tiles = definition.width_tiles
			instance.height_tiles = definition.height_tiles
			instance.tiletype = definition.tiletype
			if definition.width_tiles ~= nil then
				instance.sx = definition.width_tiles * constants.room.tile_size
			end
			if definition.height_tiles ~= nil then
				instance.sy = definition.height_tiles * constants.room.tile_size
			end
			if definition.health ~= nil then
				instance.max_health = definition.health
				if should_reset then
					instance.health = definition.health
				end
			end
			if should_reset and definition.direction ~= nil then
				instance.direction = definition.direction
			end
			if should_reset and definition.speedx ~= nil then
				instance.speed_x_num = definition.speedx
				instance.speed_accum_x = 0
			end
			if should_reset and definition.speedy ~= nil then
				instance.speed_y_num = definition.speedy
				instance.speed_accum_y = 0
			end
			if should_reset then
				instance.x = definition.x
				instance.y = definition.y
			end
		end,
	})
	self:bind_enemy_events()
end

local function register_enemy_service_definition()
	define_prefab({
		def_id = 'enemy',
		class = enemy_service,
		defaults = {
			id = 'en',
			enemies_by_id = {},
			active_enemy_ids = {},
			active_enemy_ids_scratch = {},
			enemies_hidden_for_shrine = false,
		},
	})
end

return {
	register_enemy_service_definition = register_enemy_service_definition,
}
