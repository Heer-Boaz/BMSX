local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local collision_storage<const> = require('collision_storage')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
require('constants')
local combat_overlap<const> = require('combat/overlap')
local combat_damage<const> = require('combat/damage')
local rock<const> = {}
rock.__index = rock
setmetatable(rock, { __index = sprite_object })
local rock_break_timeline_id<const> = 'rock.tl.break'
local rock_break_sequence<const> = {
	frames = timeline.range(rock_break_steps),
	playback_mode = 'once',
}
local break_playback<const> = { rewind = false }

function rock:ctor()
	self.collider = self:get_component(collider_2d_component)
	self.last_sword_strike_id = 0
end

function rock:apply_damage(request)
	if request.weapon_kind ~= 'sword' and request.weapon_kind ~= 'projectile' then
		return combat_damage.build_rejected_result(request, 'wrong_weapon')
	end
	self.health = self.health - 1
	if self.health <= 0 then
		self.health = 0
		return combat_damage.build_applied_result(request, 1, true, 'destroyed')
	end
	return combat_damage.build_applied_result(request, 1, false, 'damaged')
end

function rock:begin_break()
	if not self.active or self.breaking then return end
	self.breaking = true
	local pose_x<const>, pose_y<const> = self:get_global_position()
	local room<const> = self.room
	room:mark_rock_destroyed(self.scene_member_id)
	self.collider:set_enabled(false)
	self.sprite_component:set_imgid('stone_broken')
	-- An intact rock has no scheduled work. Attach the same one-shot
	-- gameplay transport only when its terminal drawing state starts.
	local transport<const> = self:add_component(timeline_component.new(self))
	transport:register(rock_break_timeline_id, rock_break_sequence)
	transport:play(rock_break_timeline_id, break_playback, rock.mark_for_disposal)
	if self.item_type == nil then
		return
	end
	if self.player.status.inventory_items[self.item_type] then
		return
	end
	local drop_y<const> = pose_y + world_item_drop_offset_y[self.item_type]
	local id<const> = 'drop.' .. self.scene_member_id
	local rock_drop_id = nil
	if not world_item_inventory[self.item_type] then
		rock_drop_id = id
		room.castle.session.region_drops[id] = {
			scene_id = room.scene_id,
			x = pose_x,
			y = drop_y,
			item_type = self.item_type,
		}
	end
	room.scene:spawn('world_item', {
		position = { x = pose_x, y = drop_y },
		imgid = world_item_sprite[self.item_type],
		space_id = 'main',
		room = room,
		player = self.player,
		item_id = id,
		item_type = self.item_type,
		rock_drop_id = rock_drop_id,
	})
end

local apply_weapon_contact<const> = function(self, _event_type, _emitter, event)
	if not self.active or self.breaking then return end
	local weapon_kind<const> = combat_overlap.admit_weapon_contact(self, event)
	if weapon_kind == nil then return end
	local result<const> = combat_damage.resolve(self, combat_damage.build_weapon_request(self, 'rock', event, weapon_kind))
	if result.destroyed then
		self.events:emit('break')
	end
end

local contact_begin<const> = { event = 'overlap.begin', handler = apply_weapon_contact }
local contact_stay<const> = { event = 'overlap.stay', handler = apply_weapon_contact }
local break_event<const> = { event = 'break', handler = rock.begin_break }

function rock:bind()
	self.events:on(contact_begin)
	self.events:on(contact_stay)
	self.events:on(break_event)
end

local register_rock_definition<const> = function()
	prefab.define({
		def_id = 'rock',
		class = rock,
		components = {
			collider_2d_component.factory_for_sprite({ geometry_pool = collision_storage.sprite, layer = collision_enemy_layer, mask = collision_enemy_mask }),
		},
		defaults = {
			order = 140,
			imgid = 'stone',
			item_type = nil,
			max_health = rock_max_health,
			health = rock_max_health,
		},
	})
end

return {
		rock = rock,
		register_rock_definition = register_rock_definition,
}
