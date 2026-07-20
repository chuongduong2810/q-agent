// Playwright reporter that emits ONE JSON line per finished test to stdout, so
// the Local Agent can forward each spec's pass/fail to the server the moment it
// finishes — instead of waiting for the whole run + report.json (#exec-live).
//
// The agent tails stdout for lines prefixed with "QAGENT_TEST " and posts
// exec.case.result immediately. The end-of-run report.json still drives evidence
// upload + reconciliation, so this reporter only moves the status forward in time.
//
// Retries are disabled in the generated config (retries: 0), so onTestEnd fires
// exactly once per test. Status is emitted RAW (passed/failed/timedOut/…); the
// agent normalizes it via report.ts's normalizeStatus so both paths agree.
const path = require('path');

class QAgentLiveReporter {
  onTestEnd(test, result) {
    try {
      const file = test && test.location && test.location.file ? path.basename(test.location.file) : '';
      if (!file) return;
      const line =
        'QAGENT_TEST ' +
        JSON.stringify({
          file,
          status: result && result.status ? result.status : 'failed',
          durationMs: Math.trunc((result && result.duration) || 0),
          error: result && result.error && result.error.message ? String(result.error.message) : '',
        });
      process.stdout.write(line + '\n');
    } catch {
      // A reporter must never throw into the run.
    }
  }
}

module.exports = QAgentLiveReporter;
