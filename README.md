# Apuração 2026

Painel em tempo real da apuração das **Eleições Gerais 2026**, com dados oficiais do TSE
(`resultados.tse.jus.br`) lidos direto pelo navegador. Não tem servidor nem build: são arquivos estáticos no GitHub Pages.

## Recursos
- Presidente, Governador e Senador
- Filtros por **estado**, **município**, **exterior por país/cidade** e **candidato** (busca + seleção múltipla)
- Mapa em mosaico com quem lidera em cada estado; com 1 candidato selecionado, vira mapa de intensidade
- Exterior agrupado por país (186 cidades → países)
- Atualização automática a cada 15 s: animações sem travar, reordenação suave, último dado bom mantido se o TSE falhar, pausa com a aba em segundo plano
- Filtros ficam no link (`#c=pres&uf=sp&cand=...`); é só compartilhar

## Parâmetros
- `?simular=1` → números fictícios para testar a interface antes da apuração
- `?turno=2` → 2º turno (códigos 6258/6260)

Site independente, sem vínculo com o TSE.
