#include "machine/runtime/save_state/codec.h"

#include "common/serializer/binencoder.h"
#include "machine/runtime/runtime.h"
#include "machine/runtime/save_state/schema.h"
#include <cmath>
#include <limits>
#include <utility>

namespace bmsx {
namespace {

constexpr size_t RUNTIME_SAVE_STATE_FRAME_BYTES = 2;

template<typename T, typename EncodeFn>
BinValue encodeVector(const std::vector<T>& values, EncodeFn&& encode) {
	BinArray array;
	array.reserve(values.size());
	for (const T& value : values) {
		array.push_back(encode(value));
	}
	return BinValue(std::move(array));
}

template<typename T, typename DecodeFn>
std::vector<T> decodeVector(const BinValue& value, const char* label, DecodeFn&& decode) {
	if (!value.isArray()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be an array.");
	}
	const BinArray& array = value.asArray();
	std::vector<T> out;
	out.reserve(array.size());
	for (size_t index = 0; index < array.size(); ++index) {
		out.push_back(decode(array[index], index));
	}
	return out;
}

const BinObject& requireObject(const BinValue& value, const char* label) {
	if (!value.isObject()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be an object.");
	}
	return value.asObject();
}

const BinArray& requireArray(const BinValue& value, const char* label) {
	if (!value.isArray()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be an array.");
	}
	return value.asArray();
}

const BinBinary& requireBinary(const BinValue& value, const char* label) {
	if (!value.isBinary()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be binary.");
	}
	return value.asBinary();
}

const BinValue& requireField(const BinObject& object, const char* key, const char* label) {
	auto it = object.find(key);
	if (it == object.end()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + "." + key + " is required.");
	}
	return it->second;
}

std::string requireString(const BinValue& value, const char* label) {
	if (!value.isString()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be a string.");
	}
	return value.asString();
}

bool requireBool(const BinValue& value, const char* label) {
	if (!value.isBool()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be a boolean.");
	}
	return value.asBool();
}

f64 requireNumber(const BinValue& value, const char* label) {
	if (!value.isNumber()) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be numeric.");
	}
	return value.toNumber();
}

i32 requireI32(const BinValue& value, const char* label) {
	const f64 number = requireNumber(value, label);
	if (std::floor(number) != number
		|| number < static_cast<f64>(std::numeric_limits<int32_t>::min())
		|| number > static_cast<f64>(std::numeric_limits<int32_t>::max())) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be a 32-bit integer.");
	}
	return static_cast<i32>(number);
}

i64 requireI64(const BinValue& value, const char* label) {
	const f64 number = requireNumber(value, label);
	if (std::floor(number) != number) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be an integer.");
	}
	return static_cast<i64>(number);
}

u32 requireU32(const BinValue& value, const char* label) {
	const f64 number = requireNumber(value, label);
	if (std::floor(number) != number
		|| number < 0.0
		|| number > static_cast<f64>(std::numeric_limits<uint32_t>::max())) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must be a uint32.");
	}
	return static_cast<u32>(number);
}

template<size_t N>
BinValue encodeNumberArray(const std::array<f32, N>& values) {
	BinArray array;
	array.reserve(N);
	for (f32 value : values) {
		array.push_back(static_cast<f64>(value));
	}
	return BinValue(std::move(array));
}

template<size_t N>
std::array<f32, N> decodeNumberArray(const BinValue& value, const char* label) {
	const BinArray& array = requireArray(value, label);
	if (array.size() != N) {
		throw BMSX_RUNTIME_ERROR(std::string(label) + " must have " + std::to_string(N) + " entries.");
	}
	std::array<f32, N> out{};
	for (size_t index = 0; index < N; ++index) {
		out[index] = static_cast<f32>(requireNumber(array[index], label));
	}
	return out;
}

BinValue encodeCpuValueState(const CpuValueState& state);
CpuValueState decodeCpuValueState(const BinValue& value, const char* label);

BinValue encodeRuntimeStorageState(const RuntimeStorageState& state) {
	BinObject object;
	object["namespace"] = state.storageNamespace;
	object["entries"] = encodeVector(state.entries, [](const RuntimeStorageStateEntry& entry) {
		BinObject encoded;
		encoded["index"] = static_cast<i64>(entry.index);
		encoded["value"] = entry.value;
		return BinValue(std::move(encoded));
	});
	return BinValue(std::move(object));
}

RuntimeStorageState decodeRuntimeStorageState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeStorageState state;
	state.storageNamespace = requireString(requireField(object, "namespace", label), "storageState.namespace");
	state.entries = decodeVector<RuntimeStorageStateEntry>(requireField(object, "entries", label), "storageState.entries",
		[](const BinValue& entryValue, size_t) {
			const BinObject& entry = requireObject(entryValue, "storageState.entries[]");
			RuntimeStorageStateEntry decoded;
			decoded.index = requireI32(requireField(entry, "index", "storageState.entries[]"), "storageState.entries[].index");
			decoded.value = requireNumber(requireField(entry, "value", "storageState.entries[]"), "storageState.entries[].value");
			return decoded;
		});
	return state;
}

BinValue encodeGameViewState(const GameViewState& state) {
	BinObject viewport;
	viewport["x"] = static_cast<i64>(state.viewportSize.x);
	viewport["y"] = static_cast<i64>(state.viewportSize.y);

	BinObject object;
	object["viewportSize"] = BinValue(std::move(viewport));
	object["crt_postprocessing_enabled"] = state.crtPostprocessingEnabled;
	object["enable_noise"] = state.enableNoise;
	object["enable_colorbleed"] = state.enableColorBleed;
	object["enable_scanlines"] = state.enableScanlines;
	object["enable_blur"] = state.enableBlur;
	object["enable_glow"] = state.enableGlow;
	object["enable_fringing"] = state.enableFringing;
	object["enable_aperture"] = state.enableAperture;
	return BinValue(std::move(object));
}

