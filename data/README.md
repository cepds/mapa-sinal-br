# Dados Locais

Esta pasta existe para cache e apoio ao app, mas os arquivos brutos nao entram no Git.

## O que pode aparecer aqui

- `telecocare-cache/ERBs.xlsx`: planilha mais recente baixada automaticamente do TelecoCare
- `telecocare-cache/metadata.json`: metadados do ultimo download

## Como atualizar manualmente

```powershell
npm run sync:telecocare
```

## Observacao

Os dados do TelecoCare sao usados como camada nacional auxiliar. A fonte regulatoria ao vivo do app continua sendo a Anatel para a busca detalhada.
