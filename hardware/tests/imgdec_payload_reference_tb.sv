`timescale 1ns/1ps
// Replay the same compressed words used by the real TS and C++ IMGDEC
// owners through the physical payload engine, including output stalls.
module imgdec_payload_reference_tb;
 reg clk=0; always #5 clk=~clk;
 reg reset_n=0,stream_start=0,input_valid=0,output_ready=0;
 reg [31:0] input_word=0;
 wire input_ready,output_valid,between_tokens,needs_input,format_fault;
 wire [31:0] output_word,decoded_words;
 reg [31:0] input_words[0:11];
 integer output_file,rc,received=0,cycle=0;
 reg [31:0] expected;
 wire [31:0] run_remaining; wire literal_mode;
    imgdec_payload dut(.*);
 always @(negedge clk) begin
  cycle=cycle+1;
  output_ready=(cycle%5)!=0;
 end
 always @(posedge clk) if(reset_n && output_valid && output_ready) begin
  rc=$fscanf(output_file,"%h",expected);
  if(rc!=1 || output_word!==expected)
   $fatal(1,"IMGDEC real-owner mismatch at word %0d: got=%h expected=%h",received,output_word,expected);
  received=received+1;
 end
 initial begin
  $readmemh("tests/imgdec_payload_vectors.hex",input_words);
  output_file=$fopen("build/tests/imgdec_payload_reference_ts.txt","r");
  if(!output_file)$fatal(1,"missing actual TS oracle");
  repeat(3)@(negedge clk);reset_n=1;
  for(integer n=0;n<12;n=n+1) begin
   @(negedge clk);input_word=input_words[n];input_valid=1;
   @(posedge clk);while(!input_ready)@(posedge clk);
   @(negedge clk);input_valid=0;
  end
  while(received<23)@(negedge clk);
  repeat(2)@(negedge clk);
  if(decoded_words!=23 || !between_tokens || format_fault || $fscanf(output_file,"%h",expected)==1)
   $fatal(1,"IMGDEC end state or reference length mismatch");
  $fclose(output_file);
  $display("PASS IMGDEC payload: 23 words match real TS/C++ owners with output stalls");
  $finish;
 end
 initial begin #1000000;$fatal(1,"IMGDEC reference watchdog");end
endmodule
