// --- CONFIGURATION & STATE ---
let currentView = 'dashboard';
let bracketData = []; // Store current bracket matches for export
const ROUND_ORDER = {
    "round of 64": 1,
    "round of 32": 2,
    "round of 16": 3,
    "quarter-finals": 4, "quarter finals": 4, "quarter final": 4,
    "semi-finals": 5, "semi finals": 5, "semi final": 5,
    "finals": 6, "final": 6
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    checkAuth();
    loadDashboardStats();
    setupEventListeners();
    
    // Initial fetch for dropdowns
    await fetchSportsForDropdowns();
});

function checkAuth() {
    const session = localStorage.getItem('admin_session');
    if (!session) window.location.href = 'index.html';
}

function adminLogout() {
    localStorage.removeItem('admin_session');
    window.location.href = 'index.html';
}

// --- NAVIGATION ---
function switchView(viewId) {
    // Hide all views
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    // Show selected view
    document.getElementById(`view-${viewId}`).classList.remove('hidden');
    document.getElementById(`nav-${viewId}`).classList.add('active');
    
    // Update Title
    const titles = {
        'dashboard': 'Dashboard',
        'sports': 'Manage Sports',
        'matches': 'Schedule & Matches',
        'brackets': 'Tournament Brackets',
        'manual-schedule': 'Manual Schedule'
    };
    document.getElementById('page-title').innerText = titles[viewId];

    // Show/Hide Global Actions
    const globalActions = document.getElementById('global-actions');
    if (viewId === 'brackets') {
        globalActions.classList.add('hidden'); // Brackets has its own toolbar
        loadBracketView(); // Initialize bracket dropdowns
    } else {
        globalActions.classList.add('hidden');
    }

    currentView = viewId;
}

function setupEventListeners() {
    // Window resize connector redraw
    window.addEventListener('resize', () => {
        if(currentView === 'brackets') drawConnectors();
    });
}

// --- 1. DASHBOARD LOGIC ---
async function loadDashboardStats() {
    try {
        // Fetch counts (Approximate/Real based on table size)
        const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: regCount } = await supabase.from('registrations').select('*', { count: 'exact', head: true });
        const { count: teamCount } = await supabase.from('teams').select('*', { count: 'exact', head: true });

        document.getElementById('dash-total-users').innerText = userCount || 0;
        document.getElementById('dash-total-regs').innerText = regCount || 0;
        document.getElementById('dash-total-teams').innerText = teamCount || 0;
    } catch (e) {
        console.error("Stats error", e);
    }
}

// --- 2. BRACKET LOGIC (NEW) ---

async function fetchSportsForDropdowns() {
    try {
        // Get unique sports from matches table
        const { data, error } = await supabase
            .from('matches')
            .select('sport_name');
        
        if (error) throw error;

        // Unique set
        const sports = [...new Set(data.map(item => item.sport_name))].sort();
        
        // Populate Bracket Dropdown
        const bracketSelect = document.getElementById('bracket-sport');
        const manualSelect = document.getElementById('manual-sport');
        
        // Clear existing options (keep first placeholder)
        bracketSelect.innerHTML = '<option value="">Select Sport</option>';
        manualSelect.innerHTML = '<option value="">-- Choose Sport --</option>';

        sports.forEach(sport => {
            bracketSelect.innerHTML += `<option value="${sport}">${sport}</option>`;
            manualSelect.innerHTML += `<option value="${sport}">${sport}</option>`;
        });

    } catch (err) {
        console.error("Error fetching sports:", err);
    }
}

async function loadBracketView() {
    // Just ensures dropdowns are ready. logic is in fetchSportsForDropdowns
}

