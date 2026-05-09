#include "machine/devices/imgdec/controller.h"

#include "machine/devices/irq/controller.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/vdp/vdp.h"
#include "machine/memory/map.h"
#include "machine/bus/io.h"
#include "machine/memory/memory.h"
#include "machine/scheduler/budget.h"
#include "platform/platform.h"
#include "vendor/stb_image.h"

#include <cstring>
#include <stdexcept>
#include <string>
#include <utility>

namespace bmsx {
namespace {

inline std::runtime_error imageDecoderFault(const std::string& message) {
	return std::runtime_error("Image decoder fault: " + message);
}

constexpr uint32_t IMGDEC_SERVICE_BATCH_BYTES = 256u;

}

ImageCopyPlan ImgDecController::planImageCopy(uint32_t targetBaseAddr, uint32_t targetCapacity, const DecodedImage& result, uint32_t capacityLimit) {
	const uint32_t capacity = capacityLimit < targetCapacity ? capacityLimit : targetCapacity;
	const uint32_t sourceWidth = result.width;
	const uint32_t sourceHeight = result.height;
	const uint32_t sourceStride = sourceWidth * 4u;
	const uint32_t maxPixels = capacity >> 2u;
	uint32_t writeWidth = sourceWidth;
	uint32_t writeHeight = sourceHeight;
	if (sourceStride == 0u || sourceHeight == 0u || maxPixels == 0u) {
		writeWidth = 0u;
		writeHeight = 0u;
	} else {
		const uint32_t maxRowsByPixels = static_cast<uint32_t>(result.pixels.size() / sourceStride);
		if (sourceWidth > maxPixels) {
			writeWidth = maxPixels;
			writeHeight = maxRowsByPixels > 0u ? 1u : 0u;
		} else {
			const uint32_t maxRowsByCapacity = capacity / sourceStride;
			if (writeHeight > maxRowsByCapacity) {
				writeHeight = maxRowsByCapacity;
			}
			if (writeHeight > maxRowsByPixels) {
				writeHeight = maxRowsByPixels;
			}
		}
	}
	const uint32_t writeStride = writeWidth * 4u;
	const size_t writeLen = static_cast<size_t>(writeStride) * static_cast<size_t>(writeHeight);
	ImageCopyPlan plan;
	plan.baseAddr = targetBaseAddr;
	plan.writeWidth = writeWidth;
	plan.writeHeight = writeHeight;
	plan.writeStride = writeStride;
	plan.targetStride = writeStride;
	plan.sourceStride = sourceStride;
	plan.writeLen = writeLen;
	plan.clipped = writeWidth != sourceWidth || writeHeight != sourceHeight;
	return plan;
}

ImgDecController::ImgDecController(
	Memory& memory,
	DmaController& dma,
	VDP& vdp,
	IrqController& irq,
	DeviceScheduler& scheduler,
	MicrotaskQueue& microtasks
)
	: m_memory(memory)
	, m_dma(dma)
	, m_vdp(vdp)
	, m_irq(irq)
	, m_scheduler(scheduler)
	, m_microtasks(microtasks) {
	m_memory.mapIoWrite(IO_IMG_CTRL, this, &ImgDecController::onCtrlWriteThunk);
}

// disable-next-line normalized_ast_duplicate_pattern -- device MMIO thunks share callback shape while each device owns its scheduler timing.
void ImgDecController::onCtrlWriteThunk(void* context, uint32_t, Value) {
	auto* controller = static_cast<ImgDecController*>(context);
	controller->onCtrlWrite(controller->m_scheduler.currentNowCycles());
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
	const int64_t wholeBytes = accrueBudgetUnits(m_cpuHz, m_decodeBytesPerSec, m_decodeCarry, cycles);
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
	scheduleNextService(m_scheduler.currentNowCycles());
}

void ImgDecController::reset() {
	m_decodeToken += 1;
	m_decodeCarry = 0;
	m_availableDecodeBytes = 0;
	m_active = false;
	m_status = 0;
	m_pendingError = nullptr;
	m_pendingResult.reset();
	m_pendingTargetBase = 0;
	m_pendingTargetCapacity = 0;
	m_activeCapacityLimit = 0;
	m_decodeActive = false;
	m_decodeRemaining = 0;
	m_decodePlan = ImageCopyPlan{};
	m_decodePixels.clear();
	m_decodeQueued = false;
	m_decodeWidth = 0;
	m_decodeHeight = 0;
	m_signalIrq = false;
	m_queuedJobs.clear();
	m_queuedJobHead = 0;
	m_activeResolve = {};
	m_activeReject = {};
	m_scheduler.cancelDeviceService(DeviceServiceImg);
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
	if (len > 0 && !m_memory.readBytes(src, buffer.data(), len)) {
		m_activeResolve = {};
		m_activeReject = {};
		m_status = IMG_STATUS_DONE | IMG_STATUS_ERROR;
		m_memory.writeValue(IO_IMG_STATUS, valueNumber(static_cast<double>(m_status)));
		m_memory.writeValue(IO_IMG_WRITTEN, valueNumber(0.0));
		m_memory.writeValue(IO_IMG_SRC, valueNumber(static_cast<double>(src)));
		m_memory.writeValue(IO_IMG_LEN, valueNumber(static_cast<double>(len)));
		m_memory.writeValue(IO_IMG_DST, valueNumber(static_cast<double>(dst)));
		m_memory.writeValue(IO_IMG_CAP, valueNumber(static_cast<double>(cap)));
		m_irq.raise(IRQ_IMG_ERROR);
		scheduleNextService(nowCycles);
		return;
	}
	m_activeResolve = {};
	m_activeReject = {};
	startJob(std::move(buffer), dst, cap, src, len, true);
	scheduleNextService(nowCycles);
}

void ImgDecController::onService(int64_t nowCycles) {
	if (!m_active) {
		if (!startNextQueuedJob()) {
			m_scheduler.cancelDeviceService(DeviceServiceImg);
			return;
		}
		if (!m_active) {
			return;
		}
	}
	if (m_pendingError) {
		finishError(std::exchange(m_pendingError, nullptr));
		return;
	}
	if (m_pendingResult) {
		auto result = std::move(*m_pendingResult);
		const uint32_t targetBase = m_pendingTargetBase;
		const uint32_t targetCapacity = m_pendingTargetCapacity;
		m_pendingResult.reset();
		m_pendingTargetBase = 0;
		m_pendingTargetCapacity = 0;
		beginDecode(std::move(result), targetBase, targetCapacity);
		if (!m_active) {
			return;
		}
	}
	if (m_decodeActive && m_availableDecodeBytes > 0u) {
		advanceDecode();
		if (!m_active) {
			return;
		}
	}
	scheduleNextService(nowCycles);
}

bool ImgDecController::startNextQueuedJob() {
	if (m_queuedJobHead == m_queuedJobs.size()) {
		return false;
	}
	ImgDecJob job = std::move(m_queuedJobs[m_queuedJobHead]);
	m_queuedJobHead += 1;
	if (m_queuedJobHead == m_queuedJobs.size()) {
		m_queuedJobs.clear();
		m_queuedJobHead = 0;
	}
	const uint32_t len = static_cast<uint32_t>(job.buffer.size());
	const uint32_t dst = job.dst;
	const uint32_t cap = job.cap;
	m_activeResolve = std::move(job.resolve);
	m_activeReject = std::move(job.reject);
	startJob(std::move(job.buffer), dst, cap, 0u, len, false);
	return true;
}

void ImgDecController::startJob(std::vector<uint8_t>&& buffer, uint32_t dst, uint32_t cap, uint32_t src, uint32_t len, bool signalIrq) {
	m_pendingResult.reset();
	m_pendingError = nullptr;
	m_pendingTargetBase = 0;
	m_pendingTargetCapacity = 0;
	m_activeCapacityLimit = 0;
	m_signalIrq = signalIrq;
	m_status = IMG_STATUS_BUSY;
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(static_cast<double>(m_status)));
	m_memory.writeValue(IO_IMG_WRITTEN, valueNumber(0.0));
	m_memory.writeValue(IO_IMG_SRC, valueNumber(static_cast<double>(src)));
	m_memory.writeValue(IO_IMG_LEN, valueNumber(static_cast<double>(len)));
	m_memory.writeValue(IO_IMG_DST, valueNumber(static_cast<double>(dst)));
	m_memory.writeValue(IO_IMG_CAP, valueNumber(static_cast<double>(cap)));

