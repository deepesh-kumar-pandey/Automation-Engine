---
id: templates.infra.postgres
title: PostgreSQL – {{TITLE}}
desc: PostgreSQL schema / migration note.
updated: 1713634574000
created: 1713634574000
---

# {{TITLE}} – PostgreSQL Schema

## Table / Schema
```sql
-- migration: {{TITLE}}
CREATE TABLE IF NOT EXISTS {{TITLE}} (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_{{TITLE}}_created_at ON {{TITLE}}(created_at);
```

## Migration File
`services/db/migrations/{{TITLE}}.sql`

## Notes
- 

## Related Notes
- [[automation.infrastructure.postgres]]
- [[automation.infrastructure.deployment]]
