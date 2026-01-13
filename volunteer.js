// --- CONFIGURATION ---
const supabaseClient = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
let currentUser = null;
let currentSportId = null;
let allMatchesCache = []; 
let currentLiveMatchId = null; 

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
        return 0;
    });

    renderMatches(allMatchesCache);
    
    // Auto-refresh full view if open
    if(currentLiveMatchId) {
        const match = allMatchesCache.find(m => m.id === currentLiveMatchId);
        if(match) updateLivePanelUI(match);
    }
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
        
        // LIVE CARD
        if (isLive) {
            return `
            <div onclick="openMatchPanel('${m.id}')" class="bg-white p-5 rounded-3xl border border-green-500 shadow-xl shadow-green-100 relative overflow-hidden cursor-pointer active:scale-[0.98] transition-all group">
                <div class="absolute top-0 left-0 w-full bg-green-500 text-white text-[10px] font-bold text-center py-1 uppercase tracking-widest animate-pulse">Live Now</div>
                <div class="mt-5 flex justify-between items-center px-1">
                    <div class="text-center w-1/3">
                        <h4 class="font-bold text-base text-gray-900 leading-tight line-clamp-1">${m.team1_name}</h4>
                        <span class="text-2xl font-black text-brand-primary block mt-1">${m.score1 || 0}</span>
                    </div>
                    <span class="text-gray-300 font-black text-xs">VS</span>
                    <div class="text-center w-1/3">
                        <h4 class="font-bold text-base text-gray-900 leading-tight line-clamp-1">${m.team2_name}</h4>
                        <span class="text-2xl font-black text-brand-primary block mt-1">${m.score2 || 0}</span>
                    </div>
                </div>
                <div class="mt-4 text-center">
                    <span class="inline-flex items-center gap-1 text-[10px] font-bold text-green-700 bg-green-50 px-3 py-1.5 rounded-full border border-green-100">
                        Tap to Score <i data-lucide="arrow-right" class="w-3 h-3"></i>
                    </span>
                </div>
            </div>`;
        } 
        
        // SCHEDULED CARD
        else {
            return `
            <div class="bg-white p-5 rounded-3xl border border-gray-100 shadow-sm relative transition-all">
                <div class="flex justify-between items-center mb-4">
                    <span class="bg-gray-100 text-gray-500 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wide">Round ${m.round_number}</span>
                    <span class="text-xs font-bold text-gray-400">${startTime}</span>
                </div>
                <div class="flex justify-between items-center mb-5 px-1">
                    <h4 class="font-bold text-base text-gray-900 w-5/12 truncate">${m.team1_name}</h4>
                    <span class="text-gray-300 font-black text-xs">VS</span>
                    <h4 class="font-bold text-base text-gray-900 w-5/12 text-right truncate">${m.team2_name}</h4>
                </div>
                <button onclick="startMatch('${m.id}')" class="w-full py-3 bg-black text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all text-xs">
                    Start Match
                </button>
            </div>`;
        }
    }).join('');
    
    lucide.createIcons();
}

// --- FULL VIEW MATCH PANEL (VERTICAL STACK FIX) ---

window.openMatchPanel = function(matchId) {
    const match = allMatchesCache.find(m => m.id === matchId);
    if(!match) return;

    currentLiveMatchId = matchId;
    const content = document.getElementById('live-match-content');
    
    // Initial Render
    content.innerHTML = generateMatchHTML(match);
    document.getElementById('modal-live-match').classList.remove('hidden');
    lucide.createIcons();
}

function updateLivePanelUI(match) {
    const content = document.getElementById('live-match-content');
    if (!document.getElementById('modal-live-match').classList.contains('hidden')) {
        content.innerHTML = generateMatchHTML(match);
        lucide.createIcons();
    }
}