async function loadBracket() {
    const sport = document.getElementById('bracket-sport').value;
    const category = document.getElementById('bracket-category').value; // Junior / Degree
    const gender = document.getElementById('bracket-gender').value;     // Male / Female

    if (!sport) {
        showToast('error', 'Please select a sport');
        return;
    }

    const root = document.getElementById('bracket-root');
    root.innerHTML = '<div class="flex items-center justify-center w-full h-64"><p class="animate-pulse font-bold text-indigo-600">Loading Bracket...</p></div>';

    try {
        // Construct Filters
        // Match Type usually contains strings like "Junior Boys", "Degree Girls", "Open Mix"
        // We construct a partial search term
        
        let genderTerm = gender === 'Male' ? 'Boys' : 'Girls';
        if(gender === 'Male') genderTerm = ['Boys', 'Men', 'Male'];
        else genderTerm = ['Girls', 'Women', 'Female', 'Ladies'];

        // Fetch Matches
        let query = supabase
            .from('matches')
            .select('*')
            .eq('sport_name', sport)
            .ilike('match_type', `%${category}%`)
            .order('round_name', { ascending: true });

        const { data, error } = await query;
        
        if (error) throw error;

        // Client-side filtering for Gender (since ILIKE OR is hard in basic Supabase chain)
        let filteredData = data.filter(m => {
             // specific logic to ensure we don't mix Boys/Girls if categories are messy
             const type = m.match_type.toLowerCase();
             const isCorrectGender = Array.isArray(genderTerm) 
                ? genderTerm.some(t => type.includes(t.toLowerCase()))
                : type.includes(genderTerm.toLowerCase());
             return isCorrectGender;
        });

        if (filteredData.length === 0) {
            root.innerHTML = '<div class="flex items-center justify-center w-full h-64 text-gray-400 font-bold">No matches found for this category.</div>';
            updateBracketTable([]);
            return;
        }

        bracketData = filteredData; // Save for export
        renderBracketTree(filteredData);
        updateBracketTable(filteredData);

    } catch (err) {
        console.error(err);
        showToast('error', 'Failed to load bracket data');
    }
}

function renderBracketTree(matches) {
    const root = document.getElementById('bracket-root');
    root.innerHTML = '';

    // 1. Group by Round
    const roundsMap = {};
    matches.forEach(m => {
        let rName = m.round_name.trim();
        if (!roundsMap[rName]) roundsMap[rName] = [];
        roundsMap[rName].push(m);
    });

    // 2. Sort Rounds
    const sortedRoundNames = Object.keys(roundsMap).sort((a, b) => {
        const valA = ROUND_ORDER[a.toLowerCase()] || 99;
        const valB = ROUND_ORDER[b.toLowerCase()] || 99;
        return valA - valB;
    });

    // 3. Render Columns
    sortedRoundNames.forEach((roundName, rIndex) => {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'round';
        if (rIndex > 0) roundDiv.style.marginTop = "0"; // CSS handles flex spacing

        // Title
        const title = document.createElement('div');
        title.className = 'round-title';
        title.innerText = roundName;
        roundDiv.appendChild(title);

        // Matches
        roundsMap[roundName].forEach((m, mIndex) => {
            const el = createMatchCard(m, rIndex, mIndex);
            roundDiv.appendChild(el);
        });

        root.appendChild(roundDiv);
    });

    // 4. Add Champion Box if Final exists and has winner
    const lastRound = roundsMap[sortedRoundNames[sortedRoundNames.length - 1]];
    if(lastRound && lastRound.length === 1) {
        const finalMatch = lastRound[0];
        if(finalMatch.winner) {
            const champDiv = document.createElement('div');
            champDiv.className = 'round';
            champDiv.innerHTML = `
                <div class="round-title">CHAMPION</div>
                <div class="match-wrapper">
                    <div class="match-card" style="border: 2px solid #b8860b; box-shadow: 0 0 15px rgba(184,134,11,0.2);">
                        <div class="team winner" style="justify-content:center; height:50px; font-size:1.1rem;">
                            🏆 ${finalMatch.winner}
                        </div>
                    </div>
                </div>`;
            root.appendChild(champDiv);
        }
    }

    // 5. Draw Lines
    setTimeout(drawConnectors, 100);
}

