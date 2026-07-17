// ============================================================
//  Hnefatafl – Optimized rendering (no DOM rebuild on each move)
//  Uses event delegation and updates cells in place.
// ============================================================

const SIZE = 11;
const CENTER = 5;
const EMPTY = null;
const KING = 'K';
const DEFENDER = 'D';
const ATTACKER = 'A';

const CORNERS = [
    [0, 0], [0, 10],
    [10, 0], [10, 10]
];

// Distance-2 barricade patterns
const BARRICADE_PATTERNS = [
    [[2, 0], [1, 1], [0, 2]],
    [[2, 10], [1, 9], [0, 8]],
    [[8, 0], [9, 1], [10, 2]],
    [[8, 10], [9, 9], [10, 8]]
];

// ------------------------------------------------------------------
//  Global state
// ------------------------------------------------------------------
let board = [];
let currentTurn = 'player';
let gameOver = false;
let selectedRow = -1;
let selectedCol = -1;
let legalMovesForSelected = [];
let isAnimating = false;
let moveCount = 0;

let CELL_SIZE = 42;
let gameMode = null;
let playerSide = 'white';
let aiSide = 'black';

let kingHistory = [];
let predictedCorner = null;
let kingLeftThrone = false;
const KING_HISTORY_LIMIT = 6;

const boardEl = document.getElementById('board');
const statusEl = document.getElementById('status');
const menuOverlay = document.getElementById('menu-overlay');
const coinOverlay = document.getElementById('coin-overlay');
const coinEl = document.getElementById('coin');
const coinResultEl = document.getElementById('coin-result');

// ---- Persistent cell references ----
let cells = [];

// ------------------------------------------------------------------
//  Menu handling
// ------------------------------------------------------------------
function showMenu() {
    menuOverlay.classList.remove('hidden');
    gameOver = true;
    coinOverlay.classList.add('hidden');
}

function hideMenu() {
    menuOverlay.classList.add('hidden');
    gameOver = false;
}

// ------------------------------------------------------------------
//  🪙 SMOOTH COIN FLIP – uses CSS animation for reliability
// ------------------------------------------------------------------
function flipCoin(callback) {
    coinOverlay.classList.remove('hidden');
    coinResultEl.textContent = 'Flipping...';
    coinResultEl.style.opacity = '1';
    coinResultEl.style.textShadow = '0 2px 8px rgba(0,0,0,0.8)';

    coinEl.classList.remove('flipping');
    coinEl.style.transform = 'rotateY(0deg)';
    coinEl.style.transition = 'none';

    void coinEl.offsetHeight;

    const randomBytes = new Uint8Array(1);
    crypto.getRandomValues(randomBytes);
    const result = randomBytes[0] < 128 ? 0 : 1;

    const finalAngle = result === 0 ? 0 : 180;
    const sideText = result === 0 ? 'Defenders' : 'Attackers';
    const emoji = result === 0 ? '🛡️' : '⚔️';

    coinEl.style.transition = 'transform 1.4s cubic-bezier(0.15, 0.85, 0.35, 1)';
    const totalRotation = 3 * 360 + finalAngle;
    coinEl.style.transform = `rotateY(${totalRotation}deg)`;

    setTimeout(() => {
        coinEl.style.transition = 'transform 0.1s ease';
        coinEl.style.transform = `rotateY(${finalAngle}deg)`;

        coinResultEl.textContent = `${emoji} You play as ${sideText}!`;
        coinResultEl.style.textShadow = '0 0 40px rgba(255,215,0,0.4), 0 2px 8px rgba(0,0,0,0.8)';

        setTimeout(() => {
            callback(result === 0 ? 'white' : 'black');
        }, 1500);
    }, 1550);
}

document.getElementById('btn-vs-computer').addEventListener('click', () => {
    gameMode = 'computer';
    hideMenu();
    flipCoin((side) => {
        playerSide = side;
        aiSide = (side === 'white') ? 'black' : 'white';
        setTimeout(() => {
            coinOverlay.classList.add('hidden');
            resetGame();
        }, 400);
    });
});

document.getElementById('btn-vs-human').addEventListener('click', () => {
    gameMode = 'human';
    playerSide = 'white';
    hideMenu();
    resetGame();
});

