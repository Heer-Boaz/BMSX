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
	self.item_service_id = item_service_id
	self.source_kind = def.source_kind
	self.item_type = def.item_type
	self.sprite_component.imgid = constants.world_item.sprite[self.item_type]
	self.visible = true
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

	local room = service(constants.ids.castle_service_instance).current_room
	if service(self.item_service_id):try_pick_item(self.item_id, room.room_number, self.item_type, self.source_kind) then
		self:dispatch_state_event('picked')
	end
end

local function define_world_item_fsm()
	define_fsm(constants.ids.world_item_fsm, {
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
					self.body_collider:apply_collision_profile('pickup')
					self:add_component(self.body_collider)
					self.sprite_component.imgid = 'item_health'
					self.sprite_component.offset = { x = 0, y = 0, z = 112 }
					self:bind_events()
					return '/active'
				end,
			},
			active = {
				on = {
					['picked'] = '/picked',
				},
					entering_state = function(self)
						self.sprite_component.imgid = constants.world_item.sprite[self.item_type]
						self.visible = true
						self.body_collider.enabled = true
					end,
				},
			picked = {
				entering_state = function(self)
					self:mark_for_disposal()
				end,
			},
		},
	})
end

local function register_world_item_definition()
	define_prefab({
		def_id = constants.ids.world_item_def,
		class = world_item,
		fsms = { constants.ids.world_item_fsm },
			defaults = {
				item_id = '',
			item_type = 'ammofromrock',
			source_kind = 'map',
			item_service_id = constants.ids.item_service_instance,
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
