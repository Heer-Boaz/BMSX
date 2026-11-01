module<entry>
local display<const> = require('cartlib/gx/display')
local vblank<const> = require('cartlib/gx/vblank')
local world<const> = require('cartlib/world/world')
local prefab<const> = require('cartlib/world/prefab')
local object_2d<const> = require('cartlib/world/object_2d')
local sprite_object<const> = require('cartlib/sprite')
local input_system<const> = require('cartlib/input/input_system')
local rectangle_component<const> = require('cartlib/component/rectangle_component')
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

prefab.define({ def_id = 'studio_test.actor', class = object_2d,
	position = { x = 16, y = 24 },
	defaults = { width = 64, height = 48, color = 0xff26a3bb },
	components = { function(owner) return rectangle_component.new(owner, owner) end } })
prefab.define({ def_id = 'studio_test.marker', class = sprite_object,
	defaults = { imgid = 'studio_test_marker' } })
local root_scene<const> = require('scenes/root')
root_scene.register()
require('scenes/space')
local boolean_scene<const> = require('scenes/boolean')
boolean_scene.register()

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
