-- progression.lua
-- generic compiled progression runtime for boolean/integer state rules

local progression = {}
progression.__index = progression

local EMPTY_LIST = {}

local function new_empty_program()
	return {
		key2idx = {},
		idx2key = {},
		rules = {},
		rules_by_key = {},
	}
end

local OP_EQ = 1
local OP_NE = 2
local OP_LT = 3
local OP_LTE = 4
local OP_GT = 5
local OP_GTE = 6

local OP_BY_TEXT = {
	['=='] = OP_EQ,
	['='] = OP_EQ,
	eq = OP_EQ,
	['!='] = OP_NE,
	['~='] = OP_NE,
	ne = OP_NE,
	['<'] = OP_LT,
	lt = OP_LT,
	['<='] = OP_LTE,
	lte = OP_LTE,
	['>'] = OP_GT,
	gt = OP_GT,
	['>='] = OP_GTE,
	gte = OP_GTE,
}

local function default_for(value)
	local value_type = type(value)
	if value_type == 'boolean' then
		return false
	end
	if value_type == 'number' then
		return 0
	end
	return nil
end

local function compare(left, op, right)
	if op == OP_EQ then
		return left == right
	end
	if op == OP_NE then
		return left ~= right
	end
	if op == OP_LT then
		return left < right
	end
	if op == OP_LTE then
		return left <= right
	end
	if op == OP_GT then
		return left > right
	end
	return left >= right
end

local function intern_key(program, key)
	if type(key) ~= 'string' or key == '' then
		error('progression key must be a non-empty string.')
	end
	local key_idx = program.key2idx[key]
	if key_idx ~= nil then
		return key_idx
	end
	key_idx = #program.idx2key + 1
	program.key2idx[key] = key_idx
	program.idx2key[key_idx] = key
	return key_idx
end

local function normalize_condition(spec)
	if type(spec) == 'string' then
		if spec:sub(1, 1) == '!' then
			return spec:sub(2), OP_EQ, false
		end
		return spec, OP_EQ, true
	end

	if type(spec) ~= 'table' then
		error('progression condition must be string or table.')
	end

	local key = spec.key or spec[1]
	if type(key) ~= 'string' or key == '' then
		error('progression condition is missing key.')
	end

	local op_text = spec.op or spec[2] or '=='
	local op = OP_BY_TEXT[op_text]
	if op == nil then
		error("progression condition has unknown operator '" .. tostring(op_text) .. "'.")
	end

	local value = spec.equals
	if value == nil then
		value = spec.value
	end
	if value == nil then
		value = spec[3]
	end
	if value == nil then
		value = true
	end

	if (op == OP_LT or op == OP_LTE or op == OP_GT or op == OP_GTE) and type(value) ~= 'number' then
		error("progression condition '" .. key .. "' expects numeric value for operator '" .. tostring(op_text) .. "'.")
	end

	return key, op, value
end

local function compile_predicates(program, source)
	if source == nil then
		return EMPTY_LIST
	end
	local compiled = {}
	local out_index = 1
	for i = 1, #source do
		local key, op, value = normalize_condition(source[i])
		compiled[out_index] = intern_key(program, key)
		compiled[out_index + 1] = op
		compiled[out_index + 2] = value
		compiled[out_index + 3] = default_for(value)
		out_index = out_index + 4
	end
	return compiled
end

local function resolve_when_all(def, rule_label)
	if def.when_all ~= nil then
		return def.when_all
	end
	local when = def.when
	if when == nil then
		return nil
	end
	if type(when) ~= 'table' then
		error("progression rule '" .. rule_label .. "' has invalid 'when' value.")
	end
	if when.all ~= nil then
		return when.all
	end
	if when[1] ~= nil then
		return when
	end
	error("progression rule '" .. rule_label .. "' requires 'when.all' or 'when_all'.")
end

local function is_compiled_predicates(source)
	if type(source) ~= 'table' then
		return false
	end
	local count = #source
	if count == 0 then
		return true
	end
	if count % 4 ~= 0 then
		return false
	end
	return type(source[1]) == 'number'
end

local function eval_predicates(values, predicates)
	for i = 1, #predicates, 4 do
		local left = values[predicates[i]]
		if left == nil then
			left = predicates[i + 3]
		end
		if not compare(left, predicates[i + 1], predicates[i + 2]) then
			return false
		end
	end
	return true
end

