-- ecs_pipeline.lua
-- ECS pipeline registry and builder for Lua engine

local ecs = require("ecs")

local ECSPipelineRegistry = {}
ECSPipelineRegistry.__index = ECSPipelineRegistry

function ECSPipelineRegistry.new()
	local self = setmetatable({}, ECSPipelineRegistry)
	self._descs = {}
	self._last_diagnostics = nil
	return self
end

function ECSPipelineRegistry:register(desc)
	if self._descs[desc.id] then
		error("ECSPipelineRegistry: duplicate id '" .. desc.id .. "'")
	end
	self._descs[desc.id] = desc
end

function ECSPipelineRegistry:register_many(descs)
	for i = 1, #descs do
		self:register(descs[i])
	end
end

function ECSPipelineRegistry:get(id)
	return self._descs[id]
end

function ECSPipelineRegistry:build(world, nodes)
	local t0 = $.platform.clock.now()
	local filtered = {}
	for i = 1, #nodes do
		local n = nodes[i]
		if not n.when or n.when(world) then
			filtered[#filtered + 1] = n
		end
	end

	local resolved = {}
	for i = 1, #filtered do
		local n = filtered[i]
		local d = self._descs[n.ref]
		if not d then
			error("ECSPipelineRegistry: unknown system ref '" .. n.ref .. "'")
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
		systems[#systems + 1] = sys
	end

	world.systems:clear()
	for i = 1, #systems do
		world.systems:register(systems[i])
	end

	local t1 = $.platform.clock.now()
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

function ECSPipelineRegistry:get_last_diagnostics()
	return self._last_diagnostics
end

local DefaultECSPipelineRegistry = ECSPipelineRegistry.new()

return {
	ECSPipelineRegistry = ECSPipelineRegistry,
	DefaultECSPipelineRegistry = DefaultECSPipelineRegistry,
}