// ------------------------------------------------------------------
//  Board resizing
// ------------------------------------------------------------------
function updateBoardSize() {
    const headerReserve = 80;
    const footerReserve = 60;
    const appPadding = 30;

    const availHeight = window.innerHeight - headerReserve - footerReserve - 20;
    const availWidth = window.innerWidth - appPadding - 20;

    let size = Math.min(availHeight / SIZE, availWidth / SIZE);
    size = Math.max(26, Math.min(52, size));

    CELL_SIZE = Math.floor(size);
    document.documentElement.style.setProperty('--cell-size', CELL_SIZE + 'px');
}

// ------------------------------------------------------------------
//  Initial board setup
// ------------------------------------------------------------------
function initBoard() {
    board = Array.from({ length: SIZE }, () => Array(SIZE).fill(EMPTY));
    moveCount = 0;
    kingHistory = [];
    predictedCorner = null;
    kingLeftThrone = false;

    board[CENTER][CENTER] = KING;

    const defenderPositions = [
        [CENTER, CENTER-1], [CENTER, CENTER+1],
        [CENTER-1, CENTER], [CENTER+1, CENTER],
        [CENTER, CENTER-2], [CENTER, CENTER+2],
        [CENTER-2, CENTER], [CENTER+2, CENTER],
        [CENTER-1, CENTER-1], [CENTER-1, CENTER+1],
        [CENTER+1, CENTER-1], [CENTER+1, CENTER+1]
    ];
    for (const [r, c] of defenderPositions) board[r][c] = DEFENDER;

    for (let c = 3; c <= 7; c++) board[0][c] = ATTACKER;
    board[1][5] = ATTACKER;
    for (let c = 3; c <= 7; c++) board[10][c] = ATTACKER;
    board[9][5] = ATTACKER;
    for (let r = 3; r <= 7; r++) board[r][0] = ATTACKER;
    board[5][1] = ATTACKER;
    for (let r = 3; r <= 7; r++) board[r][10] = ATTACKER;
    board[5][9] = ATTACKER;
}

// ------------------------------------------------------------------
//  Build persistent DOM cells (called once at startup)
// ------------------------------------------------------------------
function buildBoardCells() {
    boardEl.innerHTML = '';
    cells = [];
    for (let r = 0; r < SIZE; r++) {
        cells[r] = [];
        for (let c = 0; c < SIZE; c++) {
            const cell = document.createElement('div');
            cell.className = 'cell';
            cell.dataset.row = r;
            cell.dataset.col = c;

            if (r === CENTER && c === CENTER) cell.classList.add('throne');
            if (CORNERS.some(([cr, cc]) => cr === r && cc === c)) cell.classList.add('corner');

            const label = document.createElement('span');
            label.className = 'coord-label';
            label.textContent = `${r},${c}`;
            cell.appendChild(label);

            // Placeholder for piece image
            const img = document.createElement('img');
            img.className = 'piece-img';
            img.style.display = 'none'; // hidden by default
            cell.appendChild(img);

            cells[r][c] = cell;
            boardEl.appendChild(cell);
        }
    }
}

// ------------------------------------------------------------------
//  Optimized rendering – updates only what changed
// ------------------------------------------------------------------
function renderBoard() {
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const cell = cells[r][c];
            const piece = board[r][c];
            const img = cell.querySelector('.piece-img');

            // Update piece image
            if (piece) {
                let src = '';
                if (piece === KING) src = 'king.png';
                else if (piece === DEFENDER) src = 'defenders.png';
                else if (piece === ATTACKER) src = 'attackers.png';
                img.src = src;
                img.style.display = 'block';
                img.alt = piece;
            } else {
                img.style.display = 'none';
                img.src = '';
            }

            // Update selected / selectable classes
            cell.classList.toggle('selected', selectedRow === r && selectedCol === c);
            cell.classList.toggle('selectable', legalMovesForSelected.some(([mr, mc]) => mr === r && mc === c));
        }
    }
}

function updateStatus(message, isThinking = false) {
    statusEl.textContent = message;
    statusEl.classList.toggle('thinking', isThinking);
}

