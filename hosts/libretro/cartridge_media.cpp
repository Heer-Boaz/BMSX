#include "cartridge_media.h"

#include <type_traits>
#include <variant>

namespace bmsx {

CartridgeCardMedia cartridgeMediaFromPackage(const CartridgePackage& package) {
	CartridgeCardMedia media;
	for (const CartridgeDeviceConfig& device : package.manifest.hardware) {
		std::visit([&media, &package](const auto& concrete) {
			using Config = std::remove_cvref_t<decltype(concrete)>;
			if constexpr (std::is_same_v<Config, CartridgeRomDeviceConfig>) {
				media.rom = package.bytes;
			} else if constexpr (std::is_same_v<Config, CartridgeRamDeviceConfig>) {
				media.ramByteCount = concrete.bytes;
			} else {
				static_assert(std::is_same_v<Config, CartridgeMailboxDeviceConfig>);
				media.mailboxPresent = true;
			}
		}, device);
	}
	return media;
}

} // namespace bmsx
