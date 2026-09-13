local program<const> = require('cartlib/behaviour_tree/program')
local bt_component<const> = require('cartlib/behaviour_tree/bt_component')

local compile_recorder<const> = {}
compile_recorder.__index = compile_recorder

local node_recorder<const> = {}
node_recorder.__index = node_recorder

local completion_recorder<const> = {}
completion_recorder.__index = completion_recorder

local binding_recorder<const> = {}
binding_recorder.__index = binding_recorder

local weak_keys<const> = { __mode = 'k' }

-- This is a compilation probe, not a source graph or a per-actor runtime
-- tracer. A declaration may be shared by several lowering occurrences.
-- Its temporary identity map is released with the compiler-owned layout.
function node_recorder:record(node, execution_index, entering, slot_count, node_type, evaluate, operand, reset)
	local nodes<const> = self.nodes
	if entering then
		local declaration = self.declarations[node]
		if declaration == nil then
			declaration = self.declaration_count + 1
			self.declaration_count = declaration
			self.declarations[node] = declaration
		end
		nodes[execution_index] = {
			declaration = declaration,
			parent = self.parent,
			type = node_type,
			first_slot = slot_count + 1,
		}
		self.parent = execution_index
	else
		local occurrence<const> = nodes[execution_index]
		occurrence.last_slot = slot_count
		occurrence.subtree_end = #nodes
		occurrence.evaluate = evaluate
		occurrence.operand = operand
		occurrence.reset = reset
		self.parent = occurrence.parent
	end
end

function completion_recorder:record(compiled)
	local layout<const> = self.layout
	local capture<const> = self.capture
	self.owner.programs[compiled] = {
		nodes = capture.nodes,
		declaration_count = capture.declaration_count,
		slot_count = layout.state_slot_count,
		flag_slots = layout.flag_slots,
		record_slots = layout.record_slots,
		service_count = layout.service_count,
	}
end

-- This is the last completed bind, not a claim about the coherence of fields
-- while a later rebind is writing them or has failed part way through.
function binding_recorder:record(component, compiled)
	self.completed_bindings[component] = compiled
end

function compile_recorder.new()
	local completed_bindings<const> = setmetatable({}, weak_keys)
	local self<const> = setmetatable({
		programs = setmetatable({}, weak_keys),
		completed_bindings = completed_bindings,
	}, compile_recorder)
	blua32.trace_sink(program, 'bt.compile.begin', self)
	blua32.trace_sink(bt_component, 'bt.bind.complete', setmetatable({
		completed_bindings = completed_bindings,
	}, binding_recorder))
	return self
end

function compile_recorder:record(layout)
	local capture<const> = setmetatable({
		nodes = {},
		declarations = {},
		declaration_count = 0,
		parent = 0,
	}, node_recorder)
	blua32.trace_sink(layout, 'bt.compile.node', capture)
	blua32.trace_sink(layout, 'bt.compile.end', setmetatable({
		layout = layout,
		capture = capture,
		owner = self,
	}, completion_recorder))
end

function compile_recorder:dispose()
	blua32.trace_sink(program, 'bt.compile.begin', nil)
	blua32.trace_sink(bt_component, 'bt.bind.complete', nil)
end

return compile_recorder