// ------------------------------------------------------------------
//  Helpers
// ------------------------------------------------------------------
function isOnBoard(r, c) { return r >= 0 && r < SIZE && c >= 0 && c < SIZE; }
function isCorner(r, c) { return CORNERS.some(([cr, cc]) => cr === r && cc === c); }
function isThrone(r, c) { return r === CENTER && c === CENTER; }
function isRestricted(r, c) { return isCorner(r, c) || isThrone(r, c); }
function isEdge(r, c) { return r === 0 || r === 10 || c === 0 || c === 10; }

function isFriendly(p1, p2) {
    if (!p1 || !p2) return false;
    const s1 = (p1 === KING || p1 === DEFENDER) ? 'defender' : 'attacker';
    const s2 = (p2 === KING || p2 === DEFENDER) ? 'defender' : 'attacker';
    return s1 === s2;
}
function isEnemy(p1, p2) { return !isFriendly(p1, p2); }

function isHostileTo(row, col, piece) {
    if (isCorner(row, col)) return true;
    if (isThrone(row, col)) {
        const isAttacker = (piece === ATTACKER);
        const isDefender = (piece === KING || piece === DEFENDER);
        if (isAttacker) return true;
        if (isDefender) return board[row][col] === EMPTY;
    }
    return false;
}

function getSide(piece) {
    if (piece === KING || piece === DEFENDER) return 'white';
    if (piece === ATTACKER) return 'black';
    return null;
}

function isAdjacentToCorner(row, col) {
    for (const [cr, cc] of CORNERS) {
        if (Math.abs(row - cr) + Math.abs(col - cc) === 1) return true;
    }
    return false;
}

// ------------------------------------------------------------------
//  King tracking
// ------------------------------------------------------------------
function findKingPos() {
    for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
        if (board[r][c] === KING) return [r, c];
    }
    return [-1, -1];
}

function updateKingTracking() {
    const [kr, kc] = findKingPos();
    if (kr === -1) return;
    const dist = Math.abs(kr - CENTER) + Math.abs(kc - CENTER);
    if (dist > 2) kingLeftThrone = true;
    kingHistory.push([kr, kc]);
    if (kingHistory.length > KING_HISTORY_LIMIT) kingHistory.shift();
    if (!kingLeftThrone || kingHistory.length < 3) { predictedCorner = null; return; }
    let avgDr = 0, avgDc = 0, count = 0;
    for (let i = 1; i < kingHistory.length; i++) {
        const [pr, pc] = kingHistory[i-1];
        const [cr, cc] = kingHistory[i];
        if (pr !== cr || pc !== cc) {
            avgDr += cr - pr;
            avgDc += cc - pc;
            count++;
        }
    }
    if (count === 0) { predictedCorner = null; return; }
    avgDr = Math.sign(avgDr);
    avgDc = Math.sign(avgDc);
    if (avgDr === 0 && avgDc === 0) { predictedCorner = null; return; }
    let bestCorner = null, bestDist = Infinity;
    for (const [cr, cc] of CORNERS) {
        const dR = cr - kr, dC = cc - kc;
        const rAlign = (avgDr === 0 || Math.sign(dR) === avgDr);
        const cAlign = (avgDc === 0 || Math.sign(dC) === avgDc);
        if (rAlign && cAlign) {
            const dist = Math.abs(dR) + Math.abs(dC);
            if (dist < bestDist) { bestDist = dist; bestCorner = [cr, cc]; }
        }
    }
    if (!bestCorner) {
        let minDist = Infinity;
        for (const [cr, cc] of CORNERS) {
            const d = Math.abs(kr - cr) + Math.abs(kc - cc);
            if (d < minDist) { minDist = d; bestCorner = [cr, cc]; }
        }
    }
    predictedCorner = bestCorner;
}

function getCornerIndex(row, col) {
    for (let i = 0; i < CORNERS.length; i++) {
        if (CORNERS[i][0] === row && CORNERS[i][1] === col) return i;
    }
    return -1;
}

// ------------------------------------------------------------------
//  Legal moves
// ------------------------------------------------------------------
function getLegalMoves(row, col) {
    const piece = board[row][col];
    if (!piece) return [];
    const moves = [];
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dr, dc] of dirs) {
        let r = row + dr, c = col + dc;
        while (isOnBoard(r, c) && board[r][c] === EMPTY) {
            if (piece === KING) moves.push([r, c]);
            else if (piece === DEFENDER && !isRestricted(r, c)) moves.push([r,c]);
            else if (piece === ATTACKER && !isRestricted(r, c)) moves.push([r,c]);
            r += dr; c += dc;
        }
    }
    return moves;
}

