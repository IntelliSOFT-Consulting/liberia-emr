DROP PROCEDURE IF EXISTS sp_mamba_data_processing_etl;

DELIMITER //

-- Called by core's sp_mamba_etl_scheduler_wrapper after every flatten, with 0 after a full
-- (drop-and-flatten) run and 1 after an incremental one. Calls the derived procedures in the
-- same per-owner order as sp_makefile; a workstream adds its CALLs to its own section only.
CREATE PROCEDURE sp_mamba_data_processing_etl(IN etl_incremental_mode INT)
BEGIN

    -- ---- common (coordinator) ----
    CALL sp_mamba_dim_location_hierarchy();
    CALL sp_mamba_dim_encounter_form();
    CALL sp_mamba_dim_encounter_location();
    CALL sp_mamba_dim_person_cpi();

    -- ---- rmncah (RPT 6) ----

    -- ---- nutrition (RPT 6) ----

    -- ---- malaria (RPT 7) ----
    CALL sp_mamba_fact_malaria_diagnosis();
    CALL sp_mamba_fact_malaria_lab_result();
    CALL sp_mamba_fact_malaria_drug();

    -- ---- ncd (RPT 7) ----
    CALL sp_mamba_fact_ncd_death();
    CALL sp_mamba_fact_ncd_blood_pressure();

    -- ---- emr_ops (RPT 7) ----
    CALL sp_mamba_fact_emr_ops_visit();

END //

DELIMITER ;
