module<entry>
local gx_display<const> = require('cartlib/gx/display')
local gx_texture<const> = require('cartlib/gx/texture')
local vblank<const> = require('cartlib/gx/vblank')
gx_display.reset_256x192()
local input<const> = require('cartlib/input/input')
input.add_player(1)
local irq_module<const> = require('cartlib/irq')
local world<const> = require('cartlib/world/world')
local world_module<const> = require('world_module')
world:configure(world_module)
irq = irq_module.dispatch
require('constants')
local stage_module<const> = require('stage')
local player_module<const> = require('player/player')
local director_module<const> = telemetry_enabled and require('director')
local function init<init>()
	irq_module.register(vblank.irq_mask, vblank.on_irq)
	stage_module.define_stage_fsm()
	if telemetry_enabled then
		director_module.define_director_fsm()
	end
	player_module.define_player_fsm()
	stage_module.register_stage_definition()
	if telemetry_enabled then
		director_module.register_director_definition()
	end
	player_module.register_player_definition()
end

function new_game()
	world:clear()
	local stage<const> = world:spawn(stage_module.stage_def_id, {
		id = stage_module.stage_instance_id,
		pos = { x = 0, y = 0, z = 0 },
	})
	if telemetry_enabled then
		world:spawn(director_module.director_def_id, {
			id = director_module.director_instance_id,
			stage = stage,
			pos = { x = 0, y = 0, z = 0 },
		})
	end
	world:spawn(player_module.player_def_id, {
		id = player_module.player_instance_id,
		player_index = 1,
		stage = stage,
		pos = { x = player_start_x, y = player_start_y, z = 70 },
	})
end

init()
gx_texture.upload('ground')
new_game()
vblank.wait()

while true do
	world:update()
	vblank.wait()
	world:render()
end
