-- cartlib/input/action_parser.lua
-- Cached action-expression compiler for cart-owned PlayerInput. Authored
-- syntax is parsed once; firmware load() produces a factory that binds one
-- player's resolved states into the short-circuit evaluator used at runtime.

local lua_source_printer<const> = require('cartlib/codegen/lua_source_printer')

local action_parser<const> = {}

local tk_sym<const> = 1
local tk_ident<const> = 2
local tk_func_win<const> = 3
local tk_func<const> = 4
local tk_mod<const> = 5
local tk_cmp<const> = 6

local cache<const> = {}
local two_char_token_kinds<const> = {
	['||'] = tk_sym,
	['&&'] = tk_sym,
	['<='] = tk_cmp,
	['>='] = tk_cmp,
	['=='] = tk_cmp,
	['!='] = tk_cmp,
}
local symbol_token_kinds<const> = {
	['|'] = tk_sym,
	['!'] = tk_sym,
	['('] = tk_sym,
	[')'] = tk_sym,
	['['] = tk_sym,
	[']'] = tk_sym,
	[','] = tk_sym,
	['<'] = tk_cmp,
	['>'] = tk_cmp,
}
local function_prefix_chars<const> = {
	['&'] = true,
	['?'] = true,
}
local mod_kind_p<const> = 1
local mod_kind_r<const> = 2
local mod_kind_jp<const> = 3
local mod_kind_all_jp<const> = 4
local mod_kind_jr<const> = 5
local mod_kind_all_jr<const> = 6
local mod_kind_gp<const> = 7
local mod_kind_rp<const> = 8
local mod_kind_c<const> = 9
local mod_kind_h<const> = 10
local mod_kind_wp<const> = 11
local mod_kind_wr<const> = 12
local mod_kind_t<const> = 13
local mod_kind_rc<const> = 14

local node_kind_action<const> = 1
local node_kind_not<const> = 2
local node_kind_and<const> = 3
local node_kind_or<const> = 4
local node_kind_function<const> = 5

local function_kind_all<const> = 1
local function_kind_any<const> = 2
local function_kind_any_jp<const> = 3
local function_kind_all_jp<const> = 4
local function_kind_any_jr<const> = 5
local function_kind_all_jr<const> = 6
local function_kind_any_gp<const> = 7
local function_kind_all_gp<const> = 8
local function_kind_any_rp<const> = 9
local function_kind_all_rp<const> = 10
local function_kind_any_wp<const> = 11
local function_kind_all_wp<const> = 12
local function_kind_any_wr<const> = 13
local function_kind_all_wr<const> = 14

local function_kinds<const> = {
	['&'] = function_kind_all,
	['?'] = function_kind_any,
	['?jp'] = function_kind_any_jp,
	['&jp'] = function_kind_all_jp,
	['?jr'] = function_kind_any_jr,
	['&jr'] = function_kind_all_jr,
	['?gp'] = function_kind_any_gp,
	['&gp'] = function_kind_all_gp,
	['?rp'] = function_kind_any_rp,
	['&rp'] = function_kind_all_rp,
	['?wp'] = function_kind_any_wp,
	['&wp'] = function_kind_all_wp,
	['?wr'] = function_kind_any_wr,
	['&wr'] = function_kind_all_wr,
}

local compare_lt<const> = 1
local compare_gt<const> = 2
local compare_lte<const> = 3
local compare_gte<const> = 4
local compare_eq<const> = 5
local compare_ne<const> = 6

local edge_jp<const> = 0x01
local edge_jr<const> = 0x02
local edge_wp<const> = 0x04
local edge_wr<const> = 0x08
local edge_gp<const> = 0x10
local edge_rp<const> = 0x20

local is_space<const> = function(byte)
	return byte == 32 or byte == 9 or byte == 10 or byte == 13
end

local is_alpha<const> = function(byte)
	return (byte >= 65 and byte <= 90) or (byte >= 97 and byte <= 122) or byte == 95
end

local is_digit<const> = function(byte)
	return byte >= 48 and byte <= 57
end

local is_alnum<const> = function(byte)
	return is_alpha(byte) or is_digit(byte)
end

-- Modifier bodies are parsed byte for byte, like the lexer below: machine Lua
-- does not coerce strings in arithmetic/comparisons and its patterns have no
-- alternation, so numbers are built from digit bytes instead of match captures.

local skip_spaces<const> = function(mod, i, last)
	while i <= last and is_space(string.byte(mod, i)) do
		i = i + 1
	end
	return i
end

