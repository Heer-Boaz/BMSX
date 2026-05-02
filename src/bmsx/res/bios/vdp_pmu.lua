local vdp_pmu<const> = {}

function vdp_pmu.write_bank(bank, x, y, scale_x, scale_y, control)
	mem[sys_vdp_pmu_bank] = bank
	mem[sys_vdp_pmu_x] = x
	mem[sys_vdp_pmu_y] = y
	mem[sys_vdp_pmu_scale_x] = scale_x
	mem[sys_vdp_pmu_scale_y] = scale_y
	mem[sys_vdp_pmu_ctrl] = control
end

return vdp_pmu
