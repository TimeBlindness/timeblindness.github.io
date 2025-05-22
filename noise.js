/****************************************************
 * noise.js
 *
 * - Opposing noise animation (bg vs. fg).
 * - Text or image masking.
 * - Auto-scale text & consistent line height usage.
 * - No forced revert to "NOISE" once updated.
 * - Retains random & click positioning, pause/resume, and in-browser recording.
 ****************************************************/

// === DOM & Canvas Setup ===
const canvas = document.getElementById('noiseCanvas');
const ctx = canvas.getContext('2d');

// Configure desired resolution
canvas.width = 960;
canvas.height = 540;

// === Global State ===
let contentX = canvas.width / 2;
let contentY = canvas.height / 2;

let currentText = "NOISE";   // Default text if nothing else is set
let fontSize = 30;           // % of min(canvas.width, canvas.height)
let contentType = "text";    // "text" or "image"
let currentImage = null;

let animationSpeed = 2;
let noiseDensity = 0.5;      // 50% by default
let speckleSize = 3;         // block size for noise

// Noise arrays for background & foreground
const backgroundNoise = new Array(canvas.width * canvas.height);
const foregroundNoise = new Array(canvas.width * canvas.height);

// Mask data
let maskData = null;

// Offsets for scrolling noise
let backgroundOffset = 0;
let foregroundOffset = 0;

// Animation & recording
let isPaused = false;
let animationFrame = null;
let isRecording = false;
let mediaRecorder;
let recordedChunks = [];
let startTime = null;
const fps = 60; // for both animation & capture

// Add direction to global state
let animationDirection = "vertical"; // "vertical" or "horizontal"

/*****************************************************
 * Noise Generation
 *****************************************************/
function generateBinaryNoise(array) {
    const width = canvas.width;
    const height = canvas.height;
    array.fill(0);

    for (let y = 0; y < height; y += speckleSize) {
        for (let x = 0; x < width; x += speckleSize) {
            const value = Math.random() > noiseDensity ? 255 : 0;
            for (let dy = 0; dy < speckleSize && y + dy < height; dy++) {
                for (let dx = 0; dx < speckleSize && x + dx < width; dx++) {
                    const index = (y + dy) * width + (x + dx);
                    array[index] = value;
                }
            }
        }
    }
}

function refreshNoise() {
    generateBinaryNoise(backgroundNoise);
    generateBinaryNoise(foregroundNoise);
}

// Initial generation
refreshNoise();

/*****************************************************
 * Positioning & Bounding
 *****************************************************/
function constrainPosition(x, y, objectWidth, objectHeight) {
    let constrainedX = x;
    let constrainedY = y;

    const halfW = objectWidth / 2;
    const halfH = objectHeight / 2;

    if (constrainedX < halfW) constrainedX = halfW;
    if (constrainedX > canvas.width - halfW) {
        constrainedX = canvas.width - halfW;
    }
    if (constrainedY < halfH) constrainedY = halfH;
    if (constrainedY > canvas.height - halfH) {
        constrainedY = canvas.height - halfH;
    }

    return { x: constrainedX, y: constrainedY };
}

/*****************************************************
 * Text Wrapping & Auto-Scaling
 *****************************************************/
function wrapTextLines(context, text, maxWidth) {
    const words = text.split(/\s+/);
    const lines = [];
    let currentLine = "";

    for (let i = 0; i < words.length; i++) {
        const testLine = currentLine + (currentLine ? " " : "") + words[i];
        const metrics = context.measureText(testLine);
        if (metrics.width > maxWidth && i > 0) {
            lines.push(currentLine);
            currentLine = words[i];
        } else {
            currentLine = testLine;
        }
    }
    if (currentLine) {
        lines.push(currentLine);
    }
    return lines;
}

/**
 * Attempt smaller font sizes until text (wrapped) fits in 90% of the canvas height.
 */
function autoScaleFontForText(context, text) {
    let fontSizePixels = Math.min(canvas.width, canvas.height) * (fontSize / 100);
    const maxWidth = canvas.width * 0.9;
    const maxHeight = canvas.height * 0.9;
    const lineHeightFactor = 1.2;

    for (let trySize = fontSizePixels; trySize >= 10; trySize--) {
        context.font = `bold ${trySize}px system-ui`;
        const lines = wrapTextLines(context, text, maxWidth);
        const textHeight = lines.length * (trySize * lineHeightFactor);
        if (textHeight <= maxHeight) {
            return trySize; 
        }
    }
    return 10; // fallback
}

/*****************************************************
 * getContentBounds()
 *****************************************************/
function getContentBounds() {
    if (contentType === "text") {
        // Approx measure at the chosen font-size
        const fontSizePixels = Math.min(canvas.width, canvas.height) * (fontSize / 100);
        ctx.font = `bold ${fontSizePixels}px system-ui`;
        const metrics = ctx.measureText(currentText);
        const textWidth = metrics.width;
        const textHeight = fontSizePixels; 
        return { width: textWidth, height: textHeight };

    } else if (contentType === "image" && currentImage) {
        // Scale image to 80% of canvas
        const scale = Math.min(
            (canvas.width * 0.8) / currentImage.width,
            (canvas.height * 0.8) / currentImage.height,
            1
        );
        return {
            width: currentImage.width * scale,
            height: currentImage.height * scale
        };
    }
    return { width: 0, height: 0 };
}

