local components<const> = require('cartlib/components')
local castle_map<const> = require('castle/map')
local ecs<const> = require('cartlib/ecs/index')
local font<const> = require('system/font')
local textobject<const> = require('cartlib/text/object')
local worldobject<const> = require('cartlib/world/object')
local world<const> = require('cartlib/world/index').instance

local a_object
local a
local b
local c
local noop<const> = function() end

local spawn_visual<const> = function(id)
	local obj<const> = worldobject.new({ id = id })
	local visual<const> = components.customvisualcomponent.new({ producer = noop })
	obj:add_component(visual)
	world:spawn(obj, { x = 0, y = 0, z = 10 })
	return obj, visual
end

local visual_index<const> = function(id)
	local visuals<const> = world.active_space.active_visual_components
	for i = 1, #visuals do
		if visuals[i].parent.id == id then
			return i
		end
	end
	return 0
end

local assert_order<const> = function(first, second, third)
	local first_index<const> = visual_index(first)
	local second_index<const> = visual_index(second)
	assert(first_index ~= 0 and second_index ~= 0)
	assert(first_index < second_index)
	if third ~= nil then
		local third_index<const> = visual_index(third)
		assert(third_index ~= 0 and second_index < third_index)
	end
end

local effective_depth<const> = function(visual)
	return visual.parent.z + visual.offset.z + visual.draw_offset.z
end

local assert_pietious_visual_order<const> = function()
	oget('ui'):set_space('main')
	oget('d'):set_space('main')
	set_space('main')
	world:sort_active_visuals()
	local room<const> = oget('room')
	local player<const> = oget('pietolon')
	local room_effect<const> = room:get_component('customvisualcomponent')
	local hud<const> = oget('ui'):get_component('customvisualcomponent')
	local director<const> = oget('d'):get_component('customvisualcomponent')
	assert(effective_depth(room.room_tile_layer) == 0, 'room tile depth')
	assert(effective_depth(player.sprite_component) == 250, 'player sprite depth')
	assert(effective_depth(room_effect) == draw_z_room_effect, 'room effect depth')
	assert(effective_depth(hud) == draw_z_hud, 'HUD depth')
	assert(effective_depth(director) == draw_z_director_effect, 'director effect depth')
	assert(room.room_tile_layer._active_visual_index < player.sprite_component._active_visual_index, 'room tiles before player')
	assert(player.sprite_component._active_visual_index < room_effect._active_visual_index, 'player before room effect')
	assert(room_effect._active_visual_index < hud._active_visual_index,
		'room effect before HUD: room=' .. room_effect._active_visual_index .. ', hud=' .. hud._active_visual_index)
	assert(hud._active_visual_index < director._active_visual_index, 'HUD before director effect')

	local wall_def
	for _, room_template in pairs(castle_map.room_templates) do
		for i = 1, #room_template.enemies do
			local enemy<const> = room_template.enemies[i]
			if enemy.kind == 'breakablewall' or enemy.kind == 'disappearingwall' then
				assert(enemy.draw_z == draw_z_environment_wall, 'wall map producer depth')
				wall_def = enemy
			end
		end
	end
	assert(wall_def ~= nil, 'wall map producer fixture')
	local wall<const> = inst('enemy.' .. wall_def.kind, {
		id = 'visual_depth_wall',
		space_id = 'main',
		pos = { x = 0, y = room_tile_origin_y, z = wall_def.draw_z },
		trigger = wall_def.trigger,
		conditions = wall_def.conditions,
		damage = wall_def.damage,
		health = wall_def.health,
		max_health = wall_def.health,
		width_tiles = wall_def.width_tiles,
		height_tiles = wall_def.height_tiles,
		tiletype = wall_def.tiletype,
	})
	local wall_visual<const> = wall:get_component('tilelayercomponent')
	world:sort_active_visuals()
	assert(effective_depth(wall_visual) == draw_z_environment_wall, 'wall visual depth')
	assert(room.room_tile_layer._active_visual_index < wall_visual._active_visual_index, 'room tiles before wall tiles')
	assert(wall_visual._active_visual_index < player.sprite_component._active_visual_index, 'wall tiles before actor sprites')
	assert(effective_depth(wall_visual) < 130, 'wall tiles before item sprites')
	world:despawn(wall)
end

