local lua_syntax<const> = require('cartlib/codegen/lua_syntax')

local apply_source<const> = {}
local identifier<const> = lua_syntax.identifier
local numeric_literal<const> = lua_syntax.numeric_literal
local member_expression<const> = lua_syntax.member_expression
local index_expression<const> = lua_syntax.index_expression
local index_path<const> = lua_syntax.index_path
local function_expression<const> = lua_syntax.function_expression
local assignment_statement<const> = lua_syntax.assignment_statement
local return_statement<const> = lua_syntax.return_statement

local collect_frame_assignments
collect_frame_assignments = function(statements, node, path)
	for key, value in pairs(node) do
		local path_index<const> = #path + 1
		path[path_index] = key
		if type(value) == 'table' then
			collect_frame_assignments(statements, value, path)
		else
			statements[#statements + 1] = assignment_statement(
				{ index_path(identifier('target'), path) },
				{ index_path(identifier('frame'), path) }
			)
		end
		path[path_index] = nil
	end
end

function apply_source.build_frame(frame)
	local body<const> = {}
	collect_frame_assignments(body, frame, {})
	return lua_syntax.chunk({
		return_statement({ function_expression({ 'target', 'frame' }, body) }),
	})
end

function apply_source.build_step(path, binding_index)
	local binding = member_expression(identifier('entry'), 'primary_binding')
	if binding_index ~= 1 then
		binding = index_expression(
			member_expression(identifier('entry'), 'bindings'),
			numeric_literal(binding_index)
		)
	end
	return lua_syntax.chunk({
		return_statement({
			function_expression({ 'entry', 'value' }, {
				assignment_statement(
					{ index_path(binding, path) },
					{ identifier('value') }
				),
			}),
		}),
	})
end

return apply_source
