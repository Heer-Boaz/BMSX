-- romdir.lua
-- Runtime ROM directory lookup helpers (BIOS-level, no builtins)

local cart_rom_magic = 0x58534d42
local btoc_magic = 0x434f5442
local btoc_header_size = 48
local btoc_entry_size = 80
local btoc_invalid_u32 = 0xffffffff
local fnv_offset_basis_lo = 0x84222325
local fnv_offset_basis_hi = 0xcbf29ce4
local fnv_prime = 0x1b3
local u32_mod = 0x100000000

local function read_u32(addr)
	return peek(addr)
end

local function read_cart_header(base)
	if read_u32(base) ~= cart_rom_magic then
		return nil
	end
	return {
		header_size = read_u32(base + 4),
		manifest_off = read_u32(base + 8),
		manifest_len = read_u32(base + 12),
		toc_off = read_u32(base + 16),
		toc_len = read_u32(base + 20),
		data_off = read_u32(base + 24),
		data_len = read_u32(base + 28),
	}
end

local function read_btoc_header(rom_base, cart_header)
	local toc_base = rom_base + cart_header.toc_off
	local toc_len = cart_header.toc_len
	if toc_len < btoc_header_size then
		error('BTOC header exceeds TOC length.')
	end
	if read_u32(toc_base) ~= btoc_magic then
		error('BTOC magic mismatch.')
	end
	local header_size = read_u32(toc_base + 4)
	if header_size ~= btoc_header_size then
		error('BTOC header size mismatch.')
	end
	local entry_size = read_u32(toc_base + 8)
	if entry_size ~= btoc_entry_size then
		error('BTOC entry size mismatch.')
	end
	local entry_count = read_u32(toc_base + 12)
	local entry_offset = read_u32(toc_base + 16)
	if entry_offset ~= btoc_header_size then
		error('BTOC entry offset mismatch.')
	end
	local string_table_offset = read_u32(toc_base + 20)
	local string_table_length = read_u32(toc_base + 24)
	local project_root_offset = read_u32(toc_base + 28)
	local project_root_length = read_u32(toc_base + 32)
	local entries_bytes = entry_count * entry_size
	local expected_string_offset = entry_offset + entries_bytes
	if string_table_offset ~= expected_string_offset then
		error('BTOC string table offset mismatch.')
	end
	if entry_offset + entries_bytes > toc_len then
		error('BTOC entries exceed TOC length.')
	end
	if string_table_offset + string_table_length > toc_len then
		error('BTOC string table exceeds TOC length.')
	end
	return {
		rom_base = rom_base,
		toc_base = toc_base,
		toc_len = toc_len,
		entry_size = entry_size,
		entry_count = entry_count,
		entry_offset = entry_offset,
		string_table_offset = string_table_offset,
		string_table_length = string_table_length,
		project_root_offset = project_root_offset,
		project_root_length = project_root_length,
	}
end

