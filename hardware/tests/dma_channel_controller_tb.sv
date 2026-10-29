`timescale 1ns/1ps
module dma_channel_controller_tb;
 reg clk=0;always #5 clk=!clk;
 reg reset_n=0,access_valid=0,access_write=0,access_channel=0;
 reg [2:0] access_index=0;reg [31:0] access_wdata=0;
 wire access_ready;wire [31:0] access_rdata,access_fault;
 reg trigger_inhibit=0,admission_inhibit=1,enter_supervisor=0,leave_supervisor=0;
 wire supervisor_boundary_ready;reg [15:0] request_lines=0;
 wire [1:0] irq_raise;wire block_active,active_channel;wire [31:0] active_read_address,active_write_address;
 reg [31:0] port_address=0;wire owns_read_port,owns_write_port,transport_failed,transport_write_in_doubt;
 wire req_valid,req_write,req_hold;reg req_ready=0;
 wire [31:0] req_address,req_wdata,req_access;wire [2:0] req_size_bytes;wire [3:0] req_be_n;
 wire [7:0] req_bus_signals;wire req_data_timeout_enable;wire [17:0] req_data_wait_last;
 reg rsp_valid=0,rsp_timeout=0;reg [31:0] rsp_rdata=0;
 dma_channel_controller dut(.*);
 reg [31:0] mem[0:255];integer k, irq0=0,irq1=0,starts=0;reg inject_timeout=0;reg last_active=0;reg [7:0] order=0;
 always @(posedge clk) begin
  if(dut.finish_pending && (dut.count[dut.owner]!==0 || dut.status[dut.owner]!==1)) $fatal(1,"DONE preceded final writeback");
  if(irq_raise[0] && dut.status[0]!==2) $fatal(1,"IRQ preceded DONE");
  if(irq_raise[1] && dut.status[1]!==2) $fatal(1,"IRQ preceded DONE");
  if(irq_raise[0]) irq0<=irq0+1;
  if(irq_raise[1]) irq1<=irq1+1;
  if(block_active && !last_active) begin order<={order[6:0],active_channel};starts<=starts+1;end
  last_active<=block_active;
  rsp_valid<=0;
  if(req_valid && req_ready) begin
   rsp_valid<=1;rsp_timeout<=inject_timeout;
   if(req_write && !inject_timeout) mem[req_address[9:2]]<=req_wdata;
   else rsp_rdata<=mem[req_address[9:2]];
  end
 end
 task automatic wr(input bit ch,input [2:0] idx,input [31:0] data);
  begin @(negedge clk);access_valid=1;access_write=1;access_channel=ch;access_index=idx;access_wdata=data;
   do @(posedge clk);while(!access_ready);
   @(negedge clk);access_valid=0;access_write=0;
  end
 endtask
 task automatic rd(input bit ch,input [2:0] idx,input [31:0] value);
  begin @(negedge clk);access_valid=1;access_write=0;access_channel=ch;access_index=idx;#1;
   if(access_rdata!==value) $fatal(1,"channel %d index %d expected %h got %h",ch,idx,value,access_rdata);
   @(negedge clk);access_valid=0;
  end
 endtask
 initial begin #200000;$fatal(1,"timeout");end
 initial begin
  for(k=0;k<256;k=k+1) mem[k]=32'hf0000000+k;
  repeat(3) @(negedge clk);reset_n=1;
  // A zero transfer completes even with admission disabled and requests closed.
  wr(0,3,32'h3fffc);wr(0,5,1);repeat(3) @(negedge clk);rd(0,4,2);
  if(irq0!=1 || starts!=0) $fatal(1,"zero count did not complete independently");
  wr(0,0,0);wr(0,1,32'h100);wr(0,2,2);wr(0,3,3);
  wr(1,0,32'h20);wr(1,1,32'h120);wr(1,2,2);wr(1,3,3);
  wr(0,5,1);wr(1,5,1);rd(0,4,1);rd(1,4,1);
  @(negedge clk);admission_inhibit=0;
  wait(block_active);if(active_channel!==0) $fatal(1,"round robin start");
  port_address=0;#1;if(!owns_read_port) $fatal(1,"admitted port ownership");
  // Rewrites do not change admitted block, and START while busy is ignored.
  wr(0,0,32'h80);wr(0,1,32'h180);wr(0,2,9);wr(0,5,1);
  port_address=0;#1;if(!owns_read_port) $fatal(1,"captured port ownership lost");
  @(negedge clk);req_ready=1;
  wait(starts==4);wait(!block_active);repeat(5) @(negedge clk);
  if(order[3:0]!==4'b0101) $fatal(1,"round robin expected 0,1,0,1 got %b",order[3:0]);
  rd(0,0,8);rd(0,1,32'h108);rd(0,2,0);rd(0,4,2);
  rd(1,0,32'h28);rd(1,1,32'h128);rd(1,2,0);rd(1,4,2);
  if(mem[64]!==32'hf0000000 || mem[65]!==32'hf0000001 || mem[72]!==32'hf0000008 || mem[73]!==32'hf0000009) $fatal(1,"copy contents incorrect");
  if(irq0!=2 || irq1!=1) $fatal(1,"completion IRQs %d %d",irq0,irq1);
  // Both selectors gate independently, including unnamed and disabled values.
  wr(0,0,32'h40);wr(0,1,32'h140);wr(0,2,1);wr(0,3,(11<<2)|(12<<6));wr(0,5,1);
  repeat(3) @(negedge clk);if(block_active) $fatal(1,"request gate was bypassed");
  request_lines=(1<<11);repeat(3) @(negedge clk);if(block_active) $fatal(1,"destination gate was bypassed");
  request_lines=(1<<11)|(1<<12);wait(block_active);wait(!block_active);repeat(4) @(negedge clk);rd(0,4,2);
  wr(0,2,1);wr(0,3,15<<2);wr(0,5,1);repeat(4) @(negedge clk);if(block_active) $fatal(1,"disabled selector admitted");
  wr(0,2,0);repeat(4) @(negedge clk);rd(0,4,2);
  // STATUS is read-only; START cannot be accepted during supervisor gate.
  @(negedge clk);access_valid=1;access_write=1;access_index=4;access_channel=0;#1;if(access_fault!=3) $fatal(1,"status write fault");
  @(negedge clk);access_valid=0;trigger_inhibit=1;access_index=5;access_valid=1;#1;if(access_ready) $fatal(1,"trigger gate");
  @(negedge clk);access_valid=0;access_write=0;trigger_inhibit=0;
  if(transport_failed) $fatal(1,"unexpected timeout");
  // A timed-out read stops admission and is not automatically replayed.
  wr(0,0,32'h60);wr(0,1,32'h160);wr(0,2,1);wr(0,3,0);
  @(negedge clk);inject_timeout=1;wr(0,5,1);
  wait(transport_failed);repeat(5) @(negedge clk);rd(0,4,1);rd(0,2,1);
  if(block_active || req_valid || transport_write_in_doubt) $fatal(1,"timeout recovery replay");
  $display("PASS DMA channel banks, zero count, busy rewrite, port ownership, 0/1 round robin, request gates and IRQ ordering");$finish;
 end
endmodule
