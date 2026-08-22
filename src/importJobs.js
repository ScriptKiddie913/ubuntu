const fs = require('fs');
const { nanoid } = require('nanoid');
const megaDb = require('./megaDb');

// Transient, in-process only — this is progress-tracking state for an import
// that's currently running, not "your data." It intentionally lives only in
// memory (not Supabase, not MEGA): if the server restarts mid-import, the job
// disappears, but every segment already committed to MEGA up to that point
// stays there (see the incremental commit in megaDb.ingestTextFileStreaming) —
// you'd just re-run the import for whatever wasn't finished.
const jobs = new Map();
const JOB_TTL_MS = 60 * 60 * 1000; // keep finished job status around for an hour so the UI can still read it

function startImportJob(userId, tableName, filePath) {
  const jobId = nanoid();
  jobs.set(jobId, { status: 'running', rowsProcessed: 0, segmentsWritten: 0, error: null, startedAt: Date.now() });

  megaDb
    .ingestTextFileStreaming(userId, tableName, filePath, ({ rowsProcessed, segmentsWritten, done }) => {
      const job = jobs.get(jobId);
      if (!job) return;
      job.rowsProcessed = rowsProcessed;
      job.segmentsWritten = segmentsWritten;
      if (done) job.status = 'done';
    })
    .then(() => {
      const job = jobs.get(jobId);
      if (job) job.status = 'done';
    })
    .catch((err) => {
      console.error(`[db-import] job ${jobId} failed:`, err);
      const job = jobs.get(jobId);
      if (job) {
        job.status = 'error';
        job.error = err.message;
      }
    })
    .finally(() => {
      fs.unlink(filePath, () => {});
      setTimeout(() => jobs.delete(jobId), JOB_TTL_MS);
    });

  return jobId;
}

function getImportJob(jobId) {
  return jobs.get(jobId) || null;
}

module.exports = { startImportJob, getImportJob };
