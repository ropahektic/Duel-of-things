const fs = require('fs-extra');
const path = require('path');

const SHOWS_FILE = path.join(__dirname, 'shows.txt');

function looksLikeActorPrefix(prefix) {
  const p = prefix.trim();
  if (!p) return false;
  // no digits in actor list
  if (/\d/.test(p)) return false;

  // Strong signals of a cast list
  if (p.includes(',')) return true;
  if (/\band\b/i.test(p)) return true;

  // Two+ capitalized words (e.g. "Morgan Freeman", "Carl Sagan", "Roberto Gómez")
  // Use unicode letters to handle accents.
  if (/\b\p{Lu}[\p{L}'’.-]+\s+\p{Lu}[\p{L}'’.-]+\b/u.test(p)) return true;

  return false;
}

function cleanHeaderLine(line) {
  const original = line;
  const trimmed = line.trim();

  // Only attempt when there's a year at the end and an " in " separator.
  // Use the FIRST " in " (actors prefix is at the start).
  const yearMatch = trimmed.match(/\(\d{4}\)\s*$/);
  if (!yearMatch) return { line: original, changed: false };

  // Split on whitespace-surrounded "in" (handles multiple spaces / weird spacing)
  const parts = trimmed.split(/\s+in\s+/);
  if (parts.length < 2) return { line: original, changed: false };

  const left = parts[0].trim();
  const right = parts.slice(1).join(' in ').trim(); // preserve any "in" inside the title

  // Right side must still end with (YYYY)
  if (!/\(\d{4}\)\s*$/.test(right)) return { line: original, changed: false };

  // Avoid false positives like "Hills in Band of Brothers (2001)"
  if (!looksLikeActorPrefix(left)) return { line: original, changed: false };

  // If it looks like an actor prefix, keep only the title side
  return { line: right, changed: right !== trimmed };
}

async function run() {
  if (!await fs.pathExists(SHOWS_FILE)) {
    console.error(`File not found: ${SHOWS_FILE}`);
    process.exit(1);
  }

  const content = await fs.readFile(SHOWS_FILE, 'utf-8');
  const lines = content.split(/\r?\n/);

  let inBlock = false;
  let headerDoneForBlock = false;
  let changedCount = 0;

  const out = lines.map((line) => {
    const isBlank = line.trim() === '';
    if (isBlank) {
      inBlock = false;
      headerDoneForBlock = false;
      return line;
    }

    if (!inBlock) {
      inBlock = true;
    }

    if (!headerDoneForBlock) {
      headerDoneForBlock = true;
      const cleaned = cleanHeaderLine(line);
      if (cleaned.changed) changedCount++;
      return cleaned.line;
    }

    return line;
  });

  await fs.writeFile(SHOWS_FILE, out.join('\n'), 'utf-8');
  console.log(`✅ Done. Cleaned ${changedCount} header lines in shows.txt`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

