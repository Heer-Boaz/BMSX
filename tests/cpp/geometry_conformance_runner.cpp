#include "machine/machine.h"
#include "spec/bmsx/model.h"
#include "support/cartridge_fixture.h"
#include <fstream>
#include <iostream>

class IdleInput final : public bmsx::InputControllerInputSource {
public:
	void sampleInputControllerSnapshot(bmsx::InputControllerSnapshot&, bmsx::InputControllerSampleContext) override {}
	bool supervisorRequestLineHigh() const override { return false; }
	void applyInputControllerVibrationEffect(bmsx::i32, bmsx::f64, bmsx::f64) override {}
};

int main(int argc, char** argv) {
	if (argc != 2) return 2;
	std::ifstream input(argv[1]);
	bmsx::Memory memory({ {}, bmsx::test::cartridgeSlots() }, bmsx::PSX_MACHINE_SPEC.ramBytes);
	IdleInput idle;
	bmsx::Machine machine(memory, idle, bmsx::PSX_MACHINE_SPEC);
	unsigned count;
	while (input >> count) {
		machine.resetDevices();
		auto& geometry = machine.geometryController;
		geometry.setTiming(1, 1, 0);
		for (unsigned i = 0; i < count; i++) {
			bmsx::u32 address, word;
			input >> address >> word;
			memory.writeMappedWord(address, word);
		}
		bmsx::u32 pairCounterSeed;
		input >> pairCounterSeed;
		if (pairCounterSeed != 0u) {
			auto state = geometry.captureState();
			state.activeJob->exactPairCount = pairCounterSeed;
			state.activeJob->broadphasePairCount = pairCounterSeed;
			geometry.restoreState(state, 0);
			geometry.accrueCycles(1, 1);
			geometry.onService(1);
			const auto progressed = geometry.captureState();
			std::cout << progressed.activeJob->exactPairCount << ' '
				<< progressed.activeJob->broadphasePairCount << ' ';
		}
		geometry.accrueCycles(1000, 1000);
		geometry.onService(1000);
		input >> count;
		for (unsigned i = 0; i < count; i++) {
			bmsx::u32 address;
			input >> address;
			std::cout << memory.readMappedWord(address) << ' ';
		}
		std::cout << '\n';
	}
}