	const uint32_t targetCapacity = decodeTargetCapacity(dst);
	if (targetCapacity == 0u) {
		finishError(nullptr);
		return;
	}
	const uint32_t effectiveCap = cap < targetCapacity ? cap : targetCapacity;
	if (effectiveCap == 0) {
		finishError(nullptr);
		return;
	}
	m_activeCapacityLimit = effectiveCap;
	m_active = true;
	m_decodeActive = false;
	m_decodeRemaining = 0;
	m_decodePlan = ImageCopyPlan{};
	m_decodePixels.clear();
	m_decodeQueued = false;
	m_decodeWidth = 0;
	m_decodeHeight = 0;
	const uint64_t token = m_decodeToken + 1;
	m_decodeToken = token;
	m_microtasks.queueMicrotask([this, dst, targetCapacity, token, buffer = std::move(buffer)]() mutable {
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
			if (token == m_decodeToken) {
				m_pendingError = std::make_exception_ptr(imageDecoderFault("PNG decode failed."));
				scheduleNextService(m_scheduler.currentNowCycles());
			}
			return;
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
			m_pendingTargetBase = dst;
			m_pendingTargetCapacity = targetCapacity;
			scheduleNextService(m_scheduler.currentNowCycles());
		}
	});
}
uint32_t ImgDecController::decodeTargetCapacity(uint32_t dst) const {
	if (dst == VRAM_PRIMARY_SLOT_BASE) {
		return VRAM_PRIMARY_SLOT_SIZE;
	}
	if (dst == VRAM_SECONDARY_SLOT_BASE) {
		return VRAM_SECONDARY_SLOT_SIZE;
	}
	if (dst == VRAM_SYSTEM_SLOT_BASE) {
		return VRAM_SYSTEM_SLOT_SIZE;
	}
	return 0u;
}

