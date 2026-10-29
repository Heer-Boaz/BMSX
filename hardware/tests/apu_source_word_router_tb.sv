`timescale 1ns/1ps
module apu_source_word_router_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,req_valid=0,req_local=0;reg [16:0] req_local_word=0;
 reg [31:0] req_rom_address=0;reg [7:0] req_rom_signals=0;
 reg req_timeout_enable=0;reg [17:0] req_wait_last=0;
 wire req_ready,local_valid,rom_valid,rom_timeout_enable,rom_rsp_ready,rsp_valid,rsp_timeout;
 wire [16:0] local_word;wire [31:0] rom_address,rsp_data,rsp_fault;
 wire [7:0] rom_signals;wire [17:0] rom_wait_last;
 reg local_ready=0,local_rsp_valid=0,rom_ready=0,rom_rsp_valid=0,rom_rsp_timeout=0,rsp_ready=0;
 reg [31:0] local_rsp_data=0,rom_rsp_data=0,rom_rsp_fault=0;
 apu_source_word_router dut(.*);
 task automatic submit(input bit path,input [16:0] word,input [31:0] addr,input [7:0] sig);
  begin @(negedge clk);while(!req_ready)@(negedge clk);req_local=path;req_local_word=word;
   req_rom_address=addr;req_rom_signals=sig;req_timeout_enable=1;req_wait_last=18'h2aa55;req_valid=1;
   @(negedge clk);req_valid=0;req_local=!path;req_local_word=~word;req_rom_address=~addr;req_rom_signals=~sig;
  end
 endtask
 task automatic hold(input [31:0] data,input [31:0] fault,input bit timeout);
  begin
   while(!rsp_valid)@(negedge clk);
   repeat(3)begin if(!rsp_valid || rsp_data!==data || rsp_fault!==fault || rsp_timeout!==timeout || req_ready)
     $fatal(1,"unstable/incorrect response %h %h %b",rsp_data,rsp_fault,rsp_timeout);@(negedge clk);end
   rsp_ready=1;@(negedge clk);rsp_ready=0;
  end
 endtask
 initial begin #10000;$fatal(1,"watchdog");end
 initial begin
  repeat(2)@(negedge clk);reset_n=1;
  // Stalled local request and immediate local response at admission.
  submit(1,17'h1af24,32'h10001234,8'h0c);
  repeat(3)begin if(!local_valid || rom_valid || local_word!==17'h1af24)$fatal(1,"local request changed");@(negedge clk);end
  local_ready=1;local_rsp_valid=1;local_rsp_data=32'h13579bdf;
  @(negedge clk);local_ready=0;local_rsp_valid=0;hold(32'h13579bdf,0,0);
  // Keep the bound socket and full address under stalled SYS admission; later
  // selected socket or changed upstream wires must not redirect the request.
  submit(0,17'h12345,32'h2ffffefc,8'h0c);
  repeat(4)begin if(!rom_valid || local_valid || rom_address!==32'h2ffffefc || rom_signals!==8'h0c ||
   !rom_timeout_enable || rom_wait_last!==18'h2aa55)$fatal(1,"ROM request changed");@(negedge clk);end
  rom_ready=1;@(negedge clk);rom_ready=0;
  repeat(3)begin if(!rom_rsp_ready || rom_valid || local_valid)$fatal(1,"wrong waiting state");@(negedge clk);end
  rom_rsp_valid=1;rom_rsp_data=32'h01234567;rom_rsp_fault=32'hdeadbeef;rom_rsp_timeout=1;
  @(negedge clk);rom_rsp_valid=0;hold(32'h01234567,32'hdeadbeef,1);
  // A target may return its response on the acceptance edge as well.
  submit(0,0,32'h12345678,8'h04);
  rom_ready=1;rom_rsp_valid=1;rom_rsp_data=32'h87654321;rom_rsp_fault=0;rom_rsp_timeout=0;#1;
  if(!rom_rsp_ready || !rom_valid)$fatal(1,"immediate ROM response was not accepted");
  @(negedge clk);rom_ready=0;rom_rsp_valid=0;hold(32'h87654321,0,0);
  // A local read may also reply after admission. ROM activity while this
  // request is outstanding must not be attributed to the local read.
  submit(1,17'h00037,32'h00000004,8'hff);
  local_ready=1;@(negedge clk);local_ready=0;
  rom_rsp_valid=1;rom_rsp_data=32'habcdef01;rom_rsp_fault=32'h1234;rom_rsp_timeout=1;
  repeat(2)begin
   if(rsp_valid || rom_rsp_ready)$fatal(1,"unselected ROM response accepted");
   @(negedge clk);
  end
  rom_rsp_valid=0;local_rsp_valid=1;local_rsp_data=32'hfedcba98;
  @(negedge clk);local_rsp_valid=0;hold(32'hfedcba98,0,0);
  // Reset after admission cancels the router's credit. A target is reset in
  // the same domain; only then can a new transaction use the untagged port.
  submit(0,0,32'h10000200,8'h0c);rom_ready=1;
  @(negedge clk);rom_ready=0;if(!rom_rsp_ready)$fatal(1,"expected outstanding response");
  reset_n=0;#1;if(rom_rsp_ready || rsp_valid || req_ready)$fatal(1,"reset failed to isolate outstanding response");
  @(negedge clk);reset_n=1;@(negedge clk);
  if(!req_ready || rsp_valid)$fatal(1,"post-reset credit not clear");
  submit(1,17'h15555,0,0);local_ready=1;local_rsp_valid=1;local_rsp_data=32'h00112233;
  @(negedge clk);local_ready=0;local_rsp_valid=0;hold(32'h00112233,0,0);
  // Reset cancels an unaccepted request; new requests can follow reset.
  submit(0,0,32'h00000040,0);if(!rom_valid)$fatal(1,"missing request before reset");
  reset_n=0;@(negedge clk);if(rsp_valid || rom_valid || local_valid)$fatal(1,"reset not quiescent");
  reset_n=1;@(negedge clk);if(!req_ready)$fatal(1,"reset did not clear request");
  $display("PASS source word router local/ROM stalls, socket/address retention, immediate/delayed responses, faults, backpressure, reset");$finish;
 end
endmodule
