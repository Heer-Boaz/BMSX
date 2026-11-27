local vm_next<const> = __bmsx_next
local vm_type<const> = __bmsx_type
local metatables<const> = require('kernel/gc_barrier')
local globals<const> = require('kernel/set_global')
local vm_getmetatable<const> = __bmsx_getmetatable
local vm_rawget<const> = __bmsx_rawget
local tables<const> = require('kernel/table_grow')
local arguments<const> = require('kernel/bios_select')
local vm_error<const> = __bmsx_error
local vm_pcall<const> = __bmsx_pcall
local vm_xpcall<const> = __bmsx_xpcall
local console<const> = require('tty/console')

local numeric_parse<const> = require('number/parse')
local collector<const> = require('kernel/gc_collect_step')
local heap<const> = require('kernel/gc_full')

local select_arguments<const> = function(selector, ...)
	local count<const> = arguments.select_arguments(selector)
	if count ~= nil then return count end
	return ...
end

next = vm_next
type = vm_type
setmetatable = metatables.set_metatable
getmetatable = vm_getmetatable
rawget = vm_rawget
rawset = function(target, key, ...)
	return tables.raw_set(target, key, (...), select_arguments('#', ...))
end
getglobal = __bmsx_getglobal
setglobal = globals.set_global
select = select_arguments
error = vm_error
pcall = vm_pcall
xpcall = vm_xpcall


assert = function(condition, ...)
	if condition then
		return condition, ...
	end
	if select_arguments('#', ...) > 0 then
		vm_error((...))
	end
	vm_error('assertion failed!')
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
	vm_error('invalid collectgarbage option')
end
