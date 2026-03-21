local ecs = require('ecs')
local ecs_builtin = require('ecs_builtin')
local ecs_pipeline = require('ecs_pipeline')
local world_instance = require('world').instance

local tickgroup = ecs.tickgroup
local ecsystem = ecs.ecsystem

local elevator_update_system = {}
elevator_update_system.__index = elevator_update_system
setmetatable(elevator_update_system, { __index = ecsystem })

local pipeline_registered = false
local pipeline_ref = 'pt.eup'

function elevator_update_system:update()
	local player = object('pietolon')
	player.next_vertical_elevator = false
	player.next_vertical_elevator_id = nil
	for elevator in world_instance:objects_by_type('elevator_platform', { scope = 'active' }) do
		elevator:update_motion()
	end
	player.on_vertical_elevator = player.next_vertical_elevator
	player.vertical_elevator_id = player.next_vertical_elevator_id
end

local function register_pipeline()
	if pipeline_registered then
		return
	end
	ecs_pipeline.defaultecspipelineregistry:register({
		id = pipeline_ref,
		group = tickgroup.moderesolution,
		default_priority = 20,
		create = function(priority)
			return setmetatable(ecsystem.new(tickgroup.moderesolution, priority), elevator_update_system)
		end,
	})
	pipeline_registered = true
end

local function build_pipeline_spec()
	local nodes = ecs_builtin.default_pipeline_spec()
	local insert_at = #nodes + 1
	for i = 1, #nodes do
		if nodes[i].ref == 'objecttick' then
			insert_at = i + 1
			break
		end
	end
	table.insert(nodes, insert_at, { ref = pipeline_ref })
	return nodes
end

local function apply_pipeline()
	ecs_pipeline.defaultecspipelineregistry:build(world_instance, build_pipeline_spec())
end

return {
	register_pipeline = register_pipeline,
	apply_pipeline = apply_pipeline,
}