GameViewState decodeGameViewState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	const BinObject& viewport = requireObject(requireField(object, "viewportSize", label), "gameViewState.viewportSize");
	GameViewState state;
	state.viewportSize.x = requireI32(requireField(viewport, "x", "gameViewState.viewportSize"), "gameViewState.viewportSize.x");
	state.viewportSize.y = requireI32(requireField(viewport, "y", "gameViewState.viewportSize"), "gameViewState.viewportSize.y");
	state.crtPostprocessingEnabled = requireBool(requireField(object, "crt_postprocessing_enabled", label), "gameViewState.crt_postprocessing_enabled");
	state.enableNoise = requireBool(requireField(object, "enable_noise", label), "gameViewState.enable_noise");
	state.enableColorBleed = requireBool(requireField(object, "enable_colorbleed", label), "gameViewState.enable_colorbleed");
	state.enableScanlines = requireBool(requireField(object, "enable_scanlines", label), "gameViewState.enable_scanlines");
	state.enableBlur = requireBool(requireField(object, "enable_blur", label), "gameViewState.enable_blur");
	state.enableGlow = requireBool(requireField(object, "enable_glow", label), "gameViewState.enable_glow");
	state.enableFringing = requireBool(requireField(object, "enable_fringing", label), "gameViewState.enable_fringing");
	state.enableAperture = requireBool(requireField(object, "enable_aperture", label), "gameViewState.enable_aperture");
	return state;
}

BinValue encodeRuntimeRenderCameraState(const RuntimeRenderCameraState& state) {
	BinObject object;
	object["view"] = encodeNumberArray(state.view);
	object["proj"] = encodeNumberArray(state.proj);
	object["eye"] = encodeNumberArray(state.eye);
	return BinValue(std::move(object));
}

RuntimeRenderCameraState decodeRuntimeRenderCameraState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeRenderCameraState state;
	state.view = decodeNumberArray<16>(requireField(object, "view", label), "renderState.camera.view");
	state.proj = decodeNumberArray<16>(requireField(object, "proj", label), "renderState.camera.proj");
	state.eye = decodeNumberArray<3>(requireField(object, "eye", label), "renderState.camera.eye");
	return state;
}

BinValue encodeRuntimeAmbientLightState(const RuntimeAmbientLightState& state) {
	BinObject object;
	object["id"] = state.id;
	object["color"] = encodeNumberArray(state.color);
	object["intensity"] = state.intensity;
	return BinValue(std::move(object));
}

RuntimeAmbientLightState decodeRuntimeAmbientLightState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeAmbientLightState state;
	state.id = requireString(requireField(object, "id", label), "renderState.ambientLights[].id");
	state.color = decodeNumberArray<3>(requireField(object, "color", label), "renderState.ambientLights[].color");
	state.intensity = static_cast<f32>(requireNumber(requireField(object, "intensity", label), "renderState.ambientLights[].intensity"));
	return state;
}

BinValue encodeRuntimeDirectionalLightState(const RuntimeDirectionalLightState& state) {
	BinObject object;
	object["id"] = state.id;
	object["color"] = encodeNumberArray(state.color);
	object["intensity"] = state.intensity;
	object["orientation"] = encodeNumberArray(state.orientation);
	return BinValue(std::move(object));
}

RuntimeDirectionalLightState decodeRuntimeDirectionalLightState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeDirectionalLightState state;
	state.id = requireString(requireField(object, "id", label), "renderState.directionalLights[].id");
	state.color = decodeNumberArray<3>(requireField(object, "color", label), "renderState.directionalLights[].color");
	state.intensity = static_cast<f32>(requireNumber(requireField(object, "intensity", label), "renderState.directionalLights[].intensity"));
	state.orientation = decodeNumberArray<3>(requireField(object, "orientation", label), "renderState.directionalLights[].orientation");
	return state;
}

BinValue encodeRuntimePointLightState(const RuntimePointLightState& state) {
	BinObject object;
	object["id"] = state.id;
	object["color"] = encodeNumberArray(state.color);
	object["intensity"] = state.intensity;
	object["pos"] = encodeNumberArray(state.pos);
	object["range"] = state.range;
	return BinValue(std::move(object));
}

RuntimePointLightState decodeRuntimePointLightState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimePointLightState state;
	state.id = requireString(requireField(object, "id", label), "renderState.pointLights[].id");
	state.color = decodeNumberArray<3>(requireField(object, "color", label), "renderState.pointLights[].color");
	state.intensity = static_cast<f32>(requireNumber(requireField(object, "intensity", label), "renderState.pointLights[].intensity"));
	state.pos = decodeNumberArray<3>(requireField(object, "pos", label), "renderState.pointLights[].pos");
	state.range = static_cast<f32>(requireNumber(requireField(object, "range", label), "renderState.pointLights[].range"));
	return state;
}

BinValue encodeSpriteParallaxRig(const SpriteParallaxRig& state) {
	BinObject object;
	object["vy"] = state.vy;
	object["scale"] = state.scale;
	object["impact"] = state.impact;
	object["impact_t"] = state.impact_t;
	object["bias_px"] = state.bias_px;
	object["parallax_strength"] = state.parallax_strength;
	object["scale_strength"] = state.scale_strength;
	object["flip_strength"] = state.flip_strength;
	object["flip_window"] = state.flip_window;
	return BinValue(std::move(object));
}

