// --- CONFIGURATION ---
const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
let currentUser = null;
let currentMatchId = null;

// --- GLOBAL VARS FOR SEARCH ---
let currentRaceData = []; 
let currentUnit = ''; 
let currentMatchIdLocal = '';

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    await checkVolunteerAuth();
});

// --- 1. AUTH CHECK & ASSIGNMENT ---
async function checkVolunteerAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    const { data: user } = await supabaseClient
        .from('users')
        .select('role, first_name, last_name, assigned_sport_id, assigned_sport:sports!assigned_sport_id(name)')
        .eq('id', session.user.id)
        .single();

    if (!user || (user.role !== 'volunteer' && user.role !== 'admin')) {
        alert("Access Denied: Volunteers Only");
        window.location.href = 'student.html';
        return;
    }
    
    currentUser = user;
    document.getElementById('vol-name-display').innerText = `Welcome, ${user.first_name}`;
    
    if (user.assigned_sport) {
        document.getElementById('vol-sport-name').innerText = user.assigned_sport.name;
        document.getElementById('vol-sport-cat').innerText = "Assigned";
        document.getElementById('sport-card').classList.remove('hidden');
    } else {
        document.getElementById('vol-sport-name').innerText = "No Assignment";
        document.getElementById('sport-card').classList.add('hidden');
    }
    
    loadVolunteerMatches();
}

