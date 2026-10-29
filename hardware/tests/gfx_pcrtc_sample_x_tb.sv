`timescale 1ns/1ps
module gfx_pcrtc_sample_x_tb;
 reg clk=0,reset_n=0,cfg_valid=0;
 always #5 clk=~clk;
 reg [31:0] sm1=0,h1=0,h1high=0,h2=0;
 // Model the display epoch separately from the immediately writable live
 // timing epoch. The VBlank latch/CDC that would configure this display
 // instance is not included in this focused arithmetic test.
 wire running;wire [22:0] period,phase;wire [63:0] half_lines;
 reg live_cfg_valid=0;reg [31:0] live_sm1=0;
 wire live_running;
 wire valid;wire [31:0] output_x;
 gfx_pcrtc_beam_phase display_beam(.clk(clk),.reset_n(reset_n),.soft_reset(1'b0),
  .cfg_valid(cfg_valid),.cfg_smode1(sm1),.cfg_smode1_high(32'd0),
  .cfg_synch1_low(h1),.cfg_synch1_high(h1high),.cfg_synch2_low(h2),
  .cfg_syncv_low(32'd0),.cfg_syncv_high(32'h00000c00),
  .running(running),.period_numerator(period),.phase(phase),.increment(),
  .total_half_lines(),.field_half_line(),.active_half_lines(),.vsync_half_line(),
  .elapsed_half_lines(half_lines),.elapsed_fields(),.crossed_half_lines(),.crossed_fields(),
  .crossed_vblank_entries(),.crossed_vsyncs(),.vblank_before_write(),.vblank_after_restart(),
  .hsync_before_write(),.vsync_before_write(),.vsync_after_restart(),.field_before_write(),
  .vblank_active(),.field());
 gfx_pcrtc_beam_phase live_beam(.clk(clk),.reset_n(reset_n),.soft_reset(1'b0),
  .cfg_valid(live_cfg_valid),.cfg_smode1(live_sm1),.cfg_smode1_high(32'd0),
  .cfg_synch1_low(h1),.cfg_synch1_high(h1high),.cfg_synch2_low(h2),
  .cfg_syncv_low(32'd0),.cfg_syncv_high(32'h00000c00),
  .running(live_running),.period_numerator(),.phase(),.increment(),
  .total_half_lines(),.field_half_line(),.active_half_lines(),.vsync_half_line(),
  .elapsed_half_lines(),.elapsed_fields(),.crossed_half_lines(),.crossed_fields(),
  .crossed_vblank_entries(),.crossed_vsyncs(),.vblank_before_write(),.vblank_after_restart(),
  .hsync_before_write(),.vsync_before_write(),.vsync_after_restart(),.field_before_write(),
  .vblank_active(),.field());
 gfx_pcrtc_sample_x mapper(.running(running),.smode1(sm1),.period_numerator(period),
  .phase(phase),.elapsed_half_lines(half_lines),.sample_valid(valid),.output_x(output_x));
 integer lc,rc,divfield,step,h,divisor,expected_phase,expected_half,total,expected_x,n,cases=0;
 task check_case(input integer ih,input integer irc,input integer idf,input integer ilc,input integer istep);
  begin
   @(negedge clk);h=ih;rc=irc;divfield=idf;lc=ilc;step=istep;
   if(h==137211)begin h1=32'h003fffff;h1high=32'h07fff800;h2=32'h07ffffff;end
   else begin h1=h;h1high=0;h2=0;end
   sm1=(step<<21)|(divfield<<10)|(lc<<3)|rc;cfg_valid=1;
   @(negedge clk);cfg_valid=0;expected_phase=0;expected_half=0;
   divisor=rc*(divfield+1);cases=cases+1;
   for(n=0;n<(h==137211 ? 31000 : 600);n=n+1)begin
    #1;
    expected_x=((expected_half%2)*h*divisor+expected_phase)/(2*divisor*step);
    if(!valid || period!==h*divisor || phase!==expected_phase ||
       half_lines!==expected_half || output_x!==expected_x)
     $fatal(1,"case=%0d sample=%0d h=%0d D=%0d lc=%0d step=%0d expected=(%0d,%0d,%0d) actual=(%0d,%0d,%0d)",
      cases,n,h,divisor,lc,step,expected_half,expected_phase,expected_x,half_lines,phase,output_x);
    total=expected_phase+2*lc;
    expected_half=expected_half+total/(h*divisor);expected_phase=total%(h*divisor);
    @(negedge clk);
   end
  end
 endtask
 initial begin
  repeat(3)@(negedge clk);reset_n=1;
  check_case(864,1,0,1,1);
  check_case(864,1,0,4,15);
  check_case(23,7,3,127,3);
  check_case(1,1,0,127,15);
  check_case(2047,7,3,127,1);
  check_case(137211,7,3,127,1);
  // An immediate live stop is not a latched-display stop. This only tests
  // the separate phase-owner model; it does not implement the latch itself.
  @(negedge clk);live_sm1=sm1;live_cfg_valid=1;
  @(negedge clk);live_cfg_valid=0;
  if(!live_running || !running || !valid)$fatal(1,"epochs failed to start");
  @(negedge clk);live_sm1=live_sm1 | (32'h1<<16);live_cfg_valid=1;
  @(negedge clk);live_cfg_valid=0;
  if(live_running || !running || !valid)$fatal(1,"live stop affected display epoch");
  @(negedge clk);sm1=sm1 & ~(32'hf<<21);cfg_valid=1;
  @(negedge clk);cfg_valid=0;#1;
  if(!running || valid)$fatal(1,"zero display StepX must not assert pixel valid");
  $display("PASS candidate display phase to logical X: %0d coherent configurations, 34000 samples, separate live stop and zero display step",cases);
  $finish;
 end
endmodule
