local components<const> = require('cartlib/components')
local gx_gpu<const> = require('system/gx_gpu')
local gx_image<const> = require('system/gx_image')
local spriteobject<const> = require('cartlib/sprite')
local worldobject<const> = require('cartlib/world/object')
local world<const> = require('cartlib/world/index').instance

local tile
local text
local custom
local sprite
local text_component
local text_glyph_lines
local text_first_glyph_line

local add_component_object<const> = function(id, z, component)
	local obj<const> = worldobject.new({ id = id })
	obj:add_component(component)
	world:spawn(obj, { x = 80, y = 80, z = z })
	return obj
end

local assert_visual_order<const> = function(first, second, third, fourth)
	local visuals<const> = world.active_space.active_visual_components
	assert(#visuals == 4)
	assert(visuals[1].parent.id == first)
	assert(visuals[2].parent.id == second)
	assert(visuals[3].parent.id == third)
	assert(visuals[4].parent.id == fourth)
end

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return oget('pietolon') ~= nil and oget('ui') ~= nil and oget('transition') ~= nil and oget('d') ~= nil
end

function __bmsx_host_test.setup()
	add_space('z_order_test')
	set_space('z_order_test')

	sprite = spriteobject.new({ id = 'visual_sprite' })
	world:spawn(sprite, { x = 80, y = 80, z = 40 })
	sprite:gfx('room_proxy_red')

	tile = add_component_object('visual_tile', 10, components.tilelayercomponent.new({
		sources = { gx_image.rect('room_proxy_blue') },
		tile_count = 1,
		columns = 1,
		tile_size = 16,
	}))

	text_component = components.textcomponent.new({ text = { 'x' } })
	text_component.render = function(_, x, y)
		gx_gpu.fill_rect_color(x, y, x + 16, y + 16, 0xffffffff)
	end
	text_glyph_lines = text_component.glyph_lines
	text_first_glyph_line = text_component.glyph_lines[1]
	text = add_component_object('visual_text', 20, text_component)

	custom = add_component_object('visual_custom', 30, components.customvisualcomponent.new({
		producer = function(parent)
			gx_gpu.fill_rect_color(parent.x, parent.y, parent.x + 16, parent.y + 16, 0xff00ff00)
		end,
	}))
end

function __bmsx_host_test.update(frame)
	if frame == 4 then
		assert_visual_order('visual_tile', 'visual_text', 'visual_custom', 'visual_sprite')
		assert(world.active_space.active_objects[1] == tile)
		assert(world.active_space.active_objects[4] == sprite)
		return host.capture('high_front')
	end
	if frame == 5 then
		sprite.z = 0
		text.z = 10
		custom.z = 20
		tile.z = 30
	end
	if frame == 8 then
		assert_visual_order('visual_sprite', 'visual_text', 'visual_custom', 'visual_tile')
		assert(text_component.glyph_lines == text_glyph_lines)
		assert(text_component.glyph_lines[1] == text_first_glyph_line)
		return host.capture('low_front')
	end
	return frame >= 9
end
