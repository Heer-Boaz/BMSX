-- ecs_pipeline.lua
-- ecs pipeline registry and builder for lua engine

local ecs = require("ecs")
local registry = require("registry")

local ecspipelineregistry = {}
ecspipelineregistry.__index = ecspipelineregistry

function ecspipelineregistry.new()
	local self = setmetatable({}, ecspipelineregistry)
	self._descs = {}
	self._last_diagnostics = nil
	return self
end

function ecspipelineregistry:register(desc)
	if self._descs[desc.id] then
		error("ecspipelineregistry: duplicate id '" .. desc.id .. "'")
	end
	self._descs[desc.id] = desc
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
	local t0 = $.platform.clock.perf_now()
	local filtered = {}
	for i = 1, #nodes do
		local n = nodes[i]
		if not n.when or n.when(world_instance) then
			filtered[#filtered + 1] = n
		end
	end

	local resolved = {}
	for i = 1, #filtered do
		local n = filtered[i]
		local d = self._descs[n.ref]
		if not d then
			error("ecspipelineregistry: unknown system ref '" .. n.ref .. "'")
		end
		resolved[#resolved + 1] = {
			ref = n.ref,
			group = n.group or d.group,
			priority = n.priority or d.default_priority or 0,
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

	local group_orders = {}
	for i = 1, #resolved do
		local r = resolved[i]
		group_orders[r.group] = group_orders[r.group] or {}
		group_orders[r.group][#group_orders[r.group] + 1] = r.ref
	end

	local systems = {}
	for i = 1, #resolved do
		local r = resolved[i]
		local d = self._descs[r.ref]
		local sys = d.create(r.priority)
		sys.__ecs_id = r.ref
		sys.id = "ecs:" .. r.ref
		sys.type_name = "ecsystem"
		systems[#systems + 1] = sys
	end

	-- Deregister previous ECS system instances from the registry.
	for i = 1, #world_instance.systems.systems do
		local old = world_instance.systems.systems[i]
		if old.id then
			registry.instance:deregister(old.id, true)
		end
	end

	world_instance.systems:clear()
	for i = 1, #systems do
		world_instance.systems:register(systems[i])
		registry.instance:register(systems[i])
	end
	world_instance:rebind_subsystem_systems_all()

	local t1 = $.platform.clock.perf_now()
	local diag = {
		final_order = (function()
			local out = {}
			for i = 1, #resolved do
				out[i] = resolved[i].ref
			end
			return out
		end)(),
		group_orders = group_orders,
		build_ms = t1 - t0,
	}
	self._last_diagnostics = diag
	return diag
end

function ecspipelineregistry:get_last_diagnostics()
	return self._last_diagnostics
end

return {
	ecspipelineregistry = ecspipelineregistry,
	defaultecspipelineregistry = ecspipelineregistry.new(),
}