SpriteParallaxRig decodeSpriteParallaxRig(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	SpriteParallaxRig state;
	state.vy = static_cast<f32>(requireNumber(requireField(object, "vy", label), "renderState.spriteParallaxRig.vy"));
	state.scale = static_cast<f32>(requireNumber(requireField(object, "scale", label), "renderState.spriteParallaxRig.scale"));
	state.impact = static_cast<f32>(requireNumber(requireField(object, "impact", label), "renderState.spriteParallaxRig.impact"));
	state.impact_t = static_cast<f32>(requireNumber(requireField(object, "impact_t", label), "renderState.spriteParallaxRig.impact_t"));
	state.bias_px = static_cast<f32>(requireNumber(requireField(object, "bias_px", label), "renderState.spriteParallaxRig.bias_px"));
	state.parallax_strength = static_cast<f32>(requireNumber(requireField(object, "parallax_strength", label), "renderState.spriteParallaxRig.parallax_strength"));
	state.scale_strength = static_cast<f32>(requireNumber(requireField(object, "scale_strength", label), "renderState.spriteParallaxRig.scale_strength"));
	state.flip_strength = static_cast<f32>(requireNumber(requireField(object, "flip_strength", label), "renderState.spriteParallaxRig.flip_strength"));
	state.flip_window = static_cast<f32>(requireNumber(requireField(object, "flip_window", label), "renderState.spriteParallaxRig.flip_window"));
	return state;
}

BinValue encodeRuntimeRenderState(const RuntimeRenderState& state) {
	BinObject object;
	object["camera"] = state.camera.has_value()
		? encodeRuntimeRenderCameraState(*state.camera)
		: BinValue(nullptr);
	object["ambientLights"] = encodeVector(state.ambientLights, [](const RuntimeAmbientLightState& light) {
		return encodeRuntimeAmbientLightState(light);
	});
	object["directionalLights"] = encodeVector(state.directionalLights, [](const RuntimeDirectionalLightState& light) {
		return encodeRuntimeDirectionalLightState(light);
	});
	object["pointLights"] = encodeVector(state.pointLights, [](const RuntimePointLightState& light) {
		return encodeRuntimePointLightState(light);
	});
	object["spriteParallaxRig"] = encodeSpriteParallaxRig(state.spriteParallaxRig);
	return BinValue(std::move(object));
}

RuntimeRenderState decodeRuntimeRenderState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeRenderState state;
	const BinValue& camera = requireField(object, "camera", label);
	if (!camera.isNull()) {
		state.camera = decodeRuntimeRenderCameraState(camera, "renderState.camera");
	}
	state.ambientLights = decodeVector<RuntimeAmbientLightState>(requireField(object, "ambientLights", label), "renderState.ambientLights",
		[](const BinValue& entryValue, size_t) {
			return decodeRuntimeAmbientLightState(entryValue, "renderState.ambientLights[]");
		});
	state.directionalLights = decodeVector<RuntimeDirectionalLightState>(requireField(object, "directionalLights", label), "renderState.directionalLights",
		[](const BinValue& entryValue, size_t) {
			return decodeRuntimeDirectionalLightState(entryValue, "renderState.directionalLights[]");
		});
	state.pointLights = decodeVector<RuntimePointLightState>(requireField(object, "pointLights", label), "renderState.pointLights",
		[](const BinValue& entryValue, size_t) {
			return decodeRuntimePointLightState(entryValue, "renderState.pointLights[]");
		});
	state.spriteParallaxRig = decodeSpriteParallaxRig(requireField(object, "spriteParallaxRig", label), "renderState.spriteParallaxRig");
	return state;
}

BinValue encodeTickCompletion(const TickCompletion& state) {
	BinObject object;
	object["sequence"] = static_cast<i64>(state.sequence);
	object["remaining"] = static_cast<i64>(state.remaining);
	object["visualCommitted"] = state.visualCommitted;
	object["vdpFrameCost"] = static_cast<i64>(state.vdpFrameCost);
	object["vdpFrameHeld"] = state.vdpFrameHeld;
	return BinValue(std::move(object));
}

TickCompletion decodeTickCompletion(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	TickCompletion state;
	state.sequence = requireI64(requireField(object, "sequence", label), "tickCompletion.sequence");
	state.remaining = requireI32(requireField(object, "remaining", label), "tickCompletion.remaining");
	state.visualCommitted = requireBool(requireField(object, "visualCommitted", label), "tickCompletion.visualCommitted");
	state.vdpFrameCost = requireI32(requireField(object, "vdpFrameCost", label), "tickCompletion.vdpFrameCost");
	state.vdpFrameHeld = requireBool(requireField(object, "vdpFrameHeld", label), "tickCompletion.vdpFrameHeld");
	return state;
}

BinValue encodeFrameSchedulerState(const FrameSchedulerStateSnapshot& state) {
	BinObject object;
	object["accumulatedHostTimeMs"] = state.accumulatedHostTimeMs;
	object["queuedTickCompletions"] = encodeVector(state.queuedTickCompletions, [](const TickCompletion& completion) {
		return encodeTickCompletion(completion);
	});
	object["lastTickSequence"] = static_cast<i64>(state.lastTickSequence);
	object["lastTickBudgetGranted"] = static_cast<i64>(state.lastTickBudgetGranted);
	object["lastTickCpuBudgetGranted"] = static_cast<i64>(state.lastTickCpuBudgetGranted);
	object["lastTickCpuUsedCycles"] = static_cast<i64>(state.lastTickCpuUsedCycles);
	object["lastTickBudgetRemaining"] = static_cast<i64>(state.lastTickBudgetRemaining);
	object["lastTickVisualFrameCommitted"] = state.lastTickVisualFrameCommitted;
	object["lastTickVdpFrameCost"] = static_cast<i64>(state.lastTickVdpFrameCost);
	object["lastTickVdpFrameHeld"] = state.lastTickVdpFrameHeld;
	object["lastTickCompleted"] = state.lastTickCompleted;
	object["lastTickConsumedSequence"] = static_cast<i64>(state.lastTickConsumedSequence);
	return BinValue(std::move(object));
}