void ImgDecController::beginDecode(DecodedImage&& result, uint32_t targetBaseAddr, uint32_t targetCapacity) {
	m_decodePlan = planImageCopy(targetBaseAddr, targetCapacity, result, m_activeCapacityLimit);
	m_activeCapacityLimit = 0;
	m_decodeWidth = result.width;
	m_decodeHeight = result.height;
	m_decodePixels = std::move(result.pixels);
	m_decodeRemaining = m_decodePlan.writeLen;
	m_decodeCarry = 0;
	m_availableDecodeBytes = 0;
	m_decodeActive = true;
	m_decodeQueued = false;
	if (m_decodePlan.writeWidth > 0u && m_decodePlan.writeHeight > 0u) {
		m_vdp.setDecodedVramSurfaceDimensions(targetBaseAddr, m_decodePlan.writeWidth, m_decodePlan.writeHeight);
	}
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
	auto pixels = std::move(m_decodePixels);
	m_decodePixels.clear();
	m_dma.enqueueImageCopy(m_decodePlan, std::move(pixels), [this](bool error, bool clipped) {
		if (error) {
			finishError(nullptr);
			return;
		}
		finishSuccess(clipped);
	});
}

void ImgDecController::finishSuccess(bool clipped) {
	auto activeResolve = std::move(m_activeResolve);
	m_activeResolve = {};
	m_activeReject = {};
	m_active = false;
	m_pendingError = nullptr;
	m_pendingResult.reset();
	m_pendingTargetBase = 0;
	m_pendingTargetCapacity = 0;
	m_activeCapacityLimit = 0;
	m_decodeActive = false;
	m_availableDecodeBytes = 0;
	m_decodeRemaining = 0;
	m_decodeQueued = false;
	m_decodePlan = ImageCopyPlan{};
	m_decodePixels.clear();
	m_status = (m_status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE;
	if (clipped) {
		m_status |= IMG_STATUS_CLIPPED;
	}
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(static_cast<double>(m_status)));
	if (m_signalIrq) {
		m_irq.raise(IRQ_IMG_DONE);
	}
	m_signalIrq = false;
	if (activeResolve) {
		activeResolve(m_decodeWidth, m_decodeHeight, clipped);
	}
	m_decodeWidth = 0;
	m_decodeHeight = 0;
	scheduleNextService(m_scheduler.currentNowCycles());
}

void ImgDecController::finishError(std::exception_ptr error) {
	auto activeReject = std::move(m_activeReject);
	m_activeResolve = {};
	m_activeReject = {};
	m_active = false;
	m_pendingError = nullptr;
	m_pendingResult.reset();
	m_pendingTargetBase = 0;
	m_pendingTargetCapacity = 0;
	m_activeCapacityLimit = 0;
	m_decodeActive = false;
	m_availableDecodeBytes = 0;
	m_decodeRemaining = 0;
	m_decodeQueued = false;
	m_decodePlan = ImageCopyPlan{};
	m_decodePixels.clear();
	m_status = (m_status & ~IMG_STATUS_BUSY) | IMG_STATUS_DONE | IMG_STATUS_ERROR;
	m_memory.writeValue(IO_IMG_STATUS, valueNumber(static_cast<double>(m_status)));
	if (m_signalIrq) {
		m_irq.raise(IRQ_IMG_ERROR);
	}
	m_signalIrq = false;
	if (activeReject) {
		if (!error) {
			error = std::make_exception_ptr(imageDecoderFault("decode failed."));
		}
		activeReject(error);
	}
	m_decodeWidth = 0;
	m_decodeHeight = 0;
	scheduleNextService(m_scheduler.currentNowCycles());
}

void ImgDecController::scheduleNextService(int64_t nowCycles) {
	if (!m_active) {
		if (m_queuedJobHead != m_queuedJobs.size()) {
			m_scheduler.scheduleDeviceService(DeviceServiceImg, nowCycles);
			return;
		}
		m_scheduler.cancelDeviceService(DeviceServiceImg);
		return;
	}
	if (m_pendingError || m_pendingResult.has_value()) {
		m_scheduler.scheduleDeviceService(DeviceServiceImg, nowCycles);
		return;
	}
	if (m_decodeActive && !m_decodeQueued && m_decodeRemaining > 0) {
		const uint32_t pendingBytes = static_cast<uint32_t>(m_decodeRemaining);
		const uint32_t targetBytes = pendingBytes < IMGDEC_SERVICE_BATCH_BYTES ? pendingBytes : IMGDEC_SERVICE_BATCH_BYTES;
		if (m_availableDecodeBytes >= targetBytes) {
			m_scheduler.scheduleDeviceService(DeviceServiceImg, nowCycles);
			return;
		}
		m_scheduler.scheduleDeviceService(DeviceServiceImg, nowCycles + cyclesUntilBudgetUnits(m_cpuHz, m_decodeBytesPerSec, m_decodeCarry, targetBytes - m_availableDecodeBytes));
		return;
	}
	m_scheduler.cancelDeviceService(DeviceServiceImg);
}

} // namespace bmsx
