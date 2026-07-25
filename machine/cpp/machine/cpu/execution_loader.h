#pragma once

#include "machine/cpu/cpu.h"

#include <array>
#include <memory>
#include <optional>

namespace bmsx {

class Memory;

class ExecutionLoader final : public ExecutionAddressResolver {
public:
	explicit ExecutionLoader(Memory& memory);
	~ExecutionLoader() override;

	void mountExecutableMedia(CPU& cpu);
	u32 systemStartupFunctionAddress() const;

	Blua32RuntimeFunction* functionRecordOnSelectedBus(CPU& cpu, u32 address) override;
	Blua32ExecutionImage* executionImageForSlot(CPU& cpu, int slot) override;
	const std::array<Blua32ExecutionImage*, 3>& loadedExecutionImages() const override;

private:
	std::optional<Blua32MediaImage> decodeExecutableMedia(u32 romBaseAddress, int cartridgeSlot);
	Blua32ExecutionImage* cartridgeImageForExecution(CPU& cpu, size_t slot);

	Memory& m_memory;
	std::unique_ptr<Blua32ExecutionImage> m_systemImage;
	std::array<std::optional<Blua32MediaImage>, 2> m_cartridgeMediaImages;
	std::array<bool, 2> m_cartridgeMediaDecoded{false, false};
	std::array<std::unique_ptr<Blua32ExecutionImage>, 2> m_cartridgeImages;
	std::array<Blua32ExecutionImage*, 3> m_loadedImages{nullptr, nullptr, nullptr};
};

} // namespace bmsx
