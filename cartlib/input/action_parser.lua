-- cartlib/input/action_parser.lua
-- Cached action-expression compiler for cart-owned PlayerInput. Authored
-- syntax is parsed once; firmware load() produces the short-circuit evaluator
-- consumed directly by retained action bindings.

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

local append_modifier_condition<const> = function(parts, spec)
	if spec.neg then
		parts[#parts + 1] = 'not ('
	end
	local kind<const> = spec.kind
	local state_field<const> = modifier_state_field_by_kind[kind]
	if state_field ~= nil then
		parts[#parts + 1] = 'state["'
		parts[#parts + 1] = state_field
		parts[#parts + 1] = '"]'
	elseif kind == mod_kind_r then
		parts[#parts + 1] = 'not state["pressed"]'
	elseif kind == mod_kind_h then
		parts[#parts + 1] = 'state["press_time"] >= 1'
	elseif kind == mod_kind_wp then
		parts[#parts + 1] = 'state["min_press_delta"] < '
		parts[#parts + 1] = spec.window
	elseif kind == mod_kind_wr then
		parts[#parts + 1] = 'state["min_release_delta"] < '
		parts[#parts + 1] = spec.window
	elseif kind == mod_kind_t then
		parts[#parts + 1] = 'state["press_time"]'
		parts[#parts + 1] = comparison_operator_source_by_kind[spec.op]
		parts[#parts + 1] = spec.value
	else
		parts[#parts + 1] = 'state["repeat_count"]'
		parts[#parts + 1] = comparison_operator_source_by_kind[spec.op]
		parts[#parts + 1] = spec.value
	end
	if spec.neg then
		parts[#parts + 1] = ')'
	end
end

local append_action_condition<const> = function(parts, node, bare_requires_pressed)
	local first = true
	local specs<const> = node.mod_specs
	if #specs == 0 and bare_requires_pressed then
		parts[#parts + 1] = 'state["pressed"]'
		first = false
	end
	for index = 1, #specs do
		if not first then
			parts[#parts + 1] = ' and '
		end
		append_modifier_condition(parts, specs[index])
		first = false
	end
	if not node.has_consume_mod then
		if not first then
			parts[#parts + 1] = ' and '
		end
		parts[#parts + 1] = 'not state["consumed"]'
	end
end

local append_action_evaluation<const> = function(parts, node, target, bare_requires_pressed)
	parts.uses_state = true
	parts[#parts + 1] = 'state = get_state(context, '
	parts[#parts + 1] = node.action_index
	parts[#parts + 1] = ')\n'
	parts[#parts + 1] = target
	parts[#parts + 1] = ' = '
	append_action_condition(parts, node, bare_requires_pressed)
	parts[#parts + 1] = '\n'
end

local append_evaluation
local append_edge_collection

local append_edge_match<const> = function(parts, edge_spec, window)
	parts[#parts + 1] = 'edge_any = state["'
	local state_field<const> = edge_spec.state_field
	if state_field ~= nil then
		parts[#parts + 1] = state_field
		parts[#parts + 1] = '"]\n'
	else
		parts[#parts + 1] = edge_spec.delta_field
		parts[#parts + 1] = '"] < '
		parts[#parts + 1] = window
		parts[#parts + 1] = '\n'
	end
	parts[#parts + 1] = 'edge_all = edge_any\n'
end

append_edge_collection = function(parts, node, window, edge_spec)
	parts.uses_edge = true
	local kind<const> = node.kind
	if kind == node_kind_action then
		append_action_evaluation(parts, node, 'edge_ok', false)
		parts[#parts + 1] = 'edge_eligible = 0\nedge_any = false\nedge_all = true\n'
		if (node.edge_mask & edge_spec.edge_bit) ~= 0 then
			parts[#parts + 1] = 'if edge_ok then\nedge_eligible = 1\n'
			append_edge_match(parts, edge_spec, window)
			parts[#parts + 1] = 'end\n'
		end
		return
	end
	if kind == node_kind_not then
		append_evaluation(parts, node.left, 'edge_ok', window)
		parts[#parts + 1] = 'edge_ok = not edge_ok\nedge_eligible = 0\nedge_any = false\nedge_all = true\n'
		return
	end
	if kind == node_kind_and then
		append_edge_collection(parts, node.left, window, edge_spec)
		parts[#parts + 1] = 'if edge_ok then\nlocal left_eligible = edge_eligible\nlocal left_any = edge_any\nlocal left_all = edge_all\n'
		append_edge_collection(parts, node.right, window, edge_spec)
		parts[#parts + 1] = 'if edge_ok then\nedge_eligible = left_eligible + edge_eligible\nedge_any = left_any or edge_any\nedge_all = left_all and edge_all\nend\nend\n'
		return
	end
	if kind == node_kind_or then
		append_edge_collection(parts, node.left, window, edge_spec)
		parts[#parts + 1] = 'if not edge_ok then\n'
		append_edge_collection(parts, node.right, window, edge_spec)
		parts[#parts + 1] = 'end\n'
		return
	end
	local args<const> = node.args
	if node.function_kind == function_kind_all then
		if #args == 0 then
			parts[#parts + 1] = 'edge_ok = true\nedge_eligible = 0\nedge_any = false\nedge_all = true\n'
			return
		end
		append_edge_collection(parts, args[1], window, edge_spec)
		for index = 2, #args do
			parts[#parts + 1] = 'if edge_ok then\nlocal left_eligible = edge_eligible\nlocal left_any = edge_any\nlocal left_all = edge_all\n'
			append_edge_collection(parts, args[index], window, edge_spec)
			parts[#parts + 1] = 'if edge_ok then\nedge_eligible = left_eligible + edge_eligible\nedge_any = left_any or edge_any\nedge_all = left_all and edge_all\nend\nend\n'
		end
		return
	end
	if node.function_kind == function_kind_any then
		if #args == 0 then
			parts[#parts + 1] = 'edge_ok = false\nedge_eligible = 0\nedge_any = false\nedge_all = true\n'
			return
		end
		append_edge_collection(parts, args[1], window, edge_spec)
		for index = 2, #args do
			parts[#parts + 1] = 'if not edge_ok then\n'
			append_edge_collection(parts, args[index], window, edge_spec)
			parts[#parts + 1] = 'end\n'
		end
		return
	end
	append_evaluation(parts, node, 'edge_ok', window)
	parts[#parts + 1] = 'edge_eligible = 0\nedge_any = false\nedge_all = true\n'
end

append_evaluation = function(parts, node, target, window)
	local kind<const> = node.kind
	if kind == node_kind_action then
		append_action_evaluation(parts, node, target, true)
		return
	end
	if kind == node_kind_not then
		append_evaluation(parts, node.left, target, window)
		parts[#parts + 1] = target
		parts[#parts + 1] = ' = not '
		parts[#parts + 1] = target
		parts[#parts + 1] = '\n'
		return
	end
	if kind == node_kind_and then
		append_evaluation(parts, node.left, target, window)
		parts[#parts + 1] = 'if '
		parts[#parts + 1] = target
		parts[#parts + 1] = ' then\n'
		append_evaluation(parts, node.right, target, window)
		parts[#parts + 1] = 'end\n'
		return
	end
	if kind == node_kind_or then
		append_evaluation(parts, node.left, target, window)
		parts[#parts + 1] = 'if not '
		parts[#parts + 1] = target
		parts[#parts + 1] = ' then\n'
		append_evaluation(parts, node.right, target, window)
		parts[#parts + 1] = 'end\n'
		return
	end
	local args<const> = node.args
	local function_kind<const> = node.function_kind
	local function_window<const> = node.window or window
	if function_kind == function_kind_all or function_kind == function_kind_any then
		local match_all<const> = function_kind == function_kind_all
		if #args == 0 then
			parts[#parts + 1] = target
			parts[#parts + 1] = match_all and ' = true\n' or ' = false\n'
			return
		end
		append_evaluation(parts, args[1], target, function_window)
		for index = 2, #args do
			parts[#parts + 1] = match_all and 'if ' or 'if not '
			parts[#parts + 1] = target
			parts[#parts + 1] = ' then\n'
			append_evaluation(parts, args[index], target, function_window)
			parts[#parts + 1] = 'end\n'
		end
		return
	end
	local edge_spec<const> = edge_function_spec_by_kind[function_kind]
	parts.uses_edge = true
	if #args == 0 then
		parts[#parts + 1] = target
		parts[#parts + 1] = edge_spec.all and ' = true\n' or ' = false\n'
		return
	end
	append_edge_collection(parts, args[1], function_window, edge_spec)
	parts[#parts + 1] = target
	if edge_spec.all then
		parts[#parts + 1] = ' = edge_ok and edge_eligible > 0 and edge_all\n'
	else
		parts[#parts + 1] = ' = edge_ok and edge_any\n'
	end
	for index = 2, #args do
		parts[#parts + 1] = edge_spec.all and 'if ' or 'if not '
		parts[#parts + 1] = target
		parts[#parts + 1] = ' then\n'
		append_edge_collection(parts, args[index], function_window, edge_spec)
		parts[#parts + 1] = target
		if edge_spec.all then
			parts[#parts + 1] = ' = edge_ok and edge_eligible > 0 and edge_all\n'
		else
			parts[#parts + 1] = ' = edge_ok and edge_any\n'
		end
		parts[#parts + 1] = 'end\n'
	end
end

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
	local body<const> = {}
	append_evaluation(body, ast, 'result', 'win')
	local parts<const> = {
		'return function(get_state, context, win)\n',
		'local result\n',
	}
	if body.uses_state then
		parts[#parts + 1] = 'local state\n'
	end
	if body.uses_edge then
		parts[#parts + 1] = 'local edge_ok\nlocal edge_eligible\nlocal edge_any\nlocal edge_all\n'
	end
	for index = 1, #body do
		parts[#parts + 1] = body[index]
	end
	parts[#parts + 1] = 'return result\nend'
	local program<const> = {
		action_names = self.action_names,
		evaluate = load(table.concat(parts), '[input.action]', 't')(),
	}
	cache[src] = program
	return program
end

return action_parser
