local constants = require('constants')
local components = require('components')
local world_item = {}
world_item.__index = world_item

function world_item:bind_events()
	self.events:on({
		event_name = 'overlap.stay',
		subscriber = self,
		handler = function(event)
			self:on_overlap_stay(event)
		end,
	})
end

function world_item:configure_from_room_def(def, room, item_service_id)
	self.item_id = def.id
	self.room_number = room.room_number
	self.space_id = room.space_id
	self.item_service_id = item_service_id
	self.source_kind = def.source_kind
	self.item_type = def.item_type
	self.x = def.x
	self.y = def.y
	self.body_sprite.imgid = constants.world_item.sprite[self.item_type]
	self.body_sprite.enabled = true
	self.body_collider.enabled = true
end

function world_item:on_overlap_stay(event)
	if event.other_id ~= constants.ids.player_instance then
		return
	end

	local player = object(constants.ids.player_instance)
	local other_collider = player:get_component_by_id(event.other_collider_id)
	if other_collider.id_local ~= constants.ids.player_body_collider_local then
		return
	end

	if service(self.item_service_id):try_pick_item(self.item_id, self.room_number, self.item_type, self.source_kind) then
		self:dispatch_state_event('picked')
	end
end

local function define_world_item_fsm()
	define_fsm(constants.ids.world_item_fsm, {
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
					self.body_collider:apply_collision_profile('pickup')
					self:add_component(self.body_collider)
					self.body_sprite = components.spritecomponent.new({
						parent = self,
						id_local = 'body',
						imgid = 'item_health',
						offset = { x = 0, y = 0, z = 112 },
						collider_local_id = 'body',
					})
					self:add_component(self.body_sprite)
					self:bind_events()
					return '/active'
				end,
			},
			active = {
				on = {
					['picked'] = '/picked',
				},
					entering_state = function(self)
						self.state_name = 'active'
						self.body_sprite.imgid = constants.world_item.sprite[self.item_type]
						self.body_sprite.enabled = true
						self.body_collider.enabled = true
					end,
				},
			picked = {
				entering_state = function(self)
					self.state_name = 'picked'
					self.body_sprite.enabled = false
					self.body_collider.enabled = false
					self:mark_for_disposal()
				end,
			},
		},
	})
end

local function register_world_item_definition()
	define_world_object({
		def_id = constants.ids.world_item_def,
		class = world_item,
		fsms = { constants.ids.world_item_fsm },
			defaults = {
				space_id = constants.spaces.castle,
				room_number = 0,
				item_id = '',
			item_type = 'ammofromrock',
			source_kind = 'map',
			item_service_id = constants.ids.item_service_instance,
			state_name = 'boot',
			registrypersistent = false,
			tick_enabled = false,
		},
	})
end

return {
	world_item = world_item,
	define_world_item_fsm = define_world_item_fsm,
	register_world_item_definition = register_world_item_definition,
	world_item_def_id = constants.ids.world_item_def,
	world_item_fsm_id = constants.ids.world_item_fsm,
}
