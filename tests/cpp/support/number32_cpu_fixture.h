#pragma once

#include "machine/cpu/cpu.h"
#include "machine/devices/irq/controller.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "blua32_test_rom.h"
#include "cartridge_fixture.h"

namespace bmsx::test {
// This fixture owns actual physical ROM backing, not just image bytes. A full
// final page lets cold precompilation exercise even four-instruction programs.
struct Number32Machine {
	Blua32TestRom rom;
	Memory memory;
	IrqController irq;
	ExecutionAddressSpace addresses;
	CPU cpu;
	Number32Machine(const Blua32TestImage& image, bool native = true)
		: rom([&] {
			  auto encoded = encodeBlua32TestRom(RomImageDomain::System, image);
			  encoded.bytes.resize((encoded.bytes.size() + MAPPED_PAGE_BYTE_MASK) & ~size_t{MAPPED_PAGE_BYTE_MASK});
			  return encoded;
		  }()),
		  memory(MemoryInit{rom.bytes, cartridgeSlots()}, PSX_MACHINE_SPEC.ramBytes), irq(memory), addresses(memory),
		  cpu(memory, irq, addresses) {
		cpu.reset();
#if defined(BMSX_ENABLE_NATIVE_BLOCKS)
		if (native)
			cpu.prepareSystemNativeCode();
		else
			cpu.setExecutionHook(
				{[](void*, ExecutionDomainId, u32) { return false; }, nullptr, ALL_EXECUTION_DOMAINS_MASK, 0u});
#else
		(void)native;
#endif
	}
};
} // namespace bmsx::test
