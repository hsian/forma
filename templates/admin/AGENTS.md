# Business application development

Read capabilities.json and docs/architecture.md before changing code. Search existing capabilities and their callers before adding another implementation.

- Keep layout in pages, business orchestration in modules, endpoint-specific adaptation in services, and shared presentation in components.
- Reuse services/request. Every endpoint owns its request mapping, response validation and business-success rules. Do not assume a global backend response envelope.
- Use query and mutation helpers appropriately. Never submit writes from mount effects or automatically retry them. Do not silently replace a failed real request with mock success.
- Do not edit src/pages/generated or .forma/runtime. Use modules and extensions. Respect existing hand-written edits and inspect diffs before changing shared capabilities.
- Record endpoint sources, mapping rules, tests and unresolved questions in docs/api-integrations.md. Do not invent unspecified fields, permissions or success rules.
- Run npm run check and npm run build. Verify the relevant cases in docs/scenarios.md; destructive business operations are verified in a test environment.
- Update capabilities.json when a stable reusable capability changes. This project does not require the product owner to configure technical request fields.
