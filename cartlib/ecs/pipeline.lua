-- ecs_pipeline.lua
-- ECS pipeline registry and builder for the cart runtime.

local registry<const> = require('cartlib/registry')

local ecspipelineregistry<const> = {}
ecspipelineregistry.__index = ecspipelineregistry

function ecspipelineregistry.new()
	local self<const> = setmetatable({}, ecspipelineregistry)
	self._descs = {}
	return self
end

function ecspipelineregistry:register(desc)
	self._descs[desc.id] = desc -- Allow overriding existing descs with the same id, to allow for dynamic changes to the pipeline and hot-resume.
end

function ecspipelineregistry:register_many(descs)
	for i = 1, #descs do
		self:register(descs[i])
	end
end

function ecspipelineregistry:get(id)
	return self._descs[id]
end

function ecspipelineregistry:build(world_instance, nodes)
	local filtered<const> = {}
	for i = 1, #nodes do
		local n<const> = nodes[i]
		if not n.when or n.when(world_instance) then
			filtered[#filtered + 1] = n
		end
	end

	local resolved<const> = {}
	for i = 1, #filtered do
		local n<const> = filtered[i]
		local d<const> = self._descs[n.ref]
		if not d then
			error('ecspipelineregistry: unknown system ref "' .. n.ref .. '"')
		end
		-- Default like ecsystem.new (priority or 0): the sort comparator below
		-- needs numbers on both sides; nil priorities/groups made it
		-- inconsistent and the resolved order undefined.
		local create_priority<const> = n.priority or d.default_priority or 0
		resolved[#resolved + 1] = {
			ref = n.ref,
			group = n.group or d.group or 0,
			priority = create_priority,
			create_priority = create_priority,
			index = i,
		}
	end

	table.sort(resolved, function(a, b)
		if a.group ~= b.group then
			return a.group < b.group
		end
		if a.priority ~= b.priority then
			return a.priority < b.priority
		end
		return a.index < b.index
	end)

	local systems<const> = {}
	for i = 1, #resolved do
		local r<const> = resolved[i]
		local d<const> = self._descs[r.ref]
		local sys<const> = d.create(r.create_priority)
		sys.__ecs_id = r.ref
		sys.__ecs_pipeline_owner = self
		sys.id = 'ecs:' .. r.ref
		sys.type_name = 'ecsystem'
		systems[#systems + 1] = sys
	end

	local retained<const> = {}
	local active_systems<const> = world_instance.systems.systems
	for i = 1, #active_systems do
		local active<const> = active_systems[i]
		if active.__ecs_pipeline_owner == self then
			registry.instance:deregister(active.id, true)
		else
			retained[#retained + 1] = active
		end
	end

	world_instance.systems:clear()
	for i = 1, #systems do
		world_instance.systems:register(systems[i])
		registry.instance:register(systems[i])
	end
	for i = 1, #retained do
		world_instance.systems:register(retained[i])
	end
end

return {
	ecspipelineregistry = ecspipelineregistry,
	defaultecspipelineregistry = ecspipelineregistry.new(),
}
