// --- CONFIGURATION ---
const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
let currentUser = null;
let currentSportId = null;
let allMatchesCache = []; 
let currentLiveMatchId = null; // Track active match in full view

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    lucide.createIcons();
    setupConfirmModal();
    await checkAuth();
});

// --- AUTHENTICATION ---
async function checkAuth() {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) { window.location.href = 'login.html'; return; }

    const { data: user } = await supabaseClient
        .from('users')
        .select('*, assigned_sport:sports!assigned_sport_id(id, name, type)')
        .eq('id', session.user.id)
        .single();

    if (!user || user.role !== 'volunteer') {
        window.location.href = 'login.html';
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
        showToast("Contact Admin to assign a sport.", "error");
    }
}

function logout() {
    supabaseClient.auth.signOut();
    window.location.href = 'login.html';
}

// --- MATCH MANAGEMENT ---
async function loadAssignedMatches() {
    const container = document.getElementById('matches-container');
    if (container && allMatchesCache.length === 0) container.innerHTML = '<div class="text-center py-10"><div class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-primary mx-auto"></div></div>';

    const { data: matches, error } = await supabaseClient
        .from('matches')
        .select('*')
        .eq('sport_id', currentSportId)
        .neq('status', 'Completed') 
        .order('start_time', { ascending: true });

    if (error) return showToast(error.message, "error");

    // SORT: Live matches first
    allMatchesCache = matches || [];
    allMatchesCache.sort((a, b) => {
        if (a.status === 'Live' && b.status !== 'Live') return -1;
        if (a.status !== 'Live' && b.status === 'Live') return 1;
        return 0; // Keep original time sort
    });

    renderMatches(allMatchesCache);
}

// --- FILTER / SEARCH ---
window.filterMatches = function() {
    const query = document.getElementById('match-search').value.toLowerCase();
    const filtered = allMatchesCache.filter(m => 
        (m.team1_name && m.team1_name.toLowerCase().includes(query)) ||
        (m.team2_name && m.team2_name.toLowerCase().includes(query))
    );
    renderMatches(filtered);
}

