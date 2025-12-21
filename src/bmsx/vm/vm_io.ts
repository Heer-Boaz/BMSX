export const IO_WRITE_PTR_ADDR = 0;
export const IO_BUFFER_BASE = 1;
export const IO_COMMAND_STRIDE = 4;
export const IO_ARG0_OFFSET = 1;
export const IO_ARG1_OFFSET = 2;
export const IO_ARG2_OFFSET = 3;

export const IO_CMD_PRINT = 1;

export const VM_IO_COMMAND_CAPACITY = 256;
export const VM_IO_MEMORY_SIZE = IO_BUFFER_BASE + IO_COMMAND_STRIDE * VM_IO_COMMAND_CAPACITY;