FrameSchedulerStateSnapshot decodeFrameSchedulerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	FrameSchedulerStateSnapshot state;
	state.accumulatedHostTimeMs = requireNumber(requireField(object, "accumulatedHostTimeMs", label), "frameScheduler.accumulatedHostTimeMs");
	state.queuedTickCompletions = decodeVector<TickCompletion>(requireField(object, "queuedTickCompletions", label), "frameScheduler.queuedTickCompletions",
		[](const BinValue& entryValue, size_t) {
			return decodeTickCompletion(entryValue, "frameScheduler.queuedTickCompletions[]");
		});
	state.lastTickSequence = requireI64(requireField(object, "lastTickSequence", label), "frameScheduler.lastTickSequence");
	state.lastTickBudgetGranted = requireI32(requireField(object, "lastTickBudgetGranted", label), "frameScheduler.lastTickBudgetGranted");
	state.lastTickCpuBudgetGranted = requireI32(requireField(object, "lastTickCpuBudgetGranted", label), "frameScheduler.lastTickCpuBudgetGranted");
	state.lastTickCpuUsedCycles = requireI32(requireField(object, "lastTickCpuUsedCycles", label), "frameScheduler.lastTickCpuUsedCycles");
	state.lastTickBudgetRemaining = requireI32(requireField(object, "lastTickBudgetRemaining", label), "frameScheduler.lastTickBudgetRemaining");
	state.lastTickVisualFrameCommitted = requireBool(requireField(object, "lastTickVisualFrameCommitted", label), "frameScheduler.lastTickVisualFrameCommitted");
	state.lastTickVdpFrameCost = requireI32(requireField(object, "lastTickVdpFrameCost", label), "frameScheduler.lastTickVdpFrameCost");
	state.lastTickVdpFrameHeld = requireBool(requireField(object, "lastTickVdpFrameHeld", label), "frameScheduler.lastTickVdpFrameHeld");
	state.lastTickCompleted = requireBool(requireField(object, "lastTickCompleted", label), "frameScheduler.lastTickCompleted");
	state.lastTickConsumedSequence = requireI64(requireField(object, "lastTickConsumedSequence", label), "frameScheduler.lastTickConsumedSequence");
	return state;
}

BinValue encodeRuntimeVblankState(const RuntimeVblankSnapshot& state) {
	BinObject object;
	object["cyclesIntoFrame"] = static_cast<i64>(state.cyclesIntoFrame);
	return BinValue(std::move(object));
}

RuntimeVblankSnapshot decodeRuntimeVblankState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeVblankSnapshot state;
	state.cyclesIntoFrame = requireI32(requireField(object, "cyclesIntoFrame", label), "vblank.cyclesIntoFrame");
	return state;
}

BinValue encodeMemorySaveState(const MemorySaveState& state) {
	BinObject object;
	object["ram"] = BinValue(BinBinary(state.ram.begin(), state.ram.end()));
	return BinValue(std::move(object));
}

MemorySaveState decodeMemorySaveState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	MemorySaveState state;
	state.ram = requireBinary(requireField(object, "ram", label), "machine.memory.ram");
	return state;
}

BinValue encodeStringHandleTableState(const StringHandleTableState& state) {
	BinObject object;
	object["nextHandle"] = static_cast<i64>(state.nextHandle);
	object["generation"] = static_cast<i64>(state.generation);
	object["heapUsedBytes"] = static_cast<i64>(state.heapUsedBytes);
	return BinValue(std::move(object));
}

StringHandleTableState decodeStringHandleTableState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	StringHandleTableState state;
	state.nextHandle = requireU32(requireField(object, "nextHandle", label), "machine.stringHandles.nextHandle");
	state.generation = requireU32(requireField(object, "generation", label), "machine.stringHandles.generation");
	state.heapUsedBytes = requireU32(requireField(object, "heapUsedBytes", label), "machine.stringHandles.heapUsedBytes");
	return state;
}

BinValue encodeInputControllerState(const InputControllerState& state) {
	BinObject object;
	object["sampleArmed"] = state.sampleArmed;
	return BinValue(std::move(object));
}

InputControllerState decodeInputControllerState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	InputControllerState state;
	state.sampleArmed = requireBool(requireField(object, "sampleArmed", label), "machine.input.sampleArmed");
	return state;
}

BinValue encodeSkyboxImageIds(const SkyboxImageIds& state) {
	BinObject object;
	object["posx"] = state.posx;
	object["negx"] = state.negx;
	object["posy"] = state.posy;
	object["negy"] = state.negy;
	object["posz"] = state.posz;
	object["negz"] = state.negz;
	return BinValue(std::move(object));
}

SkyboxImageIds decodeSkyboxImageIds(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	SkyboxImageIds state;
	state.posx = requireString(requireField(object, "posx", label), "skyboxFaceIds.posx");
	state.negx = requireString(requireField(object, "negx", label), "skyboxFaceIds.negx");
	state.posy = requireString(requireField(object, "posy", label), "skyboxFaceIds.posy");
	state.negy = requireString(requireField(object, "negy", label), "skyboxFaceIds.negy");
	state.posz = requireString(requireField(object, "posz", label), "skyboxFaceIds.posz");
	state.negz = requireString(requireField(object, "negz", label), "skyboxFaceIds.negz");
	return state;
}

BinValue encodeVdpState(const VdpState& state) {
	BinObject atlasSlots;
	atlasSlots["primary"] = state.atlasSlots[0] >= 0 ? BinValue(static_cast<i64>(state.atlasSlots[0])) : BinValue(nullptr);
	atlasSlots["secondary"] = state.atlasSlots[1] >= 0 ? BinValue(static_cast<i64>(state.atlasSlots[1])) : BinValue(nullptr);

	BinObject object;
	object["atlasSlots"] = BinValue(std::move(atlasSlots));
	object["skyboxFaceIds"] = state.skyboxFaceIds.has_value()
		? encodeSkyboxImageIds(*state.skyboxFaceIds)
		: BinValue(nullptr);
	object["ditherType"] = static_cast<i64>(state.ditherType);
	return BinValue(std::move(object));
}

