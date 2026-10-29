`timescale 1ns/1ps
// Golden values come from the unchanged TS BADP decoder. This bench does not
// duplicate its step table or nibble recurrence as an alternative oracle.
// It checks combinational arithmetic, not ASIC propagation delay or STA.
module apu_badp_step_tb;
    reg signed [15:0] predictor_l=0, predictor_r=0;
    reg [7:0] step_index_l=0, step_index_r=0, packed_codes=0;
    wire signed [15:0] next_predictor_l, next_predictor_r;
    wire [6:0] next_step_index_l, next_step_index_r;
    apu_badp_step dut (.*);

    string vector_path="build/tests/apu-badp-step-input.txt";
    string report_path="build/reports/apu-badp-step.json";
    integer vectors, report, scan, case_count;
    integer pred_l, pred_r, index_l, index_r, codes;
    integer expected_l, expected_r, expected_index_l, expected_index_r;
    integer coverage_l[0:88][0:15];
    integer coverage_r[0:88][0:15];
    integer saturated_low=0, saturated_high=0, index_zero=0, index_max=0;

    initial begin
        if($value$plusargs("VECTORS=%s",vector_path)) begin end
        if($value$plusargs("REPORT=%s",report_path)) begin end
        vectors=$fopen(vector_path,"r");report=$fopen(report_path,"w");
        if(vectors==0 || report==0) $fatal(1,"Cannot open BADP arithmetic vectors/report");
        for(integer i=0;i<89;i=i+1) for(integer c=0;c<16;c=c+1) begin
            coverage_l[i][c]=0;coverage_r[i][c]=0;
        end
        scan=$fscanf(vectors,"%d",case_count);
        if(scan!=1 || case_count!=89*16*9) $fatal(1,"Incomplete exhaustive BADP arithmetic catalogue");
        for(integer n=0;n<case_count;n=n+1) begin
            scan=$fscanf(vectors,"%d %d %d %d %d %d %d %d %d",
                pred_l,pred_r,index_l,index_r,codes,expected_l,expected_r,expected_index_l,expected_index_r);
            if(scan!=9) $fatal(1,"Incomplete BADP arithmetic case%0d",n);
            predictor_l=pred_l;predictor_r=pred_r;step_index_l=index_l;step_index_r=index_r;packed_codes=codes;
            #1;
            if(next_predictor_l!==expected_l[15:0] || next_predictor_r!==expected_r[15:0] ||
               next_step_index_l!==expected_index_l[6:0] || next_step_index_r!==expected_index_r[6:0])
                $fatal(1,"BADP arithmetic case%0d seed=%0d/%0d index=%0d/%0d code=%h got=%0d/%0d,%0d/%0d expected=%0d/%0d,%0d/%0d",
                    n,pred_l,pred_r,index_l,index_r,packed_codes,next_predictor_l,next_predictor_r,
                    next_step_index_l,next_step_index_r,expected_l,expected_r,expected_index_l,expected_index_r);
            coverage_l[index_l][codes>>4]=coverage_l[index_l][codes>>4]+1;
            coverage_r[index_r][codes&15]=coverage_r[index_r][codes&15]+1;
            if(next_predictor_l==16'sh8000) saturated_low=saturated_low+1;
            if(next_predictor_l==16'sd32767) saturated_high=saturated_high+1;
            if(next_step_index_l==0) index_zero=index_zero+1;
            if(next_step_index_l==88) index_max=index_max+1;
        end
        for(integer i=0;i<89;i=i+1) for(integer c=0;c<16;c=c+1)
            if(coverage_l[i][c]!=9 || coverage_r[i][c]!=9)
                $fatal(1,"BADP arithmetic omitted index/code%0d/%0d",i,c);
        if(saturated_low==0 || saturated_high==0 || index_zero==0 || index_max==0)
            $fatal(1,"BADP arithmetic did not exercise both sample/index saturation boundaries");
        $fdisplay(report,"{\"scope\":\"Combinational stereo BADP recurrence against actual unchanged TS decoder, not physical delay/STA closure\",\"golden_cases\":%0d,\"channels_checked\":2,\"indices\":89,\"codes_per_index\":16,\"predictor_seeds_per_index_code\":9,\"left_low_saturations\":%0d,\"left_high_saturations\":%0d,\"left_index_zero\":%0d,\"left_index_max\":%0d,\"raw_header_index_bits_preserved\":8,\"undefined_header_indices_89_through_255_qualified\":false}",
            case_count,saturated_low,saturated_high,index_zero,index_max);
        $fclose(vectors);$fclose(report);
        $display("PASS apu_badp_step: %0d actual-decoder stereo cases, all 89 indices x 16 codes x 9 predictor seeds; no invalid-index semantics invented",case_count);
        $finish;
    end
endmodule
