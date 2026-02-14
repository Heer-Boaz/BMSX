local constants = require('constants')
local world_item = {}
world_item.__index = world_item

function world_item:ctor()
	self.collider:apply_collision_profile('pickup')
	self:gfx('item_health')
	self.sprite_component.offset = { x = 0, y = 0, z = 112 }
	self:bind_events()
end

function world_item:bind_events()
	self.events:on({
		event_name = 'overlap',
		subscriber = self,
		handler = function(event)
			self:on_overlap(event)
		end,
	})
end

function world_item:configure_from_room_def(def, room, item_service_id)
	self.item_id = def.id
	self.item_service_id = item_service_id
	self.source_kind = def.source_kind
	self.item_type = def.item_type
	self:gfx(constants.world_item.sprite[self.item_type])
end

function world_item:on_overlap(event)
	if event.other_id ~= 'player.instance' then
		return
	end

	local room = service('castle_service.instance').current_room
	if service(self.item_service_id):try_pick_item(self.item_id, room.room_number, self.item_type, self.source_kind) then
		self:dispatch_state_event('picked')
	end
end

local function define_world_item_fsm()
	define_fsm('world_item.fsm', {
		initial = 'active',
		states = {
			active = {
				on = {
					['picked'] = '/picked',
				},
				entering_state = function(self)
					self:gfx(constants.world_item.sprite[self.item_type])
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
		def_id = 'world_item.def',
		class = world_item,
		type = 'sprite',
		fsms = { 'world_item.fsm' },
		defaults = {
			item_id = '',
			item_type = 'ammofromrock',
			source_kind = 'map',
			item_service_id = 'item_service.instance',
		},
	})
end

return {
	world_item = world_item,
	define_world_item_fsm = define_world_item_fsm,
	register_world_item_definition = register_world_item_definition,
	world_item_def_id = 'world_item.def',
	world_item_fsm_id = 'world_item.fsm',
}