VdpState decodeVdpState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	const BinObject& atlasSlots = requireObject(requireField(object, "atlasSlots", label), "machine.vdp.atlasSlots");
	VdpState state;
	const BinValue& primary = requireField(atlasSlots, "primary", "machine.vdp.atlasSlots");
	const BinValue& secondary = requireField(atlasSlots, "secondary", "machine.vdp.atlasSlots");
	state.atlasSlots[0] = primary.isNull() ? -1 : requireI32(primary, "machine.vdp.atlasSlots.primary");
	state.atlasSlots[1] = secondary.isNull() ? -1 : requireI32(secondary, "machine.vdp.atlasSlots.secondary");
	const BinValue& skybox = requireField(object, "skyboxFaceIds", label);
	if (!skybox.isNull()) {
		state.skyboxFaceIds = decodeSkyboxImageIds(skybox, "machine.vdp.skyboxFaceIds");
	}
	state.ditherType = requireI32(requireField(object, "ditherType", label), "machine.vdp.ditherType");
	return state;
}

BinValue encodeVdpSurfacePixelsState(const VdpSurfacePixelsState& state) {
	BinObject object;
	object["surfaceId"] = static_cast<i64>(state.surfaceId);
	object["pixels"] = BinBinary(state.pixels);
	return BinValue(std::move(object));
}

VdpSurfacePixelsState decodeVdpSurfacePixelsState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	VdpSurfacePixelsState state;
	state.surfaceId = requireU32(requireField(object, "surfaceId", label), "machine.vdp.surfacePixels.surfaceId");
	state.pixels = requireBinary(requireField(object, "pixels", label), "machine.vdp.surfacePixels.pixels");
	return state;
}

BinValue encodeVdpSaveState(const VdpSaveState& state) {
	BinObject object = encodeVdpState(state).asObject();
	object["vramStaging"] = BinBinary(state.vramStaging);
	object["surfacePixels"] = encodeVector<VdpSurfacePixelsState>(state.surfacePixels, encodeVdpSurfacePixelsState);
	object["displayFrameBufferPixels"] = BinBinary(state.displayFrameBufferPixels);
	return BinValue(std::move(object));
}

VdpSaveState decodeVdpSaveState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	const VdpState base = decodeVdpState(value, label);
	VdpSaveState state;
	state.atlasSlots = base.atlasSlots;
	state.skyboxFaceIds = base.skyboxFaceIds;
	state.ditherType = base.ditherType;
	state.vramStaging = requireBinary(requireField(object, "vramStaging", label), "machine.vdp.vramStaging");
	state.surfacePixels = decodeVector<VdpSurfacePixelsState>(
		requireField(object, "surfacePixels", label),
		"machine.vdp.surfacePixels",
		[](const BinValue& entry, size_t) { return decodeVdpSurfacePixelsState(entry, "machine.vdp.surfacePixels[]"); }
	);
	state.displayFrameBufferPixels = requireBinary(requireField(object, "displayFrameBufferPixels", label), "machine.vdp.displayFrameBufferPixels");
	return state;
}

BinValue encodeMachineSaveState(const MachineSaveState& state) {
	BinObject object;
	object["memory"] = encodeMemorySaveState(state.memory);
	object["stringHandles"] = encodeStringHandleTableState(state.stringHandles);
	object["input"] = encodeInputControllerState(state.input);
	object["vdp"] = encodeVdpSaveState(state.vdp);
	return BinValue(std::move(object));
}

MachineSaveState decodeMachineSaveState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	MachineSaveState state;
	state.memory = decodeMemorySaveState(requireField(object, "memory", label), "machineState.machine.memory");
	state.stringHandles = decodeStringHandleTableState(requireField(object, "stringHandles", label), "machineState.machine.stringHandles");
	state.input = decodeInputControllerState(requireField(object, "input", label), "machineState.machine.input");
	state.vdp = decodeVdpSaveState(requireField(object, "vdp", label), "machineState.machine.vdp");
	return state;
}

BinValue encodeRuntimeSaveMachineState(const RuntimeSaveMachineState& state) {
	BinObject object;
	object["machine"] = encodeMachineSaveState(state.machine);
	object["frameScheduler"] = encodeFrameSchedulerState(state.frameScheduler);
	object["vblank"] = encodeRuntimeVblankState(state.vblank);
	return BinValue(std::move(object));
}

RuntimeSaveMachineState decodeRuntimeSaveMachineState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeSaveMachineState state;
	state.machine = decodeMachineSaveState(requireField(object, "machine", label), "machineState.machine");
	state.frameScheduler = decodeFrameSchedulerState(requireField(object, "frameScheduler", label), "machineState.frameScheduler");
	state.vblank = decodeRuntimeVblankState(requireField(object, "vblank", label), "machineState.vblank");
	return state;
}

BinValue encodeCpuValueState(const CpuValueState& state) {
	BinObject object;
	switch (state.tag) {
		case CpuValueStateTag::Nil:
			object["tag"] = "nil";
			break;
		case CpuValueStateTag::False:
			object["tag"] = "false";
			break;
		case CpuValueStateTag::True:
			object["tag"] = "true";
			break;
		case CpuValueStateTag::Number:
			object["tag"] = "number";
			object["value"] = state.numberValue;
			break;
		case CpuValueStateTag::String:
			object["tag"] = "string";
			object["id"] = static_cast<i64>(state.stringId);
			break;
		case CpuValueStateTag::Ref:
			object["tag"] = "ref";
			object["id"] = static_cast<i64>(state.refId);
			break;
		case CpuValueStateTag::StableRef: {
			object["tag"] = "stable_ref";
			BinArray path;
			path.reserve(state.path.size());
			for (const CpuRuntimeRefSegment& segment : state.path) {
				path.push_back(segment.isIndex ? BinValue(static_cast<i64>(segment.index)) : BinValue(segment.key));
			}
			object["path"] = BinValue(std::move(path));
			break;
		}
	}
	return BinValue(std::move(object));
}

