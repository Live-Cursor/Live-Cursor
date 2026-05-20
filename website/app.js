document.addEventListener('DOMContentLoaded', () => {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // --- THEME SWITCHER LOGIC ---
  const themeToggles = document.querySelectorAll('.theme-toggle');
  
  function getTheme() {
    return document.documentElement.getAttribute('data-theme') || 'dark';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }

  themeToggles.forEach(toggle => {
    toggle.addEventListener('click', () => {
      const currentTheme = getTheme();
      const nextTheme = currentTheme === 'light' ? 'dark' : 'light';
      setTheme(nextTheme);
    });
  });

  // --- 1. INTERACTIVE TABS FOR "HOW IT WORKS" ---
  window.switchVisualTab = function(index) {
    document.querySelectorAll('.hiw-tab').forEach((tab, i) => {
      if (i + 1 === index) tab.classList.add('active');
      else tab.classList.remove('active');
    });

    document.querySelectorAll('.hiw-vis-panel').forEach((panel, i) => {
      if (i + 1 === index) panel.classList.add('active');
      else panel.classList.remove('active');
    });
  };

  // --- 2. DYNAMIC BATTLE OF THE CURSORS HERO ANIMATION ---
  const heroTextMain = document.getElementById('text-main');
  const heroCursor1 = document.getElementById('cursor-1');
  const heroTextFinale = document.getElementById('text-finale');
  const heroCursor2 = document.getElementById('cursor-2');

  const allPlugins = [
    "Obsidian Live Share", "Peerdraft", "screen.garden",
    "Etherpad Lite", "Self-hosted LiveSync", "Syncthing",
    "Obsidian Sync", "Remotely Save"
  ];

  async function runHeroAnimation() {
    if (!heroTextMain || !heroCursor1 || !heroTextFinale || !heroCursor2) return;

    const shuffled = [...allPlugins].sort(() => 0.5 - Math.random());
    const competitors = shuffled.slice(0, 3);

    heroTextMain.textContent = "";
    heroTextFinale.textContent = "";
    heroTextMain.className = "";
    heroCursor1.classList.remove("hidden", "is-typing");
    heroCursor2.classList.add("hidden");
    heroCursor2.classList.remove("is-typing");

    await sleep(1000);

    // --- PHASE 1: THE COMPETITOR BATTLE ---
    for (let i = 0; i < competitors.length; i++) {
      const word = competitors[i];
      const isCursor1Turn = (i % 2 === 0);
      const typingCursor = isCursor1Turn ? heroCursor1 : heroCursor2;
      const deletingCursor = isCursor1Turn ? heroCursor2 : heroCursor1;
      const highlightClass = isCursor1Turn ? "highlight-blue" : "highlight-white";

      heroTextMain.parentNode.insertBefore(typingCursor, heroTextFinale);
      heroTextMain.parentNode.insertBefore(deletingCursor, heroTextFinale);

      typingCursor.classList.remove("hidden");
      deletingCursor.classList.add("hidden");

      // Type competitor
      typingCursor.classList.add("is-typing");
      for (let char of word) {
        heroTextMain.textContent += char;
        await sleep(70 + Math.random() * 50);
      }
      typingCursor.classList.remove("is-typing");

      await sleep(600);

      // Highlight and delete
      typingCursor.classList.add("hidden");
      deletingCursor.classList.remove("hidden");
      heroTextMain.classList.add(highlightClass);

      await sleep(400);

      heroTextMain.textContent = "";
      heroTextMain.classList.remove(highlightClass);

      await sleep(300);
    }

    // --- PHASE 2: THE COLLABORATIVE FINALE ---
    heroTextMain.parentNode.appendChild(heroCursor2); 
    
    heroCursor1.classList.remove("hidden");
    heroCursor2.classList.remove("hidden");

    const wordLeft = "Live-";
    const wordRight = "Cursor";

    async function typeLeft() {
      heroCursor1.classList.add("is-typing");
      for (let char of wordLeft) {
        heroTextMain.textContent += char;
        await sleep(100 + Math.random() * 100);
      }
      heroCursor1.classList.remove("is-typing");
    }

    async function typeRight() {
      heroCursor2.classList.add("is-typing");
      for (let char of wordRight) {
        heroTextFinale.textContent += char;
        await sleep(100 + Math.random() * 100);
      }
      heroCursor2.classList.remove("is-typing");
    }

    await sleep(200);
    await Promise.all([typeLeft(), typeRight()]);

    await sleep(800);
    heroCursor1.classList.add("hidden");
    heroCursor2.classList.add("hidden");
  }

  // --- 3. DYNAMIC OBSIDIAN EDITOR MOCKUP COLLABORATION ---
  const cAnna = document.getElementById('cursor-anna');
  const caretAnna = cAnna ? cAnna.querySelector('.cursor-caret') : null;
  const tAnna = document.getElementById('text-anna');
  
  const cPanos = document.getElementById('cursor-panos');
  const caretPanos = cPanos ? cPanos.querySelector('.cursor-caret') : null;
  const tPanos = document.getElementById('text-panos');
  
  const logsContainer = document.getElementById('logs-container');
  const startTime = Date.now();

  function addLog(msg, type = '') {
    if (!logsContainer) return;
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const sec = String(elapsed % 60).padStart(2, '0');
    const timeStr = `[00:${min}:${sec}]`;

    const div = document.createElement('div');
    div.className = `log-line${type ? ' ' + type : ''}`;
    div.innerHTML = `<span>${timeStr}</span> ${msg}`;
    
    logsContainer.appendChild(div);
    
    while (logsContainer.children.length > 10) {
      logsContainer.removeChild(logsContainer.firstChild);
    }
    
    logsContainer.scrollTop = logsContainer.scrollHeight;
  }

  function updatePos(cursor, prefixId, textId) {
    const prefixEl = document.getElementById(prefixId);
    const textEl = document.getElementById(textId);
    if (!cursor || !prefixEl || !textEl) return;
    const prefixW = prefixEl.getBoundingClientRect().width;
    const textW = textEl.getBoundingClientRect().width;
    cursor.style.transform = `translateX(${prefixW + textW}px)`;
  }

  async function runAnna() {
    if (!tAnna || !cAnna || !caretAnna) return;
    while (true) {
      tAnna.textContent = "";
      updatePos(cAnna, 'prefix-anna', 'text-anna');
      await sleep(1500);
      cAnna.style.opacity = '1';
      addLog("PEER: Anna joined active collaborative session", "anna");
      await sleep(800);
      
      addLog("PEER: Anna started typing at line 14...", "anna");
      const text1 = "Conflict-free merges";
      caretAnna.classList.add("is-typing");
      for (let char of text1) {
        tAnna.textContent += char;
        updatePos(cAnna, 'prefix-anna', 'text-anna');
        await sleep(60 + (Math.random() * 40));
      }
      caretAnna.classList.remove("is-typing");
      addLog("SYNC: Recv delta update (+20 chars) from Anna", "sync");
      
      await sleep(1200);
      
      addLog("PEER: Anna backspacing last word...", "anna");
      caretAnna.classList.add("is-typing");
      for (let i = 0; i < 6; i++) {
        tAnna.textContent = tAnna.textContent.slice(0, -1);
        updatePos(cAnna, 'prefix-anna', 'text-anna');
        await sleep(40);
      }
      caretAnna.classList.remove("is-typing");
      addLog("SYNC: Recv delta update (-6 chars) from Anna", "sync");
      
      await sleep(400);
      
      addLog("PEER: Anna typing correction...", "anna");
      const text2 = "offline architecture";
      caretAnna.classList.add("is-typing");
      for (let char of text2) {
        tAnna.textContent += char;
        updatePos(cAnna, 'prefix-anna', 'text-anna');
        await sleep(60 + (Math.random() * 40));
      }
      caretAnna.classList.remove("is-typing");
      addLog("SYNC: Recv delta update (+20 chars) from Anna", "sync");
      addLog("SYNC: State converged (0 conflicts)", "sync");
      
      await sleep(3500);
      cAnna.style.opacity = '0';
      addLog("PEER: Anna disconnected (session idle)", "anna");
      await sleep(2000);
    }
  }

  async function runPanos() {
    if (!tPanos || !cPanos || !caretPanos) return;
    while (true) {
      tPanos.textContent = "single click";
      tPanos.className = "";
      updatePos(cPanos, 'prefix-panos', 'text-panos');
      await sleep(3000);
      cPanos.style.opacity = '1';
      addLog("PEER: Panos joined active collaborative session", "panos");
      await sleep(1000);
      
      addLog("PEER: Panos selected range [118-130] \"single click\"", "panos");
      tPanos.className = "select-span cyan";
      await sleep(800);
      
      tPanos.className = "";
      tPanos.textContent = "";
      updatePos(cPanos, 'prefix-panos', 'text-panos');
      addLog("SYNC: Recv delta update (-12 chars) from Panos", "sync");
      await sleep(500);
      
      addLog("PEER: Panos replacing selected text...", "panos");
      const newText = "simple toggle";
      caretPanos.classList.add("is-typing");
      for (let char of newText) {
        tPanos.textContent += char;
        updatePos(cPanos, 'prefix-panos', 'text-panos');
        await sleep(70 + (Math.random() * 50));
      }
      caretPanos.classList.remove("is-typing");
      addLog("SYNC: Recv delta update (+13 chars) from Panos", "sync");
      addLog("SYNC: State converged (0 conflicts)", "sync");
      
      await sleep(4000);
      cPanos.style.opacity = '0';
      addLog("PEER: Panos disconnected (session idle)", "panos");
      await sleep(3000);
    }
  }

  // --- 4. NEW: MOBILE DRAWER MENU TOGGLE ---
  const menuToggle = document.getElementById('mobile-menu-toggle');
  const navDrawer = document.getElementById('mobile-nav-drawer');

  if (menuToggle && navDrawer) {
    menuToggle.addEventListener('click', () => {
      menuToggle.classList.toggle('open');
      navDrawer.classList.toggle('open');
    });

    // Close drawer when clicking layout links
    document.querySelectorAll('.mobile-link').forEach(link => {
      link.addEventListener('click', () => {
        menuToggle.classList.remove('open');
        navDrawer.classList.remove('open');
      });
    });
  }

  // --- 5. NEW: DOCUMENTATION HUB LIVE FILTERING ---
  const searchInput = document.getElementById('docs-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      document.querySelectorAll('.docs-section').forEach(section => {
        const title = section.querySelector('h1')?.textContent.toLowerCase() || '';
        const subtitles = Array.from(section.querySelectorAll('h2')).map(h => h.textContent.toLowerCase()).join(' ');
        const bodyText = section.textContent.toLowerCase();
        
        const isMatch = title.includes(query) || subtitles.includes(query) || bodyText.includes(query);
        
        if (isMatch) {
          section.classList.remove('hidden');
          // Highlight left sidebar navigation link
          const linkId = `link-${section.id}`;
          document.getElementById(linkId)?.classList.remove('hidden');
        } else {
          section.classList.add('hidden');
          const linkId = `link-${section.id}`;
          document.getElementById(linkId)?.classList.add('hidden');
        }
      });
    });

    // Handle smooth active state scroll tracking for Docs links
    const docLinks = document.querySelectorAll('.docs-nav-link');
    docLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        docLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      });
    });
  }

  // --- 6. NEW: INTERACTIVE CLIPBOARD COPIER ---
  window.copySnippet = function(button) {
    const preBlock = button.closest('.docs-code-container').querySelector('pre code');
    if (!preBlock) return;

    const textToCopy = preBlock.textContent;

    navigator.clipboard.writeText(textToCopy).then(() => {
      const statusSpan = button.querySelector('span');
      const originalText = statusSpan.textContent;
      
      statusSpan.textContent = "Copied!";
      button.style.color = "var(--accent-cyan)";
      
      setTimeout(() => {
        statusSpan.textContent = originalText;
        button.style.color = "";
      }, 1800);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  };

  // --- 7. NEW: INTERACTIVE SETUP WIZARD COMPILER ---
  window.goToStep = function(stepNum) {
    // 1. Update Step Sequence Indicators
    const indicators = document.querySelectorAll('#wizard-step-indicator .setup-step');
    indicators.forEach((indicator, index) => {
      const stepIdx = index + 1;
      if (stepIdx === stepNum) {
        indicator.className = 'setup-step active';
      } else if (stepIdx < stepNum) {
        indicator.className = 'setup-step completed';
      } else {
        indicator.className = 'setup-step';
      }
    });

    // 2. Toggle active configuration cards
    document.querySelectorAll('.setup-card').forEach((card, index) => {
      if (index + 1 === stepNum) {
        card.classList.add('active');
      } else {
        card.classList.remove('active');
      }
    });

    // Run custom compiler calculations on entering Step 3
    if (stepNum === 3) {
      updateCompiledScripts();
    }
  };

  // Switch Sub-Tabs in Wizard compiled output panel
  window.switchOutputTab = function(format) {
    document.querySelectorAll('.setup-output-block').forEach(block => {
      block.style.display = 'none';
    });
    
    const targetBlock = document.getElementById(`output-${format}`);
    if (targetBlock) targetBlock.style.display = 'block';

    // Toggle active state styling on the mini-tabs
    const formats = ['docker', 'compose', 'env'];
    formats.forEach(f => {
      const btn = document.getElementById(`tab-btn-${f}`);
      if (btn) {
        if (f === format) {
          btn.style.borderColor = 'var(--accent-cyan)';
          btn.style.color = 'var(--text-primary)';
        } else {
          btn.style.borderColor = '';
          btn.style.color = '';
        }
      }
    });
  };

  function updateCompiledScripts() {
    const port = document.getElementById('input-port')?.value || '1234';
    const username = document.getElementById('input-username')?.value || 'Panos';
    const dbpath = document.getElementById('input-dbpath')?.value || '/app/data/live-cursor.db';
    const backupdir = document.getElementById('input-backupdir')?.value || '/app/backups';
    
    // Determine active radio color selection
    let accentColor = '#06b6d4';
    const colorRadios = document.getElementsByName('radio-color');
    for (let radio of colorRadios) {
      if (radio.checked) {
        accentColor = radio.value;
        break;
      }
    }

    // Refresh live preview blocks in Step 2
    const previewPort = document.getElementById('preview-port');
    if (previewPort) previewPort.textContent = port;
    const previewUser = document.getElementById('preview-user');
    if (previewUser) previewUser.textContent = username;

    // 1. Compile Docker CLI Command
    const codeDocker = document.getElementById('code-docker');
    if (codeDocker) {
      codeDocker.textContent = `docker run -d \\
  --name live-cursor-daemon \\
  -p ${port}:${port} \\
  -v ./data:/app/data \\
  -v ./backups:/app/backups \\
  -e PORT=${port} \\
  -e DB_PATH=${dbpath} \\
  -e BACKUP_DIR=${backupdir} \\
  live-cursor/daemon:latest`;
    }

    // 2. Compile Docker Compose YAML Manifest
    const codeCompose = document.getElementById('code-compose');
    if (codeCompose) {
      codeCompose.textContent = `version: '3.8'
services:
  live-cursor:
    image: live-cursor/daemon:latest
    container_name: live-cursor-daemon
    ports:
      - "${port}:${port}"
    volumes:
      - ./data:/app/data
      - ./backups:/app/backups
    environment:
      - PORT=${port}
      - DB_PATH=${dbpath}
      - BACKUP_DIR=${backupdir}
    restart: unless-stopped`;
    }

    // 3. Compile .env Key-Values list
    const codeEnv = document.getElementById('code-env');
    if (codeEnv) {
      codeEnv.textContent = `PORT=${port}
DB_PATH=${dbpath}
BACKUP_DIR=${backupdir}
ADMIN_USER=${username}
ACCENT_COLOR=${accentColor}`;
    }
  }

  // Bind keyup listeners to forms in Step 1 to sync preview tags instantly
  const inputsToTrack = ['input-port', 'input-username'];
  inputsToTrack.forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateCompiledScripts);
  });

  // --- 8. START ALL ANIMATION LOOPS ---
  runHeroAnimation();
  runAnna();
  runPanos();
});
