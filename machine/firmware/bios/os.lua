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

local timestamp_from_civil<const> = function(year, month, day, hour, min, sec)
	local month_index<const> = month - 1
	local year_offset<const> = month_index // 12
	local lua_year<const> = year + year_offset
	local lua_month<const> = month_index - (year_offset * 12) + 1
	return require_time_value(days_from_civil(lua_year, lua_month, day) * seconds_per_day + hour * 3600 + min * 60 + sec)
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
		local normalized_year<const>, normalized_month<const>, normalized_day<const>, normalized_hour<const>, normalized_min<const>, normalized_sec<const>, normalized_wday<const>, normalized_yday<const> = civil_from_timestamp(timestamp)
		date_table.year = normalized_year
		date_table.month = normalized_month
		date_table.day = normalized_day
		date_table.hour = normalized_hour
		date_table.min = normalized_min
		date_table.sec = normalized_sec
		date_table.wday = normalized_wday
		date_table.yday = normalized_yday
		date_table.isdst = false
		return timestamp
	end
	return time_ms[0] // 1000
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
