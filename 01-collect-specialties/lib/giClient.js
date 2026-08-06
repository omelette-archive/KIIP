"use strict";
/**
 * 국립농산물품질관리원 지리적표시 등록정보 OpenAPI(data.go.kr) 클라이언트.
 * 참고: https://www.data.go.kr/data/15080629/openapi.do ("등록번호, 등록명칭, 등록일자,
 * 대상지역" 등 관리 — 지역+특산품이 이미 1:1로 짝지어진 공식 데이터, 현재 193건 등록).
 *
 * ⚠️ 같은 데이터의 CSV 직접 다운로드(data.mafra.go.kr)는 실제로 시도해봤으나 다운로드
 * 엔드포인트가 "서비스 장애"를 반환해 막혀있었다 — 그래서 OpenAPI 경로로 전환.
 *
 * ⚠️ 활용신청 승인 전까지는 정확한 baseUrl/오퍼레이션명/응답 필드명을 확인할 방법이 없다.
 * 아래 값은 확정된 게 아니라 승인 후 마이페이지에서 반드시 재확인해야 한다 — 임의로
 * 지어낸 기관코드를 넣지 않고, 호출 시점에 baseUrl을 넘기지 않으면 바로 에러가 나도록
 * 만들어뒀다.
 */

const { createClient: createDataGoKrClient } = require("./dataGoKrClient");

function createClient({ apiKey, baseUrl, operation = "getGeoIndiCertInfoList", fetchImpl } = {}) {
  const client = createDataGoKrClient({ apiKey, fetchImpl });

  /**
   * @param {{pageNo?:number, numOfRows?:number, baseUrl?:string}} [p]
   * @returns {Promise<{registrationNumber:string, registeredName:string, region:string, registrationDate:string, raw:object}[]>}
   */
  async function listRegistrations(p = {}) {
    const effectiveBaseUrl = p.baseUrl || baseUrl;
    const result = await client.callAllPages({
      baseUrl: effectiveBaseUrl,
      operation,
      pageNo: p.pageNo || 1,
      numOfRows: p.numOfRows || 100,
    });
    // 필드명은 활용가이드 확인 전까지 추정치라 여러 후보를 시도하고, raw로 원본도 함께 남긴다.
    return result.items.map((item) => ({
      registrationNumber: item.registNo || item.regNo || item.registrationNumber || "",
      registeredName: item.registName || item.prdlstNm || item.registeredName || "",
      region: item.registArea || item.area || item.region || "",
      registrationDate: item.registDate || item.regDate || item.registrationDate || "",
      raw: item,
    }));
  }

  return { listRegistrations };
}

module.exports = { createClient };
