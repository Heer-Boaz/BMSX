-- cartlib/input/action_parser.lua
-- Cached action-expression compiler for cart-owned PlayerInput. Authored
-- syntax is parsed once; the firmware compiler produces a factory that binds one
-- player's resolved states into the short-circuit evaluator used at runtime.

local action_syntax<const> = require('cartlib/input/action_syntax')
local action_program_syntax<const> = require('cartlib/input/action_program_syntax')
local compile_syntax<const> = lua_compiler.compile_syntax
local string_byte<const> = string.byte
local string_sub<const> = string.sub

local action_parser<const> = {}

local tk_ident<const> = 1
local tk_func_win<const> = 2
local tk_func<const> = 3
local tk_mod<const> = 4
local tk_or<const> = 5
local tk_and<const> = 6
local tk_not<const> = 7
local tk_left_parenthesis<const> = 8
local tk_right_parenthesis<const> = 9
local tk_left_bracket<const> = 10
local tk_right_bracket<const> = 11
local tk_comma<const> = 12
local tk_compare<const> = 13

local cache<const> = {}
local single_character_token_kind<const> = {
	[40] = tk_left_parenthesis,
	[41] = tk_right_parenthesis,
	[44] = tk_comma,
	[91] = tk_left_bracket,
	[93] = tk_right_bracket,
}
local token_text<const> = {
	[tk_or] = '|',
	[tk_and] = '&&',
	[tk_not] = '!',
	[tk_left_parenthesis] = '(',
	[tk_right_parenthesis] = ')',
	[tk_left_bracket] = '[',
	[tk_right_bracket] = ']',
	[tk_comma] = ',',
}
local modifier_kind<const> = action_syntax.modifier_kind
local mod_kind_p<const> = modifier_kind.pressed
local mod_kind_r<const> = modifier_kind.released
local mod_kind_jp<const> = modifier_kind.just_pressed
local mod_kind_all_jp<const> = modifier_kind.all_just_pressed
local mod_kind_jr<const> = modifier_kind.just_released
local mod_kind_all_jr<const> = modifier_kind.all_just_released
local mod_kind_gp<const> = modifier_kind.guarded_just_pressed
local mod_kind_rp<const> = modifier_kind.repeat_pressed
local mod_kind_c<const> = modifier_kind.consumed
local mod_kind_h<const> = modifier_kind.held
local mod_kind_wp<const> = modifier_kind.within_press
local mod_kind_wr<const> = modifier_kind.within_release
local mod_kind_t<const> = modifier_kind.press_time
local mod_kind_rc<const> = modifier_kind.repeat_count

local node_kind<const> = action_syntax.node_kind
local node_kind_action<const> = node_kind.action
local node_kind_not<const> = node_kind.logical_not
local node_kind_and<const> = node_kind.logical_and
local node_kind_or<const> = node_kind.logical_or
local node_kind_function<const> = node_kind.function_call

local function_kind<const> = action_syntax.function_kind
local function_kind_all<const> = function_kind.all
local function_kind_any<const> = function_kind.any
local function_kind_any_jp<const> = function_kind.any_just_pressed
local function_kind_all_jp<const> = function_kind.all_just_pressed
local function_kind_any_jr<const> = function_kind.any_just_released
local function_kind_all_jr<const> = function_kind.all_just_released
local function_kind_any_gp<const> = function_kind.any_guarded_just_pressed
local function_kind_all_gp<const> = function_kind.all_guarded_just_pressed
local function_kind_any_rp<const> = function_kind.any_repeat_pressed
local function_kind_all_rp<const> = function_kind.all_repeat_pressed
local function_kind_any_wp<const> = function_kind.any_within_press
local function_kind_all_wp<const> = function_kind.all_within_press
local function_kind_any_wr<const> = function_kind.any_within_release
local function_kind_all_wr<const> = function_kind.all_within_release

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

local compare_operator<const> = action_syntax.compare_operator
local compare_lt<const> = compare_operator.less_than
local compare_gt<const> = compare_operator.greater_than
local compare_lte<const> = compare_operator.less_equal
local compare_gte<const> = compare_operator.greater_equal
local compare_eq<const> = compare_operator.equal
local compare_ne<const> = compare_operator.not_equal

local edge<const> = action_syntax.edge
local edge_jp<const> = edge.just_pressed
local edge_jr<const> = edge.just_released
local edge_wp<const> = edge.within_press
local edge_wr<const> = edge.within_release
local edge_gp<const> = edge.guarded_just_pressed
local edge_rp<const> = edge.repeat_pressed

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
	while i <= last and is_space(string_byte(mod, i)) do
		i = i + 1
	end
	return i
end

