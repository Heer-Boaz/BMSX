local constants = require('constants')
local room_module = require('room')

local pepernoot_projectile = {}
pepernoot_projectile.__index = pepernoot_projectile

function pepernoot_projectile:ctor()
	self.collider:apply_collision_profile('projectile')
	self:gfx('pepernoot_16')
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
			self:mark_for_disposal()
		end,
	})
end

function pepernoot_projectile:on_overlap_begin(event)
	if event.other_layer ~= constants.collision.enemy_layer then
		return
	end
	self:mark_for_disposal()
end

function pepernoot_projectile:tick()
	local room = service('c').current_room
	self.x = self.x + (self.direction * constants.secondary_weapon.pepernoot_speed_px)
	self:refresh_tile_aligned_sprite_offset()

	if self.x <= 0 or self.x >= room.world_width then
		self:mark_for_disposal()
		return
	end
	local overlaps_rock = room_module.overlaps_active_rock(room, self.x, self.y, self.sx, self.sy)
	if room_module.is_solid_at_world(room, self.x, self.y) and not overlaps_rock then
		self:mark_for_disposal()
	end
end

local function define_pepernoot_projectile_fsm()
	define_fsm('pepernoot_projectile', {
		initial = 'active',
		states = {
			active = {},
		},
	})
end

local function register_pepernoot_projectile_definition()
	define_prefab({
		def_id = 'pepernoot_projectile',
		class = pepernoot_projectile,
		type = 'sprite',
		fsms = { 'pepernoot_projectile' },
		defaults = {
			owner_id = 'pietolon',
			direction = 1,
		},
	})
end

return {
	pepernoot_projectile = pepernoot_projectile,
	define_pepernoot_projectile_fsm = define_pepernoot_projectile_fsm,
	register_pepernoot_projectile_definition = register_pepernoot_projectile_definition,
}
