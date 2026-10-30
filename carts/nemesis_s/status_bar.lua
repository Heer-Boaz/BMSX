local visual_2d<const> = require('cartlib/component/visual_2d_component')
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
local bar_y<const> = 0
local bar_stride_x<const> = 16
local row_height<const> = 8
local description_x<const> = 160
local life_x<const> = 240
local ship_x<const> = 248
local speed_description<const> = image.resolve('status_description_speed')
local option_description<const> = image.resolve('status_description_option')
local sources<const> = {
	empty = image.resolve('status_powerup_empty'),
	filled = image.resolve('status_powerup_filled'),
	taken = image.resolve('status_powerup_taken'),
	taken_current = image.resolve('status_powerup_taken_current'),
	description = {
		{ speed_description, speed_description, speed_description },
		{
			image.resolve('status_description_missile_1'),
			image.resolve('status_description_missile_2'),
			image.resolve('status_description_napalm'),
		},
		{
			image.resolve('status_description_laser_1'),
			image.resolve('status_description_laser_2'),
			image.resolve('status_description_extended_laser'),
		},
		{
			image.resolve('status_description_uplaser_1'),
			image.resolve('status_description_uplaser_2'),
		},
		{ option_description, option_description, option_description, option_description },
		{ image.resolve('status_description_shield') },
	},
	enabled = image.resolve('status_description_enabled'),
	ship = image.resolve('status_ship'),
}

local draw_status_bar<const> = function(component, draw)
	component:resolve_pose()
	local owner<const> = component.owner
	local rows<const> = owner.rows
	local x<const>, origin_y<const> = component.wox, component.woy
	if not component._translation_only then
		local xx<const>, xy<const>, yx<const>, yy<const> = component.wxx, component.wxy, component.wyx, component.wyy
		for player_index = 1, #rows do
			local row<const> = rows[player_index]
			local y<const> = bar_y + (player_index - 1) * row_height
			if row.powerups_visible then
				for slot_index = 1, slot_count do
					local source<const> = row.powerup_sources[slot_index]
					local local_x<const> = bar_x + (slot_index - 1) * bar_stride_x
					source:draw_affine(draw, x + xx * local_x + yx * y, origin_y + xy * local_x + yy * y,
						xx * source.width, xy * source.width, yx * source.height, yy * source.height, 0, 0xffffffff, 0)
				end
				local source<const> = row.description_source
				source:draw_affine(draw, x + xx * description_x + yx * y, origin_y + xy * description_x + yy * y,
					xx * source.width, xy * source.width, yx * source.height, yy * source.height, 0, 0xffffffff, 0)
			end
			local source<const> = sources.ship
			source:draw_affine(draw, x + xx * ship_x + yx * y, origin_y + xy * ship_x + yy * y,
				xx * source.width, xy * source.width, yx * source.height, yy * source.height, 0, 0xffffffff, 0)
		end
		return
	end
	for player_index = 1, #rows do
		local row<const> = rows[player_index]
		local y<const> = origin_y + bar_y + (player_index - 1) * row_height
		if row.powerups_visible then
			local powerup_sources<const> = row.powerup_sources
			for slot_index = 1, slot_count do
				powerup_sources[slot_index]:blit(draw, x + bar_x + (slot_index - 1) * bar_stride_x, y)
			end
			row.description_source:blit(draw, x + description_x, y)
		end
		sources.ship:blit(draw, x + ship_x, y)
	end
end
local status_visual<const> = {}
status_visual.__index = status_visual
setmetatable(status_visual, { __index = visual_2d })

function status_visual.new(context)
	local self<const> = visual_2d.new(context, 'status')
	setmetatable(self, status_visual)
	self:set_draw_function(draw_status_bar)
	return self
end

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
	return sources.description[slot_index][state.powerup_levels[slot_index] + 1]
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
	row.powerups_visible = lives >= 0
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
			event = player_state_events.powerup_selection_changed,
			emitter = state.id,
			handler = refresh_powerups,
		})
		self.events:on({
			event = player_state_events.powerup_level_changed,
			emitter = state.id,
			handler = refresh_powerups,
		})
		self.events:on({
			event = player_state_events.powerup_loadout_changed,
			emitter = state.id,
			handler = refresh_powerups,
		})
	end
end

function status_bar:ctor(_options, _definition_id, context)
	local rows<const> = {}
	self.rows = rows
	for player_index = 1, #self.player_states do
		local life_text<const> = text_component.new(context, 'life_' .. tostring(player_index))
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
		spatial = { family = '2d', authority = 'affine' },
		initial = {
			life_1 = { font = font.get(nemesis_font.font_id), attachment_affine = { 1, 0, 0, 1, life_x, bar_y } },
			life_2 = { font = font.get(nemesis_font.font_id), attachment_affine = { 1, 0, 0, 1, life_x, bar_y + row_height } },
		},
		components = {
			status_visual.new,
		},
	})
end

return {
	definition_id = definition_id,
	instance_id = instance_id,
	register_definition = register_definition,
}
