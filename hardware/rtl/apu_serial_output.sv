`timescale 1ns/1ps
// Candidate physical PCM1754 launch boundary. A single stereo frame register
// accepts a completed playback result immediately and retains it until the
// next fixed serial frame edge. At that edge it may accept a replacement while
// the serializer latches the previous frame. Playback completion and control
// accesses therefore need not wait for the serial boundary. The first
// edge after reset starts the 768-clock playback interval, so it has no prior
// computed frame to admit. This schedules output one frame after the associated
// timeline edge; its compatibility with public start/live-update timing is not
// established and the product specification is not changed by this candidate.
//
// A missed later edge sets a sticky internal diagnostic. The serializer still
// samples the raw frame-register wires, as the physical interface does; this block
// does not claim a public underrun policy or recover a missed frame. Physical
// timing, snapshot order, command/end-event completion and sustained workload
// limits remain the responsibility of their respective owners.
//
// PCM1754 serial sampling and I2S timing: TI SLES092E, sections 7.6 and 8.3.2,
// https://www.ti.com/lit/ds/symlink/pcm1754.pdf
// Deadline failure is distinct from a sample value: ALSA exposes XRUN rather
// than treating a missed stream deadline as successful production,
// https://www.kernel.org/doc/html/latest/sound/kernel-api/writing-an-alsa-driver.html
// LiteX likewise separates serial timing from upstream buffering:
// https://github.com/enjoy-digital/litex/blob/master/litex/soc/cores/i2s.py
module apu_serial_output (
 input wire clk,reset_n,
 input wire frame_valid,output wire frame_ready,
 input wire signed [15:0] frame_left,frame_right,
 output wire frame_latch,output reg deadline_missed,
 output wire mclk,bclk,lrck,serial_data
);
 reg primed,held_valid;
 reg signed [15:0] held_left,held_right;
 apu_i2s_tx transmitter(.clk(clk),.reset_n(reset_n),.frame_left(held_left),.frame_right(held_right),
  .frame_latch(frame_latch),.mclk(mclk),.bclk(bclk),.lrck(lrck),.serial_data(serial_data));
 assign frame_ready=reset_n && (!held_valid || frame_latch);
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin primed<=0;held_valid<=0;held_left<=0;held_right<=0;deadline_missed<=0;end
  else begin
   if(frame_latch) begin
    if(primed && !held_valid) deadline_missed<=1;
    primed<=1;
    held_valid<=0;
   end
   if(frame_valid && frame_ready) begin
    held_left<=frame_left;held_right<=frame_right;held_valid<=1;
   end
  end
 end
endmodule
