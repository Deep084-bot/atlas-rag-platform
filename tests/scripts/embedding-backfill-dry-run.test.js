import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  TARGET_SPACE_ID,
  USAGE,
  BACKFILL_DB_ENV,
  ALLOW_DATABASE_ENV,
  REQUIRED_SCHEMA_TABLES,
  parseArgs,
  resolveTarget,
  resolveAllowlist,
  verifyTarget,
  isLoopbackAddress,
  preflightSchema,
  runDryRun,
  formatJsonReport,
  formatTextReport,
  main,
  createReadOnlyRunner
} from '../../scripts/dev/embedding-backfill.mjs';
import { VOYAGE_SPACE } from '../../server/embeddings/embeddingSpaces.js';

const TEST_SPACE = VOYAGE_SPACE.id;

function createMockPool({ database = 'atlas_dry_run_test', serverAddr = null, missing = [] } = {}) {
  const queries = [];
  const endCalls = 0;

  const pool = {
    queries,
    get endCalls() {
      return endCalls;
    },
    async query(sql) {
      queries.push({ sql });
      const trimmed = String(sql).trim();

      if (trimmed.toLowerCase().startsWith('select current_database()')) {
        return { rows: [{ database, server_addr: serverAddr }] };
      }

      if (trimmed.includes('to_regclass')) {
        return {
          rows: REQUIRED_SCHEMA_TABLES.map((entry) => ({
            name: entry.name,
            present: !missing.includes(entry.name)
          }))
        };
      }

      return { rows: [] };
    },
    async end() {
      this._endCalls = (this._endCalls || 0) + 1;
    },
    get _endCalls() {
      return this.__endCalls || 0;
    },
    set _endCalls(value) {
      this.__endCalls = value;
    }
  };

  Object.defineProperty(pool, '_endCalls', {
    configurable: true,
    enumerable: false,
    writable: true,
    value: 0
  });

  return pool;
}

test('parseArgs requires --dry-run', () => {
  assert.throws(() => parseArgs([]), /dry-run/i);
  assert.throws(() => parseArgs(['--json']), /dry-run/i);
});

test('parseArgs parses --dry-run, --json, --limit, --page-size, --database-url', () => {
  const args = parseArgs([
    '--dry-run',
    '--json',
    '--limit',
    '10',
    '--page-size',
    '20',
    '--database-url',
    'postgresql:///atlas_test?host=/tmp'
  ]);

  assert.equal(args.dryRun, true);
  assert.equal(args.json, true);
  assert.equal(args.limit, 10);
  assert.equal(args.pageSize, 20);
  assert.equal(args.databaseUrl, 'postgresql:///atlas_test?host=/tmp');
  assert.equal(args.help, false);
});

test('parseArgs rejects write flags', () => {
  assert.throws(() => parseArgs(['--execute']), /read-only/i);
  assert.throws(() => parseArgs(['--apply']), /read-only/i);
  assert.throws(() => parseArgs(['--write']), /read-only/i);
  assert.throws(() => parseArgs(['--commit']), /read-only/i);
  assert.throws(() => parseArgs(['--no-dry-run']), /read-only/i);
});

test('parseArgs rejects unknown arguments', () => {
  assert.throws(() => parseArgs(['--dry-run', '--unknown']), /Unknown argument/i);
});

test('parseArgs rejects non-positive limit/page-size', () => {
  assert.throws(() => parseArgs(['--dry-run', '--limit', '0']), /positive integer/i);
  assert.throws(() => parseArgs(['--dry-run', '--page-size', '-1']), /positive integer/i);
});

test('parseArgs supports --help', () => {
  const args = parseArgs(['--help']);
  assert.equal(args.help, true);
  assert.equal(args.dryRun, false);
});

test('resolveTarget requires a target', () => {
  assert.throws(() => resolveTarget({ args: {}, env: {} }), /No target database/i);
});

test('resolveTarget refuses target equal to DATABASE_URL', () => {
  const raw = 'postgresql://localhost/atlas_prod';
  assert.throws(
    () => resolveTarget({
      args: { databaseUrl: raw },
      env: { DATABASE_URL: raw }
    }),
    /identical to DATABASE_URL/i
  );
});

