local time_ms<const>: *word = 0x0801022c

local function assert_close(actual, expected, label)
	assert(math.abs(actual - expected) < 0.000001, label)
end

__bmsx_host_test = {}

function __bmsx_host_test.ready()
	return true
end

function __bmsx_host_test.setup()
	assert(os.difftime(125, 20) == 105, 'os.difftime mismatch')

	local normalized = { year = 1970, month = 13, day = 1, hour = 0 }
	assert(os.time({ year = 1970, month = 1, day = 1 }) == 43200, 'os.time default noon mismatch')
	assert(os.time({ year = 1970, month = 1, day = 1, hour = 0 }) == 0, 'os.time epoch mismatch')
	assert(os.time({ year = 1969, month = 12, day = 31, hour = 23, min = 59, sec = 59 }) == -1, 'os.time pre-epoch mismatch')
	assert(os.time(normalized) == 31536000, 'os.time normalization result mismatch')
	assert(normalized.year == 1971 and normalized.month == 1 and normalized.day == 1, 'os.time normalized date mismatch')
	assert(normalized.hour == 0 and normalized.min == 0 and normalized.sec == 0, 'os.time normalized clock mismatch')
	assert(normalized.wday == 6 and normalized.yday == 1 and normalized.isdst == false, 'os.time normalized calendar mismatch')
	assert(not pcall(function() return os.difftime(1.5, 1) end), 'os.difftime accepted fractional time')
	assert(not pcall(function() return os.time({ year = 1970.5, month = 1, day = 1 }) end), 'os.time accepted fractional field')

	local epoch_table<const> = os.date('*t', 0)
	assert(os.date('%Y-%m-%d %H:%M:%S', 0) == '1970-01-01 00:00:00', 'os.date epoch mismatch')
	assert(os.date('%c', 0) == 'Thu Jan 01 00:00:00 1970', 'os.date %c mismatch')
	assert(os.date('!%F %T %z %Z', -1) == '1969-12-31 23:59:59 +0000 BMSX', 'os.date pre-epoch mismatch')
	assert(os.date('%G-W%V-%u', 0) == '1970-W01-4', 'os.date ISO week mismatch')
	assert(epoch_table.year == 1970 and epoch_table.month == 1 and epoch_table.day == 1, 'os.date table date mismatch')
	assert(epoch_table.hour == 0 and epoch_table.min == 0 and epoch_table.sec == 0, 'os.date table clock mismatch')
	assert(epoch_table.wday == 5 and epoch_table.yday == 1 and epoch_table.isdst == false, 'os.date table calendar mismatch')
	assert(not pcall(function() return os.date('%Q', 0) end), 'os.date accepted unsupported specifier')

	__bmsx_host_test.before_ms = time_ms[0]
	__bmsx_host_test.before_clock = os.clock()
	__bmsx_host_test.before_clock_now = clock_now()
end

function __bmsx_host_test.update(frame)
	if frame < 7 then
		return false
	end
	local after_ms<const> = time_ms[0]
	local ms_delta<const> = after_ms - __bmsx_host_test.before_ms
	assert(ms_delta >= 7, 'machine time did not advance')
	assert_close(os.clock() - __bmsx_host_test.before_clock, ms_delta / 1000, 'os.clock delta mismatch')
	assert_close(clock_now() - __bmsx_host_test.before_clock_now, ms_delta, 'clock_now delta mismatch')
	local seconds<const> = os.time()
	assert(seconds * 1000 <= after_ms and after_ms < (seconds + 1) * 1000, 'os.time machine-time mismatch')
	return true
end
