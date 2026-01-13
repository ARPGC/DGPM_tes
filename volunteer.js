// ==========================================
// URJA 2026 - VOLUNTEER CONTROLLER
// ==========================================

(function() { // <--- IIFE WRAPPER

    // --- CONFIGURATION CHECKS ---
    if (typeof CONFIG === 'undefined' || typeof CONFIG_REALTIME === 'undefined') {
        console.error("CRITICAL: Config missing. Ensure config.js and config2.js are loaded.");
        return;
    }

    // 1. MAIN PROJECT
    const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

    // 2. REALTIME PROJECT
    const realtimeClient = window.supabase.createClient(CONFIG_REALTIME.url, CONFIG_REALTIME.serviceKey);

    // --- STATE ---
    let currentUser = null;
    let currentSportId = null;
    let allMatchesCache = []; 
    let currentLiveMatchId = null; 

    // --- INITIALIZATION ---
    document.addEventListener('DOMContentLoaded', async () => {
        if(window.lucide) lucide.createIcons();
        initTheme();
        injectToastContainer();
        setupConfirmModal();
        await checkAuth();
    });

    // --- 1. THEME LOGIC ---
    function initTheme() {
        const savedTheme = localStorage.getItem('urja-theme');
        if (savedTheme === 'dark') {
            document.documentElement.classList.add('dark');
            updateThemeIcon(true);
        } else {
            document.documentElement.classList.remove('dark');
            localStorage.setItem('urja-theme', 'light'); 
            updateThemeIcon(false);
        }
    }

    window.toggleTheme = function() {
        const html = document.documentElement;
        const isDark = html.classList.toggle('dark');
        localStorage.setItem('urja-theme', isDark ? 'dark' : 'light');
        updateThemeIcon(isDark);
    }

    function updateThemeIcon(isDark) {
        const btn = document.getElementById('btn-theme-toggle');
        if(btn) {
            btn.innerHTML = isDark 
                ? '<i data-lucide="sun" class="w-5 h-5 text-yellow-400"></i>' 
                : '<i data-lucide="moon" class="w-5 h-5 text-gray-600 dark:text-gray-300"></i>';
            if(window.lucide) lucide.createIcons();
        }
    }

    // --- 2. AUTHENTICATION ---
    async function checkAuth() {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) { window.location.href = 'login.html'; return; }

        const { data: user } = await supabaseClient
            .from('users')
            .select('*, assigned_sport:sports!assigned_sport_id(id, name, type, unit)') // Fetch Unit too
            .eq('id', session.user.id)
            .single();

        if (!user || user.role !== 'volunteer') {
            showToast("Access Denied", "error");
            setTimeout(() => window.location.href = 'login.html', 2000);
            return;
        }

        currentUser = user;
        const sportNameEl = document.getElementById('assigned-sport-name');
        const welcomeEl = document.getElementById('welcome-msg');

        if (user.assigned_sport) {
            currentSportId = user.assigned_sport.id;
            if (sportNameEl) sportNameEl.innerText = user.assigned_sport.name;
            if (welcomeEl) welcomeEl.innerText = `Welcome, ${user.first_name}`;
            loadAssignedMatches();
        } else {
            if (sportNameEl) sportNameEl.innerText = "No Sport Assigned";
            showToast("Ask Admin to assign a sport.", "error");
        }
    }

    window.logout = function() {
        supabaseClient.auth.signOut();
        window.location.href = 'login.html';
    }

    // --- 3. REALTIME SYNC ---
    async function syncToRealtime(matchId) {
        const { data: match, error } = await supabaseClient.from('matches').select('*, sports(name)').eq('id', matchId).single();
        if(error || !match) return;

        const payload = {
            id: match.id,
            sport_name: match.sports?.name || 'Unknown',
            team1_name: match.team1_name,
            team2_name: match.team2_name,
            score1: match.score1 || 0,
            score2: match.score2 || 0,
            status: match.status,
            is_live: match.is_live,
            round_number: match.round_number,
            match_type: match.match_type,
            winner_text: match.winner_text,
            updated_at: new Date()
        };

        await realtimeClient.from('live_matches').upsert(payload);
    }

    // --- 4. MATCH MANAGEMENT ---
    window.loadAssignedMatches = async function() {
        const container = document.getElementById('matches-container');
        if (container) container.innerHTML = '<div class="text-center py-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary mx-auto"></div></div>';

        const { data: matches, error } = await supabaseClient
            .from('matches')
            .select('*, sports(unit)')
            .eq('sport_id', currentSportId)
            .neq('status', 'Completed') 
            .order('start_time', { ascending: true });

        if (error) return showToast(error.message, "error");

        allMatchesCache = matches || [];
        allMatchesCache.sort((a, b) => {
            if (a.status === 'Live' && b.status !== 'Live') return -1;
            if (a.status !== 'Live' && b.status === 'Live') return 1;
            return 0;
        });

        renderMatches(allMatchesCache);
        
        if(currentLiveMatchId) {
            const match = allMatchesCache.find(m => m.id === currentLiveMatchId);
            if(match) updateLivePanelUI(match);
        }
    }

    window.filterMatches = function() {
        const query = document.getElementById('match-search').value.toLowerCase();
        const filtered = allMatchesCache.filter(m => 
            (m.team1_name && m.team1_name.toLowerCase().includes(query)) ||
            (m.team2_name && m.team2_name.toLowerCase().includes(query))
        );
        renderMatches(filtered);
    }

    function renderMatches(matches) {
        const container = document.getElementById('matches-container');
        if (!container) return;

        if (!matches || matches.length === 0) {
            container.innerHTML = `
                <div class="text-center p-8 bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
                    <p class="text-gray-400 dark:text-gray-500 font-bold text-sm">No active matches.</p>
                </div>`;
            return;
        }

        container.innerHTML = matches.map(m => {
            const isLive = m.status === 'Live';
            const isPerf = m.performance_data && Array.isArray(m.performance_data) && m.performance_data.length > 0;
            const cardType = isPerf ? 'Performance Event' : 'Match';

            if (isLive) {
                return `
                <div onclick="window.openMatchPanel('${m.id}')" class="bg-white dark:bg-gray-800 p-5 rounded-3xl border border-green-500 shadow-lg relative overflow-hidden cursor-pointer active:scale-[0.98] transition-all">
                    <div class="absolute top-0 left-0 w-full bg-green-500 text-white text-[10px] font-bold text-center py-1 uppercase tracking-widest animate-pulse">Live Now</div>
                    <div class="mt-4 text-center">
                        <h4 class="font-black text-lg text-gray-900 dark:text-white">${m.team1_name}</h4>
                        <p class="text-xs text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wide mt-1">${cardType}</p>
                    </div>
                    <div class="mt-4 text-center">
                        <span class="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-3 py-1.5 rounded-full border border-green-100 dark:border-green-800">
                            Tap to Enter Scores <i data-lucide="arrow-right" class="w-3 h-3"></i>
                        </span>
                    </div>
                </div>`;
            } else {
                return `
                <div class="bg-white dark:bg-gray-800 p-5 rounded-3xl border border-gray-100 dark:border-gray-700 shadow-sm relative transition-all">
                    <div class="flex justify-between items-center mb-3">
                        <span class="bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wide">Round ${m.round_number}</span>
                        <span class="text-xs font-bold text-gray-400">${new Date(m.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                    </div>
                    <h4 class="font-bold text-base text-gray-900 dark:text-white text-center mb-4">${m.team1_name}</h4>
                    <button onclick="window.startMatch('${m.id}')" class="w-full py-3 bg-black dark:bg-white text-white dark:text-black font-bold rounded-xl shadow-lg active:scale-95 transition-all text-xs">Start ${isPerf ? 'Event' : 'Match'}</button>
                </div>`;
            }
        }).join('');
        if(window.lucide) lucide.createIcons();
    }

    // --- 5. MATCH PANEL LOGIC (SPLIT VIEW) ---

    window.openMatchPanel = function(matchId) {
        const match = allMatchesCache.find(m => m.id === matchId);
        if(!match) return;
        currentLiveMatchId = matchId;
        const content = document.getElementById('live-match-content');
        
        if (content) {
            content.innerHTML = generateMatchHTML(match);
            document.getElementById('modal-live-match').classList.remove('hidden');
            if(window.lucide) lucide.createIcons();
        }
    }

    function updateLivePanelUI(match) {
        const content = document.getElementById('live-match-content');
        if (content && !document.getElementById('modal-live-match').classList.contains('hidden')) {
            // Only update standard matches automatically. 
            // Performance matches have input fields, auto-updating might overwrite user typing.
            if (!match.performance_data) {
                content.innerHTML = generateMatchHTML(match);
                if(window.lucide) lucide.createIcons();
            }
        }
    }

    function generateMatchHTML(match) {
        // CHECK IF PERFORMANCE EVENT (RACE/THROW)
        if (match.performance_data && Array.isArray(match.performance_data) && match.performance_data.length > 0) {
            return generatePerformanceHTML(match);
        } else {
            return generateStandardHTML(match);
        }
    }

    // --- A. PERFORMANCE EVENT UI ---
    function generatePerformanceHTML(match) {
        const unit = match.sports?.unit || 'Result';
        const rows = match.performance_data.map((p, index) => `
            <div class="flex items-center justify-between bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm mb-2">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center text-xs font-bold text-gray-500 dark:text-gray-400">${index + 1}</div>
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-gray-900 dark:text-white">${p.name}</span>
                        <span class="text-[10px] text-gray-400 uppercase tracking-wide">ID: ${p.id.substring(0, 6)}</span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <input type="text" id="perf-input-${index}" value="${p.result || ''}" placeholder="${unit}" 
                        class="w-20 p-2 text-right bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-primary">
                </div>
            </div>
        `).join('');

        return `
            <div class="max-w-md mx-auto pb-10">
                <div class="text-center mb-6">
                    <h3 class="text-xl font-black text-gray-900 dark:text-white">${match.team1_name}</h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Enter results (${unit}) for all participants</p>
                </div>
                
                <div class="space-y-2 mb-6 max-h-[60vh] overflow-y-auto no-scrollbar">
                    ${rows}
                </div>

                <div class="flex gap-3">
                    <button onclick="window.savePerformanceResults('${match.id}')" class="flex-1 py-3 bg-brand-primary text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all">Save All Results</button>
                    <button onclick="window.endPerformanceMatch('${match.id}')" class="px-4 py-3 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 font-bold rounded-xl border border-red-100 dark:border-red-800">End Event</button>
                </div>
            </div>
        `;
    }

    // --- B. STANDARD MATCH UI (SCOREBOARD) ---
    function generateStandardHTML(match) {
        return `
            <div class="flex flex-col gap-6 mb-8 w-full max-w-sm mx-auto">
                <div class="bg-white dark:bg-gray-800 p-5 rounded-3xl shadow-lg border border-indigo-50 dark:border-gray-700 flex flex-col items-center w-full">
                    <h4 class="font-bold text-lg text-center leading-tight w-full mb-3 text-gray-900 dark:text-white truncate px-2">${match.team1_name}</h4>
                    <span class="text-6xl font-black text-brand-primary dark:text-indigo-400 tracking-tighter mb-5">${match.score1 || 0}</span>
                    <div class="flex gap-3 w-full px-2">
                        <button onclick="window.updateScore('${match.id}', 'score1', -1, ${match.score1})" class="w-12 h-12 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-full text-gray-500 dark:text-gray-300 font-bold text-2xl active:scale-90 transition-transform shadow-sm">-</button>
                        <button onclick="window.updateScore('${match.id}', 'score1', 1, ${match.score1})" class="w-12 h-12 flex items-center justify-center bg-brand-primary text-white rounded-full font-bold text-2xl shadow-lg active:scale-90 transition-transform">+</button>
                    </div>
                </div>

                <div class="relative flex items-center justify-center py-2">
                    <span class="bg-white dark:bg-gray-800 text-gray-400 font-black text-xs px-4 py-1.5 rounded-full border border-gray-200 dark:border-gray-700">VS</span>
                </div>

                <div class="bg-white dark:bg-gray-800 p-5 rounded-3xl shadow-lg border border-pink-50 dark:border-gray-700 flex flex-col items-center w-full">
                    <h4 class="font-bold text-lg text-center leading-tight w-full mb-3 text-gray-900 dark:text-white truncate px-2">${match.team2_name}</h4>
                    <span class="text-6xl font-black text-pink-600 dark:text-pink-400 tracking-tighter mb-5">${match.score2 || 0}</span>
                    <div class="flex gap-3 w-full px-2">
                        <button onclick="window.updateScore('${match.id}', 'score2', -1, ${match.score2})" class="w-12 h-12 flex items-center justify-center bg-gray-100 dark:bg-gray-700 rounded-full text-gray-500 dark:text-gray-300 font-bold text-2xl active:scale-90 transition-transform shadow-sm">-</button>
                        <button onclick="window.updateScore('${match.id}', 'score2', 1, ${match.score2})" class="w-12 h-12 flex items-center justify-center bg-pink-600 text-white rounded-full font-bold text-2xl shadow-lg active:scale-90 transition-transform">+</button>
                    </div>
                </div>
            </div>

            <div class="space-y-6 w-full max-w-sm mx-auto pb-10">
                <button onclick="window.declareWalkover('${match.id}')" class="w-full py-4 border-2 border-red-50 dark:border-red-900/30 bg-white dark:bg-gray-800 text-red-500 dark:text-red-400 font-bold rounded-2xl text-xs uppercase tracking-wide hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex items-center justify-center gap-2">
                    <i data-lucide="user-x" class="w-4 h-4"></i> Declare Walkover (Absent)
                </button>

                <div class="p-6 bg-gray-900 dark:bg-white rounded-[2rem] shadow-2xl relative overflow-hidden">
                    <label class="text-[10px] font-bold text-gray-400 uppercase mb-4 block tracking-wide ml-1">Finish Match</label>
                    <select id="winner-select-${match.id}" onchange="window.enableEndBtn('${match.id}')" class="w-full p-4 bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 border border-gray-700 dark:border-gray-200 rounded-2xl text-base font-bold outline-none mb-5 appearance-none cursor-pointer">
                        <option value="" class="text-gray-500">Select Official Winner...</option>
                        <option value="${match.team1_id}">${match.team1_name}</option>
                        <option value="${match.team2_id}">${match.team2_name}</option>
                    </select>
                    <button id="btn-end-${match.id}" onclick="window.endMatch('${match.id}')" disabled class="w-full py-4 bg-gray-700 dark:bg-gray-300 text-gray-500 font-bold rounded-2xl cursor-not-allowed transition-all flex items-center justify-center gap-2">
                        <i data-lucide="trophy" class="w-5 h-5"></i> End Match & Save
                    </button>
                </div>
            </div>
        `;
    }

    // --- ACTIONS: PERFORMANCE ---
    window.savePerformanceResults = async function(matchId) {
        const match = allMatchesCache.find(m => m.id === matchId);
        if(!match || !match.performance_data) return;

        // Gather Inputs
        const updatedData = match.performance_data.map((p, index) => {
            const input = document.getElementById(`perf-input-${index}`);
            return { ...p, result: input ? input.value : p.result };
        });

        // Save to DB
        const { error } = await supabaseClient
            .from('matches')
            .update({ performance_data: updatedData })
            .eq('id', matchId);

        if (error) showToast("Failed to save results", "error");
        else {
            showToast("Results Saved!", "success");
            // Update local cache
            match.performance_data = updatedData;
        }
    }

    window.endPerformanceMatch = function(matchId) {
        showConfirmDialog("End Event?", "Ensure all results are entered. Admin will verify winners.", async () => {
            closeModal('modal-confirm');
            window.savePerformanceResults(matchId); // Save one last time
            
            // Just mark as Completed. Winners calculated by Admin later or auto-calc here if needed.
            // For now, let's keep it simple: Volunteer just inputs data.
            // OR: We can trigger the sort logic here if you want Volunteer to declare winner.
            // Admin logic from previous turns does the sorting. Volunteer just marks 'Completed'? 
            // Better: Volunteer just saves. Admin finalizes. Or let's allow Volunteer to "Finish" it.
            
            const { error } = await supabaseClient
                .from('matches')
                .update({ status: 'Completed', is_live: false })
                .eq('id', matchId);

            if(error) showToast("Error ending event", "error");
            else {
                showToast("Event Finished!", "success");
                window.closeMatchPanel();
            }
        });
    }

    // --- ACTIONS: STANDARD ---
    window.startMatch = function(matchId) {
        showConfirmDialog("Start Match?", "It will be visible on Live Boards immediately.", async () => {
            closeModal('modal-confirm');
            const { error } = await supabaseClient
                .from('matches')
                .update({ status: 'Live', is_live: true, score1: 0, score2: 0 })
                .eq('id', matchId);

            if (error) showToast("Error starting match", "error");
            else {
                showToast("Match Started!", "success");
                await syncToRealtime(matchId);
                await window.loadAssignedMatches(); 
                window.openMatchPanel(matchId); 
            }
        });
    }

    window.updateScore = async function(matchId, scoreField, delta, currentVal) {
        const newVal = Math.max(0, (currentVal || 0) + delta);
        
        const { error } = await supabaseClient
            .from('matches')
            .update({ [scoreField]: newVal })
            .eq('id', matchId);

        if (error) showToast("Sync Error", "error");
        else {
            const match = allMatchesCache.find(m => m.id === matchId);
            if(match) {
                match[scoreField] = newVal;
                updateLivePanelUI(match);
            }
            await syncToRealtime(matchId);
        }
    }

    window.enableEndBtn = function(matchId) {
        const select = document.getElementById(`winner-select-${matchId}`);
        const btn = document.getElementById(`btn-end-${matchId}`);
        if(!select || !btn) return;

        if (select.value) {
            btn.disabled = false;
            btn.classList.remove('bg-gray-700', 'text-gray-500', 'cursor-not-allowed', 'dark:bg-gray-300');
            btn.classList.add('bg-brand-primary', 'text-white', 'shadow-xl', 'active:scale-95');
        } else {
            btn.disabled = true;
            btn.classList.add('bg-gray-700', 'text-gray-500', 'cursor-not-allowed', 'dark:bg-gray-300');
            btn.classList.remove('bg-brand-primary', 'text-white', 'shadow-xl', 'active:scale-95');
        }
    }

    window.endMatch = function(matchId) {
        const select = document.getElementById(`winner-select-${matchId}`);
        if(!select) return;
        const winnerId = select.value;
        const winnerName = select.options[select.selectedIndex].text;

        if (!winnerId) return showToast("Please select a winner first", "error");

        showConfirmDialog("Confirm Result?", `Winner: ${winnerName}\nThis will end the match permanently.`, async () => {
            closeModal('modal-confirm');
            const { error } = await supabaseClient
                .from('matches')
                .update({ 
                    status: 'Completed', 
                    is_live: false, 
                    winner_id: winnerId,
                    winner_text: `Winner: ${winnerName}`
                })
                .eq('id', matchId);

            if (error) showToast("Error ending match", "error");
            else {
                showToast("Match Completed!", "success");
                await syncToRealtime(matchId);
                window.closeMatchPanel();
            }
        });
    }

    window.declareWalkover = function(matchId) {
        showConfirmDialog("Declare Walkover?", "Is the opponent absent? You will need to select the PRESENT team as the winner.", () => {
            closeModal('modal-confirm');
            const content = document.getElementById('live-match-content');
            if(content) content.scrollTop = content.scrollHeight;
            const select = document.getElementById(`winner-select-${matchId}`);
            if(select) {
                select.focus();
                select.classList.add('ring-4', 'ring-green-500');
                setTimeout(() => select.classList.remove('ring-4', 'ring-green-500'), 2000);
            }
            showToast("Select the Winner below to finish.", "info");
        });
    }

    window.closeMatchPanel = function() {
        document.getElementById('modal-live-match').classList.add('hidden');
        currentLiveMatchId = null;
        window.loadAssignedMatches(); 
    }

    // --- UTILS ---
    let confirmCallback = null;
    function setupConfirmModal() {
        const btnYes = document.getElementById('btn-confirm-yes');
        const btnCancel = document.getElementById('btn-confirm-cancel');
        if(btnYes) btnYes.onclick = () => confirmCallback && confirmCallback();
        if(btnCancel) btnCancel.onclick = () => { closeModal('modal-confirm'); confirmCallback = null; };
    }

    function showConfirmDialog(title, msg, onConfirm) {
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-msg');
        const modal = document.getElementById('modal-confirm');
        if(titleEl) titleEl.innerText = title;
        if(msgEl) msgEl.innerText = msg;
        confirmCallback = onConfirm;
        if(modal) modal.classList.remove('hidden');
    }

    function closeModal(id) {
        const el = document.getElementById(id);
        if(el) el.classList.add('hidden');
    }

    function showToast(msg, type) {
        const t = document.getElementById('toast-container');
        if(!t) return;
        
        // Remove existing toast content to force refresh
        t.innerHTML = '';
        
        const div = document.createElement('div');
        div.className = 'bg-gray-900 dark:bg-white text-white dark:text-gray-900 px-5 py-4 rounded-2xl shadow-2xl flex items-center gap-4 backdrop-blur-md border border-gray-700/50 dark:border-gray-200/50';
        
        const icon = type === 'error' ? '<i data-lucide="alert-triangle" class="w-5 h-5 text-red-400"></i>' : '<i data-lucide="check-circle" class="w-5 h-5 text-green-400"></i>';
        
        div.innerHTML = `<div>${icon}</div><p class="text-sm font-bold flex-1 tracking-wide">${msg}</p>`;
        
        t.appendChild(div);
        if(window.lucide) lucide.createIcons();
        
        t.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10');
        setTimeout(() => {
            t.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10');
        }, 3000);
    }

    // Inject Toast if missing
    function injectToastContainer() {
        if(!document.getElementById('toast-container')) {
            const div = document.createElement('div');
            div.id = 'toast-container';
            div.className = 'fixed bottom-10 left-1/2 transform -translate-x-1/2 z-[99] transition-all duration-300 opacity-0 pointer-events-none translate-y-10 w-11/12 max-w-sm';
            document.body.appendChild(div);
        }
    }

})(); // END IIFE
