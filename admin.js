// --- CONFIGURATION ---
const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
let currentUser = null;
let tempSchedule = []; 
let currentMatchViewFilter = 'Scheduled'; 
let allTeamsCache = []; // Cache for search functionality

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    injectToastContainer(); // Ensure toast UI exists
    await checkAdminAuth();
    switchView('dashboard');
});

// --- 1. AUTH CHECK ---
async function checkAdminAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    const { data: user } = await supabaseClient.from('users').select('role').eq('id', session.user.id).single();

    if (!user || user.role !== 'admin') {
        showToast("Access Denied: Admins Only", "error");
        setTimeout(() => window.location.href = 'login.html', 1500);
        return;
    }
    currentUser = session.user;
    loadDashboardStats();
}

function adminLogout() {
    supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

// --- 2. VIEW SWITCHING ---
window.switchView = function(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    const target = document.getElementById('view-' + viewId);
    if(target) {
        target.classList.remove('hidden');
        target.classList.remove('animate-fade-in');
        void target.offsetWidth; 
        target.classList.add('animate-fade-in');
    }

    // Update Nav State
    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('bg-brand-primary', 'text-white');
        el.classList.add('text-gray-500', 'hover:bg-gray-50');
    });

    const navBtn = document.getElementById('nav-' + viewId);
    if(navBtn) {
        navBtn.classList.remove('text-gray-500', 'hover:bg-gray-50');
        navBtn.classList.add('bg-brand-primary', 'text-white', 'shadow-lg', 'shadow-indigo-200');
    }

    document.getElementById('page-title').innerText = viewId.charAt(0).toUpperCase() + viewId.slice(1);

    if(viewId === 'sports') loadSportsList();
    if(viewId === 'users') loadUsersList();
    if(viewId === 'matches') loadMatches('Scheduled');
    if(viewId === 'teams') loadTeamsList();
}

// --- 3. DASHBOARD STATS ---
async function loadDashboardStats() {
    const { count: userCount } = await supabaseClient.from('users').select('*', { count: 'exact', head: true });
    const { count: regCount } = await supabaseClient.from('registrations').select('*', { count: 'exact', head: true });
    const { count: teamCount } = await supabaseClient.from('teams').select('*', { count: 'exact', head: true });
    // Removed Live Match Count as requested to remove "Live Lights"
    
    document.getElementById('dash-total-users').innerText = userCount || 0;
    document.getElementById('dash-total-regs').innerText = regCount || 0;
    document.getElementById('dash-total-teams').innerText = teamCount || 0;
}

// --- 4. SPORTS MANAGEMENT ---
async function loadSportsList() {
    const tablePerf = document.getElementById('sports-table-performance');
    const tableTourn = document.getElementById('sports-table-tournament');
    
    const loadingHtml = '<tr><td colspan="3" class="p-4 text-center text-gray-400">Loading...</td></tr>';
    tablePerf.innerHTML = loadingHtml;
    tableTourn.innerHTML = loadingHtml;

    const { data: sports } = await supabaseClient.from('sports').select('*').order('name');
    const { data: activeMatches } = await supabaseClient.from('matches').select('sport_id').neq('status', 'Completed');
    const activeSportIds = activeMatches ? activeMatches.map(m => m.sport_id) : [];

    if(!sports || sports.length === 0) {
        const noData = '<tr><td colspan="3" class="p-4 text-center text-gray-400">No sports found.</td></tr>';
        tablePerf.innerHTML = noData;
        tableTourn.innerHTML = noData;
        return;
    }

    let perfHtml = '';
    let tourHtml = '';

    sports.forEach(s => {
        const isStarted = activeSportIds.includes(s.id);
        
        let actionBtn = '';
        if (isStarted) {
             actionBtn = `<span class="text-xs font-bold text-green-600 bg-green-50 px-3 py-1 rounded-lg border border-green-100 flex items-center gap-1 w-max ml-auto"><i data-lucide="activity" class="w-3 h-3"></i> Event Active</span>`;
        } else {
             actionBtn = `
                <button onclick="window.handleScheduleClick('${s.id}', '${s.name}', ${s.is_performance}, '${s.type}')" class="px-4 py-1.5 bg-black text-white rounded-lg text-xs font-bold hover:bg-gray-800 shadow-sm transition-transform active:scale-95 ml-auto block">
                    ${s.is_performance ? 'Start Event' : 'Schedule Round'}
                </button>`;
        }
        
        const closeBtn = `<button onclick="toggleSportStatus('${s.id}', '${s.status}')" class="text-xs font-bold underline text-gray-400 hover:text-gray-600 transition-colors">${s.status === 'Open' ? 'Close Reg' : 'Open Reg'}</button>`;

        const rowHtml = `
        <tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
            <td class="p-4 font-bold text-gray-800">${s.name}</td>
            <td class="p-4"><span class="px-2 py-1 rounded text-xs font-bold ${s.status === 'Open' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}">${s.status}</span></td>
            <td class="p-4 text-right flex items-center justify-end gap-4">
                ${actionBtn}
                ${closeBtn}
            </td>
        </tr>`;

        if (s.is_performance) perfHtml += rowHtml;
        else tourHtml += rowHtml;
    });

    tablePerf.innerHTML = perfHtml || '<tr><td colspan="3" class="p-4 text-center text-gray-400 italic">No performance events found.</td></tr>';
    tableTourn.innerHTML = tourHtml || '<tr><td colspan="3" class="p-4 text-center text-gray-400 italic">No tournaments found.</td></tr>';
    
    lucide.createIcons();
}

