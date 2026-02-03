local TARGET = 50
local vblank_count = 0
local fail_reason = nil
local done = false

local cycles_per_frame = sys_max_cycles_per_frame
local vblank_cycles = cart_manifest.machine.specs.vdp.vblank_cycles
local full_frame_vblank = vblank_cycles >= cycles_per_frame

local function fail(msg)
	if fail_reason == nil then
		fail_reason = msg
	end
end

local function wait_for_vblank_clear()
	local remaining = cycles_per_frame
	while remaining > 0 do
		local status = peek(sys_vdp_status)
		if (status & sys_vdp_status_vblank) == 0 then
			return true
		end
		remaining = remaining - 1
	end
	return false
end

local function wait_for_vblank_set()
	local remaining = cycles_per_frame
	local saw_irq = false
	while remaining > 0 do
		local status = peek(sys_vdp_status)
		if (status & sys_vdp_status_vblank) ~= 0 then
			return true
		end
		local flags = peek(sys_irq_flags)
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

on_irq(function(flags)
	if (flags & irq_vblank) ~= 0 then
		vblank_count = vblank_count + 1

		local status = peek(sys_vdp_status)
		if (status & sys_vdp_status_vblank) == 0 then
			fail("irq_vblank seen but VDP_STATUS_VBLANK not set")
		end

		poke(sys_irq_ack, irq_vblank)
	end
end)

function init()
end

function new_game()
end

function update()
	if done then
		return
	end
	if fail_reason ~= nil then
		print("VBLANK TEST FAIL: " .. fail_reason .. " (cycles_per_frame=" .. cycles_per_frame .. " vblank_cycles=" .. vblank_cycles .. ")")
		done = true
		return
	end

	if full_frame_vblank then
		local status = peek(sys_vdp_status)
		if (status & sys_vdp_status_vblank) == 0 then
			fail("VDP_STATUS_VBLANK not set for full-frame VBLANK")
		end
	else
		local status = peek(sys_vdp_status)
		if (status & sys_vdp_status_vblank) ~= 0 then
			if not wait_for_vblank_clear() then
				fail("VDP_STATUS_VBLANK never cleared")
				return
			end
		end
		if not wait_for_vblank_set() then
			return
		end
	end

	if vblank_count >= TARGET then
		print("VBLANK TEST PASS: " .. vblank_count .. " IRQs")
		done = true
	end
end

function draw()
end
