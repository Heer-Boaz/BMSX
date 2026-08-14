-- Admission-only lowering for frame-shape and property-path appliers. Timeline
-- sampling executes only the compiled assignments.
local syntax_factory<const> = lua_compiler.syntax_factory

local apply_syntax<const> = {}
local block<const> = syntax_factory.block
local generated_symbol<const> = syntax_factory.generated_symbol
local reference<const> = syntax_factory.reference
local numeric_literal<const> = syntax_factory.number_literal
local member_expression<const> = syntax_factory.member_expression
local index_expression<const> = syntax_factory.index_expression
local index_path<const> = syntax_factory.index_path
local function_expression<const> = syntax_factory.function_expression
local assignment_statement<const> = syntax_factory.assignment_statement
local return_statement<const> = syntax_factory.return_statement

local symbols<const> = {
	target = generated_symbol('target'),
	frame = generated_symbol('frame'),
	entry = generated_symbol('entry'),
	value = generated_symbol('value'),
}

local collect_frame_assignments
collect_frame_assignments = function(statements, node, path)
	for key, value in pairs(node) do
		local path_index<const> = #path + 1
		path[path_index] = key
		if type(value) == 'table' then
			collect_frame_assignments(statements, value, path)
		else
			statements[#statements + 1] = assignment_statement(
				index_path(reference(symbols.target), path),
				index_path(reference(symbols.frame), path)
			)
		end
		path[path_index] = nil
	end
end

function apply_syntax.build_frame(frame)
	local body<const> = {}
	collect_frame_assignments(body, frame, {})
	return syntax_factory.chunk(block({
		return_statement({
			function_expression(
				{ reference(symbols.target), reference(symbols.frame) },
				block(body)
			),
		}),
	}))
end

function apply_syntax.build_step(path, binding_index)
	local binding = member_expression(reference(symbols.entry), 'primary_binding')
	if binding_index ~= 1 then
		binding = index_expression(
			member_expression(reference(symbols.entry), 'bindings'),
			numeric_literal(binding_index)
		)
	end
	return syntax_factory.chunk(block({
		return_statement({
			function_expression(
				{ reference(symbols.entry), reference(symbols.value) },
				block({
					assignment_statement(
						index_path(binding, path),
						reference(symbols.value)
				),
				})
			),
		}),
	}))
end

return apply_syntax
