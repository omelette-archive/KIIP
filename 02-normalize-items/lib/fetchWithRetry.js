"use strict";
/** 03-match-trademarks/lib/fetchWithRetry.js에서 포팅 (동일 재시도/타임아웃/키마스킹 정책). */

function maskSensitiveUrl(url) {
  if (!url) return url;
  return url.replace(
    /([?&](?:accessKey|ServiceKey|serviceKey|apikey|apiKey|api_key|key)=)[^&]+/g,
    "$1***"
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelay(response, retryDelay, attempt) {
  if (response) {
    const retryAfter = response.headers && response.headers.get && response.headers.get("Retry-After");
    if (retryAfter && !isNaN(Number(retryAfter))) return Number(retryAfter) * 1000;
  }
  const base = retryDelay * Math.pow(2, attempt);
  return base + Math.random() * base * 0.5;
}

/**
 * fetch + 타임아웃 + 재시도 + 키 마스킹.
 * @param {string} url
 * @param {object} options
 * @param {typeof fetch} [fetchImpl] 테스트용 fetch 대체 구현 (기본: 전역 fetch)
 */
async function fetchWithRetry(url, options = {}, fetchImpl = fetch) {
  const {
    timeout = 30000,
    retries = 3,
    retryDelay = 1000,
    retryOn = [429, 500, 502, 503, 504],
    ...fetchOptions
  } = options;

  let lastError = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetchImpl(url, { ...fetchOptions, signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.ok || !retryOn.includes(response.status)) return response;
      if (attempt < retries) {
        await sleep(getRetryDelay(response, retryDelay, attempt));
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error) {
        lastError =
          error.name === "AbortError"
            ? new Error(`요청 타임아웃(${timeout}ms) - ${maskSensitiveUrl(url)}`)
            : new Error(maskSensitiveUrl(error.message));
      }
      if (attempt < retries) {
        await sleep(getRetryDelay(null, retryDelay, attempt));
        continue;
      }
    }
  }

  throw lastError || new Error("재시도 소진");
}

module.exports = { fetchWithRetry, maskSensitiveUrl };
