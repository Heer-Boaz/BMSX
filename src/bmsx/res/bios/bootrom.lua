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
local color_accent = 15
local color_section = 1
local color_warn = 9
local color_ok = 15
local color_info_total = 15

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

local function format_bytes(value)
	local kb = 1024
	local mb = kb * 1024
	if value >= mb then
		local scaled = value / mb
		if scaled == math.floor(scaled) then
			return string.format("%d MB", scaled)
		end
		return string.format("%.1f MB", scaled)
	end
	if value >= kb then
		local scaled = value / kb
		if scaled == math.floor(scaled) then
			return string.format("%d KB", scaled)
		end
		return string.format("%.1f KB", scaled)
	end
	return tostring(value) .. " B"
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
	local vram_total = SYS_VRAM_ENGINE_ATLAS_SIZE + SYS_VRAM_PRIMARY_ATLAS_SIZE + SYS_VRAM_SECONDARY_ATLAS_SIZE + SYS_VRAM_STAGING_SIZE

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
		hw_cart_max = format_bytes(SYS_CART_ROM_SIZE),
		hw_ram_total = format_bytes(SYS_RAM_SIZE),
		hw_vram_total = format_bytes(vram_total),
		hw_max_assets = tostring(SYS_MAX_ASSETS),
		hw_max_strings = tostring(SYS_STRING_HANDLE_COUNT),
		hw_max_instructions = tostring(SYS_MAX_INSTRUCTIONS_PER_FRAME),
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

local function write_kv(label, value, x, y, color, label_width)
	write(string.format("%-" .. label_width .. "s : %s", label, value), x, y, 0, color)
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
	local hw_specs = {
		{ label = 'MAX CART ROM', value = info.hw_cart_max, color = color_accent },
		{ label = 'TOTAL RAM', value = info.hw_ram_total, color = color_info_total },
		{ label = 'TOTAL VRAM', value = info.hw_vram_total, color = color_info_total },
		{ label = 'MAX ASSETS', value = info.hw_max_assets, color = color_accent },
		{ label = 'MAX STRING ENTRIES', value = info.hw_max_strings, color = color_accent },
		{ label = 'MAX INSTRUCTIONS/FRAME', value = info.hw_max_instructions, color = color_accent },
	}
	local cart_specs = {
		{ label = 'CART ROM', value = info.cart_rom, color = color_accent },
		{ label = 'CART NAME', value = info.cart_title, color = color_ok },
		{ label = 'SHORT NAME', value = info.cart_short, color = color_text },
		{ label = 'NAMESPACE', value = info.cart_ns, color = color_muted },
		{ label = 'VIEWPORT', value = info.cart_view, color = color_info_total },
		{ label = 'CANON', value = info.cart_canon, color = color_muted },
		{ label = 'CART LUA', value = info.cart_entry, color = color_text },
		{ label = 'INPUT MAP', value = info.cart_input, color = color_accent },
		{ label = 'ROOT', value = info.root, color = color_muted },
	}
	local label_width = 0
	for i = 1, #hw_specs do
		local len = #hw_specs[i].label
		if len > label_width then label_width = len end
	end
	for i = 1, #cart_specs do
		local len = #cart_specs[i].label
		if len > label_width then label_width = len end
	end
	local status_labels = { 'STATUS', 'BOOT STATUS' }
	for i = 1, #status_labels do
		local len = #status_labels[i]
		if len > label_width then label_width = len end
	end
	write('SYSTEM SPECS', left, y, 0, color_section)
	y = y + line_height
	write(divider(width, left), left, y, color_section)
	y = y + line_height
	for i = 1, #hw_specs do
		local spec = hw_specs[i]
		write_kv(spec.label, spec.value, left, y, spec.color or color_text, label_width)
		y = y + line_height
	end
	y = y + line_height
	write('CARTRIDGE', left, y, 0, color_section)
	y = y + line_height
	write(divider(width, left), left, y, 0, color_section)
	y = y + line_height
	for i = 1, #cart_specs do
		local spec = cart_specs[i]
		write_kv(spec.label, spec.value, left, y, spec.color or color_text, label_width)
		y = y + line_height
	end
	y = y + line_height
	write('BOOT STATUS', left, y, 0, color_section)
	y = y + line_height
	write(divider(width, left), left, y, 0, color_section)
	y = y + line_height

	local cart_present = peek(CART_ROM_BASE) == CART_ROM_MAGIC
	local elapsed = elapsed_seconds()
	local cursor = (math.floor(elapsed * 2) % 2 == 0) and '█' or ' '
	if cart_present then
		local remaining = boot_delay - elapsed
		if remaining < 0 then remaining = 0 end
		-- local status = 'AUTOBOOT IN ' .. string.format('%.1f', remaining) .. 'S'
		local cart_ready = peek(sys_cart_bootready) ~= 0
		local status = cart_ready and 'CART LOADED' or 'LOADING CART'
		local status_color = cart_ready and color_ok or color_accent
		write(status, left, y, 0, status_color)
		y = y + line_height
		local bar = build_progress_bar(elapsed / boot_delay, 40)
		write(bar .. cursor, left, y, 0, color_text)
	else
		write('NO CART DETECTED ' .. cursor, left, y, 0, color_warn)
	end
end
