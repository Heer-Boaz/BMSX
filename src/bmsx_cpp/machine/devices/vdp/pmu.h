#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include <array>

namespace bmsx {

enum class VdpPmuRegister : u8 {
	X,
	Y,
	ScaleX,
	ScaleY,
	Control,
};

struct VdpPmuRegisterWindow {
	u32 bank = 0;
	u32 x = 0;
	u32 y = 0;
	u32 scaleX = 0;
	u32 scaleY = 0;
	u32 control = 0;
};

class VdpPmuUnit {
public:
	VdpPmuUnit();
	void reset();
	u32 selectedBankIndex() const { return m_selectedBank; }
	void selectBank(u32 bank);
	void writeSelectedBankRegister(VdpPmuRegister pmuRegister, u32 value);
	void writeRegisterWindow(VdpPmuRegisterWindow& target) const;
	using BankWords = std::array<u32, VDP_PMU_BANK_WORD_COUNT>;
	void captureBankWords(BankWords& target) const;
	void restoreBankWords(u32 selectedBank, const BankWords& words);

private:
	std::array<VdpPmuBank, VDP_PMU_BANK_COUNT> m_banks{};
	u32 m_selectedBank = 0;
};

} // namespace bmsx
