local constants = require('constants.lua')

local shrine_world_view = {}
shrine_world_view.__index = shrine_world_view

local glyph_color = { r = 1, g = 1, b = 1, a = 1 }

local function world_entrance_sprite_id(world_entrance_state)
	if world_entrance_state == 'opening_2' then
		return 'world_entrance_half_open'
	end
	if world_entrance_state == 'open' then
		return 'world_entrance_open'
	end
	return 'world_entrance'
end

function shrine_world_view:bind_visual()
	local renderer = self:get_component('customvisualcomponent')
	renderer.producer = function(_ctx)
		self:render()
	end
end

function shrine_world_view:ctor()
	self.last_overlay_mode = 'none'
	self:bind_visual()
end

function shrine_world_view:draw_room_objects()
	local castle_service = service(constants.ids.castle_service_instance)
	local room_state = castle_service.current_room
	if get_space() ~= room_state.space_id then
		return
	end

	local shrines = room_state.shrines
	for i = 1, #shrines do
		local shrine = shrines[i]
		put_sprite('shrine', shrine.x, shrine.y, 22)
	end

	local world_entrances = room_state.world_entrances
	for i = 1, #world_entrances do
		local world_entrance = world_entrances[i]
		local entrance_state = castle_service.world_entrance_states[world_entrance.target].state
		local sprite_id = world_entrance_sprite_id(entrance_state)
		put_sprite(sprite_id, world_entrance.x, world_entrance.y, 22)
	end
end

function shrine_world_view:draw_centered_lines(lines, y, z)
	for i = 1, #lines do
		local line = lines[i]
		local x = math.floor((display_width() - (#line * constants.room.tile_size)) / 2)
		put_glyphs(line, x, y + ((i - 1) * constants.room.tile_size), z, {
			color = glyph_color,
			layer = 'overlay',
		})
	end
end

function shrine_world_view:draw_overlay()
	local flow = service(constants.ids.flow_service_instance)
	if flow.overlay_mode == 'none' then
		return
	end

	if flow.overlay_mode == 'shrine' then
		put_sprite('shrine_inside', 0, constants.room.tile_origin_y, 340)
		local lines = flow.overlay_text_lines
		for i = 1, #lines do
			put_glyphs(lines[i], constants.shrine.text_x, constants.shrine.text_y + ((i - 1) * constants.room.tile_size), 341, {
				color = glyph_color,
				layer = 'overlay',
			})
		end
		return
	end

	if flow.overlay_mode == 'world_banner' or flow.overlay_mode == 'castle_banner' then
		self:draw_centered_lines(flow.overlay_text_lines, constants.room.tile_origin_y + (constants.room.tile_size * 9), 341)
	end
end

function shrine_world_view:render()
	self:draw_room_objects()
	self:draw_overlay()
end

local function register_shrine_world_view_definition()
	define_world_object({
		def_id = constants.ids.shrine_world_view_def,
		class = shrine_world_view,
		components = { 'customvisualcomponent' },
		defaults = {
			id = constants.ids.shrine_world_view_instance,
			space_id = constants.spaces.ui,
			registrypersistent = false,
			tick_enabled = false,
		},
	})
end

return {
	shrine_world_view = shrine_world_view,
	register_shrine_world_view_definition = register_shrine_world_view_definition,
	shrine_world_view_def_id = constants.ids.shrine_world_view_def,
	shrine_world_view_instance_id = constants.ids.shrine_world_view_instance,
}
