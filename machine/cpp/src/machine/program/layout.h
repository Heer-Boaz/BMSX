#pragma once

#include "machine/cpu/instruction_format.h"
#include "machine/memory/map.h"
#include <cstdint>
#include <stdexcept>

namespace bmsx {

struct ProgramLayout {
	int systemBasePc = 0;
	int cartBasePc = 0;
};

constexpr int SYSTEM_BASE_PC = 0;
constexpr int CART_BASE_PC = static_cast<int>(CART_PROGRAM_START_OFFSET);
constexpr int CART_PROGRAM_VECTOR_PC = static_cast<int>(CART_PROGRAM_VECTOR_OFFSET);
constexpr uint32_t CART_PROGRAM_VECTOR_VALUE = CART_PROGRAM_START_ADDR;

inline ProgramLayout resolveProgramLayout(int systemCodeBytes, int systemBasePc = SYSTEM_BASE_PC, int cartBasePc = CART_BASE_PC) {
	if (systemBasePc < 0) {
		throw std::runtime_error("[ProgramLayout] System base PC must be >= 0.");
	}
	if (cartBasePc < 0) {
		throw std::runtime_error("[ProgramLayout] Cart base PC must be >= 0.");
	}
	if (systemBasePc % INSTRUCTION_BYTES != 0) {
		throw std::runtime_error("[ProgramLayout] System base PC must align to instruction bytes.");
	}
	if (cartBasePc % INSTRUCTION_BYTES != 0) {
		throw std::runtime_error("[ProgramLayout] Cart base PC must align to instruction bytes.");
	}
	if (cartBasePc <= CART_PROGRAM_VECTOR_PC) {
		throw std::runtime_error("[ProgramLayout] Cart base PC must leave room for the cart program vector.");
	}
	if (systemBasePc + systemCodeBytes > cartBasePc) {
		throw std::runtime_error("[ProgramLayout] System program overlaps cart base PC.");
	}
	return { systemBasePc, cartBasePc };
}

} // namespace bmsx
