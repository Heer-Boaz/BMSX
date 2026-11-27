local metatables<const> = require('kernel/gc_barrier')
local globals<const> = require('kernel/set_global')
local tables<const> = require('kernel/table_grow')
local raise_error<const> = __bmsx_error
local console<const> = require('tty/console')

local numeric_parse<const> = require('number/parse')
local collector<const> = require('kernel/gc_collect_step')
local heap<const> = require('kernel/gc_full')

local select_arguments<const> = function(selector, ...)
	local count<const> = blua32.argument_count() - 1
	if selector == '#' then return count end
	local start = selector & -1
	if start < 0 then start = count + start + 1 end
	if start < 1 then start = 1 end
	return blua32.argument_suffix(start - 1)
end

next = __bmsx_next
type = __bmsx_type
setmetatable = metatables.set_metatable
getmetatable = __bmsx_getmetatable
rawget = __bmsx_rawget
rawset = function(target, key, ...)
	return tables.raw_set(target, key, (...), blua32.argument_count())
end
getglobal = __bmsx_getglobal
setglobal = globals.set_global
select = select_arguments
error = raise_error
pcall = __bmsx_pcall
xpcall = __bmsx_xpcall


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
		heap.collect_full()
		return 0
	elseif option == 'count' then
		local bytes<const> = heap.heap_bytes()
		return bytes / 1024
	elseif option == 'capacity' then
		local _<const>, bytes<const> = heap.heap_bytes()
		return bytes / 1024
	elseif option == 'step' then
		return collector.collect_step()
	end
	raise_error('invalid collectgarbage option')
end
