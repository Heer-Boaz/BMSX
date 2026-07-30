#include "spec/bmsx/cartridge.h"
#include "spec/bmsx/memory_map.h"
#include "machine/memory/memory.h"
#include "machine/runtime/runtime.h"
#include "spec/bmsx/model.h"
#include "host.h"
#include "support/libretro_software_product.h"

#include <cstdarg>
#include <cstdio>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

std::vector<std::string> transcript;

void captureLog(enum retro_log_level, const char* format, ...) {
	char buffer[2048];
	va_list args;
	va_start(args, format);
	std::vsnprintf(buffer, sizeof(buffer), format, args);
	va_end(args);
	const std::string_view message(buffer);
	constexpr std::string_view prefix = "CART-CONFORMANCE:";
	if (message.starts_with(prefix)) {
		transcript.emplace_back(message.substr(prefix.size()));
	}
}

void discardInputPoll() {
}

int16_t discardInputState(unsigned, unsigned, unsigned, unsigned) {
	return 0;
}

bool supervisorRequestLineLow() {
	return false;
}

size_t transcriptCount(std::string_view entry) {
	size_t count = 0;
	for (const std::string& value : transcript) {
		if (value == entry) {
			count += 1u;
		}
	}
	return count;
}

void runUntil(bmsx::LibretroHost& host, std::string_view entry, size_t count) {
	for (bmsx::u32 frame = 0; frame < 240u; ++frame) {
		if (transcriptCount(entry) >= count) {
			return;
		}
		host.runFrame();
	}
	throw std::runtime_error("Guest conformance transcript did not complete.");
}

} // namespace

int main(int argc, char** argv) {
	if (argc != 4) {
		std::cerr << "Usage: bmsx_cartridge_conformance_runner SYSTEM_ROM DATA_CART_ROM BOOTABLE_CART_ROM\n";
		return 2;
	}

	bmsx::test::LibretroSoftwareProduct product(
		supervisorRequestLineLow,
		nullptr,
		captureLog,
		std::filesystem::path(argv[1]).parent_path().string());
	bmsx::LibretroHost& host = product.host;
	product.input.setInputPollCallback(discardInputPoll);
	product.input.setInputStateCallback(discardInputState);
	if (!host.loadCartridgeSlotsFromPaths({ argv[2], argv[3] })) {
		throw std::runtime_error("Cartridge media did not load.");
	}

	runUntil(host, "READY", 1u);
	std::vector<bmsx::u8> saved(host.getStateSize());
	if (!host.saveState(saved.data(), saved.size())) {
		throw std::runtime_error("Save-state capture failed.");
	}
	const bmsx::u32 mailboxControl =
		bmsx::CART_MMIO_BASE + bmsx::CARTRIDGE_MAILBOX_CONTROL_OFFSET;
	host.loadedRuntime().machine.memory.writeMappedU32LE(
		mailboxControl,
		bmsx::CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER);
	runUntil(host, "STEP1", 1u);
	if (!host.loadState(saved.data(), saved.size())) {
		throw std::runtime_error("Save-state restore failed.");
	}
	host.loadedRuntime().machine.memory.writeMappedU32LE(
		mailboxControl,
		bmsx::CARTRIDGE_MAILBOX_CONTROL_IRQ_TRIGGER);
	runUntil(host, "STEP1", 2u);

	std::cout << "BMSX-CARTRIDGE-CONFORMANCE=";
	for (size_t index = 0; index < transcript.size(); ++index) {
		if (index != 0u) {
			std::cout << '|';
		}
		std::cout << transcript[index];
	}
	std::cout << '\n';
	return 0;
}
