-- cartlib/input/action_parser.lua
-- Cached action-expression parser/evaluator for cart-owned PlayerInput.

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
local mod_kind_pr<const> = 15

local compare_number<const> = function(op, left, right)
	if op == '<' then return left < right end
	if op == '>' then return left > right end
	if op == '<=' then return left <= right end
	if op == '>=' then return left >= right end
	if op == '==' then return left == right end
	return left ~= right
end

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
	local op = '>='
	local byte<const> = string.byte(mod, i)
	if byte == 60 or byte == 62 then -- '<' '>'
		if string.byte(mod, i + 1) == 61 then -- '='
			op = byte == 60 and '<=' or '>='
			i = i + 2
		else
			op = byte == 60 and '<' or '>'
			i = i + 1
		end
	elseif byte == 33 or byte == 61 then -- '!' '='
		if string.byte(mod, i + 1) ~= 61 then
			return nil, nil
		end
		op = byte == 33 and '!=' or '=='
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
	['pr'] = mod_kind_pr,
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
	elseif kind == mod_kind_pr then
		local value<const>, next_i<const> = parse_uint(mod, body_start, body_last)
		if value ~= nil and next_i > body_last then
			return { kind = kind, neg = neg }
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

local make_op<const> = function(op, left, right)
	return { kind = 'op', op = op, left = left, right = right }
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
	if node.kind == 'action' then
		local node_mods<const> = node.mods
		for i = 1, #mods do
			node_mods[#node_mods + 1] = mods[i]
		end
		annotate_action(node)
		return
	end
	if node.kind == 'op' then
		apply_modifiers(node.left, mods)
		if node.right then
			apply_modifiers(node.right, mods)
		end
		return
	end
	if node.kind == 'fun' then
		local args<const> = node.args
		for i = 1, #args do
			apply_modifiers(args[i], mods)
		end
	end
end

local parse_action<const> = function(self)
	local name<const> = take(self, tk_ident).value
	local mods<const> = current(self) and current(self).value == '[' and parse_modifiers(self) or {}
	local node<const> = {
		kind = 'action',
		name = name,
		mods = mods,
		edge_for_jp = false,
		edge_for_jr = false,
		edge_for_wp = false,
		edge_for_wr = false,
		edge_for_gp = false,
		edge_for_rp = false,
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
	return { kind = 'fun', fname = fname, args = args, window = window }
end

local parse_factor<const> = function(self)
	local c<const> = current(self)
	if not c then
		error('[cartlib/input/action_parser] Unexpected end of input in "' .. self.source .. '".')
	end
	if c.value == '!' then
		eat(self)
		return make_op('not', parse_factor(self))
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
	return parse_binary(self, parse_factor, 'and', '&&', false)
end

parse_expr = function(self)
	return parse_binary(self, parse_term, 'or', '||', '|')
end

annotate_action = function(node)
	local mods<const> = node.mods
	local specs<const> = {}
	node.mod_specs = specs
	node.has_consume_mod = false
	if #mods == 0 then
		node.edge_for_jp = true
		node.edge_for_wp = true
		node.edge_for_gp = true
		node.edge_for_rp = true
		node.edge_for_jr = false
		node.edge_for_wr = false
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
	node.edge_for_jp = press_pos
	node.edge_for_wp = press_pos
	node.edge_for_jr = release_pos
	node.edge_for_wr = release_pos
	node.edge_for_gp = guard_pos
	node.edge_for_rp = repeat_pos
end

local enforce_root_modifiers<const> = function(node, in_function)
	if node.kind == 'action' then
		if not in_function and #node.mods == 0 then
			error('[cartlib/input/action_parser] Root-level action "' .. node.name .. '" must specify a modifier like [p].')
		end
		return
	end
	if node.kind == 'op' then
		enforce_root_modifiers(node.left, in_function)
		if node.right then
			enforce_root_modifiers(node.right, in_function)
		end
		return
	end
	if node.kind == 'fun' then
		local args<const> = node.args
		for i = 1, #args do
			enforce_root_modifiers(args[i], true)
		end
	end
end

local parse<const> = function(src)
	local cached<const> = cache[src]
	if cached then
		return cached
	end
	local self<const> = setmetatable({ tokens = lex(src), index = 1, source = src }, parser_state)
	local ast<const> = parse_expr(self)
	if current(self) then
		error('[cartlib/input/action_parser] Unexpected token "' .. current(self).value .. '" in "' .. src .. '".')
	end
	enforce_root_modifiers(ast, false)
	cache[src] = ast
	return ast
end

local mod_matches<const> = function(get_state, name, spec, win)
	local kind<const> = spec.kind
	local state
	local result
	if kind == mod_kind_p then
		result = get_state(name, win).pressed
	elseif kind == mod_kind_r then
		result = not get_state(name, win).pressed
	elseif kind == mod_kind_jp then
		result = get_state(name, win).justpressed
	elseif kind == mod_kind_all_jp then
		result = get_state(name, win).alljustpressed
	elseif kind == mod_kind_jr then
		result = get_state(name, win).justreleased
	elseif kind == mod_kind_all_jr then
		result = get_state(name, win).alljustreleased
	elseif kind == mod_kind_gp then
		result = get_state(name, win).guardedjustpressed
	elseif kind == mod_kind_rp then
		result = get_state(name, win).repeatpressed
	elseif kind == mod_kind_c then
		result = get_state(name, win).consumed
	elseif kind == mod_kind_h then
		state = get_state(name, win)
		result = state.presstime >= 1
	elseif kind == mod_kind_wp then
		result = get_state(name, spec.window).waspressed
	elseif kind == mod_kind_wr then
		result = get_state(name, spec.window).wasreleased
	elseif kind == mod_kind_t then
		result = compare_number(spec.op, get_state(name, win).presstime, spec.value)
	elseif kind == mod_kind_rc then
		result = compare_number(spec.op, get_state(name, win).repeatcount, spec.value)
	else
		result = true
	end
	return spec.neg and not result or result
end

local action_eval<const> = function(node, get_state, win)
	local specs<const> = node.mod_specs
	for i = 1, #specs do
		if not mod_matches(get_state, node.name, specs[i], win) then
			return false
		end
	end
	if not node.has_consume_mod and get_state(node.name, win).consumed then
		return false
	end
	return true
end

local eval_node
local eval_collect

local collect_function<const> = function(node, get_state, win, scratch, count)
	local args<const> = node.args
	if node.fname == '&' then
		local next_count = count
		for i = 1, #args do
			local ok<const>, collected_count<const> = eval_collect(args[i], get_state, win, scratch, next_count)
			if not ok then
				return false, count
			end
			next_count = collected_count
		end
		return true, next_count
	end
	if node.fname == '?' then
		for i = 1, #args do
			local ok<const>, next_count<const> = eval_collect(args[i], get_state, win, scratch, count)
			if ok then
				return true, next_count
			end
		end
		return false, count
	end
	return eval_node(node, get_state, win), count
end

eval_collect = function(node, get_state, win, scratch, count)
	if node.kind == 'action' then
		if action_eval(node, get_state, win) then
			local next_count<const> = count + 1
			scratch[next_count] = node
			return true, next_count
		end
		return false, count
	end
	if node.kind == 'op' then
		if node.op == 'not' then
			return not eval_node(node.left, get_state, win), count
		end
		if node.op == 'and' then
			local ok<const>, next_count<const> = eval_collect(node.left, get_state, win, scratch, count)
			if not ok then
				return false, count
			end
			return eval_collect(node.right, get_state, win, scratch, next_count)
		end
		local ok<const>, next_count<const> = eval_collect(node.left, get_state, win, scratch, count)
		if ok then
			return true, next_count
		end
		return eval_collect(node.right, get_state, win, scratch, count)
	end
	return collect_function(node, get_state, win, scratch, count)
end

local edge_any<const> = function(args, get_state, win, scratch, edge_field, state_field)
	for i = 1, #args do
		local ok<const>, count<const> = eval_collect(args[i], get_state, win, scratch, 0)
		if ok then
			for j = 1, count do
				local action<const> = scratch[j]
				if action[edge_field] and get_state(action.name, win)[state_field] then
					return true
				end
				scratch[j] = nil
			end
		else
			for j = 1, count do
				scratch[j] = nil
			end
		end
	end
	return false
end

local edge_all<const> = function(args, get_state, win, scratch, edge_field, state_field)
	for i = 1, #args do
		local ok<const>, count<const> = eval_collect(args[i], get_state, win, scratch, 0)
		if not ok then
			return false
		end
		local eligible = false
		for j = 1, count do
			local action<const> = scratch[j]
			if action[edge_field] then
				eligible = true
				if not get_state(action.name, win)[state_field] then
					return false
				end
			end
			scratch[j] = nil
		end
		if not eligible then
			return false
		end
	end
	return true
end

local eval_function<const> = function(node, get_state, win)
	local fname<const> = node.fname
	local args<const> = node.args
	local scratch<const> = action_parser.scratch
	local fn_window<const> = node.window or win
	if fname == '&' then
		for i = 1, #args do
			if not eval_node(args[i], get_state, fn_window) then
				return false
			end
		end
		return true
	end
	if fname == '?' then
		for i = 1, #args do
			if eval_node(args[i], get_state, fn_window) then
				return true
			end
		end
		return false
	end
	if fname == '?jp' then return edge_any(args, get_state, fn_window, scratch, 'edge_for_jp', 'justpressed') end
	if fname == '&jp' then return edge_all(args, get_state, fn_window, scratch, 'edge_for_jp', 'justpressed') end
	if fname == '?jr' then return edge_any(args, get_state, fn_window, scratch, 'edge_for_jr', 'justreleased') end
	if fname == '&jr' then return edge_all(args, get_state, fn_window, scratch, 'edge_for_jr', 'justreleased') end
	if fname == '?gp' then return edge_any(args, get_state, fn_window, scratch, 'edge_for_gp', 'guardedjustpressed') end
	if fname == '&gp' then return edge_all(args, get_state, fn_window, scratch, 'edge_for_gp', 'guardedjustpressed') end
	if fname == '?rp' then return edge_any(args, get_state, fn_window, scratch, 'edge_for_rp', 'repeatpressed') end
	if fname == '&rp' then return edge_all(args, get_state, fn_window, scratch, 'edge_for_rp', 'repeatpressed') end
	if fname == '?wp' then return edge_any(args, get_state, fn_window, scratch, 'edge_for_wp', 'waspressed') end
	if fname == '&wp' then return edge_all(args, get_state, fn_window, scratch, 'edge_for_wp', 'waspressed') end
	if fname == '?wr' then return edge_any(args, get_state, fn_window, scratch, 'edge_for_wr', 'wasreleased') end
	if fname == '&wr' then return edge_all(args, get_state, fn_window, scratch, 'edge_for_wr', 'wasreleased') end
	error('[cartlib/input/action_parser] Unknown function helper "' .. fname .. '".')
end

eval_node = function(node, get_state, win)
	if node.kind == 'action' then
		return action_eval(node, get_state, win)
	end
	if node.kind == 'op' then
		if node.op == 'not' then return not eval_node(node.left, get_state, win) end
		if node.op == 'and' then return eval_node(node.left, get_state, win) and eval_node(node.right, get_state, win) end
		return eval_node(node.left, get_state, win) or eval_node(node.right, get_state, win)
	end
	return eval_function(node, get_state, win)
end

action_parser.scratch = {}

action_parser.check = function(def, get_state)
	return eval_node(parse(def), get_state)
end

return action_parser
