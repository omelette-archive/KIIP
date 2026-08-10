"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_REGISTRY_PATH = path.join(__dirname, "..", "config", "sources.json");

function validateRegistry(registry) {
  if (!registry || registry.schemaVersion !== 1 || !Array.isArray(registry.sources)) {
    throw new Error("소스 레지스트리 형식이 올바르지 않습니다.");
  }

  const ids = new Set();
  for (const source of registry.sources) {
    for (const field of [
      "id", "name", "role", "dataVersion", "lastVerifiedAt", "catalogUrl", "formats",
      "authentication", "quota", "implementation",
    ]) {
      if (source[field] === undefined || source[field] === null || source[field] === "") {
        throw new Error(`소스 레지스트리 ${source.id || "(id 없음)"}: ${field} 필드가 필요합니다.`);
      }
    }
    if (ids.has(source.id)) throw new Error(`소스 레지스트리 id 중복: ${source.id}`);
    ids.add(source.id);
  }
  return registry;
}

function loadSourceRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  return validateRegistry(registry);
}

function getSourceDefinition(id, registry = loadSourceRegistry()) {
  return registry.sources.find((source) => source.id === id) || null;
}

module.exports = {
  DEFAULT_REGISTRY_PATH,
  getSourceDefinition,
  loadSourceRegistry,
  validateRegistry,
};
