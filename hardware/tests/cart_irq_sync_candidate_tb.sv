`timescale 1ps/1ps
// Compare candidate and installed receiver through the actual central ACK/FLAGS
// bank. Select candidate with -DIRQ_SYNC_EXPERIMENT. Input transitions are ideal
// digital stimuli at 16 offsets, not a silicon characterization. The actual high
// interval includes one half-clock for ACK acceptance plus the swept phase; it
// is not equal to the integer high_intervals printed below. Counts don't prove a
// guaranteed threshold for arbitrary phase, metastability or analog slew.
module cart_irq_sync_candidate_tb;
 localparam integer PERIOD=29526;
 reg clk=0;always #(PERIOD/2) clk=!clk;
 reg reset_n=0;reg [1:0] irq_cart_n=3,dreq_read=0,dreq_write=0;
 wire [31:0] irq_raise;wire [15:0] dma_requests;
 reg local_valid=0,local_write=0;reg [31:0] local_address=0,local_wdata=0;
 wire local_ready,local_rsp_valid;wire [31:0] local_rdata,local_fault_code;
`ifdef IRQ_SYNC_EXPERIMENT
 cart_pin_sync_experiment pins(
`else
 cart_pin_events pins(
`endif
 .clk(clk),.reset_n(reset_n),.irq_cart_n(irq_cart_n),.dreq_read(dreq_read),.dreq_write(dreq_write),.irq_raise(irq_raise),.dma_requests(dma_requests));
 core_local_dma_irq unit(.clk(clk),.reset_n(reset_n),.local_valid(local_valid),.local_write(local_write),.local_address(local_address),.local_wdata(local_wdata),.local_access(32'd0),.local_be_n(4'd0),.local_bus_signals(8'd0),.local_ready(local_ready),.local_rsp_valid(local_rsp_valid),.local_rdata(local_rdata),.local_fault_code(local_fault_code),.other_valid(),.other_write(),.other_address(),.other_wdata(),.other_access(),.other_be_n(),.other_bus_signals(),.other_ready(1'b0),.other_rsp_valid(1'b0),.other_rdata(32'd0),.other_fault_code(32'd0),.system_valid(),.system_write(),.system_address(),.system_wdata(),.system_ready(1'b0),.system_rsp_valid(1'b0),.system_rdata(32'd0),.system_fault_code(32'd0),.external_irq_raise(irq_raise),.user_irq_raise(32'd0),.irq_line(),.trigger_inhibit(1'b0),.admission_inhibit(1'b1),.enter_supervisor(1'b0),.leave_supervisor(1'b0),.supervisor_boundary_ready(),.local_boundary_ready(),.request_lines(dma_requests),.port_address(32'd0),.owns_read_port(),.owns_write_port(),.block_active(),.active_channel(),.active_read_address(),.active_write_address(),.transport_failed(),.transport_write_in_doubt(),.req_valid(),.req_write(),.req_hold(),.req_ready(1'b0),.req_address(),.req_wdata(),.req_access(),.req_size_bytes(),.req_be_n(),.req_bus_signals(),.req_data_timeout_enable(),.req_data_wait_last(),.rsp_valid(1'b0),.rsp_timeout(1'b0),.rsp_rdata(32'd0));
 integer phase,high_width,low_width,phase_delay,pass,n=0;
 reg [31:0] flags;
 task automatic read_flags(output [31:0] result);
  begin
   @(negedge clk);local_valid=1;local_write=0;local_address=32'h08000000;
   do @(posedge clk);while(!local_ready);
   @(negedge clk);local_valid=0;
   while(!local_rsp_valid) @(negedge clk);
   if(local_fault_code!==0)$fatal(1,"IRQ register fault");
   result=local_rdata;
  end
 endtask
 initial begin #1000000000; $fatal(1,"watchdog");end
 initial begin
  for(high_width=1;high_width<=3;high_width=high_width+1) begin
   for(low_width=1;low_width<=4;low_width=low_width+1) begin
    pass=0;
    for(phase=0;phase<16;phase=phase+1) begin
     @(negedge clk);reset_n=0;irq_cart_n=3;local_valid=0;
     repeat(3) @(negedge clk);reset_n=1;
     @(negedge clk);irq_cart_n[0]=0;repeat(8) @(negedge clk);
     read_flags(flags);if(flags!==32'h200) $fatal(1,"initial central event not received");
     @(negedge clk);irq_cart_n[0]=1;repeat(high_width) @(negedge clk);
     local_valid=1;local_write=1;local_address=32'h08000004;local_wdata=32'h200;
     do @(posedge clk);while(!local_ready);
     phase_delay=1+(PERIOD-2)*phase/16;#(phase_delay);irq_cart_n[0]=0;
     fork
      begin case(low_width)
       1: #(PERIOD/4); 2: #(PERIOD/2); 3: #(PERIOD); 4: #(2*PERIOD);
      endcase irq_cart_n[0]=1;end
      begin @(negedge clk);local_valid=0;local_write=0;end
     join
     repeat(8) @(negedge clk);
     read_flags(flags);
     if(flags===32'h200)pass=pass+1;
     else if(flags!==0) $fatal(1,"unexpected flags %h",flags);
     n=n+1;
    end
    if(low_width>=3 && pass!=16) $fatal(1,"full-clock stimulus unexpectedly lost");
    $display("high_intervals=%0d low_width_case=%0d detections=%0d/16",high_width,low_width,pass);
   end
  end
  $display("OBSERVE %0d cases, ideal RTL only",n);$finish;
 end
endmodule