function getAllMovesForPlayer(player) {
    const all = [];
    const pieces = (player === 'defenders') ? [KING, DEFENDER] : [ATTACKER];
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            const p = board[r][c];
            if (p && pieces.includes(p)) {
                for (const [nr, nc] of getLegalMoves(r, c)) {
                    all.push({ fromRow: r, fromCol: c, toRow: nr, toCol: nc });
                }
            }
        }
    }
    return all;
}

// ------------------------------------------------------------------
//  Capture logic
// ------------------------------------------------------------------
function applyCaptures(row, col) {
    const movedPiece = board[row][col];
    if (!movedPiece) return [];
    const captured = [];
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dr, dc] of dirs) {
        const r1 = row + dr, c1 = col + dc;
        if (!isOnBoard(r1, c1)) continue;
        const enemy = board[r1][c1];
        if (!enemy || isFriendly(movedPiece, enemy)) continue;
        const r2 = row + 2*dr, c2 = col + 2*dc;
        let capture = false;
        if (isOnBoard(r2, c2)) {
            const friendly = board[r2][c2];
            if (friendly && isFriendly(movedPiece, friendly)) capture = true;
        }
        if (!capture && isOnBoard(r2, c2) && isHostileTo(r2, c2, enemy)) {
            capture = true;
        }
        if (capture && enemy !== KING) {
            captured.push([r1, c1]);
        }
    }
    for (const [r, c] of captured) board[r][c] = EMPTY;
    return captured;
}

// ------------------------------------------------------------------
//  King capture check
// ------------------------------------------------------------------
function isKingCapturedState(boardState) {
    let kr = -1, kc = -1;
    for (let r=0; r<SIZE; r++) for (let c=0; c<SIZE; c++) {
        if (boardState[r][c] === KING) { kr=r; kc=c; break; }
    }
    if (kr === -1) return true;
    if (isCorner(kr, kc)) return false;
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    let sidesToCheck = 0, sidesOccupied = 0;
    for (const [dr, dc] of dirs) {
        const nr = kr+dr, nc = kc+dc;
        if (!isOnBoard(nr, nc)) continue;
        if (isThrone(nr, nc)) continue;
        sidesToCheck++;
        if (boardState[nr][nc] === ATTACKER) sidesOccupied++;
    }
    return sidesToCheck > 0 && sidesOccupied === sidesToCheck;
}

// ------------------------------------------------------------------
//  Animation (unchanged – uses floating element)
// ------------------------------------------------------------------
function animateMove(fromRow, fromCol, toRow, toCol, pieceType, callback) {
    const boardRect = boardEl.getBoundingClientRect();
    const fromCell = cells[fromRow][fromCol];
    const toCell = cells[toRow][toCol];
    if (!fromCell || !toCell) { callback(); return; }
    const fromRect = fromCell.getBoundingClientRect();
    const toRect = toCell.getBoundingClientRect();
    const pieceSize = CELL_SIZE * 0.76;
    const pieceDiv = document.createElement('img');
    pieceDiv.className = 'piece-img';
    let src = '';
    if (pieceType === KING) src = 'king.png';
    else if (pieceType === DEFENDER) src = 'defenders.png';
    else if (pieceType === ATTACKER) src = 'attackers.png';
    pieceDiv.src = src;
    pieceDiv.style.position = 'absolute';
    pieceDiv.style.width = pieceSize + 'px';
    pieceDiv.style.height = pieceSize + 'px';
    pieceDiv.style.objectFit = 'contain';
    pieceDiv.style.boxShadow = '0 2px 5px rgba(0,0,0,0.3)';
    pieceDiv.style.left = (fromRect.left - boardRect.left + (fromRect.width - pieceSize)/2) + 'px';
    pieceDiv.style.top = (fromRect.top - boardRect.top + (fromRect.height - pieceSize)/2) + 'px';
    pieceDiv.style.transition = 'left 0.28s ease, top 0.28s ease';
    pieceDiv.style.zIndex = 100;
    pieceDiv.style.pointerEvents = 'none';
    boardEl.style.position = 'relative';
    boardEl.appendChild(pieceDiv);
    void pieceDiv.offsetHeight;
    pieceDiv.style.left = (toRect.left - boardRect.left + (toRect.width - pieceSize)/2) + 'px';
    pieceDiv.style.top = (toRect.top - boardRect.top + (toRect.height - pieceSize)/2) + 'px';
    const onEnd = () => {
        if (pieceDiv.parentNode) pieceDiv.remove();
        callback();
    };
    pieceDiv.addEventListener('transitionend', onEnd, { once: true });
    setTimeout(() => {
        if (pieceDiv.parentNode) {
            pieceDiv.remove();
            callback();
        }
    }, 350);
}

