__bmsx_host_test = __bmsx_host_test or {
	frames = 0,
}

local components<const> = require('cartlib/components')
local world<const> = require('cartlib/world/index').instance

function __bmsx_host_test.ready()
	return oget('nemesis_s.stage') ~= nil and oget('nemesis_s.player') ~= nil
end

function __bmsx_host_test.setup()
	local boundary<const> = components.screenboundarycomponent.new({})
	assert(boundary.boundary_right == 256 and boundary.boundary_bottom == 192,
		'Nemesis screen boundary does not use its GX display mode')
	local stage<const> = oget('nemesis_s.stage')
	local player<const> = oget('nemesis_s.player')
	local stage_visual<const> = stage.stage_visual
	local player_visual<const> = player:get_component('customvisualcomponent')
	world:sort_active_visuals()
	assert(stage_visual.offset.z == 16,
		'Nemesis stage visual did not retain the asset draw_z')
	assert(stage.z + stage_visual.offset.z + stage_visual.draw_offset.z == 16)
	assert(player.z + player_visual.offset.z + player_visual.draw_offset.z == 70)
	assert(stage_visual._active_visual_index < player_visual._active_visual_index,
		'Nemesis stage must draw before the player')
end

function __bmsx_host_test.update(_frame)
	__bmsx_host_test.frames = __bmsx_host_test.frames + 1
	assert(__bmsx_host_test.frames < 120, 'nemesis_s boot timed out')
	return __bmsx_host_test.frames >= 10
end
