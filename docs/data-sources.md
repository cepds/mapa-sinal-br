# Fontes de Dados

## Fontes principais

- **Anatel**: consulta regulatoria ao vivo para ERBs, coordenadas, status e validade
- **Vivo**: cobertura oficial por ponto e camada oficial de mapa
- **TIM**: camada oficial de cobertura e links de instabilidade

## Camada nacional auxiliar

- **TelecoCare**: base consolidada de ERBs para desenhar o panorama nacional no mapa
- Atualizacao automatica:
  - quando o cache local nao existe, o backend tenta baixar e extrair a planilha automaticamente
  - tambem e possivel atualizar manualmente com `npm run sync:telecocare`

## Fontes de apoio

- **ViaCEP + Nominatim**: resolucao de CEP, endereco e localidade para latitude/longitude
- **ABR Telecom**: consulta oficial de situacao atual do numero, observando que o acesso publico exige CAPTCHA
- **Repositorios GitHub catalogados**: usados apenas como referencia comunitaria no painel de fontes

## Observacoes importantes

- A camada nacional do TelecoCare e auxiliar e nao substitui a consulta regulatoria ao vivo.
- A cobertura mostrada no app e estimada pela operadora e nao substitui medicao de campo.
- Os nomes e formatos das fontes externas podem mudar com o tempo, por isso o app trata essas consultas como integracoes resilientes e cacheadas.
