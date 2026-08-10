"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value ?? null));
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function fallbackKey(sourceId, rawPayload) {
  return `${sourceId}:hash:${sha256(canonicalJson(rawPayload))}`;
}

function sourceRecordKey(sourceId, entry) {
  if (sourceId === "gi") {
    const registrationNumber = String(entry.registrationNumber || "").trim();
    const registrationDate = String(entry.registrationDate || "").trim();
    if (registrationNumber) return `gi:${registrationNumber}|${registrationDate}`;
  }
  if (sourceId === "nongsaro") {
    const raw = entry.raw || {};
    const areaCode = String(raw.areaCode || "").trim();
    const linkUrl = String(raw.linkUrl || "").trim();
    const title = String(entry.title || raw.title || "").trim();
    if (areaCode && (linkUrl || title)) return `nongsaro:${areaCode}|${linkUrl || title}`;
  }
  return fallbackKey(sourceId, entry.raw || entry);
}

function makeStoredRecords(sourceId, entries, normalizedRows) {
  if (entries.length !== normalizedRows.length) {
    throw new Error(
      `${sourceId} 원문 ${entries.length}건과 정규화 결과 ${normalizedRows.length}건의 수가 다릅니다.`
    );
  }
  return entries.map((entry, index) => ({
    sourceId,
    sourceRecordKey: sourceRecordKey(sourceId, entry),
    rawPayload: entry.raw || entry,
    normalizedPayload: normalizedRows[index],
    collectedAt: normalizedRows[index].collectedAt,
  }));
}

