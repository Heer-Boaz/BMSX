local imgdec<const> = {}

local sys_img_src<const> = 0x0800012c
local sys_img_len<const> = 0x08000130
local sys_img_dst<const> = 0x08000134
local sys_img_cap<const> = 0x08000138
local sys_img_ctrl<const> = 0x0800013c

local img_ctrl_start<const> = 0x00000001

function imgdec.start(src, len, dst, cap)
	mem[sys_img_src] = src
	mem[sys_img_len] = len
	mem[sys_img_dst] = dst
	mem[sys_img_cap] = cap
	mem[sys_img_ctrl] = img_ctrl_start
end

return imgdec