test('resolveTarget refuses non-local host', () => {
  assert.throws(
    () => resolveTarget({
      args: { databaseUrl: 'postgresql://db.example.com/atlas_disposable' },
      env: {}
    }),
    /not local/i
  );
});

test('resolveTarget refuses staging name', () => {
  assert.throws(
    () => resolveTarget({
      args: { databaseUrl: 'postgresql://localhost/atlas_staging' },
      env: {}
    }),
    /staging or production/i
  );

  assert.throws(
    () => resolveTarget({
      args: { databaseUrl: 'postgresql://localhost/atlas_rag_stg' },
      env: {}
    }),
    /staging or production/i
  );
});

test('resolveTarget refuses non-disposable name', () => {
  assert.throws(
    () => resolveTarget({
      args: { databaseUrl: 'postgresql://localhost/atlas_main' },
      env: {}
    }),
    /does not look disposable/i
  );
});

test('resolveTarget accepts disposable local (socket)', () => {
  const target = resolveTarget({
    args: { databaseUrl: 'postgresql:///atlas_dry_run_test?host=/tmp' },
    env: {}
  });
  assert.equal(target.database, 'atlas_dry_run_test');
  assert.equal(target.host, '');
  assert.equal(target.safeLabel, 'socket:5432/atlas_dry_run_test');
});

test('resolveTarget accepts disposable local (localhost)', () => {
  const target = resolveTarget({
    args: { databaseUrl: 'postgresql://localhost:5432/atlas_test_sandbox' },
    env: {}
  });
  assert.equal(target.database, 'atlas_test_sandbox');
  assert.equal(target.host, 'localhost');
  assert.equal(target.safeLabel, 'localhost:5432/atlas_test_sandbox');
});

test('resolveTarget falls back to dedicated env var', () => {
  const target = resolveTarget({
    args: {},
    env: { [BACKFILL_DB_ENV]: 'postgresql://127.0.0.1/atlas_disposable' }
  });
  assert.equal(target.database, 'atlas_disposable');
  assert.equal(target.host, '127.0.0.1');
});

test('verifyTarget rejects mismatched database', async () => {
  const pool = createMockPool({ database: 'wrong' });
  const target = { database: 'atlas_dry_run_test', host: '' };
  await assert.rejects(() => verifyTarget(pool, target), /connected to database/i);
});

test('verifyTarget rejects forbidden database', async () => {
  const pool = createMockPool({ database: 'atlas_prod' });
  const target = { database: 'atlas_prod', host: 'localhost' };
  await assert.rejects(() => verifyTarget(pool, target), /looks like staging or production/i);
});

test('verifyTarget rejects non-loopback server addr', async () => {
  const pool = createMockPool({ database: 'atlas_dry_run_test', serverAddr: '10.0.0.1' });
  const target = { database: 'atlas_dry_run_test', host: 'localhost' };
  await assert.rejects(() => verifyTarget(pool, target), /non-local server address/i);
});

test('verifyTarget accepts loopback server addr', async () => {
  const pool = createMockPool({ database: 'atlas_dry_run_test', serverAddr: '127.0.0.1' });
  const target = { database: 'atlas_dry_run_test', host: 'localhost' };
  const row = await verifyTarget(pool, target);
  assert.equal(row.database, 'atlas_dry_run_test');
  assert.equal(row.server_addr, '127.0.0.1');
});

test('verifyTarget accepts socket (null addr)', async () => {
  const pool = createMockPool({ database: 'atlas_disposable', serverAddr: null });
  const target = { database: 'atlas_disposable', host: '' };
  const row = await verifyTarget(pool, target);
  assert.equal(row.database, 'atlas_disposable');
  assert.equal(row.server_addr, null);
});

