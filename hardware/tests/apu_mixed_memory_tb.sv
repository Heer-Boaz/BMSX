`timescale 1ns/1ps
// Offline memory-capacity probe, not an APU voice/transfer scheduler.
// Real apu_sample_store and ISSI pins serve raw playback-word demands and
// disjoint inactive-buffer writes. A write opportunity is released every32
// system clocks (or a separately labelled ready-at-start writeback burst); once released it has priority at the next word boundary.
// Playback uses all remaining admission opportunities. No operation is dropped.
//
// This deliberately does NOT implement the public whole-batch DMA publication
// boundary, read forwarding, FIFO, codec, per-voice word assembler or mixer.
// It proves finite raw-operation service budgets under this stated arbitration
// assumption. Active-source visibility needs its separate committing owner.
// MAME's SPU separates sample storage, decoded voices and transfers likewise:
// https://github.com/mamedev/mame/blob/master/src/devices/sound/spu.cpp
module apu_mixed_memory_tb;
    localparam real PERIOD=1000000000.0/33868800.0;
    localparam integer FRAME_CLOCKS=768, MAX_WORDS=131072;
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
    issi_bll_pin_model #(.ADDRESS_WIDTH(18),.PATTERN(16'ha53c)) device (
        .address(mem_address),.data(mem_data),.ce_n(mem_ce_n),.oe_n(mem_oe_n),
        .we_n(mem_we_n),.be_n(mem_be_n),.drive_active(chip_drives)
    );

    reg [31:0] expected_words [0:MAX_WORDS-1];
    integer cycle=0, clear_writes=0, clear_start=0, clear_cycles=0;
    reg clearing=0, checking=0, active=0;
    integer reads_issued=0, writes_issued=0, reads_done=0, writes_done=0;
    integer active_accept=0, active_deadline=0, active_release=0;
    reg active_write=0;
    reg [16:0] active_address=0;
    reg [31:0] active_expected=0, active_write_data=0;
    integer offered_deadline=0, offered_release=0, upload_release_period=32;
    integer max_read_latency=0, max_write_latency=0;
    integer max_upload_response_after_release=0, late_uploads=0;
    integer max_frame_clocks=0, min_frame_clocks=0, frames_missing_deadline=0;
    integer late_words=0, case_read_jobs=0, case_write_jobs=0;
    integer case_index=0, case_count=0;
    integer previous_accept=0, uniform_interval=0;
    integer total_words=0;

    always @(posedge clk) begin
        cycle=cycle+1;
        if(checking && reset_n && power_reset_n) begin
            if(req_valid && req_ready) begin
                if(active) $fatal(1,"Sample word admitted before previous response");
                active=1;active_write=req_write;active_address=req_word_address;
                active_write_data=req_wdata;active_accept=cycle;active_deadline=offered_deadline;
                active_release=offered_release;
                active_expected=req_write ? 32'd0 : expected_words[req_word_address];
                if(previous_accept!=0 && writes_issued==0 && writes_done==0)
                    uniform_interval=cycle-previous_accept;
                previous_accept=cycle;
                if(req_write) writes_issued=writes_issued+1;
                else reads_issued=reads_issued+1;
            end
            #0.001;
            if(rsp_valid) begin
                if(!active) $fatal(1,"Sample word response has no owner");
                if(rsp_rdata!==active_expected)
                    $fatal(1,"SRAM word%h returned%h expected%h",active_address,rsp_rdata,active_expected);
                if(cycle>active_deadline) late_words=late_words+1;
                if(active_write) begin
                    if(cycle-active_accept>max_write_latency) max_write_latency=cycle-active_accept;
                    if(cycle-active_release>max_upload_response_after_release)
                        max_upload_response_after_release=cycle-active_release;
                    if(cycle>active_deadline) late_uploads=late_uploads+1;
                    expected_words[active_address]=active_write_data;
                    writes_done=writes_done+1;
                end else begin
                    if(cycle-active_accept>max_read_latency) max_read_latency=cycle-active_accept;
                    reads_done=reads_done+1;
                end
                total_words=total_words+1;active=0;
            end
        end
    end
    always @(mem_data or chip_drives or dut.pins.data_drive) if(checking)
        if(chip_drives && dut.pins.data_drive) $fatal(1,"Sample SRAM drivers overlap");
    always @(posedge mem_we_n) if(clearing && reset_n && power_reset_n && !mem_ce_n)
        clear_writes=clear_writes+1;

    // Reads consume the previous inactive bank's actual uploaded words while
    // writes fill the other bank. All other addresses retain shadowed contents;
    // no modeled memory return bypasses the physical SRAM pins.
    task automatic frame(input integer frame_number,input integer playback_words,input integer upload_words);
        integer start_cycle, write_bank, read_bank, read_address, frame_clocks;
        begin
            start_cycle=cycle;
            write_bank=frame_number&1;read_bank=1-write_bank;
            reads_issued=0;writes_issued=0;reads_done=0;writes_done=0;previous_accept=0;
            while(reads_done<playback_words || writes_done<upload_words) begin
                req_valid=0;
                if(req_ready) begin
                    if(writes_issued<upload_words && cycle-start_cycle>=writes_issued*upload_release_period) begin
                        req_valid=1;req_write=1;
                        req_word_address=17'h10000+write_bank*256+writes_issued;
                        req_wdata=(case_index<<24)|(frame_number<<12)|writes_issued;
                        offered_release=start_cycle+writes_issued*upload_release_period;
                        offered_deadline=upload_release_period==0 ? start_cycle+FRAME_CLOCKS :
                            start_cycle+(writes_issued+1)*upload_release_period;
                    end else if(reads_issued<playback_words) begin
                        req_valid=1;req_write=0;
                        if(upload_words!=0)
                            read_address=17'h10000+read_bank*256+(reads_issued%upload_words);
                        else read_address=17'h02000+reads_issued;
                        req_word_address=read_address[16:0];req_wdata=0;
                        offered_deadline=start_cycle+FRAME_CLOCKS;
                    end
                end
                @(negedge clk);
            end
            req_valid=0;
            if(reads_issued!=playback_words || writes_issued!=upload_words || active)
                $fatal(1,"Frame did not drain every offered memory operation");
            frame_clocks=cycle-start_cycle;
            if(frame_clocks>max_frame_clocks) max_frame_clocks=frame_clocks;
            if(min_frame_clocks==0 || frame_clocks<min_frame_clocks) min_frame_clocks=frame_clocks;
            if(frame_clocks>FRAME_CLOCKS) frames_missing_deadline=frames_missing_deadline+1;
            case_read_jobs=case_read_jobs+reads_done;case_write_jobs=case_write_jobs+writes_done;
            while(cycle<start_cycle+FRAME_CLOCKS) @(negedge clk);
        end
    endtask

    string report_path="build/reports/apu-mixed-memory.json";
    integer report_file;
    reg first_case=1;
    task automatic run_case(input string name,input integer playback_words,input integer upload_words,
                            input integer release_period,input integer frames,input bit should_fit);
        begin
            upload_release_period=release_period;
            max_read_latency=0;max_write_latency=0;max_upload_response_after_release=0;
            min_frame_clocks=0;max_frame_clocks=0;frames_missing_deadline=0;
            late_words=0;late_uploads=0;case_read_jobs=0;case_write_jobs=0;uniform_interval=0;
            case_index=case_index+1;
            for(integer n=0;n<frames;n=n+1) frame(n,playback_words,upload_words);
            if(should_fit && frames_missing_deadline!=0)
                $fatal(1,"Expected feasible memory load%0s missed deadline",name);
            if(!should_fit && frames_missing_deadline==0)
                $fatal(1,"Expected overloaded memory load%0s unexpectedly fit",name);
            if(late_uploads!=0) $fatal(1,"Playback starved a released upload operation");
            if(!first_case) $fdisplay(report_file,",");
            $fwrite(report_file,{
                "{\"name\":\"%0s\",\"frames\":%0d,\"reads_per_frame\":%0d,",
                "\"uploads_per_frame\":%0d,\"upload_release_period_clocks\":%0d,",
                "\"reads_served\":%0d,\"writes_served\":%0d,",
                "\"min_elapsed_clocks\":%0d,\"max_elapsed_clocks\":%0d,",
                "\"frames_missing_deadline\":%0d,\"late_word_responses\":%0d,",
                "\"max_read_latency\":%0d,\"max_write_latency\":%0d,",
                "\"max_upload_response_after_release\":%0d,",
                "\"last_read_only_accept_interval\":%0d}"},
                name,frames,playback_words,upload_words,release_period,
                case_read_jobs,case_write_jobs,min_frame_clocks,max_frame_clocks,
                frames_missing_deadline,late_words,max_read_latency,max_write_latency,
                max_upload_response_after_release,uniform_interval);
            first_case=0;case_count=case_count+1;
            $display("LOCAL_MEMORY %0s R=%0d W=%0d elapsed=%0d..%0d/768 frames=%0d deadline_misses=%0d read/write_latency=%0d/%0d upload_release_to_reply=%0d",name,playback_words,upload_words,min_frame_clocks,max_frame_clocks,frames,frames_missing_deadline,max_read_latency,max_write_latency,max_upload_response_after_release);
        end
    endtask

    initial begin
        if($value$plusargs("REPORT=%s",report_path)) begin end
        report_file=$fopen(report_path,"w");
        if(report_file==0) $fatal(1,"Cannot create mixed-memory report%0s",report_path);
        for(integer n=0;n<MAX_WORDS;n=n+1) expected_words[n]=0;
        #2;power_reset_n=0;reset_n=0;
        repeat(20) @(negedge clk);clear_start=cycle;clearing=1;power_reset_n=1;reset_n=1;
        wait(memory_ready);@(negedge clk);clearing=0;clear_cycles=cycle-clear_start;
        if(clear_writes!=262144) $fatal(1,"Expected one full physical reset clear, got%0d halfword writes",clear_writes);
        checking=1;
        $fdisplay(report_file,"{\"scope\":\"Offline raw-word capacity only; disjoint inactive-buffer uploads, not whole-batch publication/coherence or an implemented voice arbiter\",\"clock_hz\":33868800,\"frame_clocks\":768,\"normal_upload_release_period_clocks\":32,\"physical_clear_clocks\":%0d,\"cases\":[",clear_cycles);
        run_case("mono16_pair_wordcount_aligned",16,24,32,16,1);
        run_case("mono16_pair_wordcount_worst_alignment",32,24,32,16,1);
        run_case("stereo16_pair_wordcount_aligned",32,24,32,16,1);
        run_case("stereo16_pair_wordcount_unaligned",48,24,32,16,1);
        run_case("sixteen_BADP_synchronised_header_payload_window",64,24,32,16,1);
        run_case("mixed_eight_mono_two_stereo_six_BADP_window",46,24,32,16,1);
        run_case("boundary_78reads_24uploads",78,24,32,16,1);
        run_case("overload_79reads_24uploads",79,24,32,1,0);
        run_case("read_only_109words",109,0,32,8,1);
        run_case("read_only_110words",110,0,32,1,0);
        run_case("uncoalesced_or_cold_seek_128words",128,24,32,1,0);
        // These ready-at-start bursts are physical writeback backlog, not a
        // model of the public whole-batch publication edge. A future commit
        // buffer/forwarding owner would have to preserve active-source reads.
        run_case("four_stereoPCM16_unaligned_word_window_plus32writeback",12,32,0,8,1);
        run_case("eight_stereoPCM16_unaligned_word_window_plus32writeback",24,32,0,8,1);
        run_case("twelve_stereoPCM16_unaligned_word_window_plus32writeback",36,32,0,8,1);
        run_case("peak_16word_writeback_plus48reads",48,16,0,8,1);
        run_case("peak_32word_writeback_plus48reads",48,32,0,8,1);
        run_case("peak_32word_writeback_BADP64read_window",64,32,0,8,1);
        run_case("peak_32word_writeback_boundary68reads",68,32,0,8,1);
        run_case("peak_32word_writeback_overload69reads",69,32,0,1,0);
        $fdisplay(report_file,"\n]}");$fclose(report_file);
        $display("PASS apu_mixed_memory: %0d capacity cases, %0d real words, one262144-halfword clear in%0dclocks; no operations dropped",case_count,total_words,clear_cycles);
        $finish;
    end
    initial begin #50000000;$fatal(1,"APU mixed-memory probe watchdog");end
endmodule
