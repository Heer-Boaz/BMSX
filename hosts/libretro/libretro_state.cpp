#include "libretro_state.h"

#include "common/endian.h"
#include "spec/blua32/instruction_format.h"
#include "content.h"
#include "machine/runtime/save_state/codec.h"

#include <cstring>

namespace bmsx {
namespace {

constexpr size_t kMediaIdentityOffset = 2u * sizeof(u32);
constexpr size_t kSaveStateBasePayloadCapacityBytes = 0x01000000u;

size_t saveStatePayloadCapacityBytes(const Runtime& runtime) {
	// An in-flight CONCATN adds the sampled prefix and one (Value, length)
	// per nonempty source of the widest encoded C field.
	constexpr size_t concatCapacity = MAIN_RAM_SIZE + 12u * MAX_EXT_REGISTER_BC + 10u * sizeof(u32) + 1u;
	return kSaveStateBasePayloadCapacityBytes + concatCapacity
		+ runtime.machine.cartridgeController.ramByteCount();
}

} // namespace

size_t libretroStateSize(const Runtime& runtime) {
	return LIBRETRO_STATE_HEADER_BYTES + saveStatePayloadCapacityBytes(runtime);
}

bool serializeLibretroState(LibretroContent& content, std::span<u8> envelope) {
	auto& runtime = content.runtime;
	const size_t envelopeBytes = libretroStateSize(runtime);
	if (envelope.size() < envelopeBytes) {
		return false;
	}
	const size_t payloadBytes = encodeRuntimeSaveState(captureRuntimeSaveState(runtime),
		envelope.subspan(LIBRETRO_STATE_HEADER_BYTES, saveStatePayloadCapacityBytes(runtime)));
	if (payloadBytes == 0) return false;
	writeLE32(envelope.data(), kSaveStateSignature);
	writeLE32(envelope.data() + 4u, static_cast<u32>(payloadBytes));
	const auto& identity = content.mediaIdentity();
	std::memcpy(envelope.data() + kMediaIdentityOffset, identity.data(), identity.size());
	std::memset(
		envelope.data() + LIBRETRO_STATE_HEADER_BYTES + payloadBytes,
		0,
		envelopeBytes - LIBRETRO_STATE_HEADER_BYTES - payloadBytes);
	return true;
}

bool unserializeLibretroState(LibretroContent& content, std::span<const u8> envelope) {
	auto& runtime = content.runtime;
	if (envelope.size() < libretroStateSize(runtime)) {
		return false;
	}
	if (readLE32(envelope.data()) != kSaveStateSignature) {
		return false;
	}
	const size_t payloadBytes = readLE32(envelope.data() + 4u);
	if (payloadBytes == 0 || payloadBytes > saveStatePayloadCapacityBytes(runtime)) {
		return false;
	}
	const auto& identity = content.mediaIdentity();
	if (std::memcmp(envelope.data() + kMediaIdentityOffset, identity.data(), identity.size()) != 0) return false;
	applyRuntimeSaveState(
		runtime,
		decodeRuntimeSaveState(
			envelope.subspan(LIBRETRO_STATE_HEADER_BYTES, payloadBytes),
			runtime.machine.memory.ramByteCount(),
			runtime.machine.gxGpu.readVramSnapshotBytes().size()));
	return true;
}

} // namespace bmsx