function createCollectionStore(dbPath) {
  const resolvedPath = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const db = new DatabaseSync(resolvedPath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS collection_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      status TEXT NOT NULL,
      requested_sources_json TEXT NOT NULL,
      query_scope_json TEXT NOT NULL,
      source_results_json TEXT NOT NULL DEFAULT '{}',
      request_count INTEGER NOT NULL DEFAULT 0,
      succeeded_source_count INTEGER NOT NULL DEFAULT 0,
      failed_source_count INTEGER NOT NULL DEFAULT 0,
      row_count INTEGER NOT NULL DEFAULT 0,
      inserted_record_count INTEGER NOT NULL DEFAULT 0,
      updated_record_count INTEGER NOT NULL DEFAULT 0,
      unchanged_record_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      warnings_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT
    );

    CREATE TABLE IF NOT EXISTS specialty_raw_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      source_record_key TEXT NOT NULL,
      current_payload_hash TEXT NOT NULL,
      current_version INTEGER NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      first_run_id INTEGER NOT NULL REFERENCES collection_runs(id),
      last_run_id INTEGER NOT NULL REFERENCES collection_runs(id),
      UNIQUE(source_id, source_record_key)
    );

    CREATE TABLE IF NOT EXISTS specialty_raw_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_record_id INTEGER NOT NULL REFERENCES specialty_raw_records(id),
      version INTEGER NOT NULL,
      payload_hash TEXT NOT NULL,
      raw_payload_json TEXT NOT NULL,
      normalized_payload_json TEXT NOT NULL,
      collected_at TEXT NOT NULL,
      collection_run_id INTEGER NOT NULL REFERENCES collection_runs(id),
      UNIQUE(raw_record_id, version),
      UNIQUE(raw_record_id, payload_hash)
    );

    CREATE INDEX IF NOT EXISTS idx_raw_records_source
      ON specialty_raw_records(source_id);
    CREATE INDEX IF NOT EXISTS idx_raw_versions_run
      ON specialty_raw_versions(collection_run_id);
  `);

  const insertRun = db.prepare(`
    INSERT INTO collection_runs (
      started_at, status, requested_sources_json, query_scope_json
    ) VALUES (?, 'running', ?, ?)
  `);
  const finishRunStatement = db.prepare(`
    UPDATE collection_runs SET
      completed_at = ?, status = ?, source_results_json = ?, request_count = ?,
      succeeded_source_count = ?, failed_source_count = ?, row_count = ?,
      inserted_record_count = ?, updated_record_count = ?, unchanged_record_count = ?,
      warning_count = ?, warnings_json = ?, error_message = ?
    WHERE id = ?
  `);
  const findRecord = db.prepare(`
    SELECT id, current_payload_hash, current_version
    FROM specialty_raw_records WHERE source_id = ? AND source_record_key = ?
  `);
  const findVersionByHash = db.prepare(`
    SELECT version FROM specialty_raw_versions WHERE raw_record_id = ? AND payload_hash = ?
  `);
  const insertRecord = db.prepare(`
    INSERT INTO specialty_raw_records (
      source_id, source_record_key, current_payload_hash, current_version,
      first_seen_at, last_seen_at, first_run_id, last_run_id
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
  `);
  const insertVersion = db.prepare(`
    INSERT INTO specialty_raw_versions (
      raw_record_id, version, payload_hash, raw_payload_json,
      normalized_payload_json, collected_at, collection_run_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const touchRecord = db.prepare(`
    UPDATE specialty_raw_records SET last_seen_at = ?, last_run_id = ? WHERE id = ?
  `);
  const updateRecord = db.prepare(`
    UPDATE specialty_raw_records SET
      current_payload_hash = ?, current_version = ?, last_seen_at = ?, last_run_id = ?
    WHERE id = ?
  `);

  function startRun({ sources, queryScope, startedAt = new Date().toISOString() }) {
    return Number(insertRun.run(startedAt, canonicalJson(sources), canonicalJson(queryScope)).lastInsertRowid);
  }

  function persistRecords(runId, records) {
    const counts = { inserted: 0, updated: 0, unchanged: 0 };
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const record of records) {
        const rawJson = canonicalJson(record.rawPayload);
        const normalizedJson = canonicalJson(record.normalizedPayload);
        // collectedAt은 실행할 때마다 달라지는 관측 시각이므로 내용 변경 판정에서 제외한다.
        // 그렇지 않으면 동일 원본 재실행도 매번 새 버전으로 잘못 저장된다.
        const semanticNormalized = { ...(record.normalizedPayload || {}) };
        delete semanticNormalized.collectedAt;
        const payloadHash = sha256(`${rawJson}\n${canonicalJson(semanticNormalized)}`);
        const seenAt = record.collectedAt || new Date().toISOString();
        const existing = findRecord.get(record.sourceId, record.sourceRecordKey);
        if (!existing) {
          const inserted = insertRecord.run(
            record.sourceId,
            record.sourceRecordKey,
            payloadHash,
            seenAt,
            seenAt,
            runId,
            runId
          );
          insertVersion.run(
            Number(inserted.lastInsertRowid),
            1,
            payloadHash,
            rawJson,
            normalizedJson,
            seenAt,
            runId
          );
          counts.inserted++;
        } else if (existing.current_payload_hash === payloadHash) {
          touchRecord.run(seenAt, runId, existing.id);
          counts.unchanged++;
        } else {
          // 내용이 과거 어느 버전과 정확히 같은 값으로 되돌아간 경우, 그 버전 번호를 그대로
          // 재사용한다 — payload_hash는 raw_record_id 안에서 유일해야 하므로(중복 내용을 두 번
          // 남기지 않음) 새 버전을 또 만들면 UNIQUE(raw_record_id, payload_hash) 제약을 어겨
          // 전체 실행이 실패한다. current_version이 예전 번호로 "되돌아갈" 수 있다.
          const reused = findVersionByHash.get(existing.id, payloadHash);
          if (reused) {
            updateRecord.run(payloadHash, reused.version, seenAt, runId, existing.id);
          } else {
            const nextVersion = Number(existing.current_version) + 1;
            insertVersion.run(
              existing.id,
              nextVersion,
              payloadHash,
              rawJson,
              normalizedJson,
              seenAt,
              runId
            );
            updateRecord.run(payloadHash, nextVersion, seenAt, runId, existing.id);
          }
          counts.updated++;
        }
      }
      db.exec("COMMIT");
      return counts;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function finishRun(runId, result) {
    const warnings = result.warnings || [];
    const stored = result.stored || {};
    finishRunStatement.run(
      result.completedAt || new Date().toISOString(),
      result.status,
      canonicalJson(result.sourceResults || {}),
      Number(result.requestCount) || 0,
      Number(result.succeededSourceCount) || 0,
      Number(result.failedSourceCount) || 0,
      Number(result.rowCount) || 0,
      Number(stored.inserted) || 0,
      Number(stored.updated) || 0,
      Number(stored.unchanged) || 0,
      warnings.length,
      canonicalJson(warnings),
      result.errorMessage || null,
      runId
    );
  }

  function counts() {
    return {
      runs: Number(db.prepare("SELECT COUNT(*) AS count FROM collection_runs").get().count),
      records: Number(db.prepare("SELECT COUNT(*) AS count FROM specialty_raw_records").get().count),
      versions: Number(db.prepare("SELECT COUNT(*) AS count FROM specialty_raw_versions").get().count),
    };
  }

  function getRun(runId) {
    return db.prepare("SELECT * FROM collection_runs WHERE id = ?").get(runId);
  }

  function close() {
    db.close();
  }

  return { path: resolvedPath, startRun, persistRecords, finishRun, counts, getRun, close };
}

module.exports = {
  canonicalJson,
  createCollectionStore,
  makeStoredRecords,
  sourceRecordKey,
};
