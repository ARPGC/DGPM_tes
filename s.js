// =========================================
// SPORTS FEST BRACKET VIEWER LOGIC
// =========================================

// 1. CONFIGURATION & STATE
// -----------------------------------------
if (typeof CONFIG === 'undefined') {
    console.error("CONFIG missing. Ensure config.js is loaded before s.js");
}

const supabase = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

let allMatches = []; // Stores the raw data for the current view
let currentSportId = null;
let currentCategory = null;

// Mapping round numbers to display names (Standard tournament structure)
const ROUND_NAMES = {
    1: "Finals",
    2: "Semi-Finals",
    3: "Quarter-Finals",
    4: "Round of 16",
    5: "Round of 32",
    6: "Round of 64"
};

// =========================================
// 2. INITIALIZATION
// =========================================

document.addEventListener('DOMContentLoaded', init);

async function init() {
    try {
        await fetchFilters();
        
        // Resize listener for redrawing connector lines when window changes
        window.addEventListener('resize', drawConnectors);
        
    } catch (error) {
        console.error("Init Error:", error);
        alert("Failed to load initial data. Check console for details.");
    } finally {
        const loader = document.getElementById('loading');
        if(loader) loader.style.display = 'none';
    }
}

// Fetch Sports and Categories to populate the top dropdowns
async function fetchFilters() {
    // A. Fetch Sports
    const { data: sportsData, error: sportsError } = await supabase
        .from('sports')
        .select('id, name');
        
    if (sportsError) console.error("Error fetching sports:", sportsError);

    const sportSelect = document.getElementById('sportFilter');
    if (sportsData && sportSelect) {
        sportsData.forEach(s => {
            let opt = document.createElement('option');
            opt.value = s.id;
            opt.innerText = s.name;
            sportSelect.appendChild(opt);
        });
        
        // Default to first sport if available
        if(sportsData.length > 0) sportSelect.value = sportsData[0].id;
    }

    // B. Fetch Distinct Match Categories (match_type)
    const { data: matchData, error: matchError } = await supabase
        .from('matches')
        .select('match_type')
        .not('match_type', 'is', null);

    if (matchData) {
        // Get unique values
        const categories = [...new Set(matchData.map(item => item.match_type))];
        const catSelect = document.getElementById('categoryFilter');
        
        if (catSelect) {
            categories.sort().forEach(c => {
                let opt = document.createElement('option');
                opt.value = c;
                opt.innerText = c;
                catSelect.appendChild(opt);
            });
            // Default to first category if available
            if(categories.length > 0) catSelect.value = categories[0];
        }
    }

    // Initial Load
    loadBracketData();
}

// =========================================
// 3. CORE DATA LOGIC
// =========================================

async function loadBracketData() {
    const sportSelect = document.getElementById('sportFilter');
    const catSelect = document.getElementById('categoryFilter');
    
    // Safety check if elements exist
    if (!sportSelect || !catSelect) return;

    const sportId = sportSelect.value;
    const category = catSelect.value;
    
    if (!sportId && !category) return; // Wait until filters are populated

    // Show Loader
    const loader = document.getElementById('loading');
    if(loader) loader.style.display = 'flex';

    // Build Query
    let query = supabase
        .from('matches')
        .select(`
            id, round_number, match_type, status, winner_id,
            team1_name, team2_name, team1_id, team2_id,
            score1, score2
        `)
        .order('round_number', { ascending: true }) // R1, R2, R3...
        .order('id', { ascending: true });          // Keep order consistent

    if (sportId) query = query.eq('sport_id', sportId);
    if (category) query = query.eq('match_type', category);

    const { data, error } = await query;

    if (error) {
        console.error("Match Fetch Error:", error);
        alert("Error fetching matches");
        if(loader) loader.style.display = 'none';
        return;
    }

    allMatches = data;
    renderBracket(data);
    renderTable(data);
    
    if(loader) loader.style.display = 'none';
}

// =========================================
// 4. BRACKET VISUALIZATION ENGINE
// =========================================