window.openAddSportModal = () => document.getElementById('modal-add-sport').classList.remove('hidden');

window.handleAddSport = async function(e) {
    e.preventDefault();
    const name = document.getElementById('new-sport-name').value;
    const type = document.getElementById('new-sport-type').value;
    const size = document.getElementById('new-sport-size').value;

    const isPerformance = name.toLowerCase().includes('race') || 
                          name.toLowerCase().includes('jump') || 
                          name.toLowerCase().includes('throw') || 
                          name.toLowerCase().includes('put'); 

    const unit = isPerformance ? (name.toLowerCase().includes('race') ? 'Seconds' : 'Meters') : 'Points';

    const { error } = await supabaseClient.from('sports').insert({
        name, type, team_size: size, icon: 'trophy', 
        is_performance: isPerformance, 
        unit: unit
    });

    if(error) showToast(error.message, "error");
    else {
        showToast("Sport Added!", "success");
        closeModal('modal-add-sport');
        loadSportsList();
    }
}

window.toggleSportStatus = async function(id, currentStatus) {
    const newStatus = currentStatus === 'Open' ? 'Closed' : 'Open';
    await supabaseClient.from('sports').update({ status: newStatus }).eq('id', id);
    loadSportsList();
}

// --- 5. SCHEDULING ENGINE ---

window.handleScheduleClick = async function(sportId, sportName, isPerformance, sportType) {
    if (isPerformance) {
        if (confirm(`Start ${sportName}? This will initiate the event for volunteers.`)) {
            await initPerformanceEvent(sportId, sportName);
        }
    } else {
        await initTournamentRound(sportId, sportName, sportType);
    }
}

// A. PERFORMANCE EVENTS
async function initPerformanceEvent(sportId, sportName) {
    const { data: existing } = await supabaseClient.from('matches').select('id').eq('sport_id', sportId).neq('status', 'Completed');
    if (existing.length > 0) return showToast("Event is already active!", "info");

    const { data: regs } = await supabaseClient.from('registrations')
        .select('user_id, users(first_name, last_name, student_id)')
        .eq('sport_id', sportId);

    if (!regs || regs.length === 0) return showToast("No registrations found.", "error");

    const participants = regs.map(r => ({
        id: r.user_id,
        name: `${r.users.first_name} ${r.users.last_name} (${r.users.student_id})`,
        result: '',
        rank: 0
    }));

    const { error } = await supabaseClient.from('matches').insert({
        sport_id: sportId,
        team1_name: sportName,
        team2_name: 'All Participants',
        status: 'Live',
        is_live: true,
        performance_data: participants
    });

    if (error) showToast(error.message, "error");
    else {
        showToast(`${sportName} started!`, "success");
        loadSportsList();
        loadMatches('Live');
    }
}

