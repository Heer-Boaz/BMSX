#include "machine/execution_address_space.h"

#include "machine/memory/map.h"
#include "machine/memory/memory.h"

#include <utility>

namespace bmsx {

std::optional<int> ExecutionAddressSpace::domainIdOnBus(u32 address) const {
	if (address < RAM_BASE) {
		return SYSTEM_EXECUTION_DOMAIN_ID;
	}
	if (address < CART_ROM_BASE) {
		return {};
	}
	return static_cast<int>(m_memory.cartridgeController().selectedSlot());
}

Blua32DecodedExecutionImage ExecutionAddressSpace::resolveSystemDomain() const {
	std::optional<Blua32DecodedExecutionImage> systemImage =
		resolveDomain(SYSTEM_EXECUTION_DOMAIN_ID);
	if (!systemImage) {
		throw BMSX_RUNTIME_ERROR("System ROM has no BLua32 executable image.");
	}
	return std::move(*systemImage);
}

std::optional<Blua32DecodedExecutionImage> ExecutionAddressSpace::resolveDomain(
	int executionDomainId
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
		BLUA32_BOOT_HEADER_SIZE,
		cartridgeSlot,
		headerBytes
	)) {
		return {};
	}
	const Blua32BootHeader boot = decodeBlua32BootHeader(
		std::span<const u8>(headerBytes.data(), headerBytes.size())
	);
	if (boot.imageOffset == 0u) {
		return {};
	}
	const u32 imageAddress = romBaseAddress + boot.imageOffset;
	Span<const u8> imageBytes;
	if (!m_memory.bindRomByteView(
		imageAddress,
		boot.imageByteCount,
		cartridgeSlot,
		imageBytes
	)) {
		throw BMSX_RUNTIME_ERROR("BLua32 image is not backed by the installed ROM.");
	}
	return Blua32DecodedExecutionImage{
		.layout = decodeBlua32Image(
			std::span<const u8>(imageBytes.data(), imageBytes.size()),
			imageAddress
		),
		.executionDomainId = executionDomainId,
		.startupFunctionAddress = boot.startupFunctionAddress,
		.irqFunctionAddress = boot.irqFunctionAddress,
		.exceptionFunctionAddress = boot.exceptionFunctionAddress,
	};
}

} // namespace bmsx
