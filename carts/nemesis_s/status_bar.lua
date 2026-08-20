local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local font<const> = require('cartlib/font')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local text_component<const> = require('cartlib/text/text_component')
local nemesis_font<const> = require('nemesis_font')
local player_state<const> = require('player/player_state')

local status_bar<const> = {}
status_bar.__index = status_bar

local definition_id<const> = 'nemesis_s.status_bar'
local instance_id<const> = 'nemesis_s.status_bar'
local player_state_events<const> = player_state.events
local no_powerup_slot<const> = player_state.no_powerup_slot
local powerup_max_levels<const> = player_state.powerup_max_levels
local slot_count<const> = #powerup_max_levels
local bar_x<const> = 8
local bar_y<const> = 176
local bar_stride_x<const> = 16
local row_height<const> = 8
local description_x<const> = 160
local life_x<const> = 240
local ship_x<const> = 248
local sources<const> = {
	empty = image.resolve('status_powerup_empty'),
	filled = image.resolve('status_powerup_filled'),
	taken = image.resolve('status_powerup_taken'),
	taken_current = image.resolve('status_powerup_taken_current'),
	description = {
		image.resolve('status_description_speed'),
		image.resolve('status_description_missile'),
		image.resolve('status_description_laser'),
		image.resolve('status_description_option'),
		image.resolve('status_description_shield'),
	},
	enabled = image.resolve('status_description_enabled'),
	ship = image.resolve('status_ship'),
}

local draw_status_bar<const> = function(component, draw)
	local owner<const> = component.parent
	local rows<const> = owner.rows
	for player_index = 1, #rows do
		local row<const> = rows[player_index]
		local y<const> = bar_y + (player_index - 1) * row_height
		local powerup_sources<const> = row.powerup_sources
		for slot_index = 1, slot_count do
			powerup_sources[slot_index]:blit(draw, bar_x + (slot_index - 1) * bar_stride_x, y)
		end
		row.description_source:blit(draw, description_x, y)
		sources.ship:blit(draw, ship_x, y)
	end
end
local new_status_bar_visual<const> = custom_visual_component.factory(draw_status_bar)

local select_slot_source<const> = function(row, slot_index)
	local state<const> = row.player_state
	local taken<const> = state.powerup_levels[slot_index] >= powerup_max_levels[slot_index]
	if state.current_powerup_slot == slot_index then
		if taken then
			return sources.taken_current
		end
		return sources.filled
	end
	if taken then
		return sources.taken
	end
	return sources.empty
end

local select_description_source<const> = function(row)
	local state<const> = row.player_state
	local slot_index<const> = state.current_powerup_slot
	if slot_index == no_powerup_slot
		or state.powerup_levels[slot_index] >= powerup_max_levels[slot_index] then
		return sources.enabled
	end
	return sources.description[slot_index]
end

local refresh_lives<const> = function(self, _event, source)
	local row<const> = self.rows[source.player_index]
	local lives<const> = source.lives
	local text
	if lives < 0 then
		text = '-'
	else
		text = tostring(lives)
	end
	row.life_text:set_text(text)
end

local refresh_powerups<const> = function(self, _event, source)
	local row<const> = self.rows[source.player_index]
	for slot_index = 1, slot_count do
		row.powerup_sources[slot_index] = select_slot_source(row, slot_index)
	end
	row.description_source = select_description_source(row)
end

function status_bar:bind()
	local rows<const> = self.rows
	for player_index = 1, #rows do
		local state<const> = rows[player_index].player_state
		self.events:on({
			event = player_state_events.lives_changed,
			emitter = state.id,
			handler = refresh_lives,
		})
		self.events:on({
			event = player_state_events.powerups_changed,
			emitter = state.id,
			handler = refresh_powerups,
		})
	end
end

function status_bar:ctor()
	local resolved_font<const> = font.get(nemesis_font.font_id)
	local rows<const> = {}
	self.rows = rows
	for player_index = 1, #self.player_states do
		local life_text<const> = text_component.new({
			id_local = 'life_' .. tostring(player_index),
			font = resolved_font,
			offset_x = life_x,
			offset_y = bar_y + (player_index - 1) * row_height,
			offset_z = 1,
		})
		self:add_component(life_text)
		local row<const> = {
			player_state = self.player_states[player_index],
			powerup_sources = {},
			description_source = sources.enabled,
			life_text = life_text,
		}
		rows[player_index] = row
		refresh_lives(self, nil, self.player_states[player_index])
		refresh_powerups(self, nil, self.player_states[player_index])
	end
end

local register_definition<const> = function()
	prefab.define({
		def_id = definition_id,
		class = status_bar,
		components = {
			new_status_bar_visual,
		},
		defaults = {
			id = instance_id,
		},
	})
end

return {
	definition_id = definition_id,
	instance_id = instance_id,
	register_definition = register_definition,
}