/*****************************************************
 * updateMask()
 *  Draw text/image around (contentX, contentY).
 *****************************************************/
function updateMask() {
    // Refresh noise each time
    refreshNoise();

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.clearRect(0, 0, canvas.width, canvas.height);

    if (contentType === "text") {
        // 1) Determine a final font size that fits
        const finalFontSize = autoScaleFontForText(maskCtx, currentText);

        // 2) Wrap with finalFontSize
        maskCtx.font = `bold ${finalFontSize}px system-ui`;
        maskCtx.fillStyle = 'white';
        maskCtx.textAlign = 'center';
        maskCtx.textBaseline = 'middle';

        const maxWidth = canvas.width * 0.9;
        const lineHeight = finalFontSize * 0.9; // match the scaling logic

        const lines = wrapTextLines(maskCtx, currentText, maxWidth);

        // measure bounding box
        let maxLineWidth = 0;
        lines.forEach(line => {
            const m = maskCtx.measureText(line);
            if (m.width > maxLineWidth) {
                maxLineWidth = m.width;
            }
        });
        const totalHeight = lines.length * lineHeight;

        // center around contentX, contentY
        const startY = contentY - (totalHeight / 2);

        lines.forEach((line, i) => {
            const y = startY + i * lineHeight;
            maskCtx.fillText(line, contentX, y);
        });

    } else if (contentType === "image" && currentImage) {
        // scale image to fit
        const margin = 20;
        const maxAllowedWidth = canvas.width - margin * 2;
        const maxAllowedHeight = canvas.height - margin * 2;
        const scale = Math.min(
            maxAllowedWidth / currentImage.width,
            maxAllowedHeight / currentImage.height,
            1
        );

        const drawWidth = currentImage.width * scale;
        const drawHeight = currentImage.height * scale;

        // center around contentX, contentY
        const drawX = contentX - (drawWidth / 2);
        const drawY = contentY - (drawHeight / 2);

        maskCtx.drawImage(currentImage, drawX, drawY, drawWidth, drawHeight);
    }

    // store RGBA data
    maskData = maskCtx.getImageData(0, 0, canvas.width, canvas.height).data;
}

/*****************************************************
 * Animation Loop
 *****************************************************/
function animate(timestamp) {
    if (!startTime) startTime = timestamp;
    const progress = timestamp - startTime;

    if (animationDirection === "vertical") {
        // Original vertical scrolling
        backgroundOffset = (backgroundOffset + animationSpeed) % canvas.height;
        foregroundOffset = (foregroundOffset - animationSpeed + canvas.height) % canvas.height;
    } else {
        // Horizontal scrolling
        backgroundOffset = (backgroundOffset + animationSpeed) % canvas.width;
        foregroundOffset = (foregroundOffset - animationSpeed + canvas.width) % canvas.width;
    }

    const frameData = ctx.createImageData(canvas.width, canvas.height);

    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            const i = (y * canvas.width + x) * 4;
            const isForegroundPixel = maskData && (maskData[i + 3] > 0);

            let bgIndex, fgIndex;
            
            if (animationDirection === "vertical") {
                bgIndex = (((y + backgroundOffset) % canvas.height) * canvas.width) + x;
                fgIndex = (((y + foregroundOffset) % canvas.height) * canvas.width) + x;
            } else {
                bgIndex = (y * canvas.width + ((x + backgroundOffset) % canvas.width));
                fgIndex = (y * canvas.width + ((x + foregroundOffset) % canvas.width));
            }

            const noiseValue = isForegroundPixel
                ? foregroundNoise[fgIndex]
                : backgroundNoise[bgIndex];

            frameData.data[i + 0] = noiseValue;
            frameData.data[i + 1] = noiseValue;
            frameData.data[i + 2] = noiseValue;
            frameData.data[i + 3] = 255;
        }
    }

    ctx.putImageData(frameData, 0, 0);

    if (!isPaused) {
        if (isRecording && progress < 5000) {
            animationFrame = requestAnimationFrame(animate);
        } else if (isRecording) {
            mediaRecorder.stop();
            isRecording = false;
            startTime = null;
            document.getElementById('recordButton').textContent = 'Start Recording';
            document.getElementById('recordButton').classList.remove('recording');
        } else {
            animationFrame = requestAnimationFrame(animate);
        }
    }
}
// Start animation immediately
animate();

/*****************************************************
 * Event Listeners
 *****************************************************/

// 1) Canvas click => place text/image
canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const { width, height } = getContentBounds();
    const { x, y } = constrainPosition(clickX, clickY, width, height);
    contentX = x;
    contentY = y;
    updateMask();
});

