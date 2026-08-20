local custom_visual_component<const> = require('cartlib/component/custom_visual_component')
local font<const> = require('cartlib/font')
local image<const> = require('cartlib/gx/image')
local prefab<const> = require('cartlib/world/prefab')
local text_component<const> = require('cartlib/text/text_component')
local nemesis_font<const> = require('nemesis_font')

local status_bar<const> = {}
status_bar.__index = status_bar

local definition_id<const> = 'nemesis_s.status_bar'
local instance_id<const> = 'nemesis_s.status_bar'
local player_capacity<const> = 2
local initial_lives<const> = 9
local slot_count<const> = 5
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
	for player_index = 1, owner.player_count do
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

local select_slot_source<const> = function(row, slot_index)
	if row.current_slot == slot_index then
		if row.powerup_taken[slot_index] then
			return sources.taken_current
		end
		return sources.filled
	end
	if row.powerup_taken[slot_index] then
		return sources.taken
	end
	return sources.empty
end

local select_description_source<const> = function(row)
	local slot_index<const> = row.current_slot
	if slot_index == 0 or row.powerup_taken[slot_index] then
		return sources.enabled
	end
	return sources.description[slot_index]
end

function status_bar:set_player_count(player_count)
	self.player_count = player_count
	local rows<const> = self.rows
	for player_index = 1, player_capacity do
		rows[player_index].life_text.visible = player_index <= player_count
	end
end

function status_bar:set_lives(player_index, lives)
	local text
	if lives < 0 then
		text = '-'
	else
		text = tostring(lives)
	end
	self.rows[player_index].life_text:set_text(text)
end

function status_bar:set_powerup_taken(player_index, slot_index, taken)
	local row<const> = self.rows[player_index]
	row.powerup_taken[slot_index] = taken
	row.powerup_sources[slot_index] = select_slot_source(row, slot_index)
	if row.current_slot == slot_index then
		row.description_source = select_description_source(row)
	end
end

function status_bar:set_current_slot(player_index, slot_index)
	local row<const> = self.rows[player_index]
	local previous<const> = row.current_slot
	row.current_slot = slot_index
	if previous ~= 0 then
		row.powerup_sources[previous] = select_slot_source(row, previous)
	end
	if slot_index ~= 0 then
		row.powerup_sources[slot_index] = select_slot_source(row, slot_index)
	end
	row.description_source = select_description_source(row)
end

function status_bar:reset(player_count)
	local rows<const> = self.rows
	for player_index = 1, player_capacity do
		local row<const> = rows[player_index]
		row.current_slot = 0
		row.description_source = sources.enabled
		for slot_index = 1, slot_count do
			row.powerup_taken[slot_index] = false
			row.powerup_sources[slot_index] = sources.empty
		end
		self:set_lives(player_index, initial_lives)
	end
	self:set_player_count(player_count)
end

function status_bar:ctor()
	self:get_component(custom_visual_component):set_draw_function(draw_status_bar)
	local resolved_font<const> = font.get(nemesis_font.font_id)
	local rows<const> = {}
	for player_index = 1, player_capacity do
		local life_text<const> = text_component.new({
			id_local = 'life_' .. tostring(player_index),
			font = resolved_font,
			offset_x = life_x,
			offset_y = bar_y + (player_index - 1) * row_height,
			offset_z = 1,
		})
		self:add_component(life_text)
		rows[player_index] = {
			current_slot = 0,
			powerup_taken = {},
			powerup_sources = {},
			description_source = sources.enabled,
			life_text = life_text,
		}
	end
	self.rows = rows
	self:reset(self.player_count)
end

local register_definition<const> = function()
	prefab.define({
		def_id = definition_id,
		class = status_bar,
		components = {
			custom_visual_component.new,
		},
		defaults = {
			id = instance_id,
			player_count = 1,
		},
	})
end

return {
	definition_id = definition_id,
	instance_id = instance_id,
	register_definition = register_definition,
}