function createMatchCard(match, roundIndex, matchIndex) {
    const wrap = document.createElement('div');
    wrap.className = 'match-wrapper';
    wrap.id = `R${roundIndex}-M${matchIndex}`;
    
    // Pair Logic for Connectors: Even index is start of a pair
    if (matchIndex % 2 === 0) wrap.setAttribute('data-pair-start', 'true');

    // Winner Logic
    const w = match.winner;
    const t1Class = (w && w === match.team1) ? "team winner" : "team";
    const t2Class = (w && w === match.team2) ? "team winner" : "team";
    const t1Score = match.score && w === match.team1 ? 'W' : '';
    const t2Score = match.score && w === match.team2 ? 'W' : '';

    wrap.innerHTML = `
        <div class="match-card">
            <div class="${t1Class}">
                <span class="truncate w-32" title="${match.team1}">${match.team1 || 'TBD'}</span>
                <span class="team-score">${t1Score}</span>
            </div>
            <div class="${t2Class}">
                <span class="truncate w-32" title="${match.team2}">${match.team2 || 'TBD'}</span>
                <span class="team-score">${t2Score}</span>
            </div>
        </div>
    `;
    return wrap;
}

function drawConnectors() {
    // Clear old
    document.querySelectorAll('.connector-vertical').forEach(e => e.remove());

    const pairs = document.querySelectorAll('[data-pair-start="true"]');
    const containerRect = document.getElementById('bracket-root').getBoundingClientRect();

    pairs.forEach(startEl => {
        // Find the next sibling in the DOM (the second match of the pair)
        let nextEl = startEl.nextElementSibling;
        
        // Only draw if we have a pair AND there is a next round to connect to
        // (Visual logic checks if next round exists)
        if (!nextEl || !nextEl.classList.contains('match-wrapper')) return;

        const rect1 = startEl.getBoundingClientRect();
        const rect2 = nextEl.getBoundingClientRect();

        // Calculate centers
        const y1 = (rect1.top + rect1.height / 2) - containerRect.top;
        const y2 = (rect2.top + rect2.height / 2) - containerRect.top;
        const height = y2 - y1;

        if (height > 0) {
            const line = document.createElement('div');
            line.className = 'connector-vertical';
            line.style.height = height + 'px';
            line.style.top = '50%';
            startEl.appendChild(line);
        }
    });
}

function updateBracketTable(data) {
    const tbody = document.getElementById('bracket-table-body');
    tbody.innerHTML = '';
    data.forEach(m => {
        const tr = `
            <tr class="bg-white hover:bg-gray-50 transition-colors">
                <td class="p-3 border-b border-gray-100 font-bold text-xs text-gray-500">${m.round_name}</td>
                <td class="p-3 border-b border-gray-100 text-xs font-mono text-indigo-600">${m.id}</td>
                <td class="p-3 border-b border-gray-100 font-bold">${m.team1 || 'TBD'}</td>
                <td class="p-3 border-b border-gray-100 font-bold">${m.team2 || 'TBD'}</td>
                <td class="p-3 border-b border-gray-100 font-bold text-green-600">${m.winner || '-'}</td>
            </tr>
        `;
        tbody.innerHTML += tr;
    });
}

function toggleBracketView() {
    const tree = document.getElementById('bracket-container');
    const table = document.getElementById('bracket-table-view');
    
    if (tree.style.display === 'none') {
        tree.style.display = 'block';
        table.classList.add('hidden');
    } else {
        tree.style.display = 'none';
        table.classList.remove('hidden');
    }
}

