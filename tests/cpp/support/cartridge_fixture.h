#pragma once

#include "machine/devices/cartridge/contracts.h"

#include <span>

namespace bmsx::test {

inline CartridgeSocketMediaPair cartridgeSlots() {
	return {};
}

inline CartridgeSocketMediaPair cartridgeSlots(std::span<const u8> slot0) {
	CartridgeSocketMediaPair media{};
	media[0] = CartridgeCardMedia{
		slot0,
		std::nullopt,
		false,
	};
	return media;
}

inline CartridgeSocketMediaPair cartridgeSlots(
	std::span<const u8> slot0,
	std::span<const u8> slot1
) {
	CartridgeSocketMediaPair media{};
	media[0] = CartridgeCardMedia{
		slot0,
		std::nullopt,
		false,
	};
	media[1] = CartridgeCardMedia{
		slot1,
		std::nullopt,
		false,
	};
	return media;
}

} // namespace bmsx::test
