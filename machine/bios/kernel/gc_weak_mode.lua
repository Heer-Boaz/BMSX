module<const>

-- Source basis: a7e9ec46981f0ddaa0c35b640a75a09927aeb104.
-- T/C pin the mirrored GcHeap; V/W pin the String Value tag.
local string_record<const> = require('kernel/string_record') -- T:346-351 C:319-324
local string_tag<const> = 5 -- T:345 C:316 V:9-10 W:21-22
local key_letter<const> = 107 -- T:350,352 C:323,325
local value_letter<const> = 118 -- T:350,352 C:323,325
local weak_keys<const> = 1 -- T:350 C:67,323
local weak_values<const> = 2 -- T:350 C:67,323

local weak_mode_bits<const> = function(tag, id) -- T:344-346 C:315-319
	if tag ~= string_tag then return 0 end -- T:345 C:316-317
	local length<const> = string_record.byte_length(id) -- T:347 C:320
	if length ~= 1 and length ~= 2 then return 0 end -- T:348 C:321
	local first<const> = string_record.byte_at(id, 0) -- T:349 C:322
	if length == 1 then -- T:350 C:323
		return first == key_letter and weak_keys or first == value_letter and weak_values or 0 -- T:350 C:323
	end
	local second<const> = string_record.byte_at(id, 1) -- T:351 C:324
	return ((first == key_letter and second == value_letter) or (first == value_letter and second == key_letter)) -- T:352 C:325
		and (weak_keys | weak_values) or 0 -- T:352 C:325
end

return { weak_mode_bits = weak_mode_bits }