window.endPerformanceEvent = async function(matchId) {
    if (!confirm("Are you sure? This will Calculate Winners and END the event.")) return;

    const { data: match } = await supabaseClient.from('matches').select('performance_data, sports(unit)').eq('id', matchId).single();
    let arr = match.performance_data;
    const unit = match.sports.unit;

    let validEntries = arr.filter(p => p.result && p.result.trim() !== '');
    
    // Sort Logic (High to Low for Distance, Low to High for Time)
    const isDistance = unit === 'Meters' || unit === 'Points';
    validEntries.sort((a, b) => {
        const valA = parseFloat(a.result) || 0;
        const valB = parseFloat(b.result) || 0;
        return isDistance ? (valB - valA) : (valA - valB);
    });

    let winners = { gold: null, silver: null, bronze: null };
    validEntries.forEach((p, i) => {
        p.rank = i + 1;
        if(i === 0) winners.gold = p.name;
        if(i === 1) winners.silver = p.name;
        if(i === 2) winners.bronze = p.name;
    });

    const finalData = [...validEntries, ...arr.filter(p => !p.result || p.result.trim() === '')];
    const winnerText = `Gold: ${winners.gold || '-'}`;

    const { error } = await supabaseClient.from('matches').update({ 
        performance_data: finalData,
        status: 'Completed',
        winner_text: winnerText,
        winners_data: winners,
        is_live: false 
    }).eq('id', matchId);

    if(error) showToast("Error: " + error.message, "error");
    else {
        showToast("Event Ended Successfully!", "success");
        loadMatches(currentMatchViewFilter); 
        loadSportsList(); 
    }
}

// B. SMART TOURNAMENT SCHEDULER (JR vs JR / SR vs SR)
async function initTournamentRound(sportId, sportName, sportType) {
    showToast("Analyzing Bracket...", "info");

    const intSportId = parseInt(sportId); 

    const { data: matches } = await supabaseClient.from('matches')
        .select('round_number, status')
        .eq('sport_id', intSportId)
        .order('round_number', { ascending: false })
        .limit(1);

    let round = 1;
    let candidates = [];

    if (!matches || matches.length === 0) {
        // --- ROUND 1: INITIALIZE ---
        
        // 1. Sync Individual Players as Teams
        if (sportType === 'Individual') {
            showToast("Syncing individual players...", "info");
            await supabaseClient.rpc('prepare_individual_teams', { sport_id_input: intSportId });
        }

        // 2. Auto-Lock Top 64 Teams
        await supabaseClient.rpc('auto_lock_tournament_teams', { sport_id_input: intSportId });

        // 3. Fetch Valid Teams with Categories
        // The SQL function returns: team_id, team_name, category ('Junior' or 'Senior')
        const { data: validTeams, error } = await supabaseClient.rpc('get_tournament_teams', { sport_id_input: intSportId });
        
        if (error) { console.error(error); return showToast("DB Error: " + error.message, "error"); }
        if (!validTeams || validTeams.length < 2) return showToast("Need at least 2 VALID TEAMS to start.", "error");

        // Format for pairing
        candidates = validTeams.map(t => ({ 
            id: t.team_id, 
            name: t.team_name,
            category: t.category 
        }));

    } else {
        // --- NEXT ROUNDS ---
        if (matches[0].status !== 'Completed') return showToast("Current round matches are still active!", "error");
        
        round = matches[0].round_number + 1;
        const { data: winners } = await supabaseClient.from('matches')
            .select('winner_id')
            .eq('sport_id', intSportId)
            .eq('round_number', round - 1)
            .neq('winner_id', null);

        if (!winners || winners.length < 2) return showToast("Tournament Completed or Insufficient Winners.", "success");

        const winnerIds = winners.map(w => w.winner_id);
        
        // Fetch Team Details + Category for Next Round Logic
        const { data: teamDetails } = await supabaseClient
            .from('teams')
            .select(`id, name, captain:users!captain_id(class_name)`)
            .in('id', winnerIds);

        candidates = teamDetails.map(t => ({
            id: t.id,
            name: t.name,
            category: (['FYJC', 'SYJC'].includes(t.captain.class_name)) ? 'Junior' : 'Senior'
        }));
    }

    // --- PAIRING LOGIC ---
    tempSchedule = [];
    
    // Determine Match Type (Finals, Semi, etc)
    let matchType = 'Regular';
    if (candidates.length === 2) matchType = 'Final';
    else if (candidates.length <= 4) matchType = 'Semi-Final';
    else if (candidates.length <= 8) matchType = 'Quarter-Final';

    // *** THE MERGE LOGIC ***
    // If <= 4 teams (Semi-Finals/Finals), MIX everyone (Jr vs Sr allowed)
    // Else, Separate Jr vs Jr and Sr vs Sr
    
    if (candidates.length <= 4) {
        // --- OPEN POOL (The Merge) ---
        candidates.sort(() => Math.random() - 0.5); // Random Mix
        generatePairsFromList(candidates, round, matchType);
    } else {
        // --- SPLIT POOL ---
        const juniors = candidates.filter(c => c.category === 'Junior').sort(() => Math.random() - 0.5);
        const seniors = candidates.filter(c => c.category === 'Senior').sort(() => Math.random() - 0.5);
        
        generatePairsFromList(juniors, round, matchType);
        generatePairsFromList(seniors, round, matchType);
        
        // Handle Leftovers (Rare case where odd numbers in split but even total)
        // Note: For simplicity in this logic, Byes are handled per pool.
    }

    openSchedulePreviewModal(sportName, round, tempSchedule, intSportId);
}

