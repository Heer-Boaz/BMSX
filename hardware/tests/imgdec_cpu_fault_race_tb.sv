`timescale 1ns/1ps
// A CPU DATA write presented after the stream owner has detected a malformed
// magic word must not enter the input FIFO on the same edge as the outer
// FORMAT_FAULT stop. The actual TS and C++ owners stop synchronously while
// processing the bad word; CPU DATA write readiness is then false. This tests
// the physical inter-owner boundary, not complete public cycle timing.
module imgdec_cpu_fault_race_tb;
 reg clk=0,reset_n=0,valid=0,write=0;reg [3:0] index=0;reg [31:0] wdata=0;
 wire ready,irq,in_req,out_req,readonly_fault;wire [31:0] rdata,received,decoded;
 wire [5:0] in_used;wire [6:0] out_used;
 always #5 clk=~clk;
 imgdec_cpu_device dut(.clk(clk),.reset_n(reset_n),.access_valid(valid),.access_write(write),
  .access_index(index),.access_wdata(wdata),.access_ready(ready),.access_rdata(rdata),
  .access_read_only_fault(readonly_fault),.dma_owns_read(1'b0),.dma_owns_write(1'b0),
  .input_request(in_req),.output_request(out_req),.irq_pulse(irq),.input_words_received(received),
  .decoded_words(decoded),.input_occupancy(in_used),.output_occupancy(out_used));
 task wr(input [3:0] n,input [31:0] value);
  begin @(negedge clk);valid=1;write=1;index=n;wdata=value;
   while(!ready)@(negedge clk);@(negedge clk);valid=0;write=0;
  end
 endtask
 initial begin
  repeat(3)@(negedge clk);reset_n=1;
  wr(0,2);wr(4,1);wr(6,32'hbadc0ffe);
  wait(dut.stream_fault);@(negedge clk);
  valid=1;write=1;index=6;wdata=32'hdeadbeef;#1;
  if(!dut.active || ready || in_req || out_req || received!=1)
   $fatal(1,"known fault allowed new CPU request: active=%0d ready=%0d input_req=%0d output_req=%0d received=%0d",dut.active,ready,in_req,out_req,received);
  @(posedge clk);#1;
  if(dut.active || !dut.fault || !irq || received!=1 || dut.data_word!==32'hbadc0ffe || in_used!=0)
   $fatal(1,"fault edge changed input state: active=%0d fault=%0d irq=%0d received=%0d latch=%h in_used=%0d",dut.active,dut.fault,irq,received,dut.data_word,in_used);
  repeat(2)@(negedge clk);
  if(ready || received!=1 || in_used!=0)$fatal(1,"held DATA write escaped after fault");
  valid=0;write=0;index=5;#1;if(rdata!==32'h10)$fatal(1,"FORMAT_FAULT status was not retained");
  $display("PASS IMGDEC fault edge: no new DATA acceptance or request after detected invalid MAGIC; latch/count retained");$finish;
 end
 initial begin #10000;$fatal(1,"watchdog");end
endmodule
