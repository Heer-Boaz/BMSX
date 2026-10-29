`timescale 1ns/1ps
module imgdec_cpu_device_tb;
 reg clk=0,reset_n=0,valid=0,write=0,dma_r=0,dma_w=0;
 reg [3:0] index=0;reg [31:0] wdata=0;
 wire ready,readonly_fault,irq,in_req,out_req;
 wire [31:0] rdata,received,decoded;wire [5:0] in_used;wire [6:0] out_used;
 integer interrupts=0;
 always #5 clk=~clk;
 imgdec_cpu_device dut(.clk(clk),.reset_n(reset_n),.access_valid(valid),.access_write(write),.access_index(index),
  .access_wdata(wdata),.access_ready(ready),.access_rdata(rdata),.access_read_only_fault(readonly_fault),
  .dma_owns_read(dma_r),.dma_owns_write(dma_w),.input_request(in_req),.output_request(out_req),.irq_pulse(irq),
  .input_words_received(received),.decoded_words(decoded),.input_occupancy(in_used),.output_occupancy(out_used));
 always @(posedge clk) if(irq) interrupts=interrupts+1;
 task wr(input [3:0] n,input [31:0] d);
  begin @(negedge clk);valid=1;write=1;index=n;wdata=d;while(!ready)@(negedge clk);@(negedge clk);valid=0;write=0;end
 endtask
 task rd(input [3:0] n,input [31:0] expected);
  begin @(negedge clk);valid=1;write=0;index=n;#1;
   if(!ready || rdata!==expected)$fatal(1,"read index=%0d got=%h expected=%h ready=%b",n,rdata,expected,ready);
   @(negedge clk);valid=0;
  end
 endtask
 initial begin
  repeat(3)@(negedge clk);reset_n=1;
  rd(5,0);rd(6,0);rd(7,0);rd(8,0);
  @(negedge clk);valid=1;write=1;index=5;#1;if(!ready || !readonly_fault)$fatal(1,"STATUS must be read only");@(negedge clk);valid=0;write=0;
  wr(0,6);wr(1,32'hdeadbeef);wr(2,32'h01234567);wr(3,32'h87654321);wr(4,32'hcafebabe);rd(4,32'hcafebabe);
  wr(4,32'hcafebabf);rd(4,32'hcafebabe);
  if(!in_req || received!=0)$fatal(1,"new stream input request");
  // A pending CPU DATA write is held while DMA owns the port; no latch or count update.
  @(negedge clk);valid=1;write=1;index=6;wdata=32'h31444d49;dma_w=1;
  repeat(3)begin #1;if(ready || received!=0)$fatal(1,"owned DATA write was accepted");@(negedge clk);end
  dma_w=0;#1;if(!ready)$fatal(1,"pending write not resumed on request");@(negedge clk);valid=0;write=0;
  wr(6,2);wr(6,0);wr(6,1);wr(6,32'h11223344);wr(6,32'h55667788);
  wait(dut.stream_complete);@(negedge clk);
  if(received!=6 || decoded!=2 || out_used!=5 || interrupts!=0 || !out_req)$fatal(1,"production/drain state");
  // DMA ownership makes CPU reads return the retained input latch without pop.
  dma_r=1;rd(6,32'h55667788);if(out_used!=5)$fatal(1,"owned CPU read popped FIFO");dma_r=0;
  rd(6,32'ha0000000);rd(6,32'hdeadbeef);rd(6,32'h01234567);rd(6,32'h11223344);
  if(interrupts!=0 || !dut.active)$fatal(1,"premature DONE");
  rd(6,32'h55667788);repeat(2)@(negedge clk);
  if(interrupts!=1 || dut.active || dut.fault || !dut.done || out_used!=0)$fatal(1,"DONE/IRQ wrong");
  rd(5,2);dma_r=1;rd(6,32'h55667788);dma_r=0;repeat(2)@(negedge clk);
  if(interrupts!=1)$fatal(1,"DMA-owned empty read must not re-raise IRQ");
  rd(6,32'h55667788);repeat(2)@(negedge clk);if(interrupts!=2)$fatal(1,"empty successful read must re-raise IRQ");
  // Invalid magic causes terminal FORMAT_FAULT without destroying DATA.
  wr(0,1);wr(4,1);wr(6,32'hbadc0ffe);wait(dut.fault);repeat(2)@(negedge clk);
  if(interrupts!=3 || dut.active || out_used!=0)$fatal(1,"format fault / irq wrong");
  rd(5,16);rd(6,32'hbadc0ffe);repeat(2)@(negedge clk);if(interrupts!=3)$fatal(1,"fault read must not signal DONE");
  // START clears old progress/latch and can fail with zero configured words.
  wr(0,0);wr(4,32'h55);wait(dut.fault);repeat(2)@(negedge clk);
  if(interrupts!=4 || received!=0 || dut.data_word!=0 || dut.control_word!=32'h54)$fatal(1,"zero input restart");
  // Overlong run raises fault while retaining the emitted output prefix.
  wr(0,4);wr(1,32'h1234);wr(2,32'h5678);wr(4,1);wr(6,32'h31444d49);wr(6,2);wr(6,0);wr(6,32'hc0000002);
  wait(dut.fault);repeat(2)@(negedge clk);
  if(interrupts!=5 || out_used!=5 || decoded!=2)$fatal(1,"fault must preserve produced FIFO prefix");
  rd(6,32'ha0000000);rd(6,32'h00001234);rd(6,32'h00005678);rd(6,0);rd(6,0);rd(5,16);
  repeat(2)@(negedge clk);if(interrupts!=5)$fatal(1,"draining fault prefix must not report DONE");
  $display("PASS IMGDEC CPU: configuration, DMA-owned CPU ports, DATA latch, requests, atomic output, drained DONE/repeated IRQ and format faults");$finish;
 end
 initial begin #100000;$fatal(1,"IMGDEC CPU watchdog");end
endmodule
