local target<const> = 50
local vblank_count = 0
local fail_reason = nil
local done = false

local cycles_per_frame<const> = sys_max_cycles_per_frame
local vblank_cycles = 0
local full_frame_vblank = false

local resolve_vblank_cycles<const> = function()
	local render_height<const> = cart_manifest.machine.render_size.height
	if type(render_height) ~= 'number' or render_height <= 0 then
		return nil
	end
	local active_display<const> = (cycles_per_frame // (render_height + 1)) * render_height
	return cycles_per_frame - active_display
end

local init_vblank_cycles<const> = function()
	vblank_cycles = resolve_vblank_cycles()
	if vblank_cycles == nil then
		fail('machine.render_size.height is required and must be a positive integer')
	end
end

local fail<const> = function(msg)
	if fail_reason == nil then
		fail_reason = msg
	end
end

local wait_for_vblank_clear<const> = function()
	local remaining = cycles_per_frame
	while remaining > 0 do
		local status<const> = mem[sys_vdp_status]
		if (status & sys_vdp_status_vblank) == 0 then
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
		local status<const> = mem[sys_vdp_status]
		if (status & sys_vdp_status_vblank) ~= 0 then
			return true
		end
		local flags<const> = mem[sys_irq_flags]
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

		local status<const> = mem[sys_vdp_status]
		if (status & sys_vdp_status_vblank) == 0 then
			fail("irq_vblank seen but VDP_STATUS_VBLANK not set")
		end

		mem[sys_irq_ack] = irq_vblank
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
		local status<const> = mem[sys_vdp_status]
		if (status & sys_vdp_status_vblank) == 0 then
			fail("VDP_STATUS_VBLANK not set for full-frame VBLANK")
		end
	else
		local status<const> = mem[sys_vdp_status]
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

	if vblank_count >= target then
		print("VBLANK TEST PASS: " .. vblank_count .. " IRQs")
		done = true
	end
end

local draw_cart<const> = function()
end

local dispatch_irqs<const> = function()
	local flags<const> = mem[sys_irq_flags]
	if flags ~= 0 then
		irq(flags)
	end
	return flags
end

mem[sys_inp_ctrl] = inp_ctrl_arm
while true do
	local flags
	repeat
		halt_until_irq
		flags = dispatch_irqs()
	until (flags & irq_vblank) ~= 0
	vdp_stream_cursor = sys_vdp_stream_base
	update_cart()
	draw_cart()
	vdp_stream_finish()
	do
		local used_bytes<const> = vdp_stream_cursor - sys_vdp_stream_base
		if used_bytes ~= 0 then
			mem[sys_dma_src] = sys_vdp_stream_base
			mem[sys_dma_dst] = sys_vdp_fifo
			mem[sys_dma_len] = used_bytes
			mem[sys_dma_ctrl] = dma_ctrl_start
		end
	end
	mem[sys_inp_ctrl] = inp_ctrl_arm
end