function renderBracket(matches) {
    const root = document.getElementById('bracket-root');
    if(!root) return;
    
    root.innerHTML = '';

    if (!matches || matches.length === 0) {
        root.innerHTML = '<div style="padding:20px; color:#666; font-style:italic;">No matches found for this selection.</div>';
        return;
    }

    // A. Group matches by Round Number
    const rounds = {};
    let maxRound = 0;
    
    matches.forEach(m => {
        if (!rounds[m.round_number]) rounds[m.round_number] = [];
        rounds[m.round_number].push(m);
        if (m.round_number > maxRound) maxRound = m.round_number;
    });

    // B. Build Columns (Round by Round)
    // We assume rounds are stored as integers where Max = Final.
    // Iterating 1 -> MaxRound assumes 1 is the earliest round (e.g. R32) 
    // and Max is the Final.
    // *ADJUSTMENT*: If your DB stores "1" as Final and "5" as R32, reverse this loop.
    // Based on typical CSVs, usually R1 is the start.
    
    for (let r = 1; r <= maxRound; r++) {
        if (!rounds[r]) continue;

        let roundDiv = document.createElement('div');
        roundDiv.className = 'round';
        
        // Calculate dynamic name (e.g. if Max is 4, R4 is Final)
        let roundFromFinal = maxRound - r + 1; 
        let titleText = ROUND_NAMES[roundFromFinal] || `Round ${r}`;
        
        let title = document.createElement('div');
        title.className = 'round-title';
        title.innerText = titleText;
        roundDiv.appendChild(title);

        // Matches
        rounds[r].forEach((m, idx) => {
            let matchWrap = document.createElement('div');
            matchWrap.className = 'match-wrapper';
            matchWrap.id = `match-${m.id}`;
            
            // Mark every 2nd match as the start of a pair (for connectors)
            if (idx % 2 === 0) matchWrap.setAttribute('data-pair-start', 'true');

            // Winner Highlighting
            let t1Class = (m.winner_id && m.winner_id === m.team1_id) ? "team winner" : "team";
            let t2Class = (m.winner_id && m.winner_id === m.team2_id) ? "team winner" : "team";

            // Name Handling
            let t1Name = formatTeamName(m.team1_name);
            let t2Name = formatTeamName(m.team2_name);

            matchWrap.innerHTML = `
                <div class="match-card">
                    <div class="${t1Class}">
                        <span>${t1Name}</span>
                        <span class="score">${m.score1 !== null ? m.score1 : ''}</span>
                    </div>
                    <div class="${t2Class}">
                        <span>${t2Name}</span>
                        <span class="score">${m.score2 !== null ? m.score2 : ''}</span>
                    </div>
                </div>
            `;
            roundDiv.appendChild(matchWrap);
        });

        root.appendChild(roundDiv);
    }

    // C. Add "Champion" Box if the Final is played
    let finalRoundMatches = rounds[maxRound];
    if (finalRoundMatches && finalRoundMatches.length === 1) {
        let finalMatch = finalRoundMatches[0];
        let championName = "?";
        
        if (finalMatch.status === 'Completed' && finalMatch.winner_id) {
            championName = finalMatch.winner_id === finalMatch.team1_id 
                ? finalMatch.team1_name 
                : finalMatch.team2_name;
        }

        let champDiv = document.createElement('div');
        champDiv.className = 'round';
        champDiv.style.justifyContent = 'center';
        champDiv.innerHTML = `
            <div class="round-title" style="color:var(--secondary);">CHAMPION</div>
            <div class="match-wrapper">
                <div class="match-card" style="border: 2px solid var(--secondary); box-shadow: 0 0 15px rgba(184,134,11,0.2);">
                    <div class="team winner" style="justify-content:center; height:50px; font-size:1.1rem; background:white; color:var(--secondary);">
                        🏆 ${championName}
                    </div>
                </div>
            </div>
        `;
        root.appendChild(champDiv);
    }

    // D. Draw Lines
    setTimeout(drawConnectors, 100);
}

// Helper to truncate long names
function formatTeamName(name) {
    if (!name) return "TBD";
    return name.length > 15 ? name.substring(0, 13) + '..' : name;
}

// =========================================
// 5. CONNECTOR LINES (Canvas-like Logic)
// =========================================

