import {
	BLUA32_IMAGE_BSS_ADDRESS_OFFSET, BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET,
	BLUA32_IMAGE_DATA_ADDRESS_OFFSET, BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET,
} from '../../machine/ts/spec/blua32/image_format';
import { CPU_STATUS_INHIBIT_RESET } from '../../machine/ts/spec/blua32/cop0';
import {
	IO_CART0_ROM_BYTE_COUNT, IO_CART1_ROM_BYTE_COUNT, IO_CART_SELECT, IO_SYS_CONTROL,
	IO_SYS_ROM_BYTE_COUNT, SYS_CONTROL_SUPERVISOR_FAULT,
} from '../../machine/ts/spec/bmsx/io';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET, BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';

// The mounted cartridge has already been selected by the fixture. Exercise
// the same guest floor and operand preparation as the stock BIOS launcher.
export const MANAGED_CART_PREPARE = `
local heap_floor<const> = require('kernel/heap_floor')
local image_bind<const> = require('kernel/system_image_bind')
local image<const> = ${CART_ROM_BASE} + mem32le[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET}]
local data_end<const> = mem32le[image + ${BLUA32_IMAGE_DATA_ADDRESS_OFFSET}] + mem32le[image + ${BLUA32_IMAGE_DATA_BYTE_COUNT_OFFSET}]
local bss_end<const> = mem32le[image + ${BLUA32_IMAGE_BSS_ADDRESS_OFFSET}] + mem32le[image + ${BLUA32_IMAGE_BSS_BYTE_COUNT_OFFSET}]
cop0.status = cop0.status | ${CPU_STATUS_INHIBIT_RESET}
local end_address<const> = heap_floor.admit_static_end(data_end > bss_end and data_end or bss_end)
local admitted = false
if end_address ~= 0 then
	cop0.ram_end = end_address
	admitted = image_bind.bind_cartridge(mem[${IO_CART_SELECT}], image, mem[${IO_SYS_ROM_BYTE_COUNT}],
		mem[${IO_CART0_ROM_BYTE_COUNT}], mem[${IO_CART1_ROM_BYTE_COUNT}]) == 0
end
cop0.status = cop0.status & ~${CPU_STATUS_INHIBIT_RESET}
if not admitted then
	mem[${IO_SYS_CONTROL}] = ${SYS_CONTROL_SUPERVISOR_FAULT}
	while true do halt_until_irq end
end
`;

export const CART_EXEC = `
cop0.exec = mem32le[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]
`;

export const MANAGED_CART_LAUNCH = MANAGED_CART_PREPARE + CART_EXEC;
