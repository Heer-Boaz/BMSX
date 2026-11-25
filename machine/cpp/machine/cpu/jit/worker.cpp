#include "machine/cpu/jit/worker.h"
#include "machine/cpu/decoded_instruction.h"

#include <cassert>
#include <chrono>

#include "machine/cpu/jit/sljit/gate.h"

namespace bmsx {

NativeCompilerWorker::NativeCompilerWorker() {
	// Build the process-wide entry gate before emission moves to the worker.
	nativeBlockGate();
	m_thread = std::thread(&NativeCompilerWorker::run, this);
}

NativeCompilerWorker::~NativeCompilerWorker() {
	{
		std::lock_guard lock(m_mutex);
		m_stop = true;
	}
	m_changed.notify_one();
	m_thread.join();
}

NativeSourceWorkspace& NativeCompilerWorker::beginCapture(size_t instructionBound) {
	assert(idle());
	// Every emitted instruction can reference at most one skipped body.
	// Reserve before handing out pointers; no source row may move until take().
	m_decoded.clear();
	m_decoded.reserve(2 * instructionBound);
	return m_workspace;
}

void NativeCompilerWorker::submit(const NativeCodeBindings& bindings, NativeCompilationOptions options, bool profile) {
	assert(idle());
	m_sourcePages.assign(bindings.sourcePages.begin(), bindings.sourcePages.end());
	m_bindings = bindings;
	m_bindings.sourcePages = m_sourcePages;
	m_options = options;
	m_profile = profile;
	m_error = nullptr;
	{
		std::lock_guard lock(m_mutex);
		m_state.store(State::Compiling, std::memory_order_release);
	}
	m_changed.notify_one();
}

void NativeCompilerWorker::run() {
	std::unique_lock lock(m_mutex);
	for (;;) {
		m_changed.wait(lock, [&] { return m_stop || m_state.load(std::memory_order_acquire) == State::Compiling; });
		if (m_stop) return;
		lock.unlock();
		const auto start = m_profile ? std::chrono::steady_clock::now() : std::chrono::steady_clock::time_point{};
		try {
			m_blocks = m_compiler.compile(m_workspace.sources, m_bindings, m_options, m_workspace.specializations.view());
		} catch (...) {
			// The worker cannot unwind into the CPU. Deliver the original error
			// when the owner consumes this request; do not silently fall back.
			m_error = std::current_exception();
		}
		m_compilationNanoseconds = m_profile ? static_cast<u64>(std::chrono::duration_cast<std::chrono::nanoseconds>(
			std::chrono::steady_clock::now() - start).count()) : 0;
		lock.lock();
		m_state.store(State::Ready, std::memory_order_release);
		m_changed.notify_all();
	}
}

void NativeCompilerWorker::wait() {
	std::unique_lock lock(m_mutex);
	m_changed.wait(lock, [&] { return m_state.load(std::memory_order_acquire) != State::Compiling; });
}

std::vector<std::unique_ptr<NativeBlock>> NativeCompilerWorker::take() {
	assert(ready());
	auto blocks = std::move(m_blocks);
	auto error = std::move(m_error);
	m_workspace.specializations.clear();
	m_state.store(State::Idle, std::memory_order_release);
	if (error) std::rethrow_exception(error);
	return blocks;
}

} // namespace bmsx