function generatePairsFromList(list, round, matchType) {
    for (let i = 0; i < list.length; i += 2) {
        if (i + 1 < list.length) {
            tempSchedule.push({
                t1: list[i],
                t2: list[i+1],
                time: "10:00",
                location: "College Ground", // Default
                round: round,
                type: matchType
            });
        } else {
             // Bye logic
             tempSchedule.push({
                t1: list[i],
                t2: { id: null, name: "BYE (Auto-Advance)" },
                time: "10:00",
                location: "N/A",
                round: round,
                type: 'Bye Round'
             });
        }
    }
}

function openSchedulePreviewModal(sportName, round, schedule, sportId) {
    document.getElementById('preview-subtitle').innerText = `Generating Round ${round}`;
    const container = document.getElementById('schedule-preview-list');
    
    // Venue Options (Fixed)
    const venueOptions = `
        <option value="College Ground">College Ground</option>
        <option value="Badminton Hall">Badminton Hall</option>
        <option value="Old Gymkhana">Old Gymkhana</option>
    `;

    container.innerHTML = schedule.map((m, idx) => `
        <div class="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row items-center gap-4">
            <div class="flex-1 text-center md:text-left">
                <span class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">${m.type}</span>
                <div class="font-bold text-gray-900 text-lg">${m.t1.name} <span class="text-[10px] bg-gray-100 px-1 rounded">${m.t1.category || ''}</span></div>
                <div class="text-xs text-gray-400 font-bold my-1">VS</div>
                <div class="font-bold text-gray-900 text-lg ${m.t2.id ? '' : 'text-gray-400 italic'}">${m.t2.name} <span class="text-[10px] bg-gray-100 px-1 rounded">${m.t2.category || ''}</span></div>
            </div>
            ${m.t2.id ? `
            <div class="flex gap-2 w-full md:w-auto">
                <input type="time" class="input-field p-2 w-full md:w-24 bg-gray-50 border rounded-lg text-sm font-bold" value="${m.time}" onchange="updateTempSchedule(${idx}, 'time', this.value)">
                <select class="input-field p-2 w-full md:w-40 bg-gray-50 border rounded-lg text-sm font-bold" onchange="updateTempSchedule(${idx}, 'location', this.value)">
                    ${venueOptions}
                </select>
            </div>` : `<span class="text-xs font-bold text-green-500 bg-green-50 px-2 py-1 rounded">Walkover</span>`}
        </div>
    `).join('');

    document.getElementById('btn-confirm-schedule').onclick = () => confirmSchedule(sportId);
    document.getElementById('modal-schedule-preview').classList.remove('hidden');
}

window.updateTempSchedule = function(idx, field, value) {
    tempSchedule[idx][field] = value;
}

