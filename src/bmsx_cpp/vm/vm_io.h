#pragma once

namespace bmsx {

/**
 * VM I/O memory layout constants.
 *
 * The VM has a memory-mapped I/O region for communication between the
 * bytecode interpreter and the host system. This includes a command buffer
 * for operations like print, and system flags for cart presence/boot.
 */

// Write pointer for I/O command buffer (index of next command to write)
constexpr int IO_WRITE_PTR_ADDR = 0;

// Base address of the I/O command buffer
constexpr int IO_BUFFER_BASE = 1;

// Stride between commands in the buffer (command + args)
constexpr int IO_COMMAND_STRIDE = 4;

// Offset from command base to first argument
constexpr int IO_ARG0_OFFSET = 1;

// I/O command codes
constexpr int IO_CMD_PRINT = 1;

// Maximum number of commands that can be queued
constexpr int VM_IO_COMMAND_CAPACITY = 256;

// Base address for system flags (after command buffer)
constexpr int IO_SYS_BASE = IO_BUFFER_BASE + IO_COMMAND_STRIDE * VM_IO_COMMAND_CAPACITY;

// System flag: is a cartridge present?
constexpr int IO_SYS_CART_PRESENT = IO_SYS_BASE;

// System flag: should boot cartridge?
constexpr int IO_SYS_BOOT_CART = IO_SYS_BASE + 1;

// Number of system flag slots
constexpr int IO_SYS_SIZE = 2;

// Total size of VM I/O memory region
constexpr int VM_IO_MEMORY_SIZE = IO_SYS_BASE + IO_SYS_SIZE;

} // namespace bmsx