// --- 3. EXPORT FUNCTIONS ---
function exportBracketExcel() {
    if(!bracketData.length) { showToast('error', 'No data to export'); return; }
    
    const ws = XLSX.utils.json_to_sheet(bracketData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    XLSX.writeFile(wb, "Tournament_Bracket_Results.xlsx");
}

function printBracketPDF() {
    // For Visual Bracket, we use window.print() with specific CSS media query
    // Ensure Tree is visible
    document.getElementById('bracket-container').style.display = 'block';
    document.getElementById('bracket-table-view').classList.add('hidden');
    window.print();
}

function exportCurrentPage(type) {
    if(type === 'excel') exportBracketExcel(); // Reuse for now if on bracket page
    else printBracketPDF();
}


// --- 4. MANUAL SCHEDULE LOGIC ---
async function handleManualSportChange() {
    const sportName = document.getElementById('manual-sport').value;
    const t1Select = document.getElementById('manual-team1');
    const t2Select = document.getElementById('manual-team2');
    
    t1Select.innerHTML = '<option>Loading...</option>';
    
    if(!sportName) return;

    // Fetch Teams registered for this sport
    // Note: Assuming 'teams' table has 'sport_name' column
    const { data: teams, error } = await supabase
        .from('teams')
        .select('team_name')
        .eq('sport_name', sportName);

    t1Select.innerHTML = '<option value="">Select Team</option>';
    t2Select.innerHTML = '<option value="">Select Team</option>';

    if(teams) {
        teams.forEach(t => {
            const opt = `<option value="${t.team_name}">${t.team_name}</option>`;
            t1Select.innerHTML += opt;
            t2Select.innerHTML += opt;
        });
    }
}

function toggleManualBye() {
    const isBye = document.getElementById('manual-is-bye').checked;
    const t2 = document.getElementById('manual-team2');
    if(isBye) {
        t2.value = "BYE";
        t2.disabled = true;
        // Optionally auto-set winner to team 1?
    } else {
        t2.value = "";
        t2.disabled = false;
    }
}

async function submitManualSchedule(e) {
    e.preventDefault();
    
    const formData = {
        sport_name: document.getElementById('manual-sport').value,
        match_type: document.getElementById('manual-type').value,
        round_name: "Round " + document.getElementById('manual-round').value,
        team1: document.getElementById('manual-team1').value,
        team2: document.getElementById('manual-is-bye').checked ? 'BYE' : document.getElementById('manual-team2').value,
        schedule_time: document.getElementById('manual-time').value,
        location: document.getElementById('manual-location').value,
        status: 'Scheduled'
    };
    
    // Auto-win for Bye
    if(formData.team2 === 'BYE') {
        formData.winner = formData.team1;
        formData.status = 'Completed';
        formData.score = 'Walkover';
    }

    const { error } = await supabase.from('matches').insert([formData]);

    if(error) showToast('error', error.message);
    else {
        showToast('success', 'Match Scheduled Successfully');
        document.querySelector('form').reset();
    }
}

// --- UTILITIES ---
function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function openAddSportModal() {
    document.getElementById('modal-add-sport').classList.remove('hidden');
}

function showToast(type, msg) {
    const toast = document.getElementById('toast-container');
    const msgEl = document.getElementById('toast-msg');
    const iconEl = document.getElementById('toast-icon');
    
    toast.classList.remove('opacity-0', 'translate-y-10');
    msgEl.innerText = msg;
    
    if(type === 'success') {
        iconEl.innerHTML = '<i data-lucide="check-circle" class="text-green-400"></i>';
    } else {
        iconEl.innerHTML = '<i data-lucide="alert-circle" class="text-red-400"></i>';
    }
    
    lucide.createIcons();
    setTimeout(() => {
        toast.classList.add('opacity-0', 'translate-y-10');
    }, 3000);
}

// Handle Add Sport
async function handleAddSport(e) {
    e.preventDefault();
    // Implementation for adding sport to 'sports' table would go here
    showToast('success', 'Sport Created (Mock)');
    closeModal('modal-add-sport');
}
