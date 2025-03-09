// Retro Pinball Game Logic

// Game variables
let score = 0;
let gameActive = false;
let ballActive = false;
let ballX, ballY;
let ballSpeedX = 0;
let ballSpeedY = 0;
let gravity = 0.2;
let friction = 0.98;
let leftFlipperUp = false;
let rightFlipperUp = false;
let launchPower = 0;
let launchPressed = false;
let gameLoop;
let lives = 3;

// Sound effects
let bumperSound, targetSound, flipperSound, launchSound, gameOverSound;

// DOM Elements
const ball = document.getElementById('ball');
const leftFlipper = document.getElementById('leftFlipper');
const rightFlipper = document.getElementById('rightFlipper');
const launcher = document.getElementById('launcher');
const scoreDisplay = document.getElementById('score');
const startButton = document.getElementById('startButton');
const gameOverlay = document.getElementById('gameOverlay');
const gameBoard = document.querySelector('.game-board');

// Game board dimensions
let boardWidth, boardHeight;
let boardRect;

// Game elements
const bumpers = document.querySelectorAll('.bumper');
const targets = document.querySelectorAll('.target');
const walls = document.querySelectorAll('.wall');

// Initialize the game
function initGame() {
    // Update board dimensions
    updateBoardDimensions();
    
    // Reset game state
    score = 0;
    lives = 3;
    scoreDisplay.textContent = score;
    
    // Create audio elements
    createSoundEffects();
    
    // Set up event listeners
    setupEventListeners();
    
    // Position the ball in the launcher
    resetBall();
    
    // Hide overlay
    gameOverlay.style.display = 'none';
    
    // Start game loop
    gameActive = true;
    if (gameLoop) clearInterval(gameLoop);
    gameLoop = setInterval(updateGame, 16); // ~60fps
}

function updateBoardDimensions() {
    boardRect = gameBoard.getBoundingClientRect();
    boardWidth = boardRect.width;
    boardHeight = boardRect.height;
}

function createSoundEffects() {
    // Create audio elements for sound effects
    // In a real implementation, you would load actual sound files
    bumperSound = new Audio();
    targetSound = new Audio();
    flipperSound = new Audio();
    launchSound = new Audio();
    gameOverSound = new Audio();
    
    // Set audio sources (commented out as we don't have actual files yet)
    /*
    bumperSound.src = 'assets/sounds/bumper.wav';
    targetSound.src = 'assets/sounds/target.wav';
    flipperSound.src = 'assets/sounds/flipper.wav';
    launchSound.src = 'assets/sounds/launch.wav';
    gameOverSound.src = 'assets/sounds/game-over.wav';
    */
}

function setupEventListeners() {
    // Keyboard controls
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    
    // Start button
    startButton.addEventListener('click', initGame);
    
    // Launcher click/touch
    launcher.addEventListener('mousedown', startLaunch);
    launcher.addEventListener('mouseup', releaseLaunch);
    launcher.addEventListener('touchstart', startLaunch);
    launcher.addEventListener('touchend', releaseLaunch);
    
    // Window resize
    window.addEventListener('resize', updateBoardDimensions);
}

function handleKeyDown(e) {
    if (!gameActive) return;
    
    switch(e.key.toLowerCase()) {
        case 'z':
            leftFlipperUp = true;
            leftFlipper.classList.add('active');
            playSound(flipperSound);
            break;
        case '/':
            rightFlipperUp = true;
            rightFlipper.classList.add('active');
            playSound(flipperSound);
            break;
        case ' ':
            if (!ballActive) {
                startLaunch(e);
            }
            break;
    }
}

function handleKeyUp(e) {
    switch(e.key.toLowerCase()) {
        case 'z':
            leftFlipperUp = false;
            leftFlipper.classList.remove('active');
            break;
        case '/':
            rightFlipperUp = false;
            rightFlipper.classList.remove('active');
            break;
        case ' ':
            if (!ballActive) {
                releaseLaunch(e);
            }
            break;
    }
}

