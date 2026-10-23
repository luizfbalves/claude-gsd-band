# gsd-band

Mod do Claude Code que mostra, acima do campo de input, o painel do milestone GSD em andamento: versão e nome do milestone, barra de progresso das fases e uma tabela com Fase, Descrição, D (discussão), P (planejamento), E (execução) e Status.

O painel só aparece quando o projeto tem `.planning/STATE.md` com `milestone:` preenchido e um `status` que não seja de milestone encerrado. Some quando todas as fases estão concluídas.

## De onde vêm os dados

- Fases: seção `## Phases` do `.planning/ROADMAP.md` (ignora o que está dentro de `<details>`).
- D/P/E: arquivos `-CONTEXT.md`, `-PLAN.md` e `-SUMMARY.md` em `.planning/phases/<fase>/`.
- Atualiza ao abrir a sessão, ao fim de cada turno e a cada 15 s.

`/gsd-band` esconde ou mostra o painel.

## Instalação

No prompt de uma sessão do Claude Code:

```
/plugin install gsd-band --marketplace luizfbalves/claude-gsd-band
```

Pelo shell:

```
claude plugin install gsd-band --marketplace luizfbalves/claude-gsd-band
```

No app desktop, onde `/plugin` não roda: clique em + ao lado do campo de prompt, depois Plugins, Add marketplace com `luizfbalves/claude-gsd-band`, e então Add plugin.
