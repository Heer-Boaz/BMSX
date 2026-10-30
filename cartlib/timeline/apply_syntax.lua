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
local call_expression<const> = syntax_factory.call_expression
local call_statement<const> = syntax_factory.call_statement
local assignment_statement<const> = syntax_factory.assignment_statement
local return_statement<const> = syntax_factory.return_statement

local symbols<const> = {
	target = generated_symbol('target'),
	frame = generated_symbol('frame'),
	entry = generated_symbol('entry'),
	value = generated_symbol('value'),
}

local collect_frame_assignments
collect_frame_assignments = function(statements, node, path, paths, path_offset)
	for key, value in pairs(node) do
		local path_index<const> = #path + 1
		path[path_index] = key
		if type(value) == 'table' then
			collect_frame_assignments(statements, value, path, paths, path_offset)
		else
			local retained_path<const> = {}
			for index = 1, #path do retained_path[index] = path[index] end
			paths[#paths + 1] = { binding_index = 1, path = retained_path }
			statements[#statements + 1] = assignment_statement(
				index_path(index_expression(member_expression(reference(symbols.entry), 'output_receivers'),
				numeric_literal(path_offset + #paths)), { key }),
				index_path(reference(symbols.frame), path)
			)
		end
		path[path_index] = nil
	end
end

function apply_syntax.build_frame(frame, path_offset)
	local body<const> = {}
	local paths<const> = {}
	collect_frame_assignments(body, frame, {}, paths, path_offset)
	return syntax_factory.chunk(block({
		return_statement({
			function_expression(
				{ reference(symbols.entry), reference(symbols.frame) },
				block(body)
			),
		}),
	})), paths
end

function apply_syntax.build_step(path, binding_index, writer_index, output_index)
	local binding = member_expression(reference(symbols.entry), 'primary_binding')
	if binding_index ~= 1 then
		binding = index_expression(
			member_expression(reference(symbols.entry), 'bindings'),
			numeric_literal(binding_index)
		)
	end
	local write
	if writer_index ~= nil then
		write = call_statement(call_expression(index_expression(
			member_expression(reference(symbols.entry), 'channel_writers'), numeric_literal(writer_index)),
			{ binding, reference(symbols.value) }))
	else
		write = assignment_statement(index_path(index_expression(
			member_expression(reference(symbols.entry), 'output_receivers'), numeric_literal(output_index)),
			{ path[#path] }), reference(symbols.value))
	end
	return syntax_factory.chunk(block({
		return_statement({
			function_expression(
				{ reference(symbols.entry), reference(symbols.value) },
				block({
					write,
				})
			),
		}),
	}))
end

return apply_syntax
