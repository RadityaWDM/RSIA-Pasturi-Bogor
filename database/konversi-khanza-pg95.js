'use strict';
// Konversi skema MySQL/MariaDB SIMRS Khanza (sik.sql) menjadi DDL PostgreSQL 9.5.
// Hanya membuat tabel, primary key, foreign key, unique, check (dari enum), dan index.
// Data (INSERT), trigger, procedure, function, dan view tidak diikutsertakan.
//
// Pemakaian:
//   node konversi-khanza-pg95.js <sik.sql> <keluaran.sql> <laporan.txt>

const fs = require('fs');
const crypto = require('crypto');

const [, , inPath, outPath, reportPath] = process.argv;
if (!inPath || !outPath || !reportPath) {
  console.error('Pemakaian: node konversi-khanza-pg95.js <sik.sql> <keluaran.sql> <laporan.txt>');
  process.exit(1);
}

const MAX_IDENT = 63; // batas panjang identifier PostgreSQL (NAMEDATALEN - 1)

const laporan = {
  tabel: 0,
  kolom: 0,
  charDiubahVarchar: 0,
  enumCheck: 0,
  autoIncrement: 0,
  onUpdateDibuang: 0,
  defaultDibuang: [],
  fkDibuat: 0,
  fkDilewati: [],
  uniqueDibuat: 0,
  uniqueUntukFk: 0,
  indexDibuat: 0,
  indexRangkap: 0,
  identifierDipendekkan: new Set(),
  identifierBentrok: [],
  catatan: [],
};

// ---------- utilitas identifier dan literal ----------

function hash8(s) {
  return crypto.createHash('md5').update(s).digest('hex').slice(0, 8);
}

// Semua identifier diubah ke huruf kecil. MySQL tidak membedakan huruf pada nama kolom,
// sehingga aplikasi yang menulis SQL tanpa tanda kutip tetap bisa dipakai di PostgreSQL.
function ident(name) {
  let n = name.toLowerCase();
  if (Buffer.byteLength(n, 'utf8') > MAX_IDENT) {
    n = n.slice(0, 54) + '_' + hash8(n);
    laporan.identifierDipendekkan.add(name);
  }
  return n;
}

function q(name) {
  return '"' + name.replace(/"/g, '""') + '"';
}

function lit(s) {
  return "'" + s.replace(/'/g, "''") + "'";
}

const usedNames = new Set();
function uniqueName(base) {
  let n = ident(base);
  let i = 2;
  while (usedNames.has(n)) {
    n = ident(base + '_' + i);
    i++;
  }
  usedNames.add(n);
  return n;
}

// ---------- parser literal string MySQL ----------

// Membaca string bergaya MySQL yang dimulai di s[i] === "'".
// Mendukung escape '' dan \' serta \\.
function readStr(s, i) {
  if (s[i] !== "'") throw new Error('string diharapkan di posisi ' + i + ': ' + s.slice(i, i + 40));
  let out = '';
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === '\\') {
      const n = s[j + 1];
      const map = { n: '\n', r: '\r', t: '\t', 0: '\0' };
      out += n in map ? map[n] : n;
      j += 2;
    } else if (c === "'") {
      if (s[j + 1] === "'") {
        out += "'";
        j += 2;
      } else {
        return { value: out, end: j + 1 };
      }
    } else {
      out += c;
      j++;
    }
  }
  throw new Error('string tidak tertutup: ' + s.slice(i, i + 60));
}

// ---------- pemetaan tipe ----------

