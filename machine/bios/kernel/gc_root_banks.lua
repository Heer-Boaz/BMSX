module<const>

-- Source basis: 6a580740492a6ebdaca200fc90e243ebbcdcd230.
-- T/C/H: GcHeap; U/P: CPU; G/B: GlobalBank; V/W: Value tags;
-- Q/R: Thread records; O: RAM map.
local mark<const> = require('kernel/gc_mark') -- T:307-309,331-338 U:5087,5092,5108-5109 P:3157-3158,3163,3178-3181
local strings<const> = require('kernel/gc_strings') -- T:178,603 U:5087,5099,5104 P:3157,3169,3174 C:636
local ram_base<const> = 0x08000000 -- O:6
local trace_head<const> = 4 -- T:25,313 H:23
local root_cursor<const> = 0x58 -- T:43 H:42
local cursor_bits<const> = 20 -- T:58 C:71
local cursor_mask<const> = (1 << cursor_bits) - 1 -- T:59 C:72
local system_globals<const> = 1 -- T:69 H:20
local system_constants<const> = 3 -- T:69,594 H:20 C:626
local completion<const> = 6 -- T:69 U:5076,5091 H:20 P:3146,3162
local concat<const> = 7 -- T:69 U:5077,5095 H:20 P:3147,3166
local string_tag<const> = 5 -- V:9-10 W:21-22 U:5099 P:3169
local thread_kind<const> = 4 -- T:307-309 C:272-274 Q:33 R:18

-- The stopped caller publishes descriptors, not copied global Values.
-- GlobalBank planes are the existing b, b+12*c, b+16*c (c is capacity).
-- Constant planes contain only resolved RAM String ids, in pool ordinal
-- order, not all constant slots. Completion counts its live RET Values;
-- Concat counts every unread captured slot (but traces only Strings).
-- The last two planes begin at the start of the live span. The descriptors
-- are a private read contract; this module does not materialize those spans.
struct root_bank
	count: u32 -- U:5073-5079 P:3143-3149
	payloads: addr -- U:5085,5092,5096-5099,5103-5104 P:3155,3163,3168-3169,3173-3174 G:21 B:23
	tags: addr -- U:5085,5092,5099 P:3155,3163,3169 G:22 B:24
	names: addr -- U:5087 P:3157 G:31 B:34
end

struct root_descriptors
	root: addr -- U:5107-5108 P:3177-3178
	active: addr -- U:5108 P:3179
	completion_thread: addr -- U:5108 P:3180
	halted: addr -- U:5109 P:3181
	banks: root_bank[7] -- T:69 H:20
end

local mark_root_bank<const> = function(control, arena, metadata, bank_address, kind, first, stop, replace_color_byte) -- U:5082 P:3152
	local bank<const>: *root_bank = bank_address -- U:5084,5096,5103 P:3154,3168,3173
	local words<const>: *u32 = bank.payloads -- U:5085,5092,5096,5104 P:3155,3163,3168,3174
	local work = 0 -- T:591,603 C:636; String work replaces the drained host latch
	if kind < system_constants then -- U:5083 P:3153
		local names<const>: *u32 = bank.names -- U:5084,5087 P:3154,3157 G:31 B:34
		local tags<const>: *u8 = bank.tags -- U:5085,5087 P:3155,3158
		while first < stop do -- U:5086 P:3156
			work = work + strings.mark(metadata, names[first]) -- U:5087 P:3157
			local _<const>, string_work<const> = mark.mark_value(control, arena, metadata, tags[first], words[first], trace_head, replace_color_byte) -- U:5087 P:3158
			work = work + string_work -- T:603 C:636
			first = first + 1 -- U:5086 P:3156
		end
		return work -- U:5089 P:3160 T:603 C:636
	end
	if kind == completion then -- U:5091 P:3162
		local tags<const>: *u8 = bank.tags -- U:5092 P:3163
		while first < stop do -- U:5092 P:3163
			local _<const>, string_work<const> = mark.mark_value(control, arena, metadata, tags[first], words[first], trace_head, replace_color_byte) -- U:5092 P:3163
			work = work + string_work -- T:603 C:636
			first = first + 1 -- U:5092 P:3163
		end
		return work -- U:5093 P:3164 T:603 C:636
	end
	if kind == concat then -- U:5095 P:3166
		local tags<const>: *u8 = bank.tags -- U:5096-5099 P:3168-3169; the producer's plane base already includes source
		while first < stop do -- U:5097 P:3167
			if tags[first] == string_tag then -- U:5098-5099 P:3168-3169
				work = work + strings.mark(metadata, words[first]) -- U:5099 P:3169
			end
			first = first + 1 -- U:5097 P:3167
		end
		return work -- U:5101 P:3171 T:603 C:636
	end
	while first < stop do -- U:5104 P:3174
		work = work + strings.mark(metadata, words[first]) -- U:5104 P:3174
		first = first + 1 -- U:5104 P:3174
	end
	return work -- U:5104 P:3174 T:603 C:636
