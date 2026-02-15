local constants = require('constants')
local room_module = require('room')
local combat_overlap = require('combat_overlap')

local pepernoot_projectile = {}
pepernoot_projectile.__index = pepernoot_projectile

function pepernoot_projectile:ctor()
	self.collider:apply_collision_profile('projectile')
	self:gfx('pepernoot_16')
	self.sprite_component.offset = { x = 0, y = 0, z = 113 }
	self:bind_events()
end

function pepernoot_projectile:refresh_tile_aligned_sprite_offset()
	local room = service('c').current_room
	local snapped_x, snapped_y = room_module.snap_world_to_tile(room, self.x, self.y)
	self.sprite_component.offset.x = snapped_x - self.x
	self.sprite_component.offset.y = snapped_y - self.y
end

function pepernoot_projectile:onspawn(pos)
	getmetatable(self).onspawn(self, pos)
	self.sprite_component.flip.flip_h = self.direction < 0
	self:refresh_tile_aligned_sprite_offset()
end

function pepernoot_projectile:bind_events()
	self.events:on({
		event_name = 'overlap.begin',
		subscriber = self,
		handler = function(event)
			self:on_overlap_begin(event)
		end,
	})

	self.events:on({
		event = 'room.switched',
		emitter = 'pietolon',
		subscriber = self,
		handler = function(_event)
			self:dispose('room_switched')
		end,
	})
end

function pepernoot_projectile:dispose(reason)
	self.disposed = true
	self:mark_for_disposal()
end

function pepernoot_projectile:on_overlap_begin(event)
	if event.other_layer ~= constants.collision.enemy_layer then
		return
	end
	local target = object(event.other_id)
	if target:take_weapon_hit('pepernoot') then
		self:dispose('hit_target')
	end
end

function pepernoot_projectile:tick()
	self.x = self.x + (self.direction * constants.secondary_weapon.pepernoot_speed_px)
	self:refresh_tile_aligned_sprite_offset()

	if self.x <= 0 or self.x >= service('c').current_room.world_width then
		self:dispose('out_of_bounds')
		return
	end
	if room_module.is_solid_at_world(service('c').current_room, self.x, self.y) then
		self:dispose('wall')
	end
end

local function define_pepernoot_projectile_fsm()
	define_fsm('pepernoot_projectile.fsm', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_pepernoot_projectile_definition()
	define_prefab({
		def_id = 'pepernoot_projectile.def',
		class = pepernoot_projectile,
		type = 'sprite',
		fsms = { 'pepernoot_projectile.fsm' },
		defaults = {
			owner_id = 'pietolon',
			direction = 1,
			disposed = false,
		},
	})
end

return {
	pepernoot_projectile = pepernoot_projectile,
	define_pepernoot_projectile_fsm = define_pepernoot_projectile_fsm,
	register_pepernoot_projectile_definition = register_pepernoot_projectile_definition,
}
