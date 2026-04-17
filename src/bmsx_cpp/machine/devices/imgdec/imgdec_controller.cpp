#include "machine/devices/imgdec/imgdec_controller.h"

#include "machine/devices/dma/dma_controller.h"
#include "machine/memory/memory_map.h"
#include "machine/bus/io.h"
#include "machine/memory/memory.h"
#include "core/engine_core.h"
#include "rompack/rompack.h"
#include "vendor/stb_image.h"

#include <algorithm>
#include <cstring>
#include <stdexcept>
#include <string>
#include <utility>

namespace bmsx {
namespace {

TaskGate& imgdecGate() {
	static TaskGate gate;
	return gate;
}

inline std::runtime_error imageDecoderFault(const std::string& message) {
	return std::runtime_error("Image decoder fault: " + message);
}

constexpr uint32_t IMGDEC_SERVICE_BATCH_BYTES = 256u;

}

ImgDecController::ImgDecController(
	Memory& memory,
	DmaController& dma,
	std::function<void(uint32_t)> raiseIrq,
	std::function<int64_t()> getNowCycles,
	std::function<void(int64_t deadlineCycles)> scheduleService,
	std::function<void()> cancelService
)
	: m_gate(imgdecGate().group("imgdec"))
	, m_memory(memory)
	, m_dma(dma)
		, m_raiseIrq(std::move(raiseIrq))
		, m_getNowCycles(std::move(getNowCycles))
		, m_scheduleService(std::move(scheduleService))
		, m_cancelService(std::move(cancelService)) {
		m_memory.mapIoWrite(IO_IMG_CTRL, this, &ImgDecController::onCtrlWriteThunk);
	}

void ImgDecController::onCtrlWriteThunk(void* context, uint32_t, Value) {
	auto* controller = static_cast<ImgDecController*>(context);
	controller->onCtrlWrite(controller->m_getNowCycles());
}

void ImgDecController::setTiming(int64_t cpuHz, int64_t decodeBytesPerSec, int64_t nowCycles) {
	m_cpuHz = cpuHz;
	m_decodeBytesPerSec = decodeBytesPerSec;
	m_decodeCarry = 0;
	m_availableDecodeBytes = 0;
	scheduleNextService(nowCycles);
}

void ImgDecController::accrueCycles(int cycles, int64_t nowCycles) {
	if (!m_active || !m_decodeActive || m_decodeQueued || m_decodeRemaining == 0 || cycles <= 0) {
		return;
	}
	const int64_t numerator = m_decodeBytesPerSec * static_cast<int64_t>(cycles) + m_decodeCarry;
	const int64_t wholeBytes = numerator / m_cpuHz;
	m_decodeCarry = numerator % m_cpuHz;
	if (wholeBytes > 0) {
		const int64_t maxGrant = static_cast<int64_t>(m_decodeRemaining) - static_cast<int64_t>(m_availableDecodeBytes);
		const int64_t granted = wholeBytes > maxGrant ? maxGrant : wholeBytes;
		m_availableDecodeBytes += static_cast<uint32_t>(granted);
	}
	scheduleNextService(nowCycles);
}

bool ImgDecController::hasPendingDecodeWork() const {
	return m_active && m_decodeActive && !m_decodeQueued && m_decodeRemaining > 0;
}

uint32_t ImgDecController::getPendingDecodeBytes() const {
	return static_cast<uint32_t>(m_decodeRemaining);
}

void ImgDecController::registerExternalSlot(uint32_t baseAddr, Memory::ImageWriteEntry* entry) {
	m_externalSlots[baseAddr] = entry;
}

void ImgDecController::clearExternalSlots() {
	m_externalSlots.clear();
}

void ImgDecController::decodeToVram(
	std::vector<uint8_t>&& buffer,
	uint32_t dst,
	uint32_t cap,
	std::function<void(uint32_t width, uint32_t height, bool clipped)> onComplete,
	std::function<void(std::exception_ptr)> onError
) {
	ImgDecJob job;
	job.buffer = std::move(buffer);
	job.dst = dst;
	job.cap = cap;
	job.resolve = std::move(onComplete);
	job.reject = std::move(onError);
	m_queuedJobs.push_back(std::move(job));
	scheduleNextService(m_getNowCycles());
}

void ImgDecController::reset() {
	m_decodeToken += 1;
	m_decodeCarry = 0;
	m_availableDecodeBytes = 0;
	m_active = false;
	m_status = 0;
	m_pendingError = nullptr;
	m_pendingResult.reset();
	m_pendingEntry.reset();
	m_pendingCap = 0;
	m_decodeActive = false;
	m_decodeRemaining = 0;
	m_decodePlan = Memory::ImageWritePlan{};
	m_decodePixels.clear();
	m_decodeQueued = false;
	m_decodeWidth = 0;
	m_decodeHeight = 0;
	m_signalIrq = false;
	m_queuedJobs.clear();
	m_activeJob.reset();
	m_cancelService();
	m_memory.writeValue(IO_IMG_SRC, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_LEN, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_DST, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_CAP, valueNumber(0.0));
	m_memory.writeIoValue(IO_IMG_CTRL, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_WRITTEN, valueNumber(0.0));
}

void ImgDecController::onCtrlWrite(int64_t nowCycles) {
	const uint32_t ctrlValue = m_memory.readIoU32(IO_IMG_CTRL);
	const uint32_t ctrl = ctrlValue;
	if ((ctrl & IMG_CTRL_START) == 0u) {
		return;
	}
	if (m_active) {
		m_memory.writeIoValue(IO_IMG_CTRL, valueNumber(static_cast<double>(ctrl & ~IMG_CTRL_START)));
		m_status |= IMG_STATUS_REJECTED;
		m_memory.writeValue(IO_IMG_STATUS, valueNumber(static_cast<double>(m_status)));
		return;
	}
	const uint32_t src = m_memory.readIoU32(IO_IMG_SRC);
	const uint32_t len = m_memory.readIoU32(IO_IMG_LEN);
	const uint32_t dst = m_memory.readIoU32(IO_IMG_DST);
	const uint32_t cap = m_memory.readIoU32(IO_IMG_CAP);
	m_memory.writeIoValue(IO_IMG_CTRL, valueNumber(static_cast<double>(ctrl & ~IMG_CTRL_START)));
	std::vector<uint8_t> buffer(len);
	try {
		if (len > 0) {
			m_memory.readBytes(src, buffer.data(), len);
		}
	} catch (...) {
		finishError(std::current_exception());
		return;
	}
	startJob(std::move(buffer), dst, cap, src, len, std::nullopt, true);
	scheduleNextService(nowCycles);
}

void ImgDecController::onService(int64_t nowCycles) {
	tryStartQueued();
	if (!m_active) {
		m_cancelService();
		return;
	}
	if (m_pendingError) {
		auto error = m_pendingError;
		m_pendingError = nullptr;
		finishError(error);
		scheduleNextService(nowCycles);
		return;
	}
	if (m_pendingResult && m_pendingEntry) {
		auto result = std::move(*m_pendingResult);
		m_pendingResult.reset();
		auto entry = *m_pendingEntry;
		m_pendingEntry.reset();
		beginDecode(std::move(result), entry);
	}
	if (m_decodeActive && m_availableDecodeBytes > 0u) {
		advanceDecode();
	}
	scheduleNextService(nowCycles);
}

void ImgDecController::tryStartQueued() {
	if (m_active) {
		return;
	}
	if (m_queuedJobs.empty()) {
		return;
	}
	ImgDecJob job = std::move(m_queuedJobs.front());
	m_queuedJobs.pop_front();
	const uint32_t len = static_cast<uint32_t>(job.buffer.size());
	startJob(std::move(job.buffer), job.dst, job.cap, 0u, len, std::move(job), false);
}

void ImgDecController::startJob(std::vector<uint8_t>&& buffer, uint32_t dst, uint32_t cap, uint32_t src, uint32_t len, std::optional<ImgDecJob> job, bool signalIrq) {
	m_pendingResult.reset();
	m_pendingError = nullptr;
	m_pendingEntry.reset();
	m_signalIrq = signalIrq;
	m_status = IMG_STATUS_BUSY;
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(static_cast<double>(m_status)));
	m_memory.writeValue(IO_IMG_WRITTEN, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_SRC, valueNumber(static_cast<double>(src)));
	m_memory.writeValue(IO_IMG_LEN, valueNumber(static_cast<double>(len)));
	m_memory.writeValue(IO_IMG_DST, valueNumber(static_cast<double>(dst)));
	m_memory.writeValue(IO_IMG_CAP, valueNumber(static_cast<double>(cap)));
	if (job.has_value()) {
		m_activeJob = std::move(job);
	} else {
		m_activeJob.reset();
	}

