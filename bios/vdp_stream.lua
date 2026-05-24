local vdp_stream<const> = {}

vdp_stream_cursor = sys_vdp_stream_base

function vdp_stream.claim(count)
	local base<const> = vdp_stream_cursor
	vdp_stream_cursor = base + (count * sys_vdp_arg_stride)
	return base
end

function vdp_stream.reset()
	vdp_stream_cursor = sys_vdp_stream_base
end

function vdp_stream.terminate()
	if vdp_stream_cursor ~= sys_vdp_stream_base then
		mem[vdp_stream.claim(1)] = sys_vdp_pkt_end
	end
end

function vdp_stream.submit_cpu_fifo()
	mem[vdp_stream.claim(1)] = sys_vdp_pkt_end
	local read_ptr = sys_vdp_stream_base
	while read_ptr < vdp_stream_cursor do
		mem[sys_vdp_fifo] = mem[read_ptr]
		read_ptr = read_ptr + sys_vdp_arg_stride
	end
	mem[sys_vdp_fifo_ctrl] = sys_vdp_fifo_ctrl_seal
	vdp_stream_cursor = sys_vdp_stream_base
end

return vdp_stream