function drawConnectors() {
    // 1. Remove existing lines
    document.querySelectorAll('.connector-vertical').forEach(e => e.remove());

    const root = document.getElementById('bracket-root');
    if(!root) return;
    
    // We draw lines based on "pairs" defined in renderBracket
    const pairs = document.querySelectorAll('[data-pair-start="true"]');
    const containerRect = root.getBoundingClientRect();

    pairs.forEach(startEl => {
        let nextEl = startEl.nextElementSibling;
        
        // Ensure the next element is actually a match wrapper (partner)
        if (!nextEl || !nextEl.classList.contains('match-wrapper')) return;

        // Calculate geometry
        let rect1 = startEl.getBoundingClientRect();
        let rect2 = nextEl.getBoundingClientRect();

        let y1 = (rect1.top + rect1.height / 2) - containerRect.top;
        let y2 = (rect2.top + rect2.height / 2) - containerRect.top;
        let height = y2 - y1;

        // Create the vertical fork line
        let line = document.createElement('div');
        line.className = 'connector-vertical';
        line.style.height = height + 'px';
        line.style.top = '50%'; // Start at middle of top card
        
        // Only append if this isn't the absolute last round (Champion box logic handles differently)
        // Check if the parent column has a next sibling column
        if(startEl.parentElement.nextElementSibling) {
             startEl.appendChild(line);
        }
    });
}

// =========================================
// 6. EXPORT & UTILITY FUNCTIONS
// =========================================

function renderTable(matches) {
    const tbody = document.getElementById('table-body');
    if(!tbody) return;
    
    tbody.innerHTML = '';
    
    matches.forEach(m => {
        let winnerName = "-";
        if (m.winner_id) {
            winnerName = m.winner_id === m.team1_id ? m.team1_name : m.team2_name;
        }

        let statusColor = m.status === 'Completed' ? '#d1fae5' : '#f3f4f6';
        let statusText = m.status === 'Completed' ? '#065f46' : '#374151';

        let row = `
            <tr>
                <td>${m.id.substring(0,8)}...</td>
                <td>Round ${m.round_number}</td>
                <td>${m.team1_name || 'TBD'}</td>
                <td>${m.team2_name || 'TBD'}</td>
                <td style="font-weight:bold; color:var(--primary)">${winnerName || '-'}</td>
                <td><span style="padding:2px 6px; border-radius:4px; font-size:0.8rem; background:${statusColor}; color:${statusText}">${m.status}</span></td>
            </tr>
        `;
        tbody.innerHTML += row;
    });
}

function toggleView() {
    const v = document.getElementById('bracket-view');
    const d = document.getElementById('data-view');
    const btn = document.querySelector('.btn-toggle');
    
    if (v.style.display === 'none') {
        v.style.display = 'block';
        d.style.display = 'none';
        btn.innerText = "📊 Toggle List";
        setTimeout(drawConnectors, 50); // Redraw lines because layout changed
    } else {
        v.style.display = 'none';
        d.style.display = 'block';
        btn.innerText = "🌳 Toggle Bracket";
    }
}

function printPDF() {
    // Force bracket view
    const v = document.getElementById('bracket-view');
    const d = document.getElementById('data-view');
    
    let originalDisplayV = v.style.display;
    let originalDisplayD = d.style.display;

    v.style.display = 'block';
    d.style.display = 'none';
    
    // Allow DOM to update then print
    setTimeout(() => {
        window.print();
        // Optional: restore views? Usually print dialog pauses JS, so this might run after.
    }, 100);
}

function exportExcel() {
    const cat = document.getElementById('categoryFilter').value || "Tournament";
    
    // Basic HTML Table string construction for Excel Blob
    let tableHTML = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head></head>
        <body>
            <h2>B. K. Birla College - ${cat} Match Schedule</h2>
            <table border="1">
                <thead>
                    <tr style="background-color: #003366; color: white;">
                        <th>Round</th>
                        <th>Team A</th>
                        <th>Team B</th>
                        <th>Score A</th>
                        <th>Score B</th>
                        <th>Winner</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
    `;

    allMatches.forEach(m => {
        let winner = (m.winner_id === m.team1_id ? m.team1_name : (m.winner_id === m.team2_id ? m.team2_name : "-"));
        tableHTML += `
            <tr>
                <td>${m.round_number}</td>
                <td>${m.team1_name || 'TBD'}</td>
                <td>${m.team2_name || 'TBD'}</td>
                <td>${m.score1 || 0}</td>
                <td>${m.score2 || 0}</td>
                <td>${winner}</td>
                <td>${m.status}</td>
            </tr>
        `;
    });

    tableHTML += `</tbody></table></body></html>`;

    // Create Download Link
    const blob = new Blob([tableHTML], { type: 'application/vnd.ms-excel' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Schedule_${cat.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.xls`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}
