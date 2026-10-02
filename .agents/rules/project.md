---
trigger: always_on
---

---
trigger: always_on
description: Project-specific engineering conventions.
---

# Project Rules

Before changing code:
- Inspect package.json and project structure.
- Reuse existing utilities and components.
- Do not introduce a new dependency if existing code can solve the problem cleanly.
- Preserve existing functionality unless explicitly changing it.
- Follow the current naming and folder conventions.

After changes:
- Run the existing lint/typecheck/test/build commands applicable to the change.