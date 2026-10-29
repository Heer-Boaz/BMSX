`timescale 1ns/1ps
// One 13.5 MHz step must equal four 54 MHz steps for every tested timing,
// including short half-lines crossing multiple fields within one pixel.
module gfx_pcrtc_fast_beam_ratio_tb;
 reg slow=0,fast=0,reset_n=0,cfg=0,reset_action=0;
 reg [31:0] smode1=0,sync1=0,syncv=0,syncvh=0;
 wire slow_running,fast_running,slow_field,fast_field;
 wire [22:0] slow_period,fast_period,slow_phase,fast_phase;
 wire [14:0] slow_line,fast_line;wire [63:0] slow_elapsed,fast_elapsed;
 gfx_pcrtc_beam_phase r(.clk(slow),.reset_n(reset_n),.soft_reset(reset_action),.cfg_valid(cfg),
  .cfg_smode1(smode1),.cfg_smode1_high(32'd0),.cfg_synch1_low(sync1),.cfg_synch1_high(32'd0),
  .cfg_synch2_low(32'd0),.cfg_syncv_low(syncv),.cfg_syncv_high(syncvh),
  .running(slow_running),.period_numerator(slow_period),.phase(slow_phase),.increment(),.total_half_lines(),
  .field_half_line(slow_line),.active_half_lines(),.vsync_half_line(),.elapsed_half_lines(slow_elapsed),
  .elapsed_fields(),.crossed_half_lines(),.crossed_fields(),.crossed_vblank_entries(),.crossed_vsyncs(),
  .vblank_before_write(),.vblank_after_restart(),.hsync_before_write(),.vsync_before_write(),.vsync_after_restart(),
  .field_before_write(),.vblank_active(),.field(slow_field));
 gfx_pcrtc_beam_phase #(.REFERENCE_CLOCK_X4(1)) f(.clk(fast),.reset_n(reset_n),.soft_reset(reset_action),.cfg_valid(cfg),
  .cfg_smode1(smode1),.cfg_smode1_high(32'd0),.cfg_synch1_low(sync1),.cfg_synch1_high(32'd0),
  .cfg_synch2_low(32'd0),.cfg_syncv_low(syncv),.cfg_syncv_high(syncvh),
  .running(fast_running),.period_numerator(fast_period),.phase(fast_phase),.increment(),.total_half_lines(),
  .field_half_line(fast_line),.active_half_lines(),.vsync_half_line(),.elapsed_half_lines(fast_elapsed),
  .elapsed_fields(),.crossed_half_lines(),.crossed_fields(),.crossed_vblank_entries(),.crossed_vsyncs(),
  .vblank_before_write(),.vblank_after_restart(),.hsync_before_write(),.vsync_before_write(),.vsync_after_restart(),
  .field_before_write(),.vblank_active(),.field(fast_field));
 task pulse(input bit with_slow);
  begin fast=1;if(with_slow)slow=1;#1;fast=0;slow=0;#1;end
 endtask
 integer i,j,rc,lc,h,v,checks=0;
 initial begin
  #2;reset_n=1;
  for(i=0;i<150;i=i+1)begin
   rc=(i%7)+1;lc=(i%3==0 ? 127 : i%3==1 ? 64 : 1);h=(i%19)+1;v=(i%5)+1;
   smode1=rc | (lc<<3) | (1<<13) | (4<<21);sync1=h;syncv=v;syncvh=0;
   cfg=1;reset_action=1;pulse(1);cfg=0;reset_action=0;
   for(j=0;j<10;j=j+1)begin
    pulse(0);pulse(0);pulse(0);pulse(1);
    if(fast_running!==slow_running || fast_period!==2*slow_period || fast_phase!==2*slow_phase ||
       fast_line!==slow_line || fast_elapsed!==slow_elapsed || fast_field!==slow_field)
     $fatal(1,"ratio mismatch i=%0d j=%0d period=%0d/%0d phase=%0d/%0d elapsed=%0d/%0d",i,j,fast_period,slow_period,fast_phase,slow_phase,fast_elapsed,slow_elapsed);
    checks=checks+1;
   end
  end
  $display("PASS 54MHz beam equals four reference substeps: %0d checkpoints across 150 configurations",checks);$finish;
 end
endmodule