test('runDryRun plans documents and aggregates correctly', async () => {
  const pages = [
    [{ documentId: 'doc-a', status: 'ready' }, { documentId: 'doc-b', status: 'ready' }],
    []
  ];
  const enumerateCalls = [];

  const enumerate = async ({ limit, afterId }) => {
    enumerateCalls.push({ limit, afterId });
    if (afterId === null) return pages[0];
    return pages[1];
  };

  const planCalls = [];
  const runner = {
    async planDocument(id) {
      planCalls.push(id);
      if (id === 'doc-a') {
        return { documentId: 'doc-a', spaceId: TEST_SPACE, totalChunks: 2, embeddedChunks: 2, missingChunks: 0, complete: true };
      }
      return { documentId: 'doc-b', spaceId: TEST_SPACE, totalChunks: 3, embeddedChunks: 1, missingChunks: 2, complete: false };
    }
  };

  const report = await runDryRun({ enumerate, runner, pageSize: 10, now: () => new Date('2026-01-01T00:00:00Z') });

  assert.equal(planCalls.length, 2);
  assert.deepEqual(planCalls, ['doc-a', 'doc-b']);
  assert.equal(report.eligibleDocuments, 2);
  assert.equal(report.inspectedDocuments, 2);
  assert.equal(report.completeDocuments, 1);
  assert.equal(report.incompleteDocuments, 1);
  assert.equal(report.documentsNeedingWork, 1);
  assert.equal(report.totalChunks, 5);
  assert.equal(report.embeddedChunks, 3);
  assert.equal(report.missingChunks, 2);
  assert.equal(report.truncated, false);
  assert.equal(report.scanComplete, true);
  assert.equal(report.errors.length, 0);
});

test('runDryRun honors limit and marks truncated', async () => {
  const pages = [
    [{ documentId: 'doc-1', status: 'ready' }],
    [{ documentId: 'doc-2', status: 'ready' }],
    []
  ];
  let call = 0;

  const enumerate = async ({ limit, afterId }) => {
    const idx = afterId === null ? 0 : afterId === 'doc-1' ? 1 : 2;
    const page = pages[idx] || [];
    call += 1;
    return page;
  };

  const runner = {
    async planDocument(id) {
      return { documentId: id, spaceId: TEST_SPACE, totalChunks: 1, embeddedChunks: 0, missingChunks: 1, complete: false };
    }
  };

  const report = await runDryRun({ enumerate, runner, limit: 1, pageSize: 5, now: () => new Date('2026-01-01T00:00:00Z') });

  assert.equal(report.eligibleDocuments, 1);
  assert.equal(report.truncated, true);
  assert.equal(report.scanComplete, false);
});

test('runDryRun treats planDocument throwing as uninspectable', async () => {
  const enumerate = async () => [{ documentId: 'doc-x', status: 'ready' }];

  const runner = {
    async planDocument() {
      throw new Error('boom');
    }
  };

  const report = await runDryRun({ enumerate, runner });
  assert.equal(report.uninspectableDocuments, 1);
  assert.equal(report.inspectedDocuments, 0);
  assert.equal(report.scanComplete, false);
  assert.equal(report.errors.length, 1);
  assert.equal(report.documents[0].inspectError, 'boom');
});

test('runDryRun treats planDocument returning null as not found', async () => {
  const enumerate = async () => [{ documentId: 'doc-ghost', status: 'ready' }];
  const runner = { async planDocument() { return null; } };
  const report = await runDryRun({ enumerate, runner });
  assert.equal(report.uninspectableDocuments, 1);
  assert.equal(report.scanComplete, false);
  assert.match(report.errors[0].message, /not found/i);
});

test('formatJsonReport is valid and honest for incomplete scans', () => {
  const report = {
    scanComplete: false,
    truncated: true,
    errors: [{ documentId: 'doc-x', message: 'oops' }],
    documents: [],
    eligibleDocuments: 1,
    inspectedDocuments: 0,
    completeDocuments: 0,
    incompleteDocuments: 0,
    uninspectableDocuments: 1,
    totalChunks: 0,
    embeddedChunks: 0,
    missingChunks: 0,
    documentsNeedingWork: 0
  };
  const out = formatJsonReport(report);
  const parsed = JSON.parse(out);
  assert.equal(parsed.scanComplete, false);
  assert.equal(parsed.truncated, true);
});

test('formatTextReport includes DRY RUN and point-in-time note', () => {
  const report = {
    target: 'localhost:5432/atlas_test',
    spaceId: TEST_SPACE,
    generatedAt: '2026-01-01T00:00:00Z',
    documents: [],
    eligibleDocuments: 0,
    inspectedDocuments: 0,
    completeDocuments: 0,
    incompleteDocuments: 0,
    uninspectableDocuments: 0,
    totalChunks: 0,
    embeddedChunks: 0,
    missingChunks: 0,
    truncated: false,
    scanComplete: true,
    errors: []
  };
  const text = formatTextReport(report);
  assert.match(text, /DRY RUN/i);
  assert.match(text, /Point-in-time/i);
});

