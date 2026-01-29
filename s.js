// --- CONFIGURATION & STATE ---
let currentView = 'dashboard';
let bracketData = []; 

// Round Order Mapping
const ROUND_ORDER = {
    "round of 128": 0, "round of 64": 1, "round of 32": 2,
    "round of 16": 3, "pre-quarter": 3,
    "quarter-finals": 4, "quarter finals": 4, "quarter final": 4, "qf": 4,
    "semi-finals": 5, "semi finals": 5, "semi final": 5, "sf": 5,
    "finals": 6, "final": 6, "f": 6,
    "champion": 7
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    console.log("App Started");
    
    // 1. Check if Supabase is working
    if (typeof supabase === 'undefined') {
        alert("CRITICAL ERROR: 'supabase' variable is missing. Check your config.js file.");
        return;
    }

    try {
        checkAuth();
        loadDashboardStats();
        setupEventListeners();
        await fetchSportsForDropdowns(); // Load dropdowns
    } catch (e) {
        console.error("Init Error:", e);
        alert("Initialization Error: " + e.message);
    }
});

function checkAuth() {
    const session = localStorage.getItem('admin_session');
    if (!session) console.warn("No session found (Dev Mode)");
}

function adminLogout() {
    localStorage.removeItem('admin_session');
    window.location.href = 'index.html';
}

function setupEventListeners() {
    window.addEventListener('resize', () => {
        if(currentView === 'brackets') drawConnectors();
    });
}

// --- NAVIGATION ---
function switchView(viewId) {
    document.querySelectorAll('.view-section').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    const viewEl = document.getElementById(`view-${viewId}`);
    if(viewEl) viewEl.classList.remove('hidden');
    else console.error(`View ID 'view-${viewId}' not found in HTML`);
    
    const navEl = document.getElementById(`nav-${viewId}`);
    if(navEl) navEl.classList.add('active');
    
    currentView = viewId;
    
    // Hide Global Actions usually
    const globalActions = document.getElementById('global-actions');
    if(globalActions) globalActions.classList.add('hidden');

    if (viewId === 'sports') loadSportsTable();
    if (viewId === 'matches') loadMatchesGrid();
    if (viewId === 'brackets') {
        setTimeout(drawConnectors, 100);
    }
}

// --- DASHBOARD ---
async function loadDashboardStats() {
    try {
        const { count: userCount } = await supabase.from('users').select('*', { count: 'exact', head: true });
        const { count: regCount } = await supabase.from('registrations').select('*', { count: 'exact', head: true });
        const { count: teamCount } = await supabase.from('teams').select('*', { count: 'exact', head: true });

        if(document.getElementById('dash-total-users')) document.getElementById('dash-total-users').innerText = userCount || 0;
        if(document.getElementById('dash-total-regs')) document.getElementById('dash-total-regs').innerText = regCount || 0;
        if(document.getElementById('dash-total-teams')) document.getElementById('dash-total-teams').innerText = teamCount || 0;
    } catch (e) {
        console.warn("Stats error (check console):", e);
    }
}

// --- BRACKET LOGIC ---
async function fetchSportsForDropdowns() {
    try {
        // Check if 'matches' table exists and has 'sport_name'
        const { data, error } = await supabase.from('matches').select('sport_name').limit(10);
        
        if (error) {
            console.error("Supabase Error:", error);
            // Don't alert here to avoid spamming, just log
            return;
        }

        const sports = [...new Set(data.map(item => item.sport_name))].sort();
        
        const bracketSelect = document.getElementById('bracket-sport');
        const manualSelect = document.getElementById('manual-sport');
        
        if(bracketSelect) {
            bracketSelect.innerHTML = '<option value="">Select Sport</option>';
            sports.forEach(s => bracketSelect.innerHTML += `<option value="${s}">${s}</option>`);
        }
        if(manualSelect) {
            manualSelect.innerHTML = '<option value="">-- Choose Sport --</option>';
            sports.forEach(s => manualSelect.innerHTML += `<option value="${s}">${s}</option>`);
        }
    } catch (err) {
        console.error("Dropdown Error:", err);
    }
}

