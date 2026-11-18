local vm_next<const> = __bmsx_next
local vm_type<const> = __bmsx_type
local vm_setmetatable<const> = __bmsx_setmetatable
local vm_getmetatable<const> = __bmsx_getmetatable
local vm_rawget<const> = __bmsx_rawget
local vm_rawset<const> = __bmsx_rawset
local vm_select<const> = __bmsx_select
local vm_error<const> = __bmsx_error
local vm_pcall<const> = __bmsx_pcall
local vm_xpcall<const> = __bmsx_xpcall
local vm_collect_garbage<const> = __bmsx_collect_garbage
local console<const> = require('tty/console')

local numeric_parse<const> = require('number/parse')

next = vm_next
type = vm_type
setmetatable = vm_setmetatable
getmetatable = vm_getmetatable
rawget = vm_rawget
rawset = vm_rawset
getglobal = __bmsx_getglobal
setglobal = __bmsx_setglobal
select = vm_select
error = vm_error
pcall = vm_pcall
xpcall = vm_xpcall


assert = function(condition, ...)
	if condition then
		return condition, ...
	end
	if vm_select('#', ...) > 0 then
		vm_error((vm_select(1, ...)))
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
		vm_collect_garbage(0)
		return 0
	elseif option == 'count' then
		local bytes<const> = vm_collect_garbage(1)
		return bytes / 1024
	elseif option == 'capacity' then
		local _<const>, bytes<const> = vm_collect_garbage(1)
		return bytes / 1024
	elseif option == 'step' then
		return vm_collect_garbage(2)
	end
	vm_error('invalid collectgarbage option')
end