test('createReadOnlyRunner builds a runner with throwing provider and only planDocument used', async () => {
  const queries = [];
  const pool = {
    async query(sql) {
      const s = String(sql);
      queries.push({ sql: s });
      if (s.includes('FROM documents')) {
        return { rows: [{ id: 'doc-1', status: 'ready', file_name: 'doc.txt', file_type: 'text/plain', file_size_bytes: 10, storage_path: null, source_type: 'upload', progress: 100, failure_reason: null, processing_started_at: null, ready_at: null, failed_at: null, created_at: null, updated_at: null, extracted_text: 'text' }] };
      }
      if (s.includes('AS total_chunks')) {
        return { rows: [{ total_chunks: 2 }] };
      }
      if (s.includes('chunk_embeddings')) {
        return { rows: [{ chunk_id: 'c2' }] };
      }
      return { rows: [] };
    }
  };

  let providerCalls = 0;
  const spyProvider = {
    embedMany: async () => {
      providerCalls += 1;
      throw new Error('should not call');
    },
    embedManyWithUsage: async () => {
      providerCalls += 1;
      throw new Error('should not call');
    }
  };

  const runner = createReadOnlyRunner(pool, { logger: { error() {} }, embeddingProvider: spyProvider });
  const plan = await runner.planDocument('doc-1');

  assert.equal(plan.documentId, 'doc-1');
  assert.equal(plan.spaceId, TARGET_SPACE_ID);
  assert.equal(plan.totalChunks, 2);
  assert.equal(plan.missingChunks, 1);
  assert.equal(providerCalls, 0);

  for (const q of queries) {
    assert.match(q.sql.trimStart(), /^SELECT/i, 'all queries must be SELECT');
    assert.doesNotMatch(q.sql, /\bINSERT\b/i);
    assert.doesNotMatch(q.sql, /\bUPDATE\b/i);
    assert.doesNotMatch(q.sql, /\bDELETE\b/i);
    assert.doesNotMatch(q.sql, /\bTRUNCATE\b/i);
    assert.doesNotMatch(q.sql, /\bFOR\s+UPDATE\b/i);
  }
});

test('main prints help and exits 0', async () => {
  const out = [];
  const err = [];
  const res = await main({ argv: ['--help'], env: {}, deps: { write: (t) => out.push(t), writeError: (t) => err.push(t) } });
  assert.equal(res.exitCode, 0);
  assert.match(out.join(''), /dry-run/i);
  assert.equal(err.length, 0);
});

test('main runs a successful dry-run and closes pool', async () => {
  const out = [];
  const err = [];
  const pool = createMockPool({ database: 'atlas_dry_run_test', serverAddr: null });
  const enumerateCalls = [];

  const res = await main({
    argv: ['--dry-run', '--json', '--database-url', 'postgresql:///atlas_dry_run_test?host=/tmp'],
    env: {},
    deps: {
      createPool: () => pool,
      createEnumerator: () => ({
        listReadyDocuments: async ({ limit, afterId }) => {
          enumerateCalls.push({ limit, afterId });
          if (afterId === null) return [{ documentId: 'd1', status: 'ready' }];
          return [];
        }
      }),
      createRunner: () => ({
        planDocument: async (id) => ({ documentId: id, spaceId: TEST_SPACE, totalChunks: 1, embeddedChunks: 0, missingChunks: 1, complete: false })
      }),
      write: (t) => out.push(t),
      writeError: (t) => err.push(t),
      logger: { error() {} },
      now: () => new Date('2026-01-01T00:00:00Z')
    }
  });

  assert.equal(res.exitCode, 0);
  assert.equal(pool._endCalls, 1);
  const parsed = JSON.parse(out.join(''));
  assert.equal(parsed.eligibleDocuments, 1);
  assert.equal(err.length, 0);
});

