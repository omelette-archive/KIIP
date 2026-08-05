"use strict";

/** NICE 35류 이상(서비스업 계열)인지 판별한다. niceClass는 "01"~"45" 문자열. */
function isServiceClass(niceClass) {
  const n = parseInt(niceClass, 10);
  return !Number.isNaN(n) && n >= 35;
}

module.exports = { isServiceClass };
