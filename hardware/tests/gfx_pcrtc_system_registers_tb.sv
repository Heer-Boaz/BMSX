`timescale 1ns/1ps
// PCRTC raw register-bank test. Verify the full reset image, changed and
// unchanged writes, restart classification, readback and parallel word outputs.
module gfx_pcrtc_system_registers_tb;
reg clk=0; always #5 clk=~clk;
reg reset_n=0,write_valid=0; reg [4:0] write_index=0,read_index=0;reg [31:0] write_word=0;
wire [31:0] read_word;wire [703:0] programmed_words;wire restart;
gfx_pcrtc_system_beam d(.clk(clk),.reset_n(reset_n),.soft_reset(1'b0),.write_valid(write_valid),.write_index(write_index),.write_word(write_word),.read_index(read_index),.read_word(read_word),.programmed_words(programmed_words),.timing_restart(restart),.running(),.period_numerator(),.phase(),.increment(),.total_half_lines(),.field_half_line(),.active_half_lines(),.vsync_half_line(),.elapsed_half_lines(),.elapsed_fields(),.crossed_half_lines(),.crossed_fields(),.crossed_vblank_entries(),.crossed_vsyncs(),.vblank_active(),.field());
reg [31:0] expected[0:21]; integer i;reg timing;
initial begin
expected[0]=0;expected[1]=0;expected[2]=32'h000fa000;expected[3]=0;expected[4]=32'h018252a8;expected[5]=32'h000ef4ff;
expected[6]=32'h000fa000;expected[7]=0;expected[8]=32'h018252a8;expected[9]=32'h000ef4ff;expected[10]=0;expected[11]=0;
expected[12]=32'h40806504;expected[13]=7;expected[14]=0;expected[15]=0;expected[16]=32'h1fc83030;expected[17]=32'h0007f5c2;
expected[18]=32'h003484bc;expected[19]=0;expected[20]=32'h02101404;expected[21]=32'h00a90005;
repeat(2)@(negedge clk);reset_n=1;@(negedge clk);
for(i=0;i<22;i=i+1)begin read_index=i;#1;if(read_word!==expected[i]||programmed_words[i*32+:32]!==expected[i])$fatal(1,"reset word %d %h/%h",i,read_word,expected[i]);end
for(i=0;i<22;i=i+1)begin
 @(negedge clk);write_index=i;read_index=i;write_word=~expected[i];write_valid=1;#1;
 timing=i==12||i==13||(i>=16&&i<=21);
 if(restart!==timing)$fatal(1,"restart classification %d",i);
 @(negedge clk);#1;expected[i]=write_word;
 if(read_word!==expected[i]||programmed_words[i*32+:32]!==expected[i]||restart!==0)$fatal(1,"write/same-word %d",i);
 write_valid=0;
end
for(i=0;i<22;i=i+1)begin read_index=i;#1;if(read_word!==expected[i]||programmed_words[i*32+:32]!==expected[i])$fatal(1,"retained word %d",i);end
$display("PASS all 22 raw 32-bit PCRTC reset words, changed/unchanged writes and both readback paths");$finish;
end
initial begin #10000;$fatal(1,"timeout");end
endmodule