test('main refuses unsafe target before scanning', async () => {
  const out = [];
  const err = [];
  let enumerated = false;

  const res = await main({
    argv: ['--dry-run', '--database-url', 'postgresql://localhost/atlas_staging'],
    env: {},
    deps: {
      createPool: () => { throw new Error('should not create pool'); },
      createEnumerator: () => ({ listReadyDocuments: async () => { enumerated = true; return []; } }),
      createRunner: () => ({ planDocument: async () => ({}) }),
      write: (t) => out.push(t),
      writeError: (t) => err.push(t)
    }
  });

  assert.equal(res.exitCode, 1);
  assert.equal(res.report, null);
  assert.ok(!enumerated);
  assert.match(err.join(''), /staging/i);
});

test('main exits 2 and closes pool on partial scan (truncated)', async () => {
  const out = [];
  const err = [];
  const pool = createMockPool({ database: 'atlas_test', serverAddr: null });

  const res = await main({
    argv: ['--dry-run', '--limit', '1', '--json', '--database-url', 'postgresql:///atlas_test?host=/tmp'],
    env: {},
    deps: {
      createPool: () => pool,
      createEnumerator: () => ({
        listReadyDocuments: async ({ limit, afterId }) => {
          if (afterId === null) return [{ documentId: 'd1', status: 'ready' }];
          return [{ documentId: 'd2', status: 'ready' }]; // has more after d1
        }
      }),
      createRunner: () => ({
        planDocument: async (id) => ({ documentId: id, spaceId: TEST_SPACE, totalChunks: 1, embeddedChunks: 0, missingChunks: 1, complete: false })
      }),
      write: (t) => out.push(t),
      writeError: (t) => err.push(t),
      now: () => new Date('2026-01-01T00:00:00Z')
    }
  });

  assert.equal(res.exitCode, 2);
  assert.equal(pool._endCalls, 1);
  const parsed = JSON.parse(out.join(''));
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.scanComplete, false);
});

test('main closes pool and exits 1 on verifyTarget failure', async () => {
  const out = [];
  const err = [];
  const pool = {
    queries: [],
    async query(sql) {
      this.queries.push(sql);
      return { rows: [{ database: 'wrong', server_addr: null }] };
    },
    _endCalls: 0,
    async end() {
      this._endCalls += 1;
    }
  };

  const res = await main({
    argv: ['--dry-run', '--database-url', 'postgresql:///atlas_disposable?host=/tmp'],
    env: {},
    deps: {
      createPool: () => pool,
      createEnumerator: () => ({ listReadyDocuments: async () => [] }),
      createRunner: () => ({ planDocument: async () => ({}) }),
      write: (t) => out.push(t),
      writeError: (t) => err.push(t)
    }
  });

  assert.equal(res.exitCode, 1);
  assert.equal(pool._endCalls, 1);
  assert.match(err.join(''), /connected to database/i);
});

test('main closes pool and exits 2 on inspection errors', async () => {
  const out = [];
  const err = [];
  const pool = createMockPool({ database: 'atlas_disposable', serverAddr: null });

  const res = await main({
    argv: ['--dry-run', '--json', '--database-url', 'postgresql:///atlas_disposable?host=/tmp'],
    env: {},
    deps: {
      createPool: () => pool,
      createEnumerator: () => ({
        listReadyDocuments: async () => [{ documentId: 'd1', status: 'ready' }]
      }),
      createRunner: () => ({
        planDocument: async () => { throw new Error('inspect failed'); }
      }),
      write: (t) => out.push(t),
      writeError: (t) => err.push(t),
      now: () => new Date('2026-01-01T00:00:00Z')
    }
  });

  assert.equal(res.exitCode, 2);
  assert.equal(pool._endCalls, 1);
  const parsed = JSON.parse(out.join(''));
  assert.equal(parsed.scanComplete, false);
  assert.equal(parsed.uninspectableDocuments, 1);
});

test('parseArgs collects repeatable --allow-database flags', () => {
  const args = parseArgs([
    '--dry-run',
    '--allow-database', 'atlas_rag_staging',
    '--allow-database', 'atlas_other'
  ]);

  assert.deepEqual(args.allowDatabases, ['atlas_rag_staging', 'atlas_other']);
});

test('parseArgs rejects --allow-database without a value', () => {
  assert.throws(() => parseArgs(['--dry-run', '--allow-database']), /Missing value/i);
});

