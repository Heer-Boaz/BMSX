module<entry>

local storage<const> = require('results')
local result<const>: *bios_os_manual_result = storage.result
local observations<const> = storage.observations

-- Each call samples machine time separately. These are not civil-clock readings.
result.clock_sample = os.clock()
result.time_sample = os.time()
result.nil_time_sample = os.time(nil)
observations.current_date = os.date()
observations.current_format = os.date('%F %T', nil)
print('OS samples', result.clock_sample, result.time_sample, result.nil_time_sample)
print('OS sampled dates', observations.current_date, observations.current_format)

-- Missing hour means noon. Conversion normalizes this same caller Table.
local noon<const> = {
	year = 1970, month = 1, day = 1,
	wday = 99, yday = 99, isdst = true, note = 'kept',
}
observations.noon = noon
result.noon_timestamp = os.time(noon)
print('OS noon', result.noon_timestamp, noon.year, noon.month, noon.day,
	noon.hour, noon.min, noon.sec, noon.wday, noon.yday, noon.isdst, noon.note)

-- Outlying hour 25 carries into the following leap day.
local carried<const> = {
	year = 2024, month = 2, day = 28, hour = 25, min = 2, sec = 3,
}
observations.carried = carried
result.carried_timestamp = os.time(carried)
print('OS normalized', result.carried_timestamp, carried.year, carried.month,
	carried.day, carried.hour, carried.min, carried.sec, carried.wday, carried.yday,
	carried.isdst)

observations.epoch = os.date('*t', 0)
observations.before_epoch = os.date('*t', -1)
local epoch<const> = observations.epoch
local before<const> = observations.before_epoch
print('OS epoch fields', epoch.year, epoch.month, epoch.day, epoch.hour, epoch.min,
	epoch.sec, epoch.wday, epoch.yday, epoch.isdst)
print('OS negative fields', before.year, before.month, before.day, before.hour,
	before.min, before.sec, before.wday, before.yday, before.isdst)

-- One fixed timestamp keeps the formatting examples independent of the samples.
local stamp<const> = 1609506123
observations.calendar = os.date('%Y %y %C | %m %d %e %j', stamp)
observations.names = os.date('%a %A | %b %B %h', stamp)
observations.clock = os.date('%H:%M:%S | %I %p | %R | %r | %T | %X', stamp)
observations.composites = os.date('%F | %D | %x | %c', stamp)
observations.weeks = os.date('%Y | %G %g-W%V | %U %W | %u %w', stamp)
observations.next_iso_year = os.date('%F %G-W%V-%u', 1546214400)
observations.zone = os.date('offset %z zone %Z %%', stamp)
observations.separators = os.date('A%tB%nC', stamp)
observations.default_format = os.date(nil, 0)
print('OS calendar', observations.calendar)
print('OS names', observations.names)
print('OS clock fields', observations.clock)
print('OS composites', observations.composites)
print('OS weeks', observations.weeks)
print('OS next ISO year', observations.next_iso_year)
print('OS zone literals', observations.zone)
print('OS separators', observations.separators)
print('OS default format', observations.default_format)

-- Accepted E/O modifiers use the same output as the corresponding plain code.
observations.era_modifiers = os.date('%Ec | %EC %Ex %EX %Ey %EY', stamp)
observations.alternate_modifiers = os.date(
	'%Od %Oe %OH %OI %Om %OM %OS | %Ou %OU %OV %Ow %OW %Oy', stamp)
print('OS E modifiers', observations.era_modifiers)
print('OS O modifiers', observations.alternate_modifiers)

-- pcall exposes the BIOS-authored errors without replacing any library fields.
observations.missing_ok, observations.missing_error =
	pcall(os.time, { month = 1, day = 1 })
observations.fraction_ok, observations.fraction_error =
	pcall(os.time, { year = 2021, month = 1, day = 1, hour = 1.5 })
observations.civil_range_ok, observations.civil_range_error =
	pcall(os.time, { year = 2147485548, month = 1, day = 1 })
observations.time_range_ok, observations.time_range_error =
	pcall(os.date, '%F', 9007199254740992)
observations.conversion_ok, observations.conversion_error = pcall(os.date, '%Q', 0)
observations.modifier_ok, observations.modifier_error = pcall(os.date, '%Ea', 0)
print('OS missing field', observations.missing_ok, observations.missing_error)
print('OS fractional field', observations.fraction_ok, observations.fraction_error)
print('OS civil range', observations.civil_range_ok, observations.civil_range_error)
print('OS timestamp range', observations.time_range_ok, observations.time_range_error)
print('OS invalid conversion', observations.conversion_ok,
	observations.conversion_error)
print('OS invalid modifier', observations.modifier_ok, observations.modifier_error)

-- difftime is integer-tested Number subtraction, not a wrapping-counter repair.
result.elapsed = os.difftime(result.carried_timestamp,
	result.carried_timestamp - 90)
result.negative_difference = os.difftime(-1, 0)
result.large_difference = os.difftime(9007199254740992, 0)
result.infinite_difference = os.difftime(math.huge, 0)
result.indeterminate_difference = os.difftime(math.huge, math.huge)
print('OS differences', result.elapsed, result.negative_difference,
	result.large_difference, result.infinite_difference,
	result.indeterminate_difference)
observations.t2_ok, observations.t2_error = pcall(os.difftime, 1.5, 0.5)
observations.t1_ok, observations.t1_error = pcall(os.difftime, 1, 0.5)
print('OS fractional t2', observations.t2_ok, observations.t2_error)
print('OS fractional t1', observations.t1_ok, observations.t1_error)
result.completed = 1

while true do
	halt_until_irq
end
