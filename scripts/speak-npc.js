#!/usr/bin/env node

/**
 * D&D NPC Voice TTS CLI Tool (Cross-Platform: Windows, macOS, Linux)
 * Features dynamic ElevenLabs cloud TTS + native OS system TTS fallback.
 * Zero mandatory external npm dependencies to run.
 *
 * Usage:
 *   node scripts/speak-npc.js --text "NPC dialogue" [options]
 *
 * Examples:
 *   node scripts/speak-npc.js --text "旅人，欢迎来到无冬城！" --npc "城门守卫"
 *   node scripts/speak-npc.js --text "交出你们的财宝！" --voice goblin --npc "克拉格"
 *   node scripts/speak-npc.js --text "愿提尔的光芒指引你" --voice cleric --native
 */

import { createWriteStream, existsSync, readFileSync, promises as fsPromises } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Zero-dependency pure Node.js .env loader
function loadEnv() {
  const candidates = [
    join(__dirname, '../.env'),
    join(__dirname, '.env')
  ];
  for (const envPath of candidates) {
    if (existsSync(envPath)) {
      try {
        const raw = readFileSync(envPath, 'utf-8');
        for (const line of raw.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
            const eqIdx = trimmed.indexOf('=');
            const key = trimmed.slice(0, eqIdx).trim();
            const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch (_) {}
    }
  }
}

loadEnv();

// Voice presets for different character types
const VOICE_PRESETS = {
  // Default/versatile voices
  'default': 'JBFqnCBsd6RMkjVDRZzb', // George - neutral male
  'narrator': 'pNInz6obpgDQGcFmaJgB', // Adam - calm narrator

  // Fantasy character archetypes
  'goblin': 'EXAVITQu4vr4xnSDxMaL', // Sarah - sneaky/nasty
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
  'oldman': 'pNInz6obpgDQGcFmaJgB',
  'youngman': 'JBFqnCBsd6RMkjVDRZzb',
  'woman': 'ThT5KcBeYPX3keUQqHPh',
  'girl': 'ThT5KcBeYPX3keUQqHPh',
};

const colors = {
  cyan: '\x1b[36m',
  blue: '\x1b[34m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  dim: '\x1b[2m',
  reset: '\x1b[0m'
};

function parseArgs(args) {
  const parsed = {
    text: null,
    voice: 'default',
    npc: null,
    native: false,
    noSound: false,
    list: false,
    help: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--text') {
      parsed.text = args[++i];
    } else if (arg === '--voice') {
      parsed.voice = args[++i];
    } else if (arg === '--npc') {
      parsed.npc = args[++i];
    } else if (arg === '--native') {
      parsed.native = true;
    } else if (arg === '--no-sound' || arg === '--silent') {
      parsed.noSound = true;
    } else if (arg === '--list') {
      parsed.list = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`
${colors.cyan}🎭 D&D NPC Voice TTS Tool (Cross-Platform)${colors.reset}

${colors.yellow}Usage:${colors.reset}
  node scripts/speak-npc.js --text "dialogue" [options]
  node scripts/speak-npc.js --list
  node scripts/speak-npc.js --help

${colors.yellow}Options:${colors.reset}
  --text <string>   The dialogue text to speak (required)
  --voice <preset>  Voice preset (default: "default")
  --npc <name>      NPC name for display (optional)
  --native          Force using native OS system TTS (Windows SAPI / macOS say)
  --no-sound        Print text dialogue only without audio playback
  --list            List all available voice presets
  --help, -h        Show this help message

${colors.yellow}Examples:${colors.reset}
  node scripts/speak-npc.js --text "Welcome, traveler!" --voice goblin --npc "Klarg"
  node scripts/speak-npc.js --text "I need your help" --voice wizard --npc "Sildar"
  node scripts/speak-npc.js --text "放下武器！" --voice guard --npc "城门守卫" --native
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
    voices.forEach(v => {
      if (VOICE_PRESETS[v]) {
        console.log(`  ${colors.green}${v.padEnd(15)}${colors.reset} (ID: ${VOICE_PRESETS[v]})`);
      }
    });
    console.log();
  }
}

async function playAudio(audioPath) {
  return new Promise((resolve) => {
    let proc;
    if (process.platform === 'win32') {
      const escapedPath = audioPath.replace(/'/g, "''");
      const psCommand = `Add-Type -AssemblyName presentationCore; $p = New-Object System.Windows.Media.MediaPlayer; $p.Open([System.Uri]'${escapedPath}'); $p.Play(); Start-Sleep -Milliseconds 600; while ($p.NaturalDuration.HasTimeSpan -and $p.Position -lt $p.NaturalDuration.TimeSpan) { Start-Sleep -Milliseconds 200 }`;
      proc = spawn('powershell.exe', ['-NoProfile', '-Command', psCommand], { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      proc = spawn('afplay', [audioPath], { stdio: 'ignore' });
    } else {
      proc = spawn('mpg123', ['-q', audioPath], { stdio: 'ignore' });
    }

    proc.on('close', () => resolve());
    proc.on('error', () => resolve());
  });
}

async function speakNative(text) {
  return new Promise((resolve) => {
    let proc;
    if (process.platform === 'win32') {
      const clean = text.replace(/['"\r\n]/g, ' ');
      const ps = `try { Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Speak('${clean}') } catch {}`;
      proc = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
    } else if (process.platform === 'darwin') {
      proc = spawn('say', [text], { stdio: 'ignore' });
    } else {
      proc = spawn('spd-say', [text], { stdio: 'ignore' });
    }

    // Never hang longer than 6 seconds on native speech
    const timer = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      resolve();
    }, 6000);

    proc.on('close', () => {
      clearTimeout(timer);
      resolve();
    });
    proc.on('error', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function textToSpeech(text, voiceId, options = {}) {
  const npcName = options.npc;
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const canUseCloud = !options.native && apiKey && apiKey !== 'your_api_key_here';

  // 1. If ElevenLabs is configured and not forced native, try Cloud TTS
  if (canUseCloud) {
    try {
      // Dynamic import to eliminate hard npm dependency
      const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
      console.log(`${colors.cyan}🎙️  [ElevenLabs] 生成语音中...${colors.reset}`);
      if (npcName) console.log(`${colors.blue}   NPC: ${npcName}${colors.reset}`);
      console.log(`${colors.dim}   台词: "${text}"${colors.reset}`);

      const client = new ElevenLabsClient({ apiKey });
      const audio = await client.textToSpeech.convert(voiceId, {
        text,
        model_id: 'eleven_flash_v2_5',
        output_format: 'mp3_44100_128'
      });

      const tempFile = join(__dirname, '.temp_voice.mp3');
      const writeStream = createWriteStream(tempFile);

      if (audio[Symbol.asyncIterator]) {
        for await (const chunk of audio) writeStream.write(chunk);
      } else {
        writeStream.write(audio);
      }

      await new Promise((resolve, reject) => {
        writeStream.end();
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      if (!options.noSound) {
        await playAudio(tempFile);
      }

      try { await fsPromises.unlink(tempFile); } catch (_) {}
      console.log(`${colors.green}✓ 语音播报完毕${colors.reset}`);
      return;
    } catch (err) {
      console.warn(`${colors.yellow}[ElevenLabs 降级提示] 无法连接云端 TTS (${err.message})，转入本地原生引擎...${colors.reset}`);
    }
  }

  // 2. Native System Fallback or Display Mode
  if (npcName) {
    console.log(`${colors.cyan}💬 [${npcName}]${colors.reset}: "${text}"`);
  } else {
    console.log(`${colors.cyan}💬 NPC${colors.reset}: "${text}"`);
  }

  if (!options.noSound) {
    console.log(`${colors.dim}(调用系统原生语音引擎: ${process.platform === 'win32' ? 'Windows SAPI' : process.platform === 'darwin' ? 'macOS say' : 'Linux TTS'})...${colors.reset}`);
    await speakNative(text);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const parsed = parseArgs(args);

  if (parsed.help) {
    printHelp();
    return;
  }

  if (parsed.list) {
    listVoices();
    return;
  }

  if (!parsed.text) {
    console.error(`${colors.red}❌ 错误: 请指定 NPC 台词 (--text "...")。${colors.reset}`);
    console.log(`运行 node scripts/speak-npc.js --help 查看用法\n`);
    process.exit(1);
  }

  const voiceId = VOICE_PRESETS[parsed.voice] || VOICE_PRESETS['default'];
  await textToSpeech(parsed.text, voiceId, parsed);
}

const isMain = process.argv[1] && (
  resolve(process.argv[1]) === __filename ||
  resolve(process.argv[1]) === resolve(__dirname, 'speak-npc.js')
);

if (isMain) {
  main().catch(err => {
    console.error(`${colors.red}运行异常: ${err.message}${colors.reset}`);
    process.exit(1);
  });
}

export { textToSpeech, VOICE_PRESETS };
