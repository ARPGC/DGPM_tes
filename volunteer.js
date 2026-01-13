// ==========================================
// URJA 2026 - VOLUNTEER CONTROLLER
// ==========================================

(function() {

    // --- CONFIGURATION ---
    if (typeof CONFIG === 'undefined' || typeof CONFIG_REALTIME === 'undefined') {
        console.error("CRITICAL: Config missing.");
        return;
    }

    const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
    const realtimeClient = window.supabase.createClient(CONFIG_REALTIME.url, CONFIG_REALTIME.serviceKey);

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

    // --- THEME ---
    function initTheme() {
        if (localStorage.getItem('urja-theme') === 'dark') {
            document.documentElement.classList.add('dark');
        }
    }
    window.toggleTheme = function() {
        document.documentElement.classList.toggle('dark');
        localStorage.setItem('urja-theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
    }

    // --- AUTH ---
    async function checkAuth() {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) { window.location.href = 'login.html'; return; }

        const { data: user } = await supabaseClient
            .from('users')
            .select('*, assigned_sport:sports!assigned_sport_id(id, name, type, unit)')
            .eq('id', session.user.id)
            .single();

        if (!user || user.role !== 'volunteer') {
            alert("Access Denied");
            window.location.href = 'login.html';
            return;
        }

        currentUser = user;
        currentSportId = user.assigned_sport?.id;
        
        if (document.getElementById('assigned-sport-name')) {
            document.getElementById('assigned-sport-name').innerText = user.assigned_sport?.name || "No Sport";
            document.getElementById('welcome-msg').innerText = `Welcome, ${user.first_name}`;
        }
        
        if(currentSportId) loadAssignedMatches();
    }

    window.logout = () => { supabaseClient.auth.signOut(); window.location.href = 'login.html'; };

    // --- REALTIME SYNC ---
    async function syncToRealtime(matchId) {
        const { data: match } = await supabaseClient.from('matches').select('*, sports(name)').eq('id', matchId).single();
        if(!match) return;

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
            performance_data: match.performance_data, // NOW SYNCING PERFORMANCE DATA
            updated_at: new Date()
        };

        await realtimeClient.from('live_matches').upsert(payload);
    }

    // --- MATCH LIST ---
    window.loadAssignedMatches = async function() {
        const container = document.getElementById('matches-container');
        if(container) container.innerHTML = '<div class="text-center py-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary mx-auto"></div></div>';

        const { data: matches } = await supabaseClient
            .from('matches')
            .select('*, sports(unit)')
            .eq('sport_id', currentSportId)
            .neq('status', 'Completed') 
            .order('start_time', { ascending: true });

        allMatchesCache = matches || [];
        
        // Sort: Live first
        allMatchesCache.sort((a, b) => (a.status === 'Live' ? -1 : 1));

        renderMatches(allMatchesCache);
        
        if(currentLiveMatchId) {
            const match = allMatchesCache.find(m => m.id === currentLiveMatchId);
            if(match) updateLivePanelUI(match);
        }
    }

    function renderMatches(matches) {
        const container = document.getElementById('matches-container');
        if(!container) return;
        if (!matches || matches.length === 0) {
            container.innerHTML = '<p class="text-center text-gray-400 py-8">No active matches.</p>';
            return;
        }

        container.innerHTML = matches.map(m => {
            const isLive = m.status === 'Live';
            return `
            <div class="bg-white dark:bg-gray-800 p-5 rounded-3xl border ${isLive ? 'border-green-500 shadow-lg' : 'border-gray-100 dark:border-gray-700 shadow-sm'} relative overflow-hidden mb-3">
                ${isLive ? '<div class="absolute top-0 left-0 w-full bg-green-500 text-white text-[10px] font-bold text-center py-1 uppercase tracking-widest animate-pulse">Live Now</div>' : ''}
                
                <div class="flex justify-between items-center mt-3">
                    <span class="text-[10px] font-bold bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-gray-500 dark:text-gray-400 uppercase">Round ${m.round_number}</span>
                    <span class="text-xs font-bold text-gray-400">${new Date(m.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                </div>

                <div class="text-center my-4">
                    <h4 class="font-black text-lg text-gray-900 dark:text-white leading-tight">${m.team1_name}</h4>
                    ${!m.performance_data ? `<div class="text-xs text-gray-400 font-bold my-1">VS</div><h4 class="font-black text-lg text-gray-900 dark:text-white leading-tight">${m.team2_name}</h4>` : ''}
                </div>

                ${isLive 
                    ? `<button onclick="window.openMatchPanel('${m.id}')" class="w-full py-3 bg-green-600 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all text-xs">Enter Scores</button>`
                    : `<button onclick="window.startMatch('${m.id}')" class="w-full py-3 bg-black dark:bg-white text-white dark:text-black font-bold rounded-xl shadow-lg active:scale-95 transition-all text-xs">Start Match</button>`
                }
            </div>`;
        }).join('');
    }

    // --- MATCH PANEL ---
    window.openMatchPanel = function(matchId) {
        currentLiveMatchId = matchId;
        const match = allMatchesCache.find(m => m.id === matchId);
        document.getElementById('modal-live-match').classList.remove('hidden');
        if(match) updateLivePanelUI(match);
    }

    window.closeMatchPanel = function() {
        document.getElementById('modal-live-match').classList.add('hidden');
        currentLiveMatchId = null;
        loadAssignedMatches();
    }

    function updateLivePanelUI(match) {
        const content = document.getElementById('live-match-content');
        if(!content) return;

        // CHECK TYPE
        if (match.performance_data && Array.isArray(match.performance_data)) {
            content.innerHTML = generatePerformanceHTML(match);
        } else {
            content.innerHTML = generateStandardHTML(match);
        }
        lucide.createIcons();
    }

    // --- PERFORMANCE UI (UPDATED) ---
    function generatePerformanceHTML(match) {
        const unit = match.sports?.unit || 'Result';
        
        const listHtml = match.performance_data.map((p, idx) => `
            <div class="flex items-center justify-between bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm mb-2">
                <div class="flex items-center gap-3 overflow-hidden">
                    <div class="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center text-xs font-bold text-gray-500 dark:text-gray-400 shrink-0">${idx + 1}</div>
                    <span class="text-sm font-bold text-gray-900 dark:text-white truncate">${p.name.split('(')[0]}</span>
                </div>
                <div class="flex items-center gap-2">
                    <input type="text" id="perf-input-${idx}" value="${p.result || ''}" placeholder="${unit}" 
                        class="w-20 p-2 text-center bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-primary">
                    <button onclick="window.saveSingleResult('${match.id}', ${idx})" class="p-2 bg-brand-primary text-white rounded-lg shadow-md active:scale-90 transition-transform">
                        <i data-lucide="save" class="w-4 h-4"></i>
                    </button>
                </div>
            </div>
        `).join('');

        return `
            <div class="max-w-md mx-auto pb-10">
                <div class="text-center mb-6">
                    <h3 class="text-xl font-black text-gray-900 dark:text-white">${match.team1_name}</h3>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Enter ${unit} & Click Save Button</p>
                </div>
                <div class="mb-6">${listHtml}</div>
                <button onclick="window.endPerformanceMatch('${match.id}')" class="w-full py-4 bg-red-500 text-white font-bold rounded-2xl shadow-lg active:scale-95">End Event</button>
            </div>`;
    }

    // --- STANDARD UI (UPDATED BUTTONS) ---
    function generateStandardHTML(match) {
        return `
            <div class="flex flex-col gap-6 mb-8 w-full max-w-sm mx-auto pt-4">
                ${renderTeamControl(match, 1)}
                <div class="flex items-center justify-center"><span class="bg-gray-100 dark:bg-gray-800 text-gray-400 px-3 py-1 rounded-full text-xs font-bold">VS</span></div>
                ${renderTeamControl(match, 2)}
            </div>

            <div class="space-y-4 w-full max-w-sm mx-auto pb-10">
                <button onclick="window.promptWalkover('${match.id}', '${match.team1_name}', '${match.team2_name}')" class="w-full py-4 border-2 border-dashed border-gray-300 dark:border-gray-700 text-gray-400 font-bold rounded-2xl text-xs uppercase hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                    Declare Walkover
                </button>
                
                <div class="bg-gray-900 dark:bg-white p-1 rounded-2xl">
                    <button onclick="window.endMatch('${match.id}')" class="w-full py-4 bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 font-bold rounded-xl active:scale-95 transition-all">
                        Finish Match
                    </button>
                </div>
            </div>`;
    }

    function renderTeamControl(match, teamNum) {
        const name = match[`team${teamNum}_name`];
        const score = match[`score${teamNum}`] || 0;
        const color = teamNum === 1 ? 'brand-primary' : 'pink-600';
        
        return `
        <div class="bg-white dark:bg-gray-800 p-6 rounded-3xl shadow-lg border border-gray-100 dark:border-gray-700 flex flex-col items-center">
            <h4 class="font-black text-xl text-center text-gray-900 dark:text-white leading-tight mb-4 line-clamp-1">${name}</h4>
            <span class="text-6xl font-black text-${color} tracking-tighter mb-6">${score}</span>
            <div class="flex gap-4">
                <button onclick="window.updateScore('${match.id}', 'score${teamNum}', -1, ${score})" class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-700 text-gray-400 text-3xl font-bold flex items-center justify-center active:scale-90 transition-transform hover:bg-gray-200 dark:hover:bg-gray-600">-</button>
                <button onclick="window.updateScore('${match.id}', 'score${teamNum}', 1, ${score})" class="w-16 h-16 rounded-2xl bg-${color} text-white text-3xl font-bold flex items-center justify-center shadow-lg shadow-${color}/30 active:scale-90 transition-transform">+</button>
            </div>
        </div>`;
    }

    // --- ACTIONS ---

    window.saveSingleResult = async function(matchId, idx) {
        const input = document.getElementById(`perf-input-${idx}`);
        if(!input) return;
        
        const match = allMatchesCache.find(m => m.id === matchId);
        if(!match) return;

        // Update local data
        match.performance_data[idx].result = input.value;

        // Sync to DB
        const { error } = await supabaseClient.from('matches').update({ performance_data: match.performance_data }).eq('id', matchId);
        
        if(error) showToast("Save Failed", "error");
        else {
            showToast("Saved!", "success");
            syncToRealtime(matchId);
        }
    }

    window.promptWalkover = function(matchId, t1, t2) {
        // Custom Modal Logic for Walkover
        const modal = document.getElementById('modal-confirm');
        const title = document.getElementById('confirm-title');
        const msg = document.getElementById('confirm-msg');
        const btnContainer = modal.querySelector('.flex.gap-3');
        
        title.innerText = "Declare Walkover";
        msg.innerText = "Who is present and wins?";
        
        // Replace buttons dynamically for this action
        btnContainer.innerHTML = `
            <button onclick="confirmWalkover('${matchId}', '${t1}', '${matchId}_1')" class="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl text-xs">${t1}</button>
            <button onclick="confirmWalkover('${matchId}', '${t2}', '${matchId}_2')" class="flex-1 py-3 bg-pink-600 text-white font-bold rounded-xl text-xs">${t2}</button>
        `;
        
        modal.classList.remove('hidden');
    }

    window.confirmWalkover = async function(matchId, winnerName, teamRef) { // teamRef is just placeholder logic
        // Find actual IDs
        const match = allMatchesCache.find(m => m.id === matchId);
        const winnerId = (winnerName === match.team1_name) ? match.team1_id : match.team2_id;

        document.getElementById('modal-confirm').classList.add('hidden');

        const { error } = await supabaseClient.from('matches').update({
            status: 'Completed',
            is_live: false,
            winner_id: winnerId,
            winner_text: `Winner (Walkover): ${winnerName}`
        }).eq('id', matchId);

        if(error) showToast("Error", "error");
        else {
            showToast("Walkover Recorded", "success");
            syncToRealtime(matchId);
            closeMatchPanel();
        }
        
        // Reset Modal Buttons for next time (Standard Reset)
        setupConfirmModal(); 
    }

    window.startMatch = async function(matchId) {
        const { error } = await supabaseClient.from('matches').update({ status: 'Live', is_live: true }).eq('id', matchId);
        if(!error) {
            showToast("Match Live!", "success");
            syncToRealtime(matchId);
            loadAssignedMatches();
            openMatchPanel(matchId);
        }
    }

    window.updateScore = async function(matchId, field, delta, current) {
        const newVal = Math.max(0, current + delta);
        const { error } = await supabaseClient.from('matches').update({ [field]: newVal }).eq('id', matchId);
        
        if(!error) {
            const match = allMatchesCache.find(m => m.id === matchId);
            if(match) {
                match[field] = newVal;
                updateLivePanelUI(match);
            }
            syncToRealtime(matchId);
        }
    }

    window.endMatch = function(matchId) {
        // For standard match, simple confirm
        const match = allMatchesCache.find(m => m.id === matchId);
        if(match.score1 === match.score2) return showToast("Cannot end draw. Use Golden Point.", "error");
        
        const winner = match.score1 > match.score2 ? match.team1_name : match.team2_name;
        const winnerId = match.score1 > match.score2 ? match.team1_id : match.team2_id;

        if(confirm(`End Match? Winner: ${winner}`)) {
            supabaseClient.from('matches').update({
                status: 'Completed',
                is_live: false,
                winner_id: winnerId,
                winner_text: `Winner: ${winner}`
            }).eq('id', matchId).then(({error}) => {
                if(!error) {
                    showToast("Match Ended", "success");
                    syncToRealtime(matchId);
                    closeMatchPanel();
                }
            });
        }
    }

    window.endPerformanceMatch = function(matchId) {
        if(confirm("End Event? Make sure all results are saved.")) {
            supabaseClient.from('matches').update({ status: 'Completed', is_live: false }).eq('id', matchId).then(({error}) => {
                if(!error) {
                    showToast("Event Closed", "success");
                    closeMatchPanel();
                }
            });
        }
    }

    // --- UTILS ---
    function setupConfirmModal() {
        const modal = document.getElementById('modal-confirm');
        const container = modal.querySelector('.flex.gap-3');
        // Reset to default Yes/No
        container.innerHTML = `
            <button id="btn-confirm-cancel" onclick="document.getElementById('modal-confirm').classList.add('hidden')" class="flex-1 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold rounded-xl">Cancel</button>
            <button id="btn-confirm-yes" class="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black font-bold rounded-xl shadow-lg">Yes</button>
        `;
    }

    function injectToastContainer() {
        if(!document.getElementById('toast-container')) {
            const div = document.createElement('div');
            div.id = 'toast-container';
            div.className = 'fixed bottom-10 left-1/2 transform -translate-x-1/2 z-[99] transition-all duration-300 opacity-0 pointer-events-none translate-y-10 w-11/12 max-w-sm';
            div.innerHTML = `<div id="toast-content" class="bg-gray-900 text-white px-5 py-4 rounded-2xl shadow-2xl flex items-center gap-4"><div id="toast-icon"></div><p id="toast-msg" class="text-sm font-bold flex-1"></p></div>`;
            document.body.appendChild(div);
        }
    }

    function showToast(msg, type='info') {
        const t = document.getElementById('toast-container');
        const m = document.getElementById('toast-msg');
        const i = document.getElementById('toast-icon');
        if(t && m) {
            m.innerText = msg;
            i.innerHTML = type === 'error' ? '<i data-lucide="alert-triangle" class="w-5 h-5 text-red-400"></i>' : '<i data-lucide="check-circle" class="w-5 h-5 text-green-400"></i>';
            if(window.lucide) lucide.createIcons();
            t.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10');
            setTimeout(() => t.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10'), 3000);
        }
    }

})();
