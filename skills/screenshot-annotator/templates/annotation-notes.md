# Screenshot Annotation Notes

- **Screenshot reference:** `<path/to/screenshot.png>` (trace: `<path/to/trace.zip>` if any)
- **Test Case ID:** `<TC-ID>`
- **Test Step:** `<step number / description where the failure occurred>`
- **Route / Screen:** `<route or page name from knowledge.md>`

## Expected vs Actual

| | Description |
|-----------|-------------|
| **Expected** | `<the expected result for this step, from the Test Case>` |
| **Actual**   | `<what the screenshot actually shows>` |

## Callouts

| Region / Component | Observation | Severity |
|--------------------|-------------|----------|
| `<component name>` | `<what diverged from expected — observation only>` | Critical / High / Medium / Low |
|                    |             |          |

> Observations describe only what is visible. Interpretations (likely cause) are labeled
> explicitly and are not treated as fact.

## Suggested Caption

> `<one-line caption suitable to attach under the screenshot in a ticket, e.g.
> "TC-123 step 4: submit button remains disabled after all required fields are filled">`
