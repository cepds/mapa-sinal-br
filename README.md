<p align="center">
  <img src="public/assets/branding/mapa-sinal-br-profile.png" width="160" alt="Mapa Sinal BR">
</p>

<h1 align="center">Mapa Sinal BR</h1>

Radar visual para infraestrutura celular no Brasil, focado em TIM e Vivo, com mapa profissional, busca por CEP/localidade/coordenadas, camada nacional de torres e leitura de cobertura oficial.

## O que o projeto entrega

- Busca por **CEP, endereco, bairro, cidade, regiao ou coordenadas**
- Consulta **ao vivo da Anatel** para ERBs detalhadas na area pesquisada
- Camada nacional de torres com base auxiliar do **TelecoCare**
- Camadas oficiais de cobertura **TIM** e **Vivo**
- Popup rico com detalhes da torre:
  - operadora
  - numero da estacao
  - tecnologias
  - faixas
  - tipo de infraestrutura
  - endereco
  - bairro
  - cidade/UF
  - coordenadas
- Painel de cobertura com visual de monitor de rede
- App desktop com **Electron**

## Stack

- **JavaScript** no backend e frontend
- **CSS** customizado para o visual do mapa e do monitor
- **Electron** para empacotar o app desktop
- **Leaflet** para renderizacao do mapa
- **XLSX** e **AdmZip** para leitura e atualizacao da base nacional auxiliar

## Como rodar

### App desktop

```powershell
npm install
npm start
```

### Servidor web local

```powershell
npm install
npm run start:web
```

Abra em:

```text
http://localhost:4042
```

## Scripts

- `npm start`: abre a versao desktop
- `npm run start:web`: sobe o servidor web local
- `npm run check`: valida a sintaxe do backend e do frontend
- `npm run sync:telecocare`: baixa e extrai a base publica mais recente do TelecoCare
- `npm run dist`: gera instalador Windows
- `npm run dist:portable`: gera build portatil

## Estrutura

```text
mapa-sinal-br/
├─ .github/workflows/     # validacao automatica no GitHub
├─ data/                  # cache e orientacoes sobre dados locais
├─ docs/                  # documentacao do projeto e das fontes
├─ public/
│  ├─ assets/
│  │  ├─ branding/        # identidade visual do projeto
│  │  └─ map/             # icones e elementos do mapa
│  ├─ vendor/leaflet/     # Leaflet local
│  ├─ app.js              # logica do mapa e interacoes
│  ├─ index.html          # shell da interface
│  └─ styles.css          # visual do produto
├─ scripts/               # utilitarios de manutencao
├─ electron-main.mjs      # inicializacao do app desktop
├─ server.mjs             # backend HTTP e integracoes externas
└─ package.json
```

## Fontes de dados

Veja o detalhamento em [docs/data-sources.md](docs/data-sources.md).

Resumo:

- **Anatel**: fonte regulatoria principal para busca detalhada
- **Vivo**: cobertura oficial por ponto e camada de mapa
- **TIM**: camada oficial de cobertura
- **TelecoCare**: camada nacional auxiliar de torres
- **ViaCEP + Nominatim**: geocodificacao
- **ABR Telecom**: consulta oficial de numero, com CAPTCHA

## Publicacao no GitHub

O repositório ja esta organizado para publicacao publica:

- `.gitignore` preparado
- `LICENSE` MIT
- `README` com identidade visual
- workflow de CI em `.github/workflows/ci.yml`

## Observacoes

- A camada nacional do TelecoCare e auxiliar e serve para panorama Brasil inteiro.
- A busca detalhada da area consultada continua priorizando a **Anatel ao vivo**.
- Cobertura oficial por mapa nao substitui medicao real de campo.
