// --- CONFIGURATION ---
let bracketData = []; // Stores current bracket data

// Helper to sort rounds correctly
const ROUND_ORDER = {
    "round of 128": 0, "round of 64": 1, "round of 32": 2,
    "round of 16": 3, "pre-quarter": 3,
    "quarter-finals": 4, "quarter finals": 4, "quarter final": 4, "qf": 4,
    "semi-finals": 5, "semi finals": 5, "semi final": 5, "sf": 5,
    "finals": 6, "final": 6, "f": 6, "champion": 7
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Check Auth
    const session = localStorage.getItem('admin_session');
    // if (!session) window.location.href = 'index.html'; // Uncomment to enforce login

    // 2. Load Icons
    lucide.createIcons();

    // 3. Setup Listeners
    window.addEventListener('resize', drawConnectors);

    // 4. Load Sports Dropdown
    await fetchSportsForDropdowns();
});

function adminLogout() {
    localStorage.removeItem('admin_session');
    window.location.href = 'index.html';
}

// --- CORE: FETCH & RENDER BRACKETS ---

async function fetchSportsForDropdowns() {
    try {
        if (typeof supabase === 'undefined') {
            console.error("Supabase not initialized. Check config.js");
            return;
        }

        const { data, error } = await supabase.from('matches').select('sport_name');
        if (error) throw error;

        // Unique Sports
        const sports = [...new Set(data.map(item => item.sport_name))].sort();
        
        const select = document.getElementById('bracket-sport');
        select.innerHTML = '<option value="">Select Sport</option>';
        sports.forEach(s => select.innerHTML += `<option value="${s}">${s}</option>`);

    } catch (err) {
        console.error("Sport fetch error:", err);
        showToast('error', 'Failed to load sports list');
    }
}

async function loadBracket() {
    const sport = document.getElementById('bracket-sport').value;
    const category = document.getElementById('bracket-category').value;
    const gender = document.getElementById('bracket-gender').value;

    if (!sport) {
        showToast('info', 'Please select a sport');
        return;
    }

    const root = document.getElementById('bracket-root');
    root.innerHTML = '<div class="flex items-center justify-center w-full h-64"><p class="animate-pulse font-bold text-indigo-600">Loading Matches...</p></div>';

    try {
        // Define Gender Keywords for fuzzy matching
        const genderTerms = gender === 'Male' ? ['Boys', 'Men', 'Male'] : ['Girls', 'Women', 'Female', 'Ladies'];

        // 1. Database Query
        let query = supabase
            .from('matches')
            .select('*')
            .eq('sport_name', sport)
            .ilike('match_type', `%${category}%`); // Filter by "Junior" or "Degree"

        const { data, error } = await query;
        if (error) throw error;

        // 2. Client-side Gender Filter
        let filteredData = data.filter(m => {
             const type = (m.match_type || "").toLowerCase();
             return genderTerms.some(term => type.includes(term.toLowerCase()));
        });

        // 3. Handle No Data
        if (filteredData.length === 0) {
            root.innerHTML = `
                <div class="flex flex-col items-center justify-center w-full h-64 text-gray-400 gap-2">
                    <span class="font-bold">No matches found.</span>
                    <span class="text-xs">Try different filters.</span>
                </div>`;
            updateBracketTable([]);
            bracketData = [];
            return;
        }

        // 4. Render
        bracketData = filteredData;
        renderBracketTree(filteredData);
        updateBracketTable(filteredData);
        showToast('success', `Loaded ${filteredData.length} matches`);

    } catch (err) {
        console.error(err);
        showToast('error', err.message);
    }
}

function renderBracketTree(matches) {
    const root = document.getElementById('bracket-root');
    root.innerHTML = '';

    // Group by Round
    const roundsMap = {};
    matches.forEach(m => {
        let rName = (m.round_name || "Unknown").trim();
        if (!roundsMap[rName]) roundsMap[rName] = [];
        roundsMap[rName].push(m);
    });

    // Sort Rounds
    const sortedRoundNames = Object.keys(roundsMap).sort((a, b) => {
        const valA = ROUND_ORDER[a.toLowerCase()] || 99;
        const valB = ROUND_ORDER[b.toLowerCase()] || 99;
        return valA - valB;
    });

    // Create Columns
    sortedRoundNames.forEach((roundName, rIndex) => {
        const roundDiv = document.createElement('div');
        roundDiv.className = 'round';
        
        // Title
        const title = document.createElement('div');
        title.className = 'round-title';
        title.innerText = roundName;
        roundDiv.appendChild(title);

        // Sort matches by ID for stable pairing
        const roundMatches = roundsMap[roundName].sort((a,b) => a.id - b.id);

        roundMatches.forEach((m, mIndex) => {
            roundDiv.appendChild(createMatchCard(m, rIndex, mIndex));
        });

        root.appendChild(roundDiv);
    });

    // Add Champion Box
    addChampionBox(roundsMap, sortedRoundNames, root);
    
    // Draw Lines
    setTimeout(drawConnectors, 100);
}