CpuValueState decodeCpuValueState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	const std::string tag = requireString(requireField(object, "tag", label), "cpuValueState.tag");
	CpuValueState state;
	if (tag == "nil") {
		state.tag = CpuValueStateTag::Nil;
		return state;
	}
	if (tag == "false") {
		state.tag = CpuValueStateTag::False;
		return state;
	}
	if (tag == "true") {
		state.tag = CpuValueStateTag::True;
		return state;
	}
	if (tag == "number") {
		state.tag = CpuValueStateTag::Number;
		state.numberValue = requireNumber(requireField(object, "value", label), "cpuValueState.value");
		return state;
	}
	if (tag == "string") {
		state.tag = CpuValueStateTag::String;
		state.stringId = requireU32(requireField(object, "id", label), "cpuValueState.id");
		return state;
	}
	if (tag == "ref") {
		state.tag = CpuValueStateTag::Ref;
		state.refId = requireI32(requireField(object, "id", label), "cpuValueState.id");
		return state;
	}
	if (tag == "stable_ref") {
		state.tag = CpuValueStateTag::StableRef;
		const BinArray& path = requireArray(requireField(object, "path", label), "cpuValueState.path");
		state.path.reserve(path.size());
		for (size_t index = 0; index < path.size(); ++index) {
			const BinValue& segmentValue = path[index];
			CpuRuntimeRefSegment segment;
			if (segmentValue.isString()) {
				segment.key = segmentValue.asString();
			} else {
				segment.isIndex = true;
				segment.index = requireI32(segmentValue, "cpuValueState.path[]");
			}
			state.path.push_back(std::move(segment));
		}
		return state;
	}
	throw BMSX_RUNTIME_ERROR("cpuValueState.tag is invalid.");
}

BinValue encodeCpuObjectState(const CpuObjectState& state) {
	BinObject object;
	switch (state.kind) {
		case CpuObjectState::Kind::Table:
			object["kind"] = "table";
			object["array"] = encodeVector(state.array, [](const CpuValueState& value) {
				return encodeCpuValueState(value);
			});
			object["arrayLength"] = static_cast<i64>(state.arrayLength);
			object["hash"] = encodeVector(state.hash, [](const CpuTableHashNodeSnapshot& node) {
				BinObject encoded;
				encoded["key"] = encodeCpuValueState(node.key);
				encoded["value"] = encodeCpuValueState(node.value);
				encoded["next"] = static_cast<i64>(node.next);
				return BinValue(std::move(encoded));
			});
			object["hashFree"] = static_cast<i64>(state.hashFree);
			object["metatable"] = encodeCpuValueState(state.metatable);
			break;
		case CpuObjectState::Kind::Closure:
			object["kind"] = "closure";
			object["protoIndex"] = static_cast<i64>(state.protoIndex);
			object["upvalues"] = encodeVector(state.upvalues, [](int index) {
				return BinValue(static_cast<i64>(index));
			});
			break;
		case CpuObjectState::Kind::Upvalue:
			object["kind"] = "upvalue";
			object["open"] = state.upvalueOpen;
			object["index"] = static_cast<i64>(state.upvalueIndex);
			object["frameIndex"] = static_cast<i64>(state.frameIndex);
			object["value"] = encodeCpuValueState(state.upvalueValue);
			break;
	}
	return BinValue(std::move(object));
}

CpuObjectState decodeCpuObjectState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	const std::string kind = requireString(requireField(object, "kind", label), "cpuObjectState.kind");
	CpuObjectState state;
	if (kind == "table") {
		state.kind = CpuObjectState::Kind::Table;
		state.array = decodeVector<CpuValueState>(requireField(object, "array", label), "cpuObjectState.array",
			[](const BinValue& entryValue, size_t) {
				return decodeCpuValueState(entryValue, "cpuObjectState.array[]");
			});
		state.arrayLength = static_cast<size_t>(requireU32(requireField(object, "arrayLength", label), "cpuObjectState.arrayLength"));
		state.hash = decodeVector<CpuTableHashNodeSnapshot>(requireField(object, "hash", label), "cpuObjectState.hash",
			[](const BinValue& entryValue, size_t) {
				const BinObject& entry = requireObject(entryValue, "cpuObjectState.hash[]");
				CpuTableHashNodeSnapshot node;
				node.key = decodeCpuValueState(requireField(entry, "key", "cpuObjectState.hash[]"), "cpuObjectState.hash[].key");
				node.value = decodeCpuValueState(requireField(entry, "value", "cpuObjectState.hash[]"), "cpuObjectState.hash[].value");
				node.next = requireI32(requireField(entry, "next", "cpuObjectState.hash[]"), "cpuObjectState.hash[].next");
				return node;
			});
		state.hashFree = requireI32(requireField(object, "hashFree", label), "cpuObjectState.hashFree");
		state.metatable = decodeCpuValueState(requireField(object, "metatable", label), "cpuObjectState.metatable");
		return state;
	}
	if (kind == "closure") {
		state.kind = CpuObjectState::Kind::Closure;
		state.protoIndex = requireI32(requireField(object, "protoIndex", label), "cpuObjectState.protoIndex");
		state.upvalues = decodeVector<int>(requireField(object, "upvalues", label), "cpuObjectState.upvalues",
			[](const BinValue& entryValue, size_t) {
				return requireI32(entryValue, "cpuObjectState.upvalues[]");
			});
		return state;
	}
	if (kind == "upvalue") {
		state.kind = CpuObjectState::Kind::Upvalue;
		state.upvalueOpen = requireBool(requireField(object, "open", label), "cpuObjectState.open");
		state.upvalueIndex = requireI32(requireField(object, "index", label), "cpuObjectState.index");
		state.frameIndex = requireI32(requireField(object, "frameIndex", label), "cpuObjectState.frameIndex");
		state.upvalueValue = decodeCpuValueState(requireField(object, "value", label), "cpuObjectState.value");
		return state;
	}
	throw BMSX_RUNTIME_ERROR("cpuObjectState.kind is invalid.");
}