local assert_retained_text_layout<const> = function()
	local empty<const> = components.textcomponent.new({})
	assert(#empty.glyph_lines == 0, 'empty retained text layout')

	local wrapped<const> = components.textcomponent.new({ text = 'abcd', wrap_chars = 2 })
	assert(#wrapped.glyph_lines == 2 and #wrapped.glyph_lines[1] == 2 and #wrapped.glyph_lines[2] == 2, 'wrapped retained text layout')
	local first_line<const> = wrapped.glyph_lines[1]
	wrapped:set_text('efgh')
	assert(wrapped.glyph_lines[1] == first_line, 'text mutation retains glyph line storage')
	wrapped:set_wrap_chars(4)
	assert(#wrapped.glyph_lines == 1 and wrapped.glyph_lines[1] == first_line, 'wrap mutation rebuilds retained layout')
	wrapped:set_font(font.get('pietious'))
	assert(wrapped.glyph_lines[1] == first_line and wrapped.line_height == wrapped.font.line_height, 'font mutation rebuilds retained layout')

end

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return oget('pietolon') ~= nil and oget('ui') ~= nil and oget('transition') ~= nil and oget('d') ~= nil
end

function __bmsx_host_test.setup()
	local presentation<const> = world.systems.phase_systems[ecs.tickgroup.presentation]
	assert(world.systems.phase_counts[ecs.tickgroup.presentation] == 1)
	assert(presentation[1].id == 'ecs:visualrender')
	assert_pietious_visual_order()
	assert_retained_text_layout()

	add_space('visual_lifecycle')
	add_space('visual_lifecycle_other')
	set_space('visual_lifecycle')
	local positioned_text<const> = textobject.new({
		id = 'positioned_text',
		dimensions = { left = 20, top = 12, right = 60, bottom = 28 },
	})
	world:spawn(positioned_text, { x = 10, y = 5, z = 20 })
	assert(positioned_text.x + positioned_text.text_component.offset.x == 40, 'spawn-positioned text horizontal layout')
	assert(positioned_text.y + positioned_text.text_component.offset.y == 12, 'spawn-positioned text vertical layout')

	local highlighted<const> = textobject.new({
		id = 'highlighted_text',
		dimensions = { left = 0, top = 0, right = 24, bottom = 64 },
	})
	world:spawn(highlighted, { x = 0, y = 0, z = 21 })
	highlighted:set_text({ 'abcdefgh' }, { typed = false, snap = true })
	highlighted:set_highlighted_line(0)
	local two_line_height<const> = highlighted.highlight_target_h
	highlighted:set_text({ 'abcdefghijkl' }, { typed = false, snap = true })
	assert(highlighted.highlight_target_h > two_line_height, 'same highlight index follows text reflow')
	local three_line_height<const> = highlighted.highlight_target_h
	highlighted:set_dimensions({ left = 0, top = 0, right = 12, bottom = 64 })
	assert(highlighted.highlight_target_h > three_line_height, 'same highlight index follows dimension reflow')

	local typed<const> = textobject.new({
		id = 'typed_text',
		dimensions = { left = 0, top = 0, right = 64, bottom = 16 },
	})
	world:spawn(typed, { x = 0, y = 0, z = 22 })
	typed:set_text({ 'abc' }, { typed = true, snap = false })
	for _ = 1, 4 do
		typed:type_next()
	end
	assert(not typed:is_typing(), 'retained typewriter completion')
	assert(#typed.text_component.glyph_lines[1] == 3, 'retained typewriter glyph count')
	typed:set_font(font.get('pietious'))
	assert(#typed.text_component.glyph_lines[1] == 3, 'font mutation preserves typed text')
	a_object, a = spawn_visual('visual_a')
	local _
	_, b = spawn_visual('visual_b')
	_, c = spawn_visual('visual_c')
end

function __bmsx_host_test.update(frame)
	if frame == 3 then
		assert_order('visual_a', 'visual_b', 'visual_c')
		b:set_enabled(false)
		assert(visual_index('visual_b') == 0)
		assert_order('visual_a', 'visual_c')
	elseif frame == 4 then
		b:set_enabled(true)
		assert_order('visual_a', 'visual_c', 'visual_b')
	elseif frame == 5 then
		c:detach()
		assert(visual_index('visual_c') == 0)
		assert_order('visual_a', 'visual_b')
	elseif frame == 6 then
		a_object:set_space('visual_lifecycle_other')
		assert(visual_index('visual_a') == 0)
		set_space('visual_lifecycle_other')
		assert(visual_index('visual_a') == 1)
		set_space('visual_lifecycle')
	elseif frame == 7 then
		a_object:set_space('visual_lifecycle')
		assert_order('visual_b', 'visual_a')
		return true
	end
	return false
end