async function confirmSchedule(sportId) {
    const btn = document.getElementById('btn-confirm-schedule');
    btn.innerText = "Publishing...";
    btn.disabled = true;

    const inserts = tempSchedule.map(m => ({
        sport_id: sportId,
        team1_id: m.t1.id,
        team2_id: m.t2.id,
        team1_name: m.t1.name,
        team2_name: m.t2.name,
        start_time: new Date().toISOString().split('T')[0] + 'T' + m.time,
        location: m.location,
        round_number: m.round,
        status: m.t2.id ? 'Scheduled' : 'Completed', 
        winner_id: m.t2.id ? null : m.t1.id,         
        winner_text: m.t2.id ? null : `${m.t1.name} (Bye)`,
        match_type: m.type
    }));

    const { error } = await supabaseClient.from('matches').insert(inserts);

    if(error) {
        showToast(error.message, "error");
        btn.innerText = "Confirm & Publish";
        btn.disabled = false;
    } else {
        showToast("Round Generated Successfully!", "success");
        closeModal('modal-schedule-preview');
        loadSportsList();
        loadMatches('Scheduled');
    }
}

// --- 6. MATCH MANAGEMENT ---

window.loadMatches = async function(statusFilter = 'Scheduled') {
    currentMatchViewFilter = statusFilter;
    
    const btns = document.querySelectorAll('#view-matches button');
    btns.forEach(b => {
        if(b.innerText.includes(statusFilter)) {
            b.classList.remove('bg-white', 'border-gray-200');
            b.classList.add('bg-black', 'text-white', 'border-black');
        } else {
            b.classList.add('bg-white', 'border-gray-200');
            b.classList.remove('bg-black', 'text-white', 'border-black');
        }
    });

    const container = document.getElementById('matches-grid');
    container.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">Loading matches...</p>';

    const { data: matches } = await supabaseClient
        .from('matches')
        .select('*, sports(name, is_performance)')
        .eq('status', statusFilter)
        .order('start_time', { ascending: true });

    if (!matches || matches.length === 0) {
        container.innerHTML = `<p class="col-span-3 text-center text-gray-400 py-10">No ${statusFilter} matches found.</p>`;
        return;
    }

    container.innerHTML = matches.map(m => {
        const isPerf = m.sports.is_performance;
        const isLive = m.status === 'Live';
        const dateObj = new Date(m.start_time);
        const timeStr = dateObj.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        let badgeHtml = isLive 
            ? `<span class="bg-red-50 text-red-600 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider animate-pulse flex items-center gap-1"><span class="w-1.5 h-1.5 rounded-full bg-red-600"></span> LIVE</span>`
            : `<span class="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wider">${timeStr}</span>`;

        let typeBadge = m.match_type !== 'Regular' && m.match_type ? `<span class="ml-2 text-[9px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded font-bold uppercase border border-indigo-100">${m.match_type}</span>` : '';

        return `
        <div class="w-full bg-white p-5 rounded-3xl border border-gray-200 shadow-sm relative overflow-hidden group hover:shadow-md transition-all">
            
            <div class="flex justify-between items-start mb-4">
                 <div class="flex items-center">
                    ${badgeHtml}
                    ${typeBadge}
                 </div>
                 <span class="text-xs text-gray-500 font-bold uppercase tracking-wider">${m.sports.name}</span>
            </div>

            ${isPerf ?
                `<div class="text-center py-2">
                    <h4 class="font-black text-xl text-gray-900">${m.team1_name}</h4>
                    <p class="text-xs text-gray-400 mt-1 font-bold uppercase">Performance Event</p>
                 </div>`
              :
                `<div class="flex items-center justify-between w-full mb-4 px-2">
                    <h4 class="font-bold text-lg text-gray-900 leading-tight text-left w-1/3 truncate">${m.team1_name}</h4>
                    <span class="text-[10px] font-bold text-gray-300 px-2">VS</span>
                    <h4 class="font-bold text-lg text-gray-900 leading-tight text-right w-1/3 truncate">${m.team2_name}</h4>
                </div>`
            }

            <div class="border-t border-gray-100 pt-4 flex items-center justify-between gap-3">
                 <div class="text-xs font-bold text-gray-400 flex items-center gap-1">
                    <i data-lucide="map-pin" class="w-3 h-3"></i> ${m.location || 'N/A'}
                 </div>
                 
                 <div>
                    ${isPerf && m.status === 'Live' ? 
                        `<button onclick="endPerformanceEvent('${m.id}')" class="px-3 py-1.5 bg-red-500 text-white text-xs font-bold rounded-lg hover:bg-red-600 shadow-sm transition-colors">End Event</button>`
                    : 
                        m.status === 'Scheduled' ? 
                            `<button onclick="startMatch('${m.id}')" class="px-3 py-1.5 bg-green-500 text-white text-xs font-bold rounded-lg hover:bg-green-600 shadow-sm transition-colors">Start Match</button>` 
                        : `<span class="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-1 rounded border border-gray-200">${m.winner_text || 'Completed'}</span>`
                    }
                 </div>
            </div>
        </div>
    `}).join('');
    lucide.createIcons();
}

