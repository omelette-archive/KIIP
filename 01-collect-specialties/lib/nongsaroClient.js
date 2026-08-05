"use strict";
/**
 * 농촌진흥청 지역특산물 OpenAPI(data.go.kr) 클라이언트 — 기획서의 "농사로 특산물 정보"에
 * 해당. 참고: https://www.data.go.kr/data/15101361/openapi.do (제목/지역/이미지/등록일 등
 * 지역특산물 정보 제공, 개발단계는 자동승인).
 *
 * ⚠️ giClient.js와 동일한 이유로 baseUrl/오퍼레이션명/응답 필드명은 활용신청 승인 후
 * 마이페이지에서 확인해야 확정된다. 임의로 지어낸 값을 기본값으로 넣지 않고, 호출 시
 * baseUrl을 넘기지 않으면 에러가 나도록 만들어뒀다.
 */

const { createClient: createDataGoKrClient } = require("./dataGoKrClient");

function createClient({ apiKey, baseUrl, operation = "getSpcltyMaterialsList", fetchImpl } = {}) {
  const client = createDataGoKrClient({ apiKey, fetchImpl });

  /**
   * @param {{pageNo?:number, numOfRows?:number, baseUrl?:string}} [p]
   * @returns {Promise<{title:string, region:string, registrationDate:string, raw:object}[]>}
   */
  async function listSpecialties(p = {}) {
    const effectiveBaseUrl = p.baseUrl || baseUrl;
    const result = await client.callOperation({
      baseUrl: effectiveBaseUrl,
      operation,
      params: { pageNo: p.pageNo || 1, numOfRows: p.numOfRows || 100 },
    });
    return result.items.map((item) => ({
      title: item.title || item.prdlstNm || item.name || "",
      region: item.area || item.sigungu || item.region || "",
      registrationDate: item.regDate || item.registrationDate || "",
      raw: item,
    }));
  }

  return { listSpecialties };
}

module.exports = { createClient };
