module<const>

-- Source basis: 61e40427ed56ea18e7fad271ef3afa1735b9ba9e.
-- T/C/H = mirrored GcHeap and its C++ header, A/B = physical arena
-- owners, N/O = signed-word views, M = RAM constants. The producer
-- samples physical occupancy and capacity at the coherent service boundary.
local control_layout<const> = require('kernel/gc_control') -- T:50-55 H:49-55
local word_arithmetic<const> = require('kernel/word_arithmetic') -- T:868-869 C:923-925; widen before the multiply/divide
local ram_base<const> = 0x08000000 -- M:6
local ram_size<const> = 0x00400000 -- T:872 C:928 M:7
local minimum_batch<const> = 512 -- T:867 C:922-923
local sign_bit<const> = 0x80000000 -- C:923-924; raw unsigned order

struct gc_pace_state
	basis: u32 -- T:51,870 H:51 C:926
	estimate: u32 -- T:52,859 H:52 C:914
	runway: u32 -- T:53,860 H:53 C:915
	paid: u32 -- T:54,871 H:54 C:927
	pay_at: u32 -- T:55,872 H:55 C:928
end

local update_pace_credit<const> = function(control, basis, paid, estimate, runway) -- T:864 C:919
	local batch = minimum_batch -- T:867 C:922-923
	if (paid ~ sign_bit) < (estimate ~ sign_bit) then -- T:867 C:923
		local remaining<const> = estimate - paid -- T:867 C:923
		if (remaining ~ sign_bit) < (minimum_batch ~ sign_bit) then batch = remaining end -- T:867 C:923
	end
	-- In C++ paid+batch is a register-word addition before widening.
	-- TS instead keeps the intermediate in binary64; on raw wrap or
	-- binary64 rounding the two existing mirrors need not agree.
	local high<const>, low<const> = word_arithmetic.multiply_add_words(paid + batch, runway, estimate - 1) -- T:868-869 C:924-925
	local quotient_high<const>, quotient_low<const> = word_arithmetic.divide_words_by_word(high, low, estimate) -- T:869 C:925
	local next_low<const> = quotient_low + basis -- T:869 C:925 N:12-15 O:13-16; basis is signed when added to the widened quotient
	local carry<const> = (next_low ~ sign_bit) < (quotient_low ~ sign_bit) and 1 or 0 -- T:869 C:925
	local extension<const> = basis < 0 and -1 or 0 -- T:869 C:925 N:12-15 O:13-16
	local next_high<const> = quotient_high + extension + carry -- T:869 C:925
	local state<const>: *gc_pace_state = ram_base + control + control_layout.internal.sweep_link_offset + 4 -- T:50-55,870-872 C:926-928 H:49-55
	state.basis = basis -- T:870 C:926
	state.paid = paid -- T:871 C:927
	if next_high < 0 then -- T:872 C:928; signed result is below zero
		state.pay_at = 0 -- T:872 C:928
	elseif next_high > 0 or (next_low ~ sign_bit) > (ram_size ~ sign_bit) then -- T:872 C:928
		state.pay_at = ram_size -- T:872 C:928
	else -- T:872 C:928
		state.pay_at = next_low -- T:872 C:928
	end
end

local begin_pace_credit<const> = function(control, occupied, capacity, estimate, runway_shift) -- T:854,857-858 C:908,912-913 A:49-51 B:48-50
	local runway = (capacity - occupied) >> runway_shift -- T:858 C:913
	if runway == 0 then runway = 1 end -- T:858 C:913; unsigned max with one
	local state<const>: *gc_pace_state = ram_base + control + control_layout.internal.sweep_link_offset + 4 -- T:50-55,859-860 C:914-915 H:49-55
	state.estimate = estimate -- T:859 C:914
	state.runway = runway -- T:860 C:915
	update_pace_credit(control, occupied, 0, estimate, runway) -- T:861 C:916
end

return {
	update_pace_credit = update_pace_credit,
	begin_pace_credit = begin_pace_credit,
}
