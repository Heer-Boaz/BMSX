`timescale 1ps/1ps
// The real system-side PCRTC, not a synthetic FIFO producer: rapid VBlank
// captures, current FIELD transitions, distinct register-bank contents and
// consecutive software RESET actions all cross to the 54-MHz receiver.
module gfx_pcrtc_fast_snapshot_tb;
 reg sysclk=0,local_clk=0,reset_n=0,pll_locked=0;
 reg valid=1,write=1;reg [4:0] index=0;reg [31:0] data=32'h12345678;
 wire ready,sys_reset_n,local_reset_n,fifo_ready,overflow,lost;
 wire field,snap_valid,snap_reset,snap_field;wire [703:0] programmed,displayed,snap_words,local_words;
 wire local_field,gpu_reset;
 integer phase=0,sent=0,received=0,resets=0,field_changes=0,bank_changes=0,accesses=0;
 reg [705:0] expected[0:8191];reg prior_reset=0;reg old_field=0;reg [703:0] old_words=0;
 reg [704:0] last_received=0;reg have_received=0;
 initial forever #14763 sysclk=~sysclk;
 initial begin if($value$plusargs("PHASE=%d",phase)) begin end #(phase);forever #9259 local_clk=~local_clk;end
 gfx_pcrtc_fast_snapshot dut(.sysclk(sysclk),.local_clk(local_clk),.reset_n(reset_n),.pll_locked(pll_locked),
  .access_valid(valid),.access_write(write),.access_index(index),.access_wdata(data),.access_ready(ready),.access_rdata(),
  .other_events(5'd0),.irq_raise(),.gpu_queue_action(),.gpu_reset_action(gpu_reset),
  .programmed_words(programmed),.displayed_words(displayed),.field(field),.field_half_line(),
  .source_reset_n(sys_reset_n),.local_reset_n(local_reset_n),.fifo_ready(fifo_ready),.overflow(overflow),.history_lost(lost),
  .snapshot_valid(snap_valid),.snapshot_reset(snap_reset),.snapshot_field(snap_field),.snapshot_words(snap_words),
  .local_words(local_words),.local_field(local_field));
 always @(posedge sysclk) if(reset_n) begin
  prior_reset<=valid && ready && write && index==22 && data[9];
  if(gpu_reset !== (valid && ready && write && index==22 && data[9]))
   $fatal(1,"reset action not aligned with accepted CSR write");
  if(valid && ready) accesses=accesses+1;
  if(overflow || lost) $fatal(1,"loss with both clocks running at phase=%0d",phase);
  if(sys_reset_n) begin
   if(sent>=8192)$fatal(1,"test queue exhausted");
   expected[sent]={prior_reset,field,displayed};
   if(sent>0 && field!=old_field) field_changes=field_changes+1;
   if(sent>0 && displayed!=old_words) bank_changes=bank_changes+1;
   old_field=field;old_words=displayed;sent=sent+1;
  end
 end
 always @(posedge local_clk) if(reset_n && snap_valid) begin
  if(received>=sent || {snap_reset,snap_field,snap_words}!==expected[received])
   $fatal(1,"snapshot ordering/data mismatch phase=%0d seq=%0d sent=%0d",phase,received,sent);
  if(snap_reset) resets=resets+1;
  last_received<={snap_field,snap_words};have_received<=1;
  received=received+1;
 end
 always @(negedge local_clk) if(reset_n && local_reset_n && have_received)
  if({local_field,local_words}!==last_received)$fatal(1,"retained bank differs from last received snapshot");
 task wr(input [4:0] i,input [31:0] w);
  begin @(negedge sysclk);valid=1;index=i;data=w;while(!ready)@(negedge sysclk);end
 endtask
 integer k;
 initial begin
  repeat(4)@(negedge sysclk);reset_n=1;
  repeat(10)@(negedge sysclk);
  if(ready || sys_reset_n || accesses!=0)$fatal(1,"access accepted before PLL ready");
  pll_locked=1;
  while(!ready)@(negedge sysclk);
  @(negedge sysclk);valid=0;
  if(accesses!=1 || programmed[31:0]!==32'h12345678)$fatal(1,"early access not accepted exactly once");
  // Short live timing with repeated FIELD/VBlank crossings.
  wr(5'd12,32'h000023f9);wr(5'd13,0);wr(5'd16,1);wr(5'd17,0);wr(5'd18,0);
  wr(5'd20,1);wr(5'd21,32'h00200400);
  for(k=1;k<=2000;k=k+1)wr(5'd0,k);
  for(k=0;k<200;k=k+1)wr(5'd22,32'h200);
  @(negedge sysclk);valid=0;
  repeat(20)@(negedge sysclk);
  if(field_changes<10 || bank_changes<100 || resets<200)$fatal(1,"insufficient event coverage: fields=%0d banks=%0d resets=%0d",field_changes,bank_changes,resets);
  if(sent-received>4)$fatal(1,"receiver fell behind its FIFO capacity");
  $display("PASS real PCRTC -> 54 MHz coherent snapshot: phase=%0d ps, sent=%0d received=%0d, FIELD changes=%0d bank changes=%0d reset events=%0d",phase,sent,received,field_changes,bank_changes,resets);
  $finish;
 end
 initial begin #1000000000;$fatal(1,"timeout");end
endmodule
