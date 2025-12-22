export const IO_WRITE_PTR_ADDR = 0;
export const IO_BUFFER_BASE = 1;
export const IO_COMMAND_STRIDE = 4;
export const IO_ARG0_OFFSET = 1;

export const IO_CMD_PRINT = 1;

export const VM_IO_COMMAND_CAPACITY = 256;
export const IO_SYS_BASE = IO_BUFFER_BASE + IO_COMMAND_STRIDE * VM_IO_COMMAND_CAPACITY;
export const IO_SYS_CART_PRESENT = IO_SYS_BASE;
export const IO_SYS_BOOT_CART = IO_SYS_BASE + 1;
export const IO_SYS_SIZE = 2;
export const VM_IO_MEMORY_SIZE = IO_SYS_BASE + IO_SYS_SIZE;
