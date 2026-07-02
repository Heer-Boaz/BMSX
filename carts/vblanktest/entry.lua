mem[0x08000084] = 0x00000001
require('cartlib/prelude')
local irq_flags_addr<const> = 0x08000108
local irq_mask_addr<const> = 0x0800010c
local irq_vblank<const> = 0x0010
local irq_apu<const> = 0x0200
local target<const> = 50
local vblank_count = 0
local fail_reason = nil
local done = false

local cycles_per_frame<const> = mem[0x08010368]
local vblank_cycles = 0
local full_frame_vblank = false

local resolve_vblank_cycles<const> = function()
	local screen_wh<const> = mem[0x08000088]
	local render_height<const> = screen_wh >> 16
	local active_display<const> = (cycles_per_frame // (render_height + 1)) * render_height
	return cycles_per_frame - active_display
end

local init_vblank_cycles<const> = function()
	vblank_cycles = resolve_vblank_cycles()
end

local fail<const> = function(msg)
	if fail_reason == nil then
		fail_reason = msg
	end
end

local wait_for_vblank_clear<const> = function()
	local remaining = cycles_per_frame
	while remaining > 0 do
		local status<const> = mem[0x08000144]
		if (status & 0x00000001) == 0 then
			return true
		end
		remaining = remaining - 1
	end
	return false
end

local wait_for_vblank_set<const> = function()
	local remaining = cycles_per_frame
	local saw_irq = false
	while remaining > 0 do
		local status<const> = mem[0x08000144]
		if (status & 0x00000001) ~= 0 then
			return true
		end
		local flags<const> = mem[irq_flags_addr]
		if (flags & irq_vblank) ~= 0 then
			saw_irq = true
		end
		remaining = remaining - 1
	end
	if saw_irq then
		fail("irq_vblank raised but VDP_STATUS_VBLANK never set")
	else
		fail("VDP_STATUS_VBLANK never set")
	end
	return false
end

on_irq(irq_vblank, function(_, flags)
	if (flags & irq_vblank) ~= 0 then
		vblank_count = vblank_count + 1

		local status<const> = mem[0x08000144]
		if (status & 0x00000001) == 0 then
			fail("irq_vblank seen but VDP_STATUS_VBLANK not set")
		end

	end
end)

function init()
	init_vblank_cycles()
	full_frame_vblank = vblank_cycles >= cycles_per_frame
end

function new_game()
end

local update_cart<const> = function()
	if done then
		return
	end
	if fail_reason ~= nil then
		print("VBLANK TEST FAIL: " .. fail_reason .. " (cycles_per_frame=" .. cycles_per_frame .. " vblank_cycles=" .. tostring(vblank_cycles) .. ")")
		done = true
		return
	end

	if full_frame_vblank then
		local status<const> = mem[0x08000144]
		if (status & 0x00000001) == 0 then
			fail("VDP_STATUS_VBLANK not set for full-frame VBLANK")
		end
	else
		local status<const> = mem[0x08000144]
		if (status & 0x00000001) ~= 0 then
			if not wait_for_vblank_clear() then
				fail("VDP_STATUS_VBLANK never cleared")
				return
			end
		end
		if not wait_for_vblank_set() then
			return
		end
	end

	if vblank_count >= target then
		print("VBLANK TEST PASS: " .. vblank_count .. " IRQs")
		done = true
	end
end

local draw_cart<const> = function()
end

init()
mem[irq_mask_addr] = irq_vblank | irq_apu
new_game()
mem[0x08000194] = 0x00000001
while true do
	local last_vblank_count<const> = vblank_count
	repeat
		halt_until_irq
	until vblank_count ~= last_vblank_count
	vdp_stream_cursor = 0x080c0000
	update_cart()
	draw_cart()
	vdp_stream_finish()
	do
		local used_bytes<const> = vdp_stream_cursor - 0x080c0000
		if used_bytes ~= 0 then
			mem[0x08000110] = 0x080c0000
			mem[0x08000114] = 0x0800007c
			mem[0x08000118] = used_bytes
			mem[0x0800011c] = 0x00000001
		end
	end
	mem[0x08000194] = 0x00000001
end
