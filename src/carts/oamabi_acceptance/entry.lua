local OAM_FMT = '<I4I4I4I4ffffffffffffff'

local phase = 0
local meta = nil

local function get_whitepixel_meta()
	if meta ~= nil then
		return meta
	end
	meta = assets.img[romdir.token('whitepixel')].imgmeta
	return meta
end

local function uv_bounds()
	local texcoords = get_whitepixel_meta().texcoords
	local min_u = math.min(texcoords[1], texcoords[3], texcoords[5], texcoords[7], texcoords[9], texcoords[11])
	local max_u = math.max(texcoords[1], texcoords[3], texcoords[5], texcoords[7], texcoords[9], texcoords[11])
	local min_v = math.min(texcoords[2], texcoords[4], texcoords[6], texcoords[8], texcoords[10], texcoords[12])
	local max_v = math.max(texcoords[2], texcoords[4], texcoords[6], texcoords[8], texcoords[10], texcoords[12])
	return min_u, min_v, max_u, max_v
end

local function make_entry(x, y, w, h, r, g, b, a, layer, enabled)
	local min_u, min_v, max_u, max_v = uv_bounds()
	return {
		atlas_id = get_whitepixel_meta().atlasid,
		flags = enabled and 1 or 0,
		asset_handle = 0,
		layer = layer,
		x = x,
		y = y,
		z = 0,
		w = w,
		h = h,
		u0 = min_u,
		v0 = min_v,
		u1 = max_u,
		v1 = max_v,
		r = r,
		g = g,
		b = b,
		a = a,
		parallax_weight = 0,
	}
end

local function frame_a()
	return {
		make_entry(32, 32, 64, 64, 1, 0, 0, 1, 0, true),
		make_entry(48, 48, 64, 64, 0, 1, 0, 1, 0, true),
		make_entry(112, 32, 40, 40, 0, 0, 1, 1, 0, false),
		make_entry(160, 40, 48, 48, 1, 1, 0, 1, 1, true),
	}
end

local function frame_b()
	return {
		make_entry(20, 24, 64, 64, 1, 0.25, 0.25, 1, 0, true),
		make_entry(84, 52, 72, 40, 0.2, 1, 0.4, 1, 0, true),
		make_entry(140, 28, 40, 40, 0, 0, 1, 1, 0, false),
		make_entry(168, 92, 36, 36, 1, 1, 0.2, 1, 1, true),
	}
end

local function pack_entry(entry)
	return string.pack(
		OAM_FMT,
		entry.atlas_id,
		entry.flags,
		entry.asset_handle,
		entry.layer,
		entry.x,
		entry.y,
		entry.z,
		entry.w,
		entry.h,
		entry.u0,
		entry.v0,
		entry.u1,
		entry.v1,
		entry.r,
		entry.g,
		entry.b,
		entry.a,
		entry.parallax_weight
	)
end

local function slot_addr(base, slot)
	return base + slot * sys_vdp_oam_entry_bytes
end

local function read_slot(base, slot)
	local addr = slot_addr(base, slot)
	return {
		atlas_id = peek32le(addr + 0),
		flags = peek32le(addr + 4),
		asset_handle = peek32le(addr + 8),
		layer = peek32le(addr + 12),
		x = reader_read_f32(addr + 16),
		y = reader_read_f32(addr + 20),
		z = reader_read_f32(addr + 24),
		w = reader_read_f32(addr + 28),
		h = reader_read_f32(addr + 32),
		u0 = reader_read_f32(addr + 36),
		v0 = reader_read_f32(addr + 40),
		u1 = reader_read_f32(addr + 44),
		v1 = reader_read_f32(addr + 48),
		r = reader_read_f32(addr + 52),
		g = reader_read_f32(addr + 56),
		b = reader_read_f32(addr + 60),
		a = reader_read_f32(addr + 64),
		parallax_weight = reader_read_f32(addr + 68),
	}
end

local function nearly_equal(a, b)
	return math.abs(a - b) < 0.001
end

local function assert_entry_matches(actual, expected, label)
	assert(actual.atlas_id == expected.atlas_id, label .. ': atlas_id mismatch')
	assert(actual.flags == expected.flags, label .. ': flags mismatch')
	assert(actual.layer == expected.layer, label .. ': layer mismatch')
	assert(nearly_equal(actual.x, expected.x), label .. ': x mismatch')
	assert(nearly_equal(actual.y, expected.y), label .. ': y mismatch')
	assert(nearly_equal(actual.w, expected.w), label .. ': w mismatch')
	assert(nearly_equal(actual.h, expected.h), label .. ': h mismatch')
	assert(nearly_equal(actual.u0, expected.u0), label .. ': u0 mismatch')
	assert(nearly_equal(actual.v0, expected.v0), label .. ': v0 mismatch')
	assert(nearly_equal(actual.u1, expected.u1), label .. ': u1 mismatch')
	assert(nearly_equal(actual.v1, expected.v1), label .. ': v1 mismatch')
	assert(nearly_equal(actual.r, expected.r), label .. ': r mismatch')
	assert(nearly_equal(actual.g, expected.g), label .. ': g mismatch')
	assert(nearly_equal(actual.b, expected.b), label .. ': b mismatch')
	assert(nearly_equal(actual.a, expected.a), label .. ': a mismatch')
end

local function commit_entries(entries)
	local blob = ''
	for index = 1, #entries do
		blob = blob .. pack_entry(entries[index])
	end
	mem_write(peek(sys_vdp_oam_back_base), blob)
	poke(sys_vdp_oam_back_count, #entries)
	poke(sys_vdp_oam_cmd, sys_vdp_oam_cmd_swap)
end

local function assert_front_matches(entries, expected_commit_seq)
	assert(peek(sys_vdp_oam_commit_seq) == expected_commit_seq, 'commit sequence mismatch')
	assert(peek(sys_vdp_oam_front_count) == #entries, 'front count mismatch')
	assert(peek(sys_vdp_oam_back_count) == 0, 'back count should be cleared after swap')
	assert(peek(sys_vdp_oam_read_source) == sys_vdp_oam_read_source_front, 'read source should be front after swap')
	local front_base = peek(sys_vdp_oam_front_base)
	for slot = 1, #entries do
		assert_entry_matches(read_slot(front_base, slot - 1), entries[slot], 'slot ' .. tostring(slot - 1))
	end
end

function init()
	local loaded = get_whitepixel_meta()
	assert(loaded ~= nil, 'whitepixel metadata missing')
	assert(loaded.atlasid ~= nil, 'whitepixel atlas id missing')
	assert(loaded.texcoords ~= nil, 'whitepixel texcoords missing')
	assert(#loaded.texcoords == 12, 'whitepixel texcoords must contain six uv pairs')
	assert(sys_vdp_oam_entry_bytes == 72, 'OAM entry size must stay frozen at 72 bytes')
end

function new_game()
end

function update()
	if phase == 0 then
		commit_entries(frame_a())
		phase = 1
		return
	end
	if phase == 1 then
		assert_front_matches(frame_a(), 1)
		commit_entries(frame_b())
		phase = 2
		return
	end
	if phase == 2 then
		assert_front_matches(frame_b(), 2)
		phase = 3
	end
end

function draw()
end