	ImgDecEntry entry;
	try {
		entry = resolveSlotEntry(dst);
	} catch (...) {
		finishError(std::current_exception());
		return;
	}
	const uint32_t entryCap = entry.isAsset ? entry.asset->capacity : entry.external->capacity;
	const uint32_t effectiveCap = std::min(cap, entryCap);
	if (effectiveCap == 0) {
		finishError(std::make_exception_ptr(imageDecoderFault("invalid destination capacity.")));
		return;
	}
	m_pendingCap = effectiveCap;
	m_active = true;
	m_decodeActive = false;
	m_decodeRemaining = 0;
	m_decodePlan = Memory::ImageWritePlan{};
	m_decodePixels.clear();
	m_decodeQueued = false;
	m_decodeWidth = 0;
	m_decodeHeight = 0;
	GateScope scope;
	scope.blocking = false;
	scope.category = "texture";
	scope.tag = "imgdec";
	const uint64_t token = m_decodeToken + 1;
	m_decodeToken = token;
	m_gateToken = m_gate.begin(scope);
	auto* queue = EngineCore::instance().platform()->microtaskQueue();
	queue->queueMicrotask([this, entry, token, buffer = std::move(buffer)]() mutable {
		try {
			int width = 0;
			int height = 0;
			int comp = 0;
			unsigned char* pixels = stbi_load_from_memory(
				buffer.data(),
				static_cast<int>(buffer.size()),
				&width,
				&height,
				&comp,
				STBI_rgb_alpha
			);
			(void)comp;
			if (!pixels || width <= 0 || height <= 0) {
				if (pixels) {
					stbi_image_free(pixels);
				}
				throw imageDecoderFault("PNG decode failed.");
			}
			const size_t byteCount = static_cast<size_t>(width) * static_cast<size_t>(height) * 4u;
			DecodedImage result;
			result.width = static_cast<uint32_t>(width);
			result.height = static_cast<uint32_t>(height);
			result.pixels.resize(byteCount);
			std::memcpy(result.pixels.data(), pixels, byteCount);
			stbi_image_free(pixels);
			if (token == m_decodeToken) {
				m_pendingResult = std::move(result);
				m_pendingEntry = entry;
				scheduleNextService(m_getNowCycles());
			}
		} catch (...) {
			if (token == m_decodeToken) {
				m_pendingError = std::current_exception();
				scheduleNextService(m_getNowCycles());
			}
		}
		m_gate.end(m_gateToken);
	});
}

