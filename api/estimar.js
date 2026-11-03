<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Movidesk Audit Central</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xlsx/dist/xlsx.full.min.js"></script>
  <!-- Firebase SDKs -->
  <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore-compat.js"></script>

  <style>
    :root {
      --navy: #14213d;
      --blue: #245be6;
      --bg: #f4f6f9;
      --card-bg: rgba(255, 255, 255, 0.9);
      --border: #e2e8f0;
      --text: #1e293b;
      --muted: #64748b;
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
    }
    .nav-item:hover, .nav-item.active {
      background: #eff6ff;
      color: var(--blue);
    }
    
    main {
      padding: 20px;
      overflow-y: auto;
    }
    
    .page-section { display: none; }
    .page-section.active { display: block; }

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
    }
    .btn {
      background: var(--blue);
      color: white;
      border: none;
      padding: 10px 18px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn:hover { opacity: 0.9; }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th, td {
      text-align: left;
      padding: 10px;
      border-bottom: 1px solid var(--border);
      font-size: 14px;
    }
    th { background: #f8fafc; font-weight: 600; }
  </style>
</head>
<body>

  <header>
    <div class="brand">Auditoria de Chamados <span>Ticket Manager · Movidesk</span></div>
    <div id="status-badge" style="font-size: 12px; opacity: 0.8;">● Conectado ao Firebase</div>
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
    <!-- GESTÃO -->
    <section id="gestao" class="page-section active">
      <div class="card">
        <h2>Visão Geral de Gestão</h2>
        <p style="color: var(--muted);">Auditoria geral e indicadores operacionais da operação.</p>
        <button class="btn" onclick="iaRunExecutiva()">✨ Gerar Análise Executiva (IA)</button>
        <div id="ia-executiva-result" style="margin-top: 15px; font-size: 14px; white-space: pre-wrap;"></div>
      </div>
    </section>

    <!-- CLIENTES VIP -->
    <section id="vip" class="page-section">
      <div class="card">
        <h2>Clientes VIP</h2>
        <p style="color: var(--muted);">Acompanhamento exclusivo de contratos estratégicos.</p>
      </div>
    </section>

    <!-- GRÁFICOS -->
    <section id="graficos" class="page-section">
      <div class="card">
        <h2>Gráficos Analíticos</h2>
        <canvas id="chartGestao" height="100"></canvas>
      </div>
    </section>

    <!-- PROJETOS -->
    <section id="projetos" class="page-section">
      <div class="card">
        <h2>Projetos & Estimativas</h2>
        <p style="color: var(--muted);">Análise comparativa de Horas Previstas vs. Apontadas.</p>
      </div>
    </section>

    <!-- COLABORADORES -->
    <section id="colaboradores" class="page-section">
      <div class="card">
        <h2>Capacidade de Colaboradores</h2>
        <p style="color: var(--muted);">Carga de trabalho e distribuição individual.</p>
      </div>
    </section>

    <!-- CONFIGURAÇÕES (Com sub-abas unificadas) -->
    <section id="configuracoes" class="page-section">
      <div class="sub-nav">
        <button class="sub-tab active" data-tab="sub-carga">📌 API Movidesk & Dados</button>
        <button class="sub-tab" data-tab="sub-robo">🤖 Robô & Leitura por IA</button>
        <button class="sub-tab" data-tab="sub-params">⚙️ Parâmetros & VIPs</button>
      </div>

      <!-- Sub-aba 1: Carga de Dados -->
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

      <!-- Sub-aba 2: Robô de IA -->
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

      <!-- Sub-aba 3: Parâmetros -->
      <div id="sub-params" class="sub-tab-content" style="display: none;">
        <div class="card">
          <h3>Clientes VIP</h3>
          <div class="fg">
            <label>Lista de Clientes VIP (um por linha)</label>
            <textarea id="vipList" rows="5"></textarea>
          </div>
          <button class="btn" onclick="salvarVIPs()">Salvar VIPs</button>
        </div>
      </div>
    </section>

  </main>

  <script>
    // 1. Definição essencial da função de seleção por ID para evitar ReferenceError[cite: 2]
    const $ = (id) => document.getElementById(id);

    // 2. Configuração do Firebase
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

    // 3. Sistema de Navegação Dinâmico e Unificado[cite: 1]
    function setupNavigation() {
      document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const targetId = btn.getAttribute('data-tab');
          if (!targetId) return;

          const isSubTab = btn.classList.contains('sub-tab');

          if (isSubTab) {
            // Gerencia sub-abas (dentro de Configurações)
            document.querySelectorAll('.sub-tab-content').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.sub-tab').forEach(el => el.classList.remove('active'));
            
            const targetSub = $(targetId);
            if (targetSub) targetSub.style.display = 'block';
            btn.classList.add('active');
          } else {
            // Gerencia menu principal da sidebar
            document.querySelectorAll('.page-section').forEach(el => el.style.display = 'none');
            document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

            const targetPage = $(targetId);
            if (targetPage) targetPage.style.display = 'block';
            btn.classList.add('active');
          }
        });
      });
    }

    // 4. Salvar ACCESS_KEY e Modos da IA em tempo real[cite: 1]
    function iaChanged() {
      const mode = $('iaMode').value;
      const key = $('iaKey').value.trim();

      localStorage.setItem('md_iamode', mode);
      localStorage.setItem('md_iakey', key);

      // Sincroniza também no Firestore
      db.collection('settings').doc('ia_config').set({
        mode: mode,
        key: key,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch(err => console.log('Erro ao persistir no Firebase:', err));
    }

    // 5. Execução do Robô de IA
    async function iaRun() {
      const key = $('iaKey').value.trim();
      const mode = $('iaMode').value;

      localStorage.setItem('md_iakey', key);

      if (mode === 'off') {
        $('iaLog').innerText = 'IA desligada nas configurações.';
        return;
      }
      if (!key) {
        $('iaLog').innerText = 'Informe a senha da função (ACCESS_KEY).';
        return;
      }

      $('iaLog').innerText = 'Enviando dados para análise...';

      try {
        const response = await fetch('/api/estimar', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-access-key': key
          },
          body: JSON.stringify({ jornada: 8, tickets: [] })
        });

        if (response.status === 401) {
          $('iaLog').innerText = 'Erro: ACCESS_KEY inválida.';
          return;
        }

        const data = await response.json();
        $('iaLog').innerText = 'Análise concluída com sucesso!';
      } catch (err) {
        $('iaLog').innerText = 'IA: Failed to fetch (a função /api/estimar não respondeu; verifique a publicação na Vercel).';
      }
    }

    // 6. Carregar Configurações Iniciais ao abrir a página
    function carregarConfiguracoes() {
      const savedKey = localStorage.getItem('md_iakey') || '';
      const savedMode = localStorage.getItem('md_iamode') || 'off';

      if ($('iaKey')) $('iaKey').value = savedKey;
      if ($('iaMode')) $('iaMode').value = savedMode;

      // Buscar do Firestore como fallback
      db.collection('settings').doc('ia_config').get().then(doc => {
        if (doc.exists) {
          const data = doc.data();
          if (data.key && !$('iaKey').value) $('iaKey').value = data.key;
          if (data.mode) $('iaMode').value = data.mode;
        }
      }).catch(() => {});
    }

    // Inicializador
    document.addEventListener('DOMContentLoaded', () => {
      setupNavigation();
      carregarConfiguracoes();
    });
  </script>
</body>
</html>
