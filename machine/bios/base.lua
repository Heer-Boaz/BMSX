local table_calls<const> = require('kernel/bios_table_ids')
local entries<const> = require('bmsx/startup')
local raise_error<const> = __bmsx_error
local console<const> = require('tty/console')

local numeric_parse<const> = require('number/parse')
local heap_calls<const> = require('kernel/heap_control_ids')
local types<const> = require('kernel/value_type')

local select_arguments<const> = function(selector, ...)
	local count<const> = blua32.argument_count() - 1
	if selector == '#' then return count end
	local start = selector & -1
	if start < 0 then start = count + start + 1 end
	if start < 1 then start = 1 end
	return blua32.argument_suffix(start - 1)
end

next = __bmsx_next
type = function(value)
	local tag<const> = blua32.tag(value)
	if tag == types.nil_tag then return 'nil' end
	if tag == types.false_tag or tag == types.true_tag then return 'boolean' end
	if tag == types.integer_tag or tag == types.float_tag then return 'number' end
	if tag == types.string_tag then return 'string' end
	if tag == types.table_tag then return 'table' end
	if tag == types.thread_tag then return 'thread' end
	if tag == types.closure_tag or tag == types.builtin_tag or tag == types.code_tag then
		return 'function'
	end
	raise_error('Internal table metadata is not a language value.')
end
setmetatable = require('kernel/set_metatable')
getmetatable = __bmsx_getmetatable
rawget = __bmsx_rawget
rawset = function(target, key, value)
	if blua32.argument_count() < 3 then
		blua32.svc(table_calls.raw_set)
	else
		blua32.svc_value(table_calls.raw_set, target, key, value)
	end
	return target
end
getglobal = __bmsx_getglobal
setglobal = require('kernel/set_global_entry')
select = select_arguments
error = raise_error
pcall = blua32.closure(entries.protected_call)
xpcall = blua32.closure(entries.protected_xcall)


assert = function(condition, ...)
	if condition then
		return condition, ...
	end
	if blua32.argument_count() > 1 then
		raise_error((...))
	end
	raise_error('assertion failed!')
end


rawequal = function(left, right)
	return left == right
end


tostring = function(value)
	return '' .. value
end


tonumber = function(value, base)
	local value_type<const> = type(value)
	if base == nil then
		if value_type == 'number' then
			return value
		end
		if value_type ~= 'string' then
			return nil
		end
		return numeric_parse.number(value)
	end
	if value_type ~= 'string' then
		error('bad argument #1 to tonumber (string expected)')
	end
	local integer_base<const> = base // 1
	if integer_base ~= base then
		error('bad argument #2 to tonumber (integer expected)')
	end
	if integer_base < 2 or integer_base > 36 then
		error('bad argument #2 to tonumber (base out of range)')
	end
	return numeric_parse.based_integer(value, integer_base & -1)
end


print = function(...)
	local count<const> = select('#', ...)
	for value_index = 1, count do
		if value_index > 1 then
			console.write('\t')
		end
		local text<const> = tostring(select(value_index, ...))
		console.write(text)
	end
	console.end_line()
	return nil
end



local ipairs_iterator<const> = function(target, index)
	local next_index<const> = index + 1
	local value<const> = target[next_index]
	if value == nil then
		return nil
	end
	return next_index, value
end


ipairs = function(target)
	return ipairs_iterator, target, 0
end


pairs = function(target)
	return next, target, nil
end

collectgarbage = function(option)
	if option == nil or option == 'collect' then
		blua32.svc(heap_calls.collect_full)
		return 0
	elseif option == 'count' then
		local bytes<const> = blua32.svc_value(heap_calls.heap_count)
		return bytes / 1024
	elseif option == 'capacity' then
		local bytes<const> = blua32.svc_value(heap_calls.heap_capacity)
		return bytes / 1024
	elseif option == 'step' then
		local finished<const> = blua32.svc_value(heap_calls.collect_step)
		return finished
	end
	raise_error('invalid collectgarbage option')
end