BinValue encodeCpuFrameState(const CpuFrameState& state) {
	BinObject object;
	object["protoIndex"] = static_cast<i64>(state.protoIndex);
	object["pc"] = static_cast<i64>(state.pc);
	object["closureRef"] = static_cast<i64>(state.closureRef);
	object["registers"] = encodeVector(state.registers, [](const CpuValueState& value) {
		return encodeCpuValueState(value);
	});
	object["varargs"] = encodeVector(state.varargs, [](const CpuValueState& value) {
		return encodeCpuValueState(value);
	});
	object["returnBase"] = static_cast<i64>(state.returnBase);
	object["returnCount"] = static_cast<i64>(state.returnCount);
	object["top"] = static_cast<i64>(state.top);
	object["captureReturns"] = state.captureReturns;
	object["callSitePc"] = static_cast<i64>(state.callSitePc);
	return BinValue(std::move(object));
}

CpuFrameState decodeCpuFrameState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	CpuFrameState state;
	state.protoIndex = requireI32(requireField(object, "protoIndex", label), "cpuFrameState.protoIndex");
	state.pc = requireI32(requireField(object, "pc", label), "cpuFrameState.pc");
	state.closureRef = requireI32(requireField(object, "closureRef", label), "cpuFrameState.closureRef");
	state.registers = decodeVector<CpuValueState>(requireField(object, "registers", label), "cpuFrameState.registers",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuValueState(entryValue, "cpuFrameState.registers[]");
		});
	state.varargs = decodeVector<CpuValueState>(requireField(object, "varargs", label), "cpuFrameState.varargs",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuValueState(entryValue, "cpuFrameState.varargs[]");
		});
	state.returnBase = requireI32(requireField(object, "returnBase", label), "cpuFrameState.returnBase");
	state.returnCount = requireI32(requireField(object, "returnCount", label), "cpuFrameState.returnCount");
	state.top = requireI32(requireField(object, "top", label), "cpuFrameState.top");
	state.captureReturns = requireBool(requireField(object, "captureReturns", label), "cpuFrameState.captureReturns");
	state.callSitePc = requireI32(requireField(object, "callSitePc", label), "cpuFrameState.callSitePc");
	return state;
}

BinValue encodeCpuRootValueState(const CpuRootValueState& state) {
	BinObject object;
	object["name"] = state.name;
	object["value"] = encodeCpuValueState(state.value);
	return BinValue(std::move(object));
}

CpuRootValueState decodeCpuRootValueState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	CpuRootValueState state;
	state.name = requireString(requireField(object, "name", label), "cpuRootValueState.name");
	state.value = decodeCpuValueState(requireField(object, "value", label), "cpuRootValueState.value");
	return state;
}

BinValue encodeCpuRuntimeState(const CpuRuntimeState& state) {
	BinObject object;
	object["globals"] = encodeVector(state.globals, [](const CpuRootValueState& value) {
		return encodeCpuRootValueState(value);
	});
	object["ioMemory"] = encodeVector(state.ioMemory, [](const CpuValueState& value) {
		return encodeCpuValueState(value);
	});
	object["moduleCache"] = encodeVector(state.moduleCache, [](const CpuRootValueState& value) {
		return encodeCpuRootValueState(value);
	});
	object["frames"] = encodeVector(state.frames, [](const CpuFrameState& value) {
		return encodeCpuFrameState(value);
	});
	object["lastReturnValues"] = encodeVector(state.lastReturnValues, [](const CpuValueState& value) {
		return encodeCpuValueState(value);
	});
	object["objects"] = encodeVector(state.objects, [](const CpuObjectState& value) {
		return encodeCpuObjectState(value);
	});
	object["openUpvalues"] = encodeVector(state.openUpvalues, [](int value) {
		return BinValue(static_cast<i64>(value));
	});
	object["lastPc"] = static_cast<i64>(state.lastPc);
	object["lastInstruction"] = static_cast<i64>(state.lastInstruction);
	object["instructionBudgetRemaining"] = static_cast<i64>(state.instructionBudgetRemaining);
	object["haltedUntilIrq"] = state.haltedUntilIrq;
	object["yieldRequested"] = state.yieldRequested;
	return BinValue(std::move(object));
}

CpuRuntimeState decodeCpuRuntimeState(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	CpuRuntimeState state;
	state.globals = decodeVector<CpuRootValueState>(requireField(object, "globals", label), "cpuState.globals",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuRootValueState(entryValue, "cpuState.globals[]");
		});
	state.ioMemory = decodeVector<CpuValueState>(requireField(object, "ioMemory", label), "cpuState.ioMemory",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuValueState(entryValue, "cpuState.ioMemory[]");
		});
	state.moduleCache = decodeVector<CpuRootValueState>(requireField(object, "moduleCache", label), "cpuState.moduleCache",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuRootValueState(entryValue, "cpuState.moduleCache[]");
		});
	state.frames = decodeVector<CpuFrameState>(requireField(object, "frames", label), "cpuState.frames",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuFrameState(entryValue, "cpuState.frames[]");
		});
	state.lastReturnValues = decodeVector<CpuValueState>(requireField(object, "lastReturnValues", label), "cpuState.lastReturnValues",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuValueState(entryValue, "cpuState.lastReturnValues[]");
		});
	state.objects = decodeVector<CpuObjectState>(requireField(object, "objects", label), "cpuState.objects",
		[](const BinValue& entryValue, size_t) {
			return decodeCpuObjectState(entryValue, "cpuState.objects[]");
		});
	state.openUpvalues = decodeVector<int>(requireField(object, "openUpvalues", label), "cpuState.openUpvalues",
		[](const BinValue& entryValue, size_t) {
			return requireI32(entryValue, "cpuState.openUpvalues[]");
		});
	state.lastPc = requireI32(requireField(object, "lastPc", label), "cpuState.lastPc");
	state.lastInstruction = requireU32(requireField(object, "lastInstruction", label), "cpuState.lastInstruction");
	state.instructionBudgetRemaining = requireI32(requireField(object, "instructionBudgetRemaining", label), "cpuState.instructionBudgetRemaining");
	state.haltedUntilIrq = requireBool(requireField(object, "haltedUntilIrq", label), "cpuState.haltedUntilIrq");
	state.yieldRequested = requireBool(requireField(object, "yieldRequested", label), "cpuState.yieldRequested");
	return state;
}

