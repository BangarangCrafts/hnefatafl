// ============================================================
//  Hnefatafl – Complete Game with Coin Flip & AI for both sides
//  Uses .webp images for faster loading
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

    // Reset coin to starting position
    coinEl.classList.remove('flipping');
    coinEl.style.transform = 'rotateY(0deg)';
    coinEl.style.transition = 'none';

    // Force reflow
    void coinEl.offsetHeight;

    // ---- Generate truly random result ----
    const randomBytes = new Uint8Array(1);
    crypto.getRandomValues(randomBytes);
    const result = randomBytes[0] < 128 ? 0 : 1;

    const finalAngle = result === 0 ? 0 : 180;
    const sideText = result === 0 ? 'Defenders' : 'Attackers';
    const emoji = result === 0 ? '🛡️' : '⚔️';

    // ---- Start flip animation ----
    coinEl.style.transition = 'transform 1.4s cubic-bezier(0.15, 0.85, 0.35, 1)';

    // Total rotation: 3 full spins + final angle
    const totalRotation = 3 * 360 + finalAngle;
    coinEl.style.transform = `rotateY(${totalRotation}deg)`;

    // ---- Show result after animation ----
    setTimeout(() => {
        // Ensure final position is exact
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

    // Attackers: (0,3-7) + (1,5) per side
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
//  Rendering (UPDATED: .webp images)
// ------------------------------------------------------------------
function renderBoard() {
    boardEl.innerHTML = '';
    for (let r = 0; r < SIZE; r++) {
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

            const piece = board[r][c];
            if (piece) {
                const img = document.createElement('img');
                img.className = 'piece-img';
                let src = '';
                if (piece === KING) src = 'king.webp';
                else if (piece === DEFENDER) src = 'Defenders.webp';
                else if (piece === ATTACKER) src = 'Attackers.webp';
                img.src = src;
                img.alt = piece;
                cell.appendChild(img);
            }

            if (selectedRow === r && selectedCol === c) cell.classList.add('selected');
            if (legalMovesForSelected.some(([mr, mc]) => mr === r && mc === c)) {
                cell.classList.add('selectable');
            }

            cell.addEventListener('click', () => onCellClick(r, c));
            boardEl.appendChild(cell);
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
//  Animation (UPDATED: .webp images)
// ------------------------------------------------------------------
function animateMove(fromRow, fromCol, toRow, toCol, pieceType, callback) {
    const boardRect = boardEl.getBoundingClientRect();
    const fromCell = document.querySelector(`.cell[data-row="${fromRow}"][data-col="${fromCol}"]`);
    const toCell = document.querySelector(`.cell[data-row="${toRow}"][data-col="${toCol}"]`);
    if (!fromCell || !toCell) { callback(); return; }
    const fromRect = fromCell.getBoundingClientRect();
    const toRect = toCell.getBoundingClientRect();
    const pieceSize = CELL_SIZE * 0.76;
    const pieceDiv = document.createElement('img');
    pieceDiv.className = 'piece-img';
    let src = '';
    if (pieceType === KING) src = 'king.webp';
    else if (pieceType === DEFENDER) src = 'Defenders.webp';
    else if (pieceType === ATTACKER) src = 'Attackers.webp';
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
            // ---- SHOW WIN OVERLAY ----
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
            // ---- HUMAN MODE: use "Defenders" and "Attackers" ----
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
//  AI Evaluation for both sides
// ------------------------------------------------------------------

// ---------- Attacker AI ----------
function isCornerBlocked(cornerIndex) {
    const pattern = BARRICADE_PATTERNS[cornerIndex];
    if (!pattern) return false;
    for (const [r, c] of pattern) {
        if (!isOnBoard(r, c) || board[r][c] !== ATTACKER) return false;
    }
    return true;
}

function countBlockedCorners() {
    let count = 0;
    for (let i = 0; i < 4; i++) if (isCornerBlocked(i)) count++;
    return count;
}

function getNearestBarricadeSquare(kingRow, kingCol) {
    let bestScore = -Infinity, bestSquare = null;
    let predictedIdx = -1;
    if (predictedCorner) predictedIdx = getCornerIndex(predictedCorner[0], predictedCorner[1]);
    for (let ci = 0; ci < BARRICADE_PATTERNS.length; ci++) {
        const pattern = BARRICADE_PATTERNS[ci];
        let filled = 0, emptySquares = [];
        for (const [r, c] of pattern) {
            if (board[r][c] === ATTACKER) filled++;
            else if (board[r][c] === EMPTY) emptySquares.push([r, c]);
        }
        if (filled === 3) continue;
        const corner = CORNERS[ci];
        const kingDist = Math.abs(kingRow - corner[0]) + Math.abs(kingCol - corner[1]);
        const fillScore = filled * 100;
        let predictionBonus = 0;
        if (ci === predictedIdx && kingLeftThrone) {
            predictionBonus = 300;
            if (kingDist <= 4) predictionBonus += 200;
            if (kingDist <= 2) predictionBonus += 300;
        }
        let edgeEmergency = 0;
        if (isEdge(kingRow, kingCol)) {
            const distToCorner = Math.abs(kingRow - corner[0]) + Math.abs(kingCol - corner[1]);
            if (distToCorner <= 3) edgeEmergency = 800 - distToCorner * 100;
        }
        const proximityScore = Math.max(0, 50 - kingDist * 2);
        for (const [r, c] of emptySquares) {
            let totalScore = fillScore + proximityScore + predictionBonus + edgeEmergency + (Math.random() * 5);
            if (!isAdjacentToCorner(r, c)) totalScore += 30;
            else if (kingDist <= 3) totalScore -= 80;
            if (totalScore > bestScore) { bestScore = totalScore; bestSquare = [r, c]; }
        }
    }
    return bestSquare;
}

function isDirectEdgeBlocker(row, col, kingRow, kingCol) {
    if (!isEdge(kingRow, kingCol) || !isEdge(row, col)) return false;
    if (Math.abs(row - kingRow) + Math.abs(col - kingCol) !== 1) return false;
    if (kingRow === 0) {
        if (kingCol < 5) return col < kingCol && col >= 0;
        else return col > kingCol && col <= 10;
    } else if (kingRow === 10) {
        if (kingCol < 5) return col < kingCol && col >= 0;
        else return col > kingCol && col <= 10;
    } else if (kingCol === 0) {
        if (kingRow < 5) return row < kingRow && row >= 0;
        else return row > kingRow && row <= 10;
    } else if (kingCol === 10) {
        if (kingRow < 5) return row < kingRow && row >= 0;
        else return row > kingRow && row <= 10;
    }
    return false;
}

function countKingSidesOccupied(boardState) {
    let kr = -1, kc = -1;
    for (let r=0; r<SIZE; r++) for (let c=0; c<SIZE; c++) {
        if (boardState[r][c] === KING) { kr=r; kc=c; break; }
    }
    if (kr === -1) return 4;
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    let occupied = 0;
    for (const [dr, dc] of dirs) {
        const nr = kr+dr, nc = kc+dc;
        if (!isOnBoard(nr, nc)) continue;
        if (isThrone(nr, nc)) continue;
        if (boardState[nr][nc] === ATTACKER) occupied++;
    }
    return occupied;
}

function evaluateAttackerMove(move, kingRow, kingCol) {
    const simBoard = board.map(row => [...row]);
    const piece = simBoard[move.fromRow][move.fromCol];
    simBoard[move.toRow][move.toCol] = piece;
    simBoard[move.fromRow][move.fromCol] = EMPTY;
    let score = 0;
    const phase = moveCount < 10 ? 'early' : (moveCount < 25 ? 'mid' : 'late');

    if (isKingCapturedState(simBoard)) return 10000;

    const sidesAfter = countKingSidesOccupied(simBoard);
    const sidesBefore = countKingSidesOccupied(board);
    if (sidesAfter > sidesBefore) {
        score += (sidesAfter - sidesBefore) * 1000;
        if (sidesAfter === 3) score += 5000;
    }
    if (phase === 'late' && Math.abs(move.toRow - kingRow) + Math.abs(move.toCol - kingCol) === 1) score += 300;
    if (Math.abs(move.fromRow - kingRow) + Math.abs(move.fromCol - kingCol) === 1 && piece === ATTACKER) score -= 200;

    let captures = 0;
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dr, dc] of dirs) {
        const r1 = move.toRow+dr, c1 = move.toCol+dc;
        if (!isOnBoard(r1,c1)) continue;
        const enemy = simBoard[r1][c1];
        if (enemy !== DEFENDER && enemy !== KING) continue;
        if (enemy === KING) continue;
        const r2 = move.toRow+2*dr, c2 = move.toCol+2*dc;
        let capture = false;
        if (isOnBoard(r2,c2) && simBoard[r2][c2] === ATTACKER) capture = true;
        if (!capture && isOnBoard(r2,c2) && isHostileTo(r2,c2, enemy)) capture = true;
        if (capture) captures++;
    }
    if (captures > 0) score += (phase === 'early' ? 800 : 1200) * captures;

    if (isEdge(kingRow, kingCol)) {
        if (isDirectEdgeBlocker(move.toRow, move.toCol, kingRow, kingCol)) {
            let cornerDist = Infinity;
            for (const [cr, cc] of CORNERS) {
                const d = Math.abs(kingRow - cr) + Math.abs(kingCol - cc);
                if (d < cornerDist) cornerDist = d;
            }
            score += 2000 + Math.max(100, 1000 - cornerDist * 100);
        }
        if (isDirectEdgeBlocker(move.fromRow, move.fromCol, kingRow, kingCol) && piece === ATTACKER) {
            score -= 1500;
        }
    }

    if (phase === 'early' || phase === 'mid') {
        for (let ci = 0; ci < BARRICADE_PATTERNS.length; ci++) {
            const pattern = BARRICADE_PATTERNS[ci];
            let wouldComplete = true;
            for (const [r, c] of pattern) {
                if (r === move.toRow && c === move.toCol) continue;
                if (simBoard[r][c] !== ATTACKER) { wouldComplete = false; break; }
            }
            if (wouldComplete) {
                let bonus = 5000;
                if (predictedCorner && getCornerIndex(predictedCorner[0], predictedCorner[1]) === ci) bonus += 3000;
                if (isEdge(kingRow, kingCol)) {
                    const corner = CORNERS[ci];
                    if (Math.abs(kingRow - corner[0]) + Math.abs(kingCol - corner[1]) <= 3) bonus += 3000;
                }
                score += bonus;
            }
        }
        const target = getNearestBarricadeSquare(kingRow, kingCol);
        if (target) {
            const [tr, tc] = target;
            const curDist = Math.abs(move.fromRow - tr) + Math.abs(move.fromCol - tc);
            const newDist = Math.abs(move.toRow - tr) + Math.abs(move.toCol - tc);
            if (newDist < curDist) {
                let bonus = 60;
                if (isEdge(kingRow, kingCol)) {
                    for (let ci=0; ci<BARRICADE_PATTERNS.length; ci++) {
                        if (BARRICADE_PATTERNS[ci].some(([pr,pc]) => pr===tr && pc===tc)) {
                            const corner = CORNERS[ci];
                            if (Math.abs(kingRow - corner[0]) + Math.abs(kingCol - corner[1]) <= 3) bonus = 300;
                            break;
                        }
                    }
                }
                if (predictedCorner) {
                    const predIdx = getCornerIndex(predictedCorner[0], predictedCorner[1]);
                    if (BARRICADE_PATTERNS[predIdx] && BARRICADE_PATTERNS[predIdx].some(([pr,pc]) => pr===tr && pc===tc)) {
                        bonus = Math.max(bonus, 120);
                    }
                }
                score += (curDist - newDist) * bonus;
            }
            if (move.toRow === tr && move.toCol === tc) {
                let bonus = 200;
                if (isEdge(kingRow, kingCol)) {
                    for (let ci=0; ci<BARRICADE_PATTERNS.length; ci++) {
                        if (BARRICADE_PATTERNS[ci].some(([pr,pc]) => pr===tr && pc===tc)) {
                            const corner = CORNERS[ci];
                            if (Math.abs(kingRow - corner[0]) + Math.abs(kingCol - corner[1]) <= 3) bonus = 600;
                            break;
                        }
                    }
                }
                if (predictedCorner) {
                    const predIdx = getCornerIndex(predictedCorner[0], predictedCorner[1]);
                    if (BARRICADE_PATTERNS[predIdx] && BARRICADE_PATTERNS[predIdx].some(([pr,pc]) => pr===tr && pc===tc)) {
                        bonus = Math.max(bonus, 500);
                    }
                }
                score += bonus;
                if (!isAdjacentToCorner(tr, tc)) score += 50;
            }
        }
        if (isAdjacentToCorner(move.toRow, move.toCol)) {
            for (const [cr, cc] of CORNERS) {
                if (Math.abs(move.toRow - cr) + Math.abs(move.toCol - cc) === 1) {
                    if (Math.abs(kingRow - cr) + Math.abs(kingCol - cc) <= 3) score -= 100;
                    break;
                }
            }
        }
    }

    if (phase === 'mid' || phase === 'late') {
        const distToKing = Math.abs(move.toRow - kingRow) + Math.abs(move.toCol - kingCol);
        const curDist = Math.abs(move.fromRow - kingRow) + Math.abs(move.fromCol - kingCol);
        if (phase === 'mid') {
            const optimal = 4;
            score += (optimal - Math.abs(distToKing - optimal)) * 10;
        } else {
            score += (curDist - distToKing) * 25;
        }
    }

    if (isEdge(move.toRow, move.toCol)) {
        let edgeBonus = 15;
        for (const [cr, cc] of CORNERS) {
            const d = Math.abs(move.toRow - cr) + Math.abs(move.toCol - cc);
            if (d <= 3) edgeBonus += (4 - d) * 10;
        }
        score += edgeBonus;
    }

    if (phase === 'early') {
        const cd = Math.abs(move.toRow - CENTER) + Math.abs(move.toCol - CENTER);
        score += (10 - cd) * 2;
    }

    if (phase === 'early' && Math.abs(move.toRow - kingRow) + Math.abs(move.toCol - kingCol) <= 2) score -= 30;

    score += (Math.random() * 6) - 3;
    return score;
}

// ---------- Defender AI ----------
function evaluateDefenderMove(move, kingRow, kingCol) {
    const simBoard = board.map(row => [...row]);
    const piece = simBoard[move.fromRow][move.fromCol];
    simBoard[move.toRow][move.toCol] = piece;
    simBoard[move.fromRow][move.fromCol] = EMPTY;

    let score = 0;

    // 1. Capture attackers
    let captures = 0;
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dr, dc] of dirs) {
        const r1 = move.toRow + dr, c1 = move.toCol + dc;
        if (!isOnBoard(r1, c1)) continue;
        const enemy = simBoard[r1][c1];
        if (enemy !== ATTACKER) continue;
        const r2 = move.toRow + 2*dr, c2 = move.toCol + 2*dc;
        let capture = false;
        if (isOnBoard(r2, c2) && simBoard[r2][c2] === DEFENDER) capture = true;
        if (!capture && isOnBoard(r2, c2) && isHostileTo(r2, c2, enemy)) capture = true;
        if (capture) captures++;
    }
    if (captures > 0) score += 1200 * captures;

    // 2. King moves
    if (piece === KING) {
        const kingSafe = isKingSafeAfterMove(simBoard);
        if (kingSafe) score += 200;
        else score -= 500;

        let minDist = Infinity;
        for (const [cr, cc] of CORNERS) {
            const d = Math.abs(move.toRow - cr) + Math.abs(move.toCol - cc);
            if (d < minDist) minDist = d;
        }
        if (minDist < 6) score += (6 - minDist) * 30;

        if (isCorner(move.toRow, move.toCol)) {
            score += 10000;
        }

        let adjacentAttackers = 0;
        for (const [dr, dc] of dirs) {
            const nr = move.toRow + dr, nc = move.toCol + dc;
            if (isOnBoard(nr, nc) && simBoard[nr][nc] === ATTACKER) adjacentAttackers++;
        }
        if (adjacentAttackers >= 3) score -= 1000;
        else if (adjacentAttackers === 2) score -= 300;
        else if (adjacentAttackers === 1) score -= 50;
    } else {
        const distFromKing = Math.abs(move.toRow - kingRow) + Math.abs(move.toCol - kingCol);
        const curDist = Math.abs(move.fromRow - kingRow) + Math.abs(move.fromCol - kingCol);
        if (distFromKing < curDist) {
            score += (curDist - distFromKing) * 20;
        }
        if (distFromKing === 1) score += 30;
    }

    score += (Math.random() * 4) - 2;
    return score;
}

function isKingSafeAfterMove(boardState) {
    let kr = -1, kc = -1;
    for (let r=0; r<SIZE; r++) for (let c=0; c<SIZE; c++) {
        if (boardState[r][c] === KING) { kr=r; kc=c; break; }
    }
    if (kr === -1) return false;
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    let adjacentAttackers = 0;
    for (const [dr, dc] of dirs) {
        const nr = kr+dr, nc = kc+dc;
        if (isOnBoard(nr, nc) && boardState[nr][nc] === ATTACKER) adjacentAttackers++;
    }
    return adjacentAttackers < 3;
}

// ------------------------------------------------------------------
//  Computer move dispatcher
// ------------------------------------------------------------------
function computerMove() {
    if (gameOver || isAnimating || gameMode !== 'computer') return;
    if (currentTurn !== 'computer') return;

    const isAttacker = (aiSide === 'black');
    const playerType = isAttacker ? 'attackers' : 'defenders';
    const allMoves = getAllMovesForPlayer(playerType);
    if (allMoves.length === 0) {
        updateStatus('Computer has no moves! Draw?');
        gameOver = true;
        renderBoard();
        return;
    }

    let kingRow = -1, kingCol = -1;
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (board[r][c] === KING) { kingRow = r; kingCol = c; break; }
        }
        if (kingRow !== -1) break;
    }

    let bestScore = -Infinity;
    let bestMoves = [];
    for (const move of allMoves) {
        let score;
        if (isAttacker) {
            score = evaluateAttackerMove(move, kingRow, kingCol);
        } else {
            score = evaluateDefenderMove(move, kingRow, kingCol);
        }
        if (score > bestScore) {
            bestScore = score;
            bestMoves = [move];
        } else if (score === bestScore) {
            bestMoves.push(move);
        }
    }

    const chosen = bestMoves[Math.floor(Math.random() * bestMoves.length)];
    performMove(chosen.fromRow, chosen.fromCol, chosen.toRow, chosen.toCol);
}

