local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsm_component')
local prefab<const> = require('cartlib/world/prefab')
local sprite_object<const> = require('cartlib/sprite')
local collider_2d_component<const> = require('cartlib/collision/collider_2d_component')
local timeline<const> = require('cartlib/timeline/timeline')
local timeline_component<const> = require('cartlib/timeline/timeline_component')
local world<const> = require('cartlib/world/world')
require('constants')
local combat_overlap<const> = require('combat/overlap')
local combat_damage<const> = require('combat/damage')
local rock<const> = {}
rock.__index = rock
local rock_break_timeline_id<const> = 'rock.tl.break'

function rock:ctor()
	local collider<const> = self:get_component(collider_2d_component)
	self.collider = collider
	self.last_sword_strike_id = 0
	collider.layer = collision_enemy_layer
	collider.mask = collision_enemy_mask
	self:set_imgid('stone')
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

function rock:process_damage_result(result)
	if result.status == 'rejected' then
		return
	end
	if result.destroyed then
		self.events:emit('break')
		return
	end
end

function rock:begin_break()
	local room<const> = self.room
	room:mark_rock_destroyed(self.id)
	if self.item_type == nil then
		return
	end
	if self.player.inventory_items[self.item_type] then
		return
	end
	local drop_y<const> = self.y + world_item_drop_offset_y[self.item_type]
	local id<const> = 'drop.' .. self.id
	local rock_drop_id = nil
	if not world_item_inventory[self.item_type] then
		rock_drop_id = id
		room.rock_drops[id] = {
			room_number = room.room_number,
			x = self.x,
			y = drop_y,
			item_type = self.item_type,
		}
	end
	local drop<const> = world:spawn('world_item', {
		id = id,
		space_id = 'main',
		room = room,
		player = self.player,
		pos = { x = self.x, y = drop_y, z = 130 },
		item_id = id,
		item_type = self.item_type,
		rock_drop_id = rock_drop_id,
		rs_room_number = room.room_number,
	})
	drop:add_tag('rs')
end

local define_rock_fsm<const> = function()
	local apply_weapon_contact<const> = function(self, _state, event)
		local weapon_kind<const> = combat_overlap.admit_weapon_contact(self, event)
		if weapon_kind == nil then
			return
		end
		local result<const> = combat_damage.resolve(self, combat_damage.build_weapon_request(self, 'rock', event, weapon_kind))
		self:process_damage_result(result)
	end
	fsm_library.register('rock', {
		initial = 'idle',
		on = {
			['overlap.begin'] = apply_weapon_contact,
			['overlap.stay'] = apply_weapon_contact,
		},
		states = {
			idle = {
				on = {
					['break'] = '/breaking',
					['reset'] = '/idle',
				},
			},
			breaking = {
				timelines = {
					[rock_break_timeline_id] = {
						def = {
							frames = timeline.range(rock_break_steps),
							playback_mode = 'once',
						},
						autoplay = true,
						stop_on_exit = true,
						play_options = {
							rewind = false,
							snap_to_start = true,
						},
						on_finished = function(self)
							self:mark_for_disposal()
						end,
					},
				},
				on = {
					['reset'] = '/idle',
				},
				entering_state = function(self)
					self:begin_break()
					self.collider:set_enabled(false)
					self:set_imgid('stone_broken')
				end,
			},
		},
	})
end

local register_rock_definition<const> = function()
	prefab.define({
		def_id = 'rock',
		class = rock,
		base = sprite_object,
		components = {
			collider_2d_component.new_for_sprite,
			timeline_component.new,
			fsm_component.factory({ 'rock' }),
		},
		defaults = {
			item_type = nil,
			max_health = rock_max_health,
			health = rock_max_health,
		},
	})
end

return {
		rock = rock,
		define_rock_fsm = define_rock_fsm,
		register_rock_definition = register_rock_definition,
}
