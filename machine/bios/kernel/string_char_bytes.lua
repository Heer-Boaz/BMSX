module<const>

-- Source basis: 894c524ca, TS and C++ CPU::runBuiltinStringChar.
-- On lookup/miss publication the immutable inputs are already admitted.
local arithmetic<const> = require('kernel/word_arithmetic') -- J:1732-1736 K:5076-5077
local integer_tag<const> = 3 -- J:1732-1736 K:5076-5077
local float_tag<const> = 4 -- J:1732-1736 K:5076-5077
local byte_word<const> = function(tag, word) -- J:1732-1736 K:5076-5077
	if tag == integer_tag then return word, true end -- J:1732-1736 K:5076-5077
	if tag == float_tag then -- J:1732-1736 K:5076-5077
		local byte<const>, valid<const> = arithmetic.float_to_word(word) -- J:1732-1736 K:5076-5077
		return byte, valid -- J:1732-1736 K:5076-5077
	end
	return 0, false -- J:1732-1736 K:5076-5077
end

local hash_chars<const> = function(words_address, tags_address, count) -- J:1729-1736 K:5072-5077 H:39-45
	local words<const>: *u32 = words_address -- J:1729-1736 K:5072-5077 H:39-45
	local tags<const>: *u8 = tags_address -- J:1729-1736 K:5072-5077 H:39-45
	local hash = 0x811c9dc5 -- J:1729-1736 K:5072-5077 H:39-45
	for index = 0, count - 1 do -- J:1729-1736 K:5072-5077 H:39-45
		local byte<const>, valid<const> = byte_word(tags[index], words[index]) -- J:1729-1736 K:5072-5077 H:39-45
		if not valid or (byte & ~0xff) ~= 0 then return 0, false end -- J:1729-1736 K:5072-5077 H:39-45
		hash = (hash ~ byte) * 16777619 -- J:1729-1736 K:5072-5077 H:39-45
	end
	return hash, true -- J:1729-1736 K:5072-5077 H:39-45
end

local matches_chars<const> = function(bank, offset, mask, words_address, tags_address, count) -- J:1737-1739 K:5078-5080 C:84-101
	local words<const>: *u32 = words_address -- J:1737-1739 K:5078-5080 C:84-101
	local tags<const>: *u8 = tags_address -- J:1737-1739 K:5078-5080 C:84-101
	for index = 0, count - 1 do -- J:1737-1739 K:5078-5080 C:84-101
		local candidate<const>: *u8 = bank + ((offset + index) & mask) -- J:1737-1739 K:5078-5080 C:84-101
		local byte<const> = byte_word(tags[index], words[index]) -- J:1737-1739 K:5078-5080 C:84-101
		if *candidate ~= byte then return false end -- J:1737-1739 K:5078-5080 C:84-101
	end
	return true -- J:1737-1739 K:5078-5080 C:84-101
end

local copy_chars<const> = function(target_address, words_address, tags_address, count) -- J:1737-1739 K:5078-5080 T:414-426
	local target<const>: *u8 = target_address -- J:1737-1739 K:5078-5080 T:414-426
	local words<const>: *u32 = words_address -- J:1737-1739 K:5078-5080 T:414-426
	local tags<const>: *u8 = tags_address -- J:1737-1739 K:5078-5080 T:414-426
	for index = 0, count - 1 do -- J:1737-1739 K:5078-5080 T:414-426
		local byte<const> = byte_word(tags[index], words[index]) -- J:1737-1739 K:5078-5080 T:414-426
		target[index] = byte -- J:1737-1739 K:5078-5080 T:414-426
	end
end

return {
	internal = { byte_word = byte_word },
	hash_chars = hash_chars, matches_chars = matches_chars, copy_chars = copy_chars,
}