function startLaunch(e) {
    if (!gameActive || ballActive) return;
    
    launchPressed = true;
    launcher.classList.add('active');
    
    // Animate launcher pull-back
    launchPower = 0;
    const powerInterval = setInterval(() => {
        if (!launchPressed) {
            clearInterval(powerInterval);
            return;
        }
        
        launchPower += 0.5;
        if (launchPower > 15) launchPower = 15;
    }, 100);
}

function releaseLaunch(e) {
    if (!gameActive || ballActive) return;
    
    launchPressed = false;
    launcher.classList.remove('active');
    
    // Launch the ball
    ballActive = true;
    ball.classList.add('active');
    ballSpeedY = -launchPower;
    playSound(launchSound);
}

function resetBall() {
    // Position ball in launcher
    const launcherRect = launcher.getBoundingClientRect();
    ballX = boardWidth - 45;
    ballY = boardHeight - 100;
    
    // Reset ball state
    ballSpeedX = 0;
    ballSpeedY = 0;
    ballActive = false;
    
    // Update ball position
    ball.style.left = `${ballX}px`;
    ball.style.top = `${ballY}px`;
    ball.classList.remove('active');
}

function updateGame() {
    if (!gameActive) return;
    
    if (ballActive) {
        // Apply gravity
        ballSpeedY += gravity;
        
        // Apply friction
        ballSpeedX *= friction;
        ballSpeedY *= friction;
        
        // Update ball position
        ballX += ballSpeedX;
        ballY += ballSpeedY;
        
        // Check for collisions
        checkCollisions();
        
        // Update ball position
        ball.style.left = `${ballX}px`;
        ball.style.top = `${ballY}px`;
        
        // Check if ball is out of bounds
        if (ballY > boardHeight) {
            lives--;
            if (lives <= 0) {
                endGame();
            } else {
                resetBall();
            }
        }
    }
}

function checkCollisions() {
    const ballRadius = 10; // Half of ball width/height
    
    // Check flipper collisions
    if (leftFlipperUp && checkFlipperCollision(leftFlipper, ballX, ballY, ballRadius)) {
        ballSpeedY = -10 - Math.random() * 5;
        ballSpeedX = -5 - Math.random() * 3;
    }
    
    if (rightFlipperUp && checkFlipperCollision(rightFlipper, ballX, ballY, ballRadius)) {
        ballSpeedY = -10 - Math.random() * 5;
        ballSpeedX = 5 + Math.random() * 3;
    }
    
    // Check bumper collisions
    bumpers.forEach(bumper => {
        if (checkCircleCollision(bumper, ballX, ballY, ballRadius)) {
            // Bounce off bumper
            const bumperRect = bumper.getBoundingClientRect();
            const bumperX = bumperRect.left - boardRect.left + bumperRect.width / 2;
            const bumperY = bumperRect.top - boardRect.top + bumperRect.height / 2;
            
            // Calculate angle and apply bounce force
            const angle = Math.atan2(ballY - bumperY, ballX - bumperX);
            ballSpeedX = Math.cos(angle) * 10;
            ballSpeedY = Math.sin(angle) * 10;
            
            // Add score and play sound
            addScore(100);
            playSound(bumperSound);
            
            // Add hit animation
            bumper.classList.add('hit');
            setTimeout(() => bumper.classList.remove('hit'), 300);
        }
    });
    
    // Check target collisions
    targets.forEach(target => {
        if (checkRectCollision(target, ballX, ballY, ballRadius)) {
            // Bounce off target
            const targetRect = target.getBoundingClientRect();
            const targetX = targetRect.left - boardRect.left + targetRect.width / 2;
            const targetY = targetRect.top - boardRect.top + targetRect.height / 2;
            
            // Calculate angle and apply bounce force
            const angle = Math.atan2(ballY - targetY, ballX - targetX);
            ballSpeedX = Math.cos(angle) * 8;
            ballSpeedY = Math.sin(angle) * 8;
            
            // Add score and play sound
            addScore(200);
            playSound(targetSound);
            
            // Add hit animation
            target.classList.add('hit');
            setTimeout(() => target.classList.remove('hit'), 300);
        }
    });
    
    // Check wall collisions
    walls.forEach(wall => {
        if (checkRectCollision(wall, ballX, ballY, ballRadius)) {
            const wallRect = wall.getBoundingClientRect();
            
            // Determine which wall was hit and bounce accordingly
            if (wall.classList.contains('left-wall') || wall.classList.contains('right-wall')) {
                ballSpeedX = -ballSpeedX * 0.8;
            } else if (wall.classList.contains('top-wall')) {
                ballSpeedY = -ballSpeedY * 0.8;
            }
        }
    });
    
    // Check board boundaries
    if (ballX < ballRadius) {
        ballX = ballRadius;
        ballSpeedX = -ballSpeedX * 0.8;
    } else if (ballX > boardWidth - ballRadius) {
        ballX = boardWidth - ballRadius;
        ballSpeedX = -ballSpeedX * 0.8;
    }
    
    if (ballY < ballRadius) {
        ballY = ballRadius;
        ballSpeedY = -ballSpeedY * 0.8;
    }
}