// --- RENDER LIST ---
function renderMatches(matches) {
    const container = document.getElementById('matches-container');
    if (!container) return;

    if (!matches || matches.length === 0) {
        container.innerHTML = `
            <div class="text-center p-8 bg-white rounded-2xl border border-dashed border-gray-300">
                <i data-lucide="clipboard-x" class="w-8 h-8 text-gray-300 mx-auto mb-2"></i>
                <p class="text-gray-400 font-bold text-sm">No active matches found.</p>
            </div>`;
        lucide.createIcons();
        return;
    }

    container.innerHTML = matches.map(m => {
        const isLive = m.status === 'Live';
        const startTime = new Date(m.start_time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
        
        // LIVE MATCH CARD (Prioritized)
        if (isLive) {
            return `
            <div onclick="openMatchPanel('${m.id}')" class="bg-white p-5 rounded-[1.5rem] border-2 border-green-500 shadow-xl shadow-green-50 relative overflow-hidden cursor-pointer active:scale-[0.98] transition-all group">
                <div class="absolute top-0 left-0 w-full bg-green-500 text-white text-[10px] font-bold text-center py-1 uppercase tracking-widest animate-pulse">
                    Tap to Manage
                </div>
                
                <div class="mt-6 flex justify-between items-center px-2">
                    <div class="text-center w-5/12">
                        <h4 class="font-bold text-lg text-gray-900 leading-tight line-clamp-1">${m.team1_name}</h4>
                        <span class="text-2xl font-black text-brand-primary block mt-1">${m.score1 || 0}</span>
                    </div>
                    <span class="text-gray-300 font-black text-xs">VS</span>
                    <div class="text-center w-5/12">
                        <h4 class="font-bold text-lg text-gray-900 leading-tight line-clamp-1">${m.team2_name}</h4>
                        <span class="text-2xl font-black text-brand-primary block mt-1">${m.score2 || 0}</span>
                    </div>
                </div>
                
                <div class="mt-4 text-center">
                    <span class="inline-flex items-center gap-1 text-xs font-bold text-green-600 bg-green-50 px-3 py-1.5 rounded-full group-hover:bg-green-100 transition-colors">
                        <i data-lucide="maximize-2" class="w-3 h-3"></i> Open Controls
                    </span>
                </div>
            </div>`;
        } 
        
        // SCHEDULED MATCH CARD
        else {
            return `
            <div class="bg-white p-5 rounded-[1.5rem] border border-gray-100 shadow-sm relative transition-all hover:shadow-md">
                <div class="flex justify-between items-start mb-4">
                    <span class="bg-gray-100 text-gray-500 text-[10px] font-bold px-2.5 py-1 rounded-lg uppercase tracking-wide">Round ${m.round_number}</span>
                    <span class="text-xs font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded-lg">${startTime}</span>
                </div>
                
                <div class="flex justify-between items-center mb-6 px-1">
                    <h4 class="font-bold text-lg text-gray-900 w-5/12 truncate" title="${m.team1_name}">${m.team1_name}</h4>
                    <span class="text-gray-300 font-black text-xs px-2">VS</span>
                    <h4 class="font-bold text-lg text-gray-900 w-5/12 text-right truncate" title="${m.team2_name}">${m.team2_name}</h4>
                </div>

                <button onclick="startMatch('${m.id}')" class="w-full py-3.5 bg-black text-white font-bold rounded-xl shadow-lg shadow-gray-200 active:scale-95 transition-all">
                    Start Match
                </button>
            </div>`;
        }
    }).join('');
    
    lucide.createIcons();
}

// --- FULL VIEW MATCH PANEL LOGIC ---

window.openMatchPanel = function(matchId) {
    const match = allMatchesCache.find(m => m.id === matchId);
    if(!match) return;

    currentLiveMatchId = matchId;
    const content = document.getElementById('live-match-content');
    
    // Inject HTML for Full View
    content.innerHTML = `
        <div class="text-center mb-8">
            <span class="bg-gray-100 text-gray-500 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wide">Round ${match.round_number}</span>
        </div>

        <div class="flex justify-between items-start gap-4 mb-8">
            <div class="flex-1 flex flex-col items-center bg-white p-4 rounded-3xl border border-gray-100 shadow-sm">
                <div class="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-brand-primary font-black text-xl mb-3">A</div>
                <h4 class="font-bold text-base text-center leading-tight mb-4 h-10 flex items-center justify-center w-full overflow-hidden text-ellipsis">${match.team1_name}</h4>
                
                <div class="flex items-center gap-4 w-full justify-between bg-gray-50 p-2 rounded-2xl">
                    <button onclick="updateScore('${match.id}', 'score1', -1, ${match.score1})" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-500 shadow-sm flex items-center justify-center font-bold text-xl active:scale-90 transition-transform">-</button>
                    <span id="score1-display" class="text-4xl font-black text-gray-900 tabular-nums">${match.score1 || 0}</span>
                    <button onclick="updateScore('${match.id}', 'score1', 1, ${match.score1})" class="w-10 h-10 rounded-xl bg-black text-white shadow-lg flex items-center justify-center font-bold text-xl active:scale-90 transition-transform">+</button>
                </div>
            </div>

            <div class="pt-20">
                <span class="text-gray-300 font-black text-sm">VS</span>
            </div>

            <div class="flex-1 flex flex-col items-center bg-white p-4 rounded-3xl border border-gray-100 shadow-sm">
                <div class="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-brand-primary font-black text-xl mb-3">B</div>
                <h4 class="font-bold text-base text-center leading-tight mb-4 h-10 flex items-center justify-center w-full overflow-hidden text-ellipsis">${match.team2_name}</h4>
                
                <div class="flex items-center gap-4 w-full justify-between bg-gray-50 p-2 rounded-2xl">
                    <button onclick="updateScore('${match.id}', 'score2', -1, ${match.score2})" class="w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-500 shadow-sm flex items-center justify-center font-bold text-xl active:scale-90 transition-transform">-</button>
                    <span id="score2-display" class="text-4xl font-black text-gray-900 tabular-nums">${match.score2 || 0}</span>
                    <button onclick="updateScore('${match.id}', 'score2', 1, ${match.score2})" class="w-10 h-10 rounded-xl bg-black text-white shadow-lg flex items-center justify-center font-bold text-xl active:scale-90 transition-transform">+</button>
                </div>
            </div>
        </div>

        <div class="space-y-4">
            <button onclick="declareWalkover('${match.id}')" class="w-full py-4 border border-red-100 bg-white text-red-500 font-bold rounded-2xl text-sm shadow-sm hover:bg-red-50 transition-colors flex items-center justify-center gap-2">
                <i data-lucide="user-x" class="w-4 h-4"></i> Opponent Absent? Declare Walkover
            </button>

            <div class="p-5 bg-white rounded-3xl border border-gray-100 shadow-lg mt-6">
                <label class="text-xs font-bold text-gray-400 uppercase mb-3 block tracking-wide ml-1">Declare Official Winner</label>
                <select id="winner-select-${match.id}" onchange="enableEndBtn('${match.id}')" class="w-full p-4 bg-gray-50 border-none rounded-xl text-base font-bold outline-none focus:ring-2 focus:ring-brand-primary/20 transition-all cursor-pointer mb-4">
                    <option value="">-- Tap to Select Winner --</option>
                    <option value="${match.team1_id}">${match.team1_name}</option>
                    <option value="${match.team2_id}">${match.team2_name}</option>
                </select>

                <button id="btn-end-${match.id}" onclick="endMatch('${match.id}')" disabled class="w-full py-4 bg-gray-200 text-gray-400 font-bold rounded-xl cursor-not-allowed transition-all flex items-center justify-center gap-2">
                    <i data-lucide="trophy" class="w-5 h-5"></i> End Match & Save Result
                </button>
            </div>
        </div>
    `;

    document.getElementById('modal-live-match').classList.remove('hidden');
    lucide.createIcons();
}

window.closeMatchPanel = function() {
    document.getElementById('modal-live-match').classList.add('hidden');
    currentLiveMatchId = null;
    loadAssignedMatches(); // Refresh list to update scores on cards
}

// --- ACTIONS ---

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
            await loadAssignedMatches(); // Reload to sort
            openMatchPanel(matchId); // Auto-open full view
        }
    });
}