window.startMatch = async function(matchId) {
    if(!confirm("Start this match now? It will appear as LIVE.")) return;
    await supabaseClient.from('matches').update({ status: 'Live', is_live: true }).eq('id', matchId);
    showToast("Match is now LIVE!", "success");
    loadMatches('Live');
    loadSportsList();
}

// --- 7. TEAMS (WITH SEARCH & FILTER) ---

async function loadTeamsList() {
    const grid = document.getElementById('teams-grid');
    grid.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">Loading teams...</p>';
    
    // Inject Search UI if not present
    let searchContainer = document.getElementById('teams-search-container');
    if(!searchContainer) {
        searchContainer = document.createElement('div');
        searchContainer.id = 'teams-search-container';
        searchContainer.className = "col-span-3 mb-4 flex gap-2";
        searchContainer.innerHTML = `
            <input type="text" id="team-search-input" onkeyup="filterTeamsList()" placeholder="Search by Team Name or Captain..." class="flex-1 p-3 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-black">
            <button onclick="filterTeamsList('Locked')" class="px-4 py-2 bg-gray-100 text-gray-600 font-bold text-xs rounded-xl hover:bg-gray-200">Locked Only</button>
        `;
        grid.parentElement.insertBefore(searchContainer, grid);
    }

    const { data: teams } = await supabaseClient
        .from('teams')
        .select('*, sports(name), captain:users!captain_id(first_name, last_name)')
        .order('created_at', { ascending: false });

    allTeamsCache = teams || [];
    renderTeams(allTeamsCache);
}

window.filterTeamsList = function(statusFilter = null) {
    const query = document.getElementById('team-search-input').value.toLowerCase();
    let filtered = allTeamsCache.filter(t => 
        t.name.toLowerCase().includes(query) || 
        (t.captain && (t.captain.first_name + ' ' + t.captain.last_name).toLowerCase().includes(query))
    );

    if (statusFilter === 'Locked') {
        filtered = filtered.filter(t => t.status === 'Locked');
    }
    renderTeams(filtered);
}

function renderTeams(teams) {
    const grid = document.getElementById('teams-grid');
    if (!teams || teams.length === 0) {
        grid.innerHTML = '<p class="col-span-3 text-center text-gray-400 py-10">No teams found.</p>';
        return;
    }

    grid.innerHTML = teams.map(t => `
        <div class="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
            <div class="flex justify-between items-start mb-3">
                <span class="text-[10px] font-bold uppercase bg-gray-100 px-2 py-1 rounded text-gray-500">${t.sports.name}</span>
                <span class="text-[10px] font-bold uppercase ${t.status === 'Locked' ? 'text-red-500' : 'text-green-500'}">${t.status}</span>
            </div>
            <h4 class="font-bold text-lg text-gray-900">${t.name}</h4>
            <p class="text-xs text-gray-500 mb-4">Capt: ${t.captain?.first_name || 'Unknown'}</p>
            <button onclick="viewTeamSquad('${t.id}', '${t.name}')" class="w-full py-2 bg-indigo-50 text-indigo-600 text-xs font-bold rounded-lg hover:bg-indigo-100 transition-colors">View Squad</button>
        </div>
    `).join('');
}

window.viewTeamSquad = async function(teamId, teamName) {
    const { data: members } = await supabaseClient.from('team_members').select('users(first_name, last_name)').eq('team_id', teamId).eq('status', 'Accepted');
    let msg = `Squad for ${teamName}:\n\n`;
    if(members) members.forEach((m, i) => msg += `${i+1}. ${m.users.first_name} ${m.users.last_name}\n`);
    alert(msg); // Keeping simple alert for this detail view as it's just info
}

// --- 8. USERS (SEARCH ADDED) ---

