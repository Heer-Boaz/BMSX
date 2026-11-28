module<const>

-- Source basis: 6a580740492a6ebdaca200fc90e243ebbcdcd230.
-- T/C/H: GcHeap; U/P: CPU; G/B: GlobalBank; V/W: Value tags;
-- Q/R: Thread records; O: RAM map.
local mark<const> = require('kernel/gc_mark') -- T:307-309,331-338 U:5087,5092,5108-5109 P:3157-3158,3163,3178-3181
local strings<const> = require('kernel/gc_strings') -- T:178,603 U:5087,5104 P:3157,3174 C:636
local _bindings<const> = require('kernel/image_string_bindings') -- U:5104 P:3174; read installed String ordinals directly
local layout<const> = require('kernel/gc_runtime_layout') -- O:6; addresses are relative to the existing System management region
local name_index_slot_bytes<const> = require('kernel/global_bank').internal.name_index_slot_bytes -- G:21-22,31 B:23-24,34
local ram_base<const> = 0x08000000 -- O:6
local ram_word_mask<const> = 0x003ffffc -- G:21 B:23; preserve record address normalization
local ram_byte_mask<const> = 0x003fffff -- G:22 B:24
local trace_head<const> = 4 -- T:25,313 H:23
local root_cursor<const> = 0x58 -- T:43 H:42
local cursor_bits<const> = 20 -- T:58 C:71
local cursor_mask<const> = (1 << cursor_bits) - 1 -- T:59 C:72
local system_globals<const> = 1 -- T:69 H:20
local system_constants<const> = 3 -- T:69,594 H:20 C:626
local completion<const> = 6 -- T:69 U:5076,5091 H:20 P:3146,3162
local thread_kind<const> = 4 -- T:307-309 C:272-274 Q:33 R:18

-- The Value-bank record points at the payload plane. Firmware also scans
-- its private names immediately before that plane. No roots are copied.
-- Installed operand records point at all String IDs in ordinal order.
-- Only RAM IDs count as roots or collector work. Completion reads the live
-- host-return observation through its private descriptor.
-- The former ConcatOperands bank (U:5077,5095-5101 P:3147,3166-3171) has
-- no separate scan. string_control_call.receive borrows the suspended
-- Thread's argument window. allocate_string_slice.intern_value_window
-- retains its Strings before recovery, and gc_thread_trace scans its Values.
struct root_bank
	count: u32 -- U:5073-5076,5078-5079 P:3143-3146,3148-3149
	payloads: addr -- U:5085,5092,5103-5104 P:3155,3163,3173-3174 G:21 B:23
	tags: addr -- U:5085,5092 P:3155,3163 G:22 B:24
	padding: u32 -- U:5073-5076,5078-5079 P:3143-3146,3148-3149; align the Count+Payload pair
end

struct root_descriptors
	root: addr -- U:5107-5108 P:3177-3178
	active: addr -- U:5108 P:3179
	completion_thread: addr -- U:5108 P:3180
	halted: addr -- U:5109 P:3181
	banks: root_bank[1] -- T:69 H:20
end

local mark_root_bank<const> = function(control, arena, metadata, payloads, tags_base, names_base, kind, first, stop, replace_color_byte) -- U:5082 P:3152
	local words<const>: *u32 = payloads -- U:5084-5085,5092,5103-5104 P:3154-3155,3163,3173-3174
	local work = 0 -- T:591,603 C:636; String work replaces the drained host latch
	if kind < system_constants then -- U:5083 P:3153
		local names<const>: *u32 = names_base -- U:5084,5087 P:3154,3157 G:31 B:34
		local tags<const>: *u8 = tags_base -- U:5085,5087 P:3155,3158
		while first < stop do -- U:5086 P:3156
			work = work + strings.mark(metadata, names[first]) -- U:5087 P:3157
			local _<const>, string_work<const> = mark.mark_value(control, arena, metadata, tags[first], words[first], trace_head, replace_color_byte) -- U:5087 P:3158
			work = work + string_work -- T:603 C:636
			first = first + 1 -- U:5086 P:3156
		end
		return work -- U:5089 P:3160 T:603 C:636
	end
	local tags<const>: *u8 = tags_base -- U:5091-5092 P:3162-3163
	while first < stop do -- U:5092 P:3163
		local _<const>, string_work<const> = mark.mark_value(control, arena, metadata, tags[first], words[first], trace_head, replace_color_byte) -- U:5092 P:3163
		work = work + string_work -- T:603 C:636
		first = first + 1 -- U:5092 P:3163
	end
	return work -- U:5093 P:3164 T:603 C:636