window.updateScore = async function(matchId, scoreField, delta, currentVal) {
    const newVal = Math.max(0, (currentVal || 0) + delta);
    
    // 1. Optimistic UI Update (Full View)
    const displayId = scoreField + '-display';
    const displayEl = document.getElementById(displayId);
    if(displayEl) displayEl.innerText = newVal;

    // 2. Update Cache (for re-renders)
    const match = allMatchesCache.find(m => m.id === matchId);
    if(match) match[scoreField] = newVal;

    // 3. Update DB
    const { error } = await supabaseClient
        .from('matches')
        .update({ [scoreField]: newVal })
        .eq('id', matchId);

    if (error) showToast("Sync Error", "error");
}

window.enableEndBtn = function(matchId) {
    const select = document.getElementById(`winner-select-${matchId}`);
    const btn = document.getElementById(`btn-end-${matchId}`);
    
    if (select.value) {
        btn.disabled = false;
        btn.classList.remove('bg-gray-200', 'text-gray-400', 'cursor-not-allowed');
        btn.classList.add('bg-black', 'text-white', 'shadow-xl', 'active:scale-95', 'hover:opacity-90');
    } else {
        btn.disabled = true;
        btn.classList.add('bg-gray-200', 'text-gray-400', 'cursor-not-allowed');
        btn.classList.remove('bg-black', 'text-white', 'shadow-xl', 'active:scale-95', 'hover:opacity-90');
    }
}

window.endMatch = function(matchId) {
    const select = document.getElementById(`winner-select-${matchId}`);
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
            closeMatchPanel();
        }
    });
}

window.declareWalkover = function(matchId) {
    showConfirmDialog("Declare Walkover?", "Is the opponent absent? You will need to select the PRESENT team as the winner.", () => {
        closeModal('modal-confirm');
        showToast("Select the present team as Winner below", "info");
    });
}

// --- UTILS: CONFIRM MODAL & TOAST ---

let confirmCallback = null;

function setupConfirmModal() {
    const btnYes = document.getElementById('btn-confirm-yes');
    const btnCancel = document.getElementById('btn-confirm-cancel');
    
    if(btnYes) btnYes.onclick = () => confirmCallback && confirmCallback();
    if(btnCancel) btnCancel.onclick = () => { closeModal('modal-confirm'); confirmCallback = null; };
}

function showConfirmDialog(title, msg, onConfirm) {
    document.getElementById('confirm-title').innerText = title;
    document.getElementById('confirm-msg').innerText = msg;
    confirmCallback = onConfirm;
    
    const modal = document.getElementById('modal-confirm');
    if(modal) modal.classList.remove('hidden');
}

function closeModal(id) {
    const el = document.getElementById(id);
    if(el) el.classList.add('hidden');
}

function showToast(msg, type) {
    const t = document.getElementById('toast-container');
    const txt = document.getElementById('toast-msg');
    const icon = document.getElementById('toast-icon');
    const content = document.getElementById('toast-content');
    
    if(!t || !txt) return; 

    txt.innerText = msg;
    content.className = 'bg-gray-900 text-white px-5 py-4 rounded-2xl shadow-2xl flex items-center gap-4 backdrop-blur-md border border-gray-700/50';
    
    if (type === 'error') {
        icon.innerHTML = '<i data-lucide="alert-triangle" class="w-5 h-5 text-red-400"></i>';
        content.classList.add('border-red-500/30'); 
    } else {
        icon.innerHTML = '<i data-lucide="check-circle" class="w-5 h-5 text-green-400"></i>';
        content.classList.add('border-green-500/30');
    }
    
    lucide.createIcons();
    t.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-10');
    
    setTimeout(() => {
        t.classList.add('opacity-0', 'pointer-events-none', 'translate-y-10');
    }, 3000);
}
