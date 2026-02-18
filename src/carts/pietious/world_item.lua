local constants = require('constants')
local combat_overlap = require('combat_overlap')
local world_item = {}
world_item.__index = world_item

function world_item:ctor()
	self.collider:apply_collision_profile('pickup')
	self:gfx(constants.world_item.sprite[self.item_type])
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

function world_item:configure_from_room_def(def, room)
	self.item_id = def.id
	self.item_type = def.item_type
	self:gfx(constants.world_item.sprite[self.item_type])
end

function world_item:on_overlap(event)
	if combat_overlap.classify_player_contact(event) ~= 'body' then
		return
	end

	local room = service('c').current_room
	if service('i'):try_pick_item(self.item_id, room.room_number, self.item_type) then
		self:dispatch_state_event('picked')
	end
end

local function define_world_item_fsm()
	define_fsm('world_item.fsm', {
		initial = 'active',
		states = {
			active = {
				on = {
					['picked'] = function(self)
						self:mark_for_disposal()
					end,
				},
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
			item_type = '',
		},
	})
end

return {
	world_item = world_item,
	define_world_item_fsm = define_world_item_fsm,
	register_world_item_definition = register_world_item_definition,
}