-- Digits only. Returns value, next_index; value is nil when no digit is present.
local parse_uint<const> = function(mod, i, last)
	local byte = string_byte(mod, i)
	if i > last or not is_digit(byte) then
		return nil, i
	end
	local value = 0
	while i <= last and is_digit(byte) do
		value = value * 10 + (byte - 48)
		i = i + 1
		byte = string_byte(mod, i)
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
	if i <= last and string_byte(mod, i) == 46 then -- '.'
		i = i + 1
		local scale = 0.1
		while i <= last and is_digit(string_byte(mod, i)) do
			value = value + (string_byte(mod, i) - 48) * scale
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
	local byte<const> = string_byte(mod, i)
	if byte == 60 or byte == 62 then -- '<' '>'
		if string_byte(mod, i + 1) == 61 then -- '='
			op = byte == 60 and compare_lte or compare_gte
			i = i + 2
		else
			op = byte == 60 and compare_lt or compare_gt
			i = i + 1
		end
	elseif byte == 33 or byte == 61 then -- '!' '='
		if string_byte(mod, i + 1) ~= 61 then
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
	local neg<const> = string_byte(mod, 1) == 33 -- '!'
	local start<const> = neg and 2 or 1
	local len<const> = #mod
	local brace = nil
	for i = start, len do
		if string_byte(mod, i) == 123 then -- '{'
			brace = i
			break
		end
	end
	if brace == nil then
		local kind<const> = simple_mod_kinds[neg and string_sub(mod, start) or mod]
		if kind then
			return { kind = kind, neg = neg }
		end
		error('[cartlib/input/action_parser] Unknown action modifier "' .. mod .. '".')
	end
	local kind<const> = braced_mod_kinds[string_sub(mod, start, brace - 1)]
	local body_start<const> = brace + 1
	local body_last<const> = len - 1 -- the scanner guarantees the trailing '}'
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

-- The parser retains one scanner token: it never allocates an intermediate
-- token list or token records, and materializes text only for identifiers and
-- modifiers retained by the semantic tree. This mirrors the firmware Lua
-- parser's scanner -> recursive descent boundary.
local scan_next<const> = function(state)
	local source<const> = state.source
	local length<const> = state.source_length
	local index = state.source_index
	while index <= length and is_space(string_byte(source, index)) do
		index = index + 1
	end
	if index > length then
		state.source_index = index
		state.token_kind = nil
		state.token_value = nil
		return
	end

	local code<const> = string_byte(source, index)
	local next_code<const> = index < length and string_byte(source, index + 1)
	local kind
	if code == 124 then -- '|', '||'
		kind = tk_or
		if next_code == 124 then
			index = index + 2
		else
			index = index + 1
		end
		state.token_value = token_text[kind]
	elseif code == 38 and next_code == 38 then -- '&&'
		kind = tk_and
		index = index + 2
		state.token_value = token_text[kind]
	elseif code == 38 or code == 63 then -- '&', '?'
		local start<const> = index
		index = index + 1
		while index <= length and is_alpha(string_byte(source, index)) do
			index = index + 1
		end
		if index <= length and string_byte(source, index) == 123 then -- '{'
			index = index + 1
			if index <= length and string_byte(source, index) == 125 then -- '}'
				error('[cartlib/input/action_parser] Empty function window in "' .. source .. '".')
			end
			while index <= length and is_digit(string_byte(source, index)) do
				index = index + 1
			end
			if index > length or string_byte(source, index) ~= 125 then -- '}'
				error('[cartlib/input/action_parser] Unterminated windowed function in "' .. source .. '".')
			end
			index = index + 1
			kind = tk_func_win
		else
			kind = tk_func
		end
		state.token_value = string_sub(source, start, index - 1)
	elseif code == 33 then -- '!', '!='
		if next_code == 61 then
			kind = tk_compare
			state.token_value = '!='
			index = index + 2
		else
			kind = tk_not
			state.token_value = token_text[kind]
			index = index + 1
		end
	elseif code == 60 or code == 62 then -- '<', '>', '<=', '>='
		kind = tk_compare
		local start<const> = index
		if next_code == 61 then
			index = index + 2
		else
			index = index + 1
		end
		state.token_value = string_sub(source, start, index - 1)
	elseif code == 61 and next_code == 61 then -- '=='
		kind = tk_compare
		state.token_value = '=='
		index = index + 2
	elseif is_alpha(code) then
		local start<const> = index
		index = index + 1
		while index <= length and is_alnum(string_byte(source, index)) do
			index = index + 1
		end
		if index <= length and string_byte(source, index) == 123 then -- '{'
			local depth = 1
			index = index + 1
			while index <= length and depth > 0 do
				local nested_code<const> = string_byte(source, index)
				if nested_code == 123 then -- '{'
					depth = depth + 1
				elseif nested_code == 125 then -- '}'
					depth = depth - 1
				end
				index = index + 1
			end
			if depth ~= 0 then
				error('[cartlib/input/action_parser] Unterminated modifier in "' .. source .. '".')
			end
			kind = tk_mod
		else
			kind = tk_ident
		end
		state.token_value = string_sub(source, start, index - 1)
	else
		kind = single_character_token_kind[code]
		if kind == nil then
			error('[cartlib/input/action_parser] Unexpected character "'
				.. string_sub(source, index, index) .. '" in "' .. source .. '".')
		end
		state.token_value = token_text[kind]
		index = index + 1
	end
	state.source_index = index
	state.token_kind = kind
