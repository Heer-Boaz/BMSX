module<entry>
local gx_gpu<const> = require('cartlib/gx/gpu')
local gx_image<const> = require('cartlib/gx/image')
local gx_texture<const> = require('cartlib/gx/texture')
local texture_layout<const> = require('bmsx/gx_texture_layout')
gx_gpu.reset_256x192()
local ecs_pipeline_registry<const> = require('cartlib/ecs/pipeline').defaultecspipelineregistry
local object_fsm_system<const> = require('cartlib/ecs/systems/object_fsm')
local timeline_system<const> = require('cartlib/ecs/systems/timeline')
local visual_render_system<const> = require('cartlib/ecs/systems/visual_render')
local cart_input<const> = require('cartlib/input/player')
local irq_module<const> = require('cartlib/irq')
local prefab<const> = require('cartlib/prefab')
local world<const> = require('cartlib/world/index').instance
irq = irq_module.dispatch
require('constants')
local stage_module<const> = require('stage')
local player_module<const> = require('player/index')
local director_module<const> = require('director')
local irq_mask_register<const>: *word = 0x08000008
local input_control_register<const>: *word = 0x08000064
local irq_vblank<const> = 0x0004
local vblank_count = 0

local pipeline_descriptors<const> = {
	object_fsm_system,
	timeline_system,
	visual_render_system,
}
local pipeline_spec<const> = {
	{ ref = object_fsm_system.id },
	{ ref = timeline_system.id },
	{ ref = visual_render_system.id },
}

local wait_vblank<const> = function()
	repeat
		halt_until_irq
	until vblank_count ~= 0
	vblank_count = vblank_count - 1
end

function init()
	ecs_pipeline_registry:register_many(pipeline_descriptors)
	irq_module.register(irq_vblank, function()
		vblank_count = vblank_count + 1
	end)
	*irq_mask_register = irq_vblank
	gx_gpu.clear_color(0xff000000)
	stage_module.define_stage_fsm()
	director_module.define_director_fsm()
	player_module.define_player_fsm()
	stage_module.register_stage_definition()
	director_module.register_director_definition()
	player_module.register_player_definition()
	gx_texture.upload(gx_image.rect('ground').texture, texture_layout.stage)
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
*input_control_register = 0x00000001
new_game()
*input_control_register = 0x00000001
wait_vblank()

while true do
	cart_input.update()
	world:update()
	*input_control_register = 0x00000001
	wait_vblank()
	gx_gpu.clear_color(0xff000000)
	world:draw()
end