function mapType(c) {
  const n = c.args.replace(/[()]/g, '');
  switch (c.base) {
    case 'varchar':
      return { sql: 'varchar(' + n + ')', family: 'string' };
    case 'char':
      laporan.charDiubahVarchar++;
      return { sql: 'varchar(' + n + ')', family: 'string' };
    case 'text':
    case 'tinytext':
    case 'mediumtext':
    case 'longtext':
      return { sql: 'text', family: 'string' };
    case 'tinyint':
      return { sql: 'smallint', family: 'int' };
    case 'smallint':
      return c.unsigned ? { sql: 'integer', family: 'int' } : { sql: 'smallint', family: 'int' };
    case 'mediumint':
      return c.unsigned ? { sql: 'bigint', family: 'int' } : { sql: 'integer', family: 'int' };
    case 'int':
    case 'integer':
      return c.unsigned ? { sql: 'bigint', family: 'int' } : { sql: 'integer', family: 'int' };
    case 'bigint':
      return c.unsigned ? { sql: 'numeric(20,0)', family: 'numeric' } : { sql: 'bigint', family: 'int' };
    case 'year':
      return { sql: 'smallint', family: 'int' };
    case 'double':
      return { sql: 'double precision', family: 'numeric' };
    case 'float':
      return { sql: 'real', family: 'numeric' };
    case 'decimal':
    case 'numeric':
      return { sql: n ? 'numeric(' + n + ')' : 'numeric', family: 'numeric' };
    case 'date':
      return { sql: 'date', family: 'date' };
    case 'time':
      return { sql: 'time', family: 'time' };
    case 'datetime':
    case 'timestamp':
      return { sql: 'timestamp', family: 'timestamp' };
    case 'blob':
    case 'tinyblob':
    case 'mediumblob':
    case 'longblob':
    case 'binary':
    case 'varbinary':
      return { sql: 'bytea', family: 'bytea' };
    case 'enum': {
      const max = Math.max(1, ...c.enumVals.map((v) => [...v].length));
      return { sql: 'varchar(' + max + ')', family: 'string' };
    }
    default:
      throw new Error('tipe tidak didukung: ' + c.base);
  }
}

// ---------- parser kolom ----------

function parseColumn(table, name, rest) {
  const c = {
    name,
    base: '',
    args: '',
    enumVals: null,
    unsigned: false,
    notNull: false,
    auto: false,
    onUpdate: false,
    defStr: undefined,
    defNum: undefined,
    defExpr: undefined,
  };
  let r = rest;

  if (/^enum\(/i.test(r)) {
    c.base = 'enum';
    c.enumVals = [];
    let i = r.indexOf('(') + 1;
    for (;;) {
      if (r[i] === ' ' || r[i] === ',') {
        i++;
        continue;
      }
      if (r[i] === ')') {
        i++;
        break;
      }
      const s = readStr(r, i);
      c.enumVals.push(s.value);
      i = s.end;
    }
    r = r.slice(i);
  } else {
    const m = /^([a-z]+)(?:\(([^)]*)\))?/i.exec(r);
    if (!m) throw new Error('tipe kolom tidak terbaca di ' + table + '.' + name + ': ' + r.slice(0, 60));
    c.base = m[1].toLowerCase();
    c.args = m[2] || '';
    r = r.slice(m[0].length);
  }

  const u = /^\s+unsigned\b/i.exec(r);
  if (u) {
    c.unsigned = true;
    r = r.slice(u[0].length);
  }

  for (;;) {
    r = r.replace(/^\s+/, '');
    if (!r.length) break;
    let m;
    if ((m = /^NOT NULL\b/i.exec(r))) {
      c.notNull = true;
      r = r.slice(m[0].length);
    } else if ((m = /^NULL\b/i.exec(r))) {
      r = r.slice(m[0].length);
    } else if ((m = /^AUTO_INCREMENT\b/i.exec(r))) {
      c.auto = true;
      r = r.slice(m[0].length);
    } else if ((m = /^(CHARACTER SET|COLLATE)\s+\S+/i.exec(r))) {
      r = r.slice(m[0].length);
    } else if ((m = /^ON UPDATE\s+[A-Za-z_]+(\(\))?/i.exec(r))) {
      c.onUpdate = true;
      r = r.slice(m[0].length);
    } else if (/^COMMENT\s+'/i.test(r)) {
      const q1 = r.indexOf("'");
      const s = readStr(r, q1);
      r = r.slice(s.end);
    } else if (/^DEFAULT\s+/i.test(r)) {
      const m2 = /^DEFAULT\s+/i.exec(r);
      let i = m2[0].length;
      if (r[i] === "'") {
        const s = readStr(r, i);
        c.defStr = s.value;
        r = r.slice(s.end);
      } else {
        const tok = /^\S+/.exec(r.slice(i))[0];
        if (/^null$/i.test(tok)) {
          // NULL: tidak perlu ditulis
        } else if (/^current_timestamp(\(\))?$/i.test(tok)) {
          c.defExpr = 'CURRENT_TIMESTAMP';
        } else if (/^[-+]?\d+(\.\d+)?$/.test(tok)) {
          c.defNum = tok;
        } else {
          laporan.catatan.push('default tidak dikenal ' + table + '.' + name + ': ' + tok);
        }
        r = r.slice(i + tok.length);
      }
    } else {
      laporan.catatan.push('atribut kolom tidak dikenal ' + table + '.' + name + ': ' + r.slice(0, 40));
      r = r.replace(/^\S+/, '');
    }
  }
  return c;
}

