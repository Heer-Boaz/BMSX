module<entry>
local gx_display<const> = require('cartlib/gx/display')
local image<const> = require('cartlib/gx/image')
local gx_texture<const> = require('cartlib/gx/texture')
local texture_layout<const> = require('bmsx/gx_texture_layout')
gx_display.reset_256x192()
local ecs_pipeline_registry<const> = require('cartlib/ecs/pipeline').defaultecspipelineregistry
local object_fsm_system<const> = require('cartlib/ecs/systems/object_fsm')
local timeline_system<const> = require('cartlib/ecs/systems/timeline')
local input<const> = require('cartlib/input/player')
input.add_player(1)
local irq_module<const> = require('cartlib/irq')
local prefab<const> = require('cartlib/prefab')
local render<const> = require('cartlib/render/renderer')
local world<const> = require('cartlib/world/world').instance
irq = irq_module.dispatch
require('constants')
local stage_module<const> = require('stage')
local player_module<const> = require('player/player')
local director_module<const> = require('director')
local irq_mask_register<const>: *word = 0x08000008
local input_control_register<const>: *word = 0x08000064
local pipeline_descriptors<const> = {
	object_fsm_system,
	timeline_system,
}
local pipeline_spec<const> = {
	{ ref = object_fsm_system.id },
	{ ref = timeline_system.id },
}

function init()
	ecs_pipeline_registry:register_many(pipeline_descriptors)
	*irq_mask_register = 0
	stage_module.define_stage_fsm()
	director_module.define_director_fsm()
	player_module.define_player_fsm()
	stage_module.register_stage_definition()
	director_module.register_director_definition()
	player_module.register_player_definition()
end

function new_game()
	world:clear()
	ecs_pipeline_registry:build(world, pipeline_spec)
	prefab.spawn(stage_module.stage_def_id, {
		id = stage_module.stage_instance_id,
		pos = { x = 0, y = 0, z = 0 },
	})
	prefab.spawn(director_module.director_def_id, {
		id = director_module.director_instance_id,
		pos = { x = 0, y = 0, z = 0 },
	})
	prefab.spawn(player_module.player_def_id, {
		id = player_module.player_instance_id,
		player_index = 1,
		pos = { x = player_start_x, y = player_start_y, z = 70 },
	})
end

init()
local renderer<const> = render.new(world, 0, 0xff000000)
gx_texture.upload(image.load('ground').texture, texture_layout.stage)
*input_control_register = 0x00000001
new_game()
*input_control_register = 0x00000001
renderer:wait_vblank()

while true do
	input.update()
	world:update()
	*input_control_register = 0x00000001
	renderer:wait_vblank()
	renderer:render()
end
