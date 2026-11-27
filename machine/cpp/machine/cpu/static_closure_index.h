#pragma once

#include "common/primitives.h"
#include "machine/cpu/closure.h"
#include "machine/memory/memory.h"

#include <span>
#include <unordered_map>
#include <vector>

namespace bmsx {

// Rebuildable weak index; neither membership nor iteration order roots a Closure.
class StaticClosureIndex {
public:
	explicit StaticClosureIndex(Memory& memory) : m_memory(memory) {
		memory.attachRamWriteObserver(this, [](void* context, u32 offset) {
			auto& index = *static_cast<StaticClosureIndex*>(context);
			if (index.m_memory.readRamRecordByte(offset) != static_cast<u8>(ValueTag::Closure))
				index.retire(index.m_memory.readRamRecordWord(offset + CLOSURE_PROTOTYPE_ADDRESS), RAM_BASE + offset);
		});
	}
	~StaticClosureIndex() { m_memory.detachRamWriteObserver(); }

	std::span<const u32> find(u32 prototype) const {
		const auto entry = m_groups.find(prototype);
		return entry == m_groups.end() ? std::span<const u32>{} : std::span<const u32>{entry->second};
	}

	void insert(u32 prototype, u32 address) {
		auto& addresses = m_groups[prototype];
		// Restore can find a Closure that firmware linked before its suspended RET.
		if (addresses.size() == 1u) {
			if (addresses.front() == address) return;
			m_positions.emplace(addresses.front(), 0u);
		}
		if (!addresses.empty() && !m_positions.emplace(address, addresses.size()).second) return;
		addresses.push_back(address);
		m_memory.watchRamByte(address - RAM_BASE);
	}

	void clear() {
		for (const auto& group : m_groups)
			for (const u32 address : group.second) m_memory.unwatchRamByte(address - RAM_BASE);
		m_groups.clear();
		m_positions.clear();
	}

private:
	void retire(u32 prototype, u32 address) {
		const auto entry = m_groups.find(prototype);
		if (entry == m_groups.end()) return;
		auto& addresses = entry->second;
		if (addresses.size() == 1u) {
			if (addresses.front() == address) {
				m_groups.erase(entry);
				m_memory.unwatchRamByte(address - RAM_BASE);
			}
			return;
		}
		// Restore during sweep can leave an already-dead Closure unindexed.
		const auto position = m_positions.find(address);
		if (position == m_positions.end()) return;
		m_memory.unwatchRamByte(address - RAM_BASE);
		const u32 last = addresses.back();
		if (last != address) {
			addresses[position->second] = last;
			m_positions.find(last)->second = position->second;
		}
		m_positions.erase(position);
		addresses.pop_back();
		if (addresses.size() == 1u) m_positions.erase(addresses.front());
	}

	Memory& m_memory;
	std::unordered_map<u32, std::vector<u32>> m_groups;
	// Single-entry buckets need no sparse index. In a multi-entry bucket,
	// swap with the end rather than finding and shifting the retiring record.
	std::unordered_map<u32, size_t> m_positions;
};

} // namespace bmsx
