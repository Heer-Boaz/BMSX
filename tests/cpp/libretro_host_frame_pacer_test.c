#include "frame_pacer.h"

#define CHECK(condition) do { if (!(condition)) return __LINE__; } while (0)

int main(void) {
	BmsxFramePacer pacer;
	bmsx_frame_pacer_init(&pacer, 1000000000u, 20000000u);
	CHECK(pacer.next_deadline_ns == 1000000000u);

	BmsxFramePacerDecision decision = bmsx_frame_pacer_begin(&pacer, 1000000000u, true);
	CHECK(!decision.has_elapsed);
	CHECK(!decision.drop_presentation);
	CHECK(decision.finish_deadline_ns == 1020000000u);
	bmsx_frame_pacer_complete(&pacer, 1005000000u, true, 20000000u, false);
	CHECK(!pacer.retained_slot);
	CHECK(pacer.next_deadline_ns == 1020000000u);

	decision = bmsx_frame_pacer_begin(&pacer, 1040000000u, true);
	CHECK(decision.has_elapsed);
	CHECK(decision.elapsed_ns == 40000000u);
	CHECK(decision.drop_presentation);
	CHECK(decision.finish_deadline_ns == 1040000000u);
	bmsx_frame_pacer_complete(&pacer, 1045000000u, true, 16683333u, false);
	CHECK(!pacer.retained_slot);
	CHECK(pacer.frame_period_ns == 16683333u);
	CHECK(pacer.next_deadline_ns == 1036683333u);

	decision = bmsx_frame_pacer_begin(&pacer, 1045000000u, true);
	CHECK(decision.elapsed_ns == 5000000u);
	CHECK(!decision.drop_presentation);
	CHECK(decision.finish_deadline_ns == 1053366666u);
	bmsx_frame_pacer_complete(&pacer, 1050000000u, false, 16683333u, false);
	CHECK(!pacer.retained_slot);
	CHECK(pacer.next_deadline_ns == 1050000000u);

	decision = bmsx_frame_pacer_begin(&pacer, 2050000000u, true);
	CHECK(decision.elapsed_ns == 1005000000u);
	CHECK(!decision.drop_presentation);
	CHECK(pacer.next_deadline_ns == 2050000000u);
	bmsx_frame_pacer_complete(&pacer, 2055000000u, true, 20000000u, false);
	CHECK(!pacer.retained_slot);
	CHECK(pacer.next_deadline_ns == 2070000000u);

	decision = bmsx_frame_pacer_begin(&pacer, 2070000000u, true);
	CHECK(!decision.drop_presentation);
	bmsx_frame_pacer_complete(&pacer, 2200000000u, true, 20000000u, false);
	CHECK(!pacer.retained_slot);
	CHECK(pacer.next_deadline_ns == 2200000000u);

	// Reoffers stay inside one absolute slot. Their actual elapsed time
	// still contributes to the next decision instead of being erased.
	bmsx_frame_pacer_init(&pacer, 1000u, 100u);
	decision = bmsx_frame_pacer_begin(&pacer, 1000u, true);
	CHECK(decision.finish_deadline_ns == 1100u);
	bmsx_frame_pacer_complete(&pacer, 1020u, true, 100u, true);
	CHECK(pacer.retained_slot);
	CHECK(pacer.next_deadline_ns == 1000u);
	decision = bmsx_frame_pacer_begin(&pacer, 1020u, true);
	CHECK(decision.elapsed_ns == 20u && decision.finish_deadline_ns == 1100u);
	bmsx_frame_pacer_complete(&pacer, 1070u, true, 100u, true);
	CHECK(pacer.retained_slot);
	decision = bmsx_frame_pacer_begin(&pacer, 1070u, true);
	CHECK(decision.elapsed_ns == 50u && decision.finish_deadline_ns == 1100u);
	bmsx_frame_pacer_complete(&pacer, 1100u, true, 100u, true);
	CHECK(!pacer.retained_slot);
	CHECK(pacer.next_deadline_ns == 1100u);

	bmsx_frame_pacer_init(&pacer, 2000u, 100u);
	bmsx_frame_pacer_complete(&pacer, 2010u, false, 100u, true);
	CHECK(pacer.retained_slot);
	bmsx_frame_pacer_complete(&pacer, 2020u, false, 100u, false);
	CHECK(!pacer.retained_slot);
	CHECK(pacer.next_deadline_ns == 2020u);
	bmsx_frame_pacer_init(&pacer, 3000u, 100u);
	bmsx_frame_pacer_begin(&pacer, 3000u, true);
	bmsx_frame_pacer_complete(&pacer, 3010u, true, 100u, true);
	decision = bmsx_frame_pacer_begin(&pacer, 3105u, true);
	CHECK(!decision.retain_frame_grant && !decision.drop_presentation);
	CHECK(pacer.next_deadline_ns == 3100u && decision.finish_deadline_ns == 3200u);


	return 0;
}
