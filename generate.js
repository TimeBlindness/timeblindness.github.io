#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fsp } from 'fs';
import puppeteer from 'puppeteer';

/**************************************************
 * generate.js (SNR Gradient Version)
 *
 * 1) Reads words from ../resources/wordlist.txt
 * 2) Launch Puppeteer (headless)
 * 3) Load words.html
 * 4) For each word:
 *    - Set the text in the page
 *    - Generate multiple videos with gradually increasing SNR:
 *      - Background noise decreases
 *      - Foreground noise increases
 *      - Speckle size varies
 *    - Save videos to /videos directory
 **************************************************/

// Convert import.meta.url => directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Config paths
const WORDLIST_FILE = path.join(__dirname, '../resources/wordlist_2.txt');
const WORDS_HTML = path.join(__dirname, 'words.html');
const VIDEOS_DIR = path.join(__dirname, 'videos');

// Recording settings
const DURATION_MS = 5000; // 5 seconds
const FPS = 60;

// SNR gradient settings
const SNR_STEPS = 100; // Number of SNR levels to generate per word
const BG_NOISE_START = 70; // Background noise starting percentage (high noise)
const BG_NOISE_END = 45;   // Background noise ending percentage (low noise)
const FG_NOISE_START = 50; // Foreground noise starting percentage (low noise)
const FG_NOISE_END = 55;   // Foreground noise ending percentage (high noise)

(async function main() {
  // Read the wordlist
  if (!fs.existsSync(WORDLIST_FILE)) {
    console.error(`File not found: ${WORDLIST_FILE}`);
    process.exit(1);
  }
  const wordData = fs.readFileSync(WORDLIST_FILE, 'utf-8');
  const words = wordData.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

  if (!words.length) {
    console.error('No words found in wordlist.txt');
    process.exit(1);
  }

  // Ensure videos folder exists
  await fsp.mkdir(VIDEOS_DIR, { recursive: true });

  // Launch Puppeteer
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--allow-file-access-from-files'
    ],
    defaultViewport: {
      width: 960,
      height: 540
    }
  });

  try {
    const page = await browser.newPage();

    // Load words.html
    await page.goto(`file://${WORDS_HTML}`, {
      waitUntil: 'domcontentloaded',
      timeout: 0
    });

    // Process each word
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      
      // Direction options
      const directions = ['vertical', 'horizontal'];
      const direction = directions[Math.floor(Math.random() * directions.length)];
      
      // Speed options (1 or 2)
      const speed = Math.random() > 0.5 ? 1 : 2;
      
      console.log(`\n[${i+1}/${words.length}] Processing word: "${word}" (direction: ${direction}, speed: ${speed})`);
      
      // Set the text and direction and ensure it's centered
      await page.evaluate((text, dir, spd) => {
        // Set text
        document.getElementById('textInput').value = text;
        document.getElementById('textInput').dispatchEvent(new Event('input'));
        
        // Set direction
        document.getElementById('directionInput').value = dir;
        document.getElementById('directionInput').dispatchEvent(new Event('change'));
        
        // Set speed
        document.getElementById('speedInput').value = spd;
        document.getElementById('speedInput').dispatchEvent(new Event('input'));
        
        // Ensure text is centered - these variables are in the global scope of the page
        if (typeof contentX !== 'undefined' && typeof contentY !== 'undefined') {
          const canvas = document.getElementById('noiseCanvas');
          contentX = canvas.width/2;
          contentY = canvas.height/2;
          if (typeof updateMask === 'function') {
            updateMask();
          }
        }
      }, word, direction, speed);
      
      // Generate videos with gradually increasing SNR
      for (let step = 0; step < SNR_STEPS; step++) {
        // Calculate SNR parameters for this step
        const progress = step / (SNR_STEPS - 1); // 0 to 1
        
        // Linear interpolation between start and end values
        const bgNoiseDensity = BG_NOISE_START - progress * (BG_NOISE_START - BG_NOISE_END);
        const fgNoiseDensity = FG_NOISE_START + progress * (FG_NOISE_END - FG_NOISE_START);
        
        // Randomly sample speckle size from 1 to 4px
        const speckleSize = 1; // Random integer from 1 to 4
        
        console.log(`  SNR Level ${step+1}/${SNR_STEPS}: BG Noise: ${bgNoiseDensity.toFixed(1)}%, FG Noise: ${fgNoiseDensity.toFixed(1)}%, Speckle: ${speckleSize}px`);
        
        // Set noise parameters in the page without changing position
        await page.evaluate((bg, fg, speckle) => {
          // Set background noise density
          document.getElementById('bgDensityInput').value = bg;
          document.getElementById('bgDensityInput').dispatchEvent(new Event('input'));
          
          // Set foreground noise density
          document.getElementById('fgDensityInput').value = fg;
          document.getElementById('fgDensityInput').dispatchEvent(new Event('input'));
          
          // Set speckle size
          document.getElementById('speckleSizeInput').value = speckle;
          document.getElementById('speckleSizeInput').dispatchEvent(new Event('input'));
          
          // Directly refresh the noise without changing position
          if (typeof refreshNoise === 'function') {
            refreshNoise();
          } else if (typeof backgroundNoise !== 'undefined' && typeof foregroundNoise !== 'undefined') {
            // If refreshNoise isn't available, try to access the arrays directly
            generateBinaryNoise(backgroundNoise, bg/100);
            generateBinaryNoise(foregroundNoise, fg/100);
          }
        }, bgNoiseDensity, fgNoiseDensity, speckleSize);
        
        // Wait for noise to refresh
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Record the canvas directly
        const base64Data = await page.evaluate(async (duration) => {
          return new Promise((resolve, reject) => {
            const canvas = document.getElementById('noiseCanvas');
            const stream = canvas.captureStream(60);
            const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
            const chunks = [];
            
            recorder.ondataavailable = e => { 
              if (e.data.size > 0) chunks.push(e.data); 
            };
            
            recorder.onstop = () => {
              const blob = new Blob(chunks, { type: 'video/webm' });
              const reader = new FileReader();
              reader.onload = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
              };
              reader.readAsDataURL(blob);
            };
            
            recorder.start();
            setTimeout(() => recorder.stop(), duration);
          });
        }, DURATION_MS);

        // Convert base64 to Buffer and save
        const fileName = `${word}_snr${step+1}_bg${Math.round(bgNoiseDensity)}_fg${Math.round(fgNoiseDensity)}_speckle${speckleSize}_speed${speed}_${direction}.webm`;
        const outPath = path.join(VIDEOS_DIR, fileName);
        const buffer = Buffer.from(base64Data, 'base64');
        await fsp.writeFile(outPath, buffer);

        console.log(`  Saved: ${fileName}`);
      }
    }

    console.log('\nAll words processed successfully!');

  } catch (err) {
    console.error('Error in generate:', err);
  } finally {
    await browser.close();
  }
})();