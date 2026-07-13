local components<const> = require('cartlib/components')
local gx_gpu<const> = require('system/gx_gpu')
local gx_image<const> = require('system/gx_image')
local worldobject<const> = require('cartlib/world/object')
local world<const> = require('cartlib/world/index').instance

local tile
local text
local sprite
local custom

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return cartlib_test_ready
end

function __bmsx_host_test.setup()
	set_space('main')

	tile = worldobject.new({ id = 'visual_tile' })
	tile:add_component(components.tilelayercomponent.new({
		sources = { gx_image.rect('whitepixel') },
		tile_count = 1,
		columns = 1,
		tile_size = 1,
	}))
	world:spawn(tile, { x = 80, y = 80, z = 10 })

	text = worldobject.new({ id = 'visual_text' })
	text:add_component(components.textcomponent.new({
		text = { '#' },
		color = 0xffff00ff,
		background_color = 0xffff00ff,
	}))
	world:spawn(text, { x = 80, y = 80, z = 20 })

	sprite = worldobject.new({ id = 'visual_sprite' })
	sprite:add_component(components.spritecomponent.new({
		imgid = 'whitepixel',
		color = 0xffff0000,
	}))
	world:spawn(sprite, { x = 80, y = 80, z = 40 })

	custom = worldobject.new({ id = 'visual_custom' })
	custom:add_component(components.customvisualcomponent.new({
		producer = function(parent)
			gx_gpu.fill_rect_color(parent.x, parent.y, parent.x + 1, parent.y + 1, 0xff00ff00)
		end,
	}))
	world:spawn(custom, { x = 80, y = 80, z = 30 })
end

function __bmsx_host_test.update(frame)
	if frame == 4 then
		return host.capture('sprite_front')
	end
	if frame == 5 then
		sprite.z = 0
		text.z = 10
		custom.z = 20
		tile.z = 30
	end
	if frame == 8 then
		return host.capture('tile_front')
	end
	return frame >= 9
end
