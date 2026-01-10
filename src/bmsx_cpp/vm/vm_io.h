#pragma once

#include "memory_map.h"

namespace bmsx {

/**
 * VM I/O memory layout constants.
 *
 * The VM has a memory-mapped I/O region for communication between the
 * bytecode interpreter and the host system. This includes a command buffer
 * for operations like print, and system flags for cart boot.
 */

// Write pointer for I/O command buffer (index of next command to write)
constexpr int IO_WRITE_PTR_INDEX = 0;

// Base address of the I/O command buffer
constexpr int IO_BUFFER_BASE_INDEX = 1;

// Stride between commands in the buffer (command + args)
constexpr int IO_COMMAND_STRIDE_WORDS = 4;

// Offset from command base to first argument
constexpr int IO_ARG0_OFFSET_WORDS = 1;

// I/O command codes
constexpr int IO_CMD_PRINT = 1;

// Maximum number of commands that can be queued
constexpr int VM_IO_COMMAND_CAPACITY = 256;

// Base address for system flags (after command buffer)
constexpr int IO_SYS_BASE_INDEX = IO_BUFFER_BASE_INDEX + IO_COMMAND_STRIDE_WORDS * VM_IO_COMMAND_CAPACITY;

// System flag: should boot cartridge?
constexpr int IO_SYS_BOOT_CART_INDEX = IO_SYS_BASE_INDEX;
constexpr int IO_SYS_CART_BOOTREADY_INDEX = IO_SYS_BASE_INDEX + 1;

// Number of system flag slots
constexpr int IO_SYS_SIZE = 2;
constexpr int VM_IO_SLOT_COUNT = IO_SYS_BASE_INDEX + IO_SYS_SIZE;

constexpr uint32_t IO_WRITE_PTR_ADDR = IO_BASE + IO_WRITE_PTR_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_BUFFER_BASE = IO_BASE + IO_BUFFER_BASE_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_COMMAND_STRIDE = IO_COMMAND_STRIDE_WORDS * IO_WORD_SIZE;
constexpr uint32_t IO_ARG0_OFFSET = IO_ARG0_OFFSET_WORDS * IO_WORD_SIZE;
constexpr uint32_t IO_ARG_STRIDE = IO_WORD_SIZE;

constexpr uint32_t IO_SYS_BASE = IO_BASE + IO_SYS_BASE_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_SYS_BOOT_CART = IO_BASE + IO_SYS_BOOT_CART_INDEX * IO_WORD_SIZE;
constexpr uint32_t IO_SYS_CART_BOOTREADY = IO_BASE + IO_SYS_CART_BOOTREADY_INDEX * IO_WORD_SIZE;

} // namespace bmsx