function volunteerLogout() {
    supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

// --- 2. MATCH LISTING ---
async function loadVolunteerMatches() {
    const container = document.getElementById('vol-match-list');
    container.innerHTML = '<div class="flex flex-col items-center justify-center py-10 text-gray-400"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary mb-2"></div><p class="text-sm">Fetching assignments...</p></div>';

    let query = supabaseClient
        .from('matches')
        .select('*, sports(name, type, is_performance, unit)')
        .neq('status', 'Completed') 
        .order('start_time', { ascending: true });

    if (currentUser.assigned_sport_id) {
        query = query.eq('sport_id', currentUser.assigned_sport_id);
    }

    const { data: matches } = await query;

    if (!matches || matches.length === 0) {
        container.innerHTML = '<div class="text-center py-10"><p class="text-gray-400 font-bold">No active events found.</p></div>';
        return;
    }

    container.innerHTML = matches.map(m => {
        const isPerf = m.sports.is_performance;
        
        return `
        <div onclick="openMatchInterface('${m.id}')" class="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm relative overflow-hidden group active:scale-[0.98] transition-transform cursor-pointer">
            <div class="absolute top-0 left-0 w-1 h-full ${m.status === 'Live' ? 'bg-green-500' : 'bg-indigo-500'}"></div>
            
            <div class="flex justify-between items-start mb-3 pl-3">
                <span class="text-[10px] font-bold uppercase tracking-widest text-gray-400">${m.sports.name}</span>
                <span class="px-2 py-1 rounded text-[10px] font-bold uppercase ${m.status === 'Live' ? 'bg-green-100 text-green-700 animate-pulse' : 'bg-gray-100 text-gray-500'}">${m.status}</span>
            </div>

            <div class="pl-3">
                ${isPerf ? 
                    `<h4 class="font-black text-gray-900 text-lg leading-tight">PERFORMANCE ENTRY</h4>`
                : 
                    `<div class="flex justify-between items-center text-center">
                        <h4 class="font-black text-gray-900 text-base leading-tight w-1/3 text-left truncate">${m.team1_name}</h4>
                        <div class="text-xs font-bold text-gray-300">VS</div>
                        <h4 class="font-black text-gray-900 text-base leading-tight w-1/3 text-right truncate">${m.team2_name}</h4>
                    </div>
                    <div class="mt-3 pt-3 border-t border-gray-50 flex justify-between text-xs font-bold text-brand-primary">
                        <span>Score: ${m.score1 || 0}</span>
                        <span>Score: ${m.score2 || 0}</span>
                    </div>`
                }
            </div>
        </div>
    `}).join('');
}

// --- 3. INTERFACE ROUTER ---
window.openMatchInterface = async function(matchId) {
    currentMatchId = matchId;
    
    const { data: match } = await supabaseClient
        .from('matches')
        .select('*, sports(is_performance, unit)')
        .eq('id', matchId)
        .single();

    if (match.sports.is_performance) {
        renderRaceTable(match);
    } else {
        renderScoreboard(match);
    }
}

// --- 4. RACE LOGIC (Search & Edit) ---
function renderRaceTable(match) {
    currentRaceData = match.performance_data || []; 
    currentUnit = match.sports.unit || 'Points';
    currentMatchIdLocal = match.id;

    const searchInput = document.getElementById('race-search-input');
    if(searchInput) searchInput.value = '';

    renderRaceRows(currentRaceData);
    document.getElementById('modal-race-entry').classList.remove('hidden');
}

window.filterRaceList = function(term) {
    const lowerTerm = term.toLowerCase();
    const filtered = currentRaceData.filter(p => p.name.toLowerCase().includes(lowerTerm));
    renderRaceRows(filtered);
}

function renderRaceRows(dataArray) {
    const container = document.getElementById('race-rows-container');

    if(dataArray.length === 0) {
        container.innerHTML = '<p class="text-center text-gray-400 py-10">No participants found.</p>';
    } else {
        container.innerHTML = dataArray.map((p) => {
            const realIndex = currentRaceData.indexOf(p);
            return `
            <div class="flex items-center gap-3 mb-2 p-3 bg-gray-50 rounded-xl border border-gray-100">
                <span class="font-bold text-gray-400 w-6 text-center">${realIndex + 1}</span>
                <div class="flex-1 min-w-0">
                    <p class="font-bold text-sm text-gray-800 truncate">${p.name}</p>
                    <p class="text-[10px] text-gray-400 uppercase">${p.id.split('-')[0] || 'ID'}</p>
                </div>
                <div class="relative">
                    <input type="text" placeholder="0.00" 
                        class="w-24 p-2 bg-white border border-gray-200 rounded-lg text-right font-mono font-bold text-sm outline-none focus:border-brand-primary"
                        value="${p.result || ''}" 
                        onchange="updateRaceData('${currentMatchIdLocal}', ${realIndex}, this.value)">
                </div>
            </div>
        `}).join('');
    }
}

async function updateRaceData(matchId, index, value) {
    currentRaceData[index].result = value;
    const { error } = await supabaseClient.from('matches').update({ performance_data: currentRaceData }).eq('id', matchId);
    if(error) showToast("Save failed!", "error"); else showToast("Saved", "success");
}

// --- 5. SCOREBOARD LOGIC (TOURNAMENTS) ---
function renderScoreboard(match) {
    document.getElementById('score-modal-round').innerText = match.sports.name;
    document.getElementById('score-p1-name').innerText = match.team1_name;
    document.getElementById('score-p2-name').innerText = match.team2_name;
    document.getElementById('score-input-p1').value = match.score1 || 0;
    document.getElementById('score-input-p2').value = match.score2 || 0;

    // Populate Dropdown for Winner Selection
    const select = document.getElementById('winner-select');
    select.innerHTML = `
        <option value="">-- Select Official Winner --</option>
        <option value="${match.team1_id}">${match.team1_name}</option>
        <option value="${match.team2_id}">${match.team2_name}</option>
    `;

    // Add Walkover Button Logic
    // We check if we need to insert a button, avoid duplicates
    let woBtn = document.getElementById('btn-walkover');
    if(!woBtn) {
        woBtn = document.createElement('button');
        woBtn.id = 'btn-walkover';
        woBtn.className = "w-full py-2 mt-2 text-xs font-bold text-red-500 bg-red-50 rounded-lg hover:bg-red-100";
        woBtn.innerText = "Declare Walkover (Opponent Absent)";
        woBtn.onclick = () => declareWalkover(match);
        document.querySelector('#modal-score .flex-1').appendChild(woBtn);
    } else {
        woBtn.onclick = () => declareWalkover(match);
    }

    document.getElementById('modal-score').classList.remove('hidden');
}

window.adjustScore = function(team, delta) {
    const input = document.getElementById(`score-input-${team}`);
    let val = parseInt(input.value) || 0;
    val = Math.max(0, val + delta); 
    input.value = val;
}

// STRICT END MATCH LOGIC
window.updateMatchScore = async function(isFinal) {
    const s1 = document.getElementById('score-input-p1').value;
    const s2 = document.getElementById('score-input-p2').value;
    const winnerId = document.getElementById('winner-select').value;
    const winnerName = document.getElementById('winner-select').options[document.getElementById('winner-select').selectedIndex]?.text;

    if (isFinal && !winnerId) {
        return alert("⚠️ You MUST select a winner to end the match.");
    }

    const updates = {
        score1: s1,
        score2: s2,
        status: isFinal ? 'Completed' : 'Live',
        is_live: !isFinal 
    };

    if (isFinal) {
        updates.winner_id = winnerId;
        updates.winner_text = winnerName + " Won";
    }

    const { error } = await supabaseClient.from('matches').update(updates).eq('id', currentMatchId);

    if(error) showToast(error.message, "error");
    else {
        showToast(isFinal ? "Match Ended!" : "Score Updated!", "success");
        closeModal('modal-score');
        loadVolunteerMatches();
    }
}

// WALKOVER LOGIC (Instant Win)
window.declareWalkover = async function(match) {
    const winnerId = prompt(`Who is present? Enter 1 for ${match.team1_name}, 2 for ${match.team2_name}`);
    
    let finalWinnerId = null;
    let finalText = "";

    if (winnerId === '1') {
        finalWinnerId = match.team1_id;
        finalText = `${match.team1_name} (Walkover)`;
    } else if (winnerId === '2') {
        finalWinnerId = match.team2_id;
        finalText = `${match.team2_name} (Walkover)`;
    } else {
        return; // Cancelled
    }

    if (!confirm(`Declare ${finalText}? This ends the match immediately.`)) return;

    const { error } = await supabaseClient.from('matches').update({
        status: 'Completed',
        is_live: false,
        winner_id: finalWinnerId,
        winner_text: finalText,
        is_walkover: true,
        score1: 'W',
        score2: 'L' // Simple visual indicator
    }).eq('id', currentMatchId);

    if(error) showToast("Error", "error");
    else {
        showToast("Walkover Declared", "success");
        closeModal('modal-score');
        loadVolunteerMatches();
    }
}

// --- UTILS ---
window.closeModal = (id) => document.getElementById(id).classList.add('hidden');

function showToast(msg, type) {
    const t = document.getElementById('toast-container');
    const content = document.getElementById('toast-content');
    const txt = document.getElementById('toast-text');
    const icon = document.getElementById('toast-icon');

    if (type === 'success') {
        content.classList.remove('bg-gray-900', 'bg-red-500');
        content.classList.add('bg-green-600');
        icon.innerHTML = '<i data-lucide="check-circle" class="w-5 h-5"></i>';
    } else {
        content.classList.remove('bg-green-600', 'bg-red-500');
        content.classList.add('bg-gray-900');
        icon.innerHTML = '<i data-lucide="info" class="w-5 h-5"></i>';
    }

    txt.innerText = msg;
    lucide.createIcons();

    t.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-20');
    setTimeout(() => t.classList.add('opacity-0', 'pointer-events-none', 'translate-y-20'), 3000);
}