ImgDecController::ImgDecEntry ImgDecController::resolveSlotEntry(uint32_t dst) {
	const auto externalIt = m_externalSlots.find(dst);
	if (externalIt != m_externalSlots.end()) {
		ImgDecEntry entry;
		entry.isAsset = false;
		entry.external = externalIt->second;
		return entry;
	}
	if (dst == VRAM_PRIMARY_ATLAS_BASE) {
		ImgDecEntry entry;
		entry.isAsset = true;
		entry.asset = &m_memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
		return entry;
	}
	if (dst == VRAM_SECONDARY_ATLAS_BASE) {
		ImgDecEntry entry;
		entry.isAsset = true;
		entry.asset = &m_memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
		return entry;
	}
	if (dst == VRAM_SYSTEM_ATLAS_BASE) {
		ImgDecEntry entry;
		entry.isAsset = true;
		entry.asset = &m_memory.getAssetEntry(generateAtlasName(ENGINE_ATLAS_INDEX));
		return entry;
	}
	throw imageDecoderFault("unsupported destination address " + std::to_string(dst) + ".");
}

void ImgDecController::beginDecode(DecodedImage&& result, const ImgDecEntry& entry) {
	const uint32_t cap = m_pendingCap;
	m_pendingCap = 0;
	const size_t pixelBytes = result.pixels.size();
	if (entry.isAsset) {
		m_decodePlan = m_memory.planImageSlotWrite(*entry.asset, pixelBytes, result.width, result.height, cap);
	} else {
		m_decodePlan = m_memory.planImageWrite(*entry.external, pixelBytes, result.width, result.height, cap);
	}
	m_decodeWidth = result.width;
	m_decodeHeight = result.height;
	m_decodePixels = std::move(result.pixels);
	m_decodeRemaining = m_decodePlan.writeLen;
	m_decodeCarry = 0;
	m_availableDecodeBytes = 0;
	m_decodeActive = true;
	m_decodeQueued = false;
	if (m_decodePlan.writeLen == 0) {
		finishSuccess(m_decodePlan.clipped);
	}
}

