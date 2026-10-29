`timescale 1ps/1ps
// Nominal, zero-route-delay PCM1754 FMT=0 input timing and reset-phase check.
// TI SLES092E sections 7.6 and 7.7 specify SCK H/L >=7 ns, BCK H/L >=35 ns,
// DATA setup/hold and BCK/LRCK separation >=10 ns. This is an ideal digital
// source test, not a qualification of output-cell slew, board delay or jitter.
module apu_i2s_timing_tb;
 // 14763 ps half-cycle approximates the nominal 33.8688 MHz reference.
 reg clk=0;always #14763 clk=~clk;
 reg reset_n=0;
 reg [15:0] left=16'h8001,right=16'h7ffe;
 wire frame_latch,mclk,bclk,lrck,data;
 wire timeline_ready,frame_valid,frame_tick;
 wire [31:0] sample_sequence,completed_sequence;wire [63:0] pending;
 apu_i2s_tx tx(.clk(clk),.reset_n(reset_n),.frame_left(left),.frame_right(right),
  .frame_latch(frame_latch),.mclk(mclk),.bclk(bclk),.lrck(lrck),.serial_data(data));
 apu_frame_timeline timeline(.clk(clk),.reset_n(reset_n),.snapshot_overflow(1'b0),.snapshot_history_lost(),.executor_busy(1'b0),
  .timeline_ready(timeline_ready),.frame_valid(frame_valid),.frame_ready(1'b1),.frame_done(1'b1),
  .sample_sequence(sample_sequence),.completed_sequence(completed_sequence),.pending_frames(pending),.frame_tick(frame_tick));

 reg armed=0,seen_mclk_rise=0,seen_mclk_fall=0,seen_bclk_rise=0,seen_bclk_fall=0;
 reg seen_data=0,seen_lrck=0;
 time last_mclk_rise=0,last_mclk_fall=0,last_bclk_rise=0,last_bclk_fall=0;
 time last_data=0,last_lrck=0;
 integer cycles=0,last_frame_cycle=0,frames=0,bck_edges=0,mclk_edges=0,data_changes=0;
 integer prior_frame_bck=0,prior_frame_mclk=0;

 // Both resettable owners must start in the same phase, including warm reset.
 always @(posedge clk) if(reset_n) begin
  if(frame_latch!==frame_tick)$fatal(1,"DAC latch and timeline frame edge differ");
  if(armed) begin
   cycles=cycles+1;
   if(frame_latch) begin
    if(last_frame_cycle!=0) begin
     if(cycles-last_frame_cycle!=768)$fatal(1,"wrong frame duration");
     if(bck_edges-prior_frame_bck!=64)$fatal(1,"wrong BCK/frame ratio");
     if(mclk_edges-prior_frame_mclk!=256)$fatal(1,"wrong SCK/frame ratio");
    end
    last_frame_cycle=cycles;prior_frame_bck=bck_edges;prior_frame_mclk=mclk_edges;
    frames=frames+1;
   end
  end
 end
 always @(posedge mclk) if(armed) begin
  if(seen_mclk_fall && $time-last_mclk_fall<7000)$fatal(1,"SCK low below 7 ns");
  last_mclk_rise=$time;seen_mclk_rise=1;mclk_edges=mclk_edges+1;
 end
 always @(negedge mclk) if(armed) begin
  if(seen_mclk_rise && $time-last_mclk_rise<7000)$fatal(1,"SCK high below 7 ns");
  last_mclk_fall=$time;seen_mclk_fall=1;
 end
 always @(posedge bclk) if(armed) begin
  if(seen_bclk_fall && $time-last_bclk_fall<35000)$fatal(1,"BCK low below 35 ns");
  if(seen_data && $time-last_data<10000)$fatal(1,"DATA setup below 10 ns");
  if(seen_lrck && $time-last_lrck<10000)$fatal(1,"LRCK setup below 10 ns");
  last_bclk_rise=$time;seen_bclk_rise=1;bck_edges=bck_edges+1;
 end
 always @(negedge bclk) if(armed) begin
  if(seen_bclk_rise && $time-last_bclk_rise<35000)$fatal(1,"BCK high below 35 ns");
  last_bclk_fall=$time;seen_bclk_fall=1;
 end
 always @(data) if(armed) begin
  if(seen_bclk_rise && $time-last_bclk_rise<10000)$fatal(1,"DATA hold below 10 ns");
  last_data=$time;seen_data=1;data_changes=data_changes+1;
  #1;if(bclk!==0)$fatal(1,"DATA changed while BCK high");
 end
 always @(lrck) if(armed) begin
  if(seen_bclk_rise && $time-last_bclk_rise<10000)$fatal(1,"LRCK changed too close to BCK rise");
  last_lrck=$time;seen_lrck=1;
  #1;if(bclk!==0)$fatal(1,"LRCK changed while BCK high");
 end

 task automatic run_frames;
  begin
   // Start measurement after a complete latched frame, so reset gating's
   // partial first pulse is not mistaken for qualified steady-state timing.
   wait(frame_latch);@(posedge clk);@(negedge clk);
   cycles=0;last_frame_cycle=0;frames=0;bck_edges=0;mclk_edges=0;data_changes=0;
   prior_frame_bck=0;prior_frame_mclk=0;seen_mclk_rise=0;seen_mclk_fall=0;
   seen_bclk_rise=0;seen_bclk_fall=0;seen_data=0;seen_lrck=0;armed=1;
   repeat(2300)@(posedge clk);@(negedge clk);armed=0;
   if(frames<2 || data_changes<4 || bck_edges<128)$fatal(1,"insufficient waveform coverage");
  end
 endtask
 initial begin
  repeat(3)@(negedge clk);reset_n=1;
  run_frames();
  // Reinitialize both clock generators midway through a frame and recheck.
  repeat(73)@(negedge clk);reset_n=0;
  repeat(3)@(negedge clk);left=16'h1234;right=16'hfedc;reset_n=1;
  run_frames();
  $display("PASS nominal PCM1754 clock/data timing, I2S/timeline phase, reset and warm-reset rephase; ideal digital outputs only");$finish;
 end
 initial begin #250000000;$fatal(1,"timeout");end
endmodule
