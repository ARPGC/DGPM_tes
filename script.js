/**
 * TOURNAMENT ADMIN - LOGIC CONTROLLER
 */

// --- 1. CONFIGURATION ---

// Check if CONFIG exists (from config.js)
if (typeof CONFIG === 'undefined') {
    alert("Error: config.js not found or not loaded. Please ensure config.js is in the same folder.");
}

// Initialize Supabase Client
// We use 'sbClient' to avoid conflict with the global 'supabase' variable from the CDN
const sbClient = window.supabase.createClient(CONFIG.SUPABASE.supabaseUrl, CONFIG.SUPABASE.supabaseKey);

const state = {
    matches: [],
    selectedWinnerKey: null,
    currentMatchId: null,
    currentMatch: null
};

// --- 2. UI HELPERS ---
const ui = {
    openModal: (id) => document.getElementById(id).classList.remove('hidden'),
    
    closeModal: (id) => {
        document.getElementById(id).classList.add('hidden');
        if(id === 'match-modal') ui.clearMatchSelection();
    },

    openSetupModal: () => {
        const textarea = document.getElementById('setup-teams');
        if(!textarea.value) {
            textarea.value = `Power Puff\nRushers\nFantoms\nGolden Girls\nReal Zeher\nBlack Panthers\nSupernovas\nDominators\nThunder\nLightning\nStorm\nCyclones\nTornadoes\nHurricanes\nTyphoons\nVikings\nSpartans\nTrojans\nGladiators\nWarriors\nNinjas\nSamurais\nKnights\nTitans\nOlympians\nAvengers\nGuardians\nDefenders\nX-Force\nLegends`;
        }
        ui.openModal('setup-modal');
    },

    selectWinner: (teamKey) => {
        document.getElementById('card-team1').classList.remove('ring-2', 'ring-indigo-600', 'bg-indigo-50');
        document.getElementById('card-team2').classList.remove('ring-2', 'ring-indigo-600', 'bg-indigo-50');
        document.getElementById(`card-${teamKey}`).classList.add('ring-2', 'ring-indigo-600', 'bg-indigo-50');
        state.selectedWinnerKey = teamKey;
    },

    clearMatchSelection: () => {
        state.selectedWinnerKey = null;
        state.currentMatchId = null;
    },

    toggleLoading: (isLoading) => {
        const el = document.getElementById('loading-indicator');
        if (isLoading) el.classList.remove('hidden');
        else el.classList.add('hidden');
    }
};

