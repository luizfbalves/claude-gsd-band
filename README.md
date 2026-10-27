# gsd-band

Um painel fixo acima do prompt do Claude Code que mostra em que ponto está o milestone GSD do projeto. São as mesmas informações do `/gsd-manager`, sem precisar rodar o comando.

![Painel gsd-band no terminal](docs/painel.png)

Em projetos sem milestone em andamento o painel não aparece e não ocupa espaço.

## Instalação

No prompt do Claude Code:

```
/plugin install gsd-band --marketplace luizfbalves/claude-gsd-band
```

Pelo shell:

```
claude plugin install gsd-band --marketplace luizfbalves/claude-gsd-band
```

No app desktop, onde `/plugin` não funciona: clique em **+** ao lado do prompt, depois **Plugins** › **Add marketplace** com `luizfbalves/claude-gsd-band`, e então **Add plugin**.

## Como ler o painel

| Coluna | Quer dizer |
|--------|------------|
| **D** | Discussão: a fase tem `*-CONTEXT.md` |
| **P** | Planejamento: a fase tem `*-PLAN.md` |
| **E** | Execução: os `*-SUMMARY.md` acompanham os planos |

| Marca | Estado |
|-------|--------|
| `✓` | feito |
| `◆` | em andamento |
| `○` | pronto para começar |
| `·` | depende de uma fase anterior |

No terminal o painel é desenhado célula a célula (`Raster`):

- a barra tem um segmento por fase, com largura proporcional ao número de planos (fase ainda sem plano pesa a média das outras) e preenchimento com precisão de ⅛ de célula;
- a porcentagem conta cada fase como 1 e a fase em execução pela fração de planos com SUMMARY;
- D / P / E viram blocos coloridos: verde feito, amarelo em andamento, ciano pronto, cinza bloqueado;
- na fase ativa, cada plano é um quadrado, `■` com SUMMARY e `□` sem; nas concluídas aparece só `n/n`;
- `▶` marca a primeira fase não concluída;
- a coluna de nome cresce com a largura do terminal;
- o indicador antes de `GSD` gira rápido durante o turno e devagar parado.

No app desktop, no VS Code e no celular continua a tabela em texto com as marcas acima.

Só a primeira fase ainda não discutida aparece como **Pronta para discussão**. As seguintes aparecem como **Aguarda fase N**.

## Quando aparece

O painel só aparece quando todas estas condições valem:

- `.planning/STATE.md` existe e tem `milestone:` no frontmatter;
- o `status:` não indica milestone encerrado (`complete`, `archived`, `shipped`, `closed`);
- ainda existe pelo menos uma fase não concluída no `.planning/ROADMAP.md`.

## Workstreams

Com workstreams do GSD o projeto pode ter mais de um milestone em andamento, um em `.planning/` e um em cada `.planning/workstreams/<nome>/`. O painel monitora um por vez:

- por padrão, a workstream ativa do GSD (`.planning/active-workstream`), senão a primeira com milestone em progresso;
- o nome da workstream aparece no cabeçalho, antes da versão;
- com mais de uma opção aparece o botão **`⇄ <próxima>`**, que alterna entre elas;
- `/gsd-band <nome>` escolhe uma direto (`/gsd-band raiz` para o `.planning/` raiz);
- o botão da próxima ação leva `--ws <nome>`.

Workstreams com milestone encerrado ou sem fase pendente ficam fora da lista.

Se o terminal tiver pouca altura, ele encolhe para o cabeçalho, a barra e a fase em andamento.

## De onde vêm os dados

| Dado | Fonte |
|------|-------|
| Milestone | frontmatter de `.planning/STATE.md` ou `.planning/workstreams/<nome>/STATE.md` (`milestone`, `milestone_name`, `status`) |
| Fases | lista `- [ ] **Phase N: Nome**` na seção `## Phases` do `ROADMAP.md`, ignorando o que está dentro de `<details>` |
| D / P / E | arquivos em `.planning/phases/NN-nome/` |

Nada é gravado no projeto, o mod só lê esses arquivos. Ele relê tudo ao abrir a sessão, ao fim de cada turno, logo depois de uma ferramenta mexer em `.planning/` e a cada 15 segundos.

## Comando

`/gsd-band` esconde ou mostra o painel na sessão atual. `/gsd-band <nome>` escolhe a workstream monitorada.

## Botões

- **`/clear`** limpa a conversa.
- **`▶ /gsd-…`** roda o próximo comando GSD da primeira fase não concluída: `gsd-discuss-phase`, `gsd-plan-phase` ou `gsd-execute-phase`, com o número da fase.

## Desenvolvimento

```
hooks/board.ts       leitura do STATE.md e do ROADMAP.md, montagem das linhas
hooks/register.tsx   eventos, atualização e desenho do painel
hooks/raster.ts      células do painel no terminal
types/index.d.ts     contrato do estado do mod
tests/               testes com dados de exemplo
```

```
claude plugin validate .
claude plugin test .
```

Para usar uma cópia local que recarrega a cada edição: `claude --plugin-dir <pasta>`.

## Licença

[MIT](LICENSE)
