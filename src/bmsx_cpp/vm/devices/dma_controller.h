#pragma once

#include <cstdint>
#include <functional>
#include <vector>

namespace bmsx {

class VmMemory;

class DmaController {
public:
	DmaController(VmMemory& memory, std::function<void(uint32_t)> raiseIrq);

	void tick();

private:
	void tryStart();
	uint32_t resolveMaxWritable(uint32_t dst) const;
	void finishSuccess();
	void finishError();

	bool m_active = false;
	uint32_t m_src = 0;
	uint32_t m_dst = 0;
	uint32_t m_remaining = 0;
	uint32_t m_written = 0;
	uint32_t m_status = 0;
	bool m_clipped = false;
	bool m_strict = false;
	std::vector<uint8_t> m_buffer;
	VmMemory& m_memory;
	std::function<void(uint32_t)> m_raiseIrq;
};

} // namespace bmsx
