local chars<const> = require('kernel/bios_string_char')

return function(...)
	return chars.intern_chars()
end
