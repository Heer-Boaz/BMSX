#include "rompack/manifest.h"

#include "common/serializer/binencoder.h"
#include "spec/bmsx/memory_map.h"

#include <array>
#include <string>
#include <string_view>

namespace bmsx {
namespace {

const BinObject& requireObject(const BinValue& value, std::string_view label) {
	if (!value.isObject()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be an object.");
	}
	return value.asObject();
}

const BinValue& requireField(
	const BinObject& object,
	const char* key,
	std::string_view label
) {
	const auto found = object.find(key);
	if (found == object.end()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + "." + key + " is required.");
	}
	return found->second;
}

void requireKnownKeys(
	const BinObject& object,
	std::span<const std::string_view> allowed,
	std::string_view label
) {
	for (const auto& [key, value] : object) {
		(void)value;
		bool known = false;
		for (const std::string_view allowedKey : allowed) {
			if (key == allowedKey) {
				known = true;
				break;
			}
		}
		if (!known) {
			throw BMSX_RUNTIME_ERROR(
				std::string(label) + "." + key
					+ " is not part of the cartridge manifest schema."
			);
		}
	}
}

} // namespace

CartManifest decodeCartManifest(
	std::span<const u8> packageBytes,
	const CartRomHeader& header
) {
	if (header.manifestLength == 0u) {
		throw BMSX_RUNTIME_ERROR(
			"Cartridge package header is missing its manifest payload."
		);
	}
	const BinValue decoded = decodeBinary(
		packageBytes.data() + header.manifestOffset,
		header.manifestLength
	);
	const BinObject& root = requireObject(decoded, "Cartridge package manifest");
	constexpr std::array<std::string_view, 2> ROOT_KEYS{{ "title", "hardware" }};
	requireKnownKeys(root, ROOT_KEYS, "Cartridge package manifest");

	CartManifest manifest;
	const auto title = root.find("title");
	if (title != root.end()) {
		if (!title->second.isString()) {
			throw BMSX_RUNTIME_ERROR("Cartridge package manifest.title must be a string.");
		}
		manifest.title = title->second.asString();
	}
	const BinValue& hardwareValue = requireField(
		root,
		"hardware",
		"Cartridge package manifest"
	);
	if (!hardwareValue.isArray()) {
		throw BMSX_RUNTIME_ERROR("Cartridge package manifest.hardware must be an array.");
	}
	bool romPresent = false;
	bool ramPresent = false;
	bool mailboxPresent = false;
	const BinArray& hardware = hardwareValue.asArray();
	manifest.hardware.reserve(hardware.size());
	for (size_t index = 0; index < hardware.size(); ++index) {
		const std::string label = "Cartridge package manifest.hardware["
			+ std::to_string(index) + "]";
		const BinObject& device = requireObject(hardware[index], label);
		const BinValue& typeValue = requireField(device, "type", label);
		if (!typeValue.isString()) {
			throw BMSX_RUNTIME_ERROR(label + ".type must be a string.");
		}
		const std::string& type = typeValue.asString();
		if (type == "rom") {
			constexpr std::array<std::string_view, 1> ROM_KEYS{{ "type" }};
			requireKnownKeys(device, ROM_KEYS, label);
			if (romPresent) {
				throw BMSX_RUNTIME_ERROR(
					"Cartridge package manifest.hardware contains more than one ROM device."
				);
			}
			romPresent = true;
			manifest.hardware.push_back(CartridgeRomDeviceConfig{});
			continue;
		}
		if (type == "ram") {
			constexpr std::array<std::string_view, 2> RAM_KEYS{{ "type", "bytes" }};
			requireKnownKeys(device, RAM_KEYS, label);
			if (ramPresent) {
				throw BMSX_RUNTIME_ERROR(
					"Cartridge package manifest.hardware contains more than one RAM device."
				);
			}
			const BinValue& bytesValue = requireField(device, "bytes", label);
			if (!bytesValue.isInt()) {
				throw BMSX_RUNTIME_ERROR(label + ".bytes must be an integer.");
			}
			const i64 bytes = bytesValue.asInt();
			if (bytes < 1 || bytes > CART_RAM_SIZE) {
				throw BMSX_RUNTIME_ERROR(
					label + ".bytes is outside the cartridge RAM aperture."
				);
			}
			ramPresent = true;
			manifest.hardware.push_back(
				CartridgeRamDeviceConfig{static_cast<u32>(bytes)}
			);
			continue;
		}
		if (type == "mailbox") {
			constexpr std::array<std::string_view, 1> MAILBOX_KEYS{{ "type" }};
			requireKnownKeys(device, MAILBOX_KEYS, label);
			if (mailboxPresent) {
				throw BMSX_RUNTIME_ERROR(
					"Cartridge package manifest.hardware contains more than one mailbox device."
				);
			}
			mailboxPresent = true;
			manifest.hardware.push_back(CartridgeMailboxDeviceConfig{});
			continue;
		}
		throw BMSX_RUNTIME_ERROR(label + ".type is not a supported cartridge device.");
	}
	return manifest;
}

} // namespace bmsx
