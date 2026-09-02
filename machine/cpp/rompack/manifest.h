#pragma once

#include "common/primitives.h"
#include "rompack/format.h"

#include <optional>
#include <span>
#include <string>
#include <variant>
#include <vector>

namespace bmsx {

struct CartridgeRomDeviceConfig {};

struct CartridgeRamDeviceConfig {
	u32 bytes = 0u;
};

struct CartridgeMailboxDeviceConfig {};

using CartridgeDeviceConfig = std::variant<
	CartridgeRomDeviceConfig,
	CartridgeRamDeviceConfig,
	CartridgeMailboxDeviceConfig
>;

struct CartManifest {
	std::optional<std::string> title;
	std::vector<CartridgeDeviceConfig> hardware;
};

CartManifest decodeCartManifest(
	std::span<const u8> packageBytes,
	const CartRomHeader& header
);

} // namespace bmsx