// --- 3. APPLICATION LOGIC ---
const logic = {
    
    // FETCH DATA
    fetchData: async () => {
        ui.toggleLoading(true);
        
        // Use 'sbClient' here
        const { data: matches, error } = await sbClient
            .from('tournament_matches')
            .select('*')
            .order('round_index', { ascending: true })
            .order('match_index', { ascending: true });

        if (error) {
            console.error(error);
            alert("Error fetching data. Check console.");
            ui.toggleLoading(false);
            return;
        }

        if (!matches || matches.length === 0) {
            ui.openSetupModal();
            ui.toggleLoading(false);
            return;
        }

        state.matches = matches;
        document.getElementById('tournament-title').innerText = localStorage.getItem('tourney_sport') || "Tournament Bracket";
        app.renderBracket();
        ui.toggleLoading(false);
    },

    // OPEN EDITOR
    openMatchEditor: (matchId) => {
        const match = state.matches.find(m => m.id === matchId);
        if (!match) return;

        state.currentMatchId = match.id;
        state.currentMatch = match;

        document.getElementById('modal-match-id').innerText = `${match.round_name} - Match ${match.match_index + 1}`;
        document.getElementById('modal-round-name').innerText = match.round_name;
        
        document.getElementById('modal-team1-name').innerText = match.team1_name || 'TBD';
        document.getElementById('modal-team2-name').innerText = match.team2_name || 'TBD';
        
        document.getElementById('modal-score1').value = match.score_team1 || 0;
        document.getElementById('modal-score2').value = match.score_team2 || 0;

        // Auto-select winner visually if exists
        ui.clearMatchSelection();
        if (match.winner_name && match.winner_name === match.team1_name) ui.selectWinner('team1');
        if (match.winner_name && match.winner_name === match.team2_name) ui.selectWinner('team2');

        ui.openModal('match-modal');
    },

    // SAVE MATCH
    saveMatchUpdate: async () => {
        const m = state.currentMatch;
        const s1 = parseInt(document.getElementById('modal-score1').value) || 0;
        const s2 = parseInt(document.getElementById('modal-score2').value) || 0;
        
        let winnerName = null;
        if (state.selectedWinnerKey === 'team1') winnerName = m.team1_name;
        else if (state.selectedWinnerKey === 'team2') winnerName = m.team2_name;
        
        if (!winnerName && s1 > s2) winnerName = m.team1_name;
        if (!winnerName && s2 > s1) winnerName = m.team2_name;

        if (!winnerName || winnerName === 'TBD' || winnerName === 'BYE') {
             alert("Please select a valid winner.");
             return;
        }

        ui.toggleLoading(true);

        // Update DB
        const { error } = await sbClient
            .from('tournament_matches')
            .update({ 
                score_team1: s1, 
                score_team2: s2, 
                winner_name: winnerName,
                status: 'completed'
            })
            .eq('id', m.id);

        if(error) { alert(error.message); ui.toggleLoading(false); return; }

        if (m.next_match_identifier) {
            await logic.advanceWinner(m.next_match_identifier, m.match_index, winnerName);
        }

        ui.closeModal('match-modal');
        await logic.fetchData();
    },

    // ADVANCE WINNER
    advanceWinner: async (nextMatchId, currentMatchIndex, winnerName) => {
        const isTeam1Slot = (currentMatchIndex % 2 === 0);
        const updateObj = isTeam1Slot ? { team1_name: winnerName } : { team2_name: winnerName };

        await sbClient
            .from('tournament_matches')
            .update(updateObj)
            .eq('match_identifier', nextMatchId);
    },

    // FORCE BYE
    declareBye: async () => {
        const m = state.currentMatch;
        let winnerName = (m.team1_name !== 'BYE' && m.team1_name !== 'TBD') ? m.team1_name : m.team2_name;
        
        if (state.selectedWinnerKey === 'team1') winnerName = m.team1_name;
        if (state.selectedWinnerKey === 'team2') winnerName = m.team2_name;

        if (!winnerName || winnerName === 'TBD' || winnerName === 'BYE') {
            alert("Need at least one valid team for a Bye.");
            return;
        }

        ui.toggleLoading(true);
        await sbClient
            .from('tournament_matches')
            .update({ winner_name: winnerName, status: 'completed' })
            .eq('id', m.id);

        if (m.next_match_identifier) {
            await logic.advanceWinner(m.next_match_identifier, m.match_index, winnerName);
        }
        ui.closeModal('match-modal');
        await logic.fetchData();
    },

    // RESET MATCH
    resetMatch: async () => {
        if(!confirm("Reset this match?")) return;
        const m = state.currentMatch;
        ui.toggleLoading(true);

        await sbClient
            .from('tournament_matches')
            .update({ winner_name: null, status: 'scheduled', score_team1: 0, score_team2: 0 })
            .eq('id', m.id);

        if (m.next_match_identifier) {
            const isTeam1Slot = (m.match_index % 2 === 0);
            const updateObj = isTeam1Slot ? { team1_name: 'TBD' } : { team2_name: 'TBD' };
            await sbClient.from('tournament_matches').update(updateObj).eq('match_identifier', m.next_match_identifier);
        }
        ui.closeModal('match-modal');
        await logic.fetchData();
    },

    // GENERATE NEW TOURNAMENT
    generateNewTournament: async () => {
        ui.toggleLoading(true);
        ui.closeModal('setup-modal');

        const sport = document.getElementById('setup-sport').value;
        const rawTeams = document.getElementById('setup-teams').value.split('\n').filter(t => t.trim() !== '');
        localStorage.setItem('tourney_sport', sport);

        // 1. Delete Old Data
        const { data: allRows } = await sbClient.from('tournament_matches').select('id');
        if(allRows && allRows.length > 0) {
            const ids = allRows.map(r => r.id);
            await sbClient.from('tournament_matches').delete().in('id', ids);
        }

        // 2. Setup 32-Slot Grid
        const totalSlots = 32; 
        let slots = new Array(totalSlots).fill('TBD');
        
        // Insert 2 Byes for 30 teams (Slots 1 and 30)
        if(rawTeams.length === 30) {
            slots[1] = 'BYE';
            slots[30] = 'BYE';
        }
        
        let teamIdx = 0;
        for(let i=0; i<totalSlots; i++) {
            if(slots[i] === 'BYE') continue;
            if(teamIdx < rawTeams.length) slots[i] = rawTeams[teamIdx++];
        }

        // 3. Prepare Rows
        let insertRows = [];
        const roundNames = ["Round of 32", "Round of 16", "Quarter-Finals", "Semi-Finals", "Finals"];
        let currentSlots = slots;
        let roundCount = 5;

        for (let r = 0; r < roundCount; r++) {
            let nextRoundSlots = [];
            let matchCount = currentSlots.length / 2;
            
            for (let m = 0; m < matchCount; m++) {
                let t1 = currentSlots[m*2];
                let t2 = currentSlots[m*2+1];
                let winner = null;
                let status = 'scheduled';
                
                // Auto-resolve Byes
                if(t2 === 'BYE') { winner = t1; status = 'completed'; }
                if(t1 === 'BYE') { winner = t2; status = 'completed'; }

                let matchId = `R${r+1}-M${m+1}`;
                let nextMatchId = (r < roundCount - 1) ? `R${r+2}-M${Math.floor(m/2)+1}` : null;
                
                // Only R1 gets initial names
                if (r > 0) { t1 = 'TBD'; t2 = 'TBD'; }

                insertRows.push({
                    match_identifier: matchId,
                    round_name: roundNames[r],
                    round_index: r,
                    match_index: m,
                    team1_name: (r===0) ? currentSlots[m*2] : 'TBD',
                    team2_name: (r===0) ? currentSlots[m*2+1] : 'TBD',
                    winner_name: winner,
                    status: status,
                    next_match_identifier: nextMatchId
                });
                nextRoundSlots.push('TBD');
            }
            currentSlots = nextRoundSlots;
        }

        const { error } = await sbClient.from('tournament_matches').insert(insertRows);
        if(error) alert("Insert failed: " + error.message);
        await logic.fetchData();
    }
};