// 2) Content type switch
const contentTypeSelect = document.getElementById('contentType');
contentTypeSelect.addEventListener('change', (e) => {
    contentType = e.target.value;
    document.getElementById('textControls').style.display =
        (contentType === 'text') ? 'flex' : 'none';
    document.getElementById('imageControls').style.display =
        (contentType === 'image') ? 'flex' : 'none';
    updateMask();
});

// 3) Text input
document.getElementById('textInput').addEventListener('input', (e) => {
    currentText = e.target.value; // no fallback
    updateMask();
});

// 4) Image input
document.getElementById('imageInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.onload = () => {
            currentImage = img;
            contentX = canvas.width / 2;
            contentY = canvas.height / 2;
            updateMask();
        };
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

// 5) Font size
document.getElementById('fontSizeInput').addEventListener('input', (e) => {
    fontSize = Math.max(10, Math.min(200, parseFloat(e.target.value) || 30));
    updateMask();
});

// 6) Speed
document.getElementById('speedInput').addEventListener('input', (e) => {
    animationSpeed = Math.max(1, Math.min(10, parseFloat(e.target.value) || 2));
});

// 7) Noise density
document.getElementById('densityInput').addEventListener('input', (e) => {
    noiseDensity = Math.max(0, Math.min(100, parseFloat(e.target.value) || 50)) / 100;
    refreshNoise();
});

// 8) Speckle size
document.getElementById('speckleSizeInput').addEventListener('input', (e) => {
    speckleSize = Math.max(1, Math.min(20, parseInt(e.target.value) || 3));
    refreshNoise();
});

// 9) Random position
document.getElementById('randomButton').addEventListener('click', () => {
    const randX = Math.random() * canvas.width;
    const randY = Math.random() * canvas.height;

    const { width, height } = getContentBounds();
    const { x, y } = constrainPosition(randX, randY, width, height);
    contentX = x;
    contentY = y;
    updateMask();
});

// 10) Pause / Resume
document.getElementById('pauseButton').addEventListener('click', () => {
    isPaused = !isPaused;
    document.getElementById('pauseButton').textContent = isPaused ? 'Resume' : 'Pause';
    if (!isPaused) {
        animate();
    }
});

// 11) Record for 5s
document.getElementById('recordButton').addEventListener('click', () => {
    if (isRecording) return;

    const stream = canvas.captureStream(fps);
    const options = {
        mimeType: 'video/webm; codecs=vp9',
        videoBitsPerSecond: 8000000
    };

    try {
        mediaRecorder = new MediaRecorder(stream, options);
    } catch (err) {
        // fallback if VP9 not supported
        mediaRecorder = new MediaRecorder(stream);
    }

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
            recordedChunks.push(e.data);
        }
    };

    mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'noise-animation.webm';
        a.click();
        URL.revokeObjectURL(url);
        recordedChunks = [];
    };

    recordedChunks = [];
    startTime = null;
    isRecording = true;
    mediaRecorder.start();

    document.getElementById('recordButton').textContent = 'Recording...';
    document.getElementById('recordButton').classList.add('recording');
});

// Add direction control to the HTML
document.addEventListener('DOMContentLoaded', () => {
    // Add direction control after speed control
    const speedControl = document.getElementById('speedInput').parentElement;
    const directionControl = document.createElement('div');
    directionControl.className = 'control-group';
    directionControl.innerHTML = `
        <label for="directionInput">Direction</label>
        <select id="directionInput">
            <option value="vertical">Vertical</option>
            <option value="horizontal">Horizontal</option>
        </select>
    `;
    speedControl.parentNode.insertBefore(directionControl, speedControl.nextSibling);

    // Add event listener for direction change
    document.getElementById('directionInput').addEventListener('change', (e) => {
        animationDirection = e.target.value;
        backgroundOffset = 0;
        foregroundOffset = 0;
    });
});

// Update recordCanvas to accept direction parameter
window.recordCanvas = function(word, speed, durationMs = 5000, fps = 60, direction = "vertical") {
    return new Promise((resolve, reject) => {
        const canvas = document.getElementById('noiseCanvas');
        if (!canvas) return reject(new Error('canvas not found'));

        // Set the text, speed, and direction
        document.getElementById('textInput').value = word;
        document.getElementById('textInput').dispatchEvent(new Event('input'));
        document.getElementById('speedInput').value = speed;
        document.getElementById('speedInput').dispatchEvent(new Event('input'));
        document.getElementById('directionInput').value = direction;
        document.getElementById('directionInput').dispatchEvent(new Event('change'));

        // Give time for the UI to update
        setTimeout(() => {
            const stream = canvas.captureStream(fps);
            const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
            const chunks = [];

            recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
            recorder.onstop = async () => {
                const blob = new Blob(chunks, { type: 'video/webm' });
                const reader = new FileReader();
                reader.onload = () => {
                    const base64 = reader.result.split(',')[1];
                    resolve(base64);
                };
                reader.readAsDataURL(blob);
            };

            recorder.start();
            setTimeout(() => recorder.stop(), durationMs);
        }, 1000);
    });
};