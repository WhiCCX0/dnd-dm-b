#!/usr/bin/env node

/**
 * D&D NPC Voice TTS CLI Tool (Cross-Platform: Windows, macOS, Linux)
 * Usage: node scripts/speak-npc.js --text "NPC dialogue" --voice <voice-name> [--npc "NPC Name"]
 *
 * Examples:
 *   node scripts/speak-npc.js --text "Welcome, traveler!" --voice goblin --npc "Klarg"
 *   node scripts/speak-npc.js --text "I need your help" --voice wizard --npc "Sildar"
 */

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { createWriteStream } from 'fs';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env file in skill directory or scripts/
dotenv.config({ path: join(__dirname, '../.env') });
dotenv.config({ path: join(__dirname, '.env') });

// Voice presets for different character types
const VOICE_PRESETS = {
  // Default/versatile voices
  'default': 'JBFqnCBsd6RMkjVDRZzb', // George - neutral male
  'narrator': 'pNInz6obpgDQGcFmaJgB', // Adam - calm narrator

  // Fantasy character archetypes
  'goblin': 'EXAVITQu4vr4xnSDxMaL', // Sarah - can sound sneaky/nasty
  'dwarf': 'VR6AewLTigWG4xSOukaG', // Arnold - deep male
  'elf': 'ThT5KcBeYPX3keUQqHPh', // Dorothy - elegant female
  'wizard': 'pNInz6obpgDQGcFmaJgB', // Adam - wise male
  'warrior': 'VR6AewLTigWG4xSOukaG', // Arnold - gruff male
  'rogue': 'EXAVITQu4vr4xnSDxMaL', // Sarah - sneaky
  'cleric': 'ThT5KcBeYPX3keUQqHPh', // Dorothy - gentle female
  'merchant': 'JBFqnCBsd6RMkjVDRZzb', // George - friendly
  'guard': 'VR6AewLTigWG4xSOukaG', // Arnold - authoritative
  'noble': 'pNInz6obpgDQGcFmaJgB', // Adam - refined
  'villain': 'EXAVITQu4vr4xnSDxMaL', // Sarah - menacing

  // Age/gender variations
  'oldman': 'pNInz6obpgDQGcFmaJgB', // Adam
  'youngman': 'JBFqnCBsd6RMkjVDRZzb', // George
  'woman': 'ThT5KcBeYPX3keUQqHPh', // Dorothy
  'girl': 'ThT5KcBeYPX3keUQqHPh', // Dorothy
};

// ANSI color codes
const colors = {
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    text: null,
    voice: 'default',
    npc: null,
    list: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--text':
        parsed.text = args[++i];
        break;
      case '--voice':
        parsed.voice = args[++i];
        break;
      case '--npc':
        parsed.npc = args[++i];
        break;
      case '--list':
        parsed.list = true;
        break;
      case '--help':
      case '-h':
        parsed.help = true;
        break;
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`
${colors.cyan}🎭 D&D NPC Voice TTS Tool (Cross-Platform)${colors.reset}

Usage:
  node scripts/speak-npc.js --text "dialogue" --voice <preset> [--npc "Name"]
  node scripts/speak-npc.js --list
  node scripts/speak-npc.js --help

Options:
  --text <string>   The dialogue text to speak (required)
  --voice <preset>  Voice preset (default: "default")
  --npc <name>      NPC name for display (optional)
  --list            List all available voice presets
  --help, -h        Show this help message

Examples:
  node scripts/speak-npc.js --text "Welcome, traveler!" --voice goblin --npc "Klarg"
  node scripts/speak-npc.js --text "I need your help" --voice wizard --npc "Sildar"
  node scripts/speak-npc.js --text "You dare challenge me?" --voice villain

Available voice presets:
  ${Object.keys(VOICE_PRESETS).join(', ')}

Setup:
  1. Copy .env.example to .env in the skill directory
  2. Add your ElevenLabs API key to .env (ELEVENLABS_API_KEY=your_key)
  3. Get an API key from: https://elevenlabs.io/app/settings/api-keys
  Note: Voice TTS is 100% optional. The game plays identically without it!
`);
}

