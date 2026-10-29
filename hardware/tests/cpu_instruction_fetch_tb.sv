`timescale 1ns/1ps
module cpu_instruction_fetch_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,req_valid=0,mem_ready=0,mem_rsp_valid=0,rsp_ready=0;
 reg [31:0] req_pc=0,mem_rsp_data=0,mem_rsp_fault=0;
 reg [7:0] req_signals=0;
 wire req_ready,mem_valid,rsp_valid;wire [31:0] mem_address;
 wire [7:0] mem_signals;wire [31:0] pc,next_pc,prefix,body;
 wire wide,misaligned,bus_fault;
 cpu_instruction_fetch dut(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),.req_pc(req_pc),
 .req_bus_signals(req_signals),.mem_valid(mem_valid),.mem_ready(mem_ready),.mem_address(mem_address),
 .mem_bus_signals(mem_signals),.mem_rsp_valid(mem_rsp_valid),.mem_rsp_data(mem_rsp_data),.mem_rsp_fault(mem_rsp_fault),
 .rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_pc(pc),.rsp_next_pc(next_pc),.rsp_prefix(prefix),.rsp_body(body),
 .rsp_wide(wide),.rsp_misaligned(misaligned),.rsp_bus_fault(bus_fault));
 task automatic submit(input [31:0] addr,input [7:0] sig);
  begin @(negedge clk);while(!req_ready)@(negedge clk);req_valid=1;req_pc=addr;req_signals=sig;
   @(negedge clk);req_valid=0;req_pc=32'h12345678;req_signals=8'hff;end
 endtask
 task automatic memory_reply(input [31:0] addr,input [7:0] sig,input [31:0] raw,input [31:0] fault);
  begin while(!mem_valid)@(negedge clk);
   repeat(3) begin @(negedge clk);if(!mem_valid||mem_address!==addr||mem_signals!==sig)$fatal(1,"memory stall address/signals");end
   mem_ready=1;@(negedge clk);mem_ready=0;repeat(2)@(negedge clk);
   mem_rsp_data=raw;mem_rsp_fault=fault;mem_rsp_valid=1;@(negedge clk);mem_rsp_valid=0;mem_rsp_fault=0;
  end
 endtask
 task automatic finish_reply;
  begin while(!rsp_valid)@(negedge clk);repeat(2)begin @(negedge clk);if(!rsp_valid)$fatal(1,"response stall");end
   rsp_ready=1;@(negedge clk);rsp_ready=0;end
 endtask
 initial begin
  repeat(2)@(negedge clk);reset_n=1;
  submit(32'h10000010,8'h0c);memory_reply(32'h10000010,8'h0c,32'h2301047b,0);
  if(!rsp_valid||pc!==32'h10000010||next_pc!==32'h10000014||body!==32'h7b040123||wide||misaligned||bus_fault)$fatal(1,"normal fetch");
  finish_reply();
  submit(32'hfffffffc,8'h04);memory_reply(32'hfffffffc,8'h04,32'h23010099,0);
  memory_reply(0,8'h04,32'h785600cc,0);
  if(!rsp_valid||pc!==32'hfffffffc||next_pc!==4||!wide||prefix!==32'h99000123||body!==32'hcc005678||misaligned||bus_fault)$fatal(1,"wide wrap/nested body");
  finish_reply();
  submit(32'h08000001,8'h00);
  if(!rsp_valid||!misaligned||bus_fault||mem_valid||pc!==32'h08000001)$fatal(1,"unaligned fetch");finish_reply();
  submit(32'h10000020,8'h04);memory_reply(32'h10000020,8'h04,0,1);
  if(!rsp_valid||!bus_fault||misaligned||pc!==32'h10000020)$fatal(1,"first fetch fault");finish_reply();
  submit(32'h100000fc,8'h0c);memory_reply(32'h100000fc,8'h0c,32'h23010099,0);
  memory_reply(32'h10000100,8'h0c,0,1);
  if(!rsp_valid||!bus_fault||!wide||pc!==32'h100000fc)$fatal(1,"wide body fault original pc");finish_reply();
  $display("PASS CPU instruction fetch: BE words, WIDE/wrap, latched execution-domain strobes, alignment, body/first bus faults and handshake stalls; memory boundary fixture");$finish;
 end
 initial begin #100000;$fatal(1,"timeout");end
endmodule
