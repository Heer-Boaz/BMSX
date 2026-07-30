#include "libretro_state.h"

#include "common/endian.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/codec.h"

#include <cstring>
#include <vector>

namespace bmsx {
namespace {

constexpr u32 kSaveStateMagic = 0x31534d42u;
constexpr size_t kSaveStateHeaderBytes = 8u;
constexpr size_t kSaveStateBasePayloadCapacityBytes = 0x01000000u;

size_t saveStatePayloadCapacityBytes(const Runtime& runtime) {
	return kSaveStateBasePayloadCapacityBytes
		+ runtime.machine.cartridgeController.ramByteCount();
}

} // namespace

size_t libretroStateSize(const Runtime& runtime) {
	return kSaveStateHeaderBytes + saveStatePayloadCapacityBytes(runtime);
}

bool serializeLibretroState(Runtime& runtime, std::span<u8> envelope) {
	const size_t envelopeBytes = libretroStateSize(runtime);
	if (envelope.size() < envelopeBytes) {
		return false;
	}
	const std::vector<u8> state =
		encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
	if (state.size() > saveStatePayloadCapacityBytes(runtime)) {
		return false;
	}
	writeLE32(envelope.data(), kSaveStateMagic);
	writeLE32(envelope.data() + 4u, static_cast<u32>(state.size()));
	std::memcpy(envelope.data() + kSaveStateHeaderBytes, state.data(), state.size());
	std::memset(
		envelope.data() + kSaveStateHeaderBytes + state.size(),
		0,
		envelopeBytes - kSaveStateHeaderBytes - state.size());
	return true;
}

bool unserializeLibretroState(Runtime& runtime, std::span<const u8> envelope) {
	if (envelope.size() < libretroStateSize(runtime)) {
		return false;
	}
	if (readLE32(envelope.data()) != kSaveStateMagic) {
		return false;
	}
	const size_t payloadBytes = readLE32(envelope.data() + 4u);
	if (payloadBytes > saveStatePayloadCapacityBytes(runtime)) {
		return false;
	}
	applyRuntimeSaveState(
		runtime,
		decodeRuntimeSaveState(
			envelope.subspan(kSaveStateHeaderBytes, payloadBytes),
			runtime.machine.memory.ramByteCount(),
			runtime.machine.gxGpu.readVramSnapshotBytes().size()));
	return true;
}

} // namespace bmsx