function listVoices() {
  console.log(`\n${colors.cyan}🎭 Available Voice Presets${colors.reset}\n`);

  const categories = {
    'Default': ['default', 'narrator'],
    'Fantasy Archetypes': ['goblin', 'dwarf', 'elf', 'wizard', 'warrior', 'rogue', 'cleric'],
    'NPCs': ['merchant', 'guard', 'noble', 'villain'],
    'Age/Gender': ['oldman', 'youngman', 'woman', 'girl']
  };

  for (const [category, voices] of Object.entries(categories)) {
    console.log(`${colors.yellow}${category}:${colors.reset}`);
    voices.forEach(voice => {
      if (VOICE_PRESETS[voice]) {
        console.log(`  ${colors.green}${voice.padEnd(15)}${colors.reset} (ID: ${VOICE_PRESETS[voice]})`);
      }
    });
    console.log();
  }
}

async function playAudio(audioPath) {
  return new Promise((resolve, reject) => {
    let proc;

    if (process.platform === 'win32') {
      // Windows: use PowerShell MediaPlayer
      const escapedPath = audioPath.replace(/'/g, "''");
      const psCommand = `Add-Type -AssemblyName presentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([System.Uri]'${escapedPath}'); $p.Play(); Start-Sleep -Milliseconds 600; while ($p.NaturalDuration.HasTimeSpan -and $p.Position -lt $p.NaturalDuration.TimeSpan) { Start-Sleep -Milliseconds 200 }`;
      proc = spawn('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      // macOS: afplay
      proc = spawn('afplay', [audioPath], { stdio: 'ignore' });
    } else {
      // Linux: try mpg123, ffplay, or aplay
      proc = spawn('mpg123', ['-q', audioPath], { stdio: 'ignore' });
    }

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        // Resolve anyway so game flow is never blocked
        resolve();
      }
    });

    proc.on('error', (err) => {
      console.warn(`${colors.yellow}Notice: Audio playback failed (${err.message}). Skipping audio playback.${colors.reset}`);
      resolve();
    });
  });
}

async function textToSpeech(text, voiceId, npcName = null) {
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey || apiKey === 'your_api_key_here') {
    console.log(`${colors.yellow}💬 [Voice Skipped - No ElevenLabs API Key configured]${colors.reset}`);
    if (npcName) {
      console.log(`${colors.cyan}[${npcName}]${colors.reset}: "${text}"`);
    } else {
      console.log(`"${text}"`);
    }
    return;
  }

  try {
    console.log(`${colors.cyan}🎙️  Generating speech...${colors.reset}`);
    if (npcName) {
      console.log(`${colors.blue}   NPC: ${npcName}${colors.reset}`);
    }
    console.log(`${colors.blue}   Text: "${text}"${colors.reset}`);

    const elevenlabs = new ElevenLabsClient({
      apiKey: apiKey
    });

    const audio = await elevenlabs.textToSpeech.convert(
      voiceId,
      {
        text: text,
        model_id: 'eleven_flash_v2_5',
        output_format: 'mp3_44100_128'
      }
    );

    // Save to temporary file
    const tempFile = join(__dirname, '.temp_voice.mp3');
    const writeStream = createWriteStream(tempFile);

    // Handle the audio stream
    if (audio[Symbol.asyncIterator]) {
      for await (const chunk of audio) {
        writeStream.write(chunk);
      }
    } else {
      writeStream.write(audio);
    }

    await new Promise((resolve, reject) => {
      writeStream.end();
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    console.log(`${colors.green}✅ Audio generated${colors.reset}`);
    console.log(`${colors.cyan}🔊 Playing audio...${colors.reset}`);

    // Play the audio
    await playAudio(tempFile);

    // Clean up temp file
    try {
      await fs.unlink(tempFile);
    } catch (_) {}

    console.log(`${colors.green}✅ Complete!${colors.reset}`);
  } catch (error) {
    console.error(`${colors.yellow}TTS Notice: ${error.message}${colors.reset}`);
    if (npcName) {
      console.log(`${colors.cyan}[${npcName}]${colors.reset}: "${text}"`);
    }
  }
}

async function main() {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    return;
  }

  if (args.list) {
    listVoices();
    return;
  }

  if (!args.text) {
    console.error(`${colors.red}❌ Error: Dialogue text is required${colors.reset}`);
    console.log(`Use --help for usage information\n`);
    process.exit(1);
  }

  const voiceId = VOICE_PRESETS[args.voice] || VOICE_PRESETS['default'];
  await textToSpeech(args.text, voiceId, args.npc);
}

main().catch(error => {
  console.error(`${colors.red}Fatal Error: ${error.message}${colors.reset}`);
  process.exit(1);
});
