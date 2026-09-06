// updateService — Selbst-Update der Bridge aus dem Git-Repo, für den "Update"-Button in der UI.
//
// Ablauf: git pull --ff-only  ->  npm install --omit=dev  ->  systemctl restart.
// Der Restart läuft detached mit kurzer Verzögerung, damit die HTTP-Antwort noch rausgeht;
// systemd startet den Prozess neu, das Frontend pollt danach /api/health.
//
// Voraussetzung für den Restart-Schritt: passwortloses sudo NUR für diesen einen Befehl, z. B. in
// /etc/sudoers.d/modbus-bridge:   <user> ALL=(root) NOPASSWD: /usr/bin/systemctl restart modbus-bridge
// Schlägt der Restart fehl, bleibt der gezogene Code liegen und ein manueller Neustart genügt.

const { execFile, spawn } = require('child_process');

const CWD = process.cwd();               // = WorkingDirectory des Service (Install-Dir)
const SERVICE = process.env.MB_SERVICE_NAME || 'modbus-bridge';

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: CWD, timeout: 180000, ...opts }, (err, stdout, stderr) => {
      resolve({
        cmd: `${cmd} ${args.join(' ')}`,
        ok: !err,
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        stdout: (stdout || '').toString().trim(),
        stderr: (stderr || '').toString().trim(),
      });
    });
  });
}

async function getVersion() {
  const hash = await run('git', ['rev-parse', '--short', 'HEAD']);
  const subj = await run('git', ['log', '-1', '--pretty=%s']);
  const date = await run('git', ['log', '-1', '--pretty=%ci']);
  const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  return {
    ok: hash.ok,
    commit: hash.stdout,
    subject: subj.stdout,
    date: date.stdout,
    branch: branch.stdout,
    error: hash.ok ? null : (hash.stderr || 'git not available'),
  };
}

async function checkForUpdates() {
  const fetch = await run('git', ['fetch', '--quiet', 'origin']);
  if (!fetch.ok) return { ok: false, error: fetch.stderr || 'git fetch failed', updateAvailable: false };
  const behind = await run('git', ['rev-list', '--count', 'HEAD..@{u}']);
  const ahead  = await run('git', ['rev-list', '--count', '@{u}..HEAD']);
  const n = parseInt(behind.stdout, 10);
  return {
    ok: behind.ok,
    behind: Number.isFinite(n) ? n : 0,
    ahead: parseInt(ahead.stdout, 10) || 0,
    updateAvailable: Number.isFinite(n) && n > 0,
    error: behind.ok ? null : (behind.stderr || null),
  };
}

// Laufzeitdaten duerfen ein Update nie blockieren.
//
// Das Datenverzeichnis gehoert nicht in die Versionierung (.gitignore deckt es ab). Ist dort
// aus einem frueheren Fehler noch etwas verfolgt, schreibt der Betrieb permanent daran und
// `git pull --ff-only` bricht mit "local changes would be overwritten" ab — das Geraet laesst
// sich dann gar nicht mehr aktualisieren. Deshalb vor dem Pull die lokalen Aenderungen genau
// dort verwerfen. Im Normalfall greift der Befehl ins Leere und tut nichts.
async function verwerfeDatenaenderungen() {
  const r = await run('git', ['checkout', '--', 'src/persistence/data']);
  return { ...r, cmd: r.cmd, ok: true, hinweis: r.ok ? undefined : 'nichts zu verwerfen' };
}

async function applyUpdate() {
  const steps = [];
  steps.push(await verwerfeDatenaenderungen());
  const pull = await run('git', ['pull', '--ff-only']);
  steps.push(pull);
  if (!pull.ok) return { ok: false, steps };
  const install = await run('npm', ['install', '--omit=dev']);
  steps.push(install);
  return { ok: steps.every((s) => s.ok), steps };
}

// Detached-Neustart nach kurzer Verzögerung; HTTP-Antwort geht vorher raus.
function scheduleRestart(delayMs = 800) {
  const secs = Math.max(0, delayMs / 1000).toFixed(2);
  try {
    const child = spawn('bash', ['-c', `sleep ${secs}; sudo -n systemctl restart ${SERVICE}`], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return { scheduled: true };
  } catch (e) {
    return { scheduled: false, error: e.message };
  }
}

module.exports = { getVersion, checkForUpdates, applyUpdate, scheduleRestart };
