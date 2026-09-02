#include "common/serializer/binencoder.h"
#include "rompack/manifest.h"
#include "spec/bmsx/memory_map.h"

#include <stdexcept>
#include <string_view>
#include <utility>

namespace {

bmsx::BinObject hardwareManifest(bmsx::BinArray hardware) {
	bmsx::BinObject root;
	root.emplace("hardware", bmsx::BinValue(std::move(hardware)));
	return root;
}

bmsx::BinValue ramDevice(bmsx::i64 bytes) {
	bmsx::BinObject device;
	device.emplace("type", "ram");
	device.emplace("bytes", bytes);
	return bmsx::BinValue(std::move(device));
}

bmsx::BinValue romDevice() {
	bmsx::BinObject device;
	device.emplace("type", "rom");
	return bmsx::BinValue(std::move(device));
}

bmsx::BinValue mailboxDevice() {
	bmsx::BinObject device;
	device.emplace("type", "mailbox");
	return bmsx::BinValue(std::move(device));
}

bmsx::CartManifest decodeManifest(bmsx::BinObject root) {
	const std::vector<bmsx::u8> encoded = bmsx::encodeBinary(
		bmsx::BinValue(std::move(root))
	);
	bmsx::CartRomHeader header;
	header.manifestLength = static_cast<bmsx::u32>(encoded.size());
	return bmsx::decodeCartManifest(encoded, header);
}

void requireRejected(bmsx::BinObject root, std::string_view label) {
	try {
		(void)decodeManifest(std::move(root));
	} catch (const std::runtime_error&) {
		return;
	}
	throw std::runtime_error(std::string(label) + " was accepted");
}

} // namespace

int main() {
	bmsx::BinArray devices;
	devices.emplace_back(romDevice());
	devices.emplace_back(ramDevice(256));
	devices.emplace_back(mailboxDevice());
	bmsx::BinObject valid = hardwareManifest(std::move(devices));
	valid.emplace("title", "Expansion test");
	const bmsx::CartManifest manifest = decodeManifest(std::move(valid));
	if (manifest.title != "Expansion test"
		|| manifest.hardware.size() != 3u
		|| !std::holds_alternative<bmsx::CartridgeRomDeviceConfig>(
			manifest.hardware[0])
		|| !std::holds_alternative<bmsx::CartridgeRamDeviceConfig>(
			manifest.hardware[1])
		|| std::get<bmsx::CartridgeRamDeviceConfig>(manifest.hardware[1]).bytes != 256u
		|| !std::holds_alternative<bmsx::CartridgeMailboxDeviceConfig>(
			manifest.hardware[2])) {
		throw std::runtime_error("Concrete cartridge hardware did not decode in order");
	}

	requireRejected({}, "Manifest without hardware");

	bmsx::BinObject retired;
	retired.emplace("hardware", bmsx::BinArray{});
	retired.emplace("cartridge", bmsx::BinObject{});
	requireRejected(std::move(retired), "Retired cartridge board schema");

	bmsx::BinObject unknownType;
	unknownType.emplace("type", "math");
	bmsx::BinArray unknownDevices;
	unknownDevices.emplace_back(std::move(unknownType));
	requireRejected(
		hardwareManifest(std::move(unknownDevices)),
		"Unknown hardware device type"
	);

	bmsx::BinObject mailboxWithField;
	mailboxWithField.emplace("type", "mailbox");
	mailboxWithField.emplace("bytes", bmsx::i64{1});
	bmsx::BinArray unknownFieldDevices;
	unknownFieldDevices.emplace_back(std::move(mailboxWithField));
	requireRejected(
		hardwareManifest(std::move(unknownFieldDevices)),
		"Unknown hardware device field"
	);

	bmsx::BinArray duplicateRom;
	duplicateRom.emplace_back(romDevice());
	duplicateRom.emplace_back(romDevice());
	requireRejected(
		hardwareManifest(std::move(duplicateRom)),
		"Duplicate ROM device"
	);

	bmsx::BinObject romWithField;
	romWithField.emplace("type", "rom");
	romWithField.emplace("bytes", bmsx::i64{1});
	bmsx::BinArray romFieldDevices;
	romFieldDevices.emplace_back(std::move(romWithField));
	requireRejected(
		hardwareManifest(std::move(romFieldDevices)),
		"Unknown ROM device field"
	);

	bmsx::BinArray duplicateRam;
	duplicateRam.emplace_back(ramDevice(1));
	duplicateRam.emplace_back(ramDevice(2));
	requireRejected(
		hardwareManifest(std::move(duplicateRam)),
		"Duplicate RAM device"
	);

	bmsx::BinArray duplicateMailbox;
	duplicateMailbox.emplace_back(mailboxDevice());
	duplicateMailbox.emplace_back(mailboxDevice());
	requireRejected(
		hardwareManifest(std::move(duplicateMailbox)),
		"Duplicate mailbox device"
	);

	bmsx::BinArray zeroRam;
	zeroRam.emplace_back(ramDevice(0));
	requireRejected(hardwareManifest(std::move(zeroRam)), "Zero-byte RAM device");

	bmsx::BinArray oversizedRam;
	oversizedRam.emplace_back(ramDevice(static_cast<bmsx::i64>(bmsx::CART_RAM_SIZE) + 1));
	requireRejected(
		hardwareManifest(std::move(oversizedRam)),
		"Oversized RAM device"
	);

	bmsx::BinObject floatingRamDevice;
	floatingRamDevice.emplace("type", "ram");
	floatingRamDevice.emplace("bytes", bmsx::f32{256.0f});
	bmsx::BinArray floatingRam;
	floatingRam.emplace_back(std::move(floatingRamDevice));
	requireRejected(
		hardwareManifest(std::move(floatingRam)),
		"Floating-tag RAM byte count"
	);
}
