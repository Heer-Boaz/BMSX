`timescale 1ns/1ps
// Book I diagnostic line/UTF-8 queue against the physical register owner.
// Includes atomic multi-byte admission, partial-line discard, published-data
// preservation, ring wrap and simultaneous sink/readmission at full capacity.
module system_debug_transmit_tb;
 reg clk=0; always #5 clk=!clk;
 reg reset_n=0,access_valid=0,access_write=0,byte_ready=0;
 reg [31:0] access_address=0,access_wdata=0;
 wire access_ready,response_valid,byte_valid;wire [31:0] response_data;wire [7:0] byte_data;
 localparam [31:0] CHAR=32'h08010230, FLUSH=32'h08010234;
 system_debug_transmit dut(.*);
 integer i;
 initial begin #3000000;$fatal(1,"watchdog");end
 task automatic write_reg(input [31:0] address,value);
  begin
   @(negedge clk);access_valid=1;access_write=1;access_address=address;access_wdata=value;
   do @(posedge clk);while(!access_ready);
   @(negedge clk);access_valid=0;access_write=0;
   if(!response_valid) $fatal(1,"missing response");
  end
 endtask
 task automatic read_reg(input [31:0] address,value);
  begin
   @(negedge clk);access_valid=1;access_write=0;access_address=address;
   do @(posedge clk);while(!access_ready);
   @(negedge clk);access_valid=0;
   if(!response_valid || response_data!==value) $fatal(1,"read %h expected %h got %h",address,value,response_data);
  end
 endtask
 task automatic take(input [7:0] value);
  begin
   @(negedge clk);if(!byte_valid || byte_data!==value) $fatal(1,"byte expected %h got %h valid=%b",value,byte_data,byte_valid);
   byte_ready=1;@(negedge clk);byte_ready=0;
  end
 endtask
 task automatic empty;
  begin @(negedge clk);if(byte_valid) $fatal(1,"unexpected published byte %h",byte_data);end
 endtask
 initial begin
  repeat(3) @(negedge clk);reset_n=1;
  read_reg(CHAR,0);read_reg(FLUSH,0);
  // The write data has been zero since time zero: a first NUL must still
  // traverse the encoder and be published, not become an unknown length.
  write_reg(CHAR,0);write_reg(FLUSH,0);take(8'h00);take(8'h0a);empty();
  write_reg(CHAR,32'h53);write_reg(CHAR,32'he9);write_reg(CHAR,32'h1f600);write_reg(CHAR,32'hffffffff);
  empty();write_reg(FLUSH,0);read_reg(CHAR,32'hffffffff);read_reg(FLUSH,0);
  take(8'h53);take(8'hc3);take(8'ha9);take(8'hf0);take(8'h9f);take(8'h98);take(8'h80);take(8'h3f);take(8'h0a);empty();
  // All Unicode boundary classes, including both ends of the surrogate range.
  write_reg(CHAR,32'h7f);write_reg(CHAR,32'h80);write_reg(CHAR,32'h7ff);write_reg(CHAR,32'h800);
  write_reg(CHAR,32'hd7ff);write_reg(CHAR,32'hd800);write_reg(CHAR,32'hdfff);write_reg(CHAR,32'he000);
  write_reg(CHAR,32'hffff);write_reg(CHAR,32'h10000);write_reg(CHAR,32'h10ffff);write_reg(CHAR,32'h110000);
  write_reg(FLUSH,32'h98765432);read_reg(FLUSH,32'h98765432);
  take(8'h7f);take(8'hc2);take(8'h80);take(8'hdf);take(8'hbf);
  take(8'he0);take(8'ha0);take(8'h80);take(8'hed);take(8'h9f);take(8'hbf);
  take(8'h3f);take(8'h3f);take(8'hee);take(8'h80);take(8'h80);
  take(8'hef);take(8'hbf);take(8'hbf);take(8'hf0);take(8'h90);take(8'h80);take(8'h80);
  take(8'hf4);take(8'h8f);take(8'hbf);take(8'hbf);take(8'h3f);take(8'h0a);empty();
  // 8192-byte incomplete line is discarded when its LF cannot fit.
  for(i=0;i<8192;i=i+1) write_reg(CHAR,8'h41);
  empty();write_reg(FLUSH,1);empty();write_reg(CHAR,8'h51);write_reg(FLUSH,0);take(8'h51);take(8'h0a);empty();
  // Fill the published queue, discard only the partial attempt, then read all.
  for(i=0;i<8191;i=i+1) write_reg(CHAR,8'h78);
  write_reg(FLUSH,0);write_reg(CHAR,8'h79);write_reg(CHAR,8'h7a);write_reg(FLUSH,0);
  for(i=0;i<8191;i=i+1) take(8'h78);
  take(8'h0a);empty();
  // Atomic rejection of a 4-byte codepoint with only three bytes free.
  for(i=0;i<8188;i=i+1) write_reg(CHAR,8'h61);
  write_reg(FLUSH,0);write_reg(CHAR,32'h1f600);write_reg(FLUSH,0);
  for(i=0;i<8188;i=i+1) take(8'h61);
  take(8'h0a);empty();
  // A full queue can consume an old byte and accept an ASCII byte at the same
  // edge. Only the remaining published bytes may be consumed before flush.
  for(i=0;i<8191;i=i+1) write_reg(CHAR,8'h62);
  write_reg(FLUSH,0);
  @(negedge clk);if(!byte_valid || byte_data!==8'h62 || !access_ready) $fatal(1,"full-ring setup");
  byte_ready=1;access_valid=1;access_write=1;access_address=CHAR;access_wdata=8'h63;
  @(negedge clk);byte_ready=0;access_valid=0;access_write=0;
  for(i=0;i<8190;i=i+1) take(8'h62);
  take(8'h0a);empty();write_reg(FLUSH,0);take(8'h63);take(8'h0a);empty();
  // Reset removes both published and partial bytes and clears readback words.
  write_reg(CHAR,8'h65);write_reg(FLUSH,2);write_reg(CHAR,8'h66);
  @(negedge clk);reset_n=0;@(negedge clk);reset_n=1;empty();read_reg(CHAR,0);read_reg(FLUSH,0);
  $display("PASS SYSTEM diagnostic UTF-8, readback, publication, overflow, concurrent consumption, wrap and reset");$finish;
 end
endmodule
