-- Static templates own generated Lua structure. They are compiled once when a
-- producer module loads; emission only walks the resulting flat operation
-- stream. Named callback substitutions compose templates without hiding target
-- language control flow in concatenated fragments.
local lua_source_printer<const> = {}
lua_source_printer.__index = lua_source_printer

local operation_literal<const> = 1
local operation_newline<const> = 2
local operation_value<const> = 3
local operation_callback<const> = 4
local byte<const> = string.byte
local find<const> = string.find
local format<const> = string.format
local sub<const> = string.sub

local dollar_byte<const> = 36
local newline_byte<const> = 10
local space_byte<const> = 32
local tab_byte<const> = 9

local append_operation<const> = function(template, kind, value, indentation)
	local count<const> = #template
	template[count + 1] = kind
	template[count + 2] = value
	template[count + 3] = indentation
end

-- Templates are internal source constants. Callback names are resolved here,
-- not while programs are emitted. A callback occupying its own template line
-- inherits that line's relative indentation and may emit nested templates.
function lua_source_printer.compile_template(source, callbacks)
	local position = 1
	if byte(source, position) == newline_byte then
		position = position + 1
	end
	local content_start = position
	local current_byte = byte(source, content_start)
	while current_byte == space_byte or current_byte == tab_byte do
		content_start = content_start + 1
		current_byte = byte(source, content_start)
	end
	local base_indentation<const> = sub(source, position, content_start - 1)
	local base_indentation_length<const> = #base_indentation
	position = content_start

	local template<const> = {}
	local literal_start = position
	local line_has_content = false
	while position <= #source do
		current_byte = byte(source, position)
		if current_byte == newline_byte then
			if line_has_content and literal_start < position then
				append_operation(template, operation_literal, sub(source, literal_start, position - 1), false)
			end
			append_operation(template, operation_newline, false, false)
			position = position + 1
			if base_indentation_length > 0
			and sub(source, position, position + base_indentation_length - 1) == base_indentation then
				position = position + base_indentation_length
			end
			literal_start = position
			line_has_content = false
		elseif current_byte == dollar_byte then
			if byte(source, position + 1) == dollar_byte then
				if literal_start < position then
					append_operation(template, operation_literal, sub(source, literal_start, position - 1), false)
				end
				append_operation(template, operation_literal, '$', false)
				position = position + 2
				literal_start = position
				line_has_content = true
			else
				local token_start<const> = position
				local token_end<const> = find(source, '$', token_start + 1, true)
				local name<const> = sub(source, token_start + 1, token_end - 1)
				local callback<const> = callbacks and callbacks[name]
				local trailing_position = token_end + 1
				local indentation = false
				if callback ~= nil and not line_has_content then
					local trailing_byte = byte(source, trailing_position)
					while trailing_byte == space_byte or trailing_byte == tab_byte do
						trailing_position = trailing_position + 1
						trailing_byte = byte(source, trailing_position)
					end
					if trailing_byte == newline_byte or trailing_position > #source then
						indentation = sub(source, literal_start, token_start - 1)
					end
				end
				if not indentation and literal_start < token_start then
					append_operation(template, operation_literal, sub(source, literal_start, token_start - 1), false)
				end
				if callback == nil then
					append_operation(template, operation_value, name, false)
				else
					append_operation(template, operation_callback, callback, indentation)
				end
				if indentation then
					position = trailing_position
					literal_start = position
					line_has_content = false
				else
					position = token_end + 1
					literal_start = position
					line_has_content = true
				end
			end
		else
			if current_byte ~= space_byte and current_byte ~= tab_byte then
				line_has_content = true
			end
			position = position + 1
		end
	end
	if line_has_content and literal_start <= #source then
		append_operation(template, operation_literal, sub(source, literal_start), false)
	end
	return template
end

function lua_source_printer.new()
	return setmetatable({
		count = 0,
		indentation = '',
		at_line_start = true,
	}, lua_source_printer)
end

function lua_source_printer:print_raw(fragment)
	local count = self.count
	if self.at_line_start then
		if #self.indentation > 0 then
			count = count + 1
			self[count] = self.indentation
		end
		self.at_line_start = false
	end
	count = count + 1
	self[count] = fragment
	self.count = count
end

function lua_source_printer:emit(template, substitutions)
	local template_indentation<const> = self.indentation
	local skip_newline = false
	for index = 1, #template, 3 do
		local kind<const> = template[index]
		local value<const> = template[index + 1]
		if kind == operation_newline then
			if skip_newline then
				skip_newline = false
			else
				local count<const> = self.count + 1
				self[count] = '\n'
				self.count = count
				self.at_line_start = true
			end
		elseif kind == operation_callback then
			local indentation<const> = template[index + 2]
			local previous_indentation<const> = self.indentation
			if indentation then
				self.indentation = template_indentation .. indentation
			end
			value(self, substitutions)
			self.indentation = previous_indentation
			skip_newline = indentation and self.at_line_start
		elseif kind == operation_value then
			self:print_raw(substitutions[value])
			skip_newline = false
		else
			self:print_raw(value)
			skip_newline = false
		end
	end
end

function lua_source_printer:print_index(key)
	self:print_raw('[')
	if type(key) == 'number' then
		self:print_raw(key)
	else
		self:print_raw(format('%q', key))
	end
	self:print_raw(']')
end

function lua_source_printer:print_path(path)
	for index = 1, #path do
		self:print_index(path[index])
	end
end

function lua_source_printer:finish()
	return table.concat(self, '', 1, self.count)
end

return lua_source_printer
