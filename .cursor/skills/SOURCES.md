# Skills do projeto (auditadas antes de instalar)

Todas foram baixadas numa pasta isolada, lidas por completo e verificadas contra:
injeção de prompt, hooks, `allowed-tools`, scripts, chamadas de rede e leitura de segredos.
Nenhuma contém scripts executáveis — são só Markdown.

| Skill | Origem | Commit auditado | Licença | No Git? |
|---|---|---|---|---|
| `llm-security` | github.com/semgrep/skills | `68177b8830f96cd9d10dacbb14dde2566360503d` | Semgrep Rules License v1.0 | Não (uso local; licença restringe redistribuição) |
| `evaluate-rag` | github.com/hamelsmu/evals-skills | `22418da2bfb159f28a1b0dcf64e969e14ae56c99` | MIT | Sim |
| `hybrid-search-implementation` | github.com/wshobson/agents | `9c61ab243def98f72da12abd41cfcf5bcd91af9d` | MIT | Sim |

Para reinstalar `llm-security` em outra máquina:

```powershell
git clone https://github.com/semgrep/skills.git $env:TEMP\semgrep-skills
git -C $env:TEMP\semgrep-skills checkout 68177b8830f96cd9d10dacbb14dde2566360503d
Copy-Item -Recurse $env:TEMP\semgrep-skills\skills\llm-security .cursor\skills\llm-security
```

Ao atualizar qualquer skill: re-auditar o diff antes de copiar.
