-- bootrom.lua
-- BMSX system boot screen

local BOOT_DELAY = 2.0
local FONT_WIDTH = 6
local LINE_HEIGHT = 8

local COLOR_BG = 4
local COLOR_HEADER_BG = 7
local COLOR_HEADER_TEXT = 1
local COLOR_TEXT = 15
local COLOR_MUTED = 14
local COLOR_ACCENT = 11
local COLOR_WARN = 8

local boot_start = os.clock()
local boot_requested = false

local function now_seconds()
	return os.clock()
end

local function elapsed_seconds()
	return now_seconds() - boot_start
end

local function text_width(text)
	return #text * FONT_WIDTH
end

local function write_line(text, x, y, color)
	write(text, x, y, 0, color)
end

local function center_x(text, width)
	return math.floor((width - text_width(text)) / 2)
end

local function build_info()
	local cart_manifest = $.assets.manifest
	local cart_vm = cart_manifest.vm
	local engine_manifest = $.engine_layer.index.manifest
	local engine_vm = engine_manifest.vm

	local cart_title = cart_manifest.title or "<untitled>"
	local cart_short = cart_manifest.short_name or cart_manifest.rom_name or "<unknown>"
	local cart_rom = cart_manifest.rom_name or "<unknown>"
	local cart_ns = cart_vm.namespace or "<default>"
	local cart_view = cart_vm.viewport or { width = display_width(), height = display_height() }
	local cart_view_label = tostring(cart_view.width) .. "x" .. tostring(cart_view.height)
	local cart_canon = cart_vm.canonicalization or "<default>"

	local engine_title = engine_manifest.title or "<engine>"
	local engine_rom = engine_manifest.rom_name or "<unknown>"
	local engine_ns = engine_vm.namespace or "<default>"

	return {
		engine_title = engine_title,
		engine_rom = engine_rom,
		engine_ns = engine_ns,
		cart_title = cart_title,
		cart_short = cart_short,
		cart_rom = cart_rom,
		cart_ns = cart_ns,
		cart_view = cart_view_label,
		cart_canon = cart_canon,
		root = $.assets.project_root_path or "<unknown>",
	}
end

local function divider(width, left)
	local available = width - (left * 2)
	local slots = math.floor(available / FONT_WIDTH)
	if slots < 8 then
		slots = 8
	end
	return string.rep("-", slots)
end

local function build_progress_bar(progress, width)
	local clamped = progress
	if clamped < 0 then clamped = 0 end
	if clamped > 1 then clamped = 1 end
	local filled = math.floor(width * clamped + 0.5)
	if filled < 0 then filled = 0 end
	if filled > width then filled = width end
	return "[" .. string.rep("#", filled) .. string.rep("-", width - filled) .. "]"
end

function init()
	boot_start = now_seconds()
	boot_requested = false
end

function new_game()
end

function update(_dt)
	local cart_present = peek(SYS_CART_PRESENT) == 1
	if cart_present and not boot_requested and elapsed_seconds() >= BOOT_DELAY then
		boot_requested = true
		poke(SYS_BOOT_CART, 1)
	end
end

function draw()
	local width = display_width()
	local height = display_height()
	local left = 10
	local top = 24

	cls(COLOR_BG)
	put_rectfill(0, 0, width - 1, 15, 0, COLOR_HEADER_BG)
	write_line("BMSX SYSTEM ROM", 8, 4, COLOR_HEADER_TEXT)

	local info = build_info()
	local y = top
	write_line(divider(width, left), left, y, COLOR_ACCENT)
	y = y + LINE_HEIGHT
	write_line("ENGINE NAME: " .. info.engine_title, left, y, COLOR_TEXT)
	y = y + LINE_HEIGHT
	write_line("ENGINE ROM : " .. info.engine_rom, left, y, COLOR_TEXT)
	y = y + LINE_HEIGHT
	write_line("ENGINE NS  : " .. info.engine_ns, left, y, COLOR_TEXT)
	y = y + LINE_HEIGHT
	write_line(divider(width, left), left, y, COLOR_ACCENT)
	y = y + LINE_HEIGHT
	write_line("CART ROM   : " .. info.cart_rom, left, y, COLOR_TEXT)
	y = y + LINE_HEIGHT
	write_line("CART NAME  : " .. info.cart_title, left, y, COLOR_TEXT)
	y = y + LINE_HEIGHT
	write_line("SHORT NAME : " .. info.cart_short, left, y, COLOR_TEXT)
	y = y + LINE_HEIGHT
	write_line("NAMESPACE  : " .. info.cart_ns, left, y, COLOR_TEXT)
	y = y + LINE_HEIGHT
	write_line("VIEWPORT   : " .. info.cart_view, left, y, COLOR_TEXT)
	y = y + LINE_HEIGHT
	write_line("CANON      : " .. info.cart_canon, left, y, COLOR_TEXT)
	y = y + LINE_HEIGHT
	write_line("ROOT       : " .. info.root, left, y, COLOR_MUTED)
	y = y + LINE_HEIGHT
	write_line(divider(width, left), left, y, COLOR_ACCENT)
	y = y + LINE_HEIGHT

	local cart_present = peek(SYS_CART_PRESENT) == 1
	local elapsed = elapsed_seconds()
	local cursor = (math.floor(elapsed * 2) % 2 == 0) and "_" or " "
	if cart_present then
		local remaining = BOOT_DELAY - elapsed
		if remaining < 0 then remaining = 0 end
		local status = "AUTOBOOT IN " .. string.format("%.1f", remaining) .. "S"
		write_line("STATUS     : " .. status, left, y, COLOR_TEXT)
		y = y + LINE_HEIGHT
		local bar = build_progress_bar(elapsed / BOOT_DELAY, 20)
		-- write_line("PROGRESS   : " .. bar .. " " .. cursor, left, y, COLOR_TEXT)
	else
		write_line("STATUS     : INSERT CARTRIDGE" .. " " .. cursor, left, y, COLOR_WARN)
	end
end
