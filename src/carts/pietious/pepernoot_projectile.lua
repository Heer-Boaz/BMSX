local constants = require('constants')
local worldobject = require('worldobject')

local pepernoot_projectile = {}
pepernoot_projectile.__index = pepernoot_projectile

local state_tags = {
	frozen = 'v.fz',
}

function pepernoot_projectile:ctor()
	self.collider:apply_collision_profile('projectile')
	self:gfx('pepernoot_16')
end

function pepernoot_projectile:onspawn(pos)
	local room = object('room')
	local snapped_x, snapped_y = room:snap_world_to_tile(self.x, self.y)
	self.sprite_component.offset.x = snapped_x - self.x
	self.sprite_component.offset.y = snapped_y - self.y
end

function pepernoot_projectile:refresh_tile_aligned_sprite_offset()
	local room = object('room')
	local snapped_x, snapped_y = room:snap_world_to_tile(self.x, self.y)
	self.sprite_component.offset.x = snapped_x - self.x
	self.sprite_component.offset.y = snapped_y - self.y
end

function pepernoot_projectile:update_motion()
	if self:has_tag(state_tags.frozen) then
		return
	end
	local room = object('room')
	self.x = self.x + (self.direction * constants.secondary_weapon.pepernoot_speed_px)
	self:refresh_tile_aligned_sprite_offset()

	if self.x <= 0 or self.x >= room.world_width then
		self:mark_for_disposal()
		return
	end
	local overlaps_rock = room:overlaps_active_rock(self.x, self.y, self.sx, self.sy)
	if room:is_solid_at_world(self.x, self.y) and not overlaps_rock then
		self:mark_for_disposal()
	end
end

local function define_pepernoot_projectile_fsm()
	define_fsm('pepernoot_projectile', {
		initial = 'active',
		on = {
			['overlap.begin'] = function(self, _state, event)
				if event.other_layer ~= constants.collision.enemy_layer then
					return
				end
				self:mark_for_disposal()
			end,
			['room.switched'] = {
				emitter = 'pietolon',
				go = worldobject.mark_for_disposal,
			},
			['seal_breaking'] = '/freeze',
		},
		states = {
			active = {
				update = pepernoot_projectile.update_motion,
			},
			freeze = {
				tags = { state_tags.frozen },
				on = {
					['seal_flash_done'] = function(_self, state)
						state:pop_and_transition()
					end,
				},
			},
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
