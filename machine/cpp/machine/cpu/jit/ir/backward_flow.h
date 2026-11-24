#pragma once

#include <cstddef>
#include <vector>

namespace bmsx {

// Specialization can remove local edges, but never adds one. Keep the original
// predecessors for scheduling; each transfer reads the edges of its own phase.
class NativeBackwardFlow {
public:
	void reset(const auto& blocks) {
		m_count = blocks.size();
		m_hasForwardEdge = m_hasBackEdge = false;
		for (size_t i = 0; i < m_count; ++i)
			for (const auto target : blocks[i].successors) {
				m_hasBackEdge |= target <= i;
				m_hasForwardEdge |= target > i && target < m_count;
			}
		if (!m_hasBackEdge) return;
		const size_t end = blocks.size() * 2;
		m_pendingBlocks.resize(blocks.size());
		m_predecessorLinks.resize(end);
		for (size_t i = 0; i < blocks.size(); ++i) {
			m_pendingBlocks[i] = {end, false};
		}
		for (size_t i = 0; i < blocks.size(); ++i) {
			const auto successors = blocks[i].successors;
			for (size_t edge = 0; edge < 2; ++edge) {
				const auto target = successors[edge];
				if (target == blocks.size() || (edge && target == successors[0])) continue;
				const size_t link = i * 2 + edge;
				m_predecessorLinks[link] = m_pendingBlocks[target].first;
				m_pendingBlocks[target].first = link;
			}
		}
	}

	bool hasForwardEdge() const { return m_hasForwardEdge; }

	void solve(const auto& transfer) {
		if (!m_hasBackEdge) {
			for (size_t i = m_count; i-- > 0;) transfer(i);
			return;
		}
		const size_t end = m_count * 2;
		m_worklist.resize(m_count);
		for (size_t i = 0; i < m_count; ++i) {
			m_worklist[i] = i;
			m_pendingBlocks[i].queued = true;
		}
		while (!m_worklist.empty()) {
			const size_t i = m_worklist.back();
			m_worklist.pop_back();
			m_pendingBlocks[i].queued = false;
			if (!transfer(i)) continue;
			for (size_t link = m_pendingBlocks[i].first; link != end; link = m_predecessorLinks[link]) {
				const size_t pred = link / 2;
				if (!m_pendingBlocks[pred].queued) {
					m_worklist.push_back(pred);
					m_pendingBlocks[pred].queued = true;
				}
			}
		}
	}

private:
	struct PendingBlock { size_t first; bool queued; };
	size_t m_count = 0;
	bool m_hasForwardEdge = false, m_hasBackEdge = false;
	std::vector<PendingBlock> m_pendingBlocks;
	std::vector<size_t> m_predecessorLinks, m_worklist;
};
} // namespace bmsx
