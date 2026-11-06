#!/usr/bin/env node

/**
 * Cross-Platform D&D Dice Roller CLI Tool
 * Works natively on Windows, macOS, and Linux via Node.js.
 *
 * Usage:
 *   node scripts/roll-dice.js <expression> [options]
 *
 * Examples:
 *   node scripts/roll-dice.js 1d20+5 --label "Attack roll"
 *   node scripts/roll-dice.js 1d20+5 --attack --ac 16 --label "Longsword Attack"
 *   node scripts/roll-dice.js 1d20+3 --adv --label "Perception with Advantage"
 *   node scripts/roll-dice.js 1d20+1 --dis --label "Stealth in heavy armor"
 *   node scripts/roll-dice.js 2d6+3 --crit --label "Greatsword Critical Hit!"
 *   node scripts/roll-dice.js 1d20+6 --hidden --label "Goblin Stealth"
 *   node scripts/roll-dice.js 1d20+4 --dc 15 --label "Lockpicking DC 15"
 *   node scripts/roll-dice.js 4d6kh3 --label "Stat Roll (Drop Lowest)"
 *   node scripts/roll-dice.js 2d20kl1 --label "Keep Lowest"
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MAX_TERMS = 20;
const MAX_DICE_PER_ROLL = 100;
const MAX_SIDES = 1000;
const MAX_MOD = 10000;
const MAX_BATCH = 100;

const useColor = Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
const colors = {
  reset: useColor ? '\x1b[0m' : '',
  bright: useColor ? '\x1b[1m' : '',
  dim: useColor ? '\x1b[2m' : '',
  cyan: useColor ? '\x1b[36m' : '',
  green: useColor ? '\x1b[32m' : '',
  yellow: useColor ? '\x1b[33m' : '',
  blue: useColor ? '\x1b[34m' : '',
  magenta: useColor ? '\x1b[35m' : '',
  red: useColor ? '\x1b[31m' : '',
};

function rollDie(sides) {
  return Math.floor(Math.random() * sides) + 1;
}

function validateDc(rawDc, label = 'DC') {
  if (rawDc === undefined || rawDc === null) return null;
  const str = String(rawDc).trim();
  if (!/^[+-]?\d+$/.test(str)) {
    throw new Error(`Invalid ${label} value: "${rawDc}" (must be an integer)`);
  }
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num < -1000 || num > 1000) {
    throw new Error(`${label} value out of range: "${rawDc}"`);
  }
  return num;
}

function validateBatch(rawBatch) {
  if (rawBatch === undefined || rawBatch === null) return 1;
  const str = String(rawBatch).trim();
  if (!/^\d+$/.test(str)) {
    throw new Error(`Invalid batch count: "${rawBatch}" (must be a positive integer)`);
  }
  const num = Number(str);
  if (!Number.isSafeInteger(num) || num < 1 || num > MAX_BATCH) {
    throw new Error(`Batch count out of range: "${rawBatch}" (must be 1..${MAX_BATCH})`);
  }
  return num;
}

function printHelp() {
  console.log(`
${colors.bright}${colors.cyan}🎲 D&D Cross-Platform Dice Roller${colors.reset}

${colors.yellow}Usage:${colors.reset}
  node scripts/roll-dice.js <dice-expression> [options]

${colors.yellow}Expressions:${colors.reset}
  1d20+5          Standard d20 roll with modifier
  2d6+3           Multi-dice damage roll
  4d6kh3          Roll 4d6, keep highest 3 (stat generation)
  2d20kl1         Roll 2d20, keep lowest 1
  1d100           Percentile die

${colors.yellow}Options:${colors.reset}
  --label "<text>"      Description for the roll (e.g., "Perception check")
  --adv, --advantage    Roll twice on 1d20, take the higher result
  --dis, --disadvantage Roll twice on 1d20, take the lower result
  --crit                Double the dice count for critical hit damage
  --attack              Attack roll mode (Nat 20 always hits, Nat 1 always misses)
  --ac <number>         Target AC for attack rolls (enables --attack mode)
  --dc <number>         Evaluate against target DC (Success / Failure)
  --hidden              Output ONLY the final total number (for secret DM rolls)
  --batch <count>       Roll the expression multiple times (1..100)
  --json, -j            Output result as JSON
  --help, -h            Show this help message
`);
}

export function parseArgs(args) {
  const parsed = {
    expr: null,
    label: '',
    advantage: false,
    disadvantage: false,
    crit: false,
    attack: false,
    ac: null,
    rawAc: undefined,
    dc: null,
    rawDc: undefined,
    hidden: false,
    batch: 1,
    rawBatch: undefined,
    json: false,
    help: false,
  };

  // Expand --flag=value tokens while preserving negative dice/modifiers
  const expanded = [];
  for (const rawArg of args) {
    if (rawArg.startsWith('--') && rawArg.includes('=')) {
      const eqIdx = rawArg.indexOf('=');
      expanded.push(rawArg.slice(0, eqIdx), rawArg.slice(eqIdx + 1));
    } else {
      expanded.push(rawArg);
    }
  }

  for (let i = 0; i < expanded.length; i++) {
    const arg = expanded[i];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--json' || arg === '-j') {
      parsed.json = true;
    } else if (arg === '--label') {
      if (i + 1 >= expanded.length) throw new Error('Missing value for --label');
      parsed.label = expanded[++i] || '';
    } else if (arg === '--adv' || arg === '--advantage') {
      parsed.advantage = true;
    } else if (arg === '--dis' || arg === '--disadvantage') {
      parsed.disadvantage = true;
    } else if (arg === '--crit') {
      parsed.crit = true;
    } else if (arg === '--attack') {
      parsed.attack = true;
    } else if (arg === '--ac') {
      if (i + 1 >= expanded.length) throw new Error('Missing value for --ac');
      parsed.rawAc = expanded[++i] ?? '';
      parsed.attack = true;
    } else if (arg === '--hidden') {
      parsed.hidden = true;
    } else if (arg === '--dc') {
      if (i + 1 >= expanded.length) throw new Error('Missing value for --dc');
      parsed.rawDc = expanded[++i] ?? '';
    } else if (arg === '--batch') {
      if (i + 1 >= expanded.length) throw new Error('Missing value for --batch');
      parsed.rawBatch = expanded[++i] ?? '';
    } else if (!parsed.expr && (!arg.startsWith('-') || /^-[0-9dD]/.test(arg))) {
      parsed.expr = arg;
    } else if (parsed.expr && (arg === '+' || arg === '-') && i + 1 < expanded.length && /^[0-9dD]/.test(expanded[i + 1])) {
      parsed.expr += arg + expanded[++i];
    } else if (parsed.expr && /[+-]$/.test(parsed.expr) && /^[0-9dD]/.test(arg)) {
      parsed.expr += arg;
    } else if (parsed.expr && /^[+-][0-9dD]/.test(arg)) {
      parsed.expr += arg;
    } else {
      throw new Error(`Unknown option or unexpected argument: "${arg}"`);
    }
  }

  if (parsed.rawDc !== undefined) {
    parsed.dc = validateDc(parsed.rawDc, 'DC');
  }
  if (parsed.rawAc !== undefined) {
    parsed.ac = validateDc(parsed.rawAc, 'AC');
  }
  if (parsed.rawBatch !== undefined) {
    parsed.batch = validateBatch(parsed.rawBatch);
  }

  return parsed;
}

export function parseDiceExpression(expr) {
  if (typeof expr !== 'string') {
    throw new Error(`Invalid dice expression: "${String(expr)}"`);
  }
  const clean = expr.replace(/\s+/g, '');
  if (!clean) {
    throw new Error(`Invalid dice expression: "${expr}". Examples: 1d20+5, 2d6+1d8+3, 4d6kh3`);
  }

  // Check keep-highest (kh) or keep-lowest (kl) special syntax first (e.g. 4d6kh3, 4d6kl3)
  const khlMatch = clean.match(/^(\d+)?d(\d+)k([hl])(\d+)([+-]\d+)?$/i);
  if (khlMatch) {
    const numDice = Number(khlMatch[1] || '1');
    const sides = Number(khlMatch[2]);
    const keepMode = khlMatch[3].toLowerCase() === 'l' ? 'kl' : 'kh';
    const keepCount = Number(khlMatch[4]);
    const modStr = khlMatch[5] || '0';
    const mod = Number(modStr);

    if (
      !Number.isSafeInteger(numDice) ||
      !Number.isSafeInteger(sides) ||
      !Number.isSafeInteger(keepCount) ||
      !Number.isSafeInteger(mod) ||
      numDice <= 0 ||
      sides <= 0 ||
      numDice > MAX_DICE_PER_ROLL ||
      sides > MAX_SIDES ||
      keepCount <= 0 ||
      keepCount > numDice ||
      Math.abs(mod) > MAX_MOD
    ) {
      throw new Error(`Dice count, sides, keep count, or modifier out of range in "${expr}"`);
    }
    return {
      type: keepMode,
      numDice,
      sides,
      keepCount,
      mod
    };
  }

  // Tokenize signed terms: e.g. "+1d8", "-2d6", "+5", "-3", "1d20"
  const regex = /([+-]?)(?:(\d*)d(\d+)|(\d+))/gi;
  const terms = [];
  let lastIndex = 0;
  let totalDice = 0;
  let match;

  while ((match = regex.exec(clean)) !== null) {
    if (match.index !== lastIndex) {
      throw new Error(`Invalid dice expression: "${expr}". Examples: 1d20+5, 2d6+1d8+3, 4d6kh3`);
    }
    lastIndex = regex.lastIndex;

    const sign = match[1] === '-' ? -1 : 1;
    if (match[3] !== undefined) {
      const countStr = match[2] || '1';
      const sidesStr = match[3];
      if (countStr.length > 4 || sidesStr.length > 5) {
        throw new Error(`Dice count or sides out of range in "${expr}"`);
      }
      const count = Number(countStr);
      const sides = Number(sidesStr);
      if (count <= 0 || sides <= 0 || count > MAX_DICE_PER_ROLL || sides > MAX_SIDES) {
        throw new Error(`Dice count or sides out of range in "${expr}"`);
      }
      totalDice += count;
      if (totalDice > MAX_DICE_PER_ROLL) {
        throw new Error(`Total dice count (${totalDice}) out of range in "${expr}" (max ${MAX_DICE_PER_ROLL})`);
      }
      terms.push({ type: 'dice', sign, count, sides, raw: match[0] });
    } else if (match[4] !== undefined) {
      const valStr = match[4];
      if (valStr.length > 5) {
        throw new Error(`Modifier value out of range in "${expr}" (max ${MAX_MOD})`);
      }
      const val = Number(valStr);
      if (!Number.isSafeInteger(val) || val > MAX_MOD) {
        throw new Error(`Modifier value out of range in "${expr}" (max ${MAX_MOD})`);
      }
      terms.push({ type: 'mod', sign, val: sign * val, raw: match[0] });
    }

    if (terms.length > MAX_TERMS) {
      throw new Error(`Too many terms in dice expression "${expr}" (max ${MAX_TERMS}, out of range)`);
    }
  }

  if (lastIndex !== clean.length || terms.length === 0) {
    throw new Error(`Invalid dice expression: "${expr}". Examples: 1d20+5, 2d6+1d8+3, 4d6kh3`);
  }

  return { type: 'compound', terms };
}

function evaluateRollOutcome(result, options = {}) {
  const dc = options.dc ?? null;
  const ac = options.ac ?? null;
  const isAttack = Boolean(options.attack || ac !== null);
  const targetVal = ac !== null ? ac : dc;

  if (isAttack) {
    result.attack = true;
    if (ac !== null) result.ac = ac;
    if (result.d20Special === 'NATURAL 20!') {
      result.hit = true;
      result.autoHit = true;
      result.autoMiss = false;
      if (targetVal !== null) result.success = true;
    } else if (result.d20Special === 'NATURAL 1!') {
      result.hit = false;
      result.autoHit = false;
      result.autoMiss = true;
      if (targetVal !== null) result.success = false;
    } else if (targetVal !== null) {
      result.hit = result.total >= targetVal;
      result.autoHit = false;
      result.autoMiss = false;
      result.success = result.hit;
    }
  } else if (dc !== null) {
    result.dc = dc;
    result.success = result.total >= dc;
  }

  return result;
}

function executeSingleRoll(expr, options = {}) {
  const parsed = parseDiceExpression(expr);
  const hasAdvOrDis = Boolean(options.advantage || options.disadvantage);

  // 1. Keep-highest / Keep-lowest syntax (4d6kh3 / 4d6kl3)
  if (parsed.type === 'kh' || parsed.type === 'kl') {
    if (hasAdvOrDis) {
      throw new Error(`Advantage/Disadvantage cannot be combined with ${parsed.type} in "${expr}"`);
    }
    let { numDice, sides, keepCount, mod } = parsed;
    if (options.crit && sides !== 20) {
      numDice *= 2;
      keepCount *= 2;
    }
    const rolls = [];
    for (let i = 0; i < numDice; i++) rolls.push(rollDie(sides));
    const sorted = [...rolls].sort((a, b) => (parsed.type === 'kl' ? a - b : b - a));
    const kept = sorted.slice(0, keepCount);
    const total = kept.reduce((a, b) => a + b, 0) + mod;

    return evaluateRollOutcome({
      expr,
      rolls,
      kept,
      mod,
      total,
      d20Special: null
    }, options);
  }

  const terms = parsed.terms;
  const diceTerms = terms.filter(t => t.type === 'dice');
  const d20Terms = diceTerms.filter(t => t.sides === 20);
  const hasD20Check = d20Terms.length > 0;

  if (hasAdvOrDis) {
    if (d20Terms.length !== 1 || d20Terms[0].count !== 1 || d20Terms[0].sign !== 1) {
      throw new Error(`Advantage/Disadvantage only applies to a single 1d20 roll, got "${expr}"`);
    }
  }

  // 2. Simple single-dice expression (backward-compatible fast-path for positive single dice)
  if (diceTerms.length === 1 && diceTerms[0].sign === 1 && (terms.length === 1 || (terms.length === 2 && terms[1].type === 'mod'))) {
    const diceTerm = diceTerms[0];
    let numDice = diceTerm.count;
    const sides = diceTerm.sides;
    const mod = terms.length === 2 ? terms[1].val : 0;

    if (options.crit && sides !== 20) {
      numDice *= 2;
    }

    // Handle advantage / disadvantage on 1d20
    if (sides === 20 && hasAdvOrDis) {
      const r1 = rollDie(20);
      const r2 = rollDie(20);
      let chosen;
      let modeTag;
      if (options.advantage && options.disadvantage) {
        chosen = r1; // cancel out
        modeTag = 'Adv+Dis Canceled';
      } else if (options.advantage) {
        chosen = Math.max(r1, r2);
        modeTag = 'Advantage';
      } else {
        chosen = Math.min(r1, r2);
        modeTag = 'Disadvantage';
      }
      const total = chosen + mod;

      let d20Special = null;
      if (chosen === 20) d20Special = 'NATURAL 20!';
      else if (chosen === 1) d20Special = 'NATURAL 1!';

      return evaluateRollOutcome({
        expr: `${expr} (${modeTag})`,
        mode: modeTag,
        rolls: [r1, r2],
        chosen,
        mod,
        total,
        d20Special
      }, options);
    }

    // Standard single roll
    const rolls = [];
    let sum = 0;
    for (let i = 0; i < numDice; i++) {
      const r = rollDie(sides);
      rolls.push(r);
      sum += r;
    }
    const total = sum + mod;

    let d20Special = null;
    if (sides === 20 && numDice === 1) {
      if (rolls[0] === 20) d20Special = 'NATURAL 20!';
      else if (rolls[0] === 1) d20Special = 'NATURAL 1!';
    }

    return evaluateRollOutcome({
      expr,
      rolls,
      mod,
      total,
      d20Special
    }, options);
  }

  // 3. Compound multi-dice expression (e.g., 1d8+3+2d8, 1d20+5+1d4)
  const allRolls = [];
  const termResults = [];
  let totalMod = 0;
  let totalSum = 0;
  let d20Special = null;

  for (const term of terms) {
    if (term.type === 'mod') {
      totalMod += term.val;
      termResults.push({ type: 'mod', value: term.val });
    } else if (term.type === 'dice') {
      let numDice = term.count;
      // Only double damage dice on critical hits (not bonus dice like 1d4 Bless on a d20 check)
      if (options.crit && term.sides !== 20 && !hasD20Check) {
        numDice *= 2;
      }

      if (term.sides === 20 && numDice === 1 && hasAdvOrDis) {
        const r1 = rollDie(20);
        const r2 = rollDie(20);
        let chosen;
        if (options.advantage && options.disadvantage) chosen = r1;
        else if (options.advantage) chosen = Math.max(r1, r2);
        else chosen = Math.min(r1, r2);
        allRolls.push(chosen);
        totalSum += chosen * term.sign;
        if (chosen === 20) d20Special = 'NATURAL 20!';
        else if (chosen === 1 && !d20Special) d20Special = 'NATURAL 1!';
        termResults.push({
          type: 'dice',
          expr: `${term.count}d${term.sides}`,
          rolls: [r1, r2],
          chosen,
          sign: term.sign,
          total: chosen * term.sign
        });
      } else {
        const rolls = [];
        let sum = 0;
        for (let i = 0; i < numDice; i++) {
          const r = rollDie(term.sides);
          rolls.push(r);
          allRolls.push(r);
          sum += r;
        }
        if (term.sides === 20 && numDice === 1) {
          if (rolls[0] === 20) d20Special = 'NATURAL 20!';
          else if (rolls[0] === 1 && !d20Special) d20Special = 'NATURAL 1!';
        }
        totalSum += sum * term.sign;
        termResults.push({
          type: 'dice',
          expr: `${numDice}d${term.sides}`,
          rolls,
          sign: term.sign,
          total: sum * term.sign
        });
      }
    }
  }

  const total = totalSum + totalMod;
  return evaluateRollOutcome({
    expr,
    rolls: allRolls,
    terms: termResults,
    mod: totalMod,
    total,
    d20Special
  }, options);
}

function main() {
  const args = process.argv.slice(2);
  let parsed;
  try {
    parsed = parseArgs(args);
  } catch (err) {
    console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
    process.exit(1);
  }

  if (parsed.help || !parsed.expr) {
    printHelp();
    process.exit(parsed.help ? 0 : 1);
  }

  try {
    const batchResult = roll(parsed.expr, parsed);
    if (parsed.json) {
      console.log(JSON.stringify(batchResult, null, 2));
      return;
    }

    const results = batchResult.results || [batchResult];
    for (const result of results) {
      if (parsed.hidden) {
        // In hidden mode, output ONLY the bare total number without leaking DC or labels
        console.log(`${result.total}`);
        continue;
      }

      // Pretty formatted output
      console.log(`\n${colors.bright}${colors.cyan}🎲 D&D Dice Roll${colors.reset}`);
      if (parsed.label) {
        console.log(`${colors.yellow}Label:${colors.reset}   ${parsed.label}`);
      }
      console.log(`${colors.dim}Formula:${colors.reset} ${result.expr}`);

      if (result.terms && result.terms.length > 1) {
        const breakdownStr = result.terms.map(t => {
          if (t.type === 'mod') {
            return t.value >= 0 ? `+ ${t.value}` : `- ${Math.abs(t.value)}`;
          }
          const signStr = t.sign < 0 ? '- ' : '';
          const diceVals = t.chosen !== undefined ? `[${t.rolls.join(', ')} -> Kept ${t.chosen}]` : `[${t.rolls.join(', ')}]`;
          return `${signStr}${t.expr} ${diceVals}`;
        }).join(' ');
        console.log(`${colors.dim}Terms:${colors.reset}   ${breakdownStr}`);
      } else if (result.chosen !== undefined) {
        console.log(`${colors.dim}Dice:${colors.reset}    [${result.rolls.join(', ')}] -> Kept ${colors.bright}${result.chosen}${colors.reset}`);
      } else if (result.kept) {
        console.log(`${colors.dim}Dice:${colors.reset}    [${result.rolls.join(', ')}] -> Kept [${result.kept.join(', ')}]`);
      } else {
        console.log(`${colors.dim}Dice:${colors.reset}    [${result.rolls.join(', ')}] (Sum: ${result.rolls.reduce((a, b) => a + b, 0)})`);
      }

      const modStr = result.mod > 0 ? ` + ${result.mod}` : result.mod < 0 ? ` - ${Math.abs(result.mod)}` : '';
      const baseVal = result.total - result.mod;
      console.log(`${colors.bright}Result:${colors.reset}  ${colors.green}${colors.bright}${result.total}${colors.reset}${colors.dim}${result.mod !== 0 ? ` (${baseVal}${modStr})` : ''}${colors.reset}`);

      if (result.d20Special) {
        const specialColor = result.d20Special.includes('20') ? colors.magenta : colors.red;
        console.log(`${specialColor}${colors.bright}★ ${result.d20Special} ★${colors.reset}`);
      }

      if (result.attack && (result.hit !== undefined)) {
        const targetLabel = parsed.ac !== null ? `AC ${parsed.ac}` : (parsed.dc !== null ? `AC/DC ${parsed.dc}` : 'Attack');
        if (result.autoHit) {
          console.log(`${colors.green}${colors.bright}✓ CRITICAL HIT! (Auto-Hit)${colors.reset} ${colors.dim}(${targetLabel})${colors.reset}`);
        } else if (result.autoMiss) {
          console.log(`${colors.red}${colors.bright}✗ AUTOMATIC MISS! (Natural 1)${colors.reset} ${colors.dim}(${targetLabel})${colors.reset}`);
        } else if (result.hit) {
          console.log(`${colors.green}${colors.bright}✓ HIT${colors.reset} ${colors.dim}(${targetLabel})${colors.reset}`);
        } else {
          console.log(`${colors.red}${colors.bright}✗ MISS${colors.reset} ${colors.dim}(${targetLabel})${colors.reset}`);
        }
      } else if (parsed.dc !== null) {
        if (result.success) {
          console.log(`${colors.green}${colors.bright}✓ SUCCESS${colors.reset} ${colors.dim}(DC ${parsed.dc})${colors.reset}`);
        } else {
          console.log(`${colors.red}${colors.bright}✗ FAILURE${colors.reset} ${colors.dim}(DC ${parsed.dc})${colors.reset}`);
        }
      }
    }
  } catch (err) {
    console.error(`${colors.red}Error: ${err.message}${colors.reset}`);
    process.exit(1);
  }
}

/**
 * Programmatic roll function for in-process execution (<0.1ms)
 */
export function roll(expr, options = {}) {
  const dcVal = validateDc(options.dc, 'DC');
  const acVal = validateDc(options.ac, 'AC');
  const batchVal = validateBatch(options.batch);
  const parsedOpts = {
    expr,
    advantage: Boolean(options.advantage || options.adv),
    disadvantage: Boolean(options.disadvantage || options.dis),
    crit: Boolean(options.crit),
    attack: Boolean(options.attack || acVal !== null),
    ac: acVal,
    dc: dcVal,
    hidden: Boolean(options.hidden),
    label: options.label || '',
    batch: batchVal
  };

  const results = [];
  for (let i = 0; i < batchVal; i++) {
    results.push(executeSingleRoll(expr, parsedOpts));
  }

  const primary = { ...results[0] };
  primary.batch = batchVal;
  primary.results = results;
  primary.totals = results.map(r => r.total);
  return primary;
}

export { executeSingleRoll };
export default roll;

const isMain = process.argv[1] && (
  path.resolve(process.argv[1]) === __filename ||
  path.resolve(process.argv[1]) === path.resolve(__dirname, 'roll-dice.js')
);

if (isMain) {
  main();
}
