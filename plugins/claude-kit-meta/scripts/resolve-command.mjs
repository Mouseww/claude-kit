// Pure helpers for picking an executable candidate out of `where <cmd>`
// output on Windows, and for deciding whether that candidate needs a shell
// to run.
//
// Split out from check-daily-update.mjs so tests can import these functions
// directly, following the same pattern as marketplace-source.mjs.
//
// Background: `where claude` on a machine set up via nvm-windows returns two
// lines, e.g.:
//   C:\nvm4w\nodejs\claude       (extensionless wrapper script, for sh)
//   C:\nvm4w\nodejs\claude.cmd   (Windows batch wrapper)
// Windows CreateProcess cannot execute the extensionless file directly
// (ENOENT), so it must never be picked when an extensioned candidate exists.
// Conversely, Node 18+ refuses to execFileSync a .cmd/.bat without `shell:
// true` (CVE-2024-27980 mitigation), so callers need needsShell() to know
// when to opt into the shell.

const EXTENSION_PRIORITY = ['.exe', '.cmd', '.bat'];

/** @param {string} filePath */
function getExtension(filePath) {
  const idx = filePath.lastIndexOf('.');
  if (idx === -1) return '';
  return filePath.slice(idx).toLowerCase();
}

/**
 * Pick the best candidate out of raw `where <cmd>` stdout for execFileSync.
 * Priority: .exe > .cmd > .bat > other extensioned files > extensionless
 * files (last resort, since Windows cannot execute them directly).
 * @param {string} whereOutput
 * @returns {string|null} absolute path, or null if there are no candidates
 */
export function pickExecutable(whereOutput) {
  if (!whereOutput) return null;

  const lines = whereOutput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return null;

  for (const ext of EXTENSION_PRIORITY) {
    const match = lines.find((l) => getExtension(l) === ext);
    if (match) return match;
  }

  const otherExtensioned = lines.find((l) => getExtension(l) !== '');
  if (otherExtensioned) return otherExtensioned;

  // Last resort: an extensionless candidate. Windows cannot execute this
  // directly, but returning it beats returning null.
  return lines[0];
}

/**
 * Whether execFileSync needs `shell: true` to run this path, i.e. it is a
 * Windows .cmd/.bat wrapper.
 * @param {string} filePath
 * @returns {boolean}
 */
export function needsShell(filePath) {
  const ext = getExtension(filePath);
  return ext === '.cmd' || ext === '.bat';
}
