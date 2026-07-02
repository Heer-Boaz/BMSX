
local imgdec<const> = {}

function imgdec.start(src, len, dst, cap)
	mem[0x08000128] = src
	mem[0x0800012c] = len
	mem[0x08000130] = dst
	mem[0x08000134] = cap
	mem[0x08000138] = 0x00000001
end

return imgdec
