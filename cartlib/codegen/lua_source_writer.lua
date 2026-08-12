-- Shared output owner for cartlib programs specialized through firmware load().
-- Semantic emitters write compact Lua statements and expressions here instead
-- of assembling control flow from embedded newline strings. The generated
-- closure remains ordinary Lua compiled and executed by the guest runtime.
local lua_source_writer<const> = {}
lua_source_writer.__index = lua_source_writer

local format<const> = string.format
local sub<const> = string.sub

function lua_source_writer.new()
	return setmetatable({ count = 0, indentation = '' }, lua_source_writer)
end

function lua_source_writer:write(fragment)
	local count<const> = self.count + 1
	self[count] = fragment
	self.count = count
end

function lua_source_writer:line(fragment)
	local count<const> = self.count
	self[count + 1] = self.indentation .. fragment .. '\n'
	self.count = count + 1
end

function lua_source_writer:start_line(fragment)
	local count<const> = self.count
	self[count + 1] = self.indentation .. fragment
	self.count = count + 1
end

function lua_source_writer:end_line(fragment)
	local count<const> = self.count + 1
	self[count] = fragment .. '\n'
	self.count = count
end

function lua_source_writer:begin_block(header)
	self:line(header)
	self.indentation = self.indentation .. '\t'
end

function lua_source_writer:finish_block_header(suffix)
	self:end_line(suffix)
	self.indentation = self.indentation .. '\t'
end

function lua_source_writer:next_block(header)
	local indentation<const> = sub(self.indentation, 1, #self.indentation - 1)
	self.indentation = indentation
	self:line(header)
	self.indentation = indentation .. '\t'
end

function lua_source_writer:end_block()
	self.indentation = sub(self.indentation, 1, #self.indentation - 1)
	self:line('end')
end

function lua_source_writer:write_index(key)
	self:write('[')
	if type(key) == 'number' then
		self:write(key)
	else
		self:write(format('%q', key))
	end
	self:write(']')
end

function lua_source_writer:write_path(path)
	for index = 1, #path do
		self:write_index(path[index])
	end
end

function lua_source_writer:finish()
	local source<const> = table.concat(self, '', 1, self.count)
	return source
end

return lua_source_writer