// ------------------------------------------------------------------
//  Event delegation: single click listener on boardEl
// ------------------------------------------------------------------
boardEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    const row = parseInt(cell.dataset.row);
    const col = parseInt(cell.dataset.col);
    onCellClick(row, col);
});

// ------------------------------------------------------------------
//  Core move
// ------------------------------------------------------------------
function performMove(fromRow, fromCol, toRow, toCol) {
    if (gameOver || isAnimating) return false;
    const piece = board[fromRow][fromCol];
    if (!piece) return false;
    board[toRow][toCol] = piece;
    board[fromRow][fromCol] = EMPTY;
    applyCaptures(toRow, toCol);
    moveCount++;
    let winner = null;
    if (piece === KING && isCorner(toRow, toCol)) {
        winner = 'white';
        gameOver = true;
    } else if (isKingCapturedState(board)) {
        winner = 'black';
        gameOver = true;
    }
    if (piece === KING) updateKingTracking();
    renderBoard();
    isAnimating = true;
    animateMove(fromRow, fromCol, toRow, toCol, piece, () => {
        isAnimating = false;
        if (gameOver) {
            const winTitle = document.getElementById('win-title');
            const winMessage = document.getElementById('win-message');
            const winOverlay = document.getElementById('win-overlay');
            if (winner === 'white') {
                winTitle.textContent = '🏆 Defenders Win!';
                winMessage.textContent = 'The King escaped to the corner!';
            } else if (winner === 'black') {
                winTitle.textContent = '⚔️ Attackers Win!';
                winMessage.textContent = 'The King has been captured!';
            }
            winOverlay.classList.remove('hidden');
            renderBoard();
            return;
        }
        if (gameMode === 'computer') {
            currentTurn = (currentTurn === 'player') ? 'computer' : 'player';
        } else {
            currentTurn = (currentTurn === 'player') ? 'human2' : 'player';
        }
        selectedRow = -1; selectedCol = -1; legalMovesForSelected = [];
        if (gameMode === 'computer') {
            if (currentTurn === 'player') {
                const sideName = (playerSide === 'white') ? 'Defenders' : 'Attackers';
                updateStatus(`Your turn (${sideName})`);
            } else {
                const sideName = (aiSide === 'white') ? 'Defenders' : 'Attackers';
                updateStatus(`Computer (${sideName}) is thinking...`, true);
                renderBoard();
                setTimeout(() => computerMove(), 300);
                return;
            }
        } else {
            if (currentTurn === 'player') {
                updateStatus('Player 1\'s turn (Defenders)');
            } else {
                updateStatus('Player 2\'s turn (Attackers)');
            }
        }
        renderBoard();
    });
    return true;
}

// ------------------------------------------------------------------
//  AI Evaluation (unchanged – keep your existing AI code)
// ------------------------------------------------------------------
// [All your AI functions – isCornerBlocked, evaluateAttackerMove, evaluateDefenderMove, etc. – remain exactly as they were]
// I'll omit them here for brevity, but they stay in your file.

// ------------------------------------------------------------------
//  Computer move dispatcher (unchanged)
// ------------------------------------------------------------------
function computerMove() {
    // ... your existing computerMove function ...
}

