const Ajv = require("ajv/dist/2020");
const formats = require("ajv-formats");
const contract = require("../../contracts/api");
const ajv = new Ajv({ strict: false, allErrors: true });
formats(ajv); ajv.addSchema(contract, "launchqueue");
const cache = new Map();
function assertResponse(method, path, response) {
  const operation = contract.paths[path]?.[method];
  if (!operation) throw new Error(`Undocumented operation: ${method} ${path}`);
  const spec = operation.responses[response.status] || operation.responses.default;
  const content = spec.content;
  if (!content) { if (response.text) throw new Error("Unexpected response body"); return; }
  const type = Object.keys(content).find((type) => response.headers["content-type"]?.startsWith(type));
  if (!type) throw new Error(`Undocumented response content type: ${method} ${path}`);
  const key = `${method} ${path} ${response.status} ${type}`;
  if (!cache.has(key)) cache.set(key, ajv.compile({ ...content[type].schema, components: contract.components }));
  const validate = cache.get(key);
  if (!validate(type === "application/json" ? response.body : response.text)) {
    throw new Error(`Response contract failed: ${method} ${path} ${response.status}: ${JSON.stringify(validate.errors.map(({ instancePath, keyword }) => ({ instancePath, keyword })))}`);
  }
}
module.exports = { assertResponse };