test('resolveAllowlist merges flags and comma-separated env, exactly', () => {
  const allowlist = resolveAllowlist({
    args: { allowDatabases: ['atlas_rag_staging'] },
    env: { [ALLOW_DATABASE_ENV]: ' atlas_a , atlas_b ,, ' }
  });

  assert.deepEqual([...allowlist].sort(), ['atlas_a', 'atlas_b', 'atlas_rag_staging']);
});

test('resolveTarget accepts an exact allowlisted staging name', () => {
  const target = resolveTarget({
    args: {
      databaseUrl: 'postgresql:///atlas_rag_staging?host=/tmp',
      allowDatabases: ['atlas_rag_staging']
    },
    env: {}
  });

  assert.equal(target.database, 'atlas_rag_staging');
  assert.equal(target.allowlisted, true);
  assert.ok(target.allowlist.has('atlas_rag_staging'));
});

test('resolveTarget honors the environment allowlist', () => {
  const target = resolveTarget({
    args: { databaseUrl: 'postgresql:///atlas_rag_staging?host=/tmp' },
    env: { [ALLOW_DATABASE_ENV]: 'other_db, atlas_rag_staging' }
  });

  assert.equal(target.allowlisted, true);
  assert.equal(target.database, 'atlas_rag_staging');
});

test('allowlisting another name does not allow atlas_rag_staging', () => {
  assert.throws(
    () => resolveTarget({
      args: {
        databaseUrl: 'postgresql:///atlas_rag_staging?host=/tmp',
        allowDatabases: ['atlas_disposable']
      },
      env: {}
    }),
    /staging or production/i
  );
});

test('production-patterned names are refused even when allowlisted', () => {
  for (const name of ['atlas_prod', 'atlas_production', 'atlas_live']) {
    assert.throws(
      () => resolveTarget({
        args: { databaseUrl: `postgresql:///${name}?host=/tmp`, allowDatabases: [name] },
        env: {}
      }),
      /staging or production/i,
      `expected ${name} to be refused`
    );
  }
});

test('allowlisting does not bypass the remote-host refusal', () => {
  assert.throws(
    () => resolveTarget({
      args: {
        databaseUrl: 'postgresql://db.example.com/atlas_rag_staging',
        allowDatabases: ['atlas_rag_staging']
      },
      env: {}
    }),
    /not local/i
  );
});

test('allowlisting does not bypass the DATABASE_URL equality refusal', () => {
  const raw = 'postgresql:///atlas_rag_staging?host=/tmp';

  assert.throws(
    () => resolveTarget({
      args: { databaseUrl: raw, allowDatabases: ['atlas_rag_staging'] },
      env: { DATABASE_URL: raw }
    }),
    /identical to DATABASE_URL/i
  );
});

test('verifyTarget accepts an allowlisted target on socket and loopback', async () => {
  const allowlist = new Set(['atlas_rag_staging']);
  const target = { database: 'atlas_rag_staging', host: '', allowlist };

  const socketPool = createMockPool({ database: 'atlas_rag_staging', serverAddr: null });
  await verifyTarget(socketPool, target);

  const loopbackPool = createMockPool({ database: 'atlas_rag_staging', serverAddr: '127.0.0.1' });
  const row = await verifyTarget(loopbackPool, target);
  assert.equal(row.database, 'atlas_rag_staging');
  assert.equal(row.server_addr, '127.0.0.1');
});

test('verifyTarget rejects an allowlisted target on a remote server address', async () => {
  const pool = createMockPool({ database: 'atlas_rag_staging', serverAddr: '10.0.0.1' });
  const target = { database: 'atlas_rag_staging', host: '', allowlist: new Set(['atlas_rag_staging']) };

  await assert.rejects(() => verifyTarget(pool, target), /non-local server address/i);
});

test('verifyTarget refuses a production name even when allowlisted', async () => {
  const pool = createMockPool({ database: 'atlas_prod', serverAddr: null });
  const target = { database: 'atlas_prod', host: '', allowlist: new Set(['atlas_prod']) };

  await assert.rejects(() => verifyTarget(pool, target), /staging or production/i);
});