end

local trace_root_banks<const> = function(control, arena, metadata, descriptor, limit, work, stop, replace_color_byte) -- T:588 C:619
	local cursor<const>: *u32 = ram_base + control + root_cursor -- T:589 C:620
	local roots<const>: *root_descriptors = ram_base + descriptor -- T:593,608 C:625,641; typed publication of producer state
	local saved<const> = *cursor -- T:589 C:620
	local kind, next = saved >> cursor_bits, saved & cursor_mask -- T:590,592 C:621-622
	while kind < stop do -- T:592 C:623
		local bank<const>: *root_bank = &roots.banks[kind - system_globals] -- T:593 C:624-625; one record per live ordinal
		local bank_end<const> = bank.count -- T:593 C:625 U:5073-5079 P:3143-3149
		local globals<const> = kind < system_constants -- T:594 C:626
		local words<const> = globals and 3 or 1 -- T:595 C:627
		local worst<const> = words + (globals and 2 or 1) -- T:595 C:627
		while next < bank_end do -- T:596 C:628
			if work >= limit then -- T:597 C:629
				*cursor = (kind << cursor_bits) | next -- T:598 C:630
				return work -- T:599 C:631
			end
			local amount = (limit - work) // worst -- T:601 C:633; positive work difference, floor equals truncation
			if amount < 1 then amount = 1 end -- T:601 C:633
			local next_stop = next + amount -- T:601 C:633
			if next_stop > bank_end then next_stop = bank_end end -- T:601 C:633
			local string_work<const> = mark_root_bank(control, arena, metadata, bank, kind, next, next_stop, replace_color_byte) -- T:602 C:634
			work = work + (next_stop - next) * words + string_work -- T:603 C:635-636
			next = next_stop -- T:604 C:637
		end
		kind, next = kind + 1, 0 -- T:592 C:623
	end
	*cursor = 0 -- T:607 C:640
	mark.mark_record(control, arena, roots.root, thread_kind, trace_head, replace_color_byte) -- T:608,307-309 C:641,272-274 U:5107-5108 P:3177-3178
	local active<const> = roots.active -- U:5108 P:3179
	if active ~= 0 then -- U:5108 P:3179; a missing native active view publishes no address
		mark.mark_record(control, arena, active, thread_kind, trace_head, replace_color_byte) -- T:608,307-309 C:641,272-274 U:5108 P:3179
	end
	mark.mark_record(control, arena, roots.completion_thread, thread_kind, trace_head, replace_color_byte) -- T:608,307-309 C:641,272-274 U:5108 P:3180
	mark.mark_record(control, arena, roots.halted, thread_kind, trace_head, replace_color_byte) -- T:608,307-309 C:641,272-274 U:5109 P:3181
	return work -- T:609 C:642
end

return {
	internal = { mark_root_bank = mark_root_bank },
	trace_root_banks = trace_root_banks,
}
