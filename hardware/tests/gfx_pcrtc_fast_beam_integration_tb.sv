`timescale 1ps/1ps
// Real PCRTC SYS owner -> ordered async FIFO -> 54 MHz display beam. The
// scoreboarding equations below independently advance every LOCAL edge, not
// just pixel strobes. Includes rapid changes and repeated equal-value RESETs.
module gfx_pcrtc_fast_beam_integration_tb;
 reg sysclk=0,local_clk=0,reset_n=0,pll_locked=0,valid=0,write=1;
 reg [4:0] index=0;reg [31:0] data=0;
 wire ready,sys_reset_n,local_reset_n,fifo_ready,overflow,lost;
 wire snap_valid,snap_reset,snap_field;wire [703:0] snap_words;
 integer phase=0;
 initial forever #14763 sysclk=~sysclk;
 initial begin if($value$plusargs("PHASE=%d",phase)) begin end #(phase);forever #9259 local_clk=~local_clk;end
 gfx_pcrtc_fast_snapshot src(.sysclk(sysclk),.local_clk(local_clk),.reset_n(reset_n),.pll_locked(pll_locked),
  .access_valid(valid),.access_write(write),.access_index(index),.access_wdata(data),.access_ready(ready),.access_rdata(),
  .other_events(5'd0),.irq_raise(),.gpu_queue_action(),.gpu_reset_action(),.programmed_words(),.displayed_words(),
  .field(),.field_half_line(),.source_reset_n(sys_reset_n),.local_reset_n(local_reset_n),
  .fifo_ready(fifo_ready),.overflow(overflow),.history_lost(lost),.snapshot_valid(snap_valid),
  .snapshot_reset(snap_reset),.snapshot_field(snap_field),.snapshot_words(snap_words),.local_words(),.local_field());
 reg [1:0] pixel_phase=0;wire pixel_tick=(pixel_phase==3);
 always @(posedge local_clk or negedge reset_n) if(!reset_n) pixel_phase<=0; else if(local_reset_n) pixel_phase<=pixel_phase+1'b1;
 wire sample_valid,sample_field,sample_running,x_valid;
 wire [703:0] sample_words;wire [22:0] sample_period,sample_phase;wire [14:0] sample_line;
 wire [63:0] sample_elapsed;wire [31:0] sample_x;
 gfx_pcrtc_fast_beam dut(.clk(local_clk),.reset_n(local_reset_n),.pixel_tick(pixel_tick),
  .snapshot_valid(snap_valid),.snapshot_reset(snap_reset),.snapshot_field(snap_field),.snapshot_words(snap_words),
  .sample_valid(sample_valid),.sample_field(sample_field),.sample_running(sample_running),.sample_words(sample_words),
  .sample_period(sample_period),.sample_phase(sample_phase),.sample_half_line(sample_line),
  .sample_elapsed_half_lines(sample_elapsed),.sample_x_valid(x_valid),.sample_x(sample_x));
 reg have=0,model_field=0,model_running=0;reg [703:0] model_words=0;
 integer period=0,increment=0,phase_value=0,line=0,total=0;reg [63:0] elapsed=0;
 integer h,d,v,count;
 reg pending_valid=0,expect_valid=0,pending_field=0,pending_running=0,expect_field=0,expect_running=0;
 reg [703:0] pending_words=0,expect_words=0;
 integer pending_period=0,pending_phase=0,pending_line=0,expect_period=0,expect_phase=0,expect_line=0;
 reg [63:0] pending_elapsed=0,expect_elapsed=0;
 integer checks=0,resets=0,restarts=0,expected_x,expected_step,expected_divider;
 wire timing_changed=snap_words[12*32+:64]!=model_words[12*32+:64] || snap_words[16*32+:192]!=model_words[16*32+:192];
 always @(posedge local_clk) if(local_reset_n) begin
  expect_valid=pending_valid;expect_field=pending_field;expect_running=pending_running;expect_words=pending_words;
  expect_period=pending_period;expect_phase=pending_phase;expect_line=pending_line;expect_elapsed=pending_elapsed;
  if(snap_valid && (snap_reset || !have || timing_changed)) begin
   h=snap_words[16*32+:11]+snap_words[16*32+11+:11]+snap_words[17*32+11+:16]+snap_words[18*32+:11]+snap_words[18*32+11+:16];
   d=snap_words[12*32+:3]*(snap_words[12*32+10+:2]+1);
   period=2*h*d;increment=snap_words[12*32+3+:7];
   v=snap_words[20*32+:10]+snap_words[20*32+10+:10]+snap_words[20*32+20+:12]+
     snap_words[21*32+:10]+snap_words[21*32+10+:11]+snap_words[21*32+21+:11];
   total=snap_words[13*32+4] ? 2*v : v;
   model_running=!snap_words[12*32+16] && !snap_words[12*32+17] && period!=0 && increment!=0 && total!=0;
   phase_value=0;line=0;elapsed=0;
   if(snap_reset)resets=resets+1;else restarts=restarts+1;
  end else if(model_running) begin
   phase_value=phase_value+increment;count=phase_value/period;phase_value=phase_value%period;
   line=(line+count)%total;elapsed=elapsed+count;
  end
  if(snap_valid) begin have=1;model_field=snap_field;model_words=snap_words;end
  pending_valid=pixel_tick && have;
  if(pending_valid) begin
   pending_field=model_field;pending_running=model_running;pending_words=model_words;
   pending_period=period;pending_phase=phase_value;pending_line=line;pending_elapsed=elapsed;
  end
 end
 always @(negedge local_clk) if(local_reset_n) begin
  if(sample_valid!==expect_valid)$fatal(1,"sample validity mismatch");
  if(sample_valid) begin
   if(sample_field!==expect_field || sample_running!==expect_running || sample_words!==expect_words ||
      sample_period!==expect_period || sample_phase!==expect_phase || sample_line!==expect_line || sample_elapsed!==expect_elapsed)
    $fatal(1,"beam sample mismatch phase=%0d got=%0d/%0d/%0d want=%0d/%0d/%0d",phase,sample_period,sample_phase,sample_elapsed,expect_period,expect_phase,expect_elapsed);
   expected_step=expect_words[12*32+21+:4];
   expected_divider=expect_words[12*32+:3]*(expect_words[12*32+10+:2]+1);
   if(x_valid !== (expect_running && expected_step!=0)) $fatal(1,"horizontal x validity mismatch");
   if(x_valid) begin
    expected_x=(expect_phase+(expect_elapsed[0] ? expect_period : 0))/(4*expected_divider*expected_step);
    if(sample_x!==expected_x) $fatal(1,"horizontal x mismatch: got=%0d expected=%0d",sample_x,expected_x);
   end
   checks=checks+1;
  end
 end
 always @(posedge sysclk) if(reset_n && (overflow || lost))$fatal(1,"snapshot FIFO overflow");
 task wr(input [4:0] i,input [31:0] w);
  begin @(negedge sysclk);valid=1;index=i;data=w;while(!ready)@(negedge sysclk);end
 endtask
 integer k;
 initial begin
  repeat(4)@(negedge sysclk);reset_n=1;pll_locked=1;while(!ready)@(negedge sysclk);
  wr(5'd12,32'h002023f9);wr(5'd13,0);wr(5'd16,1);wr(5'd17,0);wr(5'd18,0);wr(5'd20,1);wr(5'd21,32'h00200400);
  for(k=1;k<=400;k=k+1)wr(5'd0,k);
  for(k=0;k<20;k=k+1)wr(5'd22,32'h200);
  @(negedge sysclk);valid=0;repeat(30)@(negedge sysclk);
  if(checks<100 || resets<20 || restarts<1)$fatal(1,"missing coverage checks=%0d resets=%0d restarts=%0d",checks,resets,restarts);
  $display("PASS real PCRTC -> ordered 54MHz beam -> 4:1 sample, phase=%0d ps, %0d samples, %0d timing restarts, %0d resets",phase,checks,restarts,resets);$finish;
 end
 initial begin #1000000000;$fatal(1,"timeout");end
endmodule
