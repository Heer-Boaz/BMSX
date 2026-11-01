local scenes<const> = require('cartlib/world/scene_library')
local prefab<const> = require('cartlib/world/prefab')
local object_2d<const> = require('cartlib/world/object_2d')
local sprite<const> = require('cartlib/sprite')
local animation<const> = require('cartlib/component/sprite_animation_component')
local animated_scene<const> = {}
local actor<const> = {}
setmetatable(actor, { __index = sprite })

actor.primary_sprite_factory = animation.factory({
	animation = 'idle',
	animations = {
		idle = { frames = { 'studio_test_marker', 'tiny_3b_font_code_0x41' }, frame_duration_ms = 40 },
		alternate = { frames = { 'tiny_3b_font_code_0x42', 'tiny_3b_font_code_0x43' }, frame_duration_ms = 40 },
	},
})

function actor.initialize(owner)
	sprite.initialize(owner)
	owner.health = 3
end

function animated_scene.register()
	prefab.define({ def_id = 'studio_test.animated', class = actor,
		components = { animation.factory({ frames = { 'tiny_3b_font_code_0x44' }, frame_duration_ms = 40, enabled = false }) } })
	prefab.define({ def_id = 'studio_test.sequence', class = object_2d,
		components = { animation.factory({ frames = { 'tiny_3b_font_code_0x45', 'tiny_3b_font_code_0x46' },
			frame_duration_ms = 40, color = 0xffbd7841 }) } })
	scenes.register('studio_test.animated', { objects = {
		{ member_id = 'actor', definition_id = 'studio_test.animated', position = { x = 32, y = 48 },
			options = { animation = 'idle' } },
		{ member_id = 'alternate', definition_id = 'studio_test.animated', position = { x = 96, y = 48 },
			options = { animation = 'alternate' } },
		{ member_id = 'sequence', definition_id = 'studio_test.sequence', position = { x = 64, y = 96 } },
	} })
end

return animated_scene
