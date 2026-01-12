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
local color_warn = 8

local boot_start = os.clock()
local boot_requested = false

local function elapsed_seconds()
	return os.clock() - boot_start
end

local function center_x(text, width)
	return math.floor((width - (#text * font_width)) / 2)
end

local function build_info()
	local cart = cart_manifest
	local cart_vm = cart.vm
	local engine = engine_manifest
	local engine_vm = engine.vm

	local cart_title = cart.title or '--'
	local cart_short = cart.short_name or cart.rom_name or '--'
	local cart_rom = cart.rom_name or '--'
	local cart_ns = cart_vm.namespace or '--'
	local cart_view = cart_vm.viewport or { width = display_width(), height = display_height() }
	local cart_view_label = tostring(cart_view.width) .. 'x' .. tostring(cart_view.height)
	local cart_canon = cart_vm.canonicalization or '--'
	local cart_entry = cart.lua.entry_path
	local cart_input_label = 'DEFAULT'
	local cart_input_count = 1
	if cart_manifest.input then
		cart_input_label = 'CUSTOM'
		cart_input_count = 0
		for _ in pairs(cart_manifest.input) do
			cart_input_count = cart_input_count + 1
		end
		if cart_input_count == 0 then
			cart_input_count = 1
		end
	end
	local cart_input = cart_input_label .. ' (' .. tostring(cart_input_count) .. 'P)'

	local engine_title = engine.title or '--'
	local engine_rom = engine.rom_name or '--'
	local engine_ns = engine_vm.namespace or '--'
	local engine_view = engine_vm.viewport or { width = display_width(), height = display_height() }
	local engine_view_label = tostring(engine_view.width) .. 'x' .. tostring(engine_view.height)
	local engine_canon = engine_vm.canonicalization or '--'
	local engine_entry = engine.lua.entry_path

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
		root = assets.project_root_path or '--',
	}
end

local function divider(width, left)
	local available = width - (left * 2)
	local slots = math.floor(available / font_width)
	if slots < 8 then
		slots = 8
	end
	return string.rep('-', slots)
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
end

function new_game()
end

function update(_dt)
	local cart_present_and_ready = peek(sys_cart_magic_addr) == sys_cart_magic and peek(sys_cart_bootready) == 1

	if cart_present_and_ready and not boot_requested and elapsed_seconds() >= boot_delay then
		boot_requested = true
		poke(sys_boot_cart, 1)
	end
end

function draw()
	local width = display_width()
	local left = 10
	local top = 24

	cls(color_bg)
	put_rectfill(0, 0, width - 1, 15, 0, color_header_bg)
	write('BMSX BIOS', center_x('BMSX BIOS', width), 4, 0, color_header_text)

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

	local cart_present = peek(sys_cart_magic_addr) == sys_cart_magic
	local elapsed = elapsed_seconds()
	local cursor = (math.floor(elapsed * 2) % 2 == 0) and '_' or ' '
	if cart_present then
		local remaining = boot_delay - elapsed
		if remaining < 0 then remaining = 0 end
		-- local status = 'AUTOBOOT IN ' .. string.format('%.1f', remaining) .. 'S'
		local status = peek(sys_cart_bootready) == 0 and 'LOADING CART' or 'CART LOADED'
		write('STATUS     : ' .. status, left, y, 0, color_text)
		y = y + line_height
		local bar = build_progress_bar(elapsed / boot_delay, 20)
		write('BOOT STATUS : ' .. bar .. ' ' .. cursor, left, y, 0, color_text)
		-- write('BOOTING IN : ' .. bar .. ' ' .. cursor, left, y, 0, color_text)
	else
		write('STATUS     : NO CART DETECTED' .. ' ' .. cursor, left, y, 0, color_warn)
	end
end
