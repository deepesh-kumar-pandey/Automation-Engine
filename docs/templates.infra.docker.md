---
id: templates.infra.docker
title: Docker – {{TITLE}}
desc: Docker / container configuration note.
updated: 1713634574000
created: 1713634574000
---

# {{TITLE}} – Docker Configuration

## Image
```
image: {{TITLE | lowercase}}
```

## Dockerfile Location
`{{TITLE}}/Dockerfile`

## Build Stages
1. **builder** – Alpine + build deps
2. **runtime** – minimal Alpine runtime

## Exposed Ports
| Port | Protocol | Purpose |
|---|---|---|
| | | |

## Environment Variables
| Var | Default | Description |
|---|---|---|
| | | |

## Compose Snippet
```yaml
services:
  {{TITLE}}:
    build: .
    ports:
      - "":""
```

## Related Notes
- [[automation.infrastructure.docker]]
- [[automation.infrastructure.deployment]]
