#pragma once

#include <deque>

#include "machine/cpu/execution_image.h"
#include "spec/blua32/instruction_format.h"

namespace bmsx {

// CPU-thread scheduling only: a request retains the source identity, not a
// frame, a decoded instruction snapshot or a worker job. Images outlive demand.
struct NativeDemand {
	Blua32ExecutionImage* image;
	DecodedInstructionPage* page;
	u32 functionAddress, pc, slot;
};

class NativeDemandQueue {
public:
	bool empty() const { return m_requests.empty(); }

	void enqueue(NativeDemand request) {
		const u32 word = (request.pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES;
		auto& roots = request.page->queuedNativeRoots[request.slot];
		if (roots[word]) return;
		m_requests.push_back(request);
		roots.set(word);
	}

	NativeDemand pop() {
		const auto request = m_requests.front();
		m_requests.pop_front();
		request.page->queuedNativeRoots[request.slot].reset((request.pc & MAPPED_PAGE_BYTE_MASK) / INSTRUCTION_BYTES);
		return request;
	}

	void clear() {
		while (!empty()) pop();
	}

private:
	std::deque<NativeDemand> m_requests;
};

} // namespace bmsx