void ImgDecController::advanceDecode() {
	if (!m_decodeActive) {
		return;
	}
	if (m_decodeRemaining > 0 && m_availableDecodeBytes > 0u) {
		const size_t budget = m_availableDecodeBytes;
		const size_t consume = m_decodeRemaining > budget ? budget : m_decodeRemaining;
		m_decodeRemaining -= consume;
		m_availableDecodeBytes -= static_cast<uint32_t>(consume);
	}
	if (m_decodeRemaining > 0 || m_decodeQueued) {
		return;
	}
	m_decodeQueued = true;
	const auto plan = m_decodePlan;
	auto pixels = std::move(m_decodePixels);
	m_decodePixels.clear();
	m_dma.enqueueImageCopy(plan, std::move(pixels), [this](bool error, bool clipped, std::exception_ptr fault) {
		if (error) {
			finishError(fault);
			return;
		}
		finishSuccess(clipped);
	});
}

void ImgDecController::finishSuccess(bool clipped) {
	auto activeJob = std::move(m_activeJob);
	m_activeJob.reset();
	m_active = false;
	m_decodeActive = false;
	m_availableDecodeBytes = 0;
	m_decodeRemaining = 0;
	m_decodeQueued = false;
	m_decodePixels.clear();
	m_status = (m_status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE;
	if (clipped) {
		m_status |= IMG_STATUS_CLIPPED;
	}
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(static_cast<double>(m_status)));
	if (m_signalIrq) {
		m_raiseIrq(IRQ_IMG_DONE);
	}
	m_signalIrq = false;
	if (activeJob && activeJob->resolve) {
		activeJob->resolve(m_decodeWidth, m_decodeHeight, clipped);
	}
	m_decodeWidth = 0;
	m_decodeHeight = 0;
	scheduleNextService(m_getNowCycles());
}

void ImgDecController::finishError(std::exception_ptr error) {
	auto activeJob = std::move(m_activeJob);
	m_activeJob.reset();
	m_active = false;
	m_decodeActive = false;
	m_availableDecodeBytes = 0;
	m_decodeRemaining = 0;
	m_decodeQueued = false;
	m_decodePixels.clear();
	m_status = (m_status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE | IMG_STATUS_ERROR;
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(static_cast<double>(m_status)));
	if (m_signalIrq) {
		m_raiseIrq(IRQ_IMG_ERROR);
	}
	m_signalIrq = false;
	if (!error) {
		error = std::make_exception_ptr(imageDecoderFault("decode failed."));
	}
	if (activeJob && activeJob->reject) {
		activeJob->reject(error);
	}
	m_decodeWidth = 0;
	m_decodeHeight = 0;
	scheduleNextService(m_getNowCycles());
}

void ImgDecController::scheduleNextService(int64_t nowCycles) {
	if (!m_active) {
		if (!m_queuedJobs.empty()) {
			m_scheduleService(nowCycles);
			return;
		}
		m_cancelService();
		return;
	}
	if (m_pendingError || (m_pendingResult.has_value() && m_pendingEntry.has_value())) {
		m_scheduleService(nowCycles);
		return;
	}
	if (m_decodeActive && !m_decodeQueued && m_decodeRemaining > 0) {
		const uint32_t pendingBytes = static_cast<uint32_t>(m_decodeRemaining);
		const uint32_t targetBytes = pendingBytes < IMGDEC_SERVICE_BATCH_BYTES ? pendingBytes : IMGDEC_SERVICE_BATCH_BYTES;
		if (m_availableDecodeBytes >= targetBytes) {
			m_scheduleService(nowCycles);
			return;
		}
		m_scheduleService(nowCycles + cyclesUntilDecodeBytes(targetBytes - m_availableDecodeBytes));
		return;
	}
	m_cancelService();
}

int64_t ImgDecController::cyclesUntilDecodeBytes(uint32_t targetBytes) const {
	const int64_t needed = static_cast<int64_t>(targetBytes) * m_cpuHz - m_decodeCarry;
	if (needed <= 0) {
		return 1;
	}
	const int64_t cycles = (needed + m_decodeBytesPerSec - 1) / m_decodeBytesPerSec;
	return cycles <= 0 ? 1 : cycles;
}

} // namespace bmsx