async function loadBracket() {
    const sport = document.getElementById('bracket-sport').value;
    const category = document.getElementById('bracket-category').value;
    const gender = document.getElementById('bracket-gender').value;

    if (!sport) {
        alert("Please select a sport from the dropdown.");
        return;
    }

    const root = document.getElementById('bracket-root');
    root.innerHTML = '<div class="flex items-center justify-center w-full h-64"><p>Loading...</p></div>';

    try {
        let genderTerm = gender === 'Male' ? 'Boys' : 'Girls';
        if (gender === 'Male') genderTerm = ['Boys', 'Men', 'Male']; 
        else genderTerm = ['Girls', 'Women', 'Female', 'Ladies'];

        // DEBUG: Log what we are asking for
        console.log(`Fetching: Sport=${sport}, Category=${category}`);

        // Fetch Data
        let query = supabase
            .from('matches')
            .select('*')
            .eq('sport_name', sport)
            .ilike('match_type', `%${category}%`);

        const { data, error } = await query;
        
        if (error) {
            throw new Error(`Database Error: ${error.message} (Hint: Check column names in Supabase)`);
        }

        // Filter Gender in JS
        let filteredData = data.filter(m => {
             const type = (m.match_type || "").toLowerCase();
             const isCorrectGender = Array.isArray(genderTerm) 
                ? genderTerm.some(t => type.includes(t.toLowerCase()))
                : type.includes(genderTerm.toLowerCase());
             return isCorrectGender;
        });

        if (filteredData.length === 0) {
            root.innerHTML = `<div class="p-10 text-center text-gray-500 font-bold">No matches found for ${sport} (${category} - ${gender}).<br>Check if 'match_type' column contains these words.</div>`;
            updateBracketTable([]);
            return;
        }

        bracketData = filteredData;
        renderBracketTree(filteredData);
        updateBracketTable(filteredData);

    } catch (err) {
        console.error(err);
        alert(err.message); // This will tell you the exact error
        root.innerHTML = `<div class="text-red-500 p-10">Error: ${err.message}</div>`;
    }
}

function renderBracketTree(matches) {
    const root = document.getElementById('bracket-root');
    root.innerHTML = '';

    const roundsMap = {};
    matches.forEach(m => {
        let rName = (m.round_name || "Unknown").trim();
        if (!roundsMap[rName]) roundsMap[rName] = [];
        roundsMap[rName].push(m);
    });

    const sortedRoundNames = Object.keys(roundsMap).sort((a, b) => {
        const valA = ROUND_ORDER[a.toLowerCase()] || 99;
        const valB = ROUND_ORDER[b.toLowerCase()] || 99;
        return valA - valB;
    });

    sortedRoundNames.forEach((roundName, rIndex) => {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'round';
        
        const title = document.createElement('div');
        title.className = 'round-title';
        title.innerText = roundName;
        roundDiv.appendChild(title);

        const roundMatches = roundsMap[roundName].sort((a,b) => a.id - b.id);

        roundMatches.forEach((m, mIndex) => {
            roundDiv.appendChild(createMatchCard(m, rIndex, mIndex));
        });

        root.appendChild(roundDiv);
    });

    addChampionBox(roundsMap, sortedRoundNames, root);
    setTimeout(drawConnectors, 100);
}

function createMatchCard(match, roundIndex, matchIndex) {
    const wrap = document.createElement('div');
    wrap.className = 'match-wrapper';
    wrap.id = `R${roundIndex}-M${matchIndex}`;
    if (matchIndex % 2 === 0) wrap.setAttribute('data-pair-start', 'true');

    const w = match.winner;
    const t1 = match.team1 || 'TBD';
    const t2 = match.team2 || 'TBD';
    const isT1Winner = w && w === t1 && t1 !== 'TBD';
    const isT2Winner = w && w === t2 && t2 !== 'TBD';

    wrap.innerHTML = `
        <div class="match-card">
            <div class="${isT1Winner ? 'team winner' : 'team'}">
                <span class="truncate w-32" title="${t1}">${t1}</span>
                ${isT1Winner ? '<span class="team-score">W</span>' : ''}
            </div>
            <div class="${isT2Winner ? 'team winner' : 'team'}">
                <span class="truncate w-32" title="${t2}">${t2}</span>
                ${isT2Winner ? '<span class="team-score">W</span>' : ''}
            </div>
        </div>`;
    return wrap;
}

