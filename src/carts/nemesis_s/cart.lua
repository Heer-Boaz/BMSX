local engine = require('engine')
local constants = require('constants.lua')
local stage_module = require('stage.lua')
local player_module = require('player.lua')
local director_module = require('director.lua')

local function service_irqs()
	local flags = peek(sys_irq_flags)
	if flags ~= 0 then
		irq(flags)
	end
end

function init()
	poke(sys_vdp_dither, 0)
	on_irq(irq_reinit, function()
		init()
	end)
	on_irq(irq_newgame, function()
		new_game()
	end)
	stage_module.define_stage_fsm()
	director_module.define_director_fsm()
	player_module.define_player_fsm()
	stage_module.register_stage_definition()
	director_module.register_director_definition()
	player_module.register_player_definition()
	vdp_load_slot(0, 0)
	vdp_map_slot(0, 0)
end

function new_game()
	engine.reset()
	spawn_object(stage_module.stage_def_id, {
		id = stage_module.stage_instance_id,
		pos = { x = 0, y = 0, z = 0 },
	})
	spawn_object(director_module.director_def_id, {
		id = director_module.director_instance_id,
		pos = { x = 0, y = 0, z = 0 },
	})
	spawn_object(player_module.player_def_id, {
		id = player_module.player_instance_id,
		player_index = 1,
		pos = { x = constants.player.start_x, y = constants.player.start_y, z = 70 },
	})
end

while true do
	wait_vblank()
	service_irqs()
	engine.update()
end
