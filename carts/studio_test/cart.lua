module<entry>
local display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
local world<const> = require('cartlib/world/world')
local prefab<const> = require('cartlib/world/prefab')
local input_system<const> = require('cartlib/input/input_system')
local custom_visual<const> = require('cartlib/component/custom_visual_component')
local scene_library<const> = require('cartlib/world/scene_library')

-- This cartridge owns the live transport and authored sources used by generic
-- Studio integration tests. Specialized tests install their own source through
-- ordinary Save/Reboot; no normal game supplies their boot or asset contract.
struct studio_test_record
	value: word
end
rodata studio_test_data: studio_test_record = { value = 42 }

display.reset_256x192()
world:configure({ framebuffer_count = 1, gameplay_interval_vblanks = 1,
	frame_interval_vblanks = 1, spaces = { 'main' }, systems = { input_system } })

local draw<const> = function(component, commands)
	local pose<const> = component.owner.spatial:resolve_world()
	commands:rect(pose.wox, pose.woy, pose.wox + 64, pose.woy + 48, component.owner.color)
end
prefab.define({ def_id = 'studio_test.actor', class = {},
	spatial = { family = '2d', authority = 'affine', local_transform = { 1, 0, 0, 1, 16, 24 } },
	components = { custom_visual.factory({ draw = draw }) } })
local root_scene<const> = require('scenes/root')
root_scene.register()

function new_game()
	world:clear()
	local scene<const> = scene_library.instantiate(root_scene.id)
	studio_test_actor = scene.members.first
end

new_game()
studio_test_ready = true
studio_test_rendered_frames = 0
while true do
	world:update()
	vblank.wait()
	world:render()
	studio_test_rendered_frames = studio_test_rendered_frames + 1
end