function checkFlipperCollision(flipper, x, y, radius) {
    const flipperRect = flipper.getBoundingClientRect();
    const flipperX = flipperRect.left - boardRect.left + flipperRect.width / 2;
    const flipperY = flipperRect.top - boardRect.top;
    
    // Simple distance check for demo purposes
    const distance = Math.sqrt(
        Math.pow(x - flipperX, 2) + 
        Math.pow(y - flipperY, 2)
    );
    
    return distance < (radius + flipperRect.width / 2);
}

function checkCircleCollision(element, x, y, radius) {
    const rect = element.getBoundingClientRect();
    const elementX = rect.left - boardRect.left + rect.width / 2;
    const elementY = rect.top - boardRect.top + rect.height / 2;
    
    const distance = Math.sqrt(
        Math.pow(x - elementX, 2) + 
        Math.pow(y - elementY, 2)
    );
    
    return distance < (radius + rect.width / 2);
}

function checkRectCollision(element, x, y, radius) {
    const rect = element.getBoundingClientRect();
    const elementLeft = rect.left - boardRect.left;
    const elementRight = elementLeft + rect.width;
    const elementTop = rect.top - boardRect.top;
    const elementBottom = elementTop + rect.height;
    
    // Check if ball overlaps with rectangle
    const closestX = Math.max(elementLeft, Math.min(x, elementRight));
    const closestY = Math.max(elementTop, Math.min(y, elementBottom));
    
    const distance = Math.sqrt(
        Math.pow(x - closestX, 2) + 
        Math.pow(y - closestY, 2)
    );
    
    return distance < radius;
}

function addScore(points) {
    score += points;
    scoreDisplay.textContent = score;
    
    // Add score animation
    scoreDisplay.classList.add('score-updated');
    setTimeout(() => scoreDisplay.classList.remove('score-updated'), 300);
}

function playSound(sound) {
    // In a real implementation, you would play the actual sound
    // For now, we'll just reset and play (if the audio element is set up)
    if (sound && sound.play) {
        sound.currentTime = 0;
        sound.play().catch(e => {
            // Ignore errors - browsers may block autoplay
            console.log('Sound play error:', e);
        });
    }
}

function endGame() {
    gameActive = false;
    ballActive = false;
    clearInterval(gameLoop);
    
    // Show game over overlay
    gameOverlay.style.display = 'flex';
    const overlayContent = gameOverlay.querySelector('.overlay-content');
    overlayContent.innerHTML = `
        <h1>GAME OVER</h1>
        <p>FINAL SCORE: ${score}</p>
        <p>Click START to play again!</p>
    `;
    
    playSound(gameOverSound);
}

// Initialize event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Set up initial event listeners
    setupEventListeners();
    
    // Show start overlay
    gameOverlay.style.display = 'flex';
});