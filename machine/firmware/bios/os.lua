-- os.lua
-- BIOS os compatibility backed by BMSX time registers.

local numeric<const> = require('bios/common/numeric')
local trunc<const> = numeric.trunc
local time_ms<const>: *word = sys_time_ms

local seconds_per_day<const> = 86400
local lua_civil_int_min<const> = -0x80000000
local lua_civil_int_max<const> = 0x7fffffff
local lua_time_safe_int_min<const> = -0x1fffffffffffff
local lua_time_safe_int_max<const> = 0x1fffffffffffff
local weekdays_short<const> = { 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat' }
local weekdays_long<const> = { 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' }
local months_short<const> = { 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec' }
local months_long<const> = { 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December' }
local date_modifier_specifiers<const> = { ['E'] = true, ['O'] = true }
local date_extended_e_specifiers<const> = { c = true, ['C'] = true, x = true, ['X'] = true, y = true, ['Y'] = true }
local date_extended_o_specifiers<const> = { d = true, e = true, ['H'] = true, ['I'] = true, m = true, ['M'] = true, ['S'] = true, u = true, ['U'] = true, ['V'] = true, w = true, ['W'] = true, y = true }
local date_iso_week_specifiers<const> = { ['G'] = true, g = true, ['V'] = true }

local require_integer<const> = function(value, message)
	local integer<const> = trunc(value)
	if integer ~= value then
		error(message)
	end
	return integer
end

local require_civil_integer<const> = function(value, field, delta)
	local integer<const> = require_integer(value, "field '" .. field .. "' is not an integer")
	if integer >= 0 then
		if integer - delta > lua_civil_int_max then
			error("field '" .. field .. "' is out-of-bound")
		end
	elseif lua_civil_int_min + delta > integer then
		error("field '" .. field .. "' is out-of-bound")
	end
	return integer
end

local require_civil_field<const> = function(date_table, field, default_value, delta)
	local value<const> = date_table[field]
	if value == nil then
		if default_value < 0 then
			error("field '" .. field .. "' missing in date table")
		end
		return default_value
	end
	return require_civil_integer(value, field, delta)
end

local require_time_value<const> = function(value)
	local integer<const> = require_integer(value, 'time is not an integer')
	if integer < lua_time_safe_int_min or integer > lua_time_safe_int_max then
		error('time is out-of-bound')
	end
	return integer
end

local days_from_civil<const> = function(year, month, day)
	if month <= 2 then
		year = year - 1
	end
	local era<const> = year // 400
	local year_of_era<const> = year - (era * 400)
	local month_prime<const> = month + (month > 2 and -3 or 9)
	local day_of_year<const> = ((153 * month_prime + 2) // 5) + day - 1
	local day_of_era<const> = (year_of_era * 365) + (year_of_era // 4) - (year_of_era // 100) + day_of_year
	return era * 146097 + day_of_era - 719468
end

local civil_from_days<const> = function(days)
	days = days + 719468
	local era<const> = days // 146097
	local day_of_era<const> = days - (era * 146097)
	local year_of_era<const> = (day_of_era - (day_of_era // 1460) + (day_of_era // 36524) - (day_of_era // 146096)) // 365
	local year = year_of_era + era * 400
	local day_of_year<const> = day_of_era - (365 * year_of_era + (year_of_era // 4) - (year_of_era // 100))
	local month_prime<const> = (5 * day_of_year + 2) // 153
	local day<const> = day_of_year - ((153 * month_prime + 2) // 5) + 1
	local month<const> = month_prime + (month_prime < 10 and 3 or -9)
	if month <= 2 then
		year = year + 1
	end
	return year, month, day
end

local civil_from_timestamp<const> = function(timestamp)
	local days<const> = timestamp // seconds_per_day
	local seconds_of_day<const> = timestamp - (days * seconds_per_day)
	local year<const>, month<const>, day<const> = civil_from_days(days)
	local hour<const> = seconds_of_day // 3600
	local min<const> = (seconds_of_day - (hour * 3600)) // 60
	local sec<const> = seconds_of_day - (hour * 3600) - (min * 60)
	local yday<const> = days - days_from_civil(year, 1, 1) + 1
	return year, month, day, hour, min, sec, ((days + 4) % 7) + 1, yday
end

local set_date_table<const> = function(date_table, timestamp)
	local year<const>, month<const>, day<const>, hour<const>, min<const>, sec<const>, wday<const>, yday<const> = civil_from_timestamp(timestamp)
	date_table.year = year
	date_table.month = month
	date_table.day = day
	date_table.hour = hour
	date_table.min = min
	date_table.sec = sec
	date_table.wday = wday
	date_table.yday = yday
	date_table.isdst = false
	return date_table
end

local timestamp_from_civil<const> = function(year, month, day, hour, min, sec)
	local month_index<const> = month - 1
	local year_offset<const> = month_index // 12
	local lua_year<const> = year + year_offset
	local lua_month<const> = month_index - (year_offset * 12) + 1
	return require_time_value(days_from_civil(lua_year, lua_month, day) * seconds_per_day + hour * 3600 + min * 60 + sec)
end

local pad<const> = function(value, size)
	local text = tostring(value)
	while #text < size do
		text = '0' .. text
	end
	return text
end

local pad_space<const> = function(value, size)
	local text = tostring(value)
	while #text < size do
		text = ' ' .. text
	end
	return text
end

local week_number_sunday<const> = function(yday, wday)
	return (yday - 1 + 7 - (wday - 1)) // 7
end

local week_number_monday<const> = function(yday, wday)
	return (yday - 1 + 7 - ((wday + 5) % 7)) // 7
end

local iso_weeks_in_year<const> = function(year)
	local jan1_weekday<const> = ((days_from_civil(year, 1, 1) + 3) % 7) + 1
	return (jan1_weekday == 4 or (jan1_weekday == 3 and days_from_civil(year + 1, 1, 1) - days_from_civil(year, 1, 1) == 366)) and 53 or 52
end

local iso_week<const> = function(year, wday, yday)
	local iso_weekday<const> = wday == 1 and 7 or wday - 1
	local iso_year = year
	local week = (yday - iso_weekday + 10) // 7
	if week < 1 then
		iso_year = iso_year - 1
		week = iso_weeks_in_year(iso_year)
	elseif week > iso_weeks_in_year(iso_year) then
		iso_year = iso_year + 1
		week = 1
	end
	return iso_year, week
end

local valid_extended_specifier<const> = function(modifier, code)
	if modifier == 'E' then
		return date_extended_e_specifiers[code]
	end
	return date_extended_o_specifiers[code]
end

local invalid_conversion_specifier<const> = function(modifier, code)
	error("invalid conversion specifier '%" .. modifier .. code .. "'")
end

local format_civil_time<const> = function(format, year, month, day, hour, min, sec, wday, yday)
	local weekday_index<const> = wday - 1
	local hour12<const> = hour % 12 == 0 and 12 or hour % 12
	local ampm<const> = hour < 12 and 'AM' or 'PM'
	local output = ''
	local index = 1
	while index <= #format do
		local ch<const> = string.sub(format, index, index)
		if ch ~= '%' then
			output = output .. ch
			index = index + 1
		else
			index = index + 1
			local code = string.sub(format, index, index)
			local modifier = ''
			if date_modifier_specifiers[code] then
				modifier = code
				index = index + 1
				code = string.sub(format, index, index)
				if not valid_extended_specifier(modifier, code) then
					invalid_conversion_specifier(modifier, code)
				end
			end
			local iso_year = 0
			local iso_week_number = 0
			if date_iso_week_specifiers[code] then
				iso_year, iso_week_number = iso_week(year, wday, yday)
			end
			if code == 'C' then
				output = output .. pad(year // 100, 2)
			elseif code == 'D' then
				output = output .. pad(month, 2) .. '/' .. pad(day, 2) .. '/' .. pad(year % 100, 2)
			elseif code == 'F' then
				output = output .. pad(year, 4) .. '-' .. pad(month, 2) .. '-' .. pad(day, 2)
			elseif code == 'G' then
				output = output .. pad(iso_year, 4)
			elseif code == 'g' then
				output = output .. pad(iso_year % 100, 2)
			elseif code == 'Y' then
				output = output .. pad(year, 4)
			elseif code == 'y' then
				output = output .. pad(year % 100, 2)
			elseif code == 'm' then
				output = output .. pad(month, 2)
			elseif code == 'd' then
				output = output .. pad(day, 2)
			elseif code == 'e' then
				output = output .. pad_space(day, 2)
			elseif code == 'H' then
				output = output .. pad(hour, 2)
			elseif code == 'M' then
				output = output .. pad(min, 2)
			elseif code == 'S' then
				output = output .. pad(sec, 2)
			elseif code == 'I' then
				output = output .. pad(hour12, 2)
			elseif code == 'R' then
				output = output .. pad(hour, 2) .. ':' .. pad(min, 2)
			elseif code == 'r' then
				output = output .. pad(hour12, 2) .. ':' .. pad(min, 2) .. ':' .. pad(sec, 2) .. ' ' .. ampm
			elseif code == 'T' then
				output = output .. pad(hour, 2) .. ':' .. pad(min, 2) .. ':' .. pad(sec, 2)
			elseif code == 'p' then
				output = output .. ampm
			elseif code == 'a' then
				output = output .. weekdays_short[wday]
			elseif code == 'A' then
				output = output .. weekdays_long[wday]
			elseif code == 'h' then
				output = output .. months_short[month]
			elseif code == 'b' then
				output = output .. months_short[month]
			elseif code == 'B' then
				output = output .. months_long[month]
			elseif code == 'j' then
				output = output .. pad(yday, 3)
			elseif code == 'n' then
				output = output .. '\n'
			elseif code == 't' then
				output = output .. '\t'
			elseif code == 'U' then
				output = output .. pad(week_number_sunday(yday, wday), 2)
			elseif code == 'u' then
				output = output .. tostring(wday == 1 and 7 or wday - 1)
			elseif code == 'V' then
				output = output .. pad(iso_week_number, 2)
			elseif code == 'w' then
				output = output .. tostring(weekday_index)
			elseif code == 'W' then
				output = output .. pad(week_number_monday(yday, wday), 2)
			elseif code == 'c' then
				output = output .. weekdays_short[wday] .. ' ' .. months_short[month] .. ' ' .. pad(day, 2) .. ' ' .. pad(hour, 2) .. ':' .. pad(min, 2) .. ':' .. pad(sec, 2) .. ' ' .. pad(year, 4)
			elseif code == 'x' then
				output = output .. pad(month, 2) .. '/' .. pad(day, 2) .. '/' .. pad(year % 100, 2)
			elseif code == 'X' then
				output = output .. pad(hour, 2) .. ':' .. pad(min, 2) .. ':' .. pad(sec, 2)
			elseif code == 'z' then
				output = output .. '+0000'
			elseif code == 'Z' then
				output = output .. 'BMSX'
			elseif code == '%' then
				output = output .. '%'
			else
				invalid_conversion_specifier(modifier, code)
			end
			index = index + 1
		end
	end
	return output
end

function clock_now()
	return time_ms[0]
end

os.clock = function()
	return time_ms[0] / 1000
end

os.time = function(date_table)
	if date_table ~= nil then
		local year<const> = require_civil_field(date_table, 'year', -1, 1900)
		local month<const> = require_civil_field(date_table, 'month', -1, 1)
		local day<const> = require_civil_field(date_table, 'day', -1, 0)
		local hour<const> = require_civil_field(date_table, 'hour', 12, 0)
		local min<const> = require_civil_field(date_table, 'min', 0, 0)
		local sec<const> = require_civil_field(date_table, 'sec', 0, 0)
		local timestamp<const> = timestamp_from_civil(year, month, day, hour, min, sec)
		set_date_table(date_table, timestamp)
		return timestamp
	end
	return time_ms[0] // 1000
end

os.date = function(format, timestamp)
	local bmsx_format = format == nil and '%c' or format
	if string.sub(bmsx_format, 1, 1) == '!' then
		bmsx_format = string.sub(bmsx_format, 2)
	end
	local time_value<const> = timestamp == nil and time_ms[0] // 1000 or require_time_value(timestamp)
	if bmsx_format == '*t' then
		return set_date_table({}, time_value)
	end
	local year<const>, month<const>, day<const>, hour<const>, min<const>, sec<const>, wday<const>, yday<const> = civil_from_timestamp(time_value)
	return format_civil_time(bmsx_format, year, month, day, hour, min, sec, wday, yday)
end

os.difftime = function(t2, t1)
	local t2_int<const> = trunc(t2)
	local t1_int<const> = trunc(t1)
	if t2_int ~= t2 then
		error('os.difftime t2 must be an integer.')
	end
	if t1_int ~= t1 then
		error('os.difftime t1 must be an integer.')
	end
	return t2_int - t1_int
end

return os