local function add_rule_key(program, key_idx, rule_idx)
	local list = program.rules_by_key[key_idx]
	if list == nil then
		list = {}
		program.rules_by_key[key_idx] = list
	end
	list[#list + 1] = rule_idx
end

function progression.compile_program(program_spec)
	local rule_defs
	local seed_keys

	if program_spec == nil then
		rule_defs = EMPTY_LIST
	elseif program_spec.rules ~= nil or program_spec.keys ~= nil then
		rule_defs = program_spec.rules or EMPTY_LIST
		seed_keys = program_spec.keys
	else
		rule_defs = program_spec
	end

	local program = {
		key2idx = {},
		idx2key = {},
		rules = {},
		rules_by_key = {},
	}

	if seed_keys ~= nil then
		for i = 1, #seed_keys do
			intern_key(program, seed_keys[i])
		end
	end

	for i = 1, #rule_defs do
		local def = rule_defs[i]
		local rule_label = def.id or ('rule_' .. i)
		local cond = compile_predicates(program, resolve_when_all(def, rule_label))
		local scope_key_idx = 0
		local scope_op = OP_EQ
		local scope_value = true
		local scope_default = true
		if def.scope ~= nil then
			local key, op, value = normalize_condition(def.scope)
			scope_key_idx = intern_key(program, key)
			scope_op = op
			scope_value = value
			scope_default = default_for(value)
		end

		program.rules[i] = {
			id = rule_label,
			cond = cond,
			scope_key_idx = scope_key_idx,
			scope_op = scope_op,
			scope_value = scope_value,
			scope_default = scope_default,
			apply_commands = def.apply or EMPTY_LIST,
			enter_commands = def.enter or EMPTY_LIST,
			apply_once = def.apply_once == true,
			enter_once = def.enter_once == true,
		}

		local touched = {}
		for j = 1, #cond, 4 do
			local key_idx = cond[j]
			if touched[key_idx] ~= true then
				touched[key_idx] = true
				add_rule_key(program, key_idx, i)
			end
		end
		if scope_key_idx ~= 0 and touched[scope_key_idx] ~= true then
			add_rule_key(program, scope_key_idx, i)
		end
	end

	return program
end

function progression.ensure_key(program, key)
	return intern_key(program, key)
end

function progression.compile_filter(program, source)
	if is_compiled_predicates(source) then
		return source
	end
	return compile_predicates(program, source)
end

function progression.compile_filters(program, sources)
	if sources == nil then
		return EMPTY_LIST
	end
	local out = {}
	for i = 1, #sources do
		out[i] = progression.compile_filter(program, sources[i])
	end
	return out
end

local function mark_dirty(self, key_idx)
	if self.dirty_map[key_idx] == true then
		return
	end
	self.dirty_map[key_idx] = true
	local next_index = self.dirty_count + 1
	self.dirty_count = next_index
	self.dirty_keys[next_index] = key_idx
end

local function clear_dirty(self)
	for i = 1, self.dirty_count do
		local key_idx = self.dirty_keys[i]
		self.dirty_map[key_idx] = nil
		self.dirty_keys[i] = nil
	end
	self.dirty_count = 0
end

local function add_candidate(self, rule_idx)
	if self.candidate_map[rule_idx] == true then
		return
	end
	self.candidate_map[rule_idx] = true
	local next_index = self.candidate_count + 1
	self.candidate_count = next_index
	self.candidate_rules[next_index] = rule_idx
end

local function clear_candidates(self)
	for i = 1, self.candidate_count do
		local rule_idx = self.candidate_rules[i]
		self.candidate_map[rule_idx] = nil
		self.candidate_rules[i] = nil
	end
	self.candidate_count = 0
end

local function add_candidates_for_key_idx(self, key_idx)
	local list = self.program.rules_by_key[key_idx]
	if list == nil then
		return
	end
	for i = 1, #list do
		add_candidate(self, list[i])
	end
end

local function emit_commands(self, commands)
	local base = self.command_count
	for i = 1, #commands do
		self.command_buffer[base + i] = commands[i]
	end
	self.command_count = base + #commands
end

function progression.new(program)
	local self = setmetatable({
		program = new_empty_program(),
		values = {},
		dirty_map = {},
		dirty_keys = {},
		dirty_count = 0,
		candidate_map = {},
		candidate_rules = {},
		candidate_count = 0,
		prev_rule_ok = {},
		prev_scope_ok = {},
		apply_done = {},
		enter_done = {},
		command_buffer = {},
		command_count = 0,
		filter_cache = setmetatable({}, { __mode = 'k' }),
	}, progression)

	if program ~= nil then
		self:attach_program(program)
	end

	return self
end

function progression:attach_program(program)
	self.program = program or new_empty_program()
	self.values = {}
	self.dirty_map = {}
	self.dirty_keys = {}
	self.dirty_count = 0
	self.candidate_map = {}
	self.candidate_rules = {}
	self.candidate_count = 0
	self.prev_rule_ok = {}
	self.prev_scope_ok = {}
	self.apply_done = {}
	self.enter_done = {}
	self.command_buffer = {}
	self.command_count = 0
	self.filter_cache = setmetatable({}, { __mode = 'k' })
end

function progression:compile_rules(rule_defs)
	self:attach_program(progression.compile_program(rule_defs))
end

function progression:key_index(key)
	return self.program.key2idx[key]
end

function progression:ensure_key(key)
	return progression.ensure_key(self.program, key)
end

function progression:set_by_index(key_idx, value)
	if self.values[key_idx] == value then
		return false
	end
	self.values[key_idx] = value
	mark_dirty(self, key_idx)
	return true
end

function progression:get_by_index(key_idx)
	return self.values[key_idx]
end

function progression:matches_by_index(key_idx, expected)
	local left = self.values[key_idx]
	if left == nil then
		left = default_for(expected)
	end
	return left == expected
end

function progression:matches_filter(filter)
	if filter == nil then
		return true
	end
	if is_compiled_predicates(filter) then
		return eval_predicates(self.values, filter)
	end
	local cached = self.filter_cache[filter]
	if cached == nil then
		cached = compile_predicates(self.program, filter)
		self.filter_cache[filter] = cached
	end
	return eval_predicates(self.values, cached)
end

function progression:compile_filter(source)
	return progression.compile_filter(self.program, source)
end

function progression:set(key, value)
	local key_idx = self.program.key2idx[key]
	if key_idx == nil then
		key_idx = intern_key(self.program, key)
	end
	return self:set_by_index(key_idx, value)
end

function progression:get(key)
	local key_idx = self.program.key2idx[key]
	if key_idx == nil then
		return nil
	end
	return self.values[key_idx]
end

function progression:add_by_index(key_idx, delta)
	local current = self.values[key_idx]
	if current == nil then
		current = 0
	end
	local next_value = current + delta
	self:set_by_index(key_idx, next_value)
	return next_value
end

function progression:add(key, delta)
	local key_idx = self.program.key2idx[key]
	if key_idx == nil then
		key_idx = intern_key(self.program, key)
	end
	return self:add_by_index(key_idx, delta)
end

function progression:reevaluate(hint)
	local rules = self.program.rules

	if hint == true or hint == 'all' then
		for i = 1, #rules do
			add_candidate(self, i)
		end
	elseif type(hint) == 'table' and hint.keys ~= nil then
		local key2idx = self.program.key2idx
		local keys = hint.keys
		for i = 1, #keys do
			local key = keys[i]
			local key_idx
			if type(key) == 'number' then
				key_idx = key
			else
				key_idx = key2idx[key]
			end
			if key_idx ~= nil then
				add_candidates_for_key_idx(self, key_idx)
			end
		end
	else
		for i = 1, self.dirty_count do
			add_candidates_for_key_idx(self, self.dirty_keys[i])
		end
	end

	for i = 1, self.candidate_count do
		local rule_idx = self.candidate_rules[i]
		local rule = rules[rule_idx]

		local cond_ok = eval_predicates(self.values, rule.cond)
		local scope_ok
		if rule.scope_key_idx == 0 then
			scope_ok = true
		else
			local left = self.values[rule.scope_key_idx]
			if left == nil then
				left = rule.scope_default
			end
			scope_ok = compare(left, rule.scope_op, rule.scope_value)
		end
		local rule_ok = cond_ok and scope_ok

		if rule_ok and self.prev_rule_ok[rule_idx] ~= true then
			if #rule.apply_commands > 0 and (not rule.apply_once or self.apply_done[rule_idx] ~= true) then
				emit_commands(self, rule.apply_commands)
				if rule.apply_once then
					self.apply_done[rule_idx] = true
				end
			end
		end

		if scope_ok and self.prev_scope_ok[rule_idx] ~= true and cond_ok then
			if #rule.enter_commands > 0 and (not rule.enter_once or self.enter_done[rule_idx] ~= true) then
				emit_commands(self, rule.enter_commands)
				if rule.enter_once then
					self.enter_done[rule_idx] = true
				end
			end
		end

		self.prev_rule_ok[rule_idx] = rule_ok == true
		self.prev_scope_ok[rule_idx] = scope_ok == true
	end

	clear_candidates(self)
	clear_dirty(self)
	return self.command_count
end

function progression:drain_commands(visitor)
	for i = 1, self.command_count do
		visitor(self.command_buffer[i])
		self.command_buffer[i] = nil
	end
	self.command_count = 0
end

return {
	progression = progression,
	compile_program = progression.compile_program,
	ensure_key = progression.ensure_key,
	compile_filter = progression.compile_filter,
	compile_filters = progression.compile_filters,
}
