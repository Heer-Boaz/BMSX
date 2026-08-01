local source_location<const> = {}

local diagnostic_directory_header_index<const> = 15
local diagnostic_range_count_index<const> = 0
local diagnostic_range_table_index<const> = 1
local diagnostic_file_table_index<const> = 3
local diagnostic_line_offset_table_index<const> = 5
local diagnostic_range_record_words<const> = 3
local diagnostic_range_line_file_index<const> = 1
local diagnostic_range_column_index<const> = 2
local diagnostic_file_record_words<const> = 5
local diagnostic_file_path_index<const> = 0
local diagnostic_file_path_bytes_index<const> = 1
local diagnostic_file_source_index<const> = 2
local diagnostic_file_line_offset_start_index<const> = 4
local diagnostic_no_source<const> = 0xffffffff
local system_execution_domain<const> = 0xffffffff
local system_rom_base<const> = 0
local cartridge_rom_base<const> = 0x10000000

local output_path<const> = 0
local output_line<const> = 1
local output_column_separator<const> = 2
local output_column<const> = 3
local output_source<const> = 4

local ascii_space<const> = 32
local ascii_zero<const> = 48
local ascii_colon<const> = 58
local ascii_delete<const> = 127

bss source_location_valid: word
bss source_location_path_address: word
bss source_location_path_bytes: word
bss source_location_source_address: word
bss source_location_source_bytes: word
bss source_location_line: word
bss source_location_column: word
bss source_location_output_phase: word
bss source_location_output_offset: word
bss source_location_output_divisor: word

local decimal_divisor<const> = function(value)
	local divisor = 1
	while value >= divisor * 10 do
		divisor = divisor * 10
	end
	return divisor
end

function source_location.resolve(domain, pc)
	local rom_base = cartridge_rom_base
	if domain == system_execution_domain then
		rom_base = system_rom_base
	end
	local rom_header<const>: *word = rom_base
	local directory_offset<const> = rom_header[diagnostic_directory_header_index]
	if directory_offset == 0 then
		*source_location_valid = 0
		return
	end

	local directory_base<const> = rom_base + directory_offset
	local directory<const>: *word = directory_base
	local range_count<const> = directory[diagnostic_range_count_index]
	local range_table<const>: *word = directory_base + directory[diagnostic_range_table_index]
	local first = 0
	local last = range_count
	while first < last do
		local middle<const> = (first + last) >> 1
		if range_table[middle * diagnostic_range_record_words] <= pc then
			first = middle + 1
		else
			last = middle
		end
	end
	local range_index<const> = (first - 1) * diagnostic_range_record_words
	local line_file<const> = range_table[range_index + diagnostic_range_line_file_index]
	if line_file == diagnostic_no_source then
		*source_location_valid = 0
		return
	end
	local line<const> = line_file >> 16
	local file_index<const> = line_file & 0xffff
	local file_table<const>: *word = directory_base + directory[diagnostic_file_table_index]
	local file_record_index<const> = file_index * diagnostic_file_record_words
	local source_address<const> = rom_base + file_table[file_record_index + diagnostic_file_source_index]
	local line_offsets<const>: *word = directory_base + directory[diagnostic_line_offset_table_index]
	local line_offset_index<const> = file_table[file_record_index + diagnostic_file_line_offset_start_index] + line - 1
	local line_start<const> = line_offsets[line_offset_index]
	local line_end = line_offsets[line_offset_index + 1]
	local source<const>: *u8 = source_address
	while line_end > line_start and (source[line_end - 1] == 10 or source[line_end - 1] == 13) do
		line_end = line_end - 1
	end

	*source_location_path_address = directory_base + file_table[file_record_index + diagnostic_file_path_index]
	*source_location_path_bytes = file_table[file_record_index + diagnostic_file_path_bytes_index]
	*source_location_source_address = source_address + line_start
	*source_location_source_bytes = line_end - line_start
	*source_location_line = line
	*source_location_column = range_table[range_index + diagnostic_range_column_index]
	*source_location_valid = 1
end

function source_location.clear()
	*source_location_valid = 0
end

function source_location.begin_output()
	*source_location_output_phase = output_path
	*source_location_output_offset = 0
	return *source_location_valid ~= 0
end

function source_location.next_row(row, columns, location_palette, source_palette)
	local target<const>: *u16 = row
	local path<const>: *u8 = *source_location_path_address
	local source<const>: *u8 = *source_location_source_address
	local location_palette_word<const> = location_palette << 8
	local source_palette_word<const> = source_palette << 8
	local column = 0
	while column < columns do
		local phase<const> = *source_location_output_phase
		if phase == output_path then
			local offset<const> = *source_location_output_offset
			if offset < *source_location_path_bytes then
				local code = path[offset]
				if code < ascii_space or code == ascii_delete then
					code = ascii_space
				end
				target[column] = code | location_palette_word
				*source_location_output_offset = offset + 1
				column = column + 1
			else
				target[column] = ascii_colon | location_palette_word
				*source_location_output_phase = output_line
				*source_location_output_divisor = decimal_divisor(*source_location_line)
				column = column + 1
			end
		elseif phase == output_line then
			local divisor<const> = *source_location_output_divisor
			target[column] = (ascii_zero + (*source_location_line // divisor) % 10) | location_palette_word
			column = column + 1
			if divisor == 1 then
				*source_location_output_phase = output_column_separator
			else
				*source_location_output_divisor = divisor // 10
			end
		elseif phase == output_column_separator then
			target[column] = ascii_colon | location_palette_word
			*source_location_output_phase = output_column
			*source_location_output_divisor = decimal_divisor(*source_location_column)
			column = column + 1
		elseif phase == output_column then
			local divisor<const> = *source_location_output_divisor
			target[column] = (ascii_zero + (*source_location_column // divisor) % 10) | location_palette_word
			column = column + 1
			if divisor == 1 then
				*source_location_output_phase = output_source
				*source_location_output_offset = 0
				return false
			end
			*source_location_output_divisor = divisor // 10
		else
			local offset<const> = *source_location_output_offset
			if offset == *source_location_source_bytes then
				return true
			end
			local code = source[offset]
			if code < ascii_space or code == ascii_delete then
				code = ascii_space
			end
			target[column] = code | source_palette_word
			*source_location_output_offset = offset + 1
			column = column + 1
		end
	end
	return *source_location_output_phase == output_source
		and *source_location_output_offset == *source_location_source_bytes
end

return source_location