test('verifyTarget allowlist cannot authorize a different connected database', async () => {
  const pool = createMockPool({ database: 'atlas_rag_staging', serverAddr: null });
  const target = { database: 'atlas_other', host: '', allowlist: new Set(['atlas_other']) };

  await assert.rejects(() => verifyTarget(pool, target), /connected to database/i);
});

test('main reports an allowlisted target in JSON output', async () => {
  const out = [];
  const err = [];
  const pool = createMockPool({ database: 'atlas_rag_staging', serverAddr: null });

  const res = await main({
    argv: [
      '--dry-run',
      '--json',
      '--database-url', 'postgresql:///atlas_rag_staging?host=/tmp',
      '--allow-database', 'atlas_rag_staging'
    ],
    env: {},
    deps: {
      createPool: () => pool,
      createEnumerator: () => ({ listReadyDocuments: async () => [] }),
      createRunner: () => ({ planDocument: async () => ({}) }),
      write: (t) => out.push(t),
      writeError: (t) => err.push(t),
      now: () => new Date('2026-01-01T00:00:00Z')
    }
  });

  assert.equal(res.exitCode, 0);
  assert.equal(res.report.allowlistedTarget, true);
  assert.equal(JSON.parse(out.join('')).allowlistedTarget, true);
  assert.equal(err.length, 0);
});

test('text output warns clearly when the target is allowlisted', () => {
  const report = {
    target: 'socket:5432/atlas_rag_staging',
    allowlistedTarget: true,
    spaceId: TEST_SPACE,
    generatedAt: '2026-01-01T00:00:00Z',
    documents: [],
    eligibleDocuments: 0,
    inspectedDocuments: 0,
    completeDocuments: 0,
    incompleteDocuments: 0,
    uninspectableDocuments: 0,
    totalChunks: 0,
    embeddedChunks: 0,
    missingChunks: 0,
    truncated: false,
    scanComplete: true,
    errors: []
  };

  const text = formatTextReport(report);
  assert.match(text, /allowlisted/i);
  assert.match(text, /NOT a\s+disposable-named database/i);
});

test('preflightSchema passes when every required table exists', async () => {
  const pool = createMockPool();
  const result = await preflightSchema(pool);
  assert.deepEqual(result.missing, []);
});

test('preflightSchema reports a missing chunk_embeddings with its migration', async () => {
  const pool = createMockPool({ missing: ['chunk_embeddings'] });

  await assert.rejects(() => preflightSchema(pool), (error) => {
    assert.match(error.message, /chunk_embeddings/);
    assert.match(error.message, /20261017_create_chunk_embeddings\.sql/);
    assert.doesNotMatch(error.message, /embedding_backfill_progress/);
    return true;
  });
});

test('preflightSchema reports a missing embedding_backfill_progress with its migration', async () => {
  const pool = createMockPool({ missing: ['embedding_backfill_progress'] });

  await assert.rejects(() => preflightSchema(pool), (error) => {
    assert.match(error.message, /embedding_backfill_progress/);
    assert.match(error.message, /20261017_create_embedding_backfill_progress\.sql/);
    assert.doesNotMatch(error.message, /chunk_embeddings/);
    return true;
  });
});

test('preflightSchema reports every missing table', async () => {
  const pool = createMockPool({ missing: ['chunk_embeddings', 'embedding_backfill_progress'] });

  await assert.rejects(() => preflightSchema(pool), (error) => {
    assert.match(error.message, /chunk_embeddings/);
    assert.match(error.message, /embedding_backfill_progress/);
    return true;
  });
});

test('main fails before enumerating or planning when the schema is incomplete', async () => {
  const out = [];
  const err = [];
  const pool = createMockPool({ database: 'atlas_disposable', serverAddr: null, missing: ['chunk_embeddings'] });
  let enumerated = false;
  let runnerCreated = false;

  const res = await main({
    argv: ['--dry-run', '--database-url', 'postgresql:///atlas_disposable?host=/tmp'],
    env: {},
    deps: {
      createPool: () => pool,
      createEnumerator: () => ({ listReadyDocuments: async () => { enumerated = true; return []; } }),
      createRunner: () => { runnerCreated = true; return { planDocument: async () => ({}) }; },
      write: (t) => out.push(t),
      writeError: (t) => err.push(t)
    }
  });

  assert.equal(res.exitCode, 1);
  assert.equal(res.report, null);
  assert.equal(enumerated, false);
  assert.equal(runnerCreated, false);
  assert.equal(pool._endCalls, 1);
  assert.match(err.join(''), /chunk_embeddings/);
  assert.match(err.join(''), /20261017_create_chunk_embeddings\.sql/);
});