end

local take<const> = function(self, kind)
	local token_kind<const> = self.token_kind
	local token_value<const> = self.token_value
	if token_kind ~= kind then
		local found<const> = token_value or '<eos>'
		error('[cartlib/input/action_parser] Unexpected token "' .. found .. '" in "' .. self.source .. '".')
	end
	scan_next(self)
	return token_value
end

local annotate_action
local parse_expr

local make_op<const> = function(kind, left, right)
	return { kind = kind, left = left, right = right }
end

local parse_modifiers<const> = function(self)
	local mods<const> = {}
	take(self, tk_left_bracket)
	while self.token_kind ~= nil and self.token_kind ~= tk_right_bracket do
		local kind<const> = self.token_kind
		local value<const> = self.token_value
		scan_next(self)
		if kind ~= tk_comma then
			if kind == tk_not then
				mods[#mods + 1] = '!' .. take(self, self.token_kind)
			else
				mods[#mods + 1] = value
			end
		end
	end
	take(self, tk_right_bracket)
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
	local name<const> = take(self, tk_ident)
	local action_index = self.action_name_indices[name]
	if not action_index then
		action_index = #self.action_names + 1
		self.action_name_indices[name] = action_index
		self.action_names[action_index] = name
	end
	local mods<const> = self.token_kind == tk_left_bracket and parse_modifiers(self) or {}
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
	local token_kind<const> = self.token_kind
	local token_value<const> = self.token_value
	scan_next(self)
	local fname = token_value
	local window = nil
	if token_kind == tk_func_win then
		-- The scanner guarantees prefix + alphas + '{' + digits + '}'.
		local value<const> = token_value
		local brace = 2
		while string_byte(value, brace) ~= 123 do -- '{'
			brace = brace + 1
		end
		fname = string_sub(value, 1, brace - 1)
		local parsed_window<const> = parse_uint(value, brace + 1, #value - 1)
		window = parsed_window
	end
	take(self, tk_left_parenthesis)
	local args<const> = {}
	if self.token_kind ~= nil and self.token_kind ~= tk_right_parenthesis then
		args[#args + 1] = parse_expr(self)
		while self.token_kind == tk_comma do
			scan_next(self)
			args[#args + 1] = parse_expr(self)
		end
	end
	take(self, tk_right_parenthesis)
	local function_kind<const> = function_kinds[fname]
	if not function_kind then
		error('[cartlib/input/action_parser] Unknown function helper "' .. fname .. '" in "' .. self.source .. '".')
	end
	return { kind = node_kind_function, function_kind = function_kind, args = args, window = window }
end

local parse_factor<const> = function(self)
	local kind<const> = self.token_kind
	if kind == nil then
		error('[cartlib/input/action_parser] Unexpected end of input in "' .. self.source .. '".')
	end
	if kind == tk_not then
		scan_next(self)
		return make_op(node_kind_not, parse_factor(self))
	end
	if kind == tk_left_parenthesis then
		scan_next(self)
		local node<const> = parse_expr(self)
		take(self, tk_right_parenthesis)
		if self.token_kind == tk_left_bracket then
			apply_modifiers(node, parse_modifiers(self))
		end
		return node
	end
	if kind == tk_func or kind == tk_func_win then
		return parse_function(self)
	end
	return parse_action(self)
end

local parse_binary<const> = function(self, operand, node_kind, token_kind)
	local node = operand(self)
	while self.token_kind == token_kind do
		scan_next(self)
		node = make_op(node_kind, node, operand(self))
	end
	return node
end

local parse_term<const> = function(self)
	return parse_binary(self, parse_factor, node_kind_and, tk_and)
end

parse_expr = function(self)
	return parse_binary(self, parse_term, node_kind_or, tk_or)
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

function action_parser.compile(src)
	local cached<const> = cache[src]
	if cached then
		return cached
	end
	local self<const> = {
		source = src,
		source_length = #src,
		source_index = 1,
		action_names = {},
		action_name_indices = {},
	}
	scan_next(self)
	local ast<const> = parse_expr(self)
	if self.token_kind ~= nil then
		error('[cartlib/input/action_parser] Unexpected token "' .. self.token_value .. '" in "' .. src .. '".')
	end
	enforce_root_modifiers(ast, false)
	local program_syntax<const>, action_requirement_masks<const> = action_program_syntax.build(
		ast,
		#self.action_names
	)
	local program<const> = {
		action_names = self.action_names,
		action_requirement_masks = action_requirement_masks,
		evaluation_factory = compile_syntax(
			program_syntax,
			'[input.action]'
		)(),
	}
	cache[src] = program
	return program
end

return action_parser
