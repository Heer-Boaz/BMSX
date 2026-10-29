`timescale 1ps/1ps
// Clock-loss experiment: no claim of recovery or replacement data. The retained
// diagnostic exposes that the unbackpressured SYS stream exceeded the FIFO.
module gfx_pcrtc_fast_snapshot_stop_tb;
 reg sysclk=0,local_clk=0,local_run=1,reset_n=0,pll_locked=0;
 wire ready,source_reset_n,local_reset_n,overflow,history_lost;
 initial forever #14763 sysclk=~sysclk;
 initial forever begin #9259;if(local_run)local_clk=~local_clk;end
 gfx_pcrtc_fast_snapshot dut(.sysclk(sysclk),.local_clk(local_clk),.reset_n(reset_n),.pll_locked(pll_locked),
  .access_valid(1'b0),.access_write(1'b0),.access_index(5'd0),.access_wdata(32'd0),.access_ready(ready),.access_rdata(),
  .other_events(5'd0),.irq_raise(),.gpu_queue_action(),.gpu_reset_action(),.programmed_words(),.displayed_words(),
  .field(),.field_half_line(),.source_reset_n(source_reset_n),.local_reset_n(local_reset_n),.fifo_ready(),
  .overflow(overflow),.history_lost(history_lost),.snapshot_valid(),.snapshot_reset(),.snapshot_field(),.snapshot_words(),
  .local_words(),.local_field());
 initial begin
  repeat(4)@(negedge sysclk);reset_n=1;pll_locked=1;
  while(!ready)@(negedge sysclk);
  repeat(10)@(negedge sysclk);
  @(negedge local_clk);local_run=0;
  repeat(12)@(negedge sysclk);
  if(!history_lost || !overflow || !ready)$fatal(1,"stopped receiver did not expose unbackpressured loss");
  local_run=1;repeat(15)@(negedge sysclk);
  if(!history_lost)$fatal(1,"missing sticky record of loss");
  @(negedge local_clk);local_run=0;reset_n=0;#1000;
  if(ready || source_reset_n || local_reset_n || history_lost)$fatal(1,"common reset did not clear both domains");
  repeat(8)@(negedge sysclk);reset_n=1;repeat(8)@(negedge sysclk);
  if(ready || source_reset_n || local_reset_n)$fatal(1,"started with stopped local clock");
  local_run=1;while(!ready)@(negedge sysclk);
  repeat(6)@(negedge sysclk);
  if(history_lost || overflow)$fatal(1,"unexpected loss following common restart");
  $display("PASS stopped 54-MHz receiver exposes overflow; common reset and restarted local clock reinitialize both domains");$finish;
 end
 initial begin #100000000;$fatal(1,"watchdog");end
endmodule
