#include "gles_frame_worker.h"
#include "input.h"

#include "machine/runtime/runtime.h"
#include "render/backend/gles2/backend.h"

#include <algorithm>

namespace bmsx {

GlesFrameWorker::GlesFrameWorker(Runtime& runtime, VideoPresenter& presenter, LibretroInput& input,
	RenderPresentationState& presentation, HostOverlayMenu& overlayMenu, bool singleGuestTick)
	: m_runtime(runtime), m_backend(static_cast<OpenGLES2Backend&>(presenter.backend())), m_input(input),
	  m_presenter(presenter), m_presentation(presentation), m_overlayMenu(overlayMenu), m_singleGuestTick(singleGuestTick),
	  m_batches(std::make_unique<std::array<Batch, QueueCapacity>>()),
	  m_snapshotBytes(runtime.machine.gxGpu.readDeviceOutput().vramSnapshotBytes.size()),
	  m_readbackBytes(GX_GPU_TRANSFER_MAX_BYTE_COUNT),
	  m_thread(&GlesFrameWorker::workerMain, this) {}

GlesFrameWorker::~GlesFrameWorker() {
	// run() is a completed-frame barrier; no frontend operation or destruction
	// races the scheduler or an outstanding GL submission.
	{
		std::lock_guard lock(m_mutex);
		m_shutdown = true;
	}
	m_workAvailable.notify_one();
	m_thread.join();
}

GlesFrameWorker::Batch& GlesFrameWorker::acquireBatch() {
	std::unique_lock lock(m_mutex);
	m_queueChanged.wait(lock, [this] {
		return m_writeSequence - m_readSequence < QueueCapacity || m_submissionError;
	});
	if (m_submissionError) std::rethrow_exception(m_submissionError);
	return (*m_batches)[m_writeSequence % QueueCapacity];
}

u64 GlesFrameWorker::publishBatch() {
	u64 sequence;
	{
		std::lock_guard lock(m_mutex);
		if (m_submissionError) std::rethrow_exception(m_submissionError);
		sequence = ++m_writeSequence;
	}
	m_queueChanged.notify_one();
	return sequence;
}

void GlesFrameWorker::waitConsumed(u64 sequence) {
	std::unique_lock lock(m_mutex);
	m_queueChanged.wait(lock, [this, sequence] {
		return m_readSequence >= sequence || m_submissionError;
	});
	if (m_submissionError) std::rethrow_exception(m_submissionError);
}

void GlesFrameWorker::publishSnapshot() {
	const auto& output = m_runtime.machine.gxGpu.readDeviceOutput();
	if (m_snapshotSerial == output.vramSnapshotSerial) return;
	Batch& batch = acquireBatch();
	batch.operation = Operation::ReplaceVram;
	batch.snapshotSerial = output.vramSnapshotSerial;
	std::copy(output.vramSnapshotBytes.begin(), output.vramSnapshotBytes.end(), m_snapshotBytes.begin());
	// Reset/restore bytes are not borrowed from the live machine. The dedicated
	// payload can be reused only after this ordered replacement is consumed.
	waitConsumed(publishBatch());
	m_snapshotSerial = batch.snapshotSerial;
	m_runtime.machine.gxGpu.completePublishedCommands();
}

void GlesFrameWorker::executeFrame(f64 hostDeltaMs) {
	auto& gpu = m_runtime.machine.gxGpu;
	publishSnapshot();
	auto& scheduler = m_runtime.frameScheduler;
	bool tickCompleted = false;
	if (m_singleGuestTick) tickCompleted = scheduler.runScheduledToNextLogicalTick(m_runtime, hostDeltaMs);
	else scheduler.run(m_runtime, hostDeltaMs);
	for (;;) {
		publishSnapshot();
		if (!gpu.backendServicePending()) break;
		const auto& output = gpu.readDeviceOutput();
		if (gpu.backendSubmissionFencePending()) {
			waitConsumed(m_writeSequence);
			gpu.completePublishedCommands();
		} else if (gpu.backendCommandDrainPending()) {
			Batch& batch = acquireBatch();
			batch.operation = Operation::Commands;
			batch.commands.copyPrefix(output.commandBuffer, output.commandBuffer.executedCommandCount);
			publishBatch();
			// Publication owns the bytes now. Retiring the producer is independent
			// of driver submission, allowing the next guest work to overlap it.
			gpu.retirePublishedCommands();
		} else {
			Batch& batch = acquireBatch();
			auto& readback = output.readbackPort;
			batch.operation = Operation::Readback;
			batch.commands.copyPrefix(output.commandBuffer, readback.fenceCommandCount());
			batch.readback = {readback.x(), readback.y(), readback.width(), readback.height(), readback.vramYAddressExtensionWord()};
			const u32 token = readback.token();
			readback.claimReadback(readback.fenceCommandCount());
			waitConsumed(publishBatch());
			std::copy_n(m_readbackBytes.begin(), static_cast<size_t>(readback.width()) * readback.height() * 2u, readback.pixelBytes());
			readback.completeReadback(token);
			gpu.completePublishedCommands();
		}
		scheduler.synchronizeBackendService(m_runtime);
		if (!m_singleGuestTick) scheduler.run(m_runtime, 0.0);
		else if (!tickCompleted) tickCompleted = scheduler.runScheduledToNextLogicalTick(m_runtime, 0.0);
	}
}

void GlesFrameWorker::publishPresentation(i64 previousTickSequence) {
	m_presentation.syncAfterRuntimeUpdate(m_runtime, previousTickSequence);
	if (m_overlayPresent) m_presentation.requestHeldPresentation();
	RenderPresentation frame;
	const auto* output = m_presentation.prepare(m_runtime, false, frame);
	if (output == nullptr) return;
	Batch& batch = acquireBatch();
	batch.operation = Operation::Present;
	batch.presentation = frame;
	if (m_captureUsage) batch.usage = HostResourceUsage::capture(m_runtime);
	batch.commands.copyPrefix(output->commandBuffer, output->commandBuffer.presentCommandCount);
	publishBatch();
	// The selected presentation prefix is now immutable and independent of the
	// ingress buffer. Held/partial frames retain it, exactly as the direct path.
	if (frame.commitFrame) m_runtime.machine.gxGpu.retirePublishedPresentation();
}

bool GlesFrameWorker::submitRumble(void* context, unsigned port, u16 strength) {
	auto& worker = *static_cast<GlesFrameWorker*>(context);
	Batch& batch = worker.acquireBatch();
	batch.operation = Operation::Rumble;
	batch.rumblePort = port;
	batch.rumbleStrength = strength;
	worker.waitConsumed(worker.publishBatch());
	return worker.m_rumbleApplied;
}

void GlesFrameWorker::workerMain() {
	for (;;) {
		f64 delta;
		{
			std::unique_lock lock(m_mutex);
			m_workAvailable.wait(lock, [this] { return m_jobPending || m_shutdown; });
			if (m_shutdown) return;
			delta = m_deltaTime * 1000.0;
			m_jobPending = false;
		}
		m_input.setRumbleSubmission({&submitRumble, this});
		m_runtime.machine.gxGpu.setBackendSubmissionCommandLimit(SubmissionCommandLimit);
		std::exception_ptr error;
		try {
			const i64 previousTickSequence = m_runtime.frameScheduler.lastTickSequence;
			executeFrame(delta);
			publishPresentation(previousTickSequence);
		} catch (...) {
			error = std::current_exception();
		}
		// The caller may observe, capture or destroy the machine even after a
		// producer exception. Its already published work still has to finish.
		// A failed consumer poisons the stream and cannot acknowledge VRAM.
		try {
			waitConsumed(m_writeSequence);
			m_runtime.machine.gxGpu.completePublishedCommands();
		} catch (...) {
			if (!error) error = std::current_exception();
		}
		m_runtime.machine.gxGpu.setBackendSubmissionCommandLimit(GX_GPU_COMMAND_CAPACITY);
		m_input.setRumbleSubmission({});
		{
			std::lock_guard lock(m_mutex);
			m_workerError = error;
			m_frameDone = true;
		}
		m_queueChanged.notify_one();
	}
}

bool GlesFrameWorker::run(f64 currentTime, f64 deltaTime) {
	{
		std::lock_guard lock(m_mutex);
		// A failed GL publication cancels this stream. It cannot be resumed as
		// though skipped commands had produced valid VRAM.
		if (m_submissionError) std::rethrow_exception(m_submissionError);
		m_currentTime = currentTime;
		m_deltaTime = deltaTime;
		m_presented = false;
		m_overlayPresent = m_overlayMenu.livePresentationRequired(m_presenter);
		m_captureUsage = m_presenter.showResourceUsageGizmo && !m_overlayMenu.active();
		m_frameDone = false;
		m_workerError = nullptr;
		m_jobPending = true;
	}
	m_workAvailable.notify_one();
	for (;;) {
		Batch* batch;
		bool submit;
		{
			std::unique_lock lock(m_mutex);
			m_queueChanged.wait(lock, [this] { return m_readSequence != m_writeSequence || m_frameDone; });
			if (m_readSequence == m_writeSequence && m_frameDone) {
				if (m_submissionError) std::rethrow_exception(m_submissionError);
				if (m_workerError) std::rethrow_exception(m_workerError);
				return m_presented;
			}
			batch = &(*m_batches)[m_readSequence % QueueCapacity];
			submit = !m_submissionError;
		}
		if (submit) {
			try {
				switch (batch->operation) {
				case Operation::Present:
					m_backend.executeGxGpuCommands(batch->commands);
					m_overlayMenu.queueLiveOverlayCommands(m_presenter, 1.0 / m_deltaTime, batch->usage);
					m_presentation.present(m_presenter, batch->presentation, m_currentTime, m_deltaTime);
					m_presented = true;
					break;
				case Operation::Commands:
					m_backend.executeGxGpuCommands(batch->commands);
					break;
				case Operation::Readback:
					m_backend.executeGxGpuCommands(batch->commands);
					m_backend.readGxGpuVram(batch->readback, m_readbackBytes.data());
					break;
				case Operation::Rumble:
					m_rumbleApplied = m_input.applyFrontendRumble(batch->rumblePort, batch->rumbleStrength);
					break;
				case Operation::ReplaceVram:
					m_backend.replaceGxGpuVramSnapshot(m_snapshotBytes, batch->snapshotSerial);
					break;
				}
			} catch (...) {
				std::lock_guard lock(m_mutex);
				m_submissionError = std::current_exception();
			}
		}
		{
			std::lock_guard lock(m_mutex);
			++m_readSequence;
		}
		m_queueChanged.notify_one();
	}
}

} // namespace bmsx
