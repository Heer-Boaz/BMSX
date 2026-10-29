`timescale 1ns/1ps
// Actual beam, CSR/mask, display latch and 26-word access owner. GPU queue
// reset/flush effects are separate; this test observes the action pulses.
module gfx_pcrtc_control_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,valid=0;reg [4:0] index=0;reg [31:0] word=0;
 wire [31:0] csr,imr;wire [14:0] line;wire irq,queue_action,reset_action,running;
 gfx_pcrtc_control dut(.clk(clk),.reset_n(reset_n),.access_valid(valid),.access_write(1'b1),.access_index(index),.access_wdata(word),.access_rdata(),
  .other_events(5'd0),.irq_raise(irq),.gpu_queue_action(queue_action),.gpu_reset_action(reset_action),
  .programmed_words(),.displayed_words(),.timing_restart(),.running(running),.vblank_active(),.field(),.field_half_line(line),.csr_word(csr),.imr_word(imr));
 integer file,count,n,rc,interrupts=0,resets=0,flushes=0;reg [31:0] v,idx,data,expected_csr,expected_imr,expected_irq,expected_line;
 reg reset_this_edge=0,reset_previous_edge=0;
 initial begin
  file=$fopen("build/tests/gfx-pcrtc-control-vectors.txt","r");if(!file)$fatal(1,"missing vectors");
  rc=$fscanf(file,"%d\n",count);repeat(2)@(negedge clk);reset_n=1;
  // Bootstrap on the first cycle; the trace starts at cycle 1.
  for(n=0;n<count;n=n+1)begin
   rc=$fscanf(file,"%h %h %h %h %h %h %h\n",v,idx,data,expected_csr,expected_imr,expected_irq,expected_line);if(rc!=7)$fatal(1,"vector %d",n);
   valid=v[0];index=idx[4:0];word=data;#1;
   if(irq!==expected_irq[0])$fatal(1,"cycle %0d irq %b expected %b",n+1,irq,expected_irq[0]);
   if(reset_action!==(valid && index==22 && word[9]))$fatal(1,"reset action");
   if(queue_action!==(valid && index==22 && (word[8]||word[9])))$fatal(1,"queue action");
   reset_this_edge=reset_action;
   interrupts+=irq;resets+=reset_action;flushes+=queue_action;
   @(negedge clk);#1;
   if(csr!==expected_csr||imr!==expected_imr||line!==expected_line)$fatal(1,"cycle %0d csr %h/%h imr %h/%h line %h/%h",n+1,csr,expected_csr,imr,expected_imr,line,expected_line);
   if(reset_this_edge && (!running || dut.beam.phase!==0))$fatal(1,"reset did not start beam on its edge");
   if(reset_previous_edge && !valid && (!running || dut.beam.phase!==32'd20000))$fatal(1,"reset phase did not advance on next edge");
   reset_previous_edge=reset_this_edge;
  end
  if(!interrupts||!resets||!flushes)$fatal(1,"coverage");
  $display("PASS %0d actual TS/C++ PCRTC CSR/IMR/IRQ cycles, %0d IRQs, %0d resets, %0d queue actions",count,interrupts,resets,flushes);$finish;
 end
 initial begin #500000;$fatal(1,"timeout");end
endmodule