// ------------------------------------------------------------------
//  Player click handler (now simplified because event delegation handles the click)
// ------------------------------------------------------------------
function onCellClick(row, col) {
    if (gameOver || isAnimating) return;

    if (gameMode === 'computer' && currentTurn !== 'player') return;

    const activeSide = (currentTurn === 'player') ? playerSide : 'black';
    const piece = board[row][col];

    if (selectedRow !== -1 && legalMovesForSelected.some(([r, c]) => r === row && c === col)) {
        performMove(selectedRow, selectedCol, row, col);
        return;
    }

    if (gameMode === 'human') {
        if (!piece) {
            selectedRow = -1; selectedCol = -1; legalMovesForSelected = [];
            renderBoard();
            const turnName = (currentTurn === 'player') ? 'Player 1' : 'Player 2';
            updateStatus(`${turnName}'s turn`);
            return;
        }
        const side = getSide(piece);
        if ((currentTurn === 'player' && side !== 'white') ||
            (currentTurn === 'human2' && side !== 'black')) {
            return;
        }
    }

    if (gameMode === 'computer') {
        if (!piece) {
            selectedRow = -1; selectedCol = -1; legalMovesForSelected = [];
            renderBoard();
            const sideName = (playerSide === 'white') ? 'Defenders' : 'Attackers';
            updateStatus(`Your turn (${sideName})`);
            return;
        }
        const side = getSide(piece);
        if (side !== playerSide) return;
    }

    if (piece && getSide(piece) === activeSide) {
        const moves = getLegalMoves(row, col);
        if (moves.length > 0) {
            selectedRow = row;
            selectedCol = col;
            legalMovesForSelected = moves;
            renderBoard();
            if (gameMode === 'computer') {
                const sideName = (playerSide === 'white') ? 'Defenders' : 'Attackers';
                updateStatus(`Select destination (${sideName})`);
            } else {
                const pName = (activeSide === 'white') ? 'Player 1' : 'Player 2';
                updateStatus(`${pName} – select destination`);
            }
        } else {
            selectedRow = -1; selectedCol = -1; legalMovesForSelected = [];
            renderBoard();
            updateStatus('That piece has no moves');
        }
        return;
    }

    selectedRow = -1; selectedCol = -1; legalMovesForSelected = [];
    renderBoard();
    if (gameMode === 'computer') {
        const sideName = (playerSide === 'white') ? 'Defenders' : 'Attackers';
        updateStatus(`Your turn (${sideName})`);
    } else {
        const turnName = (currentTurn === 'player') ? 'Player 1' : 'Player 2';
        updateStatus(`${turnName}'s turn`);
    }
}

// ------------------------------------------------------------------
//  Reset
// ------------------------------------------------------------------
function resetGame(preserveMode = false) {
    document.getElementById('win-overlay').classList.add('hidden');

    if (!preserveMode && !gameMode) {
        showMenu();
        return;
    }

    initBoard();
    gameOver = false;
    selectedRow = -1; selectedCol = -1; legalMovesForSelected = [];
    isAnimating = false;
    moveCount = 0;
    kingHistory = [];
    predictedCorner = null;
    kingLeftThrone = false;

    if (gameMode === 'computer') {
        currentTurn = 'player';
        const sideName = (playerSide === 'white') ? 'Defenders' : 'Attackers';
        updateStatus(`Your turn (${sideName})`);
    } else {
        currentTurn = 'player';
        updateStatus('Player 1\'s turn (Defenders)');
    }
    updateBoardSize();
    renderBoard();
    menuOverlay.classList.add('hidden');
    coinOverlay.classList.add('hidden');
}

// ------------------------------------------------------------------
//  New Game button
// ------------------------------------------------------------------
document.getElementById('reset-btn').addEventListener('click', () => {
    gameMode = null;
    showMenu();
    initBoard();
    renderBoard();
    updateStatus('Choose a game mode');
});

// ------------------------------------------------------------------
//  Start
// ------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
    updateBoardSize();
    initBoard();
    buildBoardCells();   // create DOM cells once
    renderBoard();
    showMenu();
    updateStatus('Choose a game mode');

    window.addEventListener('resize', () => {
        updateBoardSize();
        if (!menuOverlay.classList.contains('hidden')) return;
        renderBoard();
    });

    document.getElementById('win-close-btn').addEventListener('click', () => {
        document.getElementById('win-overlay').classList.add('hidden');
        resetGame(true);
    });
});