end

local trace_root_banks<const> = function(control, arena, metadata, descriptor, limit, work, stop, replace_color_byte) -- T:588 C:619
	local cursor<const>: *u32 = ram_base + control + root_cursor -- T:589 C:620
	local roots<const>: *root_descriptors = ram_base + descriptor -- T:593,608 C:625,641; typed publication of producer state
	local saved<const> = *cursor -- T:589 C:620
	local kind, next = saved >> cursor_bits, saved & cursor_mask -- T:590,592 C:621-622
	while kind < stop do -- T:592 C:623
		local globals<const> = kind < system_constants -- T:594 C:626
		local literal_bank<const> = not globals and kind < completion -- U:5078-5079 P:3148-3149
		local bank_end, payloads, tags, names -- T:593 C:624-625 U:5073-5076,5078-5079 P:3143-3146,3148-3149
		if globals then -- U:5083 P:3153
			local namespace<const>: *namespace_bank = ram_base + control - layout.control_offset + layout.system_global_bank_offset + (kind - system_globals) * sizeof(namespace_bank) -- U:5074-5075,5084 P:3144-3145,3154
			local values<const>, capacity<const> = namespace.values, namespace.capacity -- U:5084 P:3154 G:21-22,31 B:23-24,34
			bank_end = namespace.count -- U:5074-5075 P:3144-3145
			names = ram_base + ((values - name_index_slot_bytes * capacity) & ram_word_mask) -- U:5087 P:3157 G:31 B:34
			payloads = ram_base + (values & ram_word_mask) -- U:5085,5087 P:3155,3158 G:21 B:23
			tags = ram_base + ((values + 4 * capacity) & ram_byte_mask) -- U:5085,5087 P:3155,3158 G:22 B:24
		elseif literal_bank then -- U:5078-5079,5103-5104 P:3148-3149,3173-3174
			local state<const>, lane<const> = ram_base + control - layout.control_offset, kind - system_constants -- T:593 C:625 U:5078-5079 P:3148-3149
			local maps<const>: *image_operand_map = state + layout.image_operand_maps_offset -- U:5078-5079,5103 P:3148-3149,3173
			local backings<const>: *image_operand_backing = state + layout.image_operand_backings_offset -- U:5078-5079,5103 P:3148-3149,3173
			bank_end, payloads = backings[lane].ram_string_end, maps[lane].strings -- U:5078-5079,5104 P:3148-3149,3174
		else -- U:5076 P:3146
			local bank<const>: *root_bank = &roots.banks[kind - completion] -- T:593 C:624-625
			bank_end, payloads, tags = bank.count, bank.payloads, bank.tags -- T:593 C:625 U:5076,5091-5092 P:3146,3162-3163
		end
		local words<const> = globals and 3 or 1 -- T:595 C:627
		local worst<const> = words + (globals and 2 or 1) -- T:595 C:627
		while next < bank_end do -- T:596 C:628
			if work >= limit then -- T:597 C:629
				*cursor = (kind << cursor_bits) | next -- T:598 C:630
				return work -- T:599 C:631
			end
			local amount = (limit - work) // worst -- T:601 C:633; positive work difference, floor equals truncation
			if amount < 1 then amount = 1 end -- T:601 C:633
			if literal_bank then -- U:5103 P:3173
				local literals<const>: *u32 = payloads -- U:5103-5104 P:3173-3174
				-- The quantum counts RAM roots; the cursor names a physical slot.
				-- The bound ends on a RAM root, so a pause always has work left.
				repeat -- T:601 C:633 U:5104 P:3174
					local id<const> = literals[next] -- U:5104 P:3174
					if strings.internal.is_ram_string_id(id) then -- U:5104 P:3174
						work = work + words + strings.mark(metadata, id) -- T:603 C:635-636 U:5104 P:3174
						amount = amount - 1 -- T:601 C:633
					end
					next = next + 1 -- T:604 C:637
				until amount == 0 or next == bank_end -- T:601 C:633
			else -- T:601 C:633
				local next_stop = next + amount -- T:601 C:633
				if next_stop > bank_end then next_stop = bank_end end -- T:601 C:633
				local string_work<const> = mark_root_bank(control, arena, metadata, payloads, tags, names, kind, next, next_stop, replace_color_byte) -- T:602 C:634
				work = work + (next_stop - next) * words + string_work -- T:603 C:635-636
				next = next_stop -- T:604 C:637
			end
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