-- Digits only. Returns value, next_index; value is nil when no digit is present.
local parse_uint<const> = function(mod, i, last)
	local byte = string.byte(mod, i)
	if i > last or not is_digit(byte) then
		return nil, i
	end
	local value = 0
	while i <= last and is_digit(byte) do
		value = value * 10 + (byte - 48)
		i = i + 1
		byte = string.byte(mod, i)
	end
	return value, i
end

-- Digits with an optional fraction part ('15', '1.5', '5.').
local parse_decimal<const> = function(mod, i, last)
	local value, next_i<const> = parse_uint(mod, i, last)
	if value == nil then
		return nil, i
	end
	i = next_i
	if i <= last and string.byte(mod, i) == 46 then -- '.'
		i = i + 1
		local scale = 0.1
		while i <= last and is_digit(string.byte(mod, i)) do
			value = value + (string.byte(mod, i) - 48) * scale
			scale = scale * 0.1
			i = i + 1
		end
	end
	return value, i
end

-- Comparator body: optional '<' '>' '<=' '>=' '==' '!=' (default '>='),
-- then a decimal, with spaces allowed around both.
local parse_comparator<const> = function(mod, i, last)
	i = skip_spaces(mod, i, last)
	local op = compare_gte
	local byte<const> = string.byte(mod, i)
	if byte == 60 or byte == 62 then -- '<' '>'
		if string.byte(mod, i + 1) == 61 then -- '='
			op = byte == 60 and compare_lte or compare_gte
			i = i + 2
		else
			op = byte == 60 and compare_lt or compare_gt
			i = i + 1
		end
	elseif byte == 33 or byte == 61 then -- '!' '='
		if string.byte(mod, i + 1) ~= 61 then
			return nil, nil
		end
		op = byte == 33 and compare_ne or compare_eq
		i = i + 2
	end
	local value<const>, next_i<const> = parse_decimal(mod, skip_spaces(mod, i, last), last)
	if value == nil or skip_spaces(mod, next_i, last) <= last then
		return nil, nil
	end
	return op, value
end

local simple_mod_kinds<const> = {
	['p'] = mod_kind_p,
	['r'] = mod_kind_r,
	['jp'] = mod_kind_jp,
	['&jp'] = mod_kind_all_jp,
	['jr'] = mod_kind_jr,
	['&jr'] = mod_kind_all_jr,
	['gp'] = mod_kind_gp,
	['rp'] = mod_kind_rp,
	['c'] = mod_kind_c,
	['h'] = mod_kind_h,
}

local braced_mod_kinds<const> = {
	['wp'] = mod_kind_wp,
	['wr'] = mod_kind_wr,
	['t'] = mod_kind_t,
	['rc'] = mod_kind_rc,
}

local compile_modifier<const> = function(mod)
	local neg<const> = string.byte(mod, 1) == 33 -- '!'
	local start<const> = neg and 2 or 1
	local len<const> = #mod
	local brace = nil
	for i = start, len do
		if string.byte(mod, i) == 123 then -- '{'
			brace = i
			break
		end
	end
	if brace == nil then
		local kind<const> = simple_mod_kinds[neg and string.sub(mod, start) or mod]
		if kind then
			return { kind = kind, neg = neg }
		end
		error('[cartlib/input/action_parser] Unknown action modifier "' .. mod .. '".')
	end
	local kind<const> = braced_mod_kinds[string.sub(mod, start, brace - 1)]
	local body_start<const> = brace + 1
	local body_last<const> = len - 1 -- the lexer guarantees the trailing '}'
	if kind == mod_kind_wp or kind == mod_kind_wr then
		local window<const>, next_i<const> = parse_uint(mod, body_start, body_last)
		if window ~= nil and next_i > body_last then
			return { kind = kind, neg = neg, window = window }
		end
	elseif kind == mod_kind_t or kind == mod_kind_rc then
		local op<const>, value<const> = parse_comparator(mod, body_start, body_last)
		if op ~= nil then
			return { kind = kind, neg = neg, op = op, value = value }
		end
	end
	error('[cartlib/input/action_parser] Unknown action modifier "' .. mod .. '".')
end

local token<const> = function(kind, value)
	return { kind = kind, value = value }
end