function generateMatchHTML(match) {
    const t1Init = match.team1_name.charAt(0).toUpperCase();
    const t2Init = match.team2_name.charAt(0).toUpperCase();

    return `
        <div class="flex flex-col gap-6 mb-8 w-full max-w-sm mx-auto">
            
            <div class="bg-white p-5 rounded-3xl shadow-lg border border-indigo-50 flex flex-col items-center w-full">
                <div class="w-12 h-12 bg-indigo-100 text-brand-primary rounded-full flex items-center justify-center font-black text-xl mb-3 shadow-inner">${t1Init}</div>
                <h4 class="font-bold text-lg text-center leading-tight w-full mb-3 text-gray-900 truncate px-2">${match.team1_name}</h4>
                
                <span class="text-6xl font-black text-brand-primary tracking-tighter mb-5">${match.score1 || 0}</span>
                
                <div class="flex gap-3 w-full px-2">
                    <button onclick="updateScore('${match.id}', 'score1', -1, ${match.score1})" class="flex-1 py-3 bg-gray-100 rounded-2xl text-gray-500 font-bold text-2xl active:scale-95 transition-transform">-</button>
                    <button onclick="updateScore('${match.id}', 'score1', 1, ${match.score1})" class="flex-[2] py-3 bg-brand-primary text-white rounded-2xl font-bold text-3xl shadow-lg shadow-indigo-200 active:scale-95 transition-transform">+</button>
                </div>
            </div>

            <div class="relative flex items-center justify-center py-2">
                <div class="h-px bg-gray-300 w-full absolute"></div>
                <span class="relative bg-white text-gray-400 font-black text-xs px-4 py-1.5 rounded-full uppercase tracking-widest z-10 border border-gray-200 shadow-sm">VS</span>
            </div>

            <div class="bg-white p-5 rounded-3xl shadow-lg border border-pink-50 flex flex-col items-center w-full">
                <div class="w-12 h-12 bg-pink-100 text-pink-600 rounded-full flex items-center justify-center font-black text-xl mb-3 shadow-inner">${t2Init}</div>
                <h4 class="font-bold text-lg text-center leading-tight w-full mb-3 text-gray-900 truncate px-2">${match.team2_name}</h4>
                
                <span class="text-6xl font-black text-pink-600 tracking-tighter mb-5">${match.score2 || 0}</span>
                
                <div class="flex gap-3 w-full px-2">
                    <button onclick="updateScore('${match.id}', 'score2', -1, ${match.score2})" class="flex-1 py-3 bg-gray-100 rounded-2xl text-gray-500 font-bold text-2xl active:scale-95 transition-transform">-</button>
                    <button onclick="updateScore('${match.id}', 'score2', 1, ${match.score2})" class="flex-[2] py-3 bg-pink-600 text-white rounded-2xl font-bold text-3xl shadow-lg shadow-pink-200 active:scale-95 transition-transform">+</button>
                </div>
            </div>
        </div>

        <div class="space-y-6 w-full max-w-sm mx-auto pb-10">
            
            <button onclick="declareWalkover('${match.id}')" class="w-full py-4 border-2 border-red-50 bg-white text-red-500 font-bold rounded-2xl text-xs uppercase tracking-wide hover:bg-red-50 transition-colors flex items-center justify-center gap-2 shadow-sm">
                <i data-lucide="user-x" class="w-4 h-4"></i> Declare Walkover (Absent)
            </button>

            <div class="p-6 bg-gray-900 rounded-[2rem] shadow-2xl relative overflow-hidden">
                <div class="absolute top-0 right-0 w-24 h-24 bg-gray-800 rounded-full -mr-10 -mt-10 opacity-50"></div>
                
                <label class="text-[10px] font-bold text-gray-400 uppercase mb-4 block tracking-wide ml-1">Finish Match</label>
                
                <select id="winner-select-${match.id}" onchange="enableEndBtn('${match.id}')" class="w-full p-4 bg-gray-800 text-white border border-gray-700 rounded-2xl text-base font-bold outline-none focus:border-brand-primary mb-5 appearance-none cursor-pointer">
                    <option value="" class="text-gray-500">Select Official Winner...</option>
                    <option value="${match.team1_id}">${match.team1_name}</option>
                    <option value="${match.team2_id}">${match.team2_name}</option>
                </select>

                <button id="btn-end-${match.id}" onclick="endMatch('${match.id}')" disabled class="w-full py-4 bg-gray-700 text-gray-500 font-bold rounded-2xl cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-inner">
                    <i data-lucide="trophy" class="w-5 h-5"></i> End Match & Save
                </button>
            </div>
        </div>
    `;
}

window.closeMatchPanel = function() {
    document.getElementById('modal-live-match').classList.add('hidden');
    currentLiveMatchId = null;
    loadAssignedMatches(); 
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
            await loadAssignedMatches(); 
            openMatchPanel(matchId); 
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
    else loadAssignedMatches(); 
}

window.enableEndBtn = function(matchId) {
    const select = document.getElementById(`winner-select-${matchId}`);
    const btn = document.getElementById(`btn-end-${matchId}`);
    if(!select || !btn) return;

    if (select.value) {
        btn.disabled = false;
        btn.classList.remove('bg-gray-700', 'text-gray-500', 'cursor-not-allowed');
        btn.classList.add('bg-brand-primary', 'text-white', 'shadow-xl', 'active:scale-95');
    } else {
        btn.disabled = true;
        btn.classList.add('bg-gray-700', 'text-gray-500', 'cursor-not-allowed');
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
            closeMatchPanel();
        }
    });
}

window.declareWalkover = function(matchId) {
    // 1. Close Modal Immediately when they click Yes
    showConfirmDialog("Declare Walkover?", "Is the opponent absent? You will need to select the PRESENT team as the winner.", () => {
        closeModal('modal-confirm');
        
        // 2. Scroll to Bottom
        const content = document.getElementById('live-match-content');
        if(content) content.scrollTop = content.scrollHeight;
        
        // 3. Highlight Dropdown
        const select = document.getElementById(`winner-select-${matchId}`);
        if(select) {
            select.focus();
            select.classList.add('ring-4', 'ring-green-500'); // Visual cue
            setTimeout(() => select.classList.remove('ring-4', 'ring-green-500'), 2000);
        }
        
        // 4. Show Toast
        showToast("Please select the Winner below to finish.", "info");
    });
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