// ------------------------------------------------------------------
//  Player click handler
// ------------------------------------------------------------------
function onCellClick(row, col) {
    if (gameOver || isAnimating) return;

    if (gameMode === 'computer' && currentTurn !== 'player') return;

    const activeSide = (currentTurn === 'player') ? playerSide : 'black';
    const piece = board[row][col];

    // ---- STEP 1: Check if clicking on a legal move destination ----
    if (selectedRow !== -1 && legalMovesForSelected.some(([r, c]) => r === row && c === col)) {
        performMove(selectedRow, selectedCol, row, col);
        return;
    }

    // ---- STEP 2: HUMAN MODE ----
    if (gameMode === 'human') {
        if (!piece) {
            selectedRow = -1;
            selectedCol = -1;
            legalMovesForSelected = [];
            renderBoard();
            const turnName = (currentTurn === 'player') ? 'Player 1' : 'Player 2';
            updateStatus(`${turnName}'s turn`);
            return;
        }
        const side = getSide(piece);
        if ((currentTurn === 'player' && side !== 'white') ||
            (currentTurn === 'human2' && side !== 'black')) {
            return; // Not your piece
        }
    }

    // ---- STEP 3: COMPUTER MODE ----
    if (gameMode === 'computer') {
        if (!piece) {
            selectedRow = -1;
            selectedCol = -1;
            legalMovesForSelected = [];
            renderBoard();
            const sideName = (playerSide === 'white') ? 'Defenders' : 'Attackers';
            updateStatus(`Your turn (${sideName})`);
            return;
        }
        const side = getSide(piece);
        if (side !== playerSide) return; // Not your piece
    }

    // ---- STEP 4: Select a piece ----
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
            selectedRow = -1;
            selectedCol = -1;
            legalMovesForSelected = [];
            renderBoard();
            updateStatus('That piece has no moves');
        }
        return;
    }

    // ---- STEP 5: Clear selection ----
    selectedRow = -1;
    selectedCol = -1;
    legalMovesForSelected = [];
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
    // ---- HIDE WIN OVERLAY ----
    document.getElementById('win-overlay').classList.add('hidden');

    // If preserveMode is true, we keep the current gameMode and side assignments
    // Otherwise, we go back to the menu (if gameMode is null)
    if (!preserveMode && !gameMode) {
        showMenu();
        return;
    }

    initBoard();
    gameOver = false;
    selectedRow = -1;
    selectedCol = -1;
    legalMovesForSelected = [];
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
    // ---- Update board size on load ----
    updateBoardSize();
    initBoard();
    renderBoard();
    showMenu();
    updateStatus('Choose a game mode');

    // ---- Resize handler ----
    window.addEventListener('resize', () => {
        updateBoardSize();
        if (!menuOverlay.classList.contains('hidden')) return;
        renderBoard();
    });

    // ---- WIN OVERLAY "PLAY AGAIN" BUTTON ----
    const winCloseBtn = document.getElementById('win-close-btn');
    if (winCloseBtn) {
        winCloseBtn.addEventListener('click', () => {
            document.getElementById('win-overlay').classList.add('hidden');
            // Restart with the same mode and side
            resetGame(true);
        });
    }
});