function addChampionBox(roundsMap, sortedRoundNames, root) {
    const lastRoundName = sortedRoundNames[sortedRoundNames.length - 1];
    if(!lastRoundName) return;
    const lastRoundMatches = roundsMap[lastRoundName];
    if (lastRoundName.toLowerCase().includes('final') && lastRoundMatches.length === 1) {
        const finalMatch = lastRoundMatches[0];
        if (finalMatch.winner && finalMatch.winner !== 'TBD') {
            const champDiv = document.createElement('div');
            champDiv.className = 'round';
            champDiv.innerHTML = `
                <div class="round-title text-yellow-600">CHAMPION</div>
                <div class="match-wrapper">
                    <div class="match-card" style="border: 2px solid #b8860b;">
                        <div class="team winner" style="justify-content:center; height:50px; font-size:1.1rem; background: #fffbeb;">
                            🏆 <span class="font-black text-[#b8860b] ml-2">${finalMatch.winner}</span>
                        </div>
                    </div>
                </div>`;
            root.appendChild(champDiv);
        }
    }
}

function drawConnectors() {
    document.querySelectorAll('.connector-vertical').forEach(e => e.remove());
    const pairs = document.querySelectorAll('[data-pair-start="true"]');
    const containerRect = document.getElementById('bracket-root').getBoundingClientRect();

    pairs.forEach(startEl => {
        let endEl = startEl.nextElementSibling;
        if (!endEl || !endEl.classList.contains('match-wrapper')) return;
        
        const rect1 = startEl.getBoundingClientRect();
        const rect2 = endEl.getBoundingClientRect();
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

// --- UTILITIES & EXPORTS ---
function updateBracketTable(data) {
    const tbody = document.getElementById('bracket-table-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    data.forEach(m => {
        tbody.innerHTML += `
            <tr class="bg-white hover:bg-gray-50">
                <td class="p-3 border-b text-xs text-gray-500 uppercase">${m.round_name}</td>
                <td class="p-3 border-b text-xs text-indigo-600">#${m.id}</td>
                <td class="p-3 border-b font-bold">${m.team1 || 'TBD'}</td>
                <td class="p-3 border-b font-bold">${m.team2 || 'TBD'}</td>
                <td class="p-3 border-b font-bold text-green-600">${m.winner || '-'}</td>
            </tr>`;
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

function exportBracketExcel() {
    if (!bracketData.length) return alert('No data to export.');
    const ws = XLSX.utils.json_to_sheet(bracketData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    XLSX.writeFile(wb, "Tournament_Results.xlsx");
}

function printBracketPDF() {
    const tree = document.getElementById('bracket-container');
    const table = document.getElementById('bracket-table-view');
    if(tree.style.display === 'none') {
        tree.style.display = 'block';
        table.classList.add('hidden');
        window.print();
    } else {
        window.print();
    }
}

// --- MANUAL SCHEDULE ---
async function handleManualSportChange() {
    const sportName = document.getElementById('manual-sport').value;
    const t1Select = document.getElementById('manual-team1');
    const t2Select = document.getElementById('manual-team2');
    if (!sportName) return;

    t1Select.innerHTML = '<option>Loading...</option>';
    const { data: teams } = await supabase.from('teams').select('team_name').eq('sport_name', sportName);
    
    t1Select.innerHTML = '<option value="">Select Team</option>';
    t2Select.innerHTML = '<option value="">Select Team</option>';
    if (teams) {
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
    t2.value = isBye ? "BYE" : "";
    t2.disabled = isBye;
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
    if (formData.team2 === 'BYE') {
        formData.winner = formData.team1;
        formData.status = 'Completed';
    }
    const { error } = await supabase.from('matches').insert([formData]);
    if (error) alert(error.message);
    else { alert('Match Scheduled!'); document.querySelector('form').reset(); }
}

function loadSportsTable() { /* Placeholder - kept simple for debug */ }
function loadMatchesGrid() { /* Placeholder - kept simple for debug */ }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function openAddSportModal() { document.getElementById('modal-add-sport').classList.remove('hidden'); }
function handleAddSport(e) { e.preventDefault(); alert("Feature Mock"); closeModal('modal-add-sport'); }
function submitLiveParticipant(e) { e.preventDefault(); alert("Mock"); closeModal('modal-add-live-participant'); }