BinValue encodeRuntimeSaveStateValue(const RuntimeSaveState& state) {
	BinObject object;
	object["storageState"] = encodeRuntimeStorageState(state.storageState);
	object["machineState"] = encodeRuntimeSaveMachineState(state.machineState);
	object["cpuState"] = encodeCpuRuntimeState(state.cpuState);
	object["gameViewState"] = encodeGameViewState(state.gameViewState);
	object["renderState"] = encodeRuntimeRenderState(state.renderState);
	object["engineProgramActive"] = state.engineProgramActive;
	object["luaInitialized"] = state.luaInitialized;
	object["luaRuntimeFailed"] = state.runtimeFailed;
	object["randomSeed"] = static_cast<i64>(state.randomSeed);
	object["pendingEntryCall"] = state.pendingEntryCall;
	return BinValue(std::move(object));
}

RuntimeSaveState decodeRuntimeSaveStateValue(const BinValue& value, const char* label) {
	const BinObject& object = requireObject(value, label);
	RuntimeSaveState state;
	state.storageState = decodeRuntimeStorageState(requireField(object, "storageState", label), "runtimeSaveState.storageState");
	state.machineState = decodeRuntimeSaveMachineState(requireField(object, "machineState", label), "runtimeSaveState.machineState");
	state.cpuState = decodeCpuRuntimeState(requireField(object, "cpuState", label), "runtimeSaveState.cpuState");
	state.gameViewState = decodeGameViewState(requireField(object, "gameViewState", label), "runtimeSaveState.gameViewState");
	state.renderState = decodeRuntimeRenderState(requireField(object, "renderState", label), "runtimeSaveState.renderState");
	state.engineProgramActive = requireBool(requireField(object, "engineProgramActive", label), "runtimeSaveState.engineProgramActive");
	state.luaInitialized = requireBool(requireField(object, "luaInitialized", label), "runtimeSaveState.luaInitialized");
	state.runtimeFailed = requireBool(requireField(object, "luaRuntimeFailed", label), "runtimeSaveState.luaRuntimeFailed");
	state.randomSeed = requireU32(requireField(object, "randomSeed", label), "runtimeSaveState.randomSeed");
	state.pendingEntryCall = requireBool(requireField(object, "pendingEntryCall", label), "runtimeSaveState.pendingEntryCall");
	return state;
}

} // namespace

std::vector<u8> encodeRuntimeSaveState(const RuntimeSaveState& state) {
	const std::vector<u8> payload = encodeBinaryWithPropTable(encodeRuntimeSaveStateValue(state), runtimeSaveStatePropNames());
	std::vector<u8> bytes;
	bytes.reserve(RUNTIME_SAVE_STATE_FRAME_BYTES + payload.size());
	bytes.push_back(BINENC_VERSION);
	bytes.push_back(RUNTIME_SAVE_STATE_WIRE_VERSION);
	bytes.insert(bytes.end(), payload.begin(), payload.end());
	return bytes;
}

RuntimeSaveState decodeRuntimeSaveState(const u8* data, size_t size) {
	if (size < RUNTIME_SAVE_STATE_FRAME_BYTES) {
		throw BMSX_RUNTIME_ERROR("runtimeSaveState payload is truncated.");
	}
	if (data[0] != BINENC_VERSION) {
		throw BMSX_RUNTIME_ERROR("runtimeSaveState binenc version is invalid.");
	}
	if (data[1] != RUNTIME_SAVE_STATE_WIRE_VERSION) {
		throw BMSX_RUNTIME_ERROR("runtimeSaveState wire version is invalid.");
	}
	return decodeRuntimeSaveStateValue(
		decodeBinaryWithPropTable(data + RUNTIME_SAVE_STATE_FRAME_BYTES, size - RUNTIME_SAVE_STATE_FRAME_BYTES, runtimeSaveStatePropNames()),
		"runtimeSaveState");
}

RuntimeSaveState decodeRuntimeSaveState(const std::vector<u8>& data) {
	return decodeRuntimeSaveState(data.data(), data.size());
}

// disable-next-line single_line_method_pattern -- byte save-state API composes capture and binary encoding at the public boundary.
std::vector<u8> captureRuntimeSaveStateBytes(Runtime& runtime) {
	return encodeRuntimeSaveState(captureRuntimeSaveState(runtime));
}

// disable-next-line single_line_method_pattern -- byte save-state API composes binary decoding and runtime restore at the public boundary.
void applyRuntimeSaveStateBytes(Runtime& runtime, const u8* data, size_t size) {
	applyRuntimeSaveState(runtime, decodeRuntimeSaveState(data, size));
}

// disable-next-line single_line_method_pattern -- vector save-state input is the public owner overload for byte payload callers.
void applyRuntimeSaveStateBytes(Runtime& runtime, const std::vector<u8>& data) {
	applyRuntimeSaveStateBytes(runtime, data.data(), data.size());
}

} // namespace bmsx