async function loadUsersList() {
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = '<tr><td colspan="5" class="p-4 text-center text-gray-400">Loading...</td></tr>';
    
    // Inject Search for Users if not present
    let uSearch = document.getElementById('user-search-input');
    if(!uSearch) {
        const wrapper = document.createElement('div');
        wrapper.className = "mb-4 px-4";
        wrapper.innerHTML = `<input id="user-search-input" onkeyup="filterUsersList()" placeholder="Search Student..." class="w-full p-3 bg-white border border-gray-200 rounded-xl text-sm outline-none focus:border-black">`;
        tbody.parentElement.parentElement.insertBefore(wrapper, tbody.parentElement);
    }

    const { data: users } = await supabaseClient.from('users').select('*, assigned_sport:sports!assigned_sport_id(name)').order('created_at', { ascending: false }).limit(100);
    const { data: sports } = await supabaseClient.from('sports').select('id, name');

    // Store globally for filtering
    window.allUsersCache = users; 
    window.allSportsCache = sports;
    
    renderUsers(users, sports);
}

window.filterUsersList = function() {
    const query = document.getElementById('user-search-input').value.toLowerCase();
    const filtered = window.allUsersCache.filter(u => 
        (u.first_name + ' ' + u.last_name).toLowerCase().includes(query) ||
        (u.student_id && u.student_id.toLowerCase().includes(query))
    );
    renderUsers(filtered, window.allSportsCache);
}

function renderUsers(users, sports) {
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = users.map(u => {
        const sportOptions = sports.map(s => `<option value="${s.id}" ${u.assigned_sport_id === s.id ? 'selected' : ''}>${s.name}</option>`).join('');
        return `
        <tr class="border-b border-gray-50 hover:bg-gray-50 transition-colors">
            <td class="p-4 font-bold text-gray-800 flex items-center gap-2">
                <div class="w-8 h-8 rounded-full bg-gray-200 overflow-hidden"><img src="${u.avatar_url || 'https://via.placeholder.com/32'}" class="w-full h-full object-cover"></div>
                ${u.first_name} ${u.last_name}
            </td>
            <td class="p-4 text-sm text-gray-600">${u.class_name || '-'}</td>
            <td class="p-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 text-gray-600">${u.role}</span></td>
            <td class="p-4">
                ${u.role === 'volunteer' ? `<select class="p-1 bg-white border rounded text-xs outline-none" onchange="assignVolunteerSport('${u.id}', this.value)"><option value="">-- Assign --</option>${sportOptions}</select>` : '-'}
            </td>
            <td class="p-4 text-right">
                ${u.role !== 'admin' ? `<button onclick="promoteUser('${u.id}')" class="text-xs font-bold text-brand-primary hover:underline">Make Volunteer</button>` : '<span class="text-gray-300 text-xs">Admin</span>'}
            </td>
        </tr>`;
    }).join('');
}

window.assignVolunteerSport = async function(userId, sportId) {
    const val = sportId === "" ? null : sportId;
    const { error } = await supabaseClient.from('users').update({ assigned_sport_id: val }).eq('id', userId);
    if(error) showToast("Failed", "error"); else showToast("Assigned", "success");
}

window.promoteUser = async function(userId) {
    if(!confirm("Promote user?")) return;
    await supabaseClient.from('users').update({ role: 'volunteer' }).eq('id', userId);
    showToast("Promoted", "success");
    loadUsersList();
}

// --- UTILS ---
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

// Inject Toast HTML
function injectToastContainer() {
    if(!document.getElementById('toast-container')) {
        const div = document.createElement('div');
        div.id = 'toast-container';
        div.className = 'fixed bottom-10 left-1/2 transform -translate-x-1/2 z-[70] transition-all duration-300 opacity-0 pointer-events-none translate-y-10';
        div.innerHTML = `
            <div id="toast-content" class="bg-gray-900 text-white px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3">
                <div id="toast-icon"></div>
                <p id="toast-text" class="text-sm font-bold"></p>
            </div>`;
        document.body.appendChild(div);
    }
}

function showToast(msg, type) {
    const t = document.getElementById('toast-container');
    const txt = document.getElementById('toast-text');
    const icon = document.getElementById('toast-icon');
    
    txt.innerText = msg;
    icon.innerHTML = type === 'error' ? '<i data-lucide="alert-circle" class="w-5 h-5 text-red-400"></i>' : '<i data-lucide="check-circle" class="w-5 h-5 text-green-400"></i>';
    
    lucide.createIcons();
    t.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10');
    setTimeout(() => t.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10'), 3000);
}
