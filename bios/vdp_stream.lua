local vdp_stream<const> = {}

local stream_capacity_bytes<const> = sys_vdp_stream_capacity * sys_vdp_arg_stride
local packet_end<const> = 0

vdp_stream_cursor = sys_vdp_stream_base
vdp_stream_limit = sys_vdp_stream_base + stream_capacity_bytes

function vdp_stream.claim(count)
	local base<const> = vdp_stream_cursor
	local bytes<const> = count * sys_vdp_arg_stride
	local next<const> = base + bytes
	if next > vdp_stream_limit then
		error('vdp_stream overflow (' .. tostring(next - sys_vdp_stream_base) .. ' > ' .. tostring(stream_capacity_bytes) .. ')')
	end
	vdp_stream_cursor = next
	return base
end

function vdp_stream.reset()
	vdp_stream_cursor = sys_vdp_stream_base
end

function vdp_stream.terminate()
	if vdp_stream_cursor ~= sys_vdp_stream_base then
		mem[vdp_stream.claim(1)] = packet_end
	end
end

function vdp_stream.submit_cpu_fifo()
	mem[vdp_stream.claim(1)] = packet_end
	local read_ptr = sys_vdp_stream_base
	while read_ptr < vdp_stream_cursor do
		mem[sys_vdp_fifo] = mem[read_ptr]
		read_ptr = read_ptr + sys_vdp_arg_stride
	end
	mem[sys_vdp_fifo_ctrl] = sys_vdp_fifo_ctrl_seal
	vdp_stream_cursor = sys_vdp_stream_base
end

return vdp_stream