function createMatchCard(match, roundIndex, matchIndex) {
    const wrap = document.createElement('div');
    wrap.className = 'match-wrapper';
    wrap.id = `R${roundIndex}-M${matchIndex}`;
    
    // Mark start of pair (for lines)
    if (matchIndex % 2 === 0) wrap.setAttribute('data-pair-start', 'true');

    const w = match.winner;
    const t1 = match.team1 || 'TBD';
    const t2 = match.team2 || 'TBD';
    
    const isT1 = w && w === t1 && t1 !== 'TBD';
    const isT2 = w && w === t2 && t2 !== 'TBD';

    wrap.innerHTML = `
        <div class="match-card">
            <div class="${isT1 ? 'team winner' : 'team'}">
                <span class="truncate w-32 font-medium" title="${t1}">${t1}</span>
                ${isT1 ? '<span class="team-score">W</span>' : ''}
            </div>
            <div class="${isT2 ? 'team winner' : 'team'}">
                <span class="truncate w-32 font-medium" title="${t2}">${t2}</span>
                ${isT2 ? '<span class="team-score">W</span>' : ''}
            </div>
        </div>
    `;
    return wrap;
}

function addChampionBox(roundsMap, sortedRoundNames, root) {
    const lastRoundName = sortedRoundNames[sortedRoundNames.length - 1];
    if(!lastRoundName) return;

    const matches = roundsMap[lastRoundName];
    // If it's a Final and has 1 match with a winner
    if (lastRoundName.toLowerCase().includes('final') && matches.length === 1) {
        const final = matches[0];
        if (final.winner && final.winner !== 'TBD') {
            const champ = document.createElement('div');
            champ.className = 'round';
            champ.innerHTML = `
                <div class="round-title text-yellow-600">CHAMPION</div>
                <div class="match-wrapper">
                    <div class="match-card" style="border: 2px solid #b8860b;">
                        <div class="team winner" style="justify-content:center; height:50px; background: #fffbeb;">
                            🏆 <span class="font-black text-[#b8860b] ml-2">${final.winner}</span>
                        </div>
                    </div>
                </div>`;
            root.appendChild(champ);
        }
    }
}

// --- VISUAL CONNECTORS (THE LINES) ---

function drawConnectors() {
    // Remove old lines
    document.querySelectorAll('.connector-vertical').forEach(e => e.remove());

    const pairs = document.querySelectorAll('[data-pair-start="true"]');
    const container = document.getElementById('bracket-root').getBoundingClientRect();

    pairs.forEach(startEl => {
        let endEl = startEl.nextElementSibling;
        
        // Validation: Next sibling must be a match card
        if (!endEl || !endEl.classList.contains('match-wrapper')) return;

        const r1 = startEl.getBoundingClientRect();
        const r2 = endEl.getBoundingClientRect();

        const y1 = (r1.top + r1.height / 2) - container.top;
        const y2 = (r2.top + r2.height / 2) - container.top;
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

function updateBracketTable(data) {
    const tbody = document.getElementById('bracket-table-body');
    if(!tbody) return;
    tbody.innerHTML = '';
    data.forEach(m => {
        tbody.innerHTML += `
            <tr class="bg-white hover:bg-gray-50 transition-colors">
                <td class="p-3 border-b text-xs text-gray-500 uppercase font-bold">${m.round_name}</td>
                <td class="p-3 border-b font-bold text-gray-800">${m.team1 || 'TBD'}</td>
                <td class="p-3 border-b font-bold text-gray-800">${m.team2 || 'TBD'}</td>
                <td class="p-3 border-b font-bold text-green-600">${m.winner || '-'}</td>
            </tr>`;
    });
}

function exportBracketExcel() {
    if (!bracketData.length) return showToast('error', 'No data to export');
    
    const cleanData = bracketData.map(m => ({
        "Round": m.round_name,
        "Team 1": m.team1,
        "Team 2": m.team2,
        "Winner": m.winner || "Pending",
        "Category": m.match_type
    }));

    const ws = XLSX.utils.json_to_sheet(cleanData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Results");
    XLSX.writeFile(wb, "Bracket_Results.xlsx");
}

function printBracketPDF() {
    // Just force visual view and print
    document.getElementById('bracket-container').style.display = 'block';
    document.getElementById('bracket-table-view').classList.add('hidden');
    window.print();
}

function showToast(type, msg) {
    const toast = document.getElementById('toast-container');
    const msgEl = document.getElementById('toast-msg');
    const iconEl = document.getElementById('toast-icon');
    
    if(!toast) return;

    toast.classList.remove('opacity-0', 'translate-y-10');
    msgEl.innerText = msg;
    
    if(type === 'success') iconEl.innerHTML = '<i data-lucide="check-circle" class="text-green-400 w-5 h-5"></i>';
    else if (type === 'error') iconEl.innerHTML = '<i data-lucide="x-circle" class="text-red-400 w-5 h-5"></i>';
    else iconEl.innerHTML = '<i data-lucide="info" class="text-blue-400 w-5 h-5"></i>';
    
    lucide.createIcons();
    setTimeout(() => toast.classList.add('opacity-0', 'translate-y-10'), 3000);
}
