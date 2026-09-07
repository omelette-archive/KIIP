"use strict";

const fs = require("fs");
const path = require("path");

// Windows에서는 백신 실시간 검사·검색 인덱서가 갓 쓴 .tmp 파일 핸들을 잠깐 잡고 있어
// rename이 EPERM/EBUSY/EACCES로 실패하는 일이 잦다(운영 파이프라인 재실행 중 03c_ip_registry가
// ip-registry-daily-budget.json rename에서 EPERM으로 죽은 사례 실측). 짧게 여러 번 재시도하면
// 대부분 통과한다. 동기 컨텍스트라 Atomics.wait로 진짜 sleep 한다.
const RETRYABLE_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ms));
}

function renameWithRetry(from, to, { attempts = 20, baseDelayMs = 50 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (!RETRYABLE_CODES.has(error?.code) || attempt >= attempts - 1) {
        try { fs.rmSync(from, { force: true }); } catch {}
        throw error;
      }
      sleepSync(baseDelayMs * (attempt + 1));
    }
  }
}

// filePath 옆에 프로세스별 .tmp를 쓰고 원자적으로 교체한다. 같은 파일에 동시에 쓰는
// 프로세스가 있어도 .tmp 이름이 겹치지 않는다.
function writeFileAtomic(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, contents, "utf8");
  renameWithRetry(tempPath, filePath);
}

function writeJsonAtomic(filePath, value) {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

module.exports = { renameWithRetry, writeFileAtomic, writeJsonAtomic, sleepSync };
