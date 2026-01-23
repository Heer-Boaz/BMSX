-- bootrom.lua
-- bmsx system boot screen

local boot_delay = 2.0
local font_width = 6
local line_height = 8

local color_bg = 4
local color_header_bg = 7
local color_header_text = 1
local color_text = 15
local color_muted = 14
local color_accent = 11
local color_warn = 9

local ENGINE_ROM_BASE = 0x00000000
local CART_ROM_BASE = 0x01000000
local CART_ROM_MAGIC = 0x58534D42

local boot_start = os.clock()
local boot_requested = false

local function read_zstr(addr)
	local t = {}
	while true do
		local b = peek(addr) % 256 -- read u8
		addr = addr + 1
		if b == 0 then break end
		t[#t + 1] = string.char(b)
	end
	return table.concat(t), addr
end

local function read_cart_header(base)
	if peek(base) ~= CART_ROM_MAGIC then
		return nil
	end
	return {
		header_size = peek(base + 4),
		manifest_off = peek(base + 8),
		manifest_len = peek(base + 12),
		toc_off = peek(base + 16),
		toc_len = peek(base + 20),
		data_off = peek(base + 24),
		data_len = peek(base + 28),
	}
end

local function read_bios_manifest(base, header)
	local p = base + header.manifest_off
	local entry_kind = peek(p)
	p = p + 4
	local title; title, p = read_zstr(p)
	local short_name; short_name, p = read_zstr(p)
	local rom_name; rom_name, p = read_zstr(p)
	local entry_path; entry_path, p = read_zstr(p)
	local namespace; namespace, p = read_zstr(p)
	local viewport; viewport, p = read_zstr(p)
	local canonicalization; canonicalization, p = read_zstr(p)
	local input; input, p = read_zstr(p)
	local root; root, p = read_zstr(p)
	return {
		entry_kind = entry_kind,
		title = title,
		short_name = short_name,
		rom_name = rom_name,
		entry_path = entry_path,
		namespace = namespace,
		viewport = viewport,
		canonicalization = canonicalization,
		input = input,
		root = root,
	}
end

local function display_text(value)
	if value == nil or value == '' then
		return '--'
	end
	return value
end

local function elapsed_seconds()
	return os.clock() - boot_start
end

local function center_x(text, width)
	-- center text in given width, but ensure that the result is dividable by font_width
	return math.floor((width - (#text * font_width)) / 2 / font_width) * font_width
end

local function build_info()
	local cart_header = read_cart_header(CART_ROM_BASE)
	local cart_manifest = cart_header and read_bios_manifest(CART_ROM_BASE, cart_header) or nil
	local engine_header = read_cart_header(ENGINE_ROM_BASE)
	local engine_manifest = engine_header and read_bios_manifest(ENGINE_ROM_BASE, engine_header) or nil

	local cart_title = cart_manifest and display_text(cart_manifest.title) or '--'
	local cart_short = cart_manifest and display_text(cart_manifest.short_name) or '--'
	local cart_rom = cart_manifest and display_text(cart_manifest.rom_name) or '--'
	local cart_ns = cart_manifest and display_text(cart_manifest.namespace) or '--'
	local cart_view_label = cart_manifest and display_text(cart_manifest.viewport) or '--'
	local cart_canon = cart_manifest and display_text(cart_manifest.canonicalization) or '--'
	local cart_entry = cart_manifest and display_text(cart_manifest.entry_path) or '--'
	local cart_input = cart_manifest and display_text(cart_manifest.input) or '--'

	local engine_title = engine_manifest and display_text(engine_manifest.title) or '--'
	local engine_rom = engine_manifest and display_text(engine_manifest.rom_name) or '--'
	local engine_ns = engine_manifest and display_text(engine_manifest.namespace) or '--'
	local engine_view_label = engine_manifest and display_text(engine_manifest.viewport) or '--'
	local engine_canon = engine_manifest and display_text(engine_manifest.canonicalization) or '--'
	local engine_entry = engine_manifest and display_text(engine_manifest.entry_path) or '--'

	return {
		engine_title = engine_title,
		engine_rom = engine_rom,
		engine_ns = engine_ns,
		engine_view = engine_view_label,
		engine_canon = engine_canon,
		engine_entry = engine_entry,
		cart_title = cart_title,
		cart_short = cart_short,
		cart_rom = cart_rom,
		cart_ns = cart_ns,
		cart_view = cart_view_label,
		cart_canon = cart_canon,
		cart_entry = cart_entry,
		cart_input = cart_input,
		root = cart_manifest and display_text(cart_manifest.root) or '--',
	}
end

local function divider(width, left)
	local available = width - (left * 2)
	local slots = math.floor(available / font_width)
	if slots < 8 then
		slots = 8
	end
	-- optie 1
	-- return string.rep(string.char(0x2014), slots)
	-- optie 2
	-- return (utf8 and utf8.char) and utf8.char(0x2014) or '-'
	return string.rep('—', slots)
	-- return string.rep(string.char(0xE2, 0x80, 0x94), slots)
end

local function build_progress_bar(progress, width)
	local clamped = progress
	if clamped < 0 then clamped = 0 end
	if clamped > 1 then clamped = 1 end
	local filled = math.floor(width * clamped + 0.5)
	if filled < 0 then filled = 0 end
	if filled > width then filled = width end
	return '[' .. string.rep('#', filled) .. string.rep('-', width - filled) .. ']'
end

function init()
	boot_start = os.clock()
	boot_requested = false
	vdp_load_engine_atlas()
end

function new_game()
end

function update(_dt)
	local cart_present_and_ready = peek(CART_ROM_BASE) == CART_ROM_MAGIC and peek(sys_cart_bootready) == 1

	if cart_present_and_ready and not boot_requested and elapsed_seconds() >= boot_delay then
		boot_requested = true
		poke(sys_boot_cart, 1)
	end
end

function draw()
	local width = display_width()
	local left = 8
	local top = 32

	cls(color_bg)
	put_rectfill(0, 0, width, 24, 0, color_header_bg)
	write('BMSX BIOS', center_x('BMSX BIOS', width), 8, 0, color_header_text)

	local info = build_info()
	local y = top
	write(divider(width, left), left, y, color_accent)
	y = y + line_height
	write('ENGINE NAME: ' .. info.engine_title, left, y, 0, color_text)
	y = y + line_height
	write('ENGINE ROM : ' .. info.engine_rom, left, y, 0, color_text)
	y = y + line_height
	write('ENGINE NS  : ' .. info.engine_ns, left, y, 0, color_text)
	y = y + line_height
	write('ENGINE VIEW: ' .. info.engine_view, left, y, 0, color_text)
	y = y + line_height
	write('ENGINE LUA : ' .. info.engine_entry, left, y, 0, color_text)
	y = y + line_height
	write('ENGINE CAN : ' .. info.engine_canon, left, y, 0, color_text)
	y = y + line_height
	write(divider(width, left), left, y, 0, color_accent)
	y = y + line_height
	write('CART ROM   : ' .. info.cart_rom, left, y, 0, color_text)
	y = y + line_height
	write('CART NAME  : ' .. info.cart_title, left, y, 0, color_text)
	y = y + line_height
	write('SHORT NAME : ' .. info.cart_short, left, y, 0, color_text)
	y = y + line_height
	write('NAMESPACE  : ' .. info.cart_ns, left, y, 0, color_text)
	y = y + line_height
	write('VIEWPORT   : ' .. info.cart_view, left, y, 0, color_text)
	y = y + line_height
	write('CANON      : ' .. info.cart_canon, left, y, 0, color_text)
	y = y + line_height
	write('CART LUA   : ' .. info.cart_entry, left, y, 0, color_text)
	y = y + line_height
	write('INPUT MAP  : ' .. info.cart_input, left, y, 0, color_text)
	y = y + line_height
	write('ROOT       : ' .. info.root, left, y, 0, color_muted)
	y = y + line_height
	write(divider(width, left), left, y, 0, color_accent)
	y = y + line_height

	local cart_present = peek(CART_ROM_BASE) == CART_ROM_MAGIC
	local elapsed = elapsed_seconds()
	local cursor = (math.floor(elapsed * 2) % 2 == 0) and '█' or ' '
	if cart_present then
		local remaining = boot_delay - elapsed
		if remaining < 0 then remaining = 0 end
		-- local status = 'AUTOBOOT IN ' .. string.format('%.1f', remaining) .. 'S'
		local status = peek(sys_cart_bootready) == 0 and 'LOADING CART' or 'CART LOADED'
		write('STATUS     : ' .. status, left, y, 0, color_text)
		y = y + line_height
		local bar = build_progress_bar(elapsed / boot_delay, 20)
		write('BOOT STATUS : ' .. bar .. cursor, left, y, 0, color_text)
	else
		write('                             ' .. cursor, left, y, 0, color_text)
		write('             NO CART DETECTED', left, y, 0, color_warn)
		write('STATUS     :', left, y, 0, color_text)
	end
end