local lex<const> = function(src)
	local out<const> = {}
	local len<const> = #src
	local i = 1
	while i <= len do
		while i <= len and is_space(string.byte(src, i)) do
			i = i + 1
		end
		if i > len then
			break
		end

		local c<const> = string.sub(src, i, i)
		local two = nil
		if i < len then
			two = string.sub(src, i, i + 1)
		end
		local two_kind<const> = two and two_char_token_kinds[two]
		if two_kind then
			out[#out + 1] = token(two_kind, two)
			i = i + 2
		elseif symbol_token_kinds[c] then
			out[#out + 1] = token(symbol_token_kinds[c], c)
			i = i + 1
		elseif function_prefix_chars[c] then
			local start<const> = i
			i = i + 1
			while i <= len and is_alpha(string.byte(src, i)) do
				i = i + 1
			end
			if i <= len and string.sub(src, i, i) == '{' then
				i = i + 1
				if i <= len and string.sub(src, i, i) == '}' then
					error('[cartlib/input/action_parser] Empty function window in "' .. src .. '".')
				end
				while i <= len and is_digit(string.byte(src, i)) do
					i = i + 1
				end
				if i <= len and string.sub(src, i, i) == '}' then
					i = i + 1
					out[#out + 1] = token(tk_func_win, string.sub(src, start, i - 1))
				else
					error('[cartlib/input/action_parser] Unterminated windowed function in "' .. src .. '".')
				end
			else
				out[#out + 1] = token(tk_func, string.sub(src, start, i - 1))
			end
		elseif is_alpha(string.byte(src, i)) then
			local start<const> = i
			i = i + 1
			while i <= len and is_alnum(string.byte(src, i)) do
				i = i + 1
			end
			if i <= len and string.sub(src, i, i) == '{' then
				local depth = 1
				i = i + 1
				while i <= len and depth > 0 do
					local ch<const> = string.sub(src, i, i)
					if ch == '{' then
						depth = depth + 1
					elseif ch == '}' then
						depth = depth - 1
					end
					i = i + 1
				end
				if depth ~= 0 then
					error('[cartlib/input/action_parser] Unterminated modifier in "' .. src .. '".')
				end
				out[#out + 1] = token(tk_mod, string.sub(src, start, i - 1))
			else
				out[#out + 1] = token(tk_ident, string.sub(src, start, i - 1))
			end
		else
			error('[cartlib/input/action_parser] Unexpected character "' .. c .. '" in "' .. src .. '".')
		end
	end
	return out
end

local parser_state<const> = {}
parser_state.__index = parser_state

local current<const> = function(self)
	return self.tokens[self.index]
end

local eat<const> = function(self)
	local value<const> = self.tokens[self.index]
	self.index = self.index + 1
	return value
end

local take<const> = function(self, kind, value)
	local c<const> = current(self)
	if not c or c.kind ~= kind or (value and c.value ~= value) then
		local found<const> = c and c.value or '<eos>'
		error('[cartlib/input/action_parser] Unexpected token "' .. found .. '" in "' .. self.source .. '".')
	end
	return eat(self)
end

local annotate_action
local parse_expr

local make_op<const> = function(kind, left, right)
	return { kind = kind, left = left, right = right }
end

local parse_modifiers<const> = function(self)
	local mods<const> = {}
	take(self, tk_sym, '[')
	while current(self) and current(self).value ~= ']' do
		local t<const> = eat(self)
		if t.value ~= ',' then
			if t.value == '!' then
				mods[#mods + 1] = '!' .. take(self, current(self).kind).value
			else
				mods[#mods + 1] = t.value
			end
		end
	end
	take(self, tk_sym, ']')
	return mods
end

local apply_modifiers<const> = function(node, mods)
	if #mods == 0 then
		return
	end
	if node.kind == node_kind_action then
		local node_mods<const> = node.mods
		for i = 1, #mods do
			node_mods[#node_mods + 1] = mods[i]
		end
		annotate_action(node)
		return
	end
	if node.kind == node_kind_not or node.kind == node_kind_and or node.kind == node_kind_or then
		apply_modifiers(node.left, mods)
		if node.right then
			apply_modifiers(node.right, mods)
		end
		return
	end
	if node.kind == node_kind_function then
		local args<const> = node.args
		for i = 1, #args do
			apply_modifiers(args[i], mods)
		end
	end
end

local parse_action<const> = function(self)
	local name<const> = take(self, tk_ident).value
	local action_index = self.action_name_indices[name]
	if not action_index then
		action_index = #self.action_names + 1
		self.action_name_indices[name] = action_index
		self.action_names[action_index] = name
	end
	local mods<const> = current(self) and current(self).value == '[' and parse_modifiers(self) or {}
	local node<const> = {
		kind = node_kind_action,
		name = name,
		action_index = action_index,
		mods = mods,
		edge_mask = 0,
	}
	annotate_action(node)
	return node
end

local parse_function<const> = function(self)
	local tok<const> = eat(self)
	local fname = tok.value
	local window = nil
	if tok.kind == tk_func_win then
		-- The lexer guarantees prefix + alphas + '{' + digits + '}'.
		local value<const> = tok.value
		local brace = 2
		while string.byte(value, brace) ~= 123 do -- '{'
			brace = brace + 1
		end
		fname = string.sub(value, 1, brace - 1)
		local parsed_window<const> = parse_uint(value, brace + 1, #value - 1)
		window = parsed_window
	end
	take(self, tk_sym, '(')
	local args<const> = {}
	if current(self) and current(self).value ~= ')' then
		args[#args + 1] = parse_expr(self)
		while current(self) and current(self).value == ',' do
			eat(self)
			args[#args + 1] = parse_expr(self)
		end
	end
	take(self, tk_sym, ')')
	local function_kind<const> = function_kinds[fname]
	if not function_kind then
		error('[cartlib/input/action_parser] Unknown function helper "' .. fname .. '" in "' .. self.source .. '".')
	end
	return { kind = node_kind_function, function_kind = function_kind, args = args, window = window }
end

local parse_factor<const> = function(self)
	local c<const> = current(self)
	if not c then
		error('[cartlib/input/action_parser] Unexpected end of input in "' .. self.source .. '".')
	end
	if c.value == '!' then
		eat(self)
		return make_op(node_kind_not, parse_factor(self))
	end
	if c.value == '(' then
		eat(self)
		local node<const> = parse_expr(self)
		take(self, tk_sym, ')')
		if current(self) and current(self).value == '[' then
			apply_modifiers(node, parse_modifiers(self))
		end
		return node
	end
	if c.kind == tk_func or c.kind == tk_func_win then
		return parse_function(self)
	end
	return parse_action(self)
end

local parse_binary<const> = function(self, operand, op_name, op_a, op_b)
	local node = operand(self)
	while current(self) and (current(self).value == op_a or current(self).value == op_b) do
		eat(self)
		node = make_op(op_name, node, operand(self))
	end
	return node
end

local parse_term<const> = function(self)
	return parse_binary(self, parse_factor, node_kind_and, '&&', false)
end

parse_expr = function(self)
	return parse_binary(self, parse_term, node_kind_or, '||', '|')
end

annotate_action = function(node)
	local mods<const> = node.mods
	local specs<const> = {}
	node.mod_specs = specs
	node.has_consume_mod = false
	if #mods == 0 then
		node.edge_mask = edge_jp | edge_wp | edge_gp | edge_rp
		return
	end
	local press_pos = false
	local release_pos = false
	local guard_pos = false
	local repeat_pos = false
	local guard_explicit = false
	local repeat_explicit = false
	for i = 1, #mods do
		local spec<const> = compile_modifier(mods[i])
		specs[i] = spec
		local kind<const> = spec.kind
		local neg<const> = spec.neg
		if kind == mod_kind_c then
			node.has_consume_mod = true
		end
		if kind == mod_kind_gp then
			guard_explicit = true
			if not neg then guard_pos = true end
		elseif kind == mod_kind_rp then
			repeat_explicit = true
			if not neg then repeat_pos = true end
		else
			local pressish<const> = kind == mod_kind_p or kind == mod_kind_jp or kind == mod_kind_wp
			local releaseish<const> = kind == mod_kind_jr or kind == mod_kind_wr
			if pressish and not neg then press_pos = true end
			if releaseish and not neg then release_pos = true end
		end
	end
	if not guard_explicit then guard_pos = press_pos end
	if not repeat_explicit then repeat_pos = press_pos end
	local edge_mask = 0
	if press_pos then
		edge_mask = edge_mask | edge_jp | edge_wp
	end
	if release_pos then
		edge_mask = edge_mask | edge_jr | edge_wr
	end
	if guard_pos then
		edge_mask = edge_mask | edge_gp
	end
	if repeat_pos then
		edge_mask = edge_mask | edge_rp
	end
	node.edge_mask = edge_mask
end

local enforce_root_modifiers<const> = function(node, in_function)
	if node.kind == node_kind_action then
		if not in_function and #node.mods == 0 then
			error('[cartlib/input/action_parser] Root-level action "' .. node.name .. '" must specify a modifier like [p].')
		end
		return
	end
	if node.kind == node_kind_not or node.kind == node_kind_and or node.kind == node_kind_or then
		enforce_root_modifiers(node.left, in_function)
		if node.right then
			enforce_root_modifiers(node.right, in_function)
		end
		return
	end
	if node.kind == node_kind_function then
		local args<const> = node.args
		for i = 1, #args do
			enforce_root_modifiers(args[i], true)
		end
	end
end

local comparison_operator_source_by_kind<const> = {
	[compare_lt] = ' < ',
	[compare_gt] = ' > ',
	[compare_lte] = ' <= ',
	[compare_gte] = ' >= ',
	[compare_eq] = ' == ',
	[compare_ne] = ' ~= ',
}

local modifier_state_field_by_kind<const> = {
	[mod_kind_p] = 'pressed',
	[mod_kind_jp] = 'just_pressed',
	[mod_kind_all_jp] = 'all_just_pressed',
	[mod_kind_jr] = 'just_released',
	[mod_kind_all_jr] = 'all_just_released',
	[mod_kind_gp] = 'guarded_just_pressed',
	[mod_kind_rp] = 'repeat_pressed',
	[mod_kind_c] = 'consumed',
}

local edge_function_spec_by_kind<const> = {
	[function_kind_any_jp] = { all = false, edge_bit = edge_jp, state_field = 'just_pressed' },
	[function_kind_all_jp] = { all = true, edge_bit = edge_jp, state_field = 'just_pressed' },
	[function_kind_any_jr] = { all = false, edge_bit = edge_jr, state_field = 'just_released' },
	[function_kind_all_jr] = { all = true, edge_bit = edge_jr, state_field = 'just_released' },
	[function_kind_any_gp] = { all = false, edge_bit = edge_gp, state_field = 'guarded_just_pressed' },
	[function_kind_all_gp] = { all = true, edge_bit = edge_gp, state_field = 'guarded_just_pressed' },
	[function_kind_any_rp] = { all = false, edge_bit = edge_rp, state_field = 'repeat_pressed' },
	[function_kind_all_rp] = { all = true, edge_bit = edge_rp, state_field = 'repeat_pressed' },
	[function_kind_any_wp] = { all = false, edge_bit = edge_wp, delta_field = 'min_press_delta' },
	[function_kind_all_wp] = { all = true, edge_bit = edge_wp, delta_field = 'min_press_delta' },
	[function_kind_any_wr] = { all = false, edge_bit = edge_wr, delta_field = 'min_release_delta' },
	[function_kind_all_wr] = { all = true, edge_bit = edge_wr, delta_field = 'min_release_delta' },
}

local templates<const> = {}
local emit_evaluation
local emit_edge_collection

local emit_target<const> = function(printer, values)
	printer:print_raw(values.target)
end

local emit_state_field<const> = function(printer, values)
	printer:print_index(values.state_field)
end

local emit_modifier_base<const> = function(printer, values)
	local spec<const> = values.spec
	local kind<const> = spec.kind
	local state_field<const> = modifier_state_field_by_kind[kind]
	if state_field ~= nil then
		values.state_field = state_field
		printer:emit(templates.state_condition, values)
	elseif kind == mod_kind_r then
		printer:emit(templates.released_condition, values)
	elseif kind == mod_kind_h then
		printer:emit(templates.held_condition, values)
	elseif kind == mod_kind_wp then
		values.state_field = 'min_press_delta'
		values.bound = spec.window
		printer:emit(templates.window_condition, values)
	elseif kind == mod_kind_wr then
		values.state_field = 'min_release_delta'
		values.bound = spec.window
		printer:emit(templates.window_condition, values)
	elseif kind == mod_kind_t then
		values.state_field = 'press_time'
		values.operator = comparison_operator_source_by_kind[spec.op]
		values.bound = spec.value
		printer:emit(templates.comparison_condition, values)
	else
		values.state_field = 'repeat_count'
		values.operator = comparison_operator_source_by_kind[spec.op]
		values.bound = spec.value
		printer:emit(templates.comparison_condition, values)
	end
end

local emit_modifier_condition<const> = function(printer, values)
	if values.spec.neg then
		printer:emit(templates.negated_condition, values)
	else
		emit_modifier_base(printer, values)
	end
end

local emit_action_condition<const> = function(printer, values)
	local node<const> = values.node
	local specs<const> = node.mod_specs
	local has_condition = false
	if #specs == 0 and values.bare_requires_pressed then
		printer:emit(templates.pressed_condition, values)
		has_condition = true
	end
	for index = 1, #specs do
		if has_condition then
			printer:emit(templates.condition_and, values)
		end
		values.spec = specs[index]
		emit_modifier_condition(printer, values)
		has_condition = true
	end
	if not node.has_consume_mod then
		if has_condition then
			printer:emit(templates.condition_and, values)
		end
		printer:emit(templates.not_consumed_condition, values)
	end
end

local emit_action_evaluation<const> = function(printer, node, target, bare_requires_pressed)
	printer:emit(templates.action_evaluation, {
		node = node,
		target = target,
		bare_requires_pressed = bare_requires_pressed,
		action_index = node.action_index,
	})
end

local emit_edge_match<const> = function(printer, values)
	local edge_spec<const> = values.edge_spec
	local state_field<const> = edge_spec.state_field
	if state_field ~= nil then
		values.state_field = state_field
		printer:emit(templates.edge_state_match, values)
	else
		values.state_field = edge_spec.delta_field
		printer:emit(templates.edge_window_match, values)
	end
end

local emit_edge_action_evaluation<const> = function(printer, values)
	emit_action_evaluation(printer, values.node, 'edge_ok', false)
end

local emit_edge_eligibility<const> = function(printer, values)
	if (values.node.edge_mask & values.edge_spec.edge_bit) ~= 0 then
		printer:emit(templates.edge_eligibility, values)
	end
end

local emit_left_edge_collection<const> = function(printer, values)
	emit_edge_collection(printer, values.node.left, values.window, values.edge_spec)
end

local emit_right_edge_collection<const> = function(printer, values)
	emit_edge_collection(printer, values.node.right, values.window, values.edge_spec)
end

local emit_left_evaluation<const> = function(printer, values)
	emit_evaluation(printer, values.node.left, values.target, values.window)
end

local emit_right_evaluation<const> = function(printer, values)
	emit_evaluation(printer, values.node.right, values.target, values.window)
end

local emit_argument_edge_collection<const> = function(printer, values)
	emit_edge_collection(printer, values.argument, values.window, values.edge_spec)
end

local emit_argument_evaluation<const> = function(printer, values)
	emit_evaluation(printer, values.argument, values.target, values.window)
end

local emit_edge_function_collection<const> = function(printer, values)
	local node<const> = values.node
	local args<const> = node.args
	local function_kind<const> = node.function_kind
	if function_kind == function_kind_all then
		if #args == 0 then
			printer:emit(templates.edge_empty_all, values)
			return
		end
		values.argument = args[1]
		emit_argument_edge_collection(printer, values)
		for index = 2, #args do
			values.argument = args[index]
			printer:emit(templates.edge_all_continuation, values)
		end
		return
	end
	if function_kind == function_kind_any then
		if #args == 0 then
			printer:emit(templates.edge_empty_any, values)
			return
		end
		values.argument = args[1]
		emit_argument_edge_collection(printer, values)
		for index = 2, #args do
			values.argument = args[index]
			printer:emit(templates.edge_any_continuation, values)
		end
		return
	end
	emit_evaluation(printer, node, 'edge_ok', values.window)
	printer:emit(templates.edge_reset_collection, values)
end

emit_edge_collection = function(printer, node, window, edge_spec)
	local values<const> = {
		node = node,
		window = window,
		edge_spec = edge_spec,
	}
	local kind<const> = node.kind
	if kind == node_kind_action then
		printer:emit(templates.edge_action, values)
	elseif kind == node_kind_not then
		printer:emit(templates.edge_not, values)
	elseif kind == node_kind_and then
		printer:emit(templates.edge_and, values)
	elseif kind == node_kind_or then
		printer:emit(templates.edge_or, values)
	else
		emit_edge_function_collection(printer, values)
	end
end

local emit_function_evaluation<const> = function(printer, values)
	local node<const> = values.node
	local args<const> = node.args
	local function_kind<const> = node.function_kind
	values.window = node.window or values.window
	if function_kind == function_kind_all or function_kind == function_kind_any then
		local match_all<const> = function_kind == function_kind_all
		if #args == 0 then
			printer:emit(match_all and templates.empty_all or templates.empty_any, values)
			return
		end
		values.argument = args[1]
		emit_argument_evaluation(printer, values)
		local continuation<const> = match_all and templates.all_continuation or templates.any_continuation
		for index = 2, #args do
			values.argument = args[index]
			printer:emit(continuation, values)
		end
		return
	end
	local edge_spec<const> = edge_function_spec_by_kind[function_kind]
	if #args == 0 then
		printer:emit(edge_spec.all and templates.empty_all or templates.empty_any, values)
		return
	end
	values.edge_spec = edge_spec
	values.argument = args[1]
	emit_argument_edge_collection(printer, values)
	printer:emit(edge_spec.all and templates.edge_all_result or templates.edge_any_result, values)
	local continuation<const> = edge_spec.all
		and templates.edge_all_result_continuation
		or templates.edge_any_result_continuation
	for index = 2, #args do
		values.argument = args[index]
		printer:emit(continuation, values)
	end
end

emit_evaluation = function(printer, node, target, window)
	local kind<const> = node.kind
	if kind == node_kind_action then
		emit_action_evaluation(printer, node, target, true)
		return
	end
	local values<const> = {
		node = node,
		target = target,
		window = window,
	}
	if kind == node_kind_not then
		printer:emit(templates.not_evaluation, values)
	elseif kind == node_kind_and then
		printer:emit(templates.and_evaluation, values)
	elseif kind == node_kind_or then
		printer:emit(templates.or_evaluation, values)
	else
		emit_function_evaluation(printer, values)
	end
end

local analyze_evaluation<const> = function(node, analysis)
	local kind<const> = node.kind
	if kind == node_kind_action then
		analysis.uses_state = true
		return
	end
	if kind == node_kind_not then
		analyze_evaluation(node.left, analysis)
		return
	end
	if kind == node_kind_and or kind == node_kind_or then
		analyze_evaluation(node.left, analysis)
		analyze_evaluation(node.right, analysis)
		return
	end
	if node.function_kind ~= function_kind_all and node.function_kind ~= function_kind_any then
		analysis.uses_edge = true
	end
	local args<const> = node.args
	for index = 1, #args do
		analyze_evaluation(args[index], analysis)
	end
end

local emit_state_local<const> = function(printer, values)
	if values.analysis.uses_state then
		printer:emit(templates.state_local, values)
	end
end

local emit_edge_locals<const> = function(printer, values)
	if values.analysis.uses_edge then
		printer:emit(templates.edge_locals, values)
	end
end

local emit_program_body<const> = function(printer, values)
	emit_evaluation(printer, values.ast, 'result', 'win')
end

templates.state_condition = lua_source_printer.compile_template(
	'state$state_field$',
	{ state_field = emit_state_field }
)

templates.released_condition = lua_source_printer.compile_template('not state["pressed"]')
templates.held_condition = lua_source_printer.compile_template('state["press_time"] >= 1')

templates.window_condition = lua_source_printer.compile_template(
	'state$state_field$ < $bound$',
	{ state_field = emit_state_field }
)

templates.comparison_condition = lua_source_printer.compile_template(
	'state$state_field$$operator$$bound$',
	{ state_field = emit_state_field }
)

templates.negated_condition = lua_source_printer.compile_template(
	'not ($condition$)',
	{ condition = emit_modifier_base }
)

templates.pressed_condition = lua_source_printer.compile_template('state["pressed"]')
templates.not_consumed_condition = lua_source_printer.compile_template('not state["consumed"]')
templates.condition_and = lua_source_printer.compile_template(' and ')

templates.action_evaluation = lua_source_printer.compile_template([[
	state = get_state(context, $action_index$)
	$target$ = $condition$
]], {
	target = emit_target,
	condition = emit_action_condition,
})

templates.edge_state_match = lua_source_printer.compile_template([[
	edge_any = state$state_field$
	edge_all = edge_any
]], { state_field = emit_state_field })

templates.edge_window_match = lua_source_printer.compile_template([[
	edge_any = state$state_field$ < $window$
	edge_all = edge_any
]], { state_field = emit_state_field })

templates.edge_eligibility = lua_source_printer.compile_template([[
	if edge_ok then
		edge_eligible = 1
		$match$
	end
]], { match = emit_edge_match })

templates.edge_action = lua_source_printer.compile_template([[
	$evaluation$
	edge_eligible = 0
	edge_any = false
	edge_all = true
	$eligibility$
]], {
	evaluation = emit_edge_action_evaluation,
	eligibility = emit_edge_eligibility,
})

templates.edge_not = lua_source_printer.compile_template([[
	$evaluation$
	edge_ok = not edge_ok
	edge_eligible = 0
	edge_any = false
	edge_all = true
]], { evaluation = emit_left_evaluation })

templates.edge_and = lua_source_printer.compile_template([[
	$left$
	if edge_ok then
		local left_eligible = edge_eligible
		local left_any = edge_any
		local left_all = edge_all
		$right$
		if edge_ok then
			edge_eligible = left_eligible + edge_eligible
			edge_any = left_any or edge_any
			edge_all = left_all and edge_all
		end
	end
]], {
	left = emit_left_edge_collection,
	right = emit_right_edge_collection,
})

templates.edge_or = lua_source_printer.compile_template([[
	$left$
	if not edge_ok then
		$right$
	end
]], {
	left = emit_left_edge_collection,
	right = emit_right_edge_collection,
})

templates.edge_empty_all = lua_source_printer.compile_template([[
	edge_ok = true
	edge_eligible = 0
	edge_any = false
	edge_all = true
]])

templates.edge_empty_any = lua_source_printer.compile_template([[
	edge_ok = false
	edge_eligible = 0
	edge_any = false
	edge_all = true
]])

templates.edge_all_continuation = lua_source_printer.compile_template([[
	if edge_ok then
		local left_eligible = edge_eligible
		local left_any = edge_any
		local left_all = edge_all
		$argument$
		if edge_ok then
			edge_eligible = left_eligible + edge_eligible
			edge_any = left_any or edge_any
			edge_all = left_all and edge_all
		end
	end
]], { argument = emit_argument_edge_collection })

templates.edge_any_continuation = lua_source_printer.compile_template([[
	if not edge_ok then
		$argument$
	end
]], { argument = emit_argument_edge_collection })

templates.edge_reset_collection = lua_source_printer.compile_template([[
	edge_eligible = 0
	edge_any = false
	edge_all = true
]])

templates.not_evaluation = lua_source_printer.compile_template([[
	$evaluation$
	$target$ = not $target$
]], {
	evaluation = emit_left_evaluation,
	target = emit_target,
})

templates.and_evaluation = lua_source_printer.compile_template([[
	$left$
	if $target$ then
		$right$
	end
]], {
	left = emit_left_evaluation,
	target = emit_target,
	right = emit_right_evaluation,
})

templates.or_evaluation = lua_source_printer.compile_template([[
	$left$
	if not $target$ then
		$right$
	end
]], {
	left = emit_left_evaluation,
	target = emit_target,
	right = emit_right_evaluation,
})

templates.empty_all = lua_source_printer.compile_template('$target$ = true\n', { target = emit_target })
templates.empty_any = lua_source_printer.compile_template('$target$ = false\n', { target = emit_target })

templates.all_continuation = lua_source_printer.compile_template([[
	if $target$ then
		$argument$
	end
]], {
	target = emit_target,
	argument = emit_argument_evaluation,
})

templates.any_continuation = lua_source_printer.compile_template([[
	if not $target$ then
		$argument$
	end
]], {
	target = emit_target,
	argument = emit_argument_evaluation,
})

templates.edge_all_result = lua_source_printer.compile_template(
	'$target$ = edge_ok and edge_eligible > 0 and edge_all\n',
	{ target = emit_target }
)

templates.edge_any_result = lua_source_printer.compile_template(
	'$target$ = edge_ok and edge_any\n',
	{ target = emit_target }
)

templates.edge_all_result_continuation = lua_source_printer.compile_template([[
	if $target$ then
		$argument$
		$target$ = edge_ok and edge_eligible > 0 and edge_all
	end
]], {
	target = emit_target,
	argument = emit_argument_edge_collection,
})

templates.edge_any_result_continuation = lua_source_printer.compile_template([[
	if not $target$ then
		$argument$
		$target$ = edge_ok and edge_any
	end
]], {
	target = emit_target,
	argument = emit_argument_edge_collection,
})

templates.state_local = lua_source_printer.compile_template('local state\n')

templates.edge_locals = lua_source_printer.compile_template([[
	local edge_ok
	local edge_eligible
	local edge_any
	local edge_all
]])

templates.program = lua_source_printer.compile_template([[
	return function(source_get_state, source_states, source_win)
		local get_state<const> = source_get_state
		local context<const> = source_states
		local win<const> = source_win
		return function()
			local result
			$state_local$
			$edge_locals$
			$body$
			return result
		end
	end
]], {
	state_local = emit_state_local,
	edge_locals = emit_edge_locals,
	body = emit_program_body,
})

function action_parser.compile(src)
	local cached<const> = cache[src]
	if cached then
		return cached
	end
	local self<const> = setmetatable({
		tokens = lex(src),
		index = 1,
		source = src,
		action_names = {},
		action_name_indices = {},
	}, parser_state)
	local ast<const> = parse_expr(self)
	if current(self) then
		error('[cartlib/input/action_parser] Unexpected token "' .. current(self).value .. '" in "' .. src .. '".')
	end
	enforce_root_modifiers(ast, false)
	local analysis<const> = { uses_state = false, uses_edge = false }
	analyze_evaluation(ast, analysis)
	local printer<const> = lua_source_printer.new()
	printer:emit(templates.program, { ast = ast, analysis = analysis })
	local program<const> = {
		action_names = self.action_names,
		evaluation_factory = load(printer:finish(), '[input.action]', 't')(),
	}
	cache[src] = program
	return program
end

return action_parser
