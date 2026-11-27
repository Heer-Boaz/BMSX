module<const>

-- Source basis: c36fafd44eea29507af392041fda24f433709f18.
-- T/C/H: Table; V/W: Value; M: RAM. Operands are already canonical and
-- the mapping and allocation charge have been published before this tail.
local layout<const> = require('kernel/gc_runtime_layout') -- M:6
local barrier<const> = require('kernel/gc_barrier') -- T:566 C:742
local ram_base<const> = layout.ram_base -- M:6
local integer_tag<const> = 3 -- V:9-11 W:21-23
local string_tag<const> = 5 -- V:9-11 W:21-23
local method_absent<const> = 2 -- T:33,564 H:31
local length_word<const> = 24 -- T:33,1104-1105 H:27,211-215

local finish_table_insertion<const> = function(management, record, key_tag, key_word, value_tag, value_word, cpp_mirror) -- T:524,564-566 C:740-742,816,857
	if key_tag == string_tag then -- T:564 C:741; disjoint tag/word lanes of String equality
		local new_index<const>: *addr = ram_base + management + layout.remark_head_offset + layout.remark_new_index_offset -- T:564 C:741; fixed BIOS metamethod identifier
		if key_word == *new_index then -- T:564 C:741
			local absent<const>: *u8 = record + method_absent -- T:564 C:741 H:31
			*absent = 0 -- T:564 C:741
		end
	end
	local mark_work<const>: *u32 = ram_base + management + layout.string_mark_work_offset -- T:566 C:742; shared String latch
	local pending<const> = *mark_work -- T:566 C:742; existing credit from before the store
	local remaining<const> = barrier.write_table_assignment(management + layout.control_offset, management + layout.arena_offset, -- T:566 C:742
		management + layout.metadata_offset, record, value_tag, value_word, 1, key_tag, key_word, cpp_mirror, pending) -- T:565-566 C:742
	if remaining ~= pending then *mark_work = remaining end -- T:566 C:742; only the direct mark route can consume pending credit
	if key_tag == integer_tag and key_word > 0 then -- T:187-190,524 C:83-85,816 H:200-202
		local hint<const>: *u32 = record + length_word -- T:1104 H:212
		if key_word - 1 == *hint then *hint = key_word end -- T:190,1105 H:200,213-214; insertion updates the contiguous frontier
	end
end

return { finish_table_insertion = finish_table_insertion }
