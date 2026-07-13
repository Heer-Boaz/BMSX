#include "frame_pacer.h"

#define CHECK(condition) do { if (!(condition)) return __LINE__; } while (0)

int main(void) {
	BmsxFramePacer pacer;
	bmsx_frame_pacer_init(&pacer, 1000000000u, 20000000u);
	CHECK(pacer.next_deadline_ns == 1000000000u);

	BmsxFramePacerDecision decision = bmsx_frame_pacer_begin(&pacer, 1000000000u);
	CHECK(!decision.has_elapsed);
	CHECK(!decision.drop_presentation);
	bmsx_frame_pacer_complete(&pacer, 1005000000u, true, 20000000u);
	CHECK(pacer.next_deadline_ns == 1020000000u);

	decision = bmsx_frame_pacer_begin(&pacer, 1040000000u);
	CHECK(decision.has_elapsed);
	CHECK(decision.elapsed_ns == 40000000u);
	CHECK(decision.drop_presentation);
	bmsx_frame_pacer_complete(&pacer, 1045000000u, true, 16683333u);
	CHECK(pacer.frame_period_ns == 16683333u);
	CHECK(pacer.next_deadline_ns == 1036683333u);

	decision = bmsx_frame_pacer_begin(&pacer, 1045000000u);
	CHECK(decision.elapsed_ns == 5000000u);
	CHECK(!decision.drop_presentation);
	bmsx_frame_pacer_complete(&pacer, 1050000000u, false, 16683333u);
	CHECK(pacer.next_deadline_ns == 1050000000u);

	return 0;
}
