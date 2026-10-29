`timescale 1ns/1ps
// Actual eight-stereo-BADP source-word trace replay through the production
// 32-to-16 sample store and fitted ISSI pin model. The trace producer owns the
// decoder/mixer and addressed source reads; this bench supplies no substitute
// decoder, voice arbiter, epoch cache or zero-return memory peer.
//
// Input: scenario-count; then for each scenario:
//   id source-word-count selected-window-count writeback-words
//   source-word-count hexadecimal 32-bit words
//   cold-read-count decimal 17-bit word indices
//   for each selected window: original-output-epoch read-count word indices
// Each selected window is an independent 768-clock capacity test. The original
// epoch tags identify omitted intervals; no claim of continuous playback is
// inferred if the producer selects only critical windows.
//
// Source initialization writes the physical memory model before observations;
// all measured source reads traverse real address/data/control pins. Upload
// pressure targets the last 1 KiB, disjoint from all source data. It represents
// ready committed-writeback work, NOT the absent whole-batch publication owner.
// MAME SPU reference: source memory, decoded voice state and RAM transfers are
// distinct owners (src/devices/sound/spu.cpp). No PS1 codec/timing is imported.
module apu_eight_stereo_tb;
    localparam real PERIOD=1000000000.0/33868800.0;
    localparam integer FRAME_CLOCKS=768, RAM_WORDS=131072;
    localparam integer UPLOAD_BASE=RAM_WORDS-256, TRACE_WORDS=131072;
    reg clk=0;
    always #(PERIOD/2.0) clk=~clk;
    reg reset_n=1, power_reset_n=1;
    reg req_valid=0, req_write=0;
    reg [16:0] req_word_address=0;
    reg [31:0] req_wdata=0;
    reg [3:0] req_be_n=0;
    wire req_ready, rsp_valid, memory_ready;
    wire [31:0] rsp_rdata;
    wire [17:0] mem_address;
    tri [15:0] mem_data;
    wire mem_ce_n, mem_oe_n, mem_we_n;
    wire [1:0] mem_be_n;
    wire chip_drives;
    apu_sample_store dut (.*);
    issi_bll_pin_model #(.ADDRESS_WIDTH(18),.PATTERN(16'hb8ad)) device (
        .address(mem_address),.data(mem_data),.ce_n(mem_ce_n),.oe_n(mem_oe_n),
        .we_n(mem_we_n),.be_n(mem_be_n),.drive_active(chip_drives)
    );

    reg [31:0] expected_words [0:RAM_WORDS-1];
    integer trace_words [0:TRACE_WORDS-1];
    integer cold_words [0:TRACE_WORDS-1];
    integer cycle=0, clear_start=0, clear_cycles=0, clear_writes=0;
    reg clearing=0, checking=0, active=0, active_write=0;
    reg [16:0] active_address;
    reg [31:0] active_expected, active_write_data;
    integer active_accept=0;
    integer reads_issued=0, writes_issued=0, reads_done=0, writes_done=0;
    integer total_reads=0, total_writes=0;
    integer max_read_latency=0, max_write_latency=0;
    integer scenario_index=0, source_word_count=0;

    always @(posedge clk) begin
        cycle=cycle+1;
        if(checking && reset_n && power_reset_n) begin
            if(req_valid && req_ready) begin
                if(active) $fatal(1,"APU source-word response owner overwritten");
                active=1;active_write=req_write;active_address=req_word_address;
                active_expected=req_write ? 32'd0 : expected_words[req_word_address];
                active_write_data=req_wdata;active_accept=cycle;
                if(req_write) writes_issued=writes_issued+1;
                else reads_issued=reads_issued+1;
            end
            #0.001;
            if(rsp_valid) begin
                if(!active) $fatal(1,"APU response without an accepted source/writeback word");
                if(rsp_rdata!==active_expected)
                    $fatal(1,"APU source word%h returned%h expected%h",active_address,rsp_rdata,active_expected);
                if(active_write) begin
                    expected_words[active_address]=active_write_data;
                    writes_done=writes_done+1;total_writes=total_writes+1;
                    if(cycle-active_accept>max_write_latency) max_write_latency=cycle-active_accept;
                end else begin
                    reads_done=reads_done+1;total_reads=total_reads+1;
                    if(cycle-active_accept>max_read_latency) max_read_latency=cycle-active_accept;
                end
                active=0;
            end
        end
    end
    always @(mem_data or chip_drives or dut.pins.data_drive) if(checking)
        if(chip_drives && dut.pins.data_drive) $fatal(1,"APU SRAM source/writeback drivers overlap");
    always @(posedge mem_we_n) if(clearing && reset_n && power_reset_n && !mem_ce_n)
        clear_writes=clear_writes+1;

    // The provided order is preserved exactly. Ready writebacks receive first
    // service, followed by addressed playback reads. Both are fully drained,
    // even when the measured service extends beyond the capacity window.
    task automatic serve(input integer read_count,input integer write_count,
                         input integer trace_phase,input integer epoch_tag,
                         output integer elapsed);
        integer start_cycle, address;
        begin
            start_cycle=cycle;
            reads_issued=0;writes_issued=0;reads_done=0;writes_done=0;
            while(reads_done<read_count || writes_done<write_count) begin
                req_valid=0;
                if(req_ready) begin
                    if(writes_issued<write_count) begin
                        req_valid=1;req_write=1;
                        req_word_address=UPLOAD_BASE+writes_issued;
                        req_wdata=(scenario_index<<24)|(epoch_tag<<8)|writes_issued;
                    end else if(reads_issued<read_count) begin
                        if(trace_phase==1 || trace_phase==2 && reads_issued<cold_count)
                            address=cold_words[reads_issued];
                        else address=trace_words[reads_issued-(trace_phase==2 ? cold_count : 0)];
                        if(address<0 || address>=source_word_count)
                            $fatal(1,"Actual decoder trace addressed outside the initialized source banks: %0d/%0d",address,source_word_count);
                        req_valid=1;req_write=0;req_word_address=address[16:0];req_wdata=0;
                    end
                end
                @(negedge clk);
            end
            req_valid=0;
            if(active || reads_issued!=read_count || writes_issued!=write_count)
                $fatal(1,"Source trace or writeback work was not fully drained");
            elapsed=cycle-start_cycle;
        end
    endtask

    string trace_path="build/tests/apu-eight-stereo-trace.txt";
    string report_path="build/reports/apu-eight-stereo-memory.json";
    string scenario_name;
    integer trace_file, report_file, scan, scenario_count, selected_windows, upload_words;
    integer cold_count, epoch_tag, read_count, elapsed, cold_elapsed, cold_upload_elapsed;
    integer first_elapsed, first_read_count, combined_no_upload_elapsed, combined_writeback_elapsed;
    integer max_elapsed, max_epoch, missed, late_clocks;
    integer min_elapsed, read_total_before, write_total_before, frame_start;
    integer warm_reads, warm_writes;
    reg [31:0] word_value;
    reg first_case=1;

    initial begin
        if($value$plusargs("TRACE=%s",trace_path)) begin end
        if($value$plusargs("REPORT=%s",report_path)) begin end
        trace_file=$fopen(trace_path,"r");report_file=$fopen(report_path,"w");
        if(trace_file==0 || report_file==0) $fatal(1,"Cannot open source trace/report");
        scan=$fscanf(trace_file,"%d",scenario_count);
        if(scan!=1 || scenario_count<=0) $fatal(1,"Source trace has no scenario catalogue");
        for(integer n=0;n<RAM_WORDS;n=n+1) expected_words[n]=0;
        #2;power_reset_n=0;reset_n=0;
        repeat(20) @(negedge clk);clear_start=cycle;clearing=1;power_reset_n=1;reset_n=1;
        wait(memory_ready);@(negedge clk);clearing=0;clear_cycles=cycle-clear_start;
        if(clear_writes!=262144) $fatal(1,"Source SRAM was not physically reset once");
        checking=1;
        $fdisplay(report_file,"{\"scope\":\"Actual eight-stereo BADP source-word replay through production sample-store and ISSI pins; selected independent memory windows, not decoder/arithmetic/voice-arbitration or atomic-batch-publication qualification\",\"clock_hz\":33868800,\"frame_clocks\":768,\"physical_reset_clear_clocks\":%0d,\"scenarios\":[",clear_cycles);
        for(scenario_index=0;scenario_index<scenario_count;scenario_index=scenario_index+1) begin
            scan=$fscanf(trace_file,"%s %d %d %d",scenario_name,source_word_count,selected_windows,upload_words);
            if(scan!=4) $fatal(1,"Incomplete source scenario header");
            if(source_word_count>UPLOAD_BASE || source_word_count<=0 || upload_words>256)
                $fatal(1,"Source/writeback allocations overlap or exceed 512 KiB");
            if(selected_windows<=0) $fatal(1,"Scenario contains no source windows");
            // Initialization only. The real controller/pin path owns every
            // measured read; no behavioral return port is connected to it.
            for(integer n=0;n<source_word_count;n=n+1) begin
                scan=$fscanf(trace_file,"%h",word_value);
                if(scan!=1) $fatal(1,"Incomplete source-memory image");
                expected_words[n]=word_value;
                device.words[n*2]=word_value[15:0];
                device.words[n*2+1]=word_value[31:16];
            end
            scan=$fscanf(trace_file,"%d",cold_count);
            if(scan!=1 || cold_count>TRACE_WORDS) $fatal(1,"Incomplete/oversized cold source trace");
            for(integer n=0;n<cold_count;n=n+1) begin
                scan=$fscanf(trace_file,"%d",cold_words[n]);
                if(scan!=1) $fatal(1,"Incomplete cold source-address trace");
            end
            max_read_latency=0;max_write_latency=0;
            read_total_before=total_reads;write_total_before=total_writes;
            serve(cold_count,0,1,-2,cold_elapsed);
            serve(cold_count,upload_words,1,-1,cold_upload_elapsed);
            first_elapsed=0;first_read_count=0;combined_no_upload_elapsed=0;combined_writeback_elapsed=0;max_elapsed=0;max_epoch=0;min_elapsed=0;missed=0;late_clocks=0;
            warm_reads=0;warm_writes=0;
            if(!first_case) $fdisplay(report_file,",");
            $fwrite(report_file,"{\"id\":\"%0s\",\"source_words\":%0d,\"source_bytes\":%0d,\"selected_windows\":%0d,\"ready_writebacks_per_window\":%0d,\"cold_word_reads\":%0d,\"cold_no_upload_clocks\":%0d,\"cold_with_writeback_clocks\":%0d,\"windows\":[",scenario_name,source_word_count,source_word_count*4,selected_windows,upload_words,cold_count,cold_elapsed,cold_upload_elapsed);
            for(integer window_index=0;window_index<selected_windows;window_index=window_index+1) begin
                scan=$fscanf(trace_file,"%d %d",epoch_tag,read_count);
                if(scan!=2 || read_count>TRACE_WORDS) $fatal(1,"Incomplete/oversized output source window");
                for(integer n=0;n<read_count;n=n+1) begin
                    scan=$fscanf(trace_file,"%d",trace_words[n]);
                    if(scan!=1) $fatal(1,"Incomplete output source-address trace");
                end
                // Alternative startup capacity passes concatenate the real
                // cold sequence with the first output's source requests.
                // Only ONE optional writeback burst is charged, never two.
                if(window_index==0) begin
                    first_read_count=read_count;
                    serve(cold_count+read_count,0,2,-3,combined_no_upload_elapsed);
                    serve(cold_count+read_count,upload_words,2,-4,combined_writeback_elapsed);
                end
                frame_start=cycle;
                serve(read_count,upload_words,0,epoch_tag,elapsed);
                if(window_index==0) first_elapsed=elapsed;
                if(elapsed>max_elapsed) begin max_elapsed=elapsed;max_epoch=epoch_tag;end
                if(min_elapsed==0 || elapsed<min_elapsed) min_elapsed=elapsed;
                if(elapsed>FRAME_CLOCKS) begin
                    missed=missed+1;late_clocks=late_clocks+elapsed-FRAME_CLOCKS;
                end
                warm_reads=warm_reads+read_count;warm_writes=warm_writes+upload_words;
                if(window_index!=0) $fwrite(report_file,",");
                $fwrite(report_file,"{\"original_epoch\":%0d,\"source_word_reads\":%0d,\"elapsed_clocks\":%0d,\"deadline_missed\":%0d}",epoch_tag,read_count,elapsed,elapsed>FRAME_CLOCKS);
                while(cycle<frame_start+FRAME_CLOCKS) @(negedge clk);
            end
            $fwrite(report_file,"],\"source_reads_served\":%0d,\"writebacks_served\":%0d,\"all_passes_source_reads\":%0d,\"all_passes_writebacks\":%0d,\"min_window_clocks\":%0d,\"max_window_clocks\":%0d,\"max_window_original_epoch\":%0d,\"windows_missing_deadline\":%0d,\"total_window_lateness_clocks\":%0d,\"first_window_clocks\":%0d,\"startup_source_reads\":%0d,\"startup_no_upload_memory_clocks\":%0d,\"startup_with_one_writeback_burst_memory_clocks\":%0d,\"max_read_latency_clocks\":%0d,\"max_write_latency_clocks\":%0d}",warm_reads,warm_writes,total_reads-read_total_before,total_writes-write_total_before,min_elapsed,max_elapsed,max_epoch,missed,late_clocks,first_elapsed,cold_count+first_read_count,combined_no_upload_elapsed,combined_writeback_elapsed,max_read_latency,max_write_latency);
            $display("EIGHT_STEREO %0s windows=%0d sourcewords=%0d cold=%0d/%0d first=%0d peak=%0d/768 misses=%0d reads=%0d writes=%0d",scenario_name,selected_windows,source_word_count,cold_elapsed,cold_upload_elapsed,first_elapsed,max_elapsed,missed,total_reads-read_total_before,total_writes-write_total_before);
            first_case=0;
        end
        $fdisplay(report_file,"\n],\"total_source_reads\":%0d,\"total_writebacks\":%0d}",total_reads,total_writes);
        $fclose(trace_file);$fclose(report_file);
        $display("PASS apu_eight_stereo: %0d actual addressed source scenarios, %0d reads/%0d writes through real SRAM pins; overloaded windows drained and reported",scenario_count,total_reads,total_writes);
        $finish;
    end
    initial begin #500000000;$fatal(1,"Eight-stereo source replay watchdog");end
endmodule
