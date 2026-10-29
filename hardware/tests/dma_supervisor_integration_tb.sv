`timescale 1ns/1ps
// Real two-channel controller plus its physical block datapath. The simple
// responding memory preserves word effects; shared IRQ pending-bank and SYSTEM
// sequencing are separate owners and are not represented by this fixture.
module dma_supervisor_integration_tb;
 reg clk=0;always #5 clk=!clk;
 reg reset_n=0,access_valid=0,access_write=0,access_channel=0;
 reg [2:0] access_index=0;reg [31:0] access_wdata=0;
 wire access_ready;wire [31:0] access_rdata,access_fault;
 reg trigger_inhibit=0,admission_inhibit=1,enter_supervisor=0,leave_supervisor=0;
 wire supervisor_boundary_ready;reg [15:0] request_lines=0;
 wire [1:0] irq_raise;wire block_active,active_channel;
 wire [31:0] active_read_address,active_write_address;
 reg [31:0] port_address=0;wire owns_read_port,owns_write_port;
 wire transport_failed,transport_write_in_doubt;
 wire req_valid,req_write,req_hold;reg req_ready=0;
 wire [31:0] req_address,req_wdata,req_access;wire [2:0] req_size_bytes;wire [3:0] req_be_n;
 wire [7:0] req_bus_signals;wire req_data_timeout_enable;wire [17:0] req_data_wait_last;
 reg rsp_valid=0,rsp_timeout=0;reg [31:0] rsp_rdata=0;
 dma_channel_controller dut(.*);
 reg [31:0] memory[0:255];integer k, irq0=0,irq1=0,reqs=0;
 always @(posedge clk) begin
  if(reset_n) begin
   if(supervisor_boundary_ready && (block_active || (|dut.pending_irq) || (|irq_raise)))
    $fatal(1,"boundary preceded active block or completion IRQ drain");
   if(irq_raise[0]) irq0<=irq0+1;
   if(irq_raise[1]) irq1<=irq1+1;
  end
  rsp_valid<=0;
  if(req_valid && req_ready) begin
   reqs<=reqs+1;rsp_valid<=1;
   if(req_write) memory[req_address[9:2]]<=req_wdata;
   else rsp_rdata<=memory[req_address[9:2]];
  end
 end
 task automatic wr(input bit ch,input [2:0] index,input [31:0] data);
  begin
   @(negedge clk);access_valid=1;access_write=1;access_channel=ch;access_index=index;access_wdata=data;
   do @(posedge clk); while(!access_ready);
   @(negedge clk);access_valid=0;access_write=0;
  end
 endtask
 task automatic rd(input bit ch,input [2:0] index,input [31:0] expected);
  begin
   @(negedge clk);access_valid=1;access_write=0;access_channel=ch;access_index=index;#1;
   if(access_rdata!==expected) $fatal(1,"bank %d index %d got %h expected %h",ch,index,access_rdata,expected);
   @(negedge clk);access_valid=0;
  end
 endtask
 task automatic switch_context(input bit leave);
  begin
   @(negedge clk);if(!supervisor_boundary_ready) $fatal(1,"switch before DMA boundary");
   enter_supervisor=!leave;leave_supervisor=leave;#1;
   if(access_ready) $fatal(1,"register port not held for atomic context exchange");
   @(negedge clk);enter_supervisor=0;leave_supervisor=0;
  end
 endtask
 initial begin #100000;$fatal(1,"test timeout");end
 initial begin
  for(k=0;k<256;k=k+1) memory[k]=32'ha5000000+k;
  repeat(3) @(negedge clk);reset_n=1;
  // A zero-count START accepted just before producer quiescence schedules an
  // IRQ even though no block is active. The boundary must wait for the IRQ.
  admission_inhibit=0;wr(0,5,1);
  trigger_inhibit=1;admission_inhibit=1;#1;
  if(block_active || supervisor_boundary_ready) $fatal(1,"zero-count completion was not drained");
  wait(irq_raise[0]);#1;if(supervisor_boundary_ready) $fatal(1,"zero-count IRQ not drained");
  wait(supervisor_boundary_ready);@(negedge clk);
  if(irq0!==1) $fatal(1,"zero-count completion IRQ lost");
  irq0=0;trigger_inhibit=0;
  // Ch0 will complete one word. Ch1 remains BUSY waiting for request 11.
  wr(0,0,0);wr(0,1,32'h100);wr(0,2,1);wr(0,3,3);
  wr(1,0,32'h20);wr(1,1,32'h120);wr(1,2,2);wr(1,3,(11<<2)|3);
  wr(0,5,1);wr(1,5,1);
  @(negedge clk);admission_inhibit=0;wait(block_active);
  if(active_channel!==0 || dut.next_channel!==1) $fatal(1,"initial channel admission/turn");
  // First phase blocks START but not the admitted data transfer.
  @(negedge clk);trigger_inhibit=1;
  access_valid=1;access_write=1;access_channel=0;access_index=5;access_wdata=1;#1;
  if(access_ready) $fatal(1,"START not held during producer quiescence");
  @(negedge clk);access_valid=0;access_write=0;admission_inhibit=1;
  if(supervisor_boundary_ready) $fatal(1,"boundary while block active");
  req_ready=1;wait(!block_active);
  if(supervisor_boundary_ready) $fatal(1,"undelivered completion allowed context switch");
  wait(irq_raise[0]);#1;if(supervisor_boundary_ready) $fatal(1,"IRQ pulse not drained");
  wait(supervisor_boundary_ready);@(negedge clk);
  if(irq0!==1 || reqs!==2 || memory[64]!==32'ha5000000)
   $fatal(1,"admitted block did not complete exactly once before switch");
  rd(0,4,2);rd(1,4,1);rd(1,2,2);
  if(dut.next_channel!==1) $fatal(1,"arbitration turn changed by wait");
  // A request asserted during exchange is held, not acknowledged/dropped.
  // If SYSTEM permitted this request, it would execute against the new bank;
  // SYSTEM therefore also owns draining old-context traffic before switching.
  @(negedge clk);enter_supervisor=1;access_valid=1;access_write=1;
  access_channel=0;access_index=0;access_wdata=32'hdeadc0de;#1;
  if(access_ready) $fatal(1,"MMIO accepted on context exchange edge");
  @(negedge clk);enter_supervisor=0;#1;
  if(!access_ready) $fatal(1,"deferred MMIO was not released");
  @(negedge clk);access_valid=0;access_write=0;
  rd(0,0,32'hdeadc0de);rd(0,2,0);rd(0,4,0);rd(1,0,0);rd(1,4,0);
  if(dut.next_channel!==0) $fatal(1,"supervisor turn not reset");
  // Supervisor performs real work without changing retained cartridge state.
  @(negedge clk);trigger_inhibit=0;admission_inhibit=0;
  wr(0,0,32'h40);wr(0,1,32'h140);wr(0,2,1);wr(0,3,3);wr(0,5,1);
  wait(block_active);wait(!block_active);repeat(5) @(negedge clk);
  if(memory[80]!==32'ha5000010 || irq0!==2) $fatal(1,"supervisor transfer/IRQ");
  @(negedge clk);trigger_inhibit=1;admission_inhibit=1;wait(supervisor_boundary_ready);
  switch_context(1);
  rd(0,0,4);rd(0,1,32'h104);rd(0,2,0);rd(0,4,2);
  rd(1,0,32'h20);rd(1,1,32'h120);rd(1,2,2);rd(1,3,(11<<2)|3);rd(1,4,1);
  if(dut.next_channel!==1) $fatal(1,"cartridge arbitration turn not restored");
  // Make both channels eligible before reopening admission: the restored turn
  // must pick channel 1, not the supervisor context's most recent turn.
  @(negedge clk);trigger_inhibit=0;
  wr(0,0,32'h60);wr(0,1,32'h160);wr(0,2,1);wr(0,3,3);wr(0,5,1);
  request_lines=(1<<11);@(negedge clk);admission_inhibit=0;wait(block_active);
  if(active_channel!==1) $fatal(1,"restored round-robin turn not used");
  wait(irq_raise[1]);repeat(10) @(negedge clk);
  if(memory[72]!==32'ha5000008 || memory[73]!==32'ha5000009 || irq1!==1 || transport_failed)
   $fatal(1,"retained BUSY transfer did not resume");
  $display("PASS real DMA supervisor context: active block and IRQ drain, retained BUSY channel, atomic bank exchange, restored arbitration and resumed data");$finish;
 end
endmodule