local function canonicalize_id(id)
	if id == nil then
		return ''
	end
	local normalized = string.gsub(id, '\\\\', '/')
	local start
	if string.sub(normalized, 1, 2) == './' then
		start = 3
	else
		start = 1
	end
	local out = {}
	local prev_slash = false
	for i = start, #normalized do
		local ch = string.sub(normalized, i, i)
		if ch == '/' then
			if not prev_slash then
				out[#out + 1] = ch
			end
			prev_slash = true
		else
			prev_slash = false
			local code = string.byte(ch)
			if code >= 65 and code <= 90 then
				ch = string.char(code + 32)
			end
			out[#out + 1] = ch
		end
	end
	return table.concat(out)
end

local function hash_id(id)
	local canonical = canonicalize_id(id)
	local lo = fnv_offset_basis_lo
	local hi = fnv_offset_basis_hi
	for i = 1, #canonical do
		local byte = string.byte(canonical, i)
		lo = lo ~ byte
		if lo < 0 then lo = lo + u32_mod end
		local lo_mul = lo * fnv_prime
		local carry = math.floor(lo_mul / u32_mod)
		local lo_low = lo_mul - (carry * u32_mod)
		local hi_mul = hi * fnv_prime + carry
		local hi_low = hi_mul % u32_mod
		local lo_shift = (lo * 0x100) % u32_mod
		hi = (hi_low + lo_shift) % u32_mod
		lo = lo_low
	end
	return lo, hi
end

local function token_key(lo, hi)
	return string.format('%08x%08x', hi, lo)
end

local function normalize_u32(value)
	if value == btoc_invalid_u32 then
		return nil
	end
	return value
end

local function read_entry(header, entry_base)
	return {
		rom_base = header.rom_base,
		token_lo = read_u32(entry_base + 0),
		token_hi = read_u32(entry_base + 4),
		type_id = read_u32(entry_base + 8),
		op_id = read_u32(entry_base + 12),
		resid_offset = read_u32(entry_base + 16),
		resid_length = read_u32(entry_base + 20),
		source_offset = read_u32(entry_base + 24),
		source_length = read_u32(entry_base + 28),
		normalized_offset = read_u32(entry_base + 32),
		normalized_length = read_u32(entry_base + 36),
		start = normalize_u32(read_u32(entry_base + 40)),
		['end'] = normalize_u32(read_u32(entry_base + 44)),
		compiled_start = normalize_u32(read_u32(entry_base + 48)),
		compiled_end = normalize_u32(read_u32(entry_base + 52)),
		metabuffer_start = normalize_u32(read_u32(entry_base + 56)),
		metabuffer_end = normalize_u32(read_u32(entry_base + 60)),
		texture_start = normalize_u32(read_u32(entry_base + 64)),
		texture_end = normalize_u32(read_u32(entry_base + 68)),
		update_lo = read_u32(entry_base + 72),
		update_hi = read_u32(entry_base + 76),
	}
end

local function find_entry(header, token_lo, token_hi)
	local low = 0
	local high = header.entry_count - 1
	while low <= high do
		local mid = math.floor((low + high) / 2)
		local entry_base = header.toc_base + header.entry_offset + (mid * header.entry_size)
		local entry_lo = read_u32(entry_base + 0)
		local entry_hi = read_u32(entry_base + 4)
		if entry_hi == token_hi and entry_lo == token_lo then
			return read_entry(header, entry_base)
		end
		if entry_hi < token_hi or (entry_hi == token_hi and entry_lo < token_lo) then
			low = mid + 1
		else
			high = mid - 1
		end
	end
	return nil
end

local function find_in_rom(rom_base, token_lo, token_hi)
	local cart_header = read_cart_header(rom_base)
	if cart_header == nil then
		return nil
	end
	local toc_header = read_btoc_header(rom_base, cart_header)
	return find_entry(toc_header, token_lo, token_hi)
end

local function find_overlay_or_cart(token_lo, token_hi)
	if sys_rom_overlay_size > 0 then
		local overlay_entry = find_in_rom(sys_rom_overlay_base, token_lo, token_hi)
		if overlay_entry ~= nil then
			if overlay_entry.op_id == 1 then
				return nil
			end
			return overlay_entry
		end
	end
	return find_in_rom(sys_rom_cart_base, token_lo, token_hi)
end

local function find_sys(token_lo, token_hi)
	return find_in_rom(sys_rom_system_base, token_lo, token_hi)
end

local function resolve_sys(token_lo, token_hi)
	local entry = find_overlay_or_cart(token_lo, token_hi)
	if entry ~= nil then
		return entry
	end
	return find_sys(token_lo, token_hi)
end

local romdir = {}

function romdir.cart(id)
	local lo, hi = hash_id(id)
	return find_overlay_or_cart(lo, hi)
end

function romdir.sys(id)
	local lo, hi = hash_id(id)
	return resolve_sys(lo, hi)
end

function romdir.token(id)
	local lo, hi = hash_id(id)
	return token_key(lo, hi)
end

return romdir
