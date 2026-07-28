#include "machine/execution_address_space.h"

#include "common/endian.h"
#include "spec/bmsx/memory_map.h"
#include "spec/bmsx/rom_header.h"
#include "machine/memory/memory.h"

namespace bmsx {

std::optional<ExecutionDomainId> ExecutionAddressSpace::domainIdOnBus(u32 address) const {
	if (address < RAM_BASE) {
		return SYSTEM_EXECUTION_DOMAIN_ID;
	}
	if (address < CART_ROM_BASE) {
		return {};
	}
	return static_cast<ExecutionDomainId>(m_memory.cartridgeController().selectedSlot());
}

void ExecutionAddressSpace::bindReadOnlyView(
	ExecutionDomainId executionDomainId,
	u32 address,
	size_t byteCount,
	Span<const u8>& out
) const {
	const u32 cartridgeSlot = executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID
		? 0u
		: static_cast<u32>(executionDomainId);
	if (!m_memory.bindRomByteView(address, byteCount, cartridgeSlot, out)) {
		throw BMSX_RUNTIME_ERROR("BLua32 execution read is not backed by the installed ROM.");
	}
}

Blua32ExecutionBoot ExecutionAddressSpace::resolveSystemDomain() const {
	std::optional<Blua32ExecutionBoot> systemImage =
		resolveDomain(SYSTEM_EXECUTION_DOMAIN_ID);
	if (!systemImage) {
		throw BMSX_RUNTIME_ERROR("System ROM has no BLua32 executable image.");
	}
	return *systemImage;
}

std::optional<Blua32ExecutionBoot> ExecutionAddressSpace::resolveDomain(
	ExecutionDomainId executionDomainId
) const {
	const u32 romBaseAddress = executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID
		? SYSTEM_ROM_BASE
		: CART_ROM_BASE;
	const u32 cartridgeSlot = executionDomainId == SYSTEM_EXECUTION_DOMAIN_ID
		? 0u
		: static_cast<u32>(executionDomainId);
	Span<const u8> headerBytes;
	if (!m_memory.bindRomByteView(
		romBaseAddress,
		BMSX_ROM_BOOT_HEADER_SIZE,
		cartridgeSlot,
		headerBytes
	)) {
		return {};
	}
	const u32 imageOffset = readLE32(
		headerBytes.data() + BMSX_ROM_HEADER_BLUA32_IMAGE_OFFSET
	);
	if (imageOffset == 0u) {
		return {};
	}
	return Blua32ExecutionBoot{
		.imageAddress = romBaseAddress + imageOffset,
		.executionDomainId = executionDomainId,
		.startupFunctionAddress = readLE32(
			headerBytes.data() + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET
		),
		.irqFunctionAddress = readLE32(
			headerBytes.data() + BMSX_ROM_HEADER_BLUA32_IRQ_FUNCTION_ADDRESS_OFFSET
		),
		.exceptionFunctionAddress = readLE32(
			headerBytes.data() + BMSX_ROM_HEADER_BLUA32_EXCEPTION_FUNCTION_ADDRESS_OFFSET
		),
	};
}

} // namespace bmsx
