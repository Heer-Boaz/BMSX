local fsm_library<const> = require('cartlib/fsm/library')
local fsm_component<const> = require('cartlib/fsm/fsmcomponent')
local prefab<const> = require('cartlib/prefab')
local spriteobject<const> = require('cartlib/sprite')
local timeline<const> = require('cartlib/timeline/timeline')
local timelinecomponent<const> = require('cartlib/timeline/timelinecomponent')
local world<const> = require('cartlib/world/world')
require('constants')
local combat_overlap<const> = require('combat/overlap')
local combat_damage<const> = require('combat/damage')
local rock<const> = {}
rock.__index = rock
local rock_break_timelineid<const> = 'rock.tl.break'

function rock:ctor()
	self.collider.layer = collision_enemy_layer
	self.collider.mask = collision_enemy_mask
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
	local room<const> = world:get('room')
	room:mark_rock_destroyed(self.id)
	if self.item_type == nil then
		return
	end
	if world:get('pietolon').inventory_items[self.item_type] then
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
	local drop<const> = prefab.spawn('world_item', {
		id = id,
		space_id = 'main',
		pos = { x = self.x, y = drop_y, z = 130 },
		item_id = id,
		item_type = self.item_type,
		rock_drop_id = rock_drop_id,
		rs_room_number = room.room_number,
	})
	drop:add_tag('rs')
end

local define_rock_fsm<const> = function()
		fsm_library.register('rock', {
				initial = 'idle',
				on = {
						['overlap.begin'] = function(self, _state, event)
								local contact_kind<const> = combat_overlap.classify_player_contact(event)
								if contact_kind ~= 'sword' and contact_kind ~= 'projectile' then
										return
								end
								local result<const> = combat_damage.resolve(self, combat_damage.build_weapon_request(self, 'rock', event, contact_kind))
								self:process_damage_result(result)
						end,
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
					[rock_break_timelineid] = {
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
						on_end = function(self)
							self:despawn()
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
		base = spriteobject,
		components = { timelinecomponent.new, fsm_component.factory({ 'rock' }) },
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
