#include "machine/cpu/execution_loader.h"

#include "machine/memory/map.h"
#include "machine/memory/memory.h"

#include <span>
#include <utility>

namespace bmsx {

ExecutionLoader::ExecutionLoader(Memory& memory)
	: m_memory(memory) {}

ExecutionLoader::~ExecutionLoader() = default;

void ExecutionLoader::mountExecutableMedia(CPU& cpu) {
	std::optional<Blua32MediaImage> systemMedia =
		decodeExecutableMedia(SYSTEM_ROM_BASE, -1);
	if (!systemMedia) {
		throw BMSX_RUNTIME_ERROR("System ROM has no BLua32 executable image.");
	}

	cpu.beginExecutionImageMount();
	std::unique_ptr<Blua32ExecutionImage> systemImage =
		cpu.activateExecutableImage(std::move(*systemMedia));
	cpu.setSystemExecutionImage(*systemImage);
	m_systemImage = std::move(systemImage);
	m_cartridgeMediaImages[0].reset();
	m_cartridgeMediaImages[1].reset();
	m_cartridgeMediaDecoded[0] = false;
	m_cartridgeMediaDecoded[1] = false;
	m_cartridgeImages[0].reset();
	m_cartridgeImages[1].reset();
	m_loadedImages[0] = m_systemImage.get();
	m_loadedImages[1] = nullptr;
	m_loadedImages[2] = nullptr;
}

u32 ExecutionLoader::systemStartupFunctionAddress() const {
	return m_systemImage->boot.startupFunctionAddress;
}

Blua32RuntimeFunction* ExecutionLoader::functionRecordOnSelectedBus(
	CPU& cpu,
	u32 address
) {
	if (address >= CART_ROM_BASE) {
		Blua32ExecutionImage* image = cartridgeImageForExecution(
			cpu,
			m_memory.cartridgeController().selectedSlot()
		);
		return image ? cpu.functionRecordInImage(*image, address) : nullptr;
	}
	if (address >= RAM_BASE) {
		return nullptr;
	}
	return cpu.functionRecordInImage(*m_systemImage, address);
}

Blua32ExecutionImage* ExecutionLoader::executionImageForSlot(CPU& cpu, int slot) {
	return cartridgeImageForExecution(cpu, static_cast<size_t>(slot));
}

const std::array<Blua32ExecutionImage*, 3>& ExecutionLoader::loadedExecutionImages() const {
	return m_loadedImages;
}

std::optional<Blua32MediaImage> ExecutionLoader::decodeExecutableMedia(
	u32 romBaseAddress,
	int cartridgeSlot
) {
	Span<const u8> headerBytes;
	if (!m_memory.bindRomByteView(
			romBaseAddress,
			BLUA32_BOOT_HEADER_SIZE,
			cartridgeSlot < 0 ? 0u : static_cast<u32>(cartridgeSlot),
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
			cartridgeSlot < 0 ? 0u : static_cast<u32>(cartridgeSlot),
			imageBytes
	)) {
		throw BMSX_RUNTIME_ERROR("BLua32 image is not backed by the installed ROM.");
	}
	return Blua32MediaImage{
		.layout = decodeBlua32Image(
			std::span<const u8>(imageBytes.data(), imageBytes.size()),
			imageAddress
		),
		.boot = boot,
		.cartridgeSlot = cartridgeSlot,
	};
}

Blua32ExecutionImage* ExecutionLoader::cartridgeImageForExecution(
	CPU& cpu,
	size_t slot
) {
	std::unique_ptr<Blua32ExecutionImage>& image = m_cartridgeImages[slot];
	if (image) {
		return image.get();
	}
	std::optional<Blua32MediaImage>& media = m_cartridgeMediaImages[slot];
	if (!m_cartridgeMediaDecoded[slot]) {
		media = decodeExecutableMedia(CART_ROM_BASE, static_cast<int>(slot));
		m_cartridgeMediaDecoded[slot] = true;
	}
	if (!media) {
		return nullptr;
	}
	image = cpu.activateExecutableImage(std::move(*media));
	media.reset();
	m_loadedImages[slot + 1] = image.get();
	return image.get();
}

} // namespace bmsx
