#include "machine/cpu/native_compiler_worker.h"

#include <cassert>
#include <chrono>

#include "machine/cpu/native_block_abi.h"

namespace bmsx {

NativeCompilerWorker::NativeCompilerWorker() {
	m_sources.reserve(DECODED_PAGE_WORDS);
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

void NativeCompilerWorker::submit(std::span<const NativeBlockSource> sources, ConstValueSpan constants,
	const NativeCodeBindings& bindings, bool profile) {
	assert(idle());
	m_sources.clear();
	size_t decoded = 0, instruction = 0;
	for (const auto& source : sources) {
		const size_t first = instruction;
		for (const auto& item : source.instructions) {
			m_decoded[decoded] = *item.decoded;
			auto& copy = m_instructions[instruction++];
			copy = item;
			copy.decoded = &m_decoded[decoded++];
		}
		const DecodedInstruction* skipped = nullptr;
		if (source.skippedInstruction) {
			m_decoded[decoded] = *source.skippedInstruction;
			skipped = &m_decoded[decoded++];
		}
		m_sources.push_back({std::span(m_instructions.data() + first, instruction - first), skipped});
	}
	m_constants = constants;
	m_bindings = bindings;
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
			m_blocks = NativeBlock::compileRegion(m_sources, m_constants, m_bindings);
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
	m_state.store(State::Idle, std::memory_order_release);
	if (error) std::rethrow_exception(error);
	return blocks;
}

} // namespace bmsx
