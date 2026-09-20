CREATE TABLE app_acquisition_observations_archive (LIKE app_acquisition_observations INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE app_acquisition_observations_archive ADD PRIMARY KEY (id);
CREATE INDEX app_acquisition_observations_archive_record_idx ON app_acquisition_observations_archive (workspace_id, source, source_record_id, observed_at DESC);

CREATE TABLE app_acquisition_changes_archive (LIKE app_acquisition_changes INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE app_acquisition_changes_archive ADD PRIMARY KEY (id);
CREATE INDEX app_acquisition_changes_archive_workspace_idx ON app_acquisition_changes_archive (workspace_id, changed_at DESC);

CREATE TABLE app_acquisition_delivery_attempts_archive (LIKE app_acquisition_delivery_attempts INCLUDING DEFAULTS INCLUDING CONSTRAINTS);
ALTER TABLE app_acquisition_delivery_attempts_archive ADD PRIMARY KEY (id);
CREATE INDEX app_acquisition_delivery_attempts_archive_workspace_idx ON app_acquisition_delivery_attempts_archive (workspace_id, attempted_at DESC);
