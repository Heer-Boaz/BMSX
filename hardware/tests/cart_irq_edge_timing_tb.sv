`timescale 1ps/1ps
// Digital evidence for a proposed pin contract, not a pad/STA/MTBF guarantee.
// The two-clock active and inactive intervals follow the published interface
// convention in AMD AXI INTC PG099, not a claim about BMSX's chosen cells:
// https://docs.amd.com/api/khub/documents/ESm7csywkGnmDhvqT3ZVDw/content
// Includes the actual CORE central pending/ACK bank. 32 ideal input phases for
// each socket exercise distinct events with a central ACK between them.
module cart_irq_edge_timing_tb;
 localparam integer PERIOD=29526;
 reg clk=0; always #(PERIOD/2) clk=~clk;
 reg reset_n=0;
 reg [1:0] irq_cart_n=3;
 wire [31:0] irq_raise;
 reg local_valid=0,local_write=0;
 reg [31:0] local_address=0,local_wdata=0;
 wire local_ready,local_rsp_valid;
 wire [31:0] local_rdata,local_fault_code;
 cart_pin_sync_experiment pins(.clk(clk),.reset_n(reset_n),.irq_cart_n(irq_cart_n),
  .dreq_read(2'b0),.dreq_write(2'b0),.irq_raise(irq_raise),.dma_requests());
 core_local_dma_irq unit(.clk(clk),.reset_n(reset_n),.local_valid(local_valid),.local_write(local_write),
  .local_address(local_address),.local_wdata(local_wdata),.local_access(32'd0),.local_be_n(4'd0),.local_bus_signals(8'd0),
  .local_ready(local_ready),.local_rsp_valid(local_rsp_valid),.local_rdata(local_rdata),.local_fault_code(local_fault_code),
  .other_valid(),.other_write(),.other_address(),.other_wdata(),.other_access(),.other_be_n(),.other_bus_signals(),
  .other_ready(1'b0),.other_rsp_valid(1'b0),.other_rdata(32'd0),.other_fault_code(32'd0),
  .system_valid(),.system_write(),.system_address(),.system_wdata(),.system_ready(1'b0),.system_rsp_valid(1'b0),
  .system_rdata(32'd0),.system_fault_code(32'd0),.external_irq_raise(irq_raise),.user_irq_raise(32'd0),.irq_line(),
  .trigger_inhibit(1'b0),.admission_inhibit(1'b1),.enter_supervisor(1'b0),.leave_supervisor(1'b0),
  .supervisor_boundary_ready(),.local_boundary_ready(),.request_lines(16'd0),.port_address(32'd0),
  .owns_read_port(),.owns_write_port(),.block_active(),.active_channel(),.active_read_address(),.active_write_address(),
  .transport_failed(),.transport_write_in_doubt(),.req_valid(),.req_write(),.req_hold(),.req_ready(1'b0),
  .req_address(),.req_wdata(),.req_access(),.req_size_bytes(),.req_be_n(),.req_bus_signals(),
  .req_data_timeout_enable(),.req_data_wait_last(),.rsp_valid(1'b0),.rsp_timeout(1'b0),.rsp_rdata(32'd0));
 integer phase,slot;
 reg [31:0] bitmask;
 task automatic central_ack(input [31:0] mask);
  begin
   @(negedge clk);local_valid=1;local_write=1;local_address=32'h08000004;local_wdata=mask;
   do @(posedge clk); while(!local_ready);
   @(negedge clk);local_valid=0;local_write=0;
   while(!local_rsp_valid) @(negedge clk);
   if(local_fault_code!==0) $fatal(1,"ACK fault");
  end
 endtask
 task automatic check_pending(input [31:0] expected);
  begin
   @(negedge clk);local_valid=1;local_write=0;local_address=32'h08000000;
   do @(posedge clk); while(!local_ready);
   @(negedge clk);local_valid=0;
   while(!local_rsp_valid) @(negedge clk);
   if(local_fault_code!==0 || local_rdata!==expected)
    $fatal(1,"FLAGS got %h expected %h",local_rdata,expected);
  end
 endtask
 initial begin #200000000; $fatal(1,"watchdog"); end
 initial begin
  for(slot=0;slot<2;slot=slot+1) begin
   bitmask=32'h200 << slot;
   for(phase=0;phase<32;phase=phase+1) begin
    @(negedge clk);reset_n=0;irq_cart_n=3;local_valid=0;
    repeat(3) @(negedge clk);reset_n=1;
    @(negedge clk); #(1+(PERIOD-2)*phase/32); irq_cart_n[slot]=0;
    repeat(8) @(negedge clk);
    check_pending(bitmask);
    central_ack(bitmask); // source remains low: ACK must clear, not reassert
    check_pending(0);
    @(negedge clk); #(1+(PERIOD-2)*phase/32); irq_cart_n[slot]=1;
    #(2*PERIOD); irq_cart_n[slot]=0;
    #(2*PERIOD); irq_cart_n[slot]=1;
    repeat(8) @(negedge clk);
    check_pending(bitmask);
   end
  end
  $display("PASS IRQ edge candidate: both slots, 32 input phases each; independent central ACK and two-clock high/low rearm");
  $finish;
 end
endmodule
