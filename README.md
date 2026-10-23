# gsd-band

Um painel fixo acima do prompt do Claude Code que mostra em que ponto está o milestone GSD do projeto. São as mesmas informações do `/gsd-manager`, sem precisar rodar o comando.

```
GSD ► MANAGER · v1.4 Checkout novo
████████░░░░░░░░░░░░ 40% · 2 de 5 fases concluídas
Fase  Descrição                     D  P  E  Status
1     Carrinho persistente          ✓  ✓  ✓  Concluída
2     Cálculo de frete              ✓  ✓  ✓  Concluída
3     Pagamento com Pix             ✓  ✓  ◆  Execução parcial (4/9)
4     Cupons no checkout            ○  ·  ·  Pronta para discussão
5     Rollout gradual               ·  ·  ·  Aguarda fase 4
```

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

- a barra tem um segmento por fase, com largura proporcional ao número de planos e preenchimento com precisão de ⅛ de célula;
- D / P / E viram blocos coloridos: verde feito, amarelo em andamento, ciano pronto, cinza bloqueado;
- cada plano da fase é um quadrado, `■` com SUMMARY e `□` sem;
- `▶` marca a primeira fase não concluída.

No app desktop, no VS Code e no celular continua a tabela em texto com as marcas acima.

Só a primeira fase ainda não discutida aparece como **Pronta para discussão**. As seguintes aparecem como **Aguarda fase N**.

## Quando aparece

O painel só aparece quando todas estas condições valem:

- `.planning/STATE.md` existe e tem `milestone:` no frontmatter;
- o `status:` não indica milestone encerrado (`complete`, `archived`, `shipped`, `closed`);
- ainda existe pelo menos uma fase não concluída no `.planning/ROADMAP.md`.

Se o terminal tiver pouca altura, ele encolhe para o cabeçalho, a barra e a fase em andamento.

## De onde vêm os dados

| Dado | Fonte |
|------|-------|
| Milestone | frontmatter de `.planning/STATE.md` (`milestone`, `milestone_name`, `status`) |
| Fases | lista `- [ ] **Phase N: Nome**` na seção `## Phases` do `ROADMAP.md`, ignorando o que está dentro de `<details>` |
| D / P / E | arquivos em `.planning/phases/NN-nome/` |

Nada é gravado no projeto, o mod só lê esses arquivos. Ele relê tudo ao abrir a sessão, ao fim de cada turno e a cada 15 segundos.

## Comando

`/gsd-band` esconde ou mostra o painel na sessão atual.

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
