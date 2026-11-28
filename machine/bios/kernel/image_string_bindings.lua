module<const>

-- Source basis 57945b221: CPU image binding resolves String constants in pool
-- order (TS cpu.ts:997-1010,1155-1161; C++ cpu.cpp:290-305). Each resolved ID
-- occupies its String ordinal. Only firmware uses the extent of the RAM roots.

struct installed_image_binding
	base: addr
	bytes: u32
	strings: addr
	ram_string_end: u32 -- One past the last RAM-String ordinal, or zero.
end

return {}
