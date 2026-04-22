local ecs<const> = require('ecs/index')
local ecs_builtin<const> = require('ecs/builtin')
local ecs_pipeline<const> = require('ecs/pipeline')
local world_instance<const> = require('world/index').instance

local tickgroup<const> = ecs.tickgroup
local ecsystem<const> = ecs.ecsystem

local elevator_update_system<const> = {}
elevator_update_system.__index = elevator_update_system
setmetatable(elevator_update_system, { __index = ecsystem })

local pipeline_ref<const> = 'eup'

function elevator_update_system:update()
	local player<const> = oget('pietolon')
	player.next_vertical_elevator = false
	player.next_vertical_elevator_id = nil
	for elevator in world_instance:objects_by_type('elevator_platform') do
		elevator:update_motion()
	end
	player.on_vertical_elevator = player.next_vertical_elevator
	player.vertical_elevator_id = player.next_vertical_elevator_id
end

local apply_pipeline<const> = function()
	ecs_pipeline.defaultecspipelineregistry:register({
		id = pipeline_ref,
		group = tickgroup.moderesolution,
		default_priority = 20,
		create = function(priority)
			return setmetatable(ecsystem.new(tickgroup.moderesolution, priority), elevator_update_system)
		end,
	})
	local nodes<const> = ecs_builtin.default_pipeline_spec()
	nodes[#nodes + 1] = { ref = pipeline_ref }
	nodes[#nodes + 1] = { ref = 'overlapevents' }
	ecs_pipeline.defaultecspipelineregistry:build(world_instance, nodes)
end

return {
	apply_pipeline = apply_pipeline,
}
