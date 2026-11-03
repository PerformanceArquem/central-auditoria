<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Movidesk Audit Central</title>
  <!-- Chart.js para gráficos animados -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <!-- SheetJS para importação/exportação Excel/CSV -->
  <script src="https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js"></script>
  <!-- Firebase SDKs -->
  <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js"></script>

  <style>
    :root {
      --navy: #14213d;
      --blue: #2563eb;
      --blue-hover: #1d4ed8;
      --bg: #f4f6f9;
      --card-bg: #ffffff;
      --border: #e2e8f0;
      --text: #1e293b;
      --muted: #64748b;
      --green: #16a34a;
      --yellow: #d97706;
      --red: #dc2626;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: grid;
      grid-template-columns: 240px 1fr;
      grid-template-rows: 60px 1fr;
      height: 100vh;
      overflow: hidden;
    }
    header {
      grid-column: 1 / -1;
      background: var(--navy);
      color: white;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
    }
    .brand { font-weight: bold; font-size: 18px; display: flex; align-items: center; gap: 8px; }
    .brand span { font-size: 12px; opacity: 0.7; font-weight: normal; }
    
    .sidebar {
      background: white;
      border-right: 1px solid var(--border);
      padding: 15px 10px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .nav-item {
      display: flex;
      align-items: center;
      padding: 10px 15px;
      border-radius: 8px;
      color: var(--muted);
      text-decoration: none;
      font-weight: 500;
      cursor: pointer;
      border: none;
      background: transparent;
      width: 100%;
      text-align: left;
      font-size: 14px;
      transition: all 0.2s ease;
    }
    .nav-item:hover, .nav-item.active {
      background: #eff6ff;
      color: var(--blue);
      font-weight: 600;
    }
    
    main {
      padding: 20px;
      overflow-y: auto;
    }
    
    .page-section { display: none !important; }
    .page-section.active { display: block !important; }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.02);
    }

    .sub-nav {
      display: flex;
      gap: 10px;
      border-bottom: 1px solid var(--border);
      margin-bottom: 20px;
      padding-bottom: 10px;
    }
    .sub-tab {
      padding: 8px 16px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: white;
      cursor: pointer;
      font-weight: 500;
      font-size: 14px;
      transition: all 0.2s ease;
    }
    .sub-tab.active {
      background: var(--blue);
      color: white;
      border-color: var(--blue);
    }

    .fg { display: flex; flex-direction: column; gap: 5px; margin-bottom: 15px; }
    .fg label { font-size: 12px; font-weight: 600; color: var(--muted); }
    input, select, textarea {
      padding: 8px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      font-size: 14px;
      width: 100%;
    }
    .btn {
      background: var(--blue);
      color: white;
      border: none;
      padding: 10px 18px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s ease;
    }
    .btn:hover { background: var(--blue-hover); }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
      font-size: 13px;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 10px 12px;
      text-align: left;
    }
    th { background: #f8fafc; font-weight: 600; color: var(--muted); }

    #realtime-toast {
      display: none;
      background: #2563eb;
      color: white;
      padding: 10px 16px;
      border-radius: 8px;
      margin-bottom: 15px;
      font-size: 13px;
      font-weight: 500;
    }

    .capacity-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
      font-size: 13px;
    }
    .capacity-name {
      width: 180px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .progress-bar-container {
      flex: 1;
      height: 12px;
      background: #e2e8f0;
      border-radius: 6px;
      margin: 0 15px;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      border-radius: 6px;
      transition: width 0.8s ease-in-out;
    }
    .progress-bar-fill.green { background-color: var(--green); }
    .progress-bar-fill.yellow { background-color: var(--yellow); }
    .progress-bar-fill.red { background-color: var(--red); }
    .capacity-values {
      width: 220px;
      text-align: right;
      font-family: monospace;
      font-weight: 500;
    }

    .grid-2col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }

    @media (max-width: 1024px) {
      .grid-2col { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

  <header>
    <div class="brand">Auditoria de Chamados <span>Ticket Manager · Movidesk</span></div>
    <div id="status-badge" style="font-size: 12px; opacity: 0.9;">🟢 Firestore Conectado</div>
  </header>

  <nav class="sidebar">
    <button class="nav-item active" data-tab="gestao">Gestão</button>
    <button class="nav-item" data-tab="vip">Clientes VIP</button>
    <button class="nav-item" data-tab="graficos">Gráficos</button>
    <button class="nav-item" data-tab="projetos">Projetos</button>
    <button class="nav-item" data-tab="colaboradores">Colaboradores</button>
    <button class="nav-item" data-tab="configuracoes">⚙️ Configurações</button>
  </nav>

  <main>
    <div id="realtime-toast">⚡ Atualização em tempo real detectada nos chamados!</div>

    <!-- MÓDULO 1: GESTÃO -->
    <section id="gestao" class="page-section active">
      <div class="card">
        <h2>Visão Geral de Gestão</h2>
        <p style="color: var(--muted);">Auditoria geral e indicadores operacionais da operação.</p>
        <button class="btn" onclick="iaRunExecutiva()">✨ Gerar Análise Executiva (IA)</button>
        <div id="ia-executiva-result" style="margin-top: 15px; font-size: 14px; white-space: pre-wrap;"></div>
      </div>
      
      <div class="card">
        <h3>Resumo das Métricas Operacionais</h3>
        <table>
          <thead>
            <tr>
              <th>Métrica</th>
              <th>Valor Atual</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Total de Horas Apontadas</td>
              <td>1.992,78 h</td>
              <td><span style="color: var(--green);">● Normal</span></td>
            </tr>
            <tr>
              <td>Capacidade Esperada</td>
              <td>4.048,00 h</td>
              <td><span style="color: var(--blue);">● Planejada</span></td>
            </tr>
            <tr>
              <td>Chamados Auditados por IA</td>
              <td>142 chamados</td>
              <td><span style="color: var(--green);">● Atualizado</span></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- MÓDULO 2: CLIENTES VIP -->
    <section id="vip" class="page-section">
      <div class="card">
        <h2>Clientes VIP</h2>
        <p style="color: var(--muted);">Acompanhamento exclusivo de contratos estratégicos e fracionamento de horas.</p>
        <div id="vip-table-container">
          <table>
            <thead>
              <tr>
                <th>Cliente VIP</th>
                <th>Horas Contratadas</th>
                <th>Horas Apontadas</th>
                <th>Saldo</th>
                <th>Status Contratual</th>
              </tr>
            </thead>
            <tbody>
              <tr><td>Dr Oculos</td><td>100,00 h</td><td>42,50 h</td><td style="color: var(--green); font-weight: 600;">+57,50 h</td><td><span style="color: var(--green);">● Regular</span></td></tr>
              <tr><td>Ferri</td><td>80,00 h</td><td>78,10 h</td><td style="color: var(--yellow); font-weight: 600;">+1,90 h</td><td><span style="color: var(--yellow);">● Atenção</span></td></tr>
              <tr><td>Instituto mais visão</td><td>120,00 h</td><td>125,00 h</td><td style="color: var(--red); font-weight: 600;">-5,00 h</td><td><span style="color: var(--red);">● Excedido</span></td></tr>
              <tr><td>Instituto dos óculos</td><td>90,00 h</td><td>30,00 h</td><td style="color: var(--green); font-weight: 600;">+60,00 h</td><td><span style="color: var(--green);">● Regular</span></td></tr>
              <tr><td>Paulo e Condah</td><td>150,00 h</td><td>110,00 h</td><td style="color: var(--green); font-weight: 600;">+40,00 h</td><td><span style="color: var(--green);">● Regular</span></td></tr>
              <tr><td>Atacadão do Oculos</td><td>60,00 h</td><td>12,00 h</td><td style="color: var(--green); font-weight: 600;">+48,00 h</td><td><span style="color: var(--green);">● Regular</span></td></tr>
              <tr><td>Paschoal LAB</td><td>200,00 h</td><td>195,00 h</td><td style="color: var(--yellow); font-weight: 600;">+5,00 h</td><td><span style="color: var(--yellow);">● Atenção</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- MÓDULO 3: GRÁFICOS -->
    <section id="graficos" class="page-section">
      <div class="grid-2col">
        <div class="card">
          <h3>Progresso da capacidade por colaborador</h3>
          <p style="color: var(--muted); font-size: 12px; margin-bottom: 20px;">
            Exibição exata: <b>Apontado</b> vs <b>Esperado (Capacidade)</b>.
          </p>
          <div id="colaboradores-progress-list"></div>
        </div>

        <div class="card">
          <h3>Distribuição por atividade</h3>
          <div style="position: relative; height: 320px; width: 100%;">
            <canvas id="chartAtividades"></canvas>
          </div>
        </div>
      </div>
    </section>

    <!-- MÓDULO 4: PROJETOS -->
    <section id="projetos" class="page-section">
      <div class="card">
        <h2>Projetos & Estimativas</h2>
        <p style="color: var(--muted);">Análise comparativa de Horas Previstas (IA/Manual) vs. Apontadas.</p>
        <table>
          <thead>
            <tr>
              <th>Projeto / Chamado</th>
              <th>Responsável</th>
              <th>Horas Previstas (IA)</th>
              <th>Horas Apontadas</th>
              <th>Desvio</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>#1042 - Migração de Banco</td><td>Kleber Silva</td><td>12,00 h</td><td>14,50 h</td><td style="color: var(--red);">+2,50 h</td></tr>
            <tr><td>#1058 - Integração API Movidesk</td><td>Felipe Cavassin</td><td>8,00 h</td><td>6,00 h</td><td style="color: var(--green);">-2,00 h</td></tr>
            <tr><td>#1090 - Ajustes de Relatório VIP</td><td>Davi Vinicius</td><td>4,00 h</td><td>4,00 h</td><td style="color: var(--muted);">0,00 h</td></tr>
            <tr><td>#1112 - Automação de Workflows</td><td>Guilherme Bonato</td><td>16,00 h</td><td>22,00 h</td><td style="color: var(--red);">+6,00 h</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- MÓDULO 5: COLABORADORES -->
    <section id="colaboradores" class="page-section">
      <div class="card">
        <h2>Capacidade de Colaboradores</h2>
        <p style="color: var(--muted);">Carga de trabalho e distribuição individual de tarefas.</p>
        <table>
          <thead>
            <tr>
              <th>Colaborador</th>
              <th>Capacidade Mensal</th>
              <th>Apontado</th>
              <th>Ocupação</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Kleber Silva</td><td>176,00 h</td><td>261,52 h</td><td style="color: var(--red); font-weight: bold;">148% (Sobrecarga)</td></tr>
            <tr><td>Felipe Cavassin</td><td>176,00 h</td><td>186,78 h</td><td style="color: var(--red);">106%</td></tr>
            <tr><td>Guilherme Gustavo Bonato</td><td>176,00 h</td><td>158,27 h</td><td style="color: var(--green);">90%</td></tr>
            <tr><td>Davi Vinicius</td><td>176,00 h</td><td>146,93 h</td><td style="color: var(--green);">83%</td></tr>
            <tr><td>Leticia Barbosa</td><td>176,00 h</td><td>136,53 h</td><td style="color: var(--green);">77%</td></tr>
            <tr><td>Lucas Vieira</td><td>176,00 h</td><td>130,52 h</td><td style="color: var(--green);">74%</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- MÓDULO 6: CONFIGURAÇÕES -->
    <section id="configuracoes" class="page-section">
      <div class="sub-nav">
        <button class="sub-tab active" data-tab="sub-carga">📌 API Movidesk & Dados</button>
        <button class="sub-tab" data-tab="sub-robo">🤖 Robô & Leitura por IA</button>
        <button class="sub-tab" data-tab="sub-params">⚙️ Parâmetros & VIPs</button>
      </div>

      <div id="sub-carga" class="sub-tab-content">
        <div class="card">
          <h3>API Movidesk</h3>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <div class="fg" style="flex: 1; min-width: 200px;">
              <label>Domínio</label>
              <input id="mdDomain" type="text" placeholder="https://suaempresa.movidesk.com">
            </div>
            <div class="fg" style="flex: 1; min-width: 200px;">
              <label>Token da API</label>
              <input id="mdToken" type="password">
            </div>
          </div>
          <button class="btn" onclick="salvarConfiguracoes()">Salvar Configurações</button>
        </div>
      </div>

      <div id="sub-robo" class="sub-tab-content" style="display: none;">
        <div class="card">
          <h3>Leitura por IA (Serverless Vercel)</h3>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <div class="fg">
              <label>Analisar</label>
              <select id="iaMode" onchange="iaChanged()">
                <option value="off">Desligada</option>
                <option value="proj">Só chamados de projeto</option>
                <option value="all">Todos com horas apontadas</option>
              </select>
            </div>
            <div class="fg" style="flex: 1; min-width: 240px;">
              <label>Senha da função (ACCESS_KEY)</label>
              <input id="iaKey" type="password" oninput="iaChanged()" onchange="iaChanged()" placeholder="Digite a ACCESS_KEY">
            </div>
          </div>
          <button class="btn" onclick="iaRun()">Analisar Agora</button>
          <div id="iaLog" style="margin-top: 10px; font-size: 13px; color: var(--muted);"></div>
        </div>
      </div>

      <div id="sub-params" class="sub-tab-content" style="display: none;">
        <div class="card">
          <h3>Clientes VIP & Parâmetros Gerais</h3>
          <div class="fg">
            <label>Lista de Clientes VIP (um por linha)</label>
            <textarea id="vipList" rows="5">Dr Oculos
Ferri
Instituto mais visão
Instituto dos óculos
Paulo e Condah
Atacadão do Oculos
IMV
Paschoal LAB
Cardeal
Sr dos Oculos
Lux</textarea>
          </div>
          <button class="btn" onclick="salvarVIPs()">Salvar VIPs</button>
        </div>
      </div>
    </section>

  </main>

  <script>
    // Seletor $ com prioridade
    const $ = (id) => document.getElementById(id);

    // Configuração Firebase
    const firebaseConfig = {
      apiKey: "AIzaSyDummyKeyForArchitectureDemo",
      authDomain: "movidesk-audit.firebaseapp.com",
      projectId: "movidesk-audit",
      storageBucket: "movidesk-audit.appspot.com",
      messagingSenderId: "123456789",
      appId: "1:123456789:web:abcdef"
    };

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    const db = firebase.firestore();

    let ticketsLocais = [];

    // Sistema de Troca de Abas sem Limpeza
    function setupNavigation() {
      document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const targetId = btn.getAttribute('data-tab');
          if (!targetId) return;

          const isSubTab = btn.classList.contains('sub-tab');

          if (isSubTab) {
            document.querySelectorAll('.sub-tab-content').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.sub-tab').forEach(el => el.classList.remove('active'));
            
            const targetSub = $(targetId);
            if (targetSub) targetSub.style.display = 'block';
            btn.classList.add('active');
          } else {
            document.querySelectorAll('.page-section').forEach(el => {
              el.classList.remove('active');
            });
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

            const targetPage = $(targetId);
            if (targetPage) {
              targetPage.classList.add('active');
              btn.classList.add('active');

              if (targetId === 'graficos') {
                renderGraficosMock();
              }
            }
          }
        });
      });
    }

    function escutarAlteracoesEmTempoReal() {
      db.collection('artifacts')
        .doc('public')
        .collection('data')
        .doc('tickets_cache')
        .onSnapshot((doc) => {
          if (!doc.exists) return;
          ticketsLocais = doc.data().tickets || [];
          renderGraficosMock();
        }, (error) => {
          console.warn("Modo estático ativo.");
        });
    }

    function iaChanged() {
      const mode = $('iaMode') ? $('iaMode').value : 'off';
      const key = $('iaKey') ? $('iaKey').value.trim() : '';
      localStorage.setItem('md_iamode', mode);
      localStorage.setItem('md_iakey', key);
    }

    async function iaRun() {
      const key = $('iaKey').value.trim();
      const mode = $('iaMode').value;

      if (mode === 'off') {
        $('iaLog').innerText = 'IA desligada nas configurações.';
        return;
      }
      if (!key) {
        $('iaLog').innerText = 'Informe a senha da função (ACCESS_KEY).';
        return;
      }

      $('iaLog').innerText = 'A enviar requisição de IA...';

      try {
        const response = await fetch('/api/estimar', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-access-key': key
          },
          body: JSON.stringify({ jornada: 8, tickets: [] })
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          $('iaLog').innerText = `IA: ${data.erro || 'Erro ' + response.status}`;
          return;
        }

        $('iaLog').innerText = 'Processamento concluído com sucesso!';
      } catch (err) {
        $('iaLog').innerText = 'IA: Failed to fetch (função /api/estimar offline).';
      }
    }

    function salvarConfiguracoes() { alert('Configurações salvas!'); }
    function salvarVIPs() { alert('VIPs salvos!'); }

    const colaboradoresData = [
      { nome: "Equipe toda", apontado: 1992.78, esperado: 4048.00 },
      { nome: "Kleber Silva", apontado: 261.52, esperado: 176.00 },
      { nome: "Felipe Cavassin", apontado: 186.78, esperado: 176.00 },
      { nome: "Guilherme Gustavo Bonato", apontado: 158.27, esperado: 176.00 },
      { nome: "Davi Vinicius", apontado: 146.93, esperado: 176.00 },
      { nome: "Leticia Barbosa", apontado: 136.53, esperado: 176.00 },
      { nome: "Lucas Vieira", apontado: 130.52, esperado: 176.00 }
    ];

    function renderCapacityBars() {
      const container = $('colaboradores-progress-list');
      if (!container) return;
      container.innerHTML = '';

      colaboradoresData.forEach(item => {
        const pct = Math.round((item.apontado / item.esperado) * 100);
        let colorClass = 'yellow';
        if (pct > 100) colorClass = 'red';
        else if (pct >= 80) colorClass = 'green';

        const row = document.createElement('div');
        row.className = 'capacity-row';
        row.innerHTML = `
          <div class="capacity-name">${item.nome}</div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill ${colorClass}" style="width: 0%;"></div>
          </div>
          <div class="capacity-values">
            ${item.apontado.toFixed(2).replace('.', ',')} h de ${item.esperado.toFixed(2).replace('.', ',')} h · <b>${pct}%</b>
          </div>
        `;
        container.appendChild(row);

        setTimeout(() => {
          row.querySelector('.progress-bar-fill').style.width = Math.min(pct, 100) + '%';
        }, 50);
      });
    }

    function renderAtividadesChart() {
      const canvas = $('chartAtividades');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');

      if (window.chartAtividadesInstance) {
        window.chartAtividadesInstance.destroy();
      }

      window.chartAtividadesInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['PRO - Desenvolvimento', 'SUP - Chat resolvido', 'COO - Mediação', 'Outras'],
          datasets: [{
            data: [40, 25, 15, 20],
            backgroundColor: ['#2563eb', '#16a34a', '#d97706', '#475569'],
            borderWidth: 2,
            borderColor: '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { animateScale: true, duration: 1000 },
          plugins: { legend: { position: 'right' } }
        }
      });
    }

    function renderGraficosMock() {
      renderCapacityBars();
      renderAtividadesChart();
    }

    document.addEventListener('DOMContentLoaded', () => {
      setupNavigation();
      escutarAlteracoesEmTempoReal();

      const savedKey = localStorage.getItem('md_iakey') || '';
      const savedMode = localStorage.getItem('md_iamode') || 'off';
      if ($('iaKey')) $('iaKey').value = savedKey;
      if ($('iaMode')) $('iaMode').value = savedMode;

      renderGraficosMock();
    });
  </script>
</body>
</html>
