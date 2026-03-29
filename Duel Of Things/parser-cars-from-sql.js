const fs = require('fs-extra');
const path = require('path');

const SQL_FILE = path.join(__dirname, 'cars', 'car_db.sql');
const OUTPUT_FILE = path.join(__dirname, 'cars-data.js');

// Simple SQL VALUES tuple parser: splits on commas outside single quotes
function parseValuesTuple(tuple) {
  const values = [];
  let current = '';
  let inString = false;
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i];
    if (ch === "'" && tuple[i - 1] !== '\\') {
      inString = !inString;
      continue;
    }
    if (ch === ',' && !inString) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.length) values.push(current.trim());
  return values;
}

async function parseCarsFromSql() {
  const sql = await fs.readFile(SQL_FILE, 'utf-8');

  // Find all VALUES tuples after INSERT INTO `car_db`
  const insertIndex = sql.indexOf('INSERT INTO `car_db`');
  if (insertIndex === -1) {
    console.error('INSERT INTO `car_db` not found in SQL file.');
    process.exit(1);
  }

  const valuesSection = sql.slice(insertIndex);
  const tuples = [];
  let buffer = '';
  let depth = 0;
  let started = false;

  for (let i = 0; i < valuesSection.length; i++) {
    const ch = valuesSection[i];
    if (ch === '(') {
      depth++;
      if (depth === 1) {
        started = true;
        continue;
      }
    } else if (ch === ')') {
      depth--;
      if (depth === 0 && started) {
        tuples.push(buffer);
        buffer = '';
        continue;
      }
    }

    if (started && depth >= 1) {
      buffer += ch;
    }
  }

  console.log(`Found ${tuples.length} rows in SQL dump.`);

  const cars = [];

  for (const tup of tuples) {
    const vals = parseValuesTuple(tup);
    // Ensure we have at least up to max_speed_km_per_h (index 60)
    if (vals.length < 61) continue;

    const idTrim = vals[0];
    const make = vals[1].replace(/^'|'$/g, '');
    const model = vals[2].replace(/^'|'$/g, '');
    const yearFromRaw = vals[4].replace(/^'|'$/g, '');
    const maxSpeedRaw = vals[60].replace(/^'|'$/g, '');

    const year = parseInt(yearFromRaw, 10) || null;
    const maxSpeed = parseInt(maxSpeedRaw, 10) || null;

    if (!make || !model || !maxSpeed) continue;

    const id = `${make}-${model}-${idTrim}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    cars.push({
      id,
      make,
      model,
      name: `${make} ${model}`,
      year,
      maxSpeedKmh: maxSpeed
    });
  }

  // Sort by make, then model for easier manual pruning
  cars.sort((a, b) => {
    const makeCmp = a.make.localeCompare(b.make);
    if (makeCmp !== 0) return makeCmp;
    return a.model.localeCompare(b.model);
  });

  // Assign ranks sequentially (for button IDs), independent of speed
  cars.forEach((car, index) => {
    car.rank = index + 1;
  });

  console.log(`Parsed ${cars.length} cars with make/model/year/maxSpeedKmh.`);

  const jsContent = `module.exports = ${JSON.stringify(cars, null, 2)};\n`;
  await fs.writeFile(OUTPUT_FILE, jsContent, 'utf-8');

  console.log(`✅ Wrote cars to ${OUTPUT_FILE}`);
}

parseCarsFromSql().catch(err => {
  console.error(err);
  process.exit(1);
});