test('main proceeds to enumeration when the schema is complete', async () => {
  const out = [];
  const err = [];
  const pool = createMockPool({ database: 'atlas_disposable', serverAddr: null });
  let enumerated = false;

  const res = await main({
    argv: ['--dry-run', '--json', '--database-url', 'postgresql:///atlas_disposable?host=/tmp'],
    env: {},
    deps: {
      createPool: () => pool,
      createEnumerator: () => ({
        listReadyDocuments: async () => {
          enumerated = true;
          return [{ documentId: 'd1', status: 'ready' }];
        }
      }),
      createRunner: () => ({
        planDocument: async (id) => ({ documentId: id, spaceId: TEST_SPACE, totalChunks: 1, embeddedChunks: 1, missingChunks: 0, complete: true })
      }),
      write: (t) => out.push(t),
      writeError: (t) => err.push(t),
      now: () => new Date('2026-01-01T00:00:00Z')
    }
  });

  assert.equal(res.exitCode, 0);
  assert.equal(enumerated, true);
  assert.equal(pool._endCalls, 1);
  assert.equal(JSON.parse(out.join('')).scanComplete, true);
  assert.equal(err.length, 0);
});

test('isLoopbackAddress accepts IPv4 loopback forms', () => {
  for (const address of ['127.0.0.1', '127.0.0.5', '127.1.2.3', '127.0.0.1/32', '127.255.255.255']) {
    assert.equal(isLoopbackAddress(address), true, `expected ${address} to be loopback`);
  }
});

test('isLoopbackAddress accepts IPv6 loopback forms including ::1/128', () => {
  for (const address of ['::1', '::1/128', '0:0:0:0:0:0:0:1', '0000:0000:0000:0000:0000:0000:0000:0001']) {
    assert.equal(isLoopbackAddress(address), true, `expected ${address} to be loopback`);
  }
});

test('isLoopbackAddress accepts IPv4-mapped IPv6 loopback forms', () => {
  for (const address of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:127.0.0.1', '0:0:0:0:0:ffff:127.0.0.1']) {
    assert.equal(isLoopbackAddress(address), true, `expected ${address} to be loopback`);
  }
});

test('isLoopbackAddress rejects non-loopback and unparseable addresses', () => {
  const rejected = [
    '10.0.0.1',
    '8.8.8.8',
    '192.168.1.1',
    '126.0.0.1',
    '::2',
    '2001:db8::1',
    '2001:db8::1/128',
    '::ffff:10.0.0.1',
    '::ffff:8.8.8.8',
    '::',
    'localhost',
    'not-an-ip',
    '',
    '::1/129',
    '127.0.0.1/128',
    '2001:db8::1/129'
  ];

  for (const address of rejected) {
    assert.equal(isLoopbackAddress(address), false, `expected ${address} to be rejected`);
  }

  assert.equal(isLoopbackAddress(null), false);
  assert.equal(isLoopbackAddress(undefined), false);
  assert.equal(isLoopbackAddress(127), false);
});

test('verifyTarget accepts ::1/128 (PostgreSQL IPv6 TCP loopback form)', async () => {
  const pool = createMockPool({ database: 'atlas_rag_staging', serverAddr: '::1/128' });
  const target = { database: 'atlas_rag_staging', host: '', allowlist: new Set(['atlas_rag_staging']) };

  const row = await verifyTarget(pool, target);
  assert.equal(row.server_addr, '::1/128');
});

test('verifyTarget rejects a remote IPv6 server address', async () => {
  const pool = createMockPool({ database: 'atlas_rag_staging', serverAddr: '2001:db8::1' });
  const target = { database: 'atlas_rag_staging', host: '', allowlist: new Set(['atlas_rag_staging']) };

  await assert.rejects(() => verifyTarget(pool, target), /non-local server address/i);
});


