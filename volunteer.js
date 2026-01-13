// ==========================================
// URJA 2026 - VOLUNTEER SCORING DASHBOARD
// ==========================================

(function() { // <--- WRAPPED IN IIFE TO PREVENT ERRORS

    // --- 1. CONFIGURATION CHECKS ---
    if (typeof CONFIG === 'undefined' || typeof CONFIG_REALTIME === 'undefined') {
        console.error("CRITICAL ERROR: Configuration missing. Ensure config.js and config2.js are loaded in volunteer.html");
        alert("System Error: Configuration missing. Please check console.");
        return;
    }

    // --- 2. CLIENT INITIALIZATION ---
    // A. MAIN PROJECT (Auth, Assignments - Write Access)
    const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

    // B. REALTIME PROJECT (Live Scores - Write Access via Service Key)
    const realtimeClient = window.supabase.createClient(CONFIG_REALTIME.url, CONFIG_REALTIME.serviceKey);

    // --- 3. STATE MANAGEMENT ---
    let currentUser = null;
    let assignedSportId = null;
    let currentMatchId = null;
    let currentScores = { s1: 0, s2: 0 };

    // --- 4. INITIALIZATION ---
    document.addEventListener('DOMContentLoaded', async () => {
        if(window.lucide) lucide.createIcons();
        injectToastContainer();
        injectScoringModal();
        
        await checkVolunteerAuth();
    });

    // --- 5. AUTHENTICATION ---
    async function checkVolunteerAuth() {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) { window.location.href = 'login.html'; return; }

        const { data: user } = await supabaseClient
            .from('users')
            .select('role, assigned_sport_id, sports(name)')
            .eq('id', session.user.id)
            .single();

        if (!user || user.role !== 'volunteer') {
            showToast("Access Denied: Volunteers Only", "error");
            setTimeout(() => window.location.href = 'index.html', 1500);
            return;
        }

        if (!user.assigned_sport_id) {
            document.getElementById('volunteer-content').innerHTML = `
                <div class="text-center py-20">
                    <div class="bg-yellow-50 rounded-full p-4 w-16 h-16 mx-auto mb-4 flex items-center justify-center">
                        <i data-lucide="alert-triangle" class="w-8 h-8 text-yellow-500"></i>
                    </div>
                    <h2 class="text-2xl font-bold text-gray-900">No Sport Assigned</h2>
                    <p class="text-gray-500 mt-2 px-6">Please ask an Admin to assign you a sport.</p>
                    <button onclick="location.reload()" class="mt-6 px-6 py-2 bg-black text-white rounded-lg text-sm font-bold">Refresh</button>
                </div>`;
            if(window.lucide) lucide.createIcons();
            return;
        }

        currentUser = session.user;
        assignedSportId = user.assigned_sport_id;
        
        const sportNameEl = document.getElementById('vol-sport-name');
        if(sportNameEl) sportNameEl.innerText = user.sports.name;
        
        loadMyMatches();
    }

    window.volunteerLogout = function() {
        supabaseClient.auth.signOut();
        window.location.href = 'login.html';
    }

    // --- 6. REALTIME SYNC (THE BRIDGE) ---
    async function syncToRealtime(matchId) {
        console.log(`[SYNC] Pushing Match ${matchId}...`);

        const { data: match, error } = await supabaseClient
            .from('matches')
            .select('*, sports(name)')
            .eq('id', matchId)
            .single();

        if(error || !match) {
            console.error("Sync Error: Main DB fetch failed", error);
            return;
        }

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

        const { error: rtError } = await realtimeClient
            .from('live_matches')
            .upsert(payload);

        if (rtError) console.error("Sync Failed:", rtError);
        else console.log("[SYNC] Success");
    }

    // --- 7. MATCH DASHBOARD ---
    async function loadMyMatches() {
        const container = document.getElementById('matches-list');
        if(!container) return;
        
        container.innerHTML = '<div class="text-center py-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary mx-auto mb-2"></div><p class="text-gray-400 text-sm">Loading schedule...</p></div>';

        const { data: matches, error } = await supabaseClient
            .from('matches')
            .select('*')
            .eq('sport_id', assignedSportId)
            .neq('status', 'Completed') 
            .order('start_time', { ascending: true });

        if (error) return showToast("Error loading matches", "error");

        if (!matches || matches.length === 0) {
            container.innerHTML = `
                <div class="text-center py-12 bg-white rounded-2xl border border-gray-100 shadow-sm">
                    <div class="bg-green-50 rounded-full p-4 w-16 h-16 mx-auto mb-3 flex items-center justify-center">
                        <i data-lucide="check-circle" class="w-8 h-8 text-green-500"></i>
                    </div>
                    <h3 class="font-bold text-gray-900 text-lg">All Caught Up!</h3>
                    <p class="text-sm text-gray-500 mt-1">No pending matches.</p>
                    <button onclick="location.reload()" class="mt-4 text-brand-primary font-bold text-xs hover:underline">Refresh</button>
                </div>`;
            if(window.lucide) lucide.createIcons();
            return;
        }

        container.innerHTML = matches.map(m => `
            <div class="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm relative overflow-hidden transition-all hover:shadow-md">
                ${m.status === 'Live' ? 
                    `<div class="absolute top-0 right-0 bg-red-600 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl animate-pulse flex items-center gap-1"><span class="w-1.5 h-1.5 bg-white rounded-full"></span> LIVE</div>` 
                : ''}
                
                <div class="flex justify-between items-end mb-4">
                    <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-2 py-1 rounded">Round ${m.round_number} • ${m.match_type}</div>
                    <div class="text-xs font-mono font-bold text-gray-500">${new Date(m.start_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                </div>

                <div class="flex items-center justify-between gap-2 mb-6">
                    <div class="text-left w-1/3">
                        <h3 class="font-black text-lg text-gray-900 leading-tight">${m.team1_name}</h3>
                        ${m.status === 'Live' ? `<p class="text-3xl font-black text-brand-primary mt-1">${m.score1 || 0}</p>` : ''}
                    </div>
                    <div class="text-center w-1/3 flex flex-col items-center">
                        <span class="text-[10px] font-bold text-gray-300 bg-gray-50 px-2 py-1 rounded-full mb-1">VS</span>
                    </div>
                    <div class="text-right w-1/3">
                        <h3 class="font-black text-lg text-gray-900 leading-tight">${m.team2_name}</h3>
                        ${m.status === 'Live' ? `<p class="text-3xl font-black text-brand-primary mt-1">${m.score2 || 0}</p>` : ''}
                    </div>
                </div>

                ${m.status === 'Live' ? 
                    `<button onclick="window.openScoring('${m.id}')" class="w-full py-3 bg-brand-primary text-white font-bold rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95 flex items-center justify-center gap-2">
                        <i data-lucide="edit-3" class="w-4 h-4"></i> Update Score
                    </button>`
                : 
                    `<button onclick="window.startMatch('${m.id}')" class="w-full py-3 bg-black text-white font-bold rounded-xl shadow-lg hover:bg-gray-800 transition-all active:scale-95 flex items-center justify-center gap-2">
                        <i data-lucide="play" class="w-4 h-4"></i> Start Match
                    </button>`
                }
            </div>
        `).join('');
        
        if(window.lucide) lucide.createIcons();
    }

    // --- 8. MATCH ACTIONS ---
    window.startMatch = async function(matchId) {
        if(!confirm("Start match? It will go LIVE for students.")) return;

        const { error } = await supabaseClient
            .from('matches')
            .update({ status: 'Live', is_live: true, score1: 0, score2: 0 })
            .eq('id', matchId);

        if (error) return showToast("Error starting match", "error");

        showToast("Match LIVE!", "success");
        await syncToRealtime(matchId);
        loadMyMatches();
    }

    window.openScoring = async function(matchId) {
        currentMatchId = matchId;
        
        const { data: match } = await supabaseClient
            .from('matches')
            .select('team1_name, team2_name, score1, score2')
            .eq('id', matchId)
            .single();

        if(!match) return;

        currentScores.s1 = match.score1 || 0;
        currentScores.s2 = match.score2 || 0;

        document.getElementById('score-t1-name').innerText = match.team1_name;
        document.getElementById('score-t2-name').innerText = match.team2_name;
        updateScoreDisplay();

        document.getElementById('modal-scoring').classList.remove('hidden');
    }

    function updateScoreDisplay() {
        document.getElementById('score-val-1').innerText = currentScores.s1;
        document.getElementById('score-val-2').innerText = currentScores.s2;
    }

    window.adjustScore = function(team, delta) {
        if(team === 1) currentScores.s1 = Math.max(0, currentScores.s1 + delta);
        else currentScores.s2 = Math.max(0, currentScores.s2 + delta);
        updateScoreDisplay();
    }

    window.saveScores = async function() {
        const btn = document.getElementById('btn-save-score');
        const originalText = btn.innerHTML;
        btn.innerText = "Saving...";
        btn.disabled = true;

        // 1. Update Main DB
        const { error } = await supabaseClient
            .from('matches')
            .update({ score1: currentScores.s1, score2: currentScores.s2 })
            .eq('id', currentMatchId);

        if (error) {
            showToast("Failed to save", "error");
            btn.innerHTML = originalText;
            btn.disabled = false;
            return;
        }

        // 2. Sync to Realtime DB
        await syncToRealtime(currentMatchId);

        showToast("Synced!", "success");
        btn.innerHTML = originalText;
        btn.disabled = false;
        closeModal('modal-scoring');
        loadMyMatches();
    }

    window.endMatch = async function() {
        if(!confirm("End match? This is final.")) return;

        let winnerText = '';
        const t1 = document.getElementById('score-t1-name').innerText;
        const t2 = document.getElementById('score-t2-name').innerText;

        if(currentScores.s1 > currentScores.s2) winnerText = `${t1} Won`;
        else if(currentScores.s2 > currentScores.s1) winnerText = `${t2} Won`;
        else winnerText = "Draw";

        const { error } = await supabaseClient
            .from('matches')
            .update({ 
                status: 'Completed', 
                is_live: false, 
                score1: currentScores.s1, 
                score2: currentScores.s2,
                winner_text: winnerText
            })
            .eq('id', currentMatchId);

        if (error) return showToast("Error ending match", "error");

        await syncToRealtime(currentMatchId);
        showToast("Match Ended", "success");
        closeModal('modal-scoring');
        loadMyMatches();
    }

    // --- 9. UTILS ---
    window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

    function injectScoringModal() {
        if(document.getElementById('modal-scoring')) return;
        const div = document.createElement('div');
        div.id = 'modal-scoring';
        div.className = 'hidden fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';
        div.innerHTML = `
            <div class="bg-white p-6 rounded-3xl w-full max-w-md shadow-2xl">
                <div class="text-center mb-6">
                    <h3 class="font-black text-2xl text-gray-900">Update Score</h3>
                    <p class="text-xs text-brand-primary font-bold uppercase tracking-wide mt-1">Live Sync Active</p>
                </div>
                <div class="flex items-center justify-between bg-gray-50 p-4 rounded-2xl mb-4 border border-gray-100">
                    <span id="score-t1-name" class="font-bold text-lg text-gray-800 w-1/2 truncate">Team A</span>
                    <div class="flex items-center gap-3">
                        <button onclick="adjustScore(1, -1)" class="w-10 h-10 bg-white border rounded-full font-bold shadow-sm">-</button>
                        <span id="score-val-1" class="text-4xl font-black text-brand-primary w-14 text-center">0</span>
                        <button onclick="adjustScore(1, 1)" class="w-10 h-10 bg-black text-white rounded-full font-bold shadow-lg">+</button>
                    </div>
                </div>
                <div class="flex items-center justify-between bg-gray-50 p-4 rounded-2xl mb-8 border border-gray-100">
                    <span id="score-t2-name" class="font-bold text-lg text-gray-800 w-1/2 truncate">Team B</span>
                    <div class="flex items-center gap-3">
                        <button onclick="adjustScore(2, -1)" class="w-10 h-10 bg-white border rounded-full font-bold shadow-sm">-</button>
                        <span id="score-val-2" class="text-4xl font-black text-brand-primary w-14 text-center">0</span>
                        <button onclick="adjustScore(2, 1)" class="w-10 h-10 bg-black text-white rounded-full font-bold shadow-lg">+</button>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-3 mb-4">
                    <button onclick="endMatch()" class="py-3.5 bg-red-50 text-red-600 font-bold rounded-xl hover:bg-red-100">End Match</button>
                    <button id="btn-save-score" onclick="saveScores()" class="py-3.5 bg-black text-white font-bold rounded-xl shadow-lg">Save & Sync</button>
                </div>
                <button onclick="closeModal('modal-scoring')" class="w-full py-3 text-gray-400 font-bold text-xs uppercase">Cancel</button>
            </div>`;
        document.body.appendChild(div);
    }

    function injectToastContainer() {
        if(!document.getElementById('toast-container')) {
            const div = document.createElement('div');
            div.id = 'toast-container';
            div.className = 'fixed bottom-10 left-1/2 transform -translate-x-1/2 z-[70] transition-all duration-300 opacity-0 pointer-events-none translate-y-10';
            div.innerHTML = `<div id="toast-content" class="bg-gray-900 text-white px-6 py-4 rounded-2xl shadow-2xl flex items-center gap-3"><div id="toast-icon"></div><p id="toast-msg" class="text-sm font-bold"></p></div>`;
            document.body.appendChild(div);
        }
    }

    function showToast(msg, type) {
        const t = document.getElementById('toast-container');
        const txt = document.getElementById('toast-msg');
        const icon = document.getElementById('toast-icon');
        if(txt) txt.innerText = msg;
        if(icon) icon.innerHTML = type === 'error' ? '<i data-lucide="alert-triangle"></i>' : '<i data-lucide="check-circle"></i>';
        if(window.lucide) lucide.createIcons();
        if(t) {
            t.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10');
            setTimeout(() => t.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10'), 3000);
        }
    }

})(); // END IIFE
