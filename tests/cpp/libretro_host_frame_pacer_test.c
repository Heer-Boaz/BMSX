#include "frame_pacer.h"

#define CHECK(condition) do { if (!(condition)) return __LINE__; } while (0)

int main(void) {
	BmsxFramePacer pacer;
	bmsx_frame_pacer_init(&pacer, 1000000000u, 20000000u);
	CHECK(pacer.next_deadline_ns == 1000000000u);

	BmsxFramePacerDecision decision = bmsx_frame_pacer_begin(&pacer, 1000000000u);
	CHECK(!decision.has_elapsed);
	CHECK(!decision.drop_presentation);
	CHECK(decision.finish_deadline_ns == 1020000000u);
	bmsx_frame_pacer_complete(&pacer, 1005000000u, true, 20000000u);
	CHECK(pacer.next_deadline_ns == 1020000000u);

	decision = bmsx_frame_pacer_begin(&pacer, 1040000000u);
	CHECK(decision.has_elapsed);
	CHECK(decision.elapsed_ns == 40000000u);
	CHECK(decision.drop_presentation);
	CHECK(decision.finish_deadline_ns == 1040000000u);
	bmsx_frame_pacer_complete(&pacer, 1045000000u, true, 16683333u);
	CHECK(pacer.frame_period_ns == 16683333u);
	CHECK(pacer.next_deadline_ns == 1036683333u);

	decision = bmsx_frame_pacer_begin(&pacer, 1045000000u);
	CHECK(decision.elapsed_ns == 5000000u);
	CHECK(!decision.drop_presentation);
	CHECK(decision.finish_deadline_ns == 1053366666u);
	bmsx_frame_pacer_complete(&pacer, 1050000000u, false, 16683333u);
	CHECK(pacer.next_deadline_ns == 1050000000u);

	decision = bmsx_frame_pacer_begin(&pacer, 2050000000u);
	CHECK(decision.elapsed_ns == 1005000000u);
	CHECK(!decision.drop_presentation);
	CHECK(pacer.next_deadline_ns == 2050000000u);
	bmsx_frame_pacer_complete(&pacer, 2055000000u, true, 20000000u);
	CHECK(pacer.next_deadline_ns == 2070000000u);

	decision = bmsx_frame_pacer_begin(&pacer, 2070000000u);
	CHECK(!decision.drop_presentation);
	bmsx_frame_pacer_complete(&pacer, 2200000000u, true, 20000000u);
	CHECK(pacer.next_deadline_ns == 2200000000u);

	// Missed presentations advance the same absolute schedule until caught up.
	bmsx_frame_pacer_init(&pacer, 1000u, 100u);
	decision = bmsx_frame_pacer_begin(&pacer, 1000u);
	CHECK(!decision.drop_presentation && decision.finish_deadline_ns == 1100u);
	bmsx_frame_pacer_complete(&pacer, 1320u, true, 100u);
	CHECK(pacer.next_deadline_ns == 1100u);
	decision = bmsx_frame_pacer_begin(&pacer, 1320u);
	CHECK(decision.drop_presentation && decision.elapsed_ns == 320u && decision.finish_deadline_ns == 1200u);
	bmsx_frame_pacer_complete(&pacer, 1325u, true, 100u);
	CHECK(pacer.next_deadline_ns == 1200u);
	decision = bmsx_frame_pacer_begin(&pacer, 1325u);
	CHECK(decision.drop_presentation && decision.elapsed_ns == 5u && decision.finish_deadline_ns == 1300u);
	bmsx_frame_pacer_complete(&pacer, 1330u, true, 100u);
	CHECK(pacer.next_deadline_ns == 1300u);
	decision = bmsx_frame_pacer_begin(&pacer, 1330u);
	CHECK(!decision.drop_presentation && decision.elapsed_ns == 5u && decision.finish_deadline_ns == 1400u);

	return 0;
}
