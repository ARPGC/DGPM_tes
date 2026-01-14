// ==========================================
// URJA 2026 - VOLUNTEER CONTROLLER
// ==========================================

(function() { // IIFE Wrapper

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
    let confirmCallback = null; // Global callback for the modal

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
            showToast("Access Denied: Volunteers Only", "error");
            setTimeout(() => window.location.href = 'login.html', 2000);
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

    window.logout = function() {
        showConfirmDialog("Logout?", "Are you sure you want to sign out?", () => {
            supabaseClient.auth.signOut();
            window.location.href = 'login.html';
        });
    }

    // --- REALTIME SYNC ---
    async function syncToRealtime(matchId) {
        const { data: match } = await supabaseClient.from('matches').select('*, sports(name)').eq('id', matchId).single();
        if(!match) return;

        // FIXED: Send raw numeric scores to avoid the "invalid input syntax for type integer" error
        // The detailed string "10/6 (3)" will be stored in the score_details JSON column instead
        const payload = {
            id: match.id,
            sport_name: match.sports?.name || 'Unknown',
            team1_name: match.team1_name,
            team2_name: match.team2_name,
            score1: match.score1, // Sending Integer
            score2: match.score2, // Sending Integer
            status: match.status,
            is_live: match.is_live,
            round_number: match.round_number,
            match_type: match.match_type,
            winner_text: match.winner_text,
            performance_data: match.performance_data,
            score_details: match.score_details, // Detailed string stored here
            updated_at: new Date().toISOString()
        };

        const { error } = await realtimeClient.from('live_matches').upsert(payload);
        if (error) console.error("Realtime Sync Error:", error);
    }

    // --- MATCH LIST ---
    window.loadAssignedMatches = async function() {
        const container = document.getElementById('matches-container');
        if(container) container.innerHTML = '<div class="text-center py-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary mx-auto"></div></div>';

        const { data: matches } = await supabaseClient
            .from('matches')
            .select('*, sports(name, unit)')
            .eq('sport_id', currentSportId)
            .neq('status', 'Completed') 
            .order('start_time', { ascending: true });

        allMatchesCache = matches || [];
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
            container.innerHTML = '<p class="text-center text-gray-400 py-8">No active matches found.</p>';
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
                    ? `<button onclick="window.openMatchPanel('${m.id}')" class="w-full py-3 bg-green-600 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all text-xs">Update Score</button>`
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

        if (match.performance_data && Array.isArray(match.performance_data)) {
            content.innerHTML = generatePerformanceHTML(match);
        } else {
            const isCricket = match.sports?.name.toLowerCase().includes('cricket');
            if (isCricket) {
                content.innerHTML = generateCricketHTML(match);
            } else {
                content.innerHTML = generateStandardHTML(match);
            }
        }
        if(window.lucide) lucide.createIcons();
    }

    // --- PERFORMANCE UI ---
   function generatePerformanceHTML(match) {
    const unit = match.sports?.unit || 'Result';
    
    return `
        <div class="max-w-md mx-auto pb-10">
            <div class="text-center mb-6">
                <h3 class="text-xl font-black text-gray-900 dark:text-white">${match.team1_name}</h3>
                <p class="text-xs text-brand-primary font-bold animate-pulse mt-1">Autosave Enabled</p>
            </div>

            <div class="relative mb-6">
                <i data-lucide="search" class="absolute left-4 top-3 w-4 h-4 text-gray-400"></i>
                <input type="text" id="student-search" onkeyup="window.filterStudents()" 
                    placeholder="Search name or student ID..." 
                    class="w-full pl-10 pr-4 py-3 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-2xl text-sm font-bold shadow-sm outline-none focus:ring-2 focus:ring-brand-primary/20">
            </div>
            
            <div id="performance-list" class="space-y-2">
                ${renderStudentList(match.performance_data, match.id, unit)}
            </div>
        </div>`;
}

    // Helper to render only the list items
function renderStudentList(data, matchId, unit) {
    if (!data || data.length === 0) return '<p class="text-center text-gray-400 py-4">No students found.</p>';
    
    return data.map((p, idx) => `
        <div class="student-item flex items-center justify-between bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm" 
             data-name="${p.name.toLowerCase()}" 
             data-id="${(p.student_id || '').toLowerCase()}">
            <div class="flex items-center gap-3 overflow-hidden">
                <div class="w-8 h-8 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center text-xs font-bold text-gray-500 shrink-0">${idx + 1}</div>
                <div class="flex flex-col truncate">
                    <span class="text-sm font-bold text-gray-900 dark:text-white truncate">${p.name}</span>
                    ${p.student_id ? `<span class="text-[10px] text-gray-400 font-mono">${p.student_id}</span>` : ''}
                </div>
            </div>
            <input type="text" 
                id="perf-input-${idx}" 
                value="${p.result || ''}" 
                placeholder="${unit}" 
                oninput="window.saveSingleResult('${matchId}', ${idx})"
                class="w-24 p-2 text-center bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-600 rounded-lg font-bold text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-brand-primary">
        </div>
    `).join('');
}

// Logic to filter students by name or ID
window.filterStudents = function() {
    const query = document.getElementById('student-search').value.toLowerCase();
    const items = document.querySelectorAll('.student-item');

    items.forEach(item => {
        const name = item.getAttribute('data-name');
        const studentId = item.getAttribute('data-id');
        
        if (name.includes(query) || studentId.includes(query)) {
            item.classList.remove('hidden');
        } else {
            item.classList.add('hidden');
        }
    });
};
    // --- CRICKET UI ---
    function generateCricketHTML(match) {
        const d = match.score_details || { t1: {}, t2: {} };
        
        return `
            <div class="max-w-md mx-auto pb-10">
                <div class="bg-white dark:bg-gray-800 p-5 rounded-3xl shadow-lg mb-6">
                    <h4 class="font-bold text-gray-900 dark:text-white mb-3 border-b border-gray-100 dark:border-gray-700 pb-2">${match.team1_name}</h4>
                    <div class="grid grid-cols-3 gap-3 mb-3">
                        <input type="number" id="cricket-t1-runs" value="${d.t1?.runs || ''}" placeholder="Runs" class="p-3 bg-gray-50 dark:bg-gray-700 rounded-xl text-center font-bold outline-none border border-transparent focus:border-brand-primary">
                        <input type="number" id="cricket-t1-wkts" value="${d.t1?.wickets || ''}" placeholder="Wkts" class="p-3 bg-gray-50 dark:bg-gray-700 rounded-xl text-center font-bold outline-none border border-transparent focus:border-brand-primary">
                        <input type="number" id="cricket-t1-over" value="${d.t1?.overs || ''}" placeholder="Overs" class="p-3 bg-gray-50 dark:bg-gray-700 rounded-xl text-center font-bold outline-none border border-transparent focus:border-brand-primary">
                    </div>
                    
                    <h4 class="font-bold text-gray-900 dark:text-white mb-3 border-b border-gray-100 dark:border-gray-700 pb-2 pt-2">${match.team2_name}</h4>
                    <div class="grid grid-cols-3 gap-3 mb-4">
                        <input type="number" id="cricket-t2-runs" value="${d.t2?.runs || ''}" placeholder="Runs" class="p-3 bg-gray-50 dark:bg-gray-700 rounded-xl text-center font-bold outline-none border border-transparent focus:border-brand-primary">
                        <input type="number" id="cricket-t2-wkts" value="${d.t2?.wickets || ''}" placeholder="Wkts" class="p-3 bg-gray-50 dark:bg-gray-700 rounded-xl text-center font-bold outline-none border border-transparent focus:border-brand-primary">
                        <input type="number" id="cricket-t2-over" value="${d.t2?.overs || ''}" placeholder="Overs" class="p-3 bg-gray-50 dark:bg-gray-700 rounded-xl text-center font-bold outline-none border border-transparent focus:border-brand-primary">
                    </div>

                    <button onclick="window.updateCricketScore('${match.id}')" class="w-full py-3 bg-brand-primary text-white font-bold rounded-xl shadow-md active:scale-95">Update Scoreboard</button>
                </div>

                ${renderFinishSection(match)}
            </div>`;
    }

    // --- STANDARD UI ---
    function generateStandardHTML(match) {
        return `
            <div class="flex flex-col gap-6 mb-8 w-full max-w-sm mx-auto pt-4">
                ${renderTeamControl(match, 1)}
                <div class="flex items-center justify-center"><span class="bg-gray-100 dark:bg-gray-800 text-gray-400 px-3 py-1 rounded-full text-xs font-bold">VS</span></div>
                ${renderTeamControl(match, 2)}
            </div>
            <div class="space-y-4 w-full max-w-sm mx-auto pb-10">
                <button onclick="window.promptWalkover('${match.id}', '${match.team1_name}', '${match.team2_name}')" class="w-full py-4 border-2 border-dashed border-red-200 dark:border-red-900/50 text-red-500 dark:text-red-400 font-bold rounded-2xl text-xs uppercase hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors">Declare Walkover</button>
                ${renderFinishSection(match)}
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
                <button onclick="window.updateScore('${match.id}', 'score${teamNum}', 1, ${score})" class="w-16 h-16 rounded-2xl bg-${color} text-white text-3xl font-bold flex items-center justify-center shadow-lg active:scale-90 transition-transform">+</button>
            </div>
        </div>`;
    }

    function renderFinishSection(match) {
        return `
        <div class="p-6 bg-gray-900 dark:bg-white rounded-[2rem] shadow-2xl relative overflow-hidden">
            <label class="text-[10px] font-bold text-gray-400 uppercase mb-4 block tracking-wide ml-1">Declare Winner (Required)</label>
            <select id="winner-select-${match.id}" onchange="window.enableEndBtn('${match.id}')" class="w-full p-4 bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 border border-gray-700 dark:border-gray-200 rounded-2xl text-base font-bold outline-none mb-5 appearance-none cursor-pointer">
                <option value="" class="text-gray-500">Select Winner...</option>
                <option value="${match.team1_id}">${match.team1_name}</option>
                <option value="${match.team2_id}">${match.team2_name}</option>
            </select>
            <button id="btn-end-${match.id}" onclick="window.endMatch('${match.id}')" disabled class="w-full py-4 bg-gray-700 dark:bg-gray-300 text-gray-500 font-bold rounded-2xl cursor-not-allowed transition-all flex items-center justify-center gap-2">
                <i data-lucide="trophy" class="w-5 h-5"></i> Confirm & End Match
            </button>
        </div>`;
    }

    // --- ACTIONS ---

    window.updateCricketScore = async function(matchId) {
        const getVal = (id) => parseInt(document.getElementById(id)?.value) || 0; // FIXED: Ensure numeric values
        
        const details = {
            t1: { runs: getVal('cricket-t1-runs'), wickets: getVal('cricket-t1-wkts'), overs: getVal('cricket-t1-over') },
            t2: { runs: getVal('cricket-t2-runs'), wickets: getVal('cricket-t2-wkts'), overs: getVal('cricket-t2-over') }
        };

        details.team1_display = `${details.t1.runs}/${details.t1.wickets} (${details.t1.overs})`;
        details.team2_display = `${details.t2.runs}/${details.t2.wickets} (${details.t2.overs})`;

        // UPDATED: Sync runs to numeric score columns to maintain table consistency
        const { error } = await supabaseClient.from('matches').update({ 
            score_details: details,
            score1: details.t1.runs, // Integer runs
            score2: details.t2.runs  // Integer runs
        }).eq('id', matchId);

        if (error) {
            showToast("Save Failed", "error");
        } else {
            showToast("Scoreboard Updated!", "success");
            const match = allMatchesCache.find(m => m.id === matchId);
            if(match) {
                match.score_details = details;
                match.score1 = details.t1.runs; // Update cache
                match.score2 = details.t2.runs; // Update cache
            }
            syncToRealtime(matchId);
        }
    }

   window.saveSingleResult = async function(matchId, idx) {
    const input = document.getElementById(`perf-input-${idx}`);
    if(!input) return;
    const match = allMatchesCache.find(m => m.id === matchId);
    if(!match) return;

    match.performance_data[idx].result = input.value;
    const { error } = await supabaseClient.from('matches').update({ performance_data: match.performance_data }).eq('id', matchId);
    
    if(error) console.error("Auto-save failed", error);
    else {
        // Toast removed for smoother typing experience
        syncToRealtime(matchId);
    }
}
    window.promptWalkover = function(matchId, t1, t2) {
        const modal = document.getElementById('modal-confirm');
        const title = document.getElementById('confirm-title');
        const msg = document.getElementById('confirm-msg');
        const btnContainer = modal.querySelector('.flex.gap-3');
        
        title.innerText = "Who is Present?";
        msg.innerText = "Select the winner (the team that is present).";
        
        btnContainer.innerHTML = `
            <button onclick="window.confirmWalkover('${matchId}', '${t1}')" class="flex-1 py-3 bg-indigo-600 text-white font-bold rounded-xl text-xs truncate px-2">${t1}</button>
            <button onclick="window.confirmWalkover('${matchId}', '${t2}')" class="flex-1 py-3 bg-pink-600 text-white font-bold rounded-xl text-xs truncate px-2">${t2}</button>
        `;
        
        modal.classList.remove('hidden');
    }

    window.confirmWalkover = async function(matchId, winnerName) {
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
        setupConfirmModal(); 
    }

    window.startMatch = async function(matchId) {
        showConfirmDialog("Start Match?", "It will be visible on Live Boards.", async () => {
            document.getElementById('modal-confirm').classList.add('hidden');
            const { error } = await supabaseClient.from('matches').update({ status: 'Live', is_live: true }).eq('id', matchId);
            if(!error) {
                showToast("Match Live!", "success");
                syncToRealtime(matchId);
                loadAssignedMatches();
                openMatchPanel(matchId);
            }
        });
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

        if (!winnerId) return showToast("Select a winner first", "error");

        showConfirmDialog("End Match?", `Winner: ${winnerName}\nThis is final.`, async () => {
            document.getElementById('modal-confirm').classList.add('hidden');
            const { error } = await supabaseClient.from('matches').update({
                status: 'Completed',
                is_live: false,
                winner_id: winnerId,
                winner_text: `Winner: ${winnerName}`
            }).eq('id', matchId);

            if(!error) {
                showToast("Match Ended", "success");
                syncToRealtime(matchId);
                closeMatchPanel();
            } else {
                showToast("Error ending match", "error");
            }
        });
    }

    window.endPerformanceMatch = function(matchId) {
        showConfirmDialog("End Event?", "Ensure all results are saved.", async () => {
            document.getElementById('modal-confirm').classList.add('hidden');
            const { error } = await supabaseClient.from('matches').update({ status: 'Completed', is_live: false }).eq('id', matchId);
            if(!error) {
                showToast("Event Closed", "success");
                closeMatchPanel();
            }
        });
    }

    // --- UTILS ---
    function setupConfirmModal() {
        const modal = document.getElementById('modal-confirm');
        if(!modal) return;
        
        const container = modal.querySelector('.flex.gap-3');
        container.innerHTML = `
            <button id="btn-confirm-cancel" class="flex-1 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold rounded-xl">Cancel</button>
            <button id="btn-confirm-yes" class="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black font-bold rounded-xl shadow-lg">Yes</button>
        `;
        
        document.getElementById('btn-confirm-cancel').onclick = () => modal.classList.add('hidden');
    }

    function showConfirmDialog(title, msg, onConfirm) {
        const modal = document.getElementById('modal-confirm');
        const titleEl = document.getElementById('confirm-title');
        const msgEl = document.getElementById('confirm-msg');
        const yesBtn = document.getElementById('btn-confirm-yes');

        if(titleEl) titleEl.innerText = title;
        if(msgEl) msgEl.innerText = msg;
        
        const newYesBtn = yesBtn.cloneNode(true);
        yesBtn.parentNode.replaceChild(newYesBtn, yesBtn);
        
        newYesBtn.onclick = onConfirm;
        modal.classList.remove('hidden');
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
            t.classList.add('opacity-100');
            setTimeout(() => {
                t.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10');
                t.classList.remove('opacity-100');
            }, 3000);
        }
    }

})();