// Mengubah default MySQL menjadi literal PostgreSQL. Mengembalikan null jika tidak valid di PostgreSQL.
function convertDefault(c, t) {
  if (c.defExpr !== undefined) return t.family === 'timestamp' ? c.defExpr : null;
  if (c.defNum !== undefined) return t.family === 'int' || t.family === 'numeric' ? c.defNum : null;
  if (c.defStr !== undefined) {
    const v = c.defStr;
    if (c.enumVals) return c.enumVals.includes(v) ? lit(v) : null;
    switch (t.family) {
      case 'date':
        return /^\d{4}-\d{2}-\d{2}$/.test(v) && !v.startsWith('0000') ? lit(v) : null;
      case 'time':
        return /^\d{2}:\d{2}:\d{2}$/.test(v) ? lit(v) : null;
      case 'timestamp':
        return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v) && !v.startsWith('0000') ? lit(v) : null;
      case 'int':
      case 'numeric':
        return /^[-+]?\d+(\.\d+)?$/.test(v) ? v : null;
      case 'string':
        return lit(v);
      default:
        return null;
    }
  }
  return null;
}

// ---------- parser tabel ----------

function parseKeyCols(s) {
  return s.split(',').map((p) => {
    const m = /`([^`]+)`/.exec(p);
    if (!m) throw new Error('kolom kunci tidak dikenal: ' + s);
    return m[1];
  });
}

function parseTable(name, body) {
  const t = { name, cols: [], pk: null, uniques: [], indexes: [], fks: [], catatan: [] };
  for (const raw of body.split('\n')) {
    let line = raw.trim();
    if (line.endsWith(',')) line = line.slice(0, -1);
    let m;
    if ((m = /^`([^`]+)` (.+)$/.exec(line))) {
      t.cols.push(parseColumn(name, m[1], m[2]));
    } else if ((m = /^PRIMARY KEY \((.+)\)(?: USING \w+)?$/.exec(line))) {
      t.pk = parseKeyCols(m[1]);
    } else if ((m = /^(UNIQUE |FULLTEXT |SPATIAL )?KEY `([^`]+)` \((.+)\)(?: USING \w+)?$/.exec(line))) {
      const item = { name: m[2], cols: parseKeyCols(m[3]) };
      if (/^UNIQUE/i.test(m[1] || '')) t.uniques.push(item);
      else t.indexes.push(item);
    } else if ((m = /^CONSTRAINT `([^`]+)` FOREIGN KEY \((.+?)\) REFERENCES `([^`]+)` \((.+?)\)((?: ON (?:DELETE|UPDATE) (?:CASCADE|SET NULL|NO ACTION|RESTRICT|SET DEFAULT))*)$/.exec(line))) {
      const aksi = { DELETE: null, UPDATE: null };
      const reA = /ON (DELETE|UPDATE) (CASCADE|SET NULL|NO ACTION|RESTRICT|SET DEFAULT)/g;
      let a;
      while ((a = reA.exec(m[5]))) aksi[a[1]] = a[2];
      t.fks.push({
        name: m[1],
        cols: parseKeyCols(m[2]),
        refTable: m[3],
        refCols: parseKeyCols(m[4]),
        onDelete: aksi.DELETE,
        onUpdate: aksi.UPDATE,
      });
    } else {
      t.catatan.push('baris tidak dikenal: ' + line.slice(0, 80));
    }
  }
  return t;
}

// ---------- baca dan parse sik.sql ----------

const sumber = fs
  .readFileSync(inPath, 'utf8')
  .replace(/\r\n/g, '\n')
  .split('\n')
  .filter((l) => !l.startsWith('INSERT INTO'))
  .join('\n');

const createRe = /^CREATE TABLE `([^`]+)` \(\n([\s\S]*?)\n\) ENGINE=[^\n]*;$/gm;
const tables = [];
let mm;
while ((mm = createRe.exec(sumber))) {
  tables.push(parseTable(mm[1], mm[2]));
}
laporan.tabel = tables.length;

const tabelByName = new Map(tables.map((t) => [t.name, t]));

// ---------- tulis keluaran ----------

const out = [];
const indexSql = [];
const fkSql = [];
const skipCommentFk = [];

out.push('-- Skema SIMRS Khanza untuk PostgreSQL 9.5');
out.push('-- Dihasilkan otomatis dari SIMRS-Khanza/sik.sql oleh konversi-khanza-pg95.js.');
out.push('-- Isi: tabel, primary key, foreign key, unique, check (dari enum), dan index.');
out.push('-- Tidak berisi data, trigger, stored procedure, function, atau view.');
out.push('-- Lihat khanza-pg95-laporan.txt untuk daftar perubahan dan item yang dilewati.');
out.push('');
out.push('BEGIN;');
out.push('CREATE SCHEMA khanza;');
out.push('SET search_path TO khanza;');
out.push('');

for (const t of tables) {
  const tn = ident(t.name);
  const defs = [];
  const colNames = new Set(t.cols.map((c) => c.name));

  for (const c of t.cols) {
    laporan.kolom++;
    let typ = mapType(c);
    let sqlType = typ.sql;
    const parts = [];

    if (c.auto) {
      if (typ.family === 'int' && sqlType === 'integer') sqlType = 'serial';
      else if (typ.family === 'int' && sqlType === 'bigint') sqlType = 'bigserial';
      else if (typ.family === 'int' && sqlType === 'smallint') sqlType = 'smallserial';
      else laporan.catatan.push('AUTO_INCREMENT tidak didukung ' + t.name + '.' + c.name);
      laporan.autoIncrement++;
    }
    if (c.onUpdate) laporan.onUpdateDibuang++;

    parts.push(q(ident(c.name)), sqlType);

    if (!c.auto) {
      const d = convertDefault(c, typ);
      const rawAda = c.defStr !== undefined || c.defNum !== undefined || c.defExpr !== undefined;
      if (d !== null) parts.push('DEFAULT ' + d);
      else if (rawAda) laporan.defaultDibuang.push(t.name + '.' + c.name);
    }

    if (c.notNull) parts.push('NOT NULL');

    if (c.enumVals && c.enumVals.length) {
      const vals = c.enumVals.map(lit).join(', ');
      parts.push('CHECK (' + q(ident(c.name)) + ' IN (' + vals + '))');
      laporan.enumCheck++;
    }
    defs.push('  ' + parts.join(' '));
  }

  // Primary key dan unique key (inline di CREATE TABLE)
  const keyLists = [];
  const sameCols = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
  const validCols = (cols) => cols.every((c) => colNames.has(c));

  if (t.pk) {
    if (validCols(t.pk)) {
      defs.push('  CONSTRAINT ' + q(uniqueName(t.name + '_pkey')) + ' PRIMARY KEY (' + t.pk.map((c) => q(ident(c))).join(', ') + ')');
      keyLists.push(t.pk);
    } else {
      t.catatan.push('PK memakai kolom yang tidak ada');
    }
  }

  for (const u of t.uniques) {
    if (!validCols(u.cols)) {
      t.catatan.push('UNIQUE ' + u.name + ' memakai kolom yang tidak ada');
      continue;
    }
    if (keyLists.some((k) => sameCols(k, u.cols))) continue;
    defs.push('  CONSTRAINT ' + q(uniqueName(t.name + '_' + u.name + '_key')) + ' UNIQUE (' + u.cols.map((c) => q(ident(c))).join(', ') + ')');
    keyLists.push(u.cols);
    laporan.uniqueDibuat++;
  }

  // Index biasa: buang yang menjadi awalan (prefix) dari key lain, karena sudah tercakup.
  const plain = t.indexes
    .filter((ix) => {
      if (!validCols(ix.cols)) {
        t.catatan.push('INDEX ' + ix.name + ' memakai kolom yang tidak ada');
        return false;
      }
      return true;
    })
    .sort((a, b) => b.cols.length - a.cols.length);
  const kept = [];
  for (const ix of plain) {
    const covered = [...keyLists, ...kept.map((k) => k.cols)].some(
      (k) => k.length >= ix.cols.length && ix.cols.every((c, i) => k[i] === c)
    );
    if (covered) {
      laporan.indexRangkap++;
      continue;
    }
    kept.push(ix);
    indexSql.push(
      'CREATE INDEX ' + q(uniqueName(t.name + '_' + ix.name + '_idx')) + ' ON ' + q(tn) +
        ' (' + ix.cols.map((c) => q(ident(c))).join(', ') + ');'
    );
    laporan.indexDibuat++;
  }

  out.push('-- Tabel ' + t.name);
  out.push('CREATE TABLE ' + q(tn) + ' (');
  out.push(defs.join(',\n'));
  out.push(');');
  out.push('');

  for (const c of t.catatan) laporan.catatan.push(t.name + ': ' + c);
}

// ---------- foreign key ----------

for (const t of tables) {
  for (const f of t.fks) {
    const alasan = [];
    let perluUnique = false;
    const parent = tabelByName.get(f.refTable);
    if (!parent) {
      alasan.push('tabel induk tidak ada');
    } else {
      if (f.cols.length !== f.refCols.length) alasan.push('jumlah kolom tidak sama');
      const childCols = f.cols.map((c) => t.cols.find((x) => x.name === c));
      const parentCols = f.refCols.map((c) => parent.cols.find((x) => x.name === c));
      if (childCols.some((x) => !x)) alasan.push('kolom anak tidak ada');
      if (parentCols.some((x) => !x)) alasan.push('kolom induk tidak ada');
      if (!alasan.length) {
        const pkSet = parent.pk && sameSet(parent.pk, f.refCols) ? true : false;
        const uqSet = parent.uniques.some((u) => sameSet(u.cols, f.refCols));
        // Induk tanpa PK/UNIQUE pada kolom ini: UNIQUE ditambahkan di bawah, setelah cek tipe lolos.
        perluUnique = !pkSet && !uqSet;
        for (let i = 0; i < childCols.length; i++) {
          const a = mapType(childCols[i]);
          const b = mapType(parentCols[i]);
          const ka = a.family === 'string' || a.family === 'int' ? a.family : a.sql;
          const kb = b.family === 'string' || b.family === 'int' ? b.family : b.sql;
          if (ka !== kb) alasan.push('tipe tidak kompatibel: ' + f.cols[i] + ' (' + a.sql + ') vs ' + f.refCols[i] + ' (' + b.sql + ')');
        }
      }
    }

    if (!alasan.length && perluUnique) {
      // PostgreSQL mewajibkan kolom induk PK/UNIQUE, sedangkan MySQL cukup index.
      const uqNama = uniqueName(parent.name + '_' + f.refCols.join('_') + '_key');
      fkSql.push(
        'ALTER TABLE ' + q(ident(parent.name)) + ' ADD CONSTRAINT ' + q(uqNama) +
          ' UNIQUE (' + f.refCols.map((c) => q(ident(c))).join(', ') + ');'
      );
      parent.uniques.push({ name: f.refCols.join('_'), cols: f.refCols.slice() });
      laporan.uniqueUntukFk++;

      // Index biasa pada kolom yang sama sudah tercakup oleh UNIQUE ini, jadi dibuang agar tidak rangkap.
      const akhiran = ' ON ' + q(ident(parent.name)) + ' (' + f.refCols.map((c) => q(ident(c))).join(', ') + ');';
      for (let i = indexSql.length - 1; i >= 0; i--) {
        if (indexSql[i].endsWith(akhiran)) {
          indexSql.splice(i, 1);
          laporan.indexDibuat--;
          laporan.indexRangkap++;
        }
      }
    }

    if (alasan.length) {
      laporan.fkDilewati.push(t.name + '.' + f.name + ': ' + alasan.join('; '));
      skipCommentFk.push('-- DILEWATI ' + t.name + ' (' + f.name + '): ' + alasan.join('; '));
      continue;
    }

    const aksi = [];
    if (f.onDelete) aksi.push('ON DELETE ' + f.onDelete);
    if (f.onUpdate) aksi.push('ON UPDATE ' + f.onUpdate);
    fkSql.push(
      'ALTER TABLE ' + q(ident(t.name)) + ' ADD CONSTRAINT ' + q(uniqueName(t.name + '_' + f.name)) +
        ' FOREIGN KEY (' + f.cols.map((c) => q(ident(c))).join(', ') + ') REFERENCES ' + q(ident(f.refTable)) +
        ' (' + f.refCols.map((c) => q(ident(c))).join(', ') + ')' + (aksi.length ? ' ' + aksi.join(' ') : '') + ';'
    );
    laporan.fkDibuat++;
  }
}

function sameSet(a, b) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

out.push('-- ===== Foreign key =====');
out.push(...skipCommentFk);
out.push(...fkSql);
out.push('');
out.push('-- ===== Index =====');
out.push(...indexSql);
out.push('');
out.push('COMMIT;');
out.push('');

// Cek bentrok nama setelah huruf kecil (MySQL di Linux membedakan huruf pada nama tabel).
const lowerSeen = new Map();
for (const t of tables) {
  const k = t.name.toLowerCase();
  if (lowerSeen.has(k)) laporan.identifierBentrok.push(lowerSeen.get(k) + ' vs ' + t.name);
  else lowerSeen.set(k, t.name);
}

fs.writeFileSync(outPath, out.join('\n'), 'utf8');

const lines = [];
lines.push('LAPORAN KONVERSI SIMRS KHANZA KE POSTGRESQL 9.5');
lines.push('Sumber: ' + inPath);
lines.push('Keluaran: ' + outPath);
lines.push('');
lines.push('Tabel                     : ' + laporan.tabel);
lines.push('Kolom                     : ' + laporan.kolom);
lines.push('Foreign key dibuat        : ' + laporan.fkDibuat);
lines.push('Foreign key dilewati      : ' + laporan.fkDilewati.length);
lines.push('Unique key dibuat         : ' + laporan.uniqueDibuat);
lines.push('UNIQUE tambahan untuk FK : ' + laporan.uniqueUntukFk);
lines.push('Index dibuat              : ' + laporan.indexDibuat);
lines.push('Index dibuang (rangkap)   : ' + laporan.indexRangkap);
lines.push('CHECK dari enum           : ' + laporan.enumCheck);
lines.push('AUTO_INCREMENT -> serial  : ' + laporan.autoIncrement);
lines.push('char(n) -> varchar(n)     : ' + laporan.charDiubahVarchar);
lines.push('ON UPDATE dibuang         : ' + laporan.onUpdateDibuang);
lines.push('Default dibuang           : ' + laporan.defaultDibuang.length);
lines.push('Identifier dipendekkan    : ' + laporan.identifierDipendekkan.size);
lines.push('Identifier bentrok (huruf): ' + laporan.identifierBentrok.length);
lines.push('');
lines.push('== Foreign key yang dilewati ==');
lines.push(...(laporan.fkDilewati.length ? laporan.fkDilewati : ['(tidak ada)']));
lines.push('');
lines.push('== Default yang dibuang (tidak valid di PostgreSQL) ==');
lines.push(...(laporan.defaultDibuang.length ? laporan.defaultDibuang : ['(tidak ada)']));
lines.push('');
lines.push('== Identifier yang dipendekkan (>63 karakter) ==');
lines.push(...(laporan.identifierDipendekkan.size ? [...laporan.identifierDipendekkan] : ['(tidak ada)']));
lines.push('');
lines.push('== Identifier bentrok setelah huruf kecil ==');
lines.push(...(laporan.identifierBentrok.length ? laporan.identifierBentrok : ['(tidak ada)']));
lines.push('');
lines.push('== Catatan lain ==');
lines.push(...(laporan.catatan.length ? laporan.catatan : ['(tidak ada)']));
fs.writeFileSync(reportPath, lines.join('\n') + '\n', 'utf8');

console.log(lines.slice(0, 18).join('\n'));