// --- 4. RENDERER ---
const app = {
    refreshData: () => logic.fetchData(),

    renderBracket: () => {
        const root = document.getElementById('bracket-root');
        root.innerHTML = '';
        const matches = state.matches;

        // Group Rounds
        const rounds = {};
        matches.forEach(m => {
            if(!rounds[m.round_index]) rounds[m.round_index] = [];
            rounds[m.round_index].push(m);
        });

        Object.keys(rounds).sort().forEach((rIdx, i) => {
            const roundMatches = rounds[rIdx];
            const roundDiv = document.createElement('div');
            roundDiv.className = 'flex flex-col justify-around relative mx-6';
            roundDiv.style.minHeight = `${roundMatches.length * 90}px`; 

            // Title
            const title = document.createElement('div');
            title.className = 'absolute -top-10 w-full text-center text-xs font-bold text-slate-400 uppercase tracking-widest';
            title.innerText = roundMatches[0].round_name;
            roundDiv.appendChild(title);

            roundMatches.forEach((m, idx) => {
                const card = document.createElement('div');
                card.className = `w-64 bg-white border rounded shadow-sm relative my-2 hover:shadow-lg hover:border-indigo-400 transition cursor-pointer group`;
                if(m.winner_name) card.classList.add('border-indigo-200');

                card.onclick = () => logic.openMatchEditor(m.id);

                const t1Bold = (m.winner_name && m.winner_name === m.team1_name) ? 'font-bold text-indigo-700 bg-indigo-50' : 'text-slate-700';
                const t2Bold = (m.winner_name && m.winner_name === m.team2_name) ? 'font-bold text-indigo-700 bg-indigo-50' : 'text-slate-700';

                card.innerHTML = `
                    <div class="px-3 py-2 flex justify-between items-center border-b border-slate-100 ${t1Bold} rounded-t">
                        <span class="truncate text-sm">${m.team1_name}</span>
                        <span class="text-xs bg-slate-100 px-1.5 rounded">${m.score_team1 || '-'}</span>
                    </div>
                    <div class="px-3 py-2 flex justify-between items-center ${t2Bold} rounded-b">
                        <span class="truncate text-sm">${m.team2_name}</span>
                        <span class="text-xs bg-slate-100 px-1.5 rounded">${m.score_team2 || '-'}</span>
                    </div>
                    <div class="absolute -top-2 -left-2 bg-slate-800 text-white text-[10px] px-1 rounded opacity-0 group-hover:opacity-100 transition">#${m.match_index + 1}</div>
                `;

                // Horizontal Connector
                if (i < Object.keys(rounds).length - 1) {
                    card.innerHTML += `<div class="bracket-connector-h"></div>`;
                }

                // Vertical Connector (Fork)
                if (i < Object.keys(rounds).length - 1 && idx % 2 === 0) {
                    const connectorV = document.createElement('div');
                    connectorV.className = 'bracket-connector-v';
                    let gapMult = Math.pow(2, i); 
                    connectorV.style.height = `${90 * gapMult}px`;
                    connectorV.style.top = '50%';
                    card.appendChild(connectorV);
                }
                roundDiv.appendChild(card);
            });
            root.appendChild(roundDiv);
        });
        
        // Champion
        const finalMatch = matches[matches.length - 1];
        if(finalMatch && finalMatch.winner_name) {
            const champDiv = document.createElement('div');
            champDiv.className = 'flex flex-col justify-center ml-10 animate-bounce';
            champDiv.innerHTML = `
                <div class="text-center mb-2 font-bold text-amber-500 tracking-widest text-xs">CHAMPION</div>
                <div class="bg-amber-100 border-2 border-amber-400 text-amber-800 font-bold px-6 py-4 rounded-xl shadow-xl">🏆 ${finalMatch.winner_name}</div>
            `;
            root.appendChild(champDiv);
        }
    }
};

window.onload = logic.fetchData;
